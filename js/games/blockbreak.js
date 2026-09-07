/**
 * 블록깨기 (PROJECT.md 5-4)
 *
 * 앞선 셋과 달리 앉아서 하는 게임이다. 세션 중간의 쉬어가는 자리를 담당한다.
 * **로직 20%, 연출 80%.** 다만 TV 성능 한계 안에서 (phase1 예산이 상한).
 *
 * 조작은 두 가지뿐이다.
 *   기울여서 조준 — 기울기 연속값을 9칸에 매핑한다. 격자 경계에서 떨지 않게 히스테리시스를 건다
 *   쳐올려서 파괴 — 점프가 아니라 쳐올리기다
 *
 * **점프와 쳐올리기의 구분이 여기서 처음으로 실전 의미를 갖는다.**
 * 앉아서 하는 게임이라 자유낙하 구간이 안 생겨야 정상이고, 그러면 판정이 쳐올리기로 간다.
 * 서서 하면 점프로 새는지는 실기에서만 확인된다 (phase7 완료 기준).
 *
 * 감점은 최소화한다. 밥밥탄도 점수를 깎지 않고 **시간을 1초 줄인다** —
 * 5세는 숫자가 내려가는 순간 흥미를 잃는다 (PROJECT.md 10장).
 *
 * 문법 수준: ES5
 */
