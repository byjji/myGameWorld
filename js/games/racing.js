/**
 * 레이싱 (PROJECT.md 5-5, phase8)
 *
 * 다섯 번째이자 마지막 미니게임. 유사 3D 도로 위에서 카트를 몬다.
 * 렌더러는 js/pseudo3d.js에 따로 있다 — 이 파일은 규칙만 본다.
 *
 * 이 게임에서 지키는 것 네 가지.
 *
 *   1. **가속과 브레이크가 없다.** 조작은 좌우 기울기 하나뿐이다.
 *      5세에게 두 가지를 동시에 시키면 둘 다 안 된다 (PROJECT.md 5-5).
 *   2. **기울기는 절대 위치다.** 기울인 만큼 그 자리로 간다. 기울인 시간만큼
 *      돌아가는 방식(속도 제어)은 손을 놓으면 계속 돌아 벽에 박는다 (PROJECT.md 4장).
 *   3. **게임오버가 없다.** 도로를 벗어나면 느려지고, 벽에 닿으면 잠깐 느려진다.
 *      멈추지도, 되돌려지지도 않는다. 90초 안에 완주가 안 되면 간 만큼이 점수다.
 *   4. **꼴등이 없다.** 마지막 구간에서 맨 뒤 NPC는 플레이어를 앞서지 않는다.
 *      쿠파는 중반에 앞서다 막판에 따라잡힌다 (js/npc.js 러버밴딩).
 *
 * 코스는 데이터다 (js/courses.js). 여기에 코스 모양이 박혀 있지 않다.
 *
 * 문법 수준: ES5
 */
