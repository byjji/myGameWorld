/**
 * L-Party 동작 판정 공통 모듈
 *
 * PROJECT.md 4장 명세 구현. 감지하는 동작 4종: 점프 / 쳐올리기 / 스쿼트 / 좌우 기울기.
 *
 * 구조가 두 겹이다.
 *   LP.motion.Detector : 센서를 모르는 순수 판정기. 표본을 넣으면 이벤트가 나온다.
 *   LP.motion.attach() : 브라우저 센서를 구독해 Detector에 표본을 넣는다.
 *
 * 나눈 이유:
 *   - 판정기를 브라우저 없이 시험할 수 있다. 임계값 튜닝에 필수다.
 *   - 게임 로직이 입력 소스에 의존하지 않는다 (PROJECT.md 11장).
 *
 * 임계값은 전부 js/tuning.js. 이 파일에 숫자를 박지 않는다.
 *
 * 문법 수준: ES5
 */
(function (global) {
  'use strict';

  var LP = global.LP || (global.LP = {});
  var T = LP.tuning;

  /* 유틸 */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // 각도 차이를 -180 ~ 180 으로 접는다. 179도와 -179도는 2도 차이다.
  function angleDelta(a, b) {
    var d = a - b;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return d;
  }

  /**
   * 순수 판정기.
   *
   * 표본(sample) 형식:
   *   { t: ms, ax, ay, az: m/s^2 (중력 포함), pitch, roll: 도 }
   *
   * 기준 자세(baseline)는 캘리브레이션이 넣어준다. 없으면 첫 표본을 임시 기준으로 쓴다.
   *   { gx, gy, gz: 중력 방향 단위벡터, pitch0, roll0: 도 }
   */
  function Detector() {
    this.baseline = null;

    this._handlers = {};
    this._hist = [];          // 최근 표본. 자유낙하 창 조회용
    this._vert = 0;           // 필터링된 세로 가속도 (중력 제외)
    this._pitch = null;       // 필터링된 pitch
    this._roll = null;
    this._spiking = false;    // 스파이크 구간 진입 여부
    this._peak = 0;           // 현재 스파이크의 최대값
    this._peakT = 0;
    this._lastFire = { jump: -1e9, punch: -1e9, squat: -1e9 };

    // 게임이 쓰는 동작만 켠다. setEnabled() 참고.
    this._enabled = { jump: true, punch: true, squat: true };

    this._ff = { since: -1, until: -1 };   // 자유낙하 구간
    this._ffFired = false;                 // JUMP_ON_FREEFALL_START 모드용

    this._squat = { phase: 'idle', sign: 0, startT: 0, depth: 0 };

    this.lane = 1;            // 3레인 기준 현재 레인 (0,1,2)
    this.tilt = 0;            // 연속값 -1 ~ 1

    // 디버그 오버레이용. 판정을 안 거치고 화면에 그대로 뿌린다.
    this.debug = { vert: 0, mag: 0, pitchRel: 0, rollRel: 0, freefall: false, squat: 'idle' };
  }

  Detector.prototype.on = function (name, fn) {
    (this._handlers[name] || (this._handlers[name] = [])).push(fn);
    return this;
  };

  Detector.prototype.off = function (name, fn) {
    var hs = this._handlers[name];
    if (!hs) return this;
    var i = hs.indexOf(fn);
    if (i >= 0) hs.splice(i, 1);
    return this;
  };

  Detector.prototype._emit = function (name, payload) {
    var hs = this._handlers[name];
    if (!hs) return;
    for (var i = 0; i < hs.length; i++) hs[i](payload);
  };

  /**
   * 받을 동작을 고른다. 예: detector.setEnabled({ jump: true })
   *
   * 실제 점프는 세로 스파이크가 두 번 난다. 뛰어오를 때(발이 바닥) 한 번, 착지할 때 한 번.
   * 앞의 것은 직전 자유낙하가 없으므로 명세상 쳐올리기로 분류된다. 이건 오류가 아니라
   * 두 동작을 체공 구간으로 가르는 방식의 필연적 결과다.
   *
   * PROJECT.md 4장대로 미니게임 하나당 동작 하나만 쓰므로, 게임이 필요한 것만 켜면 문제가 없다.
   * 둘을 동시에 켜야 하는 게임이 생기면 그때 쳐올리기 발화를 지연시켜 취소하는 방식을 검토한다.
   * (지연은 블록깨기 반응성을 해치므로 지금은 하지 않는다)
   */
  Detector.prototype.setEnabled = function (map) {
    for (var k in map) {
      if (Object.prototype.hasOwnProperty.call(map, k)) this._enabled[k] = !!map[k];
    }
    return this;
  };

  Detector.prototype.setBaseline = function (b) {
    this.baseline = b;
    this.reset();
  };

  /** 게임 전환 시 호출. 상태만 지우고 기준 자세는 유지한다. */
  Detector.prototype.reset = function () {
    this._hist.length = 0;
    this._vert = 0;
    this._pitch = null;
    this._roll = null;
    this._spiking = false;
    this._ff.since = this._ff.until = -1;
    this._ffFired = false;
    this._squat.phase = 'idle';
    this._squat.sign = 0;
    this.lane = 1;
    this.tilt = 0;
  };

  /**
   * 표본 하나를 넣는다. 이벤트는 콜백으로 나간다.
   * 게임은 on()으로 받는다.
   */
  Detector.prototype.feed = function (s) {
    var b = this.baseline;

    // 기준 자세가 아직 없으면 첫 표본을 임시 기준으로 삼는다.
    // 정식 보정 전에도 디버그 화면이 움직이게 하려는 것일 뿐, 판정을 신뢰하면 안 된다.
    if (!b) {
      var m0 = Math.sqrt(s.ax * s.ax + s.ay * s.ay + s.az * s.az) || 1;
      b = this.baseline = {
        gx: s.ax / m0, gy: s.ay / m0, gz: s.az / m0,
        pitch0: s.pitch, roll0: s.roll,
        provisional: true
      };
    }

    var mag = Math.sqrt(s.ax * s.ax + s.ay * s.ay + s.az * s.az);

    // 세로축 = 기준 자세의 중력 방향. 폰을 쥔 각도가 달라도 같은 축을 본다.
    var vertRaw = (s.ax * b.gx + s.ay * b.gy + s.az * b.gz) - T.G;
    this._vert = T.ACCEL_SMOOTH * this._vert + (1 - T.ACCEL_SMOOTH) * vertRaw;

    var pitchRel = angleDelta(s.pitch, b.pitch0);
    var rollRel = angleDelta(s.roll, b.roll0);
    if (this._pitch === null) { this._pitch = pitchRel; this._roll = rollRel; }
    this._pitch = T.ANGLE_SMOOTH * this._pitch + (1 - T.ANGLE_SMOOTH) * pitchRel;
    this._roll = T.ANGLE_SMOOTH * this._roll + (1 - T.ANGLE_SMOOTH) * rollRel;

    this._hist.push({ t: s.t, mag: mag, vert: this._vert });
    // 자유낙하 창보다 넉넉히만 남기고 버린다. 원시 센서값을 쌓아두지 않는다.
    var cut = s.t - (T.FREEFALL_WINDOW_MS + 200);
    while (this._hist.length && this._hist[0].t < cut) this._hist.shift();

    this._trackFreefall(s.t, mag);
    this._detectSpike(s.t);
    this._detectSquat(s.t);
    this._detectTilt();

    this.debug.vert = this._vert;
    this.debug.mag = mag;
    this.debug.pitchRel = this._pitch;
    this.debug.rollRel = this._roll;
    this.debug.freefall = this._ff.since >= 0;
    this.debug.squat = this._squat.phase;

    // 원시 표본. 캘리브레이션이 기준 자세를 모을 때 쓴다.
    // 이 이벤트를 네트워크로 흘리면 안 된다 (PROJECT.md 8장).
    this._emit('sample', s);
  };

  /* 자유낙하 구간 추적 */

  Detector.prototype._trackFreefall = function (t, mag) {
    var ff = this._ff;

    if (mag < T.FREEFALL_MAG) {
      if (ff.since < 0) ff.since = t;
      ff.until = t;

      // 빠른 발화 모드. 착지를 기다리지 않고 체공이 확인되는 즉시 점프로 본다.
      if (T.JUMP_ON_FREEFALL_START && !this._ffFired &&
          (t - ff.since) >= T.FREEFALL_MIN_MS) {
        this._ffFired = true;
        this._fire('jump', t, 0.6);   // 아직 착지 전이라 세기를 알 수 없다. 중간값을 쓴다.
      }
    } else {
      ff.since = -1;
      this._ffFired = false;
    }
  };

  /**
   * 자유낙하 창 조회.
   * 스파이크 시점 기준 과거 FREEFALL_WINDOW_MS 안에
   * FREEFALL_MIN_MS 이상 이어진 자유낙하가 있었는지 본다.
   */
  Detector.prototype._hadFreefall = function (t) {
    var from = t - T.FREEFALL_WINDOW_MS;
    var run = -1;
    for (var i = 0; i < this._hist.length; i++) {
      var h = this._hist[i];
      if (h.t < from) continue;
      if (h.t >= t) break;
      if (h.mag < T.FREEFALL_MAG) {
        if (run < 0) run = h.t;
        if (h.t - run >= T.FREEFALL_MIN_MS) return true;
      } else {
        run = -1;
      }
    }
    return false;
  };

  /* 점프 / 쳐올리기 */

  Detector.prototype._detectSpike = function (t) {
    var v = this._vert;

    if (!this._spiking) {
      if (v >= T.SPIKE_ON) {
        this._spiking = true;
        this._peak = v;
        this._peakT = t;
      }
      return;
    }

    // 스파이크 구간 안. 최대값을 갱신하다가 임계 아래로 내려오면 판정한다.
    if (v > this._peak) { this._peak = v; this._peakT = t; }
    if (v > T.SPIKE_OFF) return;

    this._spiking = false;

    var p = clamp((this._peak - T.SPIKE_MIN) / (T.SPIKE_MAX - T.SPIKE_MIN), 0, 1);

    // 둘 다 세로 가속도 스파이크다. 결정적 차이는 직전 체공 구간뿐이다.
    if (this._hadFreefall(this._peakT)) {
      if (!T.JUMP_ON_FREEFALL_START) this._fire('jump', t, p);
    } else {
      this._fire('punch', t, p);
    }
  };

  Detector.prototype._fire = function (action, t, p) {
    var cd = action === 'jump' ? T.JUMP_COOLDOWN_MS
           : action === 'punch' ? T.PUNCH_COOLDOWN_MS
           : T.SQUAT_COOLDOWN_MS;

    if (!this._enabled[action]) return;
    if (t - this._lastFire[action] < cd) return;
    this._lastFire[action] = t;
    this._emit(action, { a: action, p: p, t: t });
    this._emit('action', { a: action, p: p, t: t });
  };

  /* 스쿼트 */

  Detector.prototype._detectSquat = function (t) {
    var sq = this._squat;
    var rel = this._pitch;
    var away = Math.abs(rel);

    if (sq.phase === 'idle') {
      if (away >= T.SQUAT_DOWN_DEG) {
        // 어느 방향으로 기우는지는 폰을 쥔 자세에 따라 다르다.
        // 처음 벗어난 방향을 기억하고 그 방향의 왕복만 인정한다.
        sq.phase = 'down';
        sq.sign = rel < 0 ? -1 : 1;
        sq.startT = t;
        sq.depth = away;
      }
      return;
    }

    // 왕복이 너무 느리면 스쿼트가 아니다. 그냥 앉아 있는 것.
    if (t - sq.startT > T.SQUAT_MAX_MS) {
      sq.phase = 'idle';
      sq.sign = 0;
      return;
    }

    if (sq.depth < away) sq.depth = away;

    // 같은 방향을 유지하다가 기준 자세 근처로 돌아오면 1사이클 완료.
    var sameDir = (rel * sq.sign) > 0;
    if (!sameDir || away <= T.SQUAT_UP_DEG) {
      // 보조 신호. 아직 내려가는 중이면 조금 더 본다.
      // SQUAT_ACCEL_HINT가 0이면 각도만 본다.
      if (T.SQUAT_ACCEL_HINT > 0 && this._vert < -T.SQUAT_ACCEL_HINT) return;

      var p = clamp((sq.depth - T.SQUAT_DOWN_DEG) / T.SQUAT_DOWN_DEG, 0, 1);
      sq.phase = 'idle';
      sq.sign = 0;
      this._fire('squat', t, p);
    }
  };

  /* 좌우 기울기 */

  Detector.prototype._detectTilt = function () {
    var rel = this._roll;

    // 연속값. 레이싱·블록깨기 조준용.
    var v = clamp(rel / T.TILT_RANGE_DEG, -1, 1);
    this.tilt = v;
    this._emit('tilt', { v: v, deg: rel });

    // 레인 절대 위치 매핑. 스텝 스파이크 감지 방식은 오인식이 잦아 쓰지 않는다.
    // 들어가는 임계와 빠져나오는 임계를 다르게 둬 경계에서 떠는 것을 막는다.
    var lane = this.lane;
    if (rel <= -T.TILT_LANE_DEG) lane = 0;
    else if (rel >= T.TILT_LANE_DEG) lane = 2;
    else if (this.lane === 0 && rel > -T.TILT_RELEASE_DEG) lane = 1;
    else if (this.lane === 2 && rel < T.TILT_RELEASE_DEG) lane = 1;

    if (lane !== this.lane) {
      this.lane = lane;
      this._emit('lane', { lane: lane, deg: rel });
    }
  };

  /* 브라우저 센서 구독 */

  LP.motion = LP.motion || {};
  LP.motion.Detector = Detector;

  LP.motion.needsPermission = function () {
    return typeof global.DeviceMotionEvent !== 'undefined' &&
           typeof global.DeviceMotionEvent.requestPermission === 'function';
  };

  /**
   * devicemotion / deviceorientation 을 구독해 detector에 표본을 넣는다.
   *
   * iOS는 사용자 제스처 안에서 권한을 요청해야 한다.
   * 방 코드 입력 직후처럼 확실한 탭 이벤트 안에서 호출할 것.
   *
   * cb(err, detector) 로 결과를 알린다. 반환값은 구독 해제 함수.
   */
  LP.motion.attach = function (detector, cb) {
    var angle = { pitch: 0, roll: 0 };

    function onOrient(e) {
      // beta = 앞뒤 기울기(pitch), gamma = 좌우 기울기(roll)
      if (e.beta !== null) angle.pitch = e.beta;
      if (e.gamma !== null) angle.roll = e.gamma;
    }

    function onMotion(e) {
      var a = e.accelerationIncludingGravity;
      if (!a || a.x === null) return;
      detector.feed({
        t: (global.performance && global.performance.now)
             ? global.performance.now() : new Date().getTime(),
        ax: a.x, ay: a.y, az: a.z,
        pitch: angle.pitch, roll: angle.roll
      });
    }

    function bind() {
      global.addEventListener('deviceorientation', onOrient, false);
      global.addEventListener('devicemotion', onMotion, false);
      if (cb) cb(null, detector);
    }

    if (LP.motion.needsPermission()) {
      global.DeviceMotionEvent.requestPermission().then(function (res) {
        if (res === 'granted') bind();
        else if (cb) cb(new Error('motion permission denied'), detector);
      })['catch'](function (err) {
        if (cb) cb(err, detector);
      });
    } else if (typeof global.DeviceMotionEvent === 'undefined') {
      if (cb) cb(new Error('devicemotion unsupported'), detector);
    } else {
      bind();
    }

    return function detach() {
      global.removeEventListener('deviceorientation', onOrient, false);
      global.removeEventListener('devicemotion', onMotion, false);
    };
  };

})(window);
