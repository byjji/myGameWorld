/**
 * Game-Party TV 셸
 *
 * TV는 화면 전용이다. 입력을 받지 않는다 (PROJECT.md 1장).
 * 화면 전환은 폰이 보낸 메시지와 시간으로만 일어난다.
 *
 * 화면 순서 (PROJECT.md 7장):
 *   대기 → 캐릭터 선택 → 동작 시연 → 캘리브레이션 → 카운트다운 → 플레이 → 결과
 *
 * 미니게임은 GP.games 레지스트리에 등록된 것을 그대로 실행한다.
 * 게임을 붙이거나 떼도 이 파일은 고치지 않는다.
 *
 * 문법 수준: ES5
 */
(function (global) {
  'use strict';

  var GP = global.GP || (global.GP = {});
  var C = GP.config;

  /* 미니게임 레지스트리 */

  var games = {};
  var order = [];

  GP.games = {
    /**
     * def = {
     *   name:   화면에 뜨는 이름
     *   motion: 'jump' | 'punch' | 'squat' | 'tilt'   이 게임이 쓰는 동작 하나
     *   hint:   어른용 한 줄 설명 (작게 표시)
     *   demo:   function(ctx, t, charId)   동작 시연 그리기
     *   init:   function(api)
     *   update: function(dt)
     *   render: function(ctx)
     *   onMotion: function(e)   { a, p, from }
     *   onTilt:   function(e)   { v, from }
     *   getScore: function()    -> [{ from, score }]
     *   duration: 초. 없으면 90
     *   load:   'high' | 'mid' | 'low'   하체 부하. 룰렛이 힘든 게임을 연달아 뽑지 않게 한다
     *   hidden: true면 선택 화면에 나오지 않는다 (진단용 화면)
     * }
     */
    register: function (id, def) {
      def.id = id;
      if (!def.load) def.load = 'mid';
      games[id] = def;
      order.push(id);
      return def;
    },
    get: function (id) { return games[id]; },
    ids: function () { return order.slice(); },

    /** 선택 화면에 띄울 게임들. 진단용 화면은 뺀다. */
    visible: function () {
      var out = [];
      for (var i = 0; i < order.length; i++) {
        if (!games[order[i]].hidden) out.push(order[i]);
      }
      return out;
    },

    /**
     * 룰렛이 뽑을 수 있는 후보.
     *
     * 두 가지를 뺀다.
     *   1. 직전에 한 게임 — 연달아 같은 것을 하면 금방 질린다
     *   2. 직전이 하체 부하가 높았으면 부하 높은 게임 전부 (PROJECT.md 9장)
     *      줄넘기 다음에 로프가 나오면 조카가 지쳐서 세 번째 게임을 못 한다.
     *      겉으로는 랜덤인데 힘든 게임이 연속으로 안 나오는 것이 목적이다.
     *
     * 다 걸러지면 조건을 하나씩 푼다. 뽑을 것이 없어 멈추는 쪽이 더 나쁘다.
     */
    pool: function (lastId) {
      var vis = GP.games.visible();
      var lastLoad = (lastId && games[lastId]) ? games[lastId].load : null;
      var out = [], i;

      // 첫 판은 힘든 것으로 시작하지 않는다.
      // PROJECT.md 9장의 배치가 낮음 → 높음 → 낮음 → 높음 → 중간으로 시작한다.
      // 첫 판부터 줄넘기를 뽑으면 두 번째 판에 이미 지쳐 있다.
      if (!lastId) {
        for (i = 0; i < vis.length; i++) {
          if (games[vis[i]].load !== 'high') out.push(vis[i]);
        }
        if (out.length) return out;
        out = [];
      }

      for (i = 0; i < vis.length; i++) {
        if (vis[i] === lastId) continue;
        if (lastLoad === 'high' && games[vis[i]].load === 'high') continue;
        out.push(vis[i]);
      }
      if (out.length) return out;

      for (i = 0; i < vis.length; i++) if (vis[i] !== lastId) out.push(vis[i]);
      return out.length ? out : vis;
    },

    /** 룰렛 한 번. rnd를 주입할 수 있게 열어둔다 — 시험에서 100판을 돌려본다. */
    roll: function (lastId, rnd) {
      var p = GP.games.pool(lastId);
      return p[Math.floor((rnd || Math.random)() * p.length)];
    }
  };

  /* 셸 */

  var SAFE = C.SAFE;

  var tv = {
    screen: 'wait',
    code: '----',
    players: [],          // { id, name, char, ready, score }
    net: null,
    game: null,           // 현재 미니게임 정의
    gameId: null,
    lastGameId: null,     // 직전에 한 게임. 룰렛 후보에서 빼기 위해 기억한다
    t: 0,                 // 현재 화면에 머문 시간(초)
    clock: 0,             // 시작부터의 누적 시간(초). 화면 전환에 영향받지 않는다
    calib: {},            // playerId -> 진행률
    status: 'connecting',
    log: []               // 디버그용 최근 이벤트
  };

  GP.tv = tv;

  function qs(key, dflt) {
    var m = global.location.search.match(new RegExp('[?&]' + key + '=([^&]+)'));
    return m ? decodeURIComponent(m[1]) : dflt;
  }

  // ?game=hammer 처럼 지정하면 선택 화면을 건너뛰고 그 게임만 반복한다.
  // 개발용이다 — 한 게임을 고치면서 매번 룰렛을 돌릴 수는 없다.
  var FORCED_GAME = qs('game', null);

  // 결과 화면에 머무는 시간(초). 점수 카운트업과 폭죽이 끝날 만큼은 준다.
  var RESULT_SEC = 6;

  // 한 세션은 5판이다 (PROJECT.md 9장). ?rounds=3 으로 줄여서 시험할 수 있다.
  var ROUNDS = Math.max(1, parseInt(qs('rounds', '5'), 10) || 5);

  // 보드에서 말이 한 칸 가는 데 걸리는 시간(초). 빠르면 어디로 갔는지 못 쫓는다.
  var BOARD_STEP_SEC = 0.34;
  var BOARD_HOLD_SEC = 2.2;

  function findPlayer(id) {
    for (var i = 0; i < tv.players.length; i++) {
      if (tv.players[i].id === id) return tv.players[i];
    }
    return null;
  }

  /** 끊긴 폰을 돌려보내는 시간(초). 이보다 오래 안 오면 명단에서 지운다. */
  var GONE_SEC = 45;

  function here(p) { return !p.gone; }

  function allReady() {
    var n = 0;
    for (var i = 0; i < tv.players.length; i++) {
      if (!here(tv.players[i])) continue;   // 끊긴 사람을 기다리며 멈추지 않는다
      if (!tv.players[i].ready) return false;
      n++;
    }
    return n > 0;
  }

  /** 돌아오지 않은 폰을 정리한다. 명단에 유령이 남으면 준비 대기가 영영 안 끝난다. */
  function sweepPlayers() {
    for (var i = tv.players.length - 1; i >= 0; i--) {
      var p = tv.players[i];
      if (p.gone && tv.clock - p.gone > GONE_SEC) {
        note('drop ' + p.name);
        tv.players.splice(i, 1);
        delete session.pieces[p.id];
      }
    }
  }

  function goto(screen) {
    // 방금 끝낸 게임을 기억한다. 룰렛이 같은 것을 연달아 뽑지 않게 하는 근거다.
    if (screen === 'result' && tv.gameId) tv.lastGameId = tv.gameId;
    tv.screen = screen;
    tv.t = 0;
    tv._countStep = -1;    // 카운트다운 소리를 초마다 한 번만 내기 위한 표식
    tv._resultDone = false;
    // 폰은 미니게임을 모른다. 어떤 동작을 켤지 여기서 같이 알려준다.
    if (tv.net) tv.net.phase(screen, tv.gameId, tv.game ? tv.game.motion : null);
  }

  /* 통신 */

  function connect() {
    var useDev = GP.devlink && GP.devlink.enabled();

    tv.net = new GP.net.Net({
      url: qs('relay', GP.net.defaultUrl()),
      role: 'tv',
      socketFactory: useDev ? GP.devlink.factory : undefined
    });

    tv.net.on('status', function (s) { tv.status = s.status; });

    tv.net.on('room', function (m) { tv.code = m.code; });

    tv.net.on('open', function () {
      tv.net.createRoom();
      // 재접속이면 지금 화면을 다시 알려준다. 폰이 엉뚱한 UI에 멈춰 있지 않게.
      tv.net.phase(tv.screen, tv.gameId, tv.game ? tv.game.motion : null);
    });

    // 폰이 방에 들어왔다. 지금 화면이 무엇인지 알려준다.
    // 폰은 아직 아무것도 모르는 상태이며, 이 응답이 없으면 틀린 코드로 판단한다.
    tv.net.on('hello', function () {
      tv.net.phase(tv.screen, tv.gameId, tv.game ? tv.game.motion : null);
    });

    tv.net.on('join', function (m) {
      var id = m.from || 'p1';
      var p = findPlayer(id);
      if (!p) {
        p = { id: id, name: m.name || '플레이어', 'char': m['char'] || 'lhat',
              ready: false, score: 0, joinedAt: tv.t, gone: 0 };
        tv.players.push(p);
      } else {
        p.name = m.name || p.name;
        p['char'] = m['char'] || p['char'];
        p.gone = 0;                 // 돌아왔다. 점수도 보드 위 말도 그대로다
      }
      note('join ' + p.name + ' (' + p['char'] + ')');
      if (tv.screen === 'wait') goto('char');
    });

    tv.net.on('ready', function (m) {
      var p = findPlayer(m.from || 'p1');
      if (p) p.ready = true;
      note('ready ' + (p ? p.name : '?'));
      // 게임이 셋 이상이 된 시점부터는 "무엇을 할지 고르는 화면"이 필요하다 (phase6).
      if (tv.screen === 'char' && allReady()) {
        if (FORCED_GAME) startGame(FORCED_GAME);
        else toSelect();
      }
    });

    /**
     * 폰이 끊겼다. **바로 지우지 않는다.**
     *
     * 게임 중에 폰이 잠깐 끊기는 일(전화, 앱 전환, 지하철)은 실제로 자주 생긴다.
     * 그때 명단에서 지워버리면 점수도 보드 위의 말도 같이 사라진다.
     * 자리만 비워두고 GONE_SEC 안에 돌아오면 그대로 이어 붙인다.
     */
    tv.net.on('leave', function (m) {
      var p = findPlayer(m.from || 'p1');
      if (p) { p.gone = tv.clock; note('leave ' + p.name); }
    });

    tv.net.on('calib', function (m) {
      tv.calib[m.from || 'p1'] = m.v && m.v.progress !== undefined ? m.v.progress : 1;
      if (tv.screen === 'calib' && calibDone()) goto('count');
    });

    tv.net.on('motion', function (m) {
      note(m.a + ' p=' + (m.p !== undefined ? m.p.toFixed(2) : '?'));
      if (tv.screen === 'play' && tv.game && tv.game.onMotion) tv.game.onMotion(m);
      else if (tv.screen === 'select') selectMotion(m);
      // 파티가 끝난 화면에서 흔들면 새 세션을 연다. 어른이 리모컨을 찾을 일이 없게.
      else if (tv.screen === 'final' && tv.t > 3) { resetSession(); toSelect(); }
    });

    tv.net.on('tilt', function (m) {
      if (tv.screen === 'play' && tv.game && tv.game.onTilt) tv.game.onTilt(m);
      else if (tv.screen === 'select') selectTilt(m);
    });

    tv.net.connect();
  }

  function calibDone() {
    var n = 0;
    for (var i = 0; i < tv.players.length; i++) {
      if (!here(tv.players[i])) continue;
      if ((tv.calib[tv.players[i].id] || 0) < 1) return false;
      n++;
    }
    return n > 0;
  }

  function note(s) {
    tv.log.push({ t: tv.t, s: s });
    if (tv.log.length > 12) tv.log.shift();
  }

  /* 게임 선택 / 룰렛 (PROJECT.md 7장) */

  var ROULETTE = {
    LOOPS: 2,          // 목표에 닿기 전에 도는 바퀴 수
    SPIN_SEC: 2.4,     // 도는 시간. 짧으면 뽑는 맛이 없고 길면 5세가 기다리지 못한다
    HOLD_SEC: 1.0,     // 멈춘 뒤 보여주는 시간
    AUTO_SEC: 12       // 아무도 안 흔들면 알아서 돌린다. 멈춘 화면이 제일 나쁘다
  };

  var roul = {
    phase: 'idle',     // idle | spin | landed
    t0: 0,
    from: 0,
    travel: 0,
    target: null,
    cursor: 0,
    pick: 0            // 직접 선택용 커서 (기울기로 움직인다)
  };

  GP.tv.roulette = roul;

  function startSpin() {
    if (roul.phase !== 'idle') return;
    var vis = GP.games.visible();
    var target = GP.games.roll(tv.lastGameId);
    var ti = vis.indexOf(target);
    if (ti < 0) return;

    roul.phase = 'spin';
    roul.t0 = tv.t;
    roul.from = roul.cursor;
    roul.target = target;
    roul.travel = ROULETTE.LOOPS * vis.length +
                  ((ti - Math.floor(roul.cursor) % vis.length) + vis.length) % vis.length;
    fx('count');
  }

  /** 폰을 흔들면(점프 판정) 룰렛이 돈다. 쳐올리면 지금 가리키는 카드를 그대로 고른다. */
  function selectMotion(m) {
    if (roul.phase !== 'idle') return;
    if (m.a === 'punch') {
      var vis = GP.games.visible();
      startGame(vis[roul.pick % vis.length]);
      return;
    }
    startSpin();
  }

  /** 어른이 카드를 가리키는 용도. 5세는 룰렛만 쓴다. */
  function selectTilt(m) {
    if (roul.phase !== 'idle') return;
    var vis = GP.games.visible();
    var v = m.v || 0;
    var idx = Math.round((v + 1) / 2 * (vis.length - 1));
    roul.pick = Math.max(0, Math.min(vis.length - 1, idx));
    roul.cursor = roul.pick;
  }

  /* 세션 — 5판을 하나의 파티로 묶는다 (js/board.js) */

  var session = {
    round: 0,             // 끝난 판 수
    pieces: {}            // playerId -> { pos, stars, steps, shown }
  };
  GP.tv.session = session;

  var boardAnim = { plan: [], i: 0, k: 0, acc: 0, done: false };

  function pieceOf(id) {
    if (!session.pieces[id]) {
      var p = GP.board.newPiece();
      p.shown = 0;
      session.pieces[id] = p;
    }
    return session.pieces[id];
  }

  function resetSession() {
    session.round = 0;
    session.pieces = {};
    tv.lastGameId = null;
  }

  /**
   * 판 결과를 보드 이동으로 옮긴다.
   *
   * 이동은 여기서 한 번에 계산하고, 화면은 계산 결과를 한 칸씩 재생만 한다.
   * 계산과 연출을 섞으면 프레임이 튈 때 결과가 달라진다.
   */
  function beginBoard() {
    var scores = (tv.game && tv.game.getScore) ? tv.game.getScore() : [];
    var rk = GP.board.ranks(scores);
    var par = tv.game ? tv.game.par : 0;

    session.round++;
    boardAnim = { plan: [], i: 0, k: 0, acc: 0, done: false };

    for (var i = 0; i < scores.length; i++) {
      var id = scores[i].from;
      var piece = pieceOf(id);
      var from = piece.pos;
      var before = piece.steps || 0;
      var n = GP.board.stepsFor(rk[id], scores[i].score, par);
      var events = GP.board.advance(piece, n);

      piece.shown = from;
      boardAnim.plan.push({
        id: id,
        from: from,
        moved: (piece.steps || 0) - before,
        events: events
      });
    }

    goto('board');
  }

  function updateBoard(dt) {
    var a = boardAnim;
    if (a.done) {
      if (tv.t > BOARD_HOLD_SEC + a.finishedAt) {
        if (session.round >= ROUNDS) goto('final');
        else toSelect();
      }
      return;
    }
    if (!a.plan.length) { a.done = true; a.finishedAt = tv.t; return; }

    a.acc += dt;
    if (a.acc < BOARD_STEP_SEC) return;
    a.acc = 0;

    var cur = a.plan[a.i];
    var piece = pieceOf(cur.id);

    if (a.k < cur.moved) {
      a.k++;
      piece.shown = (cur.from + a.k) % GP.board.TUNE.CELLS;

      var kind = GP.board.types[piece.shown];
      if (kind === 'star') fx('star', cur.id);
      else if (kind === 'bowser') fx('hit', cur.id);
      else fx('step', cur.id);
      return;
    }

    a.i++;
    a.k = 0;
    if (a.i >= a.plan.length) {
      a.done = true;
      a.finishedAt = tv.t;
    }
  }

  function toSelect() {
    roul.phase = 'idle';
    roul.target = null;
    roul.cursor = 0;
    roul.pick = 0;
    goto('select');
  }

  function updateSelect(dt) {
    var vis = GP.games.visible();
    if (!vis.length) return;

    if (roul.phase === 'idle') {
      // 아무도 안 흔들면 알아서 돌린다. 멈춰 있는 화면이 제일 나쁘다.
      if (tv.t > ROULETTE.AUTO_SEC) startSpin();
      return;
    }

    if (roul.phase === 'spin') {
      var k = Math.min((tv.t - roul.t0) / ROULETTE.SPIN_SEC, 1);
      var e = 1 - Math.pow(1 - k, 3);        // 빠르게 돌다 감속
      roul.cursor = roul.from + roul.travel * e;
      if (k >= 1) {
        roul.phase = 'landed';
        roul.t0 = tv.t;
        roul.cursor = vis.indexOf(roul.target);
        fx('go');
      }
      return;
    }

    if (roul.phase === 'landed' && tv.t - roul.t0 > ROULETTE.HOLD_SEC) {
      startGame(roul.target);
    }
  }

  /* 게임 시작 흐름 */

  function startGame(id) {
    id = id || FORCED_GAME || GP.games.visible()[0];
    tv.gameId = id;
    tv.game = GP.games.get(id);
    if (!tv.game) { goto('wait'); return; }
    roul.phase = 'idle';
    goto('demo');
  }

  /**
   * 게임이 쓰는 피드백 통로.
   *
   * 소리는 TV에서 내고, 진동은 폰에서 낸다 — 조카는 동작 중에 폰 화면을 볼 수 없다
   * (PROJECT.md 7장). 게임 코드가 통신 형식을 알 필요가 없도록 여기서 묶는다.
   *
   * to를 주면 그 폰만 떨게 한다. 릴레이는 TV 메시지를 방 전체에 뿌리므로
   * 걸러내는 것은 폰 쪽(js/play.js)이다.
   */
  function fx(name, to) {
    var heard = false;
    if (GP.sfx) {
      GP.sfx.play(name);
      heard = GP.sfx.audible();
    }
    // TV에서 소리가 안 나면(자동재생 정책) 폰에게 대신 내달라고 한다.
    // TV는 입력을 받지 않아 제스처를 만들 수가 없다 — 폰은 코드를 누르며 이미 만들었다.
    if (tv.net) tv.net.send({ t: 'fx', v: name, to: to || null, snd: heard ? 0 : 1 });
  }

  function beginPlay() {
    tv.calib = {};
    if (tv.game.init) {
      tv.game.init({
        config: C,
        tuning: GP.tuning,
        chars: GP.chars,
        gfx: GP.gfx,
        players: tv.players,
        note: note,
        fx: fx,
        end: function () { goto('result'); }
      });
    }
    goto('play');
  }

  /* 그리기 도우미 */

  function bg(ctx, color) {
    ctx.fillStyle = color || '#101828';
    ctx.fillRect(0, 0, C.WIDTH, C.HEIGHT);
  }

  function center(ctx, text, y, size, color) {
    ctx.fillStyle = color || '#ffffff';
    ctx.font = 'bold ' + size + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text, C.WIDTH / 2, y);
    ctx.textAlign = 'left';
  }

  /* 화면별 그리기 */

  // 동작을 나타내는 기호. 폰 화면(js/play.js ICON)과 같은 글자를 쓴다 —
  // TV에서 본 기호가 폰에 그대로 있어야 조카가 둘을 잇는다.
  var MOTION_GLYPH = { jump: '↑', squat: '↓', punch: '✊', tilt: '↔', all: '●' };

  // 화면 -> BGM 루프 (js/sfx.js). 적어두지 않은 화면은 로비 곡을 쓴다.
  var BGM_FOR = {
    wait: 'lobby', char: 'lobby', select: 'select', demo: 'lobby', calib: 'lobby',
    count: 'select', play: 'play', result: 'result', board: 'board', final: 'result'
  };

  var screens = {

    wait: function (ctx) {
      bg(ctx);
      center(ctx, '방 코드', SAFE.y + 90, 44, '#8ea2c0');

      // 코드는 화면 1/3 크기. 소파에서 읽혀야 한다 (PROJECT.md 7장).
      center(ctx, tv.code, SAFE.y + 300, Math.round(C.HEIGHT / 3), '#ffd23b');

      center(ctx, '폰으로 숫자를 입력하세요', C.HEIGHT - SAFE.y - 60, 34, '#8ea2c0');
      drawPlayers(ctx, C.HEIGHT - SAFE.y - 180);
    },

    char: function (ctx) {
      bg(ctx);
      center(ctx, '캐릭터 고르기', SAFE.y + 70, 46, '#ffffff');

      var list = GP.chars.list;
      var gap = SAFE.w / list.length;
      for (var i = 0; i < list.length; i++) {
        var x = SAFE.x + gap * (i + 0.5);
        var taken = null;
        for (var j = 0; j < tv.players.length; j++) {
          if (tv.players[j]['char'] === list[i].id) taken = tv.players[j];
        }
        GP.chars.draw(ctx, list[i].id, x, C.HEIGHT * 0.66, 240, 'idle');
        center2(ctx, list[i].name, x, C.HEIGHT * 0.66 + 46, 28, taken ? '#ffd23b' : '#5a6b85');
        if (taken) center2(ctx, taken.name, x, C.HEIGHT * 0.66 + 82, 24, '#ffd23b');
      }
      center(ctx, allReady() ? '시작합니다' : '폰에서 준비를 누르세요', C.HEIGHT - SAFE.y - 30, 30, '#8ea2c0');
    },

    /**
     * 미니게임 고르기.
     *
     * 글자가 아니라 색과 큰 기호로 구분한다. 5세는 글자를 못 읽는다 (PROJECT.md 10장).
     * 뽑히지 않는 카드(직전에 한 것, 힘든 게임 연속)는 어둡게 둔다 —
     * 어른은 그래도 직접 고를 수 있다.
     */
    select: function (ctx) {
      bg(ctx, '#141d33');
      center(ctx, '무슨 놀이 할까?', SAFE.y + 64, 44, '#ffffff');

      var vis = GP.games.visible();
      var pool = GP.games.pool(tv.lastGameId);
      var n = vis.length || 1;
      var cw = Math.min(260, SAFE.w / n - 20);
      var ch = 300;
      var cy = C.HEIGHT * 0.5 - ch / 2;
      var gap = SAFE.w / n;
      var here = ((Math.floor(roul.cursor) % n) + n) % n;

      for (var i = 0; i < vis.length; i++) {
        var g = GP.games.get(vis[i]);
        var x = SAFE.x + gap * (i + 0.5) - cw / 2;
        var live = pool.indexOf(vis[i]) >= 0;

        ctx.fillStyle = live ? (g.color || '#2f6fd0') : '#26314a';
        ctx.fillRect(x, cy, cw, ch);

        // 어떤 동작인지 큰 기호로. 글자보다 먼저 읽힌다.
        ctx.textAlign = 'center';
        ctx.fillStyle = live ? '#ffffff' : '#4a5b78';
        ctx.font = 'bold 120px sans-serif';
        ctx.fillText(MOTION_GLYPH[g.motion] || '●', x + cw / 2, cy + ch * 0.58);

        ctx.font = 'bold 28px sans-serif';
        ctx.fillStyle = live ? '#ffffff' : '#5a6b85';
        ctx.fillText(g.name, x + cw / 2, cy + ch - 28);
        ctx.textAlign = 'left';

        // 룰렛 커서
        if (i === here) {
          ctx.strokeStyle = roul.phase === 'landed' ? '#3bff7a' : '#ffd23b';
          ctx.lineWidth = 10;
          ctx.strokeRect(x - 8, cy - 8, cw + 16, ch + 16);
        }
      }

      center(ctx,
             roul.phase === 'idle' ? '폰을 흔들면 돌아갑니다' : '',
             C.HEIGHT - SAFE.y - 30, 28, '#8ea2c0');
    },

    demo: function (ctx) {
      bg(ctx);
      center(ctx, tv.game ? tv.game.name : '', SAFE.y + 70, 46, '#ffffff');

      // 글자 대신 캐릭터가 동작을 반복한다. 텍스트 설명은 어른용으로 작게.
      var chr = tv.players.length ? tv.players[0]['char'] : 'lhat';
      if (tv.game && tv.game.demo) tv.game.demo(ctx, tv.t, chr);
      else demoPose(ctx, chr, tv.game ? tv.game.motion : 'jump', tv.t);

      if (tv.game && tv.game.hint) {
        center(ctx, tv.game.hint, C.HEIGHT - SAFE.y - 20, 22, '#5a6b85');
      }
      if (tv.t > 3) goto('calib');
    },

    calib: function (ctx) {
      bg(ctx);

      // 쥐는 법이 다른 게임이 있다. 레이싱은 가슴에 대면 핸들을 돌릴 수가 없다 (phase8).
      // 기준 자세가 실제 플레이 자세와 다르면 보정값이 통째로 어긋난다.
      var hint = (tv.game && tv.game.calibHint) || ['폰을 가슴에 대고', '똑바로 서세요'];
      center(ctx, hint[0], SAFE.y + 140, 56, '#ffffff');
      center(ctx, hint[1] || '', SAFE.y + 220, 56, '#ffffff');

      var r = 0, n = 0;
      for (var i = 0; i < tv.players.length; i++) {
        r += tv.calib[tv.players[i].id] || 0; n++;
      }
      var pct = n ? r / n : 0;

      var bw = SAFE.w * 0.6, bx = (C.WIDTH - bw) / 2, by = C.HEIGHT * 0.6;
      ctx.fillStyle = '#26314a';
      ctx.fillRect(bx, by, bw, 40);
      ctx.fillStyle = '#3bff7a';
      ctx.fillRect(bx, by, bw * pct, 40);

      center(ctx, '미니게임마다 다시 맞춥니다', C.HEIGHT - SAFE.y - 30, 24, '#5a6b85');
    },

    count: function (ctx) {
      bg(ctx);
      var n = 3 - Math.floor(tv.t);
      var label = n > 0 ? String(n) : 'GO';
      var k = tv.t - Math.floor(tv.t);

      // 초가 바뀌는 순간에만 소리를 낸다. render는 매 프레임 불린다.
      var step = Math.floor(tv.t);
      if (step !== tv._countStep) {
        tv._countStep = step;
        if (step < 3) fx('count');
        else if (step === 3) fx('go');
      }

      center(ctx, label, C.HEIGHT * 0.62, Math.round(220 + (1 - k) * 60), n > 0 ? '#ffffff' : '#3bff7a');
      if (tv.t > 4) beginPlay();
    },

    play: function (ctx) {
      if (tv.game && tv.game.render) tv.game.render(ctx);
      else { bg(ctx); center(ctx, '게임 없음', C.HEIGHT / 2, 48, '#ff3b3b'); }
    },

    result: function (ctx) {
      bg(ctx, '#141d33');

      if (!tv._resultDone) {
        tv._resultDone = true;
        fx('fanfare');
        popConfetti();
      }
      center(ctx, '결과', SAFE.y + 70, 48, '#ffffff');

      var scores = (tv.game && tv.game.getScore) ? tv.game.getScore() : [];
      var gap = SAFE.w / Math.max(scores.length, 1);
      for (var i = 0; i < scores.length; i++) {
        var p = findPlayer(scores[i].from) || { 'char': 'lhat', name: '?' };
        var x = SAFE.x + gap * (i + 0.5);
        // 시상대. 꼴등은 없다 (PROJECT.md 6장).
        ctx.fillStyle = '#2f3f60';
        ctx.fillRect(x - 90, C.HEIGHT * 0.72, 180, 120);
        GP.chars.draw(ctx, p['char'], x, C.HEIGHT * 0.72, 220, 'idle');
        center2(ctx, p.name, x, C.HEIGHT * 0.72 + 60, 30, '#ffffff');

        // 점수 카운트업. 1.2초에 걸쳐 올라간다 — 숫자가 튀어나오면 본 것 같지가 않다.
        var shown = Math.round(scores[i].score * Math.min(tv.t / 1.2, 1));
        center2(ctx, String(shown), x, C.HEIGHT * 0.72 + 100, 40, '#ffd23b');
      }
      center(ctx, '모두 완주!', C.HEIGHT * 0.45, 60, '#3bff7a');
      confetti.render(ctx);
    },

    /**
     * 보드. 판 결과가 여기서 칸 수로 바뀐다 (js/board.js).
     * 말이 한 칸씩 가는 것을 눈으로 쫓을 수 있어야 "내가 잘해서 갔다"가 성립한다.
     */
    board: function (ctx) {
      bg(ctx, '#101b30');

      var r = { x: SAFE.x + 90, y: SAFE.y + 110, w: SAFE.w - 180, h: SAFE.h - 240 };
      var pts = GP.board.layout(r);
      var i;

      // 칸
      for (i = 0; i < pts.length; i++) {
        var p = pts[i];
        var rad = p.type === 'star' ? 26 : 20;
        ctx.fillStyle = p.type === 'star' ? '#ffd23b'
                      : p.type === 'bowser' ? '#3f8f3a'
                      : p.type === 'start' ? '#ffffff' : '#2f3f60';
        ctx.beginPath();
        ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
        ctx.fill();
      }

      // 말. 같은 칸에 여럿이면 조금씩 어긋나게 둔다 — 겹치면 하나로 보인다.
      var atCell = {};
      for (i = 0; i < tv.players.length; i++) {
        var pl = tv.players[i];
        var pc = pieceOf(pl.id);
        var cell = pts[pc.shown % pts.length];
        var k = atCell[pc.shown] || 0;
        atCell[pc.shown] = k + 1;
        // 칸 위에 선다. 칸을 덮고 서면 무슨 칸에 있는지가 안 보인다.
        GP.chars.draw(ctx, pl['char'], cell.x + k * 26 - 12, cell.y - 6, 92, 'idle');
      }

      center(ctx, session.round + ' / ' + ROUNDS + ' 판', SAFE.y + 56, 40, '#8ea2c0');
      drawStars(ctx, C.HEIGHT - SAFE.y - 44);
    },

    /** 최종 결과. 별이 먼저, 같으면 더 많이 간 쪽 (js/board.js standings). */
    final: function (ctx) {
      bg(ctx, '#141d33');

      if (!tv._resultDone) {
        tv._resultDone = true;
        fx('fanfare');
        popConfetti();
      }

      var list = GP.board.standings(session.pieces);
      center(ctx, '오늘의 파티', SAFE.y + 60, 46, '#8ea2c0');

      var gap = SAFE.w / Math.max(list.length, 1);
      for (var i = 0; i < list.length; i++) {
        var p = findPlayer(list[i].from) || { 'char': 'lhat', name: '?' };
        var x = SAFE.x + gap * (i + 0.5);
        // 1등만 단을 높인다. 나머지도 단 위에 선다 — 꼴등 자리는 만들지 않는다.
        var podium = list[i].rank === 0 ? 170 : 110;
        var top = C.HEIGHT - SAFE.y - podium;
        ctx.fillStyle = list[i].rank === 0 ? '#ffd23b' : '#2f3f60';
        ctx.fillRect(x - 95, top, 190, podium);
        GP.chars.draw(ctx, p['char'], x, top, 230, 'idle');

        // 별은 머리 위, 어두운 배경에 올린다. 금색 단 위에 금색 별을 쓰면 안 보인다.
        center2(ctx, starText(list[i].stars), x, top - 250, 40, '#ffd23b');
        // 단 색이 밝으면 이름은 어두운 글자로. 대비를 색 하나에 맡기지 않는다.
        center2(ctx, p.name, x, top + 48, 30, list[i].rank === 0 ? '#3a2b00' : '#ffffff');
      }

      center(ctx, '폰을 흔들면 다시 해요', SAFE.y + 120, 30, '#8ea2c0');
      confetti.render(ctx);
    }
  };

  /* 결과 화면 폭죽. 미리 그린 조각을 포물선으로 던지는 것뿐이다 (PROJECT.md 2장) */

  var confetti = new (GP.gfx.Particles)(C.MAX_PARTICLES);
  var CONFETTI_COLORS = ['#ffd23b', '#3bff7a', '#4b7be3', '#ff6b6b', '#ffffff', '#f2b6d0'];

  function popConfetti() {
    GP.gfx.sheet('confetti', CONFETTI_COLORS.length, 18, 18, function (c2, i) {
      c2.fillStyle = CONFETTI_COLORS[i];
      c2.save();
      c2.translate(9, 9);
      c2.rotate(i * 0.5);
      c2.fillRect(-7, -4, 14, 8);
      c2.restore();
    });
    confetti.clear();
    for (var i = 0; i < C.MAX_PARTICLES; i++) {
      var x = C.WIDTH * (0.15 + 0.7 * (i / C.MAX_PARTICLES));
      confetti.spawn(x, C.HEIGHT * 0.35,
                     (Math.random() - 0.5) * 260,
                     -260 - Math.random() * 220,
                     2.4, 'confetti');
    }
  }

  /** 별은 숫자보다 개수로 보여준다. 5세는 ★★★을 3보다 빨리 읽는다. */
  function starText(n) {
    if (n <= 0) return '·';
    if (n <= 5) {
      var s = '';
      for (var i = 0; i < n; i++) s += '★';
      return s;
    }
    return '★ ' + n;
  }

  /** 보드 아래 별 현황 한 줄. */
  function drawStars(ctx, y) {
    var gap = SAFE.w / Math.max(tv.players.length, 1);
    for (var i = 0; i < tv.players.length; i++) {
      var p = tv.players[i];
      var pc = pieceOf(p.id);
      center2(ctx, p.name + '  ' + starText(pc.stars), SAFE.x + gap * (i + 0.5), y, 30,
              pc.stars ? '#ffd23b' : '#8ea2c0');
    }
  }

  function center2(ctx, text, x, y, size, color) {
    ctx.fillStyle = color || '#fff';
    ctx.font = 'bold ' + size + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text, x, y);
    ctx.textAlign = 'left';
  }

  function drawPlayers(ctx, y) {
    var gap = 200;
    var x0 = C.WIDTH / 2 - (tv.players.length - 1) * gap / 2;
    for (var i = 0; i < tv.players.length; i++) {
      var p = tv.players[i];
      // 접속 순간 아래에서 올라오는 등장 연출
      var age = Math.min((tv.t - p.joinedAt) / 0.4, 1);
      var lift = (1 - age) * 80;
      GP.chars.draw(ctx, p['char'], x0 + i * gap, y + lift, 150, 'idle');
      // 끊긴 사람은 이름을 흐리게 둔다. 사라지지는 않는다 — 돌아올 자리다.
      center2(ctx, p.gone ? p.name + ' (끊김)' : p.name, x0 + i * gap, y + 34 + lift, 26,
              p.gone ? '#5a6b85' : (p.ready ? '#3bff7a' : '#8ea2c0'));
    }
  }

  /** 게임이 시연 그림을 안 주면 기본 자세 반복을 쓴다. */
  function demoPose(ctx, chr, motion, t) {
    var cycle = (t % 1.2) / 1.2;
    var pose = 'idle';
    if (motion === 'jump') pose = cycle < 0.5 ? 'jump' : 'idle';
    else if (motion === 'squat') pose = cycle < 0.5 ? 'squat' : 'idle';
    else if (motion === 'punch') pose = cycle < 0.35 ? 'punch' : 'idle';

    var x = C.WIDTH / 2;
    if (motion === 'tilt') x += Math.sin(t * 2) * 220;
    GP.chars.draw(ctx, chr, x, C.HEIGHT * 0.78, 320, pose);
  }

  /* 연결 상태 표시 — 어느 화면에서든 위에 덮어 그린다 */

  function drawStatus(ctx) {
    // 튜닝을 덮어쓴 채로 돌고 있으면 그 사실을 항상 보이게 둔다.
    // 켜둔 걸 잊고 "왜 이상하지"를 하는 상황이 제일 나쁘다.
    if (GP.tune && GP.tune.has()) {
      ctx.textAlign = 'right';
      ctx.fillStyle = GP.tune.rejected().length ? '#ff7b72' : '#ffd23b';
      ctx.font = 'bold 20px monospace';
      ctx.fillText(GP.tune.summary(), C.WIDTH - SAFE.x, C.HEIGHT - 10);
      ctx.textAlign = 'left';
    }

    if (tv.status === 'open') return;
    var msg = tv.status === 'connecting' ? '서버에 연결 중'
            : tv.status === 'reconnecting' ? '연결이 끊겼습니다. 다시 연결 중'
            : '연결 없음';
    ctx.fillStyle = 'rgba(180,20,20,0.9)';
    ctx.fillRect(0, C.HEIGHT * 0.42, C.WIDTH, 110);
    center(ctx, msg, C.HEIGHT * 0.42 + 70, 44, '#ffffff');
  }

  // 시험이 화면을 하나씩 그려보기 위한 자리.
  // 안전영역 밖으로 나간 글자와 fillText 개수는 눈으로 세면 반드시 놓친다 (phase9).
  GP.tv._test = {
    screens: screens,
    beginBoard: beginBoard,
    toSelect: toSelect,
    pieceOf: pieceOf,
    resetSession: resetSession,
    GONE_SEC: GONE_SEC,
    sweepPlayers: sweepPlayers,
    here: here,
    allReady: allReady,
    calibDone: calibDone
  };

  /* 시작 */

  GP.tv.start = function (canvas) {
    var ctx = canvas.getContext('2d');

    // 그림을 받기 시작한다. 기다리지 않는다 — 도착할 때까지는 임시 도형으로 그려진다.
    if (GP.assets) GP.assets.boot(GP.assetManifest);

    // 주소로 넘어온 게임별 튜닝을 적용한다 (js/tuning.js 현장 오버라이드).
    // 판정 임계값(GP.tuning)은 tuning.js가 스스로 적용하고, 게임 값은 여기서 붙인다 —
    // 게임이 다 등록된 뒤여야 하기 때문이다.
    if (GP.tune) {
      var ids = GP.games.ids();
      for (var gi = 0; gi < ids.length; gi++) {
        var g = GP.games.get(ids[gi]);
        if (g && g.tune) GP.tune.apply(g.tune, ids[gi]);
      }
      // 도로 렌더러는 게임이 아니라 공용 부품이다. 짧은 이름으로 따로 연다 —
      // 프레임이 모자라면 조카 집 TV 리모컨으로 ?tune=road.DRAW_SEGS:70 을 친다 (phase8).
      if (GP.pseudo3d) GP.tune.apply(GP.pseudo3d.TUNE, 'road');
    }

    // devicePixelRatio를 곱하지 않는다. TV에서 backing store를 키우면 그대로 부하가 된다.
    canvas.width = C.WIDTH;
    canvas.height = C.HEIGHT;

    connect();

    GP.loop.start({
      ctx: ctx,
      update: function (dt) {
        tv.t += dt;
        tv.clock += dt;      // 화면이 바뀌어도 안 끊기는 시계. 끊긴 폰을 재는 데 쓴다
        sweepPlayers();

        if (tv.screen === 'result') {
          confetti.update(dt);
          // 결과를 보여준 뒤 다음 게임을 고르러 돌아간다. 세션이 여기서 이어진다.
          if (tv.t > RESULT_SEC) {
            if (FORCED_GAME) startGame(FORCED_GAME);
            else beginBoard();
          }
        }

        if (tv.screen === 'board') updateBoard(dt);
        if (tv.screen === 'final') confetti.update(dt);

        if (tv.screen === 'select') updateSelect(dt);

        if (tv.screen === 'play' && tv.game) {
          if (tv.game.update) tv.game.update(dt);
          // 한 판 90초 (PROJECT.md 10장). 길면 폰을 내려놓고 다른 데로 간다.
          // 게임이 먼저 끝내고 싶으면 api.end()를 부른다.
          if (tv.t >= (tv.game.duration || 90)) goto('result');
        }
      },
      render: function (ctx) {
        (screens[tv.screen] || screens.wait)(ctx);
        drawStatus(ctx);

        // BGM은 화면 성격을 따라간다. 같은 이름이면 끊기지 않는다.
        if (GP.sfx) GP.sfx.bgm(BGM_FOR[tv.screen] || 'lobby');
      }
    });

    return tv;
  };

})(window);