(function (global) {
  'use strict';

  var GP = global.GP;
  var C = GP.config;
  var P3 = GP.pseudo3d;

  /* ── 튜닝 값 ────────────────────────────────────────── */
  var TUNE = {
    LAPS:          3,       // 한 바퀴 21초(들판) × 3 = 63초. 90초 안에 여유가 있어야 한다
    COURSE:        0,       // GP.courses.ids()의 몇 번째. ?tune=racing.COURSE:1

    MAX_SPEED:     7200,    // 월드 단위/초
    ACCEL:         3600,    // 가속. 브레이크는 없다
    OFFROAD_MAX:   3200,    // 도로 밖에서의 상한
    OFFROAD_DECEL: 6000,    // 도로 밖에서 줄어드는 속도
    WALL_SPEED:    2200,    // 벽에 닿으면 이 속도까지 떨어진다. 멈추지는 않는다
    WALL_X:        1.55,    // 이 바깥은 못 나간다 (도로 반폭 단위)
    WALL_COOL:     0.6,     // 벽 소리·진동을 다시 내기까지의 시간

    // 기울기 감도 3단계. 실기에서 조카에게 맞는 것을 고른다 (phase8 검증 방법).
    //   0 낮음(많이 기울여야 간다) · 1 보통 · 2 높음(살짝만 기울여도 간다)
    SENS_LEVEL:    1,
    DEADZONE:      0.06,    // 이 안쪽은 가운데로 본다. 손이 떨려도 카트는 안 흔들린다
    MOVE_RATE:     2.2,     // 목표 위치로 옮겨가는 속도(도로 반폭/초)

    // 커브에서 바깥으로 밀리는 정도. **이 게임의 난이도 전부가 이 숫자에 있다.**
    // 0이면 가만히 있는 것이 가장 빠르고, 크면 5세가 커브마다 풀밭으로 나간다.
    CENTRIFUGAL:   0.32,
    MAX_DRIFT:     1.15,    // 밀리는 거리의 상한. 해변의 급커브에서 벽까지 날아가지 않게
    MAX_X:         1.10,    // 기울여서 갈 수 있는 한계. 이 바깥은 원심력으로만 나간다

    COIN_SEGS:     24,      // 코인 간격(세그먼트)
    COIN_HIT_X:    0.42,    // 코인을 줍는 좌우 폭
    LAP_BONUS:     10,      // 한 바퀴 = 10점

    SKY_SPEED:     380,     // 배경 산이 커브 반대로 흐르는 정도

    // 화면에 도는 카트의 총수(사람 + NPC). 카트 하나가 오프스크린 시트 한 장을 쓴다.
    // 코인·나무까지 더해 config.MAX_OFFSCREEN(8장)을 넘기면 먼저 만든 시트가 밀려나고
    // **그 카트만 화면에서 사라진다.** 사람이 늘면 NPC를 줄여서 맞춘다.
    MAX_KARTS:     6,

    NPC_LEAD_2:    -0.045,  // 둘째 NPC가 뒤에서 달리는 거리(진행도)
    NPC_LEAD_3:    -0.105,  // 셋째 NPC. 이 자리가 "꼴등 없음"을 떠받친다
    NO_LAST_FROM:  0.80,    // 이 진행도부터 맨 뒤 NPC는 플레이어를 앞서지 않는다
    NO_LAST_GAP:   0.03,

    OVERTAKE_FROM: 0.55     // 이 뒤에 쿠파를 제치면 역전 연출을 낸다
  };

  var SENS = [0.8, 1.0, 1.35];

  var KART_W = 1500;        // 카트의 월드 폭. 원근 스케일은 렌더러가 계산한다
  var PROP_W = 2200;
  var COIN_W = 900;

  // NPC가 지키는 주행 라인. 전부 가운데로 달리면 카트가 한 덩어리로 보인다.
  var NPC_LANE = [-0.45, 0.4, -0.15];

  var api = null;
  var t = 0;
  var track = null;
  var st = {};              // playerId -> 사람 상태
  var npcs = [];            // { char, racer, sprite }
  var coins = [];           // { z, x, key, frame, w, lap }  lap = 주워간 바퀴 번호
  var props = [];           // 길가 나무. 속도감은 이것들이 지나가는 것으로 난다
  var sprites = [];         // 렌더러에 넘길 목록. 매 프레임 다시 채운다(새로 만들지는 않는다)
  var skyX = 0;
  var finishedAt = 0;
  var overtakeAt = -99;
  var bowserAhead = true;

  function pid(m) { return m.from || 'p1'; }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function course() {
    var ids = GP.courses ? GP.courses.ids() : [];
    var id = ids[Math.floor(TUNE.COURSE) % (ids.length || 1)] || ids[0];
    return GP.courses[id];
  }

  function state(id) {
    if (!st[id]) {
      st[id] = {
        z: 0, x: 0, speed: 0, dist: 0, lap: 0,
        tilt: 0, coins: 0, wallAt: -99, offroad: false,
        finished: 0, rank: 0
      };
    }
    return st[id];
  }

  function totalLen() { return track ? track.length * TUNE.LAPS : 1; }

  function progress(id) { return clamp(state(id).dist / totalLen(), 0, 1); }

  /** 카메라가 따라갈 사람. 여럿이 하면 가장 앞선 사람을 본다 (화면은 하나뿐이다). */
  function leader() {
    var players = api ? api.players : [];
    var best = null, bestV = -1;
    for (var i = 0; i < players.length; i++) {
      var s = state(players[i].id);
      if (s.dist > bestV) { bestV = s.dist; best = players[i].id; }
    }
    return best;
  }

  /* ── 코스·스프라이트 준비 ───────────────────────────── */

  /**
   * 트랙과 그림을 만든다.
   *
   * 시연 화면(demo)은 init 전에 그려진다. 그래서 둘 다 여기를 거치게 하고
   * 이미 만들어져 있으면 그대로 쓴다.
   */
  function ensure() {
    if (!track || track.id !== course().id) {
      track = new P3.Track(course());
      buildProps();
      buildCoins();
    }
    buildArt();
  }

  function buildProps() {
    props = [];
    var c = course();
    var every = c.propEvery || 13;
    var n = track.segs.length;
    for (var i = every; i < n; i += every) {
      var side = (i / every) % 2 ? 1 : -1;
      props.push({
        z: i * P3.TUNE.SEG_LEN,
        x: side * (1.5 + ((i * 7) % 5) * 0.16),
        key: 'rg-tree', frame: (i % 2), w: PROP_W
      });
    }
  }

  function buildCoins() {
    coins = [];
    var n = track.segs.length;
    var lane = [-0.45, 0, 0.45];
    for (var i = TUNE.COIN_SEGS; i < n - 4; i += TUNE.COIN_SEGS) {
      coins.push({
        z: i * P3.TUNE.SEG_LEN,
        x: lane[Math.floor(i / TUNE.COIN_SEGS) % 3],
        key: 'rg-coin', frame: 0, w: COIN_W, lap: -1
      });
    }
  }

  /* ── 그림 ─────────────────────────────────────────── */

  /**
   * 카트 스프라이트. 캐릭터마다 한 장, 조향 각도 5프레임 (phase8 산출물).
   *
   * 뒤에서 본 그림이라 좌우로 꺾을 때 차체가 기울고 앞바퀴가 삐져나온다.
   * 그림이 생기면 js/assets-manifest.js에 넣고 이 함수만 버리면 된다.
   */
  function kartKey(charId) { return 'rg-k-' + charId; }

  function buildKart(charId) {
    var key = kartKey(charId);
    if (GP.gfx.has(key)) return key;
    var col = GP.chars.byId[charId] || GP.chars.list[0];

    GP.gfx.sheet(key, 5, 140, 116, function (c2, i) {
      var lean = (i - 2) * 7;                 // -14 ~ +14 픽셀
      var cx = 70 + lean;

      // 뒷바퀴
      c2.fillStyle = '#26262e';
      c2.fillRect(cx - 60, 74, 26, 34);
      c2.fillRect(cx + 34, 74, 26, 34);

      // 앞바퀴. 꺾은 쪽이 더 보인다
      c2.fillStyle = '#1b1b22';
      c2.fillRect(cx - 44 - lean * 0.6, 62, 18, 24);
      c2.fillRect(cx + 26 - lean * 0.6, 62, 18, 24);

      // 차체
      c2.fillStyle = col.body;
      c2.fillRect(cx - 44, 58, 88, 34);
      c2.fillStyle = '#1b3f7a';
      c2.fillRect(cx - 44, 88, 88, 8);

      // 앉은 사람 — 몸통·머리·모자
      c2.fillStyle = col.body;
      c2.fillRect(cx - 20, 34, 40, 30);
      c2.fillStyle = '#f0c090';
      c2.fillRect(cx - 17, 14, 34, 24);
      c2.fillStyle = col.cap;
      c2.fillRect(cx - 21, 4, 42, 14);

      // 모자 마크. 뒤에서 보므로 작은 점 하나로 충분하다
      c2.fillStyle = '#ffffff';
      c2.fillRect(cx - 4, 6, 8, 8);
    });
    return key;
  }

  function buildArt() {
    GP.gfx.sheet('rg-coin', 4, 56, 56, function (c2, i) {
      var w = 56 * (1 - i * 0.22);
      c2.fillStyle = '#ffd23b';
      c2.beginPath();
      c2.arc(28, 28, Math.max(w / 2, 5), 0, Math.PI * 2);
      c2.fill();
      c2.fillStyle = '#c99a10';
      c2.fillRect(26, 14, Math.max(w * 0.1, 2), 28);
    });

    GP.gfx.sheet('rg-tree', 2, 120, 180, function (c2, i) {
      c2.fillStyle = '#6b4a24';
      c2.fillRect(52, 110, 16, 70);
      c2.fillStyle = i ? '#2f7d3c' : '#3b9147';
      c2.beginPath();
      c2.moveTo(60, 6);
      c2.lineTo(112, 120);
      c2.lineTo(8, 120);
      c2.closePath();
      c2.fill();
    });

    var players = api ? api.players : [];
    for (var i = 0; i < players.length; i++) buildKart(players[i]['char']);
    for (i = 0; i < npcs.length; i++) buildKart(npcs[i]['char']);
    if (!players.length && !npcs.length) buildKart('lhat');   // 시연 화면
  }

  /* ── NPC ──────────────────────────────────────────── */

  /**
   * 상대를 만든다. 쿠파는 반드시 들어간다 — 페이스메이커가 없으면 경주가 아니다.
   *
   * unit은 "전속력으로 달렸을 때 걸리는 초"의 역수다. 그래야 js/npc.js의 배수와
   * 상·하한이 다른 게임과 같은 뜻으로 걸린다 (거기서는 동작 한 번이 단위였다).
   */
  function buildNpcs() {
    npcs = [];
    var players = api ? api.players : [];
    var taken = {};
    var i;
    for (i = 0; i < players.length; i++) taken[players[i]['char']] = true;

    var paceSec = totalLen() / TUNE.MAX_SPEED;
    var unit = 1 / paceSec;

    var pool = [
      { id: 'bowser', pacer: true,  lead: 0 },
      { id: 'mario',  pacer: false, lead: TUNE.NPC_LEAD_2 },
      { id: 'peach',  pacer: false, lead: TUNE.NPC_LEAD_3 },
      { id: 'toad',   pacer: false, lead: TUNE.NPC_LEAD_3 - 0.05 },
      { id: 'luigi',  pacer: false, lead: TUNE.NPC_LEAD_2 - 0.02 }
    ];

    var room = Math.max(1, Math.min(3, TUNE.MAX_KARTS - players.length));

    for (i = 0; i < pool.length && npcs.length < room; i++) {
      if (taken[pool[i].id]) continue;
      npcs.push({
        'char': pool[i].id,
        racer: new GP.npc.Racer({ pacer: pool[i].pacer, lead: pool[i].lead, unit: unit }),
        sprite: { z: 0, x: 0, key: kartKey(pool[i].id), frame: 2, w: KART_W }
      });
    }

    // 조카가 쿠파를 골랐으면 페이스메이커가 통째로 빠진다. 그러면 접전도 역전도 없다.
    // 자리가 비면 맨 앞 NPC가 그 역할을 물려받는다 — 배역이지 캐릭터가 아니다.
    if (npcs.length && !npcs[0].racer.pacer) {
      npcs[0].racer.pacer = true;
      npcs[0].racer.lead = 0;
    }
  }

  /** 맨 뒤에서 달리는 NPC. "꼴등 없음"을 지킬 때 이 녀석을 잡는다. */
  function hindmost() {
    var worst = null;
    for (var i = 0; i < npcs.length; i++) {
      if (!worst || npcs[i].racer.pos < worst.racer.pos) worst = npcs[i];
    }
    return worst;
  }

  function rankOf(id) {
    var p = progress(id);
    var ahead = 0;
    for (var i = 0; i < npcs.length; i++) if (npcs[i].racer.pos > p) ahead++;
    var players = api ? api.players : [];
    for (i = 0; i < players.length; i++) {
      if (players[i].id !== id && progress(players[i].id) > p) ahead++;
    }
    return ahead + 1;
  }

  /* ── 게임 ─────────────────────────────────────────── */

  var def = GP.games.register('racing', {
    name: '레이싱',
    motion: 'tilt',
    load: 'low',           // 손목만 쓴다. 줄넘기·로프 사이에 쉬어가는 자리다 (PROJECT.md 9장)
    color: '#2f8fd0',
    tune: TUNE,
    hint: '폰을 핸들처럼 잡고 좌우로 눕히면 그쪽으로 갑니다. 달리는 것은 저절로 됩니다',

    // 이 게임만 폰을 쥐는 법이 다르다. 가슴에 대면 핸들을 돌릴 수 없다 (phase8 검증 방법).
    calibHint: ['폰을 두 손으로 잡고', '핸들처럼 들어요'],

    duration: 90,
    par: TUNE.LAPS * TUNE.LAP_BONUS,        // 완주하면 par (js/board.js)

    init: function (a) {
      api = a;
      t = 0;
      st = {};
      skyX = 0;
      finishedAt = 0;
      overtakeAt = -99;
      bowserAhead = true;
      ensure();
      buildNpcs();
      buildArt();
      for (var i = 0; i < coins.length; i++) coins[i].lap = -1;
      def.par = TUNE.LAPS * TUNE.LAP_BONUS;  // 주소로 LAPS를 바꿨을 수 있다
    },

    /**
     * 시연 — 진짜 도로를 흘려보내면서 카트를 좌우로 흔든다.
     * 글자 설명 없이 "기울이면 옆으로 간다"가 보여야 한다 (PROJECT.md 10장).
     */
    demo: function (ctx, tt, chr) {
      ensure();
      buildKart(chr);
      var sway = Math.sin(tt * 1.6);
      P3.render(ctx, track, { z: tt * 5200, x: sway * 0.55, sky: -tt * 40 }, null);
      var key = kartKey(chr);
      var sz = GP.gfx.size(key);
      var scale = C.WIDTH * 0.0016;
      GP.gfx.blit(ctx, key, 2 + Math.round(sway * 2),
                  C.WIDTH / 2 + sway * 120,
                  C.HEIGHT * 0.86 - (sz ? sz.fh * scale / 2 : 0), scale);

      // 기울이는 손을 화살표로 한 번 더 말한다
      ctx.fillStyle = '#ffd23b';
      ctx.font = 'bold 90px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(sway < 0 ? '◀' : '▶', C.WIDTH / 2 + sway * 300, C.HEIGHT * 0.5);
      ctx.textAlign = 'left';
    },

    update: function (dt) {
      t += dt;
      var players = api ? api.players : [];
      var i, j;

      for (i = 0; i < players.length; i++) drive(players[i].id, dt);

      var lead = leader();
      var leadState = lead ? state(lead) : null;
      var p = lead ? progress(lead) : 0;

      // 배경은 커브 반대로 흐른다. 도는 느낌은 거의 이 한 겹에서 온다.
      if (leadState && track) {
        skyX -= track.curveAt(leadState.z) * (leadState.speed / TUNE.MAX_SPEED) * TUNE.SKY_SPEED * dt;
      }

      // NPC. 속도계 대신 "전속력 대비 몇 할로 달리는가"를 그대로 넘긴다.
      var rate = leadState ? leadState.speed / TUNE.MAX_SPEED : 0;
      for (i = 0; i < npcs.length; i++) npcs[i].racer.update(dt, rate, p);

      // 꼴등 없음. 마지막 구간에서 맨 뒤 NPC는 플레이어 앞으로 나가지 않는다.
      // 러버밴딩만으로는 확률이고, 확률은 언젠가 반드시 터진다 (해머의 레인 가드와 같은 이유).
      if (p >= TUNE.NO_LAST_FROM) {
        var back = hindmost();
        if (back && back.racer.pos > p - TUNE.NO_LAST_GAP) {
          back.racer.pos = Math.max(0, p - TUNE.NO_LAST_GAP);
        }
      }

      // 쿠파를 제치는 순간. 막판 역전은 이 게임이 주는 유일한 사건이다.
      var bw = npcs.length ? npcs[0] : null;
      if (bw && bw.racer.pacer) {
        var ahead = bw.racer.pos > p;
        if (bowserAhead && !ahead && p > TUNE.OVERTAKE_FROM) {
          overtakeAt = t;
          if (api && api.fx) api.fx('good', lead);
        }
        bowserAhead = ahead;
      }

      // 코인
      for (i = 0; i < players.length; i++) {
        var s = state(players[i].id);
        if (s.finished) continue;
        // 한 프레임에 나아간 거리보다 좁게 잡으면 코인을 뛰어넘는다.
        // 탭 전환 후 복귀처럼 dt가 커지는 순간이 있어 속도로도 한 번 더 잡는다.
        var reach = Math.max(P3.TUNE.SEG_LEN * 1.5, s.speed * dt + P3.TUNE.SEG_LEN);
        for (j = 0; j < coins.length; j++) {
          var c = coins[j];
          if (c.lap === s.lap) continue;                       // 이번 바퀴에 이미 먹었다
          if (track.wrap(s.z - c.z) > reach) continue;         // 아직 안 지났거나 한참 지났다
          if (Math.abs(s.x - c.x) > TUNE.COIN_HIT_X) continue;
          c.lap = s.lap;
          s.coins++;
          if (api && api.fx) api.fx('coin', players[i].id);
        }
      }

      // 골인
      for (i = 0; i < players.length; i++) {
        var f = state(players[i].id);
        if (!f.finished && f.dist >= totalLen()) {
          f.finished = t;
          f.rank = rankOf(players[i].id);
          finishedAt = t;
          if (api && api.fx) api.fx('fanfare', players[i].id);
        }
      }
      if (finishedAt && t - finishedAt > 1.8 && api && api.end) api.end();
    },

    /**
     * 기울기 → 도로 위 위치. **절대 매핑이다** (PROJECT.md 4장).
     * 기울인 만큼 그 자리로 가고, 바로 세우면 가운데로 돌아온다.
     */
    onTilt: function (m) {
      var s = state(pid(m));
      var v = m.v || 0;
      if (Math.abs(v) < TUNE.DEADZONE) v = 0;
      s.tilt = v;
    },

    // 점수 = 달린 거리(한 바퀴 10점) + 코인. 완주하면 par에 닿는다.
    getScore: function () {
      var players = api ? api.players : [];
      var out = [];
      for (var i = 0; i < players.length; i++) {
        var s = state(players[i].id);
        var laps = track ? s.dist / track.length : 0;
        out.push({ from: players[i].id, score: Math.floor(laps * TUNE.LAP_BONUS) + s.coins });
      }
      return out;
    },

    render: function (ctx) {
      if (!track) ensure();
      var lead = leader();
      var s = lead ? state(lead) : state('p1');
      var players = api ? api.players : [];
      var i;

      sprites.length = 0;

      for (i = 0; i < props.length; i++) sprites.push(props[i]);

      for (i = 0; i < coins.length; i++) {
        if (coins[i].lap === s.lap) continue;
        coins[i].frame = Math.floor(t * 8) % 4;
        sprites.push(coins[i]);
      }

      for (i = 0; i < npcs.length; i++) {
        var n = npcs[i];
        var dist = n.racer.pos * totalLen();
        n.sprite.z = track.wrap(dist);
        // 주행 라인 — 자기 자리를 지키면서 커브 안쪽으로 붙는다
        var cv = track.curveAt(n.sprite.z);
        n.sprite.x = clamp(NPC_LANE[i % NPC_LANE.length] + cv * 0.06
                           + Math.sin(t * 0.7 + i) * 0.05, -0.9, 0.9);
        n.sprite.frame = 2 + Math.round(clamp(cv * 0.4, -2, 2));
        sprites.push(n.sprite);
      }

      // 같이 하는 다른 사람의 카트. 카메라를 잡은 사람은 화면 앞에 따로 그린다.
      for (i = 0; i < players.length; i++) {
        if (players[i].id === lead) continue;
        var o = state(players[i].id);
        sprites.push({ z: track.wrap(o.z), x: o.x, key: kartKey(players[i]['char']),
                       frame: 2 + Math.round(clamp(o.tilt * 2, -2, 2)), w: KART_W });
      }

      P3.render(ctx, track, { z: s.z, x: s.x, sky: skyX }, sprites);

      drawPlayerKart(ctx, lead, s);
      drawHud(ctx, lead, s);
    }
  });

  /**
   * 한 사람의 한 프레임.
   *
   * 가속은 저절로 된다. 조카가 하는 것은 좌우뿐이다.
   */
  function drive(id, dt) {
    var s = state(id);
    if (s.finished) return;

    var curve = track.curveAt(s.z);
    var off = Math.abs(s.x) > 1;

    // 속도. 도로 밖이면 상한이 낮고 줄어드는 것도 빠르다.
    if (off) {
      s.speed -= TUNE.OFFROAD_DECEL * dt;
      if (s.speed < TUNE.OFFROAD_MAX) s.speed = TUNE.OFFROAD_MAX;
    } else {
      s.speed += TUNE.ACCEL * dt;
      if (s.speed > TUNE.MAX_SPEED) s.speed = TUNE.MAX_SPEED;
    }
    if (s.speed < 0) s.speed = 0;
    s.offroad = off;

    var pct = s.speed / TUNE.MAX_SPEED;

    // 좌우. 기울인 각도가 그대로 도로 위 위치다.
    //
    // 원심력은 카트를 미는 힘이 아니라 **기준점을 옮기는 것**으로 넣는다.
    // 절대 매핑은 목표 위치로 끌어당기는 서보라서, 밀어내는 힘(초당 0.5)은
    // 끌어당기는 힘(MOVE_RATE 2.2)에 그대로 먹힌다 — 커브가 공짜가 되고
    // 가만히 있는 것이 가장 빠른 주행이 된다. 기준점을 옮기면 그 반대가 된다.
    // 커브에서 손목을 그쪽으로 기울여야 가운데로 돌아온다.
    var drift = clamp(-curve * pct * TUNE.CENTRIFUGAL, -TUNE.MAX_DRIFT, TUNE.MAX_DRIFT);
    var aim = clamp(s.tilt * SENS[Math.floor(TUNE.SENS_LEVEL) % SENS.length], -TUNE.MAX_X, TUNE.MAX_X);
    var target = aim + drift;

    var step = TUNE.MOVE_RATE * dt;
    var d = target - s.x;
    s.x += Math.abs(d) <= step ? d : (d > 0 ? step : -step);

    // 벽. 게임오버가 아니라 감속이다.
    if (Math.abs(s.x) > TUNE.WALL_X) {
      s.x = s.x > 0 ? TUNE.WALL_X : -TUNE.WALL_X;
      if (s.speed > TUNE.WALL_SPEED) s.speed = TUNE.WALL_SPEED;
      if (t - s.wallAt > TUNE.WALL_COOL) {
        s.wallAt = t;
        if (api && api.fx) api.fx('hit', id);
      }
    }

    // 앞으로. 랩은 결승선을 지날 때 오른다.
    var before = s.z;
    s.dist += s.speed * dt;
    s.z = track.wrap(s.z + s.speed * dt);
    if (s.z < before) {
      s.lap++;
      if (s.lap < TUNE.LAPS && api && api.fx) api.fx('go', id);
    }
  }

  /**
   * 플레이어 카트. 화면 아래 고정 위치에 그린다.
   *
   * 도로가 밑에서 흘러가고 카트는 제자리에 있는다 — 아웃런이 이렇게 했고,
   * 이렇게 해야 5세가 "내 카트"를 눈으로 놓치지 않는다.
   */
  function drawPlayerKart(ctx, id, s) {
    var players = api ? api.players : [];
    var chr = 'lhat';
    for (var i = 0; i < players.length; i++) {
      if (players[i].id === id) chr = players[i]['char'];
    }
    var key = buildKart(chr);
    var sz = GP.gfx.size(key);
    var scale = C.WIDTH * 0.0019;
    var bounce = s.offroad ? Math.sin(t * 38) * 7 : 0;
    var lean = clamp(s.tilt * 2, -2, 2);

    GP.gfx.blit(ctx, key, 2 + Math.round(lean),
                C.WIDTH / 2 + lean * 26,
                C.HEIGHT * 0.90 + bounce - (sz ? sz.fh * scale / 2 : 0), scale);
  }

  function drawHud(ctx, id, s) {
    var S = C.SAFE;

    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 46px sans-serif';
    ctx.fillText(Math.min(s.lap + 1, TUNE.LAPS) + ' / ' + TUNE.LAPS, S.x, S.y + 50);

    // 순위. 글자를 못 읽어도 숫자는 읽는다 (PROJECT.md 10장).
    var rank = id ? rankOf(id) : 1;
    ctx.font = 'bold 64px sans-serif';
    ctx.fillStyle = rank === 1 ? '#ffd23b' : '#ffffff';
    ctx.fillText(rank + '위', S.x, S.y + 124);

    if (s.coins) {
      ctx.fillStyle = '#ffd23b';
      ctx.font = 'bold 32px sans-serif';
      ctx.fillText('◆ ' + s.coins, S.x + 190, S.y + 118);
    }

    // 남은 시간
    var left = Math.max(0, 1 - t / (def.duration || 90));
    var bw = S.w * 0.3;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(C.WIDTH - S.x - bw, S.y + 24, bw, 20);
    ctx.fillStyle = left > 0.25 ? '#ffffff' : '#ff6b6b';
    ctx.fillRect(C.WIDTH - S.x - bw, S.y + 24, bw * left, 20);

    ctx.textAlign = 'center';
    if (t - overtakeAt < 1.4) {
      ctx.fillStyle = '#3bff7a';
      ctx.font = 'bold 84px sans-serif';
      ctx.fillText('역전!', C.WIDTH / 2, C.HEIGHT * 0.34);
    }
    if (s.finished) {
      ctx.fillStyle = '#3bff7a';
      ctx.font = 'bold 88px sans-serif';
      ctx.fillText(s.rank === 1 ? '1등 골인!' : '골인!', C.WIDTH / 2, C.HEIGHT * 0.42);
    }
    ctx.textAlign = 'left';
  }

  def._test = {
    TUNE: TUNE,
    SENS: SENS,
    track: function () { return track; },
    npcs: function () { return npcs; },
    coins: function () { return coins; },
    props: function () { return props; },
    state: state,
    drive: drive,
    rankOf: rankOf,
    progress: progress,
    leader: leader,
    hindmost: hindmost,
    setTime: function (v) { t = v; },
    now: function () { return t; },
    ensure: ensure
  };

})(window);
