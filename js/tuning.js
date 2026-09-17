/**
 * Game-Party 동작 판정 임계값
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

  var GP = global.GP || (global.GP = {});

  GP.tuning = {

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

    /* 스쿼트 (세로 속도 왕복 1사이클) */

    // 처음엔 자이로 pitch로 봤다. 실기에서 폰을 같은 높이에서 카메라 쪽만 젖혀도
    // 스쿼트로 잡혔다 — "앉으면 몸이 숙여진다"는 전제가 거꾸로는 성립하지 않는다.
    // 지금은 세로 가속도를 누설 적분한 속도로 본다. 각도는 안 본다.
    //
    // 아래 숫자는 전부 추측이다. 실기 파형(?debug=1)을 보고 채운다.

    // 세로 속도(m/s)가 이 값보다 아래로 내려가면 "내려가는 중".
    // 25cm를 0.5초에 내려가면 최고 속도가 0.6~0.8 정도 나올 것으로 본다.
    SQUAT_VEL_DOWN: 0.25,

    // 그 순간 세로 가속도(m/s^2)도 이 값보다 아래여야 한다.
    // 폰을 젖히면 중력 추정이 따라잡는 동안 약한 음수 가속도가 몇 초 끼는데,
    // 그것도 적분되면 속도 임계를 넘는다. 스쿼트는 동작이라 진입 순간 -2~-3이 나오고
    // 표류는 -0.5 근처라 여기서 갈린다. 아주 느린 스쿼트(1초 넘게 내려감)는 놓칠 수 있다.
    SQUAT_ACCEL_DOWN: 1.0,

    // 내려간 뒤 속도가 이 값을 위로 넘으면 "일어남" — 여기서 발화한다.
    // 바닥에서 멈출 때도 속도가 살짝 양수로 튀는데(누설 적분의 부산물),
    // 그게 이 값을 넘으면 일어서기 전에 발화하니 너무 낮추지 말 것.
    SQUAT_VEL_UP: 0.25,

    // 세기(p) 정규화. 내려가는 최고 속도가 이 값이면 p=1.
    SQUAT_VEL_MAX: 0.8,

    // 내려가기 시작해서 일어나기까지 최소 시간(ms). 이보다 빠른 왕복은 걸음이나
    // 흔들림이라 보고 취소한다. 5세 스쿼트는 한 번에 2초 이상 걸린다.
    SQUAT_MIN_MS: 300,

    // 왕복 1사이클의 제한 시간(ms). 넘으면 취소하고 처음부터 다시 본다.
    SQUAT_MAX_MS: 2500,

    // 속도 누설 적분의 시간상수(ms). 길면 느린 스쿼트도 잡지만 잡음이 쌓이고,
    // 짧으면 바닥에서 멈출 때 양수로 튀는 폭이 커진다.
    SQUAT_VEL_TAU_MS: 2000,

    SQUAT_COOLDOWN_MS: 300,

    // 현재 중력 방향 추정의 시간상수(ms). 세로축을 보정 때의 중력이 아니라
    // 지금 폰이 기운 방향으로 잡는다. 이게 없으면 폰을 젖힌 채 앉았다 일어나면
    // 세로 가속도에 cos 손실이 상수로 끼어 속도가 한쪽으로 흘러버린다.
    // 스쿼트 한 사이클(1~2초)보다는 길고, 자세를 고쳐 잡는 시간보다는 짧게.
    GRAVITY_TAU_MS: 1500,

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

       /p?tune=SPIKE_ON:10,SQUAT_VEL_DOWN:0.2        판정 임계값
       /?tune=ropeclimb.HEIGHT:18,jumprope.TARGET:30 게임별 값

     여기서 정한 것 두 가지.

       1. **없는 이름과 숫자가 아닌 값은 거부하고 기록한다.** 조용히 무시하면
          오타를 친 것인지 값이 안 먹는 것인지 조카 집에서 가릴 수 없다.
       2. **적용됐다는 사실을 화면에 표시한다** (js/tv.js, js/play.js).
          오버라이드를 켜둔 채 "왜 이상하지"를 하는 상황을 막는다.

     주소에 안 붙이면 아무 일도 일어나지 않는다. 배포본에 그대로 둬도 안전하다.
     여기서 찾은 값은 반드시 이 파일에 옮겨 적는다 — 주소는 사라진다. */

  var overrides = {};    // '' = GP.tuning, 그 외 = 게임 id
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
  apply(GP.tuning, '');

  GP.tune = {
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
