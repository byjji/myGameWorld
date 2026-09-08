/**
 * Game-Party WebSocket 클라이언트 (폰·TV 공용)
 *
 * PROJECT.md 8장 프로토콜 구현.
 *
 *   WS /ws/{code}?role=tv|play
 *
 *   TV  -> 서버   { t:'create' }
 *                 { t:'phase', v:'select|play|result', game:'rope' }
 *                 { t:'state', v:{...} }
 *   서버 -> 폰    { t:'err', msg:'...' }   없는 방 등. 소켓 오류(error)와 이름을 구분한다
 *   폰  -> 서버   { t:'hello' }            방에 붙었다. TV가 현재 단계로 답한다
 *                 { t:'join', name, char }
 *                 { t:'ready' }            캐릭터를 고르고 준비를 눌렀다
 *                 { t:'motion', a:'jump|squat|punch', p:0.82 }
 *                 { t:'tilt', v:-0.42 }
 *                 { t:'calib', v:{...} }
 *
 * 서버는 방 단위로 그대로 릴레이한다. 게임 로직 없음.
 *
 * 원칙 두 가지 (PROJECT.md 8장):
 *   - 동작 이벤트는 폰에서 판정해서 결과만 보낸다. 원시 센서값 60Hz를 흘리지 않는다.
 *   - 예외는 tilt. 연속값이 필요하므로 TILT_SEND_HZ로 스로틀링해서 보낸다.
 *
 * 문법 수준: ES5
 */
