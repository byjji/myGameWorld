/**
 * 개발용 로컬 릴레이 (BroadcastChannel)
 *
 * 릴레이 서버(phase2)가 아직 없어도 같은 브라우저의 두 탭으로
 * TV와 폰을 붙여 셸 흐름을 확인하기 위한 도구다.
 *
 * 오프라인 모드가 아니다. PROJECT.md 1장의 "오프라인 모드는 만들지 않는다"는
 * 제품 결정이고, 이건 개발 중에만 쓰는 배선이다.
 * 주소에 ?dev=1 이 있을 때만 켜진다. 배포본에서는 절대 켜지지 않는다.
 *
 * 사용법: LP.net.Net 의 socketFactory 자리에 LP.devlink.factory 를 넣는다.
 *
 * 문법 수준: ES5
 */
(function (global) {
  'use strict';

  var LP = global.LP || (global.LP = {});

  function on() {
    return /[?&]dev=1/.test(global.location.search) &&
           typeof global.BroadcastChannel !== 'undefined';
  }

  // 방 상태를 탭 사이에서 공유한다. 서버 메모리 딕셔너리의 최소 흉내.
  var CODE_DIGITS = '234589';   // 0/6, 1/7 혼동 방지 (PROJECT.md 7장)

  function makeCode() {
    var s = '';
    for (var i = 0; i < 4; i++) {
      s += CODE_DIGITS.charAt(Math.floor(Math.random() * CODE_DIGITS.length));
    }
    return s;
  }

  /** WebSocket 흉내. onopen/onmessage/onclose/send/close 만 있으면 net.js가 쓴다. */
  function DevSocket(url) {
    var self = this;
    this.readyState = 0;

    var m = url.match(/\/ws\/([^?]+)\?role=(\w+)/);
    this.code = m ? m[1] : 'new';
    this.role = m ? m[2] : 'play';

    // TV가 new 로 붙으면 코드를 만들어 준다. 서버가 하던 일.
    if (this.role === 'tv' && this.code === 'new') this.code = makeCode();

    this.ch = new global.BroadcastChannel('lparty-dev-' + this.code);
    this.ch.onmessage = function (ev) {
      // 자기가 보낸 것은 되돌려받지 않는다.
      if (ev.data && ev.data.__from === self.role) return;
      if (self.onmessage) self.onmessage({ data: JSON.stringify(ev.data.msg) });
    };

    global.setTimeout(function () {
      self.readyState = 1;
      if (self.onopen) self.onopen();
      // TV에게 방 코드를 알려준다. 실제 서버의 room 메시지와 같은 모양.
      if (self.role === 'tv' && self.onmessage) {
        self.onmessage({ data: JSON.stringify({ t: 'room', code: self.code }) });
      }
      // 폰에게 자리를 알려준다. 개발 배선에는 자리 배정이 없으므로 항상 p1이다.
      if (self.role === 'play' && self.onmessage) {
        self.onmessage({ data: JSON.stringify({ t: 'you', pid: 'p1' }) });
      }
    }, 30);
  }

  DevSocket.prototype.send = function (s) {
    if (this.readyState !== 1) throw new Error('not open');
    this.ch.postMessage({ __from: this.role, msg: JSON.parse(s) });
  };

  DevSocket.prototype.close = function () {
    this.readyState = 3;
    try { this.ch.close(); } catch (e) { /* 이미 닫힘 */ }
    if (this.onclose) this.onclose({ code: 1000 });
  };

  LP.devlink = {
    enabled: on,
    makeCode: makeCode,
    factory: function (url) { return new DevSocket(url); }
  };

})(window);
