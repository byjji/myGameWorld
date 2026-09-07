/**
 * 로프 클라이밍 (PROJECT.md 5-2)
 *
 * 두 번째 미니게임이자 NPC 경쟁 구조가 처음 들어오는 자리다.
 *
 * 지켜야 하는 인과가 하나 있다. **앉았다 일어나면 올라간다.**
 * 스쿼트 한 번에 정확히 한 칸이 올라가고, 화면이 그만큼 내려온다.
 * 이게 어긋나면 5세는 자기가 무엇을 해서 올라갔는지 알 수 없다.
 *
 * 높이는 스쿼트 25회. 5세가 쉬지 않고 가능한 것이 20~30회다.
 * 리듬이 일정하면 콤보로 한 번에 더 올라가므로 실제로는 그보다 적게 든다 —
 * 힘들어하면 콤보 폭(COMBO_BONUS)을 키워서 실질 횟수를 줄인다.
 *
 * 배경은 세로로 흐르지만 타일을 blit 하지 않는다. 가로줄(fillRect)로 그린다.
 * drawImage를 쓰지 않으므로 phase1 예산에 잡히지 않는다.
 *
 * 문법 수준: ES5
 */
(function (global) {
  'use strict';

  var LP = global.LP;
  var C = LP.config;

  /* ── 튜닝 값 ────────────────────────────────────────── */
  var TUNE = {
    HEIGHT:        25,     // 정상까지의 칸 수 = 스쿼트 횟수 (PROJECT.md 5-2)
    STEP_PX:       92,     // 한 칸의 화면 높이

    // 콤보 한 단계당 더 오르는 칸. 기본값은 작게 잡았다 —
    // 콤보는 "리듬을 타면 조금 이득"이지 25회를 15회로 만드는 장치가 아니다.
    // 조카가 25회를 못 채우고 지치면 그때 이 값을 키워 실질 횟수를 줄인다 (phase5 검증 방법).
    COMBO_BONUS:   0.08,
    COMBO_MAX:     5,      // 콤보 상한
    RHYTHM_TOL:    0.45,   // 이 정도 안에서 일정하면 리듬으로 인정(초)
    RHYTHM_MAX:    3.0,    // 이보다 느리면 리듬이 끊긴 것으로 본다(초)

    COIN_AT:       [4, 9, 13, 17, 21, 24],   // 코인이 걸린 칸
    COIN_SCORE:    1,

    BOMB_EVERY:    7.0,    // 쿠파가 밥밥탄을 던지는 주기(초)
    BOMB_FALL:     6.0,    // 낙하 속도(칸/초)
    BOMB_FROM:     7,      // 머리 위 몇 칸에서 떨어지는가
    FREEZE_SEC:    0.5,    // 맞으면 멈추는 시간. 점수는 깎지 않는다 (PROJECT.md 5-2)

    LANES:         4       // 주인공 + 마리오 · 공주 · 쿠파
  };

  var api = null;
  var t = 0;
  var st = {};            // playerId -> 사람 상태
  var npcs = [];          // { char, racer }
  var bombs = [];
  var nextBomb = TUNE.BOMB_EVERY;
  var lanes = [];         // 화면 왼쪽부터의 레인 목록 { kind:'human'|'npc', id|idx, char }
  var meter = null;
  var finishedAt = 0;

  function pid(m) { return m.from || 'p1'; }

  function human(id) {
    if (!st[id]) {
      st[id] = {
        climbed: 0, coins: 0, combo: 0, bestCombo: 0,
        hasPrev: false, lastSquatAt: -99, avgIv: 0, frozenUntil: -99,
        nextCoin: 0, finished: 0
      };
    }
    return st[id];
  }

  function progress(id) { return Math.min(human(id).climbed / TUNE.HEIGHT, 1); }

  /** 화면에서 가장 앞선 사람. 쿠파가 누구를 노릴지 정할 때 쓴다. */
  function leader() {
    var bestId = null, bestV = -1;
    for (var i = 0; i < lanes.length; i++) {
      if (lanes[i].kind !== 'human') continue;
      var v = human(lanes[i].id).climbed;
      if (v > bestV) { bestV = v; bestId = lanes[i].id; }
    }
    return bestId;
  }

  /* ── 레인 배치 ─────────────────────────────────────────
     사람 먼저, 남는 자리를 NPC로 채운다. 쿠파는 반드시 들어간다 —
     페이스메이커가 없으면 경주가 성립하지 않는다 (PROJECT.md 6장). */

  function buildLanes() {
    var players = api ? api.players : [];
    lanes = [];
    npcs = [];

    var taken = {};
    var i;
    for (i = 0; i < players.length && lanes.length < TUNE.LANES; i++) {
      lanes.push({ kind: 'human', id: players[i].id, 'char': players[i]['char'] });
      taken[players[i]['char']] = true;
    }

    // 쿠파가 우선. 그다음 마리오, 공주 순으로 빈 자리를 메운다.
    var pool = ['bowser', 'mario', 'peach', 'toad'];
    for (i = 0; i < pool.length && lanes.length < TUNE.LANES; i++) {
      if (taken[pool[i]]) continue;
      var racer = new LP.npc.Racer({
        pacer: pool[i] === 'bowser',
        unit: 1 / TUNE.HEIGHT           // 스쿼트 한 번 = 1/HEIGHT 만큼의 진행도
      });
      npcs.push({ 'char': pool[i], racer: racer });
      lanes.push({ kind: 'npc', idx: npcs.length - 1, 'char': pool[i] });
    }
  }

  /* ── 프리렌더 ─────────────────────────────────────── */

  function buildArt() {
    LP.gfx.sheet('rc-coin', 4, 44, 44, function (c2, i) {
      var w = 44 * (1 - i * 0.22);              // 도는 것처럼 폭만 줄인다
      c2.fillStyle = '#ffd23b';
      c2.beginPath();
      c2.ellipse ? c2.ellipse(22, 22, Math.max(w / 2, 3), 20, 0, 0, Math.PI * 2)
                 : c2.arc(22, 22, 18, 0, Math.PI * 2);
      c2.fill();
      c2.fillStyle = '#c99a10';
      c2.fillRect(20, 12, Math.max(w * 0.12, 2), 20);
    });

    LP.gfx.sheet('rc-bomb', 2, 48, 48, function (c2, i) {
      c2.fillStyle = i === 0 ? '#1b1b22' : '#3a3a48';   // 깜빡인다. 예고를 겸한다
      c2.beginPath();
      c2.arc(24, 26, 18, 0, Math.PI * 2);
      c2.fill();
      c2.fillStyle = '#ff6b6b';
      c2.fillRect(21, 2, 6, 10);
    });
  }

  /* ── 게임 ─────────────────────────────────────────── */

  var def = LP.games.register('ropeclimb', {
    name: '로프 오르기',
    motion: 'squat',
    load: 'high',          // 하체 유산소. 줄넘기와 연달아 붙이지 않는다 (PROJECT.md 9장)
    color: '#b8763a',
    tune: TUNE,
    hint: '앉았다 일어나면 한 칸 올라갑니다. 리듬이 일정하면 더 올라갑니다',
    duration: 90,
    par: 25,               // 정상까지 오르면 par (js/board.js)

    init: function (a) {
      api = a;
      t = 0;
      st = {};
      bombs = [];
      nextBomb = TUNE.BOMB_EVERY;
      finishedAt = 0;
      meter = new LP.npc.SpeedMeter(6);
      buildLanes();
      buildArt();
    },

    demo: function (ctx, tt, chr) {
      var cycle = (tt % 1.6) / 1.6;
      var pose = cycle < 0.45 ? 'squat' : 'idle';
      var lift = cycle < 0.45 ? 0 : (cycle - 0.45) / 0.55 * 60;
      LP.chars.draw(ctx, chr, C.WIDTH / 2, C.HEIGHT * 0.82 - lift, 320, pose);
      ctx.fillStyle = '#b8763a';
      ctx.fillRect(C.WIDTH / 2 - 7, C.HEIGHT * 0.18, 14, C.HEIGHT * 0.64 - lift);
    },

    update: function (dt) {
      t += dt;
      meter.tick(dt);

      var lead = leader();
      var leadPos = lead ? progress(lead) : 0;
      var rate = meter.rate();
      var i;

      for (i = 0; i < npcs.length; i++) {
        npcs[i].racer.update(dt, rate, leadPos);
      }

      // 쿠파의 밥밥탄. 감점이 아니라 잠깐 멈추는 것뿐이다.
      if (t >= nextBomb && lead) {
        nextBomb = t + TUNE.BOMB_EVERY;
        bombs.push({ id: lead, y: human(lead).climbed + TUNE.BOMB_FROM, hit: false });
      }

      for (i = bombs.length - 1; i >= 0; i--) {
        var b = bombs[i];
        b.y -= TUNE.BOMB_FALL * dt;
        var s = human(b.id);
        if (!b.hit && b.y <= s.climbed) {
          b.hit = true;
          s.frozenUntil = t + TUNE.FREEZE_SEC;
          s.combo = 0;
          if (api.fx) api.fx('hit', b.id);
        }
        if (b.y < s.climbed - 2) bombs.splice(i, 1);
      }

      // 사람이 정상에 닿으면 끝낸다. 남은 NPC는 결과 화면에서 다 같이 골인한다.
      for (i = 0; i < lanes.length; i++) {
        if (lanes[i].kind !== 'human') continue;
        var h = human(lanes[i].id);
        if (!h.finished && h.climbed >= TUNE.HEIGHT) {
          h.finished = t;
          finishedAt = t;
          if (api.fx) api.fx('fanfare', lanes[i].id);
        }
      }
      if (finishedAt && t - finishedAt > 1.6 && api.end) api.end();
    },

    onMotion: function (m) {
      if (m.a !== 'squat') return;
      var id = pid(m);
      var s = human(id);
      if (s.finished) return;
      if (t < s.frozenUntil) return;        // 밥밥탄에 맞아 멈춰 있다

      // 리듬이 일정하면 콤보가 붙는다. 25회를 다 못 채우는 아이를 위한 장치다.
      // 첫 스쿼트에는 직전 간격이 없다. 그때 간격을 계산해 평균에 섞으면
      // 말도 안 되는 값이 들어가 이후 콤보가 영영 안 붙는다.
      var iv = s.hasPrev ? t - s.lastSquatAt : 0;
      if (s.hasPrev && iv <= TUNE.RHYTHM_MAX &&
          (s.avgIv === 0 || Math.abs(iv - s.avgIv) <= TUNE.RHYTHM_TOL)) {
        s.combo++;
        if (s.combo > s.bestCombo) s.bestCombo = s.combo;
      } else {
        s.combo = 0;
      }
      if (s.hasPrev) s.avgIv = s.avgIv === 0 ? iv : s.avgIv * 0.6 + iv * 0.4;
      s.lastSquatAt = t;
      s.hasPrev = true;

      var gain = 1 + TUNE.COMBO_BONUS * Math.min(s.combo, TUNE.COMBO_MAX);
      s.climbed += gain;
      if (s.climbed > TUNE.HEIGHT) s.climbed = TUNE.HEIGHT;
      meter.hit();

      // 지나친 칸에 걸린 코인을 줍는다.
      while (s.nextCoin < TUNE.COIN_AT.length && s.climbed >= TUNE.COIN_AT[s.nextCoin]) {
        s.nextCoin++;
        s.coins += TUNE.COIN_SCORE;
        if (api.fx) api.fx('coin', id);
      }

      if (api.fx) api.fx(s.combo >= 3 ? 'combo' : 'squat', id);
    },

    // 점수 = 오른 칸 + 코인. 코인을 따로 세면 5세가 두 숫자를 비교하게 된다.
    getScore: function () {
      var players = api ? api.players : [];
      var out = [];
      for (var i = 0; i < players.length; i++) {
        var s = human(players[i].id);
        out.push({ from: players[i].id, score: Math.floor(s.climbed) + s.coins });
      }
      return out;
    },

    render: function (ctx) {
      var S = C.SAFE;
      var lead = leader();
      var camClimb = lead ? human(lead).climbed : 0;

      // 화면 아래쪽에 서 있고 위로 오른다. 카메라는 앞선 사람을 따라간다.
      var eyeY = C.HEIGHT * 0.66;
      function screenY(climb) { return eyeY - (climb - camClimb) * TUNE.STEP_PX; }

      // 세로 스크롤 배경. 그림이 있으면 위아래로 이어 붙이고,
      // 없으면 가로줄만 그린다 — fillRect는 drawImage가 아니라 예산에 안 잡힌다.
      var scrolled = LP.assets &&
                     LP.assets.bgTileY(ctx, 'ropeclimb',
                                       Math.round(-camClimb * TUNE.STEP_PX), C.WIDTH, C.HEIGHT);
      if (!scrolled) {
        ctx.fillStyle = '#12203c';
        ctx.fillRect(0, 0, C.WIDTH, C.HEIGHT);

        var first = Math.floor(camClimb) - 8;
        for (var k = first; k < first + 20; k++) {
          if (k < 0) continue;
          var y = screenY(k);
          if (y < -40 || y > C.HEIGHT + 40) continue;
          ctx.fillStyle = (k % 5 === 0) ? '#2b3f6b' : '#1b2b4c';
          ctx.fillRect(0, y, C.WIDTH, (k % 5 === 0) ? 4 : 2);
        }
      }

      var laneW = S.w / TUNE.LANES;
      var i, lx;

      // 로프
      for (i = 0; i < lanes.length; i++) {
        lx = S.x + laneW * (i + 0.5);
        ctx.fillStyle = '#b8763a';
        ctx.fillRect(lx - 7, 0, 14, C.HEIGHT);
      }

      // 정상 깃발
      var topY = screenY(TUNE.HEIGHT);
      if (topY > -60 && topY < C.HEIGHT + 60) {
        ctx.fillStyle = '#ffd23b';
        ctx.fillRect(S.x, topY - 6, S.w, 10);
        ctx.fillStyle = '#3bff7a';
        ctx.fillRect(S.x + S.w - 90, topY - 76, 70, 46);
      }

      // 코인
      for (i = 0; i < lanes.length; i++) {
        if (lanes[i].kind !== 'human') continue;
        var hs = human(lanes[i].id);
        lx = S.x + laneW * (i + 0.5);
        for (var ci = hs.nextCoin; ci < TUNE.COIN_AT.length; ci++) {
          var cy = screenY(TUNE.COIN_AT[ci]);
          if (cy < -40 || cy > C.HEIGHT + 40) continue;
          LP.gfx.blit(ctx, 'rc-coin', Math.floor(t * 8), lx, cy, 1);
        }
      }

      // 캐릭터
      for (i = 0; i < lanes.length; i++) {
        var ln = lanes[i];
        lx = S.x + laneW * (i + 0.5);
        var climb, pose = 'idle';
        if (ln.kind === 'human') {
          var s = human(ln.id);
          climb = s.climbed;
          if (t < s.frozenUntil) pose = 'squat';
          else if (t - s.lastSquatAt < 0.22) pose = 'squat';
        } else {
          climb = npcs[ln.idx].racer.pos * TUNE.HEIGHT;
          pose = (Math.floor(t * 3) % 2) ? 'squat' : 'idle';
        }
        LP.chars.draw(ctx, ln['char'], lx, screenY(climb), 170, pose);
      }

      // 밥밥탄
      for (i = 0; i < bombs.length; i++) {
        var bi = laneIndexOf(bombs[i].id);
        if (bi < 0) continue;
        LP.gfx.blit(ctx, 'rc-bomb', Math.floor(t * 8) % 2,
                    S.x + laneW * (bi + 0.5), screenY(bombs[i].y), 1);
      }

      drawHud(ctx, lead);
    }
  });

  function laneIndexOf(id) {
    for (var i = 0; i < lanes.length; i++) {
      if (lanes[i].kind === 'human' && lanes[i].id === id) return i;
    }
    return -1;
  }

  function drawHud(ctx, lead) {
    var S = C.SAFE;
    var s = lead ? human(lead) : null;

    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 46px sans-serif';
    ctx.fillText((s ? Math.floor(s.climbed) : 0) + ' / ' + TUNE.HEIGHT, S.x, S.y + 50);

    if (s && s.coins) {
      ctx.fillStyle = '#ffd23b';
      ctx.font = 'bold 32px sans-serif';
      ctx.fillText('코인 ' + s.coins, S.x, S.y + 94);
    }
    if (s && s.combo >= 3) {
      ctx.fillStyle = '#ff8c1a';
      ctx.font = 'bold 32px sans-serif';
      ctx.fillText('리듬 ' + s.combo, S.x + 190, S.y + 94);
    }

    // 남은 시간
    var left = Math.max(0, 1 - t / def.duration);
    var bw = S.w * 0.3;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(C.WIDTH - S.x - bw, S.y + 24, bw, 20);
    ctx.fillStyle = left > 0.25 ? '#ffffff' : '#ff6b6b';
    ctx.fillRect(C.WIDTH - S.x - bw, S.y + 24, bw * left, 20);

    if (s && s.finished) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#3bff7a';
      ctx.font = 'bold 76px sans-serif';
      ctx.fillText('다 같이 골인!', C.WIDTH / 2, C.HEIGHT * 0.42);
      ctx.textAlign = 'left';
    }
  }

  def._test = {
    TUNE: TUNE,
    lanes: function () { return lanes; },
    npcs: function () { return npcs; },
    bombs: function () { return bombs; },
    human: human,
    now: function () { return t; }
  };

})(window);
