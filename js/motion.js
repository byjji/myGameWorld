/**
 * Game-Party 동작 판정 공통 모듈
 *
 * PROJECT.md 4장 명세 구현. 감지하는 동작 4종: 점프 / 쳐올리기 / 스쿼트 / 좌우 기울기.
 *
 * 구조가 두 겹이다.
 *   GP.motion.Detector : 센서를 모르는 순수 판정기. 표본을 넣으면 이벤트가 나온다.
 *   GP.motion.attach() : 브라우저 센서를 구독해 Detector에 표본을 넣는다.
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

  var GP = global.GP || (global.GP = {});
  var T = GP.tuning;

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
    // 마지막으로 "잡힌" 시각. 켜져 있지 않아 내보내지 않은 것도 기록한다 —
    // 스쿼트/쳐올리기 상호 배제는 게임이 하나만 켰을 때도 작동해야 한다.
    this._lastFire = { jump: -1e9, punch: -1e9, squat: -1e9 };

    // 게임이 쓰는 동작만 켠다. setEnabled() 참고.
    this._enabled = { jump: true, punch: true, squat: true };

    this._ff = { since: -1, until: -1 };   // 자유낙하 구간
    this._ffFired = false;                 // JUMP_ON_FREEFALL_START 모드용

    this._lastT = -1;         // 직전 표본 시각. 적분 간격 계산용
    this._grav = null;        // 현재 중력 방향 추정 (폰 좌표계, 저역 통과). 기준 자세에서 출발
    this._vel = 0;            // 세로 속도 추정 (m/s). 세로 가속도의 누설 적분
    // phase: idle → down(내려가는 중) → rise(일어나기 시작, 체공 확인 대기) → idle
    this._squat = { phase: 'idle', startT: 0, vmin: 0, fireAt: 0, p: 0, punchArmed: true };

    this.lane = 1;            // 3레인 기준 현재 레인 (0,1,2)
    this.tilt = 0;            // 연속값 -1 ~ 1

    // 디버그 오버레이용. 판정을 안 거치고 화면에 그대로 뿌린다.
    this.debug = { vert: 0, vel: 0, mag: 0, pitchRel: 0, rollRel: 0, freefall: false, squat: 'idle' };
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
   * 세 동작(점프·쳐올리기·스쿼트)은 한 세로축 신호를 나눠 갖는다. 판정기는 셋을 전부 켠 채로도
   * 서로 새지 않게 만들어져 있다 (_detectCycle 참고) — 판정 확인 화면이 그 상태로 돈다.
   * 그래도 미니게임은 PROJECT.md 4장대로 필요한 동작 하나만 켠다. 배제 규칙은 켜짐과 무관하게
   * 작동하므로, 하나만 켜도 나머지 동작이 그쪽으로 새지 않는다.
   *
   * 알려진 구멍: 웅크림 없이 뻣뻣하게 뛰면 도약이 "위로 먼저"라 쳐올리기로 잡힌다 (착지는 점프).
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
    this._lastT = -1;
    this._grav = null;
    this._vel = 0;
    this._squat.phase = 'idle';
    this._squat.punchArmed = true;
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

    // 표본 간격. 첫 표본은 모르니 0. 탭 전환 등으로 구멍이 나면 100ms로 잘라 적분이 튀지 않게 한다.
    var dt = this._lastT < 0 ? 0 : Math.min(s.t - this._lastT, 100);
    this._lastT = s.t;

    // 세로축 = 지금 폰이 보는 중력 방향. 기준 자세에서 출발해 천천히 따라간다.
    // 기준 자세 중력에 고정하면 폰을 젖힌 채로는 세로 가속도에 cos 손실이 상수로 끼고,
    // 그게 적분되어 속도가 한쪽으로 흘러 스쿼트를 놓친다.
    var g = this._grav;
    if (!g) g = this._grav = { x: b.gx * T.G, y: b.gy * T.G, z: b.gz * T.G };
    if (dt > 0) {
      var kg = 1 - Math.exp(-dt / T.GRAVITY_TAU_MS);
      g.x += (s.ax - g.x) * kg;
      g.y += (s.ay - g.y) * kg;
      g.z += (s.az - g.z) * kg;
    }
    var gm = Math.sqrt(g.x * g.x + g.y * g.y + g.z * g.z) || 1;
    var vertRaw = (s.ax * g.x + s.ay * g.y + s.az * g.z) / gm - T.G;
    this._vert = T.ACCEL_SMOOTH * this._vert + (1 - T.ACCEL_SMOOTH) * vertRaw;

    // 세로 속도. 가속도를 그냥 적분하면 편향이 끝없이 쌓이므로 시간상수만큼 새어 나가게 한다.
    // 가속도가 거의 없으면(정지) 훨씬 빨리 0으로 되돌린다 — 안 움직이면 속도도 없다.
    if (dt > 0) {
      var tau = Math.abs(this._vert) < T.VEL_REST_ACCEL ? T.VEL_REST_TAU_MS : T.SQUAT_VEL_TAU_MS;
      this._vel = this._vel * Math.exp(-dt / tau) + this._vert * (dt / 1000);
    }

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
    this._detectCycle(s.t);
    this._detectTilt();

    this.debug.vert = this._vert;
    this.debug.vel = this._vel;
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

    // 스파이크 직전에 체공이 있었으면 착지다. 없으면 도약이나 힘찬 동작이라 여기서는 아무것도 아니다.
    // (쳐올리기는 _detectCycle이 속도 방향으로 본다)
    if (this._hadFreefall(this._peakT)) {
      if (!T.JUMP_ON_FREEFALL_START) this._fire('jump', t, p);
    }
  };

  Detector.prototype._fire = function (action, t, p) {
    var cd = action === 'jump' ? T.JUMP_COOLDOWN_MS
           : action === 'punch' ? T.PUNCH_COOLDOWN_MS
           : T.SQUAT_COOLDOWN_MS;

    if (t - this._lastFire[action] < cd) return;
    this._lastFire[action] = t;
    if (!this._enabled[action]) return;
    this._emit(action, { a: action, p: p, t: t });
    this._emit('action', { a: action, p: p, t: t });
  };

  /* 스쿼트 / 쳐올리기 — 세로 속도 사이클 */

  /**
   * 세로 속도의 첫 방향이 가른다. 아래로 먼저 = 스쿼트, 위로 먼저 = 쳐올리기.
   *
   * 각도(pitch)는 보지 않는다. 폰을 같은 높이에서 젖히기만 해도 각도는 변하지만
   * 세로 속도는 안 변한다 — 실기에서 그 오인식이 잡혀 여기로 바꿨다.
   * 쳐올리기도 가속도 크기(스파이크)가 아니라 방향이다 — 보통 속도로 올리면 스파이크가
   * 임계에 못 미쳐 안 잡히고, 내려와 멈추는 왕복만 스쿼트로 새던 것을 실기에서 봤다.
   *
   * 스쿼트 발화는 "일어나기 시작" + SQUAT_CONFIRM_MS. 다 일어날 때까지 기다리면 로프가 늦게
   * 오르고, 바로 내면 점프의 도약을 스쿼트로 센다. 그 사이 체공이 시작되면 점프였던 것이다.
   * 쳐올리기는 위로 넘는 즉시 낸다 — 블록깨기는 반응이 생명이다.
   */
  Detector.prototype._detectCycle = function (t) {
    var sq = this._squat;
    var v = this._vel;

    if (sq.phase === 'idle') {
      // 다음 쳐올리기는 속도가 한 번 가라앉은 뒤에만. 길게 밀어 올리는 동안 쿨다운마다 다시 잡히지 않게.
      if (v < T.PUNCH_VEL_REARM) sq.punchArmed = true;

      // 속도만 보면 폰을 젖힐 때 생기는 느린 표류도 "내려감"이 된다. 가속도로 동작인지 가른다.
      // 체공 중에도 여기로 들어온다 (속도가 곤두박질친다) — 그래야 착지의 튀어오름이
      // 쳐올리기가 아니라 "내려간 뒤"로 분류되고, 직후 체공 확인에서 스쿼트도 취소된다.
      if (v <= -T.SQUAT_VEL_DOWN && this._vert <= -T.SQUAT_ACCEL_DOWN) {
        // 쳐올린 폰이 가슴으로 돌아와 멈추는 것도 세로 왕복이다. 위로 먼저 갔으면 쳐올리기다.
        if (t - this._lastFire.punch < T.SQUAT_PUNCH_GUARD_MS) return;
        sq.phase = 'down';
        sq.startT = t;
        sq.vmin = v;
        return;
      }

      if (sq.punchArmed && v >= T.PUNCH_VEL_UP && this._vert >= T.PUNCH_ACCEL_UP) {
        // 힘차게 일어선 직후의 반동은 쳐올리기가 아니다.
        if (t - this._lastFire.squat < T.SQUAT_PUNCH_GUARD_MS) return;
        sq.punchArmed = false;
        var pp = clamp((this._vert - T.PUNCH_ACCEL_UP) / (T.PUNCH_ACCEL_MAX - T.PUNCH_ACCEL_UP), 0, 1);
        this._fire('punch', t, pp);
      }
      return;
    }

    if (sq.phase === 'rise') {
      // 일어나기 시작한 직후 체공이 확인되면 점프의 도약이었다. 나머지 올라감도 쳐올리기가 아니다.
      // 체공은 FREEFALL_MIN_MS 이상 이어진 것만 인정한다 — 힘차게 일어서다 멈추는 감속도
      // 한두 표본은 체공처럼 보인다.
      if (this._hadFreefall(t)) { sq.phase = 'idle'; sq.punchArmed = false; return; }
      if (t < sq.fireAt) return;
      sq.phase = 'idle';
      this._fire('squat', t, sq.p);
      return;
    }

    // phase === 'down'
    if (v < sq.vmin) sq.vmin = v;

    // 너무 오래 안 올라오면 그냥 앉아 있는 것. 처음부터 다시 본다.
    if (t - sq.startT > T.SQUAT_MAX_MS) {
      sq.phase = 'idle';
      return;
    }

    if (v < T.SQUAT_VEL_UP) return;

    // 내려간 지 얼마 안 돼 올라왔으면 걸음이나 흔들림이다. 이번 왕복은 버린다.
    // 올라가는 구간이 남아 있으니 무장을 풀어 그게 쳐올리기로 보이지 않게 한다 (점프의 도약이 여기 걸린다).
    if (t - sq.startT < T.SQUAT_MIN_MS) { sq.phase = 'idle'; sq.punchArmed = false; return; }

    sq.phase = 'rise';
    sq.fireAt = t + T.SQUAT_CONFIRM_MS;
    sq.p = clamp((-sq.vmin - T.SQUAT_VEL_DOWN) / (T.SQUAT_VEL_MAX - T.SQUAT_VEL_DOWN), 0, 1);
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

  GP.motion = GP.motion || {};
  GP.motion.Detector = Detector;

  GP.motion.needsPermission = function () {
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
  GP.motion.attach = function (detector, cb) {
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

    if (GP.motion.needsPermission()) {
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
