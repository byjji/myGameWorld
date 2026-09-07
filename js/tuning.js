/**
 * L-Party 동작 판정 임계값
 *
 * PROJECT.md 4장의 판정 명세를 숫자로 고정한 파일.
 * 여기 있는 값은 코드 문제가 아니라 플레이테스트로 찾는 숫자다. 조카 표정을 보고 정한다.
 *
 * 임계값이 게임 파일로 흩어지면 튜닝 때 다섯 군데를 고치게 된다. 전부 여기 둔다.
 * 렌더링 예산은 js/config.js. 성격이 다르므로 섞지 않는다.
 *
 * 문법 수준: ES5
 */
(function (global) {
  'use strict';

  var LP = global.LP || (global.LP = {});

  LP.tuning = {

    /* 공통 */

    G: 9.81,              // 중력 가속도 (m/s^2)

    // 가속도 저역 통과 계수. 0에 가까울수록 반응이 빠르고 잡음이 많다.
    // 스파이크를 봐야 하므로 과하게 매끈하게 만들지 않는다.
    ACCEL_SMOOTH: 0.5,

    // 각도 저역 통과 계수. 각도는 느린 신호라 더 세게 눌러도 된다.
    ANGLE_SMOOTH: 0.75,

    /* 점프 / 쳐올리기 (PROJECT.md 4장) */

    // 세로 가속도 스파이크 임계 (m/s^2). 중력을 뺀 값 기준.
    SPIKE_ON: 12,

    // 스파이크 해제 임계. 하나의 스파이크가 여러 번 잡히는 것을 막는다.
    SPIKE_OFF: 5,

    // 자유낙하 판정. 합가속도가 이 값 아래로 떨어지면 체공 중.
    FREEFALL_MAG: 3,

    // 스파이크 직전 이 시간(ms) 안에 자유낙하가 있었으면 점프, 없으면 쳐올리기.
    FREEFALL_WINDOW_MS: 300,

    // 자유낙하로 인정할 최소 지속 시간(ms). 한 샘플 튄 것을 체공으로 오인하지 않는다.
    FREEFALL_MIN_MS: 40,

    // 점프를 어느 시점에 발화할지.
    //   false = 착지 스파이크에 발화 (PROJECT.md 명세 그대로. 판정이 확실하지만 체공 시간만큼 늦다)
    //   true  = 자유낙하 시작에 발화 (빠르지만 착지 확인 없이 쏜다)
    // 줄넘기의 타이밍 판정이 늦게 느껴지면 phase4에서 이 값을 바꿔 비교한다.
    JUMP_ON_FREEFALL_START: false,

    JUMP_COOLDOWN_MS: 350,

    // 폰이 판정한 순간부터 TV가 그 메시지를 받기까지의 지연(ms).
    // 줄넘기가 이 값만큼 시계를 되돌려 판정한다 (js/games/jumprope.js).
    // 실측 전까지 0이다 — 추측한 값을 넣으면 지연이 실제로 얼마인지 영영 모르게 된다.
    // phase4 실기에서 RTT(에코 페이지)와 체감 어긋남을 보고 채운다.
    JUMP_LAG_MS: 0,
    PUNCH_COOLDOWN_MS: 300,

    // 세기(p) 정규화 구간. SPIKE_MIN에서 0, SPIKE_MAX에서 1.
    SPIKE_MIN: 12,
    SPIKE_MAX: 35,

    /* 스쿼트 (자이로 pitch 왕복 1사이클) */

    // 기준 자세 대비 이 각도(도) 이상 기울면 "내려갔다"로 본다.
    SQUAT_DOWN_DEG: 22,

    // 다시 이 각도 안으로 돌아오면 "올라왔다". DOWN보다 작아야 히스테리시스가 생긴다.
    SQUAT_UP_DEG: 10,

    // 왕복 1사이클의 제한 시간(ms). 넘으면 취소하고 처음부터 다시 본다.
    SQUAT_MAX_MS: 2500,

    // 보조 신호. 일어서는 순간의 세로 가속도가 이 값을 넘으면 정확도가 올라간다.
    // 0으로 두면 각도만 본다.
    SQUAT_ACCEL_HINT: 2,

    SQUAT_COOLDOWN_MS: 300,

    /* 좌우 기울기 (절대 위치 매핑) */

    // 레인 전환 임계(도). PROJECT.md 4장: 10~12도로 낮게.
    // 낮으면 아이가 자연스럽게 몸을 옆으로 옮기게 되고 판정도 안정적이다.
    TILT_LANE_DEG: 11,

    // 레인에서 빠져나오는 임계. 경계에서 좌우로 떠는 것을 막는다.
    TILT_RELEASE_DEG: 6,

    // 연속값(-1 ~ 1)을 만들 때 1로 볼 각도. 레이싱·조준용.
    TILT_RANGE_DEG: 30,

    // 연속값 전송 주기(Hz). 원시 센서값을 그대로 흘리지 않는다 (PROJECT.md 8장).
    TILT_SEND_HZ: 25,

    /* 캘리브레이션 */

    CALIB_MS: 3000,

    // 이 시간 동안 모은 표본의 흔들림이 이 값을 넘으면 다시 하라고 한다.
    CALIB_MAX_ACCEL_DEV: 2.5,   // m/s^2
    CALIB_MAX_ANGLE_DEV: 6,     // 도

    // 최소 표본 수. 센서 주기가 낮은 기기에서 표본이 모자라면 보정을 신뢰하지 않는다.
    CALIB_MIN_SAMPLES: 30
  };

  /* ── 현장 오버라이드 ─────────────────────────────────
     조카 집에서 값을 바꾸려면 노트북을 열고 git push를 하고 빌드를 기다려야 한다.
     그동안 아이는 옆에서 기다린다. 그래서 주소로 덮어쓸 수 있게 해둔다.

       /p?tune=SPIKE_ON:10,SQUAT_DOWN_DEG:16        판정 임계값
       /?tune=ropeclimb.HEIGHT:18,jumprope.TARGET:30 게임별 값

     여기서 정한 것 두 가지.

       1. **없는 이름과 숫자가 아닌 값은 거부하고 기록한다.** 조용히 무시하면
          오타를 친 것인지 값이 안 먹는 것인지 조카 집에서 가릴 수 없다.
       2. **적용됐다는 사실을 화면에 표시한다** (js/tv.js, js/play.js).
          오버라이드를 켜둔 채 "왜 이상하지"를 하는 상황을 막는다.

     주소에 안 붙이면 아무 일도 일어나지 않는다. 배포본에 그대로 둬도 안전하다.
     여기서 찾은 값은 반드시 이 파일에 옮겨 적는다 — 주소는 사라진다. */

  var overrides = {};    // '' = LP.tuning, 그 외 = 게임 id
  var applied = [];      // 화면에 보여줄 목록
  var rejected = [];

  function parse(search) {
    var out = {};
    if (!search) return out;
    var m = search.match(/[?&]tune=([^&]*)/);
    if (!m) return out;

    var body = decodeURIComponent(m[1]);
    var parts = body.split(',');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split(':');
      if (kv.length !== 2) { rejected.push(parts[i] + ' (형식)'); continue; }

      var key = kv[0].replace(/^\s+|\s+$/g, '');
      var val = parseFloat(kv[1]);
      if (key === '' || isNaN(val)) { rejected.push(parts[i] + ' (숫자 아님)'); continue; }

      var dot = key.indexOf('.');
      var scope = dot < 0 ? '' : key.slice(0, dot);
      var name = dot < 0 ? key : key.slice(dot + 1);

      if (!out[scope]) out[scope] = {};
      out[scope][name] = val;
    }
    return out;
  }

  /**
   * 대상 객체에 오버라이드를 적용한다.
   * 원래 있던 이름이고 숫자였던 것만 바꾼다 — 없는 이름을 새로 만들면
   * 오타가 조용히 통과해서 "값을 바꿨는데 안 변한다"가 된다.
   */
  function apply(target, scope) {
    var set = overrides[scope];
    if (!target || !set) return 0;
    var n = 0;
    for (var k in set) {
      if (!Object.prototype.hasOwnProperty.call(set, k)) continue;
      if (typeof target[k] !== 'number') {
        rejected.push((scope ? scope + '.' : '') + k + ' (그런 값 없음)');
        continue;
      }
      applied.push((scope ? scope + '.' : '') + k + ' ' + target[k] + '→' + set[k]);
      target[k] = set[k];
      n++;
    }
    return n;
  }

  overrides = parse(global.location ? global.location.search : '');
  apply(LP.tuning, '');

  LP.tune = {
    apply: apply,                                   // 게임 TUNE에 적용할 때 셸이 부른다
    has: function () { return applied.length > 0 || rejected.length > 0; },
    applied: function () { return applied.slice(); },
    rejected: function () { return rejected.slice(); },
    /** 화면에 한 줄로 보여줄 요약. 켜져 있다는 사실 자체가 중요하다. */
    summary: function () {
      var s = applied.length ? '튜닝 ' + applied.length + '개 적용' : '';
      if (rejected.length) s += (s ? ' · ' : '') + '무시 ' + rejected.length + '개';
      return s;
    },
    /** 시험용. 주소를 직접 넣어 다시 계산한다. */
    _reset: function (search) {
      applied = [];
      rejected = [];          // parse가 여기에 쌓으므로 먼저 비운다
      overrides = parse(search || '');
      return overrides;
    }
  };

})(window);
