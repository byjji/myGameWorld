/**
 * Game-Party 렌더링 예산 상수
 *
 * PROJECT.md 2장(렌더링 제약)에서 정한 제약을 코드가 참조할 수 있는 숫자로 고정한 파일.
 * 게임 코드는 여기 있는 값만 참조한다. 같은 숫자를 게임 파일에 직접 박지 않는다.
 *
 * 전제: 조카 집 TV에서 30fps 안정 유지는 가능한 것으로 판단하고 진행한다.
 *       전제가 틀리면 이 파일의 상한만 낮춘다. 게임 로직은 건드리지 않는다.
 *
 * 근거와 배경은 docs/render-budget.md 참고.
 *
 * 문법 수준: ES5. 구형 webOS 브라우저의 파싱 실패 위험을 기반 계층에서 제거하기 위함.
 *            ES6 사용 가부는 tv-bench_1.html의 파싱 검사로 판정한다.
 */
(function (global) {
  'use strict';

  var GP = global.GP || (global.GP = {});

  GP.config = {

    /* ── 프레임 ────────────────────────────────────────── */

    // 목표 프레임. 60fps 전제로 만들면 실기에서 게임 속도가 절반이 된다.
    TARGET_FPS: 30,

    // 한 프레임에 허용되는 시간(ms). 1000 / 30
    FRAME_MS: 33.33,

    // 실제 작업에 쓸 시간(ms). TV 브라우저의 프레임 지터를 감안해 40% 여유를 남긴다.
    WORK_MS: 20,

    // 이 시간을 넘긴 프레임은 예산 초과로 보고 화면에 경고한다.
    WARN_FRAME_MS: 40,

    // deltaTime 상한(초). 탭 전환·정지 후 복귀 시 한 프레임에 시간이 몰려
    // 캐릭터가 벽을 뚫는 것을 막는다. 0.1초 = 3프레임분.
    MAX_DELTA: 0.1,

    /* ── 캔버스 ────────────────────────────────────────── */

    // 캔버스 내부 해상도. 1080p 실시간 채우기는 부담이라 720p로 그리고 CSS로 확대한다.
    WIDTH: 1280,
    HEIGHT: 720,

    // devicePixelRatio를 곱하지 않는다. TV에서 backing store를 키우면 그대로 부하가 된다.
    IGNORE_DPR: true,

    // 오버스캔 대비 안전영역 비율. 구형 TV는 가장자리가 잘린다.
    SAFE_RATIO: 0.05,

    // 위 비율을 적용한 실제 안전영역 사각형. 모든 UI는 이 안쪽에 둔다.
    SAFE: { x: 64, y: 36, w: 1152, h: 648 },

    /* ── 그리기 예산 (프레임당) ──────────────────────────── */

    // drawImage 호출의 가중 합 상한. 아래 COST 가중치를 곱해서 더한다.
    SPRITE_BUDGET: 150,

    // 그리기 비용 가중치. 스케일·알파·회전은 기본 그리기보다 비싸다.
    COST: {
      PLAIN: 1,    // 원본 크기 그대로
      SCALED: 1.5, // 원근 스케일링 적용
      ALPHA: 2,    // globalAlpha < 1
      ROTATED: 2   // setTransform 회전
    },

    // 알파 블렌딩 스프라이트 동시 표시 상한. 위 예산과 별도로 건다.
    MAX_ALPHA_SPRITES: 60,

    // 파티클 동시 표시 상한. 특히 블록깨기 코인 연출.
    // 물리 계산이 아니라 미리 그린 스프라이트 시퀀스를 쓴다.
    MAX_PARTICLES: 24,

    // fillText 호출 상한. TV 브라우저는 폰트 래스터라이즈가 비싸다.
    // 반복 표시되는 글자는 오프스크린에 한 번 그려두고 blit 한다.
    MAX_FILLTEXT: 12,

    /* ── 오프스크린 프리렌더 ──────────────────────────────── */

    // 동시에 유지할 오프스크린 캔버스 개수와 한 장의 최대 변 길이.
    // 넘기면 TV 메모리를 밀어낸다.
    MAX_OFFSCREEN: 8,
    MAX_OFFSCREEN_SIDE: 1024,

    /* ── 금지 항목 ─────────────────────────────────────── */
    // 코드에서 이 플래그를 확인하고 분기하라는 뜻이 아니다.
    // 금지 사실을 한 곳에 적어두고, 나중에 해제할 일이 생기면 여기부터 고치기 위한 기록이다.

    ALLOW_SHADOW: false, // ctx.shadowBlur / shadowColor
    ALLOW_BLUR: false,   // ctx.filter, CSS filter: blur
    ALLOW_WEBGL: false,  // Three.js 포함. WebGL이 지원돼도 프레임이 안 나온다

    /* ── 배경 ─────────────────────────────────────────── */

    // 정지 배경은 한 장. 스크롤 배경은 타일 반복으로 처리한다.
    MAX_BG_LAYERS: 3,

    /* ── 계측 ─────────────────────────────────────────── */

    // fps 오버레이를 켜는 쿼리스트링 키. tv/index.html?fps=1
    FPS_QUERY_KEY: 'fps',

    // fps 표시 갱신 주기(ms). 매 프레임 갱신하면 숫자가 읽히지 않는다.
    FPS_SAMPLE_MS: 500
  };

  /**
   * 안전영역 사각형을 SAFE_RATIO로부터 다시 계산한다.
   * SAFE는 미리 적어둔 값이고, 이 함수는 비율을 바꿨을 때 쓰는 재계산용이다.
   */
  GP.config.recalcSafe = function () {
    var c = GP.config;
    var mx = Math.round(c.WIDTH * c.SAFE_RATIO);
    var my = Math.round(c.HEIGHT * c.SAFE_RATIO);
    c.SAFE = { x: mx, y: my, w: c.WIDTH - mx * 2, h: c.HEIGHT - my * 2 };
    return c.SAFE;
  };

})(window);