(function (global) {
  'use strict';

  var GP = global.GP || (global.GP = {});
  var T = GP.tuning;

  var BACKOFF_MS = [500, 1000, 2000, 4000, 8000];   // 재접속 지수 백오프
  var PING_MS = 25000;                              // 프록시 idle timeout 방지

  // 집 NAS의 릴레이. Synology 역방향 프록시가 8443에서 호스트 이름으로 갈라
  // 127.0.0.1:8181 컨테이너로 넘긴다 (docs/deploy.md).
  // 옮기게 되면 이 한 줄만 고친다. 주소로 덮어쓰려면 `?relay=wss://...`.
  var RELAY = 'wss://relay.ji-fam.synology.me:8443';

  // 개발 PC에서 연 경우. 이때만 현재 호스트를 쓴다.
  var LOCAL = /^(localhost|127\.0\.0\.1|\[?::1\]?|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/;

  /**
   * opts = {
   *   url:           'wss://host'  — 뒤에 /ws/{code}?role= 을 붙인다
   *   role:          'tv' | 'play'
   *   socketFactory: function(url){ return new WebSocket(url) }   시험용 주입구
   * }
   */
  function Net(opts) {
    this.url = (opts.url || '').replace(/\/+$/, '');
    this.role = opts.role;
    this.code = null;

    this._factory = opts.socketFactory || function (u) { return new global.WebSocket(u); };
    this._ws = null;
    this._handlers = {};
    this._tries = 0;
    this._closing = false;      // 사용자가 의도적으로 끊었는가
    this._reconnectTimer = 0;
    this._pingTimer = 0;
    this._lastTilt = -1e9;
    this._pending = [];         // 연결 전에 보내려 한 메시지

    this.status = 'idle';       // idle | connecting | open | reconnecting | closed
  }

  Net.prototype.on = function (name, fn) {
    (this._handlers[name] || (this._handlers[name] = [])).push(fn);
    return this;
  };

  Net.prototype.off = function (name, fn) {
    var hs = this._handlers[name];
    if (!hs) return this;
    var i = hs.indexOf(fn);
    if (i >= 0) hs.splice(i, 1);
    return this;
  };

  Net.prototype._emit = function (name, payload) {
    var hs = this._handlers[name];
    if (!hs) return;
    for (var i = 0; i < hs.length; i++) hs[i](payload);
  };

  Net.prototype._setStatus = function (s, info) {
    if (this.status === s) return;
    this.status = s;
    // 연결 끊김은 화면에 크게 표시해야 한다 (PROJECT.md 7장). 여기서 알린다.
    this._emit('status', { status: s, info: info || null });
  };

  /**
   * 방에 접속한다.
   * TV는 code 없이 부르면 서버가 새 방을 만들고 코드를 돌려준다.
   * 폰은 반드시 code가 있어야 한다.
   */
  Net.prototype.connect = function (code) {
    this.code = code || null;
    this._closing = false;
    this._tries = 0;
    this._open();
    return this;
  };

  Net.prototype._open = function () {
    var self = this;

    // 방 코드가 아직 없으면(TV 최초 접속) new 로 붙는다. 서버가 코드를 발급한다.
    var seg = this.code ? this.code : 'new';
    var url = this.url + '/ws/' + seg + '?role=' + this.role;

    this._setStatus(this._tries ? 'reconnecting' : 'connecting');

    var ws;
    try {
      ws = this._factory(url);
    } catch (e) {
      this._scheduleReconnect();
      return;
    }
    this._ws = ws;

    ws.onopen = function () {
      self._tries = 0;
      self._setStatus('open');
      self._emit('open', null);

      // 연결 전에 쌓인 메시지를 흘려보낸다.
      var q = self._pending;
      self._pending = [];
      for (var i = 0; i < q.length; i++) self._raw(q[i]);

      self._startPing();
    };

    ws.onmessage = function (ev) {
      var msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;   // 깨진 메시지는 버린다. 릴레이가 다음 것을 보낸다
      }
      if (!msg || !msg.t) return;

      // 방 코드는 서버가 알려준다. TV가 대기 화면에 띄울 값.
      if (msg.t === 'room' && msg.code) self.code = msg.code;

      self._emit(msg.t, msg);
      self._emit('message', msg);
    };

    ws.onclose = function (ev) {
      self._stopPing();
      if (self._closing) {
        self._setStatus('closed');
        self._emit('close', ev);
        return;
      }
      self._emit('close', ev);
      self._scheduleReconnect();
    };

    ws.onerror = function (ev) {
      self._emit('error', ev);
    };
  };

  Net.prototype._scheduleReconnect = function () {
    var self = this;
    if (this._closing) return;

    var wait = BACKOFF_MS[Math.min(this._tries, BACKOFF_MS.length - 1)];
    this._tries++;
    this._setStatus('reconnecting', { wait: wait, tries: this._tries });

    if (this._reconnectTimer) global.clearTimeout(this._reconnectTimer);
    this._reconnectTimer = global.setTimeout(function () { self._open(); }, wait);
  };

  Net.prototype._startPing = function () {
    var self = this;
    this._stopPing();
    // 프록시가 조용한 연결을 끊는다. 게임 중에 끊기면 답이 없다.
    this._pingTimer = global.setInterval(function () { self.send({ t: 'ping' }); }, PING_MS);
  };

  Net.prototype._stopPing = function () {
    if (this._pingTimer) global.clearInterval(this._pingTimer);
    this._pingTimer = 0;
  };

  Net.prototype.close = function () {
    this._closing = true;
    this._stopPing();
    if (this._reconnectTimer) global.clearTimeout(this._reconnectTimer);
    if (this._ws) this._ws.close();
    this._setStatus('closed');
  };

  Net.prototype._raw = function (obj) {
    try {
      this._ws.send(JSON.stringify(obj));
      return true;
    } catch (e) {
      return false;
    }
  };

  /** 보낸다. 아직 안 붙었으면 큐에 넣는다. */
  Net.prototype.send = function (obj) {
    if (this._ws && this._ws.readyState === 1) return this._raw(obj);

    // ping은 쌓아둘 이유가 없다. 재접속하면 새로 시작한다.
    if (obj.t === 'ping') return false;

    // 큐가 무한정 자라지 않게 한다. 오래된 것부터 버린다.
    this._pending.push(obj);
    if (this._pending.length > 32) this._pending.shift();
    return false;
  };

  /* 보내기 도우미. 게임 코드가 메시지 형식을 알 필요 없게 한다. */

  Net.prototype.createRoom = function () { return this.send({ t: 'create' }); };

  Net.prototype.join = function (name, chr) {
    return this.send({ t: 'join', name: name, 'char': chr });
  };

  /**
   * 현재 단계를 폰에 알린다.
   * motion을 같이 보내는 이유: 폰은 미니게임을 모른다. 어떤 동작을 켤지 TV가 알려줘야 한다.
   */
  Net.prototype.phase = function (v, game, motion) {
    var m = { t: 'phase', v: v };
    if (game) m.game = game;
    if (motion) m.motion = motion;
    return this.send(m);
  };

  Net.prototype.state = function (v) { return this.send({ t: 'state', v: v }); };

  Net.prototype.motion = function (a, p) {
    return this.send({ t: 'motion', a: a, p: p });
  };

  /**
   * 연속값. 스로틀링해서 보낸다.
   * 60Hz 원시값을 그대로 흘리면 릴레이와 TV가 같이 죽는다.
   */
  Net.prototype.tilt = function (v, nowMs) {
    var now = nowMs !== undefined ? nowMs
      : ((global.performance && global.performance.now) ? global.performance.now()
                                                        : new Date().getTime());
    var minGap = 1000 / T.TILT_SEND_HZ;
    if (now - this._lastTilt < minGap) return false;
    this._lastTilt = now;
    return this.send({ t: 'tilt', v: Math.round(v * 100) / 100 });
  };

  Net.prototype.calib = function (v) { return this.send({ t: 'calib', v: v }); };

  /**
   * 판정기를 통신에 연결한다.
   * 폰에서 한 줄로 "판정 결과만 전송"을 보장하는 자리.
   */
  Net.prototype.bindDetector = function (detector) {
    var self = this;
    detector.on('action', function (e) { self.motion(e.a, Math.round(e.p * 100) / 100); });
    detector.on('tilt', function (e) { self.tilt(e.v); });
    return this;
  };

  GP.net = {
    Net: Net,

    /**
     * 기본 릴레이 주소.
     *
     * 정적 파일은 Netlify, WebSocket은 집 NAS라 호스트가 다르다.
     * 예전에는 현재 호스트를 썼는데, 그러면 Netlify 주소로 붙으려 해서 반드시 실패했다.
     * TV 리모컨으로 `?relay=wss://...`를 칠 수는 없으므로 여기에 박는다 (docs/deploy.md).
     *
     * 순서
     *   1. `?relay=` 가 있으면 그것. 릴레이를 옮기거나 다른 곳을 시험할 때 쓴다
     *   2. 로컬에서 열었으면 현재 호스트. 개발 PC에서 릴레이를 같이 띄운 경우다
     *   3. 그 외에는 RELAY
     */
    defaultUrl: function () {
      var m = global.location.search.match(/[?&]relay=([^&]+)/);
      if (m) return decodeURIComponent(m[1]);

      var host = global.location.hostname || '';
      if (LOCAL.test(host)) {
        var proto = global.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return proto + '//' + global.location.host;
      }
      return RELAY;
    }
  };

})(window);
