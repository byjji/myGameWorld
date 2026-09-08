/**
 * 줄넘기 (PROJECT.md 5-1)
 *
 * 첫 수직 슬라이스. 게임이 쉬워서 먼저 만드는 것이 아니라, 이 한 판에서
 * 통신 지연 · 센서 권한 · TV 연결 · 조카의 실제 반응이 한꺼번에 드러나기 때문이다.
 *
 * 화면 구조가 가장 싼 게임이기도 하다.
 *   - 캐릭터 제자리 고정. 카메라 이동도 스크롤도 없다
 *   - 배경은 정지 화면. 매 프레임 그리는 것은 사각형 몇 개뿐
 *   - 줄은 미리 그려둔 프레임을 blit 한다. 곡선을 실시간으로 계산하지 않는다
 *
 * 판정에서 정한 것 하나:
 * **타이밍이 어긋난 점프는 실패로 치지 않고 그냥 무시한다.**
 * 걸리는 것은 한 바퀴를 통째로 놓쳤을 때뿐이다. 5세에게 "일찍 뛰었다"는 이유로
 * 벌을 주면 몇 번 만에 그만둔다 (PROJECT.md 10장).
 *
 * 문법 수준: ES5
 */
(function (global) {
  'use strict';

  var GP = global.GP;
  var C = GP.config;

  /* ── 튜닝 값 ──────────────────────────────────────────
     코드 문제가 아니라 조카 표정을 보고 정하는 숫자다. 전부 여기 모아둔다. */
  var TUNE = {
    PERIOD_START: 1.70,   // 한 바퀴에 걸리는 시간(초). 느리게 시작한다
    PERIOD_DEC:   0.09,   // 10개마다 줄어드는 양
    PERIOD_MIN:   0.85,   // 아무리 빨라져도 이보다는 느리게
    SPEED_STEP:   10,     // 몇 개마다 가속할지 (PROJECT.md 5-1)

    WINDOW_SEC:   0.42,   // 판정 창 ±초. 넉넉하게. 5세 기준
    WINDOW_MAX_PHASE: 0.45, // 창이 한 바퀴를 다 먹지 않게 하는 상한

    TRIP_SEC:     0.7,    // 걸렸을 때 멈춰 있는 시간. 짧게. 게임오버는 없다
    TARGET:       60,     // 이 개수에 닿으면 일찍 끝낸다
    ROPE_FRAMES:  16      // 줄 프리렌더 프레임 수
  };

  var api = null;
  var t = 0;
  var ropeT = 0;          // 줄이 돈 바퀴 수. 정수 지점이 발밑을 지나는 순간
  var best = 0;           // 가속 판단에 쓰는 최고 점수 (줄은 하나뿐이다)
  var st = {};            // playerId -> 상태
  var pop = [];           // 짧은 글자 연출

  var ROPE_W = 1000, ROPE_H = 420;
  var ROPE_EDGE = 24;                 // 줄이 시트 가장자리를 넘지 않게 남기는 여백
  var GROUND_Y = Math.round(C.HEIGHT * 0.80);

  // 줄이 가장 아래로 내려온 순간이 정확히 발밑(GROUND_Y)에 오도록 시트 중심을 잡는다.
  // 여기가 어긋나면 "줄이 발에 닿을 때 뛴다"는 인과가 화면과 맞지 않는다.
  var ROPE_CY = GROUND_Y + ROPE_EDGE - ROPE_H / 2;

  function pid(m) { return m.from || 'p1'; }

  function state(id) {
    if (!st[id]) {
      st[id] = {
        score: 0, combo: 0, bestCombo: 0,
        judged: 1,        // 다음에 판정할 바퀴 번호
        scored: {},       // 이미 점수를 준 바퀴
        tripAt: -99,      // 마지막으로 걸린 시각
        jumpAt: -99       // 마지막 점프 시각 (자세 그리기용)
      };
    }
    return st[id];
  }

  function period() {
    var p = TUNE.PERIOD_START - Math.floor(best / TUNE.SPEED_STEP) * TUNE.PERIOD_DEC;
    return Math.max(TUNE.PERIOD_MIN, p);
  }

  /** 판정 창을 바퀴 비율로 환산한다. 빨라질수록 창도 같이 좁아지면 안 되므로 상한만 건다. */
  function windowPhase() {
    return Math.min(TUNE.WINDOW_SEC / period(), TUNE.WINDOW_MAX_PHASE);
  }

  function say(text, color, x) {
    pop.push({ t: t, s: text, c: color, x: x });
    if (pop.length > 6) pop.shift();
  }

  /* ── 줄 프리렌더 ───────────────────────────────────────
     한 바퀴를 ROPE_FRAMES장으로 나눠 미리 그린다. 매 프레임 곡선을 계산하면
     TV에서 그것만으로 예산을 먹는다 (phase1). */

  function buildRope() {
    GP.gfx.sheet('jr-rope', TUNE.ROPE_FRAMES, ROPE_W, ROPE_H, function (c2, i) {
      var ph = i / TUNE.ROPE_FRAMES;             // 0 = 발밑, 0.5 = 머리 위
      var sag = Math.cos(ph * Math.PI * 2);      // +1 아래(발밑), -1 위(머리 위)

      // 2차 베지에는 제어점까지 가지 않고 절반만 간다 (곡선 중점 = 0.5*끝점 + 0.5*제어점).
      // 그래서 제어점을 두 배로 밀어야 줄의 맨 아래가 실제로 발밑에 닿는다.
      // 이걸 빼먹으면 줄이 배 높이에서 돌고, "발에 걸린다"는 인과가 화면과 어긋난다.
      var amp = ROPE_H / 2 - ROPE_EDGE;
      var ctrlY = ROPE_H / 2 + 2 * sag * amp;

      // 옆에서 본 줄은 타원 궤도라 아래위에서 납작해진다. 폭을 같이 줄여 그 느낌만 낸다.
      var side = Math.abs(Math.sin(ph * Math.PI * 2));
      var w = ROPE_W * (0.42 + 0.58 * side);
      var x0 = (ROPE_W - w) / 2;

      c2.strokeStyle = sag > 0 ? '#ffd23b' : '#c9a227';   // 앞으로 올 때 밝게
      c2.lineWidth = 9;
      c2.lineCap = 'round';
      c2.beginPath();
      c2.moveTo(x0, ROPE_H / 2);
      c2.quadraticCurveTo(ROPE_W / 2, ctrlY, x0 + w, ROPE_H / 2);
      c2.stroke();
    });
  }

  /* ── 게임 ─────────────────────────────────────────── */

  var def = GP.games.register('jumprope', {
    name: '줄넘기',
    motion: 'jump',
    load: 'high',          // 하체 유산소. 로프와 연달아 붙이지 않는다 (PROJECT.md 9장)
    color: '#4a9a3f',
    tune: TUNE,           // 주소로 덮어쓸 수 있게 연다 (js/tuning.js 현장 오버라이드)
    hint: '줄이 발밑에 올 때 뛰세요. 조금 빨라도 늦어도 괜찮습니다',
    duration: 90,          // 한 판 90초 (PROJECT.md 10장)
    par: 25,               // 보드에서 보너스 칸을 받는 기준 (js/board.js)

    init: function (a) {
      api = a;
      t = 0;
      best = 0;
      st = {};
      pop = [];
      // 시작하자마자 판정이 열리면 준비할 틈이 없다. 반 바퀴 뒤부터 센다.
      ropeT = 0.5;
      buildRope();
    },

    demo: function (ctx, tt, chr) {
      var cycle = (tt % 1.2) / 1.2;
      GP.chars.draw(ctx, chr, C.WIDTH / 2, GROUND_Y, 320, cycle < 0.45 ? 'jump' : 'idle');
      GP.gfx.blit(ctx, 'jr-rope', Math.floor(cycle * TUNE.ROPE_FRAMES), C.WIDTH / 2, ROPE_CY, 1);
    },

    update: function (dt) {
      t += dt;
      ropeT += dt / period();

      var players = api ? api.players : [];
      var wp = windowPhase();

      for (var i = 0; i < players.length; i++) {
        var p = players[i];
        var s = state(p.id);

        // 판정 창이 닫힌 바퀴부터 결과를 확정한다.
        // 창이 닫히기 전에 확정하면 살짝 늦은 점프가 억울하게 걸린다.
        while (ropeT >= s.judged + wp) {
          if (!s.scored[s.judged]) {
            s.combo = 0;
            s.tripAt = t;
            if (api.fx) api.fx('miss', p.id);
          }
          s.judged++;
        }
      }
    },

    onMotion: function (m) {
      if (m.a !== 'jump') return;            // 이 게임은 점프만 본다
      var id = pid(m);
      var s = state(id);

      // 걸려 있는 동안은 세지 않는다. 연출이 끝나면 바로 다시 뛸 수 있다.
      if (t - s.tripAt < TUNE.TRIP_SEC) return;

      s.jumpAt = t;

      // 폰에서 판정한 뒤 여기까지 오는 지연만큼 시계를 되돌려 본다.
      // 값은 실측 전까지 0이다 (js/tuning.js JUMP_LAG_MS).
      var lag = (GP.tuning.JUMP_LAG_MS || 0) / 1000;
      var rt = ropeT - lag / period();

      var cycle = (rt % 1) > 0.5 ? Math.ceil(rt) : Math.floor(rt);
      var offBeat = Math.abs(rt - cycle) * period();   // 초 단위 오차

      if (offBeat > TUNE.WINDOW_SEC) return;           // 어긋난 점프는 무시. 벌하지 않는다
      if (cycle < s.judged || s.scored[cycle]) return; // 이미 지났거나 센 바퀴

      s.scored[cycle] = true;
      if (cycle >= s.judged) s.judged = cycle + 1;

      s.score++;
      s.combo++;
      if (s.combo > s.bestCombo) s.bestCombo = s.combo;
      if (s.score > best) best = s.score;

      if (s.score % TUNE.SPEED_STEP === 0) {
        say(s.score + '개!', '#ffd23b', C.WIDTH / 2);
        if (api.fx) api.fx('combo', id);
      } else {
        if (api.fx) api.fx('good', id);
      }

      // 목표에 닿으면 90초를 채우지 않고 끝낸다. 끝맺음이 있어야 한 판이 된다.
      if (s.score >= TUNE.TARGET && api.end) api.end();
    },

    // 붙어 있는 폰은 전부 결과에 나온다. 한 번도 못 뛴 아이가 명단에서 빠지면
    // 그것이 곧 꼴등 표시가 된다 (PROJECT.md 6장: 꼴등 없음).
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
      var phase = ropeT % 1;
      var frame = Math.floor(phase * TUNE.ROPE_FRAMES);
      var players = api ? api.players : [];

      // 배경. 그림이 있으면 한 장, 없으면 사각형 몇 개 (phase1 예산).
      if (!GP.assets || !GP.assets.bg(ctx, 'jumprope', C.WIDTH, C.HEIGHT)) {
        ctx.fillStyle = '#7cc6ef';
        ctx.fillRect(0, 0, C.WIDTH, GROUND_Y);
        ctx.fillStyle = '#4a9a3f';
        ctx.fillRect(0, GROUND_Y, C.WIDTH, C.HEIGHT - GROUND_Y);
        ctx.fillStyle = '#3d8235';
        ctx.fillRect(0, GROUND_Y, C.WIDTH, 12);
      }

      // 줄이 뒤로 돌 때는 캐릭터보다 먼저 그린다. 앞뒤가 바뀌면 줄이 몸을 뚫는다.
      var behind = phase > 0.25 && phase < 0.75;
      if (behind) GP.gfx.blit(ctx, 'jr-rope', frame, C.WIDTH / 2, ROPE_CY, 1);

      var gap = players.length > 1 ? Math.min(300, S.w / players.length) : 0;
      var x0 = C.WIDTH / 2 - (players.length - 1) * gap / 2;

      for (var i = 0; i < players.length; i++) {
        var p = players[i];
        var s = state(p.id);
        var x = x0 + i * gap;

        var pose = 'idle';
        var lift = 0;
        if (t - s.tripAt < TUNE.TRIP_SEC) {
          pose = 'squat';                       // 걸려서 주저앉은 자세
        } else if (t - s.jumpAt < 0.28) {
          pose = 'jump';
          lift = Math.sin((t - s.jumpAt) / 0.28 * Math.PI) * 70;
        }
        GP.chars.draw(ctx, p['char'], x, GROUND_Y - lift, 260, pose);
      }

      if (!behind) GP.gfx.blit(ctx, 'jr-rope', frame, C.WIDTH / 2, ROPE_CY, 1);

      drawHud(ctx, players);
    }
  });

  /** HUD. fillText는 TV에서 비싸다 (phase1). 프레임당 다섯 줄을 넘기지 않는다. */
  function drawHud(ctx, players) {
    var S = C.SAFE;

    var s0 = players.length ? state(players[0].id) : null;
    var num = s0 ? String(s0.score) : '0';

    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 56px sans-serif';
    ctx.fillText(num, S.x, S.y + 60);

    // 자릿수가 늘면 글자가 겹친다. 폭을 재서 붙인다.
    var numW = ctx.measureText(num).width;
    ctx.font = 'bold 26px sans-serif';
    ctx.fillStyle = '#0d3b12';
    ctx.fillText('개', S.x + numW + 8, S.y + 60);

    if (s0 && s0.combo >= 3) {
      ctx.fillStyle = '#ff8c1a';
      ctx.font = 'bold 34px sans-serif';
      ctx.fillText('연속 ' + s0.combo, S.x, S.y + 104);
    }

    // 남은 시간 막대. 숫자보다 막대가 5세에게 빠르게 읽힌다.
    var left = Math.max(0, 1 - t / def.duration);
    var bw = S.w * 0.4;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(C.WIDTH - S.x - bw, S.y + 24, bw, 22);
    ctx.fillStyle = left > 0.25 ? '#ffffff' : '#ff6b6b';
    ctx.fillRect(C.WIDTH - S.x - bw, S.y + 24, bw * left, 22);

    // 10개 단위 연출
    for (var i = 0; i < pop.length; i++) {
      var age = t - pop[i].t;
      if (age > 1.0) continue;
      ctx.textAlign = 'center';
      ctx.fillStyle = pop[i].c;
      ctx.font = 'bold ' + Math.round(64 + age * 30) + 'px sans-serif';
      ctx.fillText(pop[i].s, pop[i].x, C.HEIGHT * 0.34 - age * 60);
    }
    ctx.textAlign = 'left';
  }

  // 시험이 줄의 위치를 정해놓고 판정을 확인하기 위한 자리.
  // 게임 코드는 쓰지 않는다 — 실제 판정 경로(init/update/onMotion)를 그대로 태우기 위한 손잡이일 뿐이다.
  def._test = {
    TUNE: TUNE,
    period: period,
    windowPhase: windowPhase,
    setRope: function (v) { ropeT = v; },
    rope: function () { return ropeT; },
    state: state
  };

})(window);
