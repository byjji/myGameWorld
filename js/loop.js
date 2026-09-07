/**
 * L-Party 게임 루프
 *
 * deltaTime 기반. 30fps 기준으로 설계하되 프레임 수를 전제하지 않는다 (PROJECT.md 2장).
 * fps 오버레이(js/fps.js) 호출을 여기서 한 번만 한다. 게임이 신경 쓸 필요 없다.
 *
 * 문법 수준: ES5
 */
(function (global) {
  'use strict';

  var LP = global.LP || (global.LP = {});
  var C = LP.config;

  var running = false;
  var rafId = 0;
  var last = 0;
  var cur = null;

  /**
   * opts = {
   *   ctx:    캔버스 2D 컨텍스트
   *   update: function(dt)   dt는 초 단위, MAX_DELTA로 잘린다
   *   render: function(ctx)
   * }
   */
  LP.loop = {

    start: function (opts) {
      LP.loop.stop();
      cur = opts;
      last = 0;
      running = true;

      // 계측은 한 번만 붙인다. 두 번 감싸면 호출 수가 배로 세진다.
      if (!LP.loop._metered) {
        LP.fps.init(opts.ctx);
        LP.loop._metered = true;
      }

      rafId = global.requestAnimationFrame(frame);
      return LP.loop;
    },

    stop: function () {
      running = false;
      if (rafId) global.cancelAnimationFrame(rafId);
      rafId = 0;
      return LP.loop;
    },

    /** 루프를 멈추지 않고 update/render만 갈아끼운다. 화면 전환에 쓴다. */
    swap: function (opts) {
      cur = opts;
      return LP.loop;
    },

    isRunning: function () { return running; },

    _metered: false
  };

  function frame(ts) {
    if (!running) return;

    // 탭 전환·정지 후 복귀 시 한 프레임에 시간이 몰린다. 잘라내지 않으면 캐릭터가 벽을 뚫는다.
    var dt = last ? Math.min((ts - last) / 1000, C.MAX_DELTA) : 0;
    last = ts;

    LP.fps.frameStart();

    if (cur) {
      if (cur.update) cur.update(dt);
      if (cur.render) cur.render(cur.ctx);
    }

    LP.fps.frameEnd();
    LP.fps.draw(cur ? cur.ctx : null);

    rafId = global.requestAnimationFrame(frame);
  }

})(window);