(function (global) {
  'use strict';

  var LP = global.LP;
  var C = LP.config;

  /* ── 튜닝 값 ────────────────────────────────────────── */
  var TUNE = {
    // 3×3. 조카가 조준을 어려워하면 2로 낮춘다 — 그때 고칠 곳이 여기 하나뿐이도록 상수로 뒀다.
    GRID:         3,

    HYST:         0.35,   // 격자 경계를 이만큼 넘어야 칸이 바뀐다 (칸 단위)
    REFILL_SEC:   0.45,   // 깨진 자리에 새 블록이 차는 시간

    MUSH_SEC:     5.0,    // 버섯: 점수 2배
    MUSH_MULT:    2,
    STAR_SEC:     3.0,    // 스타: 조준 없이 전부 파괴
    BOMB_TIME:    1.0,    // 밥밥탄: 시간 1초 차감. 점수는 건드리지 않는다

    SHAKE_SEC:    0.18,   // 화면 흔들림. 길면 5세가 화면을 못 읽는다
    SHAKE_PX:     9,

    COINS_PER_HIT: 3,     // 한 번 깰 때 튀는 코인 조각 수. 상한은 gfx가 다시 자른다

    // 블록이 나올 확률. 합이 1이 아니어도 된다 — 누적으로 고른다.
    WEIGHT: { coin: 0.60, empty: 0.13, mush: 0.08, star: 0.05, bomb: 0.14 }
  };

  var COLOR = {
    coin:  '#e0a63a',
    empty: '#6b7280',
    mush:  '#e0332c',
    star:  '#ffd23b',
    bomb:  '#2b2b36'
  };

  var api = null;
  var t = 0;
  var penalty = 0;        // 밥밥탄으로 깎인 시간(초)
  var cells = [];         // { type, brokenAt }
  var st = {};
  var parts = null;
  var shakeAt = -99;
  var rng = Math.random;

  function pid(m) { return m.from || 'p1'; }
  function count() { return TUNE.GRID * TUNE.GRID; }

  function state(id) {
    if (!st[id]) {
      st[id] = { cell: Math.floor(count() / 2), score: 0, mushUntil: -99, starUntil: -99,
                 hits: 0, punchAt: -99 };
    }
    return st[id];
  }

  function rollType() {
    var w = TUNE.WEIGHT;
    var total = 0, k;
    for (k in w) if (Object.prototype.hasOwnProperty.call(w, k)) total += w[k];
    var r = rng() * total;
    for (k in w) {
      if (!Object.prototype.hasOwnProperty.call(w, k)) continue;
      r -= w[k];
      if (r <= 0) return k;
    }
    return 'coin';
  }

  function fillGrid() {
    cells = [];
    for (var i = 0; i < count(); i++) cells.push({ type: rollType(), brokenAt: -99 });
  }

  function cellRect(i) {
    var S = C.SAFE;
    var g = TUNE.GRID;
    // 격자를 화면 위쪽에 둔다. 아래에는 캐릭터가 서서 쳐올려야 하므로 자리를 비워야 한다 —
    // 겹치면 무엇을 치는 중인지 안 보인다.
    var size = Math.min(S.w * 0.5, S.h * 0.60) / g;
    var x0 = C.WIDTH / 2 - size * g / 2;
    var y0 = C.HEIGHT * 0.40 - size * g / 2;
    return {
      x: x0 + (i % g) * size,
      y: y0 + Math.floor(i / g) * size,
      s: size
    };
  }

  function buildArt() {
    LP.gfx.sheet('bb-coin', 4, 30, 30, function (c2, i) {
      var w = 30 * (1 - i * 0.24);
      c2.fillStyle = '#ffd23b';
      c2.beginPath();
      c2.arc(15, 15, Math.max(w / 2, 3), 0, Math.PI * 2);
      c2.fill();
    });
  }

  /* ── 게임 ─────────────────────────────────────────── */

  var def = LP.games.register('blockbreak', {
    name: '블록깨기',
    motion: 'punch',
    load: 'low',           // 앉아서 한다. 힘든 게임 사이에 끼우는 자리
    color: '#d0913f',
    tune: TUNE,
    hint: '기울여서 고르고 위로 툭 쳐올리세요',
    duration: 90,
    par: 20,

    init: function (a) {
      api = a;
      t = 0;
      penalty = 0;
      st = {};
      shakeAt = -99;
      parts = new LP.gfx.Particles(C.MAX_PARTICLES);
      fillGrid();
      buildArt();
    },

    demo: function (ctx, tt, chr) {
      var i = Math.floor(tt * 1.5) % count();
      var r = cellRect(i);
      ctx.fillStyle = COLOR.coin;
      ctx.fillRect(r.x, r.y, r.s - 6, r.s - 6);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 6;
      ctx.strokeRect(r.x - 4, r.y - 4, r.s + 2, r.s + 2);
      LP.chars.draw(ctx, chr, C.WIDTH / 2, C.HEIGHT * 0.94, 260,
                    (tt % 1.2) < 0.35 ? 'punch' : 'idle');
    },

    update: function (dt) {
      t += dt;
      parts.update(dt);

      // 깨진 자리를 다시 채운다. 빈 격자를 오래 두면 조준할 곳이 없어진다.
      for (var i = 0; i < cells.length; i++) {
        if (cells[i].type === null && t - cells[i].brokenAt >= TUNE.REFILL_SEC) {
          cells[i].type = rollType();
        }
      }

      // 밥밥탄에 깎인 시간만큼 일찍 끝난다. 셸의 90초 타이머보다 먼저 끝내는 것이다.
      if (t + penalty >= def.duration && api.end) api.end();
    },

    /** 기울기 → 9칸. 경계에서 커서가 떨면 조준이 안 된다. */
    onTilt: function (m) {
      var s = state(pid(m));
      var n = count();
      var raw = ((m.v || 0) + 1) / 2 * n;      // 0 ~ n
      if (raw < 0) raw = 0;
      if (raw > n - 0.001) raw = n - 0.001;

      // 지금 칸의 양쪽으로 HYST만큼의 여유를 준다. 그 안에서는 안 움직인다.
      if (raw < s.cell - TUNE.HYST || raw > s.cell + 1 + TUNE.HYST) {
        s.cell = Math.floor(raw);
      }
    },

    onMotion: function (m) {
      if (m.a !== 'punch') return;             // 점프가 아니라 쳐올리기다
      var id = pid(m);
      var s = state(id);
      s.hits++;
      s.punchAt = t;
      shakeAt = t;

      // 스타 중에는 조준이 필요 없다. 격자를 통째로 턴다.
      if (t < s.starUntil) {
        for (var i = 0; i < cells.length; i++) {
          if (cells[i].type && cells[i].type !== 'bomb') hit(id, i, true);
        }
        if (api.fx) api.fx('star', id);
        return;
      }

      hit(id, s.cell, false);
    },

    getScore: function () {
      var players = api ? api.players : [];
      var out = [];
      for (var i = 0; i < players.length; i++) {
        out.push({ from: players[i].id, score: state(players[i].id).score });
      }
      return out;
    },

    render: function (ctx) {
      var S = C.SAFE;
      var players = api ? api.players : [];
      var s0 = players.length ? state(players[0].id) : null;

      var sh = LP.gfx.shake(t - shakeAt, TUNE.SHAKE_SEC, TUNE.SHAKE_PX);

      // 스타 중에는 배경을 밝게 바꾼다. 그림이 있어도 그 위에 얇게 덮는다 —
      // 스타가 걸린 걸 화면 전체로 알리는 것이 이 게임의 핵심 연출이다.
      var starOn = s0 && t < s0.starUntil;
      if (!LP.assets || !LP.assets.bg(ctx, 'blockbreak', C.WIDTH, C.HEIGHT)) {
        ctx.fillStyle = starOn ? '#3a2f10' : '#182034';
        ctx.fillRect(0, 0, C.WIDTH, C.HEIGHT);
      } else if (starOn) {
        ctx.fillStyle = 'rgba(255,210,59,0.22)';
        ctx.fillRect(0, 0, C.WIDTH, C.HEIGHT);
      }

      ctx.save();
      ctx.translate(sh.x, sh.y);

      for (var i = 0; i < cells.length; i++) {
        var r = cellRect(i);
        var c = cells[i];
        if (c.type === null) {
          ctx.fillStyle = '#0d1425';
          ctx.fillRect(r.x, r.y, r.s - 8, r.s - 8);
          continue;
        }
        ctx.fillStyle = COLOR[c.type] || COLOR.coin;
        ctx.fillRect(r.x, r.y, r.s - 8, r.s - 8);

        // 물음표 블록의 그 무늬. 종류는 깨야 알 수 있어야 재미가 있다.
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(r.x + 10, r.y + 10, r.s - 28, r.s - 28);
      }

      // 조준 커서. 사람마다 하나씩, 캐릭터 모자 색으로 구분한다.
      // 여럿이 같은 칸을 노리면 테두리가 겹치므로 사람 순서만큼 안쪽으로 들여 그린다.
      for (var ci = 0; ci < players.length; ci++) {
        var cs = state(players[ci].id);
        var cr = cellRect(cs.cell % count());
        var ch = LP.chars.byId[players[ci]['char']];
        var inset = ci * 9;
        ctx.strokeStyle = t < cs.starUntil ? '#ffd23b'
                        : (players.length > 1 && ch ? ch.cap : '#ffffff');
        ctx.lineWidth = 8;
        ctx.strokeRect(cr.x - 5 + inset, cr.y - 5 + inset,
                       cr.s - inset * 2, cr.s - inset * 2);
      }

      parts.render(ctx);

      for (var p = 0; p < players.length; p++) {
        var ps = state(players[p].id);
        LP.chars.draw(ctx, players[p]['char'],
                      C.WIDTH / 2 + (p - (players.length - 1) / 2) * 260,
                      C.HEIGHT - S.y, players.length > 2 ? 170 : 200,
                      (t - ps.punchAt) < 0.2 ? 'punch' : 'idle');
      }

      ctx.restore();
      drawHud(ctx, players);
    }
  });

  /** 칸 하나를 깬다. quiet면 소리를 내지 않는다 (스타로 한꺼번에 깰 때). */
  function hit(id, i, quiet) {
    var s = state(id);
    var c = cells[i];
    if (!c || c.type === null) return;

    var type = c.type;
    var r = cellRect(i);
    c.type = null;
    c.brokenAt = t;

    var mult = t < s.mushUntil ? TUNE.MUSH_MULT : 1;

    if (type === 'coin') {
      s.score += 1 * mult;
      popCoins(r);
      if (!quiet && api.fx) api.fx('coin', id);
    } else if (type === 'mush') {
      s.mushUntil = t + TUNE.MUSH_SEC;
      s.score += 1 * mult;
      popCoins(r);
      if (!quiet && api.fx) api.fx('mush', id);
    } else if (type === 'star') {
      s.starUntil = t + TUNE.STAR_SEC;
      if (!quiet && api.fx) api.fx('star', id);
    } else if (type === 'bomb') {
      // 점수가 아니라 시간을 깎는다. 마이너스 숫자를 보여주지 않는 것이 핵심이다.
      penalty += TUNE.BOMB_TIME;
      if (!quiet && api.fx) api.fx('bomb', id);
    } else {
      if (!quiet && api.fx) api.fx('dud', id);      // 빈 블록. 소리만 난다
    }
  }

  /** 코인 조각. 개수는 상수로 박고, 풀이 다시 한 번 자른다 (PROJECT.md 2장). */
  function popCoins(r) {
    for (var i = 0; i < TUNE.COINS_PER_HIT; i++) {
      parts.spawn(r.x + r.s / 2, r.y + r.s / 2,
                  (Math.random() - 0.5) * 260, -240 - Math.random() * 160,
                  0.9, 'bb-coin');
    }
  }

  function drawHud(ctx, players) {
    var S = C.SAFE;
    var s0 = players.length ? state(players[0].id) : null;

    // 점수는 사람마다. 혼자면 큰 숫자 하나, 여럿이면 캐릭터 색으로 나란히.
    ctx.textAlign = 'left';
    if (players.length <= 1) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 52px sans-serif';
      ctx.fillText(String(s0 ? s0.score : 0), S.x, S.y + 56);
    } else {
      ctx.font = 'bold 38px sans-serif';
      for (var i = 0; i < players.length && i < 4; i++) {
        var ch = LP.chars.byId[players[i]['char']];
        ctx.fillStyle = (ch && ch.cap) || '#ffffff';
        ctx.fillText(String(state(players[i].id).score), S.x + i * 90, S.y + 56);
      }
    }

    if (s0 && t < s0.mushUntil) {
      ctx.fillStyle = '#ff6b6b';
      ctx.font = 'bold 34px sans-serif';
      ctx.fillText('2배!', S.x + 120, S.y + 56);
    }
    if (s0 && t < s0.starUntil) {
      ctx.fillStyle = '#ffd23b';
      ctx.font = 'bold 34px sans-serif';
      ctx.fillText('스타!', S.x + 210, S.y + 56);
    }

    var left = Math.max(0, 1 - (t + penalty) / def.duration);
    var bw = S.w * 0.3;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(C.WIDTH - S.x - bw, S.y + 24, bw, 20);
    ctx.fillStyle = left > 0.25 ? '#ffffff' : '#ff6b6b';
    ctx.fillRect(C.WIDTH - S.x - bw, S.y + 24, bw * left, 20);
  }

  def._test = {
    TUNE: TUNE,
    cells: function () { return cells; },
    state: state,
    penalty: function () { return penalty; },
    setRng: function (fn) { rng = fn || Math.random; },
    setCell: function (i, type) { cells[i] = { type: type, brokenAt: -99 }; },
    fill: fillGrid,
    parts: function () { return parts; },
    now: function () { return t; }
  };

})(window);
