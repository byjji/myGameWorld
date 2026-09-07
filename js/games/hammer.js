/**
 * 해머 피하기 (PROJECT.md 5-3)
 *
 * 해머브라더스가 위에서 해머를 던지고, 아래에서 좌우로 피한다. 마리오1의 그 장면.
 *
 * 이 게임에서 절대 어기면 안 되는 규칙이 두 개 있다.
 *
 *   1. **세 레인을 전부 막는 패턴은 나오지 않는다.** 피할 곳이 없으면 그건 게임이 아니라 벌이다.
 *      패턴 생성기에 하드 가드로 넣었고, 시험에서 수천 번 돌려 확인한다.
 *   2. **예고선이 먼저 뜬다.** 낙하 0.8초 전에 바닥이 빨갛게 깜빡인다.
 *      없으면 반사신경 싸움이 되고, 5세는 반사신경으로 어른을 이길 수 없다.
 *
 * 맞아도 게임오버가 없다. 0.5초 멈추고 코인 하나를 잃을 뿐이다.
 * 점수는 버틴 시간이라, 맞아도 시간은 계속 쌓인다.
 *
 * 문법 수준: ES5
 */
(function (global) {
  'use strict';

  var LP = global.LP;
  var C = LP.config;

  /* ── 튜닝 값 ────────────────────────────────────────── */
  var TUNE = {
    LANES:          3,      // 5개는 너무 많고 2개는 금방 질린다 (PROJECT.md 5-3)

    INTERVAL_START: 1.70,   // 해머가 떨어지는 주기(초)
    INTERVAL_DEC:   0.13,   // 계단식 상승 폭
    INTERVAL_MIN:   0.80,   // 하한
    STEP_SEC:       10,     // 몇 초마다 빨라질지. 갑작스러운 가속 금지

    WARN_SEC:       0.80,   // 예고선이 켜져 있는 시간 = 낙하 시간
    DANGER_SEC:     0.18,   // 착탄 후 위험한 시간

    DUO_AFTER:      22,     // 이 시각부터 두 레인 동시 투하가 나온다
    DUO_CHANCE:     0.35,

    STUN_SEC:       0.5,    // 맞았을 때 멈추는 시간
    COIN_LOSS:      1,      // 맞았을 때 잃는 코인. 점수(버틴 시간)는 깎지 않는다

    COIN_EVERY:     4.0,    // 코인이 나오는 주기(초)
    COIN_LIFE:      3.0,    // 코인이 머무는 시간

    MOVE_PX_SEC:    1400    // 레인 사이를 옮겨가는 속도. 순간이동이 아니다
  };

  var api = null;
  var t = 0;
  var st = {};             // playerId -> 상태
  var waves = [];          // { at, lanes:[..], done }
  var coins = [];          // { lane, born, taken }
  var nextWave = 1.2;
  var nextCoin = TUNE.COIN_EVERY;
  var rng = Math.random;

  var GROUND_Y = Math.round(C.HEIGHT * 0.84);

  function pid(m) { return m.from || 'p1'; }

  function state(id) {
    if (!st[id]) {
      st[id] = {
        lane: 1, x: null, coins: 0, hits: 0,
        stunUntil: -99, lastDeg: 0
      };
    }
    return st[id];
  }

  function laneX(i) {
    var S = C.SAFE;
    return S.x + S.w * (i + 0.5) / TUNE.LANES;
  }

  /** 해머 주기. 10초마다 계단식으로 짧아진다. */
  function interval() {
    var v = TUNE.INTERVAL_START - Math.floor(t / TUNE.STEP_SEC) * TUNE.INTERVAL_DEC;
    return Math.max(TUNE.INTERVAL_MIN, v);
  }

  /**
   * 다음 파도에 쓸 레인을 고른다.
   *
   * 여기가 이 게임의 안전장치다. 무슨 일이 있어도 남는 레인이 하나는 있어야 한다.
   * 확률로 막지 않고 개수 자체를 못 넘게 자른다 — 확률은 언젠가 반드시 터진다.
   */
  function pickLanes(now, duo) {
    var n = (duo && now >= TUNE.DUO_AFTER && rng() < TUNE.DUO_CHANCE) ? 2 : 1;

    // 하드 가드. 레인 수보다 하나 적게. 이 줄이 규칙 전체를 떠받친다.
    if (n > TUNE.LANES - 1) n = TUNE.LANES - 1;

    var pool = [];
    for (var i = 0; i < TUNE.LANES; i++) pool.push(i);
    var out = [];
    for (var k = 0; k < n; k++) {
      out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    }
    return out;
  }

  function buildArt() {
    LP.gfx.sheet('hm-hammer', 2, 70, 90, function (c2, i) {
      c2.save();
      c2.translate(35, 45);
      c2.rotate(i ? 0.4 : -0.4);
      c2.fillStyle = '#8a6a3a';
      c2.fillRect(-5, -10, 10, 46);      // 자루
      c2.fillStyle = '#c9ccd6';
      c2.fillRect(-26, -34, 52, 26);     // 머리
      c2.restore();
    });

    LP.gfx.sheet('hm-coin', 4, 40, 40, function (c2, i) {
      var w = 40 * (1 - i * 0.22);
      c2.fillStyle = '#ffd23b';
      c2.beginPath();
      c2.arc(20, 20, Math.max(w / 2, 4), 0, Math.PI * 2);
      c2.fill();
    });
  }

  /* ── 게임 ─────────────────────────────────────────── */

  var def = LP.games.register('hammer', {
    name: '해머 피하기',
    motion: 'tilt',
    load: 'mid',           // 좌우 스텝. 줄넘기·로프 사이에 끼우기 좋다
    color: '#7a4fd0',
    tune: TUNE,
    hint: '폰을 좌우로 기울여 피하세요. 바닥이 빨개지면 그 자리는 위험합니다',
    duration: 90,
    par: 60,               // 60초를 버티면 잘한 편 (js/board.js)

    init: function (a) {
      api = a;
      t = 0;
      st = {};
      waves = [];
      coins = [];
      nextWave = 1.2;
      nextCoin = TUNE.COIN_EVERY;
      buildArt();
    },

    demo: function (ctx, tt, chr) {
      var lane = Math.floor(tt / 1.1) % TUNE.LANES;
      ctx.fillStyle = '#3a2a52';
      ctx.fillRect(0, GROUND_Y, C.WIDTH, C.HEIGHT - GROUND_Y);
      LP.chars.draw(ctx, chr, laneX(lane), GROUND_Y, 300, 'idle');
      LP.gfx.blit(ctx, 'hm-hammer', Math.floor(tt * 6) % 2,
                  laneX((lane + 1) % TUNE.LANES), C.HEIGHT * 0.35, 1.4);
    },

    update: function (dt) {
      t += dt;
      var i, j;

      if (t >= nextWave) {
        nextWave = t + interval();
        waves.push({ at: t + TUNE.WARN_SEC, lanes: pickLanes(t, true), done: false });
      }

      if (t >= nextCoin) {
        nextCoin = t + TUNE.COIN_EVERY;
        // 코인은 일부러 특정 레인으로 갈 이유를 만든다. 움직임이 훨씬 활발해진다.
        coins.push({ lane: Math.floor(rng() * TUNE.LANES), born: t, taken: false });
      }

      var players = api ? api.players : [];

      for (i = waves.length - 1; i >= 0; i--) {
        var w = waves[i];
        if (!w.done && t >= w.at) {
          w.done = true;
          for (j = 0; j < players.length; j++) {
            var s = state(players[j].id);
            if (t < s.stunUntil) continue;
            if (w.lanes.indexOf(s.lane) < 0) continue;
            s.stunUntil = t + TUNE.STUN_SEC;
            s.hits++;
            s.coins = Math.max(0, s.coins - TUNE.COIN_LOSS);
            if (api.fx) api.fx('hit', players[j].id);
          }
        }
        if (w.done && t > w.at + TUNE.DANGER_SEC + 0.4) waves.splice(i, 1);
      }

      for (i = coins.length - 1; i >= 0; i--) {
        var c = coins[i];
        if (!c.taken) {
          for (j = 0; j < players.length; j++) {
            var ps = state(players[j].id);
            if (ps.lane === c.lane && t >= ps.stunUntil) {
              c.taken = true;
              ps.coins++;
              if (api.fx) api.fx('coin', players[j].id);
              break;
            }
          }
        }
        if (c.taken || t - c.born > TUNE.COIN_LIFE) coins.splice(i, 1);
      }

      // 캐릭터를 레인 사이로 미끄러뜨린다. 순간이동하면 어디로 갔는지 눈이 못 쫓는다.
      for (i = 0; i < players.length; i++) {
        var p = state(players[i].id);
        var target = laneX(p.lane);
        if (p.x === null) p.x = target;
        var d = target - p.x;
        var step = TUNE.MOVE_PX_SEC * dt;
        p.x += Math.abs(d) <= step ? d : (d > 0 ? step : -step);
      }
    },

    /**
     * 기울기 → 레인. 절대 위치 매핑에 히스테리시스를 건다 (PROJECT.md 4장).
     * 경계에서 떨면 캐릭터가 부들부들 떨고, 그 상태로는 해머를 피할 수 없다.
     */
    onTilt: function (m) {
      var s = state(pid(m));
      var deg = (m.v || 0) * LP.tuning.TILT_RANGE_DEG;
      s.lastDeg = deg;

      if (deg <= -LP.tuning.TILT_LANE_DEG) s.lane = 0;
      else if (deg >= LP.tuning.TILT_LANE_DEG) s.lane = TUNE.LANES - 1;
      else if (Math.abs(deg) < LP.tuning.TILT_RELEASE_DEG) s.lane = 1;
      // 그 사이(RELEASE ~ LANE)에서는 지금 레인을 유지한다. 이게 히스테리시스다.
    },

    // 점수 = 버틴 시간 + 코인. 맞아도 시간은 계속 쌓인다 — 감점이 없어야 계속 한다.
    getScore: function () {
      var players = api ? api.players : [];
      var out = [];
      for (var i = 0; i < players.length; i++) {
        out.push({ from: players[i].id, score: Math.floor(t) + state(players[i].id).coins });
      }
      return out;
    },

    render: function (ctx) {
      var S = C.SAFE;
      var i, j;

      if (!LP.assets || !LP.assets.bg(ctx, 'hammer', C.WIDTH, C.HEIGHT)) {
        ctx.fillStyle = '#241a38';
        ctx.fillRect(0, 0, C.WIDTH, C.HEIGHT);
        ctx.fillStyle = '#3a2a52';
        ctx.fillRect(0, GROUND_Y, C.WIDTH, C.HEIGHT - GROUND_Y);
      }

      // 레인 칸막이
      for (i = 1; i < TUNE.LANES; i++) {
        ctx.fillStyle = '#1a1228';
        ctx.fillRect(S.x + S.w * i / TUNE.LANES - 2, 0, 4, C.HEIGHT);
      }

      // 예고선. 낙하 0.8초 전부터 바닥이 깜빡인다.
      for (i = 0; i < waves.length; i++) {
        var w = waves[i];
        if (w.done) continue;
        var left = w.at - t;
        // 가까워질수록 빨리 깜빡인다. 남은 시간을 소리 없이 알려준다.
        var blink = Math.floor((TUNE.WARN_SEC - left) * (left < 0.3 ? 14 : 7)) % 2;
        for (j = 0; j < w.lanes.length; j++) {
          var lx = S.x + S.w * w.lanes[j] / TUNE.LANES;
          ctx.fillStyle = blink ? '#ff3b3b' : '#7a1f1f';
          ctx.fillRect(lx + 4, GROUND_Y - 14, S.w / TUNE.LANES - 8, 14);
        }
      }

      // 떨어지는 해머
      for (i = 0; i < waves.length; i++) {
        var wv = waves[i];
        if (wv.done) continue;
        var k = 1 - (wv.at - t) / TUNE.WARN_SEC;       // 0 = 방금 던짐, 1 = 착탄
        for (j = 0; j < wv.lanes.length; j++) {
          LP.gfx.blit(ctx, 'hm-hammer', Math.floor(t * 12) % 2,
                      laneX(wv.lanes[j]), -40 + (GROUND_Y + 40) * k, 1.3);
        }
      }

      // 코인
      for (i = 0; i < coins.length; i++) {
        if (coins[i].taken) continue;
        LP.gfx.blit(ctx, 'hm-coin', Math.floor(t * 8), laneX(coins[i].lane), GROUND_Y - 150, 1);
      }

      // 캐릭터. 여럿이 같은 레인에 있으면 겹쳐서 하나로 보인다 — 좌우로 조금 벌린다.
      var players = api ? api.players : [];
      var spread = players.length > 1 ? 52 : 0;
      for (i = 0; i < players.length; i++) {
        var s = state(players[i].id);
        var stunned = t < s.stunUntil;
        var px = (s.x === null ? laneX(s.lane) : s.x) + (i - (players.length - 1) / 2) * spread;
        LP.chars.draw(ctx, players[i]['char'], px, GROUND_Y,
                      players.length > 2 ? 180 : 210, stunned ? 'squat' : 'idle');
      }

      drawHud(ctx, players);
    }
  });

  function drawHud(ctx, players) {
    var S = C.SAFE;

    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 46px sans-serif';
    ctx.fillText(Math.floor(t) + '초', S.x, S.y + 50);

    // 코인은 사람마다 따로 센다. 여럿이 하면 누구 것인지 색으로 구분한다.
    ctx.font = 'bold 30px sans-serif';
    for (var i = 0; i < players.length && i < 4; i++) {
      var ps = state(players[i].id);
      if (!ps.coins) continue;
      var c = LP.chars.byId[players[i]['char']];
      ctx.fillStyle = (c && c.cap) || '#ffd23b';
      ctx.fillText('◆ ' + ps.coins, S.x + i * 110, S.y + 92);
    }

    var left = Math.max(0, 1 - t / def.duration);
    var bw = S.w * 0.3;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(C.WIDTH - S.x - bw, S.y + 24, bw, 20);
    ctx.fillStyle = left > 0.25 ? '#ffffff' : '#ff6b6b';
    ctx.fillRect(C.WIDTH - S.x - bw, S.y + 24, bw * left, 20);
  }

  def._test = {
    TUNE: TUNE,
    interval: function () { return interval(); },
    pickLanes: pickLanes,
    setRng: function (fn) { rng = fn || Math.random; },
    setTime: function (v) { t = v; },
    now: function () { return t; },
    waves: function () { return waves; },
    coins: function () { return coins; },
    state: state
  };

})(window);
