/**
 * 세션 보드 (PROJECT.md 12장 — 점수 합산 구조 결정)
 *
 * 5판을 하나의 파티로 묶는 장치다. 한 판이 끝나면 그 결과만큼 말이 보드를 돈다.
 *
 * **결정: 마리오파티식 보드.** 누적 단순 합산 대신 이쪽을 고른 이유는,
 * 게임마다 점수 단위가 다르기 때문이다(줄넘기 개수 / 로프 칸 / 해머 초 / 블록 점수).
 * 그걸 그냥 더하면 해머 90점과 줄넘기 12개가 같은 저울에 올라간다.
 * 보드는 판 결과를 **칸 수**라는 하나의 단위로 바꿔서 저울을 통일한다.
 *
 * 5세를 위해 지킨 규칙 두 가지.
 *
 *   1. **뒤로 가는 칸은 없다.** 쿠파 칸은 그 자리에서 멈출 뿐 되돌리지 않는다.
 *      마이너스가 뜨는 순간 흥미를 잃는다 (PROJECT.md 10장).
 *   2. **별 칸은 지나가기만 해도 하나를 준다.** 정확히 밟으면 둘.
 *      "한 칸 차이로 못 받았다"는 5세에게 설명되지 않는 억울함이다.
 *
 * 보드는 원형이다. 한 바퀴를 돌면 다시 출발 칸으로 온다 — 끝나는 지점이 없어야
 * 판 수를 바꿔도 보드를 다시 만들 필요가 없다.
 *
 * 문법 수준: ES5
 */
(function (global) {
  'use strict';

  var LP = global.LP || (global.LP = {});

  var TUNE = {
    CELLS: 24,              // 한 바퀴. 5판이면 대략 한 바퀴 남짓 돈다

    // 순위별 기본 이동 칸. 꼴등도 2칸은 간다 — 0칸은 "너는 안 움직인다"는 뜻이 된다.
    RANK_STEPS: [6, 4, 3, 2],

    // 게임이 선언한 par 대비 보너스. 혼자 놀 때도 잘하면 더 가게 하는 장치다.
    PAR_BONUS: 2,           // par 이상
    HALF_BONUS: 1,          // par 절반 이상

    STAR_PASS: 1,           // 별 칸을 지나가면
    STAR_LAND: 1            // 정확히 밟으면 추가로 (합계 2)
  };

  // 칸 종류. 나머지는 전부 평범한 칸이다.
  var STARS = [3, 9, 15, 21];
  var BOWSERS = [6, 14, 19];

  var types = [];
  (function buildTypes() {
    var i;
    for (i = 0; i < TUNE.CELLS; i++) types.push('plain');
    for (i = 0; i < STARS.length; i++) types[STARS[i]] = 'star';
    for (i = 0; i < BOWSERS.length; i++) types[BOWSERS[i]] = 'bowser';
    types[0] = 'start';
  })();

  /**
   * 판 결과를 이동 칸 수로 바꾼다.
   *
   *   rank   0부터. 공동 순위면 같은 값을 넘긴다
   *   score  그 판 점수
   *   par    게임이 선언한 "잘한 편" 기준. 없으면 보너스 없음
   */
  function stepsFor(rank, score, par) {
    var base = TUNE.RANK_STEPS[Math.min(rank, TUNE.RANK_STEPS.length - 1)];
    if (!par) return base;
    if (score >= par) return base + TUNE.PAR_BONUS;
    if (score >= par / 2) return base + TUNE.HALF_BONUS;
    return base;
  }

  /**
   * 점수 목록을 순위로 바꾼다. 동점은 같은 순위다.
   * 입력: [{ from, score }] → 출력: { from: rank }
   */
  function ranks(scores) {
    var sorted = scores.slice().sort(function (a, b) { return b.score - a.score; });
    var out = {};
    var rank = 0;
    for (var i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i].score < sorted[i - 1].score) rank = i;
      out[sorted[i].from] = rank;
    }
    return out;
  }

  /**
   * 말을 n칸 옮긴다. piece = { pos, stars }.
   * 실제로 지나간 칸과 일어난 일을 순서대로 돌려준다 — 화면이 그걸 한 칸씩 재생한다.
   */
  function advance(piece, n) {
    var events = [];
    var moved = 0;

    for (var i = 1; i <= n; i++) {
      piece.pos = (piece.pos + 1) % TUNE.CELLS;
      moved++;
      var kind = types[piece.pos];

      if (kind === 'star') {
        piece.stars += TUNE.STAR_PASS;
        events.push({ at: piece.pos, kind: 'star', stars: TUNE.STAR_PASS });
      }

      // 쿠파 칸을 지나가려 하면 거기서 멈춘다. 뒤로 보내지는 않는다.
      if (kind === 'bowser' && i < n) {
        events.push({ at: piece.pos, kind: 'stop' });
        break;
      }
    }

    // 정확히 별 칸에 멈추면 하나 더. 보너스만 있고 벌은 없다.
    if (types[piece.pos] === 'star') {
      piece.stars += TUNE.STAR_LAND;
      events.push({ at: piece.pos, kind: 'starLand', stars: TUNE.STAR_LAND });
    }

    piece.steps = (piece.steps || 0) + moved;
    return events;
  }

  /**
   * 최종 순위. 별이 먼저, 같으면 더 많이 간 쪽.
   * 완전히 같으면 공동 1등이다 — 꼴등을 만들지 않는다 (PROJECT.md 6장).
   */
  function standings(pieces) {
    var list = [];
    for (var id in pieces) {
      if (!Object.prototype.hasOwnProperty.call(pieces, id)) continue;
      list.push({ from: id, stars: pieces[id].stars, steps: pieces[id].steps || 0 });
    }
    list.sort(function (a, b) {
      if (b.stars !== a.stars) return b.stars - a.stars;
      return b.steps - a.steps;
    });
    var rank = 0;
    for (var i = 0; i < list.length; i++) {
      if (i > 0 && (list[i].stars !== list[i - 1].stars || list[i].steps !== list[i - 1].steps)) {
        rank = i;
      }
      list[i].rank = rank;
    }
    return list;
  }

  /**
   * 칸의 화면 좌표. 안전영역 안쪽 사각 고리에 균등 배치한다.
   * 위 8 · 오른쪽 4 · 아래 8 · 왼쪽 4 = 24.
   */
  function layout(rect) {
    var top = 8, side = 4;
    var pts = [];
    var i;

    var x0 = rect.x, y0 = rect.y, w = rect.w, h = rect.h;

    for (i = 0; i < top; i++) pts.push({ x: x0 + w * i / top, y: y0 });
    for (i = 0; i < side; i++) pts.push({ x: x0 + w, y: y0 + h * i / side });
    for (i = 0; i < top; i++) pts.push({ x: x0 + w - w * i / top, y: y0 + h });
    for (i = 0; i < side; i++) pts.push({ x: x0, y: y0 + h - h * i / side });

    for (i = 0; i < pts.length; i++) pts[i].type = types[i];
    return pts;
  }

  LP.board = {
    TUNE: TUNE,
    types: types,
    stepsFor: stepsFor,
    ranks: ranks,
    advance: advance,
    standings: standings,
    layout: layout,
    newPiece: function () { return { pos: 0, stars: 0, steps: 0 }; }
  };

})(window);
