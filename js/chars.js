/**
 * L-Party 캐릭터 정의 + 임시 스프라이트
 *
 * 주인공은 M 대신 L 마크가 있는 빨간 모자 + 멜빵 캐릭터 (PROJECT.md 3장).
 * 그 외는 원작 캐릭터. 집에서만 쓰는 전제이며, 외부 공개 시 전부 교체해야 한다.
 *
 * 여기 그리는 것은 전부 임시 도형이다. 실제 2.5D 스프라이트가 나오면 draw()만 갈아끼운다.
 * 에셋이 없다고 셸 개발을 멈추지 않기 위한 자리.
 *
 * 문법 수준: ES5
 */
(function (global) {
  'use strict';

  var LP = global.LP || (global.LP = {});

  var LIST = [
    { id: 'lhat',   name: 'L모자',   mark: 'L', cap: '#e0332c', body: '#2f6fd0' },
    { id: 'mario',  name: '마리오',  mark: 'M', cap: '#e0332c', body: '#2f6fd0' },
    { id: 'luigi',  name: '루이지',  mark: 'L', cap: '#2fa04a', body: '#2f6fd0' },
    { id: 'peach',  name: '공주',    mark: 'P', cap: '#f2b6d0', body: '#e86ea6' },
    { id: 'bowser', name: '쿠파',    mark: 'B', cap: '#e2a020', body: '#3f8f3a' },
    { id: 'toad',   name: '키노피오', mark: 'T', cap: '#ffffff', body: '#e0332c' }
  ];

  var byId = {};
  var byIndex = {};
  for (var i = 0; i < LIST.length; i++) {
    byId[LIST[i].id] = LIST[i];
    byIndex[LIST[i].id] = i;
  }

  /* 모자 마크 프리렌더.
     모든 화면이 쓰는 것이라 게임 시트와 자리를 다투면 안 된다 — pin으로 고정한다. */
  var MARK_KEY = 'chars-mark';
  var MARK_PX = 64;

  function buildMarks() {
    if (!LP.gfx || LP.gfx.has(MARK_KEY)) return;
    LP.gfx.sheet(MARK_KEY, LIST.length, MARK_PX, MARK_PX, function (c2, i) {
      var c = LIST[i];
      c2.fillStyle = '#ffffff';
      c2.beginPath();
      c2.arc(MARK_PX / 2, MARK_PX / 2, MARK_PX / 2 - 2, 0, Math.PI * 2);
      c2.fill();
      c2.fillStyle = c.cap;
      c2.font = 'bold ' + Math.round(MARK_PX * 0.62) + 'px monospace';
      c2.textAlign = 'center';
      c2.textBaseline = 'middle';
      c2.fillText(c.mark, MARK_PX / 2, MARK_PX / 2 + 2);
    }, true);
  }

  /**
   * 캐릭터 하나를 그린다. 발밑 중앙이 (x, y)다.
   * h = 키(픽셀). 원근 스케일링은 호출부에서 h로 준다.
   * pose = 'idle' | 'jump' | 'squat' | 'punch'
   */
  function draw(ctx, id, x, y, h, pose) {
    var c = byId[id] || LIST[0];

    // 진짜 스프라이트가 있으면 그것으로 끝. 없으면 아래 도형으로 내려간다.
    // 캐릭터 하나만 그림이 준비돼도 그 캐릭터만 바뀐다 (js/assets-manifest.js).
    if (LP.assets && LP.assets.charFrame(ctx, c.id, pose || 'idle', x, y, h)) return;

    var w = h * 0.6;
    var headH = h * 0.34;
    var legLift = 0;
    var squat = 0;
    var armUp = 0;

    if (pose === 'jump') legLift = h * 0.12;
    else if (pose === 'squat') squat = h * 0.22;
    else if (pose === 'punch') armUp = h * 0.28;

    var top = y - h + squat + -legLift;

    // 몸통
    ctx.fillStyle = c.body;
    ctx.fillRect(x - w / 2, top + headH, w, h - headH - squat);

    // 멜빵
    ctx.fillStyle = '#1b3f7a';
    ctx.fillRect(x - w * 0.28, top + headH, w * 0.1, h - headH - squat);
    ctx.fillRect(x + w * 0.18, top + headH, w * 0.1, h - headH - squat);

    // 머리
    ctx.fillStyle = '#f0c090';
    ctx.fillRect(x - w * 0.42, top + headH * 0.45, w * 0.84, headH * 0.6);

    // 모자
    ctx.fillStyle = c.cap;
    ctx.fillRect(x - w * 0.5, top, w, headH * 0.5);

    // 모자 마크. 미리 그려둔 것을 blit 한다.
    // 매번 fillText로 그리면 캐릭터 수만큼 글자 예산을 먹는다 —
    // 네 명이 나오는 화면에서 그것만으로 상한(MAX_FILLTEXT)의 3분의 1이 날아간다 (phase1).
    if (LP.gfx) {
      buildMarks();
      LP.gfx.blit(ctx, MARK_KEY, byIndex[c.id], x, top + headH * 0.25, headH * 0.36 / MARK_PX);
    } else {
      // 폰 페이지는 gfx를 싣지 않는다. 캐릭터를 그릴 일도 거의 없으니 그때만 직접 그린다.
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, top + headH * 0.25, headH * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c.cap;
      ctx.font = 'bold ' + Math.round(headH * 0.28) + 'px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.mark, x, top + headH * 0.27);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }

    // 팔. 쳐올리기 자세에서 위로 올린다
    ctx.fillStyle = '#f0c090';
    ctx.fillRect(x - w * 0.62, top + headH * 1.1 - armUp, w * 0.14, h * 0.22);
    ctx.fillRect(x + w * 0.48, top + headH * 1.1 - armUp, w * 0.14, h * 0.22);
  }

  LP.chars = { list: LIST, byId: byId, draw: draw };

})(window);
