/**
 * Game-Party fps 오버레이 + 그리기 예산 계측
 *
 * TV 내장 브라우저에는 개발자도구가 없다. console.log는 볼 수 없다.
 * 따라서 모든 진단은 화면에 그린다.
 *
 * 사용법:
 *   GP.fps.init(ctx);              // 게임 루프 시작 전 1회. ctx의 drawImage/fillText를 감싼다
 *   GP.fps.frameStart();           // 매 프레임 맨 앞
 *   ... 게임 update / render ...
 *   GP.fps.frameEnd();             // 렌더 직후
 *   GP.fps.draw(ctx);              // 오버레이를 맨 위에 그린다
 *
 * 켜는 방법: 주소 뒤에 ?fps=1
 * 꺼져 있으면 계측도 래핑도 하지 않는다. 평상시 부하 0.
 *
 * 문법 수준: ES5 (js/config.js와 동일한 이유)
 */
(function (global) {
  'use strict';

  var GP = global.GP || (global.GP = {});
  var C = GP.config;

  // ?fps=1 판정. URLSearchParams는 구형 webOS에 없을 수 있어 직접 파싱한다.
  function queryOn(key) {
    var q = global.location && global.location.search;
    if (!q) return false;
    var parts = q.replace(/^\?/, '').split('&');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (kv[0] === key) return kv[1] !== '0';
    }
    return false;
  }

  var fps = {
    enabled: false,

    // 최근 표시값
    value: 0,          // 표시 중인 fps
    frameMs: 0,        // 최근 프레임 소요 시간(ms)
    worstMs: 0,        // 최근 구간의 최악 프레임(ms)
    sprites: 0,        // 직전 프레임의 가중 그리기 비용
    spritesRaw: 0,     // 직전 프레임의 drawImage 호출 수
    texts: 0,          // 직전 프레임의 fillText 호출 수
    overBudget: 0,     // 예산 초과 프레임 누적 수

    _frames: 0,
    _accum: 0,
    _t0: 0,
    _lastSample: 0,
    _curSprites: 0,
    _curRaw: 0,
    _curTexts: 0,
    _worstAccum: 0,

    // 리셋 직후 몇 프레임은 예산 초과로 세지 않는다.
    // 페이지 로드·화면 전환 직후의 첫 프레임은 항상 느리다. 이걸 세면 테두리가 항상 붉다.
    _warm: 0
  };

  var WARMUP_FRAMES = 5;

  function now() {
    return (global.performance && global.performance.now)
      ? global.performance.now()
      : new Date().getTime();
  }

  /**
   * ctx의 drawImage / fillText를 감싸 호출 수를 센다.
   * 가중치는 현재 변환 행렬과 globalAlpha를 보고 추정한다.
   */
  function wrap(ctx) {
    var origDraw = ctx.drawImage;
    var origText = ctx.fillText;

    ctx.drawImage = function () {
      fps._curRaw++;
      var cost = C.COST.PLAIN;

      // 인자 9개 = 소스/대상 크기를 따로 준 경우. 스케일링으로 본다.
      if (arguments.length >= 8) cost = C.COST.SCALED;
      if (this.globalAlpha < 1) cost = Math.max(cost, C.COST.ALPHA);

      fps._curSprites += cost;
      return origDraw.apply(this, arguments);
    };

    ctx.fillText = function () {
      fps._curTexts++;
      return origText.apply(this, arguments);
    };
  }

  /**
   * 계측 시작. ?fps=1이 없으면 아무것도 하지 않는다.
   * force를 true로 주면 쿼리스트링과 무관하게 켠다 (tv-bench 전용).
   */
  fps.init = function (ctx, force) {
    fps.enabled = force === true || queryOn(C.FPS_QUERY_KEY);
    if (!fps.enabled) return false;
    if (ctx) wrap(ctx);
    fps._lastSample = now();
    fps._warm = WARMUP_FRAMES;
    return true;
  };

  fps.frameStart = function () {
    if (!fps.enabled) return;
    fps._t0 = now();
    fps._curSprites = 0;
    fps._curRaw = 0;
    fps._curTexts = 0;
  };

  fps.frameEnd = function () {
    if (!fps.enabled) return;
    var t = now();
    var ms = t - fps._t0;

    fps.frameMs = ms;
    fps.sprites = fps._curSprites;
    fps.spritesRaw = fps._curRaw;
    fps.texts = fps._curTexts;

    if (fps._warm > 0) {
      fps._warm--;
    } else {
      if (ms > fps._worstAccum) fps._worstAccum = ms;
      if (ms > C.WARN_FRAME_MS) fps.overBudget++;
    }

    fps._frames++;
    fps._accum += ms;

    // 매 프레임 숫자가 바뀌면 TV 화면에서 읽히지 않는다. 0.5초마다 갱신.
    if (t - fps._lastSample >= C.FPS_SAMPLE_MS) {
      var span = (t - fps._lastSample) / 1000;
      fps.value = Math.round(fps._frames / span);
      fps.worstMs = Math.round(fps._worstAccum);
      fps._frames = 0;
      fps._accum = 0;
      fps._worstAccum = 0;
      fps._lastSample = t;
    }
  };

  /**
   * 오버레이를 그린다. 게임 렌더가 전부 끝난 뒤 마지막에 호출한다.
   * 그림자·블러를 쓰지 않는다. 오버레이 자신이 예산을 먹으면 계측이 무의미해진다.
   */
  fps.draw = function (ctx) {
    if (!fps.enabled) return;

    var w = 300;
    var h = 118;

    // 안전영역 우측 상단. 좌측 상단은 게임 HUD와 진단 텍스트 자리라 겹친다.
    var x = C.WIDTH - C.SAFE.x - w;
    var y = C.SAFE.y;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;

    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(x, y, w, h);

    // 예산을 넘긴 프레임이 있으면 테두리를 붉게 — 화면만 보고 알 수 있어야 한다.
    ctx.lineWidth = 3;
    ctx.strokeStyle = fps.overBudget > 0 ? '#ff3b3b' : '#3bff7a';
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);

    ctx.font = 'bold 34px monospace';
    ctx.textBaseline = 'top';
    ctx.fillStyle = fps.value >= C.TARGET_FPS ? '#3bff7a' : '#ffd23b';
    ctx.fillText(fps.value + ' fps', x + 12, y + 8);

    ctx.font = '18px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('frame ' + fps.frameMs.toFixed(1) + 'ms  worst ' + fps.worstMs + 'ms', x + 12, y + 48);
    ctx.fillText('draw ' + fps.spritesRaw + '  cost ' + Math.round(fps.sprites) + '/' + C.SPRITE_BUDGET, x + 12, y + 70);
    ctx.fillText('text ' + fps.texts + '/' + C.MAX_FILLTEXT + '  over ' + fps.overBudget, x + 12, y + 92);

    // 예산 초과는 콘솔이 아니라 화면에 띄운다.
    if (fps.sprites > C.SPRITE_BUDGET) {
      ctx.fillStyle = '#ff3b3b';
      ctx.font = 'bold 26px monospace';
      ctx.fillText('SPRITE BUDGET OVER', x + 12, y + h + 8);
    }

    ctx.restore();
  };

  /** 누적 통계 초기화. 벤치에서 항목을 바꿀 때 쓴다. */
  fps.reset = function () {
    fps.overBudget = 0;
    fps.worstMs = 0;
    fps._worstAccum = 0;
    fps._frames = 0;
    fps._lastSample = now();
    fps._warm = WARMUP_FRAMES;
  };

  GP.fps = fps;

})(window);
