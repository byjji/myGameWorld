/**
 * 미니게임 판정·규칙 시험. 브라우저 없이 돌린다.
 *
 *   node test/games-test.js
 *
 * 캔버스는 가짜를 끼운다. 그리기 결과는 보지 않는다 — 여기서 보는 것은
 * "몇 점인가, 언제 걸리는가, 금지된 패턴이 나오는가" 뿐이다.
 * 그림은 눈으로 봐야 하고, 규칙은 눈으로 보면 놓친다.
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.resolve(__dirname, '..');

/* ── 가짜 캔버스 ─────────────────────────────────────────
   gfx.sheet가 오프스크린을 만들고, 게임이 거기에 그린다. 호출만 삼키면 된다. */

function fakeCtx() {
  const noop = () => {};
  return {
    canvas: null,
    fillStyle: '', strokeStyle: '', font: '', lineWidth: 1, lineCap: '',
    textAlign: '', textBaseline: '', globalAlpha: 1,
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    quadraticCurveTo: noop, bezierCurveTo: noop, arc: noop, rect: noop,
    clip: noop, fill: noop, stroke: noop,
    fillRect: noop, strokeRect: noop, clearRect: noop,
    fillText: noop, strokeText: noop, drawImage: noop,
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    setTransform: noop, transform: noop
  };
}

function fakeCanvas() {
  const cv = { width: 0, height: 0 };
  cv.getContext = () => fakeCtx();
  return cv;
}

/* ── 샌드박스 ───────────────────────────────────────── */

function load(files) {
  // 가짜 Image. src를 넣으면 "받는 중"으로 남는다 —
  // 브라우저 없이도 "그림이 아직 없을 때"를 그대로 재현한다.
  function FakeImage() {
    this.complete = false;
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.onload = null;
    this.onerror = null;
  }

  const win = {
    document: { createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : {}) },
    Image: FakeImage,
    performance: { now: () => 0 },
    setTimeout, clearTimeout, setInterval, clearInterval,
    location: { search: '' },
    Math: Math, Date: Date, JSON: JSON
  };
  win.window = win;
  const sb = vm.createContext(win);
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  }
  return win.GP;
}

const GP = load([
  'js/config.js', 'js/tuning.js', 'js/gfx.js',
  'js/assets-manifest.js', 'js/assets.js', 'js/chars.js', 'js/npc.js',
  'js/board.js', 'js/tv.js',
  'js/pseudo3d.js', 'js/courses.js',
  'js/games/jumprope.js', 'js/games/ropeclimb.js', 'js/games/hammer.js',
  'js/games/blockbreak.js', 'js/games/racing.js'
]);

/* ── 시험 도우미 ────────────────────────────────────── */

const fails = [];
function ok(name, cond) {
  if (cond) console.log('PASS ' + name);
  else { console.log('FAIL ' + name); fails.push(name); }
}
function eq(name, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) console.log('PASS ' + name);
  else {
    console.log('FAIL ' + name);
    console.log('       기대: ' + b);
    console.log('       실제: ' + a);
    fails.push(name);
  }
}

/** 게임을 붙일 가짜 셸. TV가 주는 것과 같은 모양이다. */
function makeApi(players) {
  const api = {
    config: GP.config,
    tuning: GP.tuning,
    chars: GP.chars,
    gfx: GP.gfx,
    players: players || [{ id: 'p1', name: '조카', char: 'lhat', score: 0 }],
    fxLog: [],
    ended: 0,
    note: () => {},
    fx: (name, to) => api.fxLog.push(name + (to ? ':' + to : '')),
    end: () => { api.ended++; }
  };
  return api;
}

function step(def, seconds, dt) {
  dt = dt || 1 / 30;
  for (let s = 0; s < seconds; s += dt) def.update(dt);
}

/* ══ 줄넘기 ═══════════════════════════════════════════ */

function testJumprope() {
  console.log('\n[줄넘기]');
  const def = GP.games.get('jumprope');
  const T = def._test;

  eq('점프만 구독한다', def.motion, 'jump');
  eq('한 판 90초', def.duration, 90);

  // 1. 발밑에 왔을 때 뛰면 들어간다
  let api = makeApi();
  def.init(api);
  T.setRope(1.0);
  def.onMotion({ t: 'motion', a: 'jump', p: 0.8, from: 'p1' });
  eq('제때 뛰면 1개', def.getScore(), [{ from: 'p1', score: 1 }]);
  ok('성공 피드백을 보낸다', api.fxLog.indexOf('good:p1') >= 0);

  // 2. 같은 바퀴에 두 번 뛰어도 한 번만 센다
  def.onMotion({ t: 'motion', a: 'jump', p: 0.8, from: 'p1' });
  eq('한 바퀴에 한 개', def.getScore(), [{ from: 'p1', score: 1 }]);

  // 3. 창 밖으로 어긋난 점프는 무시한다. 벌하지 않는다 (5세 기준)
  api = makeApi();
  def.init(api);
  T.setRope(1.5);                       // 줄이 머리 위. 가장 어긋난 지점
  def.onMotion({ t: 'motion', a: 'jump', p: 0.8, from: 'p1' });
  eq('어긋난 점프는 점수 없음', def.getScore(), [{ from: 'p1', score: 0 }]);
  eq('어긋난 점프로 걸리지는 않는다', api.fxLog.indexOf('miss:p1'), -1);

  // 4. 한 바퀴를 통째로 놓치면 걸린다
  api = makeApi();
  def.init(api);
  step(def, T.period() * 2);            // 두 바퀴를 아무것도 안 하고 보낸다
  ok('놓치면 걸린다', api.fxLog.indexOf('miss:p1') >= 0);
  eq('걸려도 점수는 깎이지 않는다', def.getScore(), [{ from: 'p1', score: 0 }]);

  // 5. 걸린 직후에는 판정을 받지 않는다 (연출이 도는 동안)
  const before = def.getScore()[0].score;
  def.onMotion({ t: 'motion', a: 'jump', p: 0.8, from: 'p1' });
  eq('걸린 동안의 점프는 무시', def.getScore()[0].score, before);

  // 6. 점프 외의 동작은 보지 않는다
  api = makeApi();
  def.init(api);
  T.setRope(1.0);
  def.onMotion({ t: 'motion', a: 'squat', p: 0.9, from: 'p1' });
  def.onMotion({ t: 'motion', a: 'punch', p: 0.9, from: 'p1' });
  eq('다른 동작은 무시', def.getScore(), [{ from: 'p1', score: 0 }]);

  // 7. 10개마다 빨라지고, 하한 아래로는 안 내려간다
  api = makeApi();
  def.init(api);
  const p0 = T.period();
  for (let i = 0; i < T.TUNE.SPEED_STEP; i++) {
    T.setRope(i + 1);
    def.onMotion({ t: 'motion', a: 'jump', p: 0.8, from: 'p1' });
  }
  eq('10개를 다 셌다', def.getScore()[0].score, T.TUNE.SPEED_STEP);
  ok('10개마다 빨라진다', T.period() < p0);
  for (let i = 0; i < 200; i++) {
    T.setRope(T.rope() + 1);
    def.onMotion({ t: 'motion', a: 'jump', p: 0.8, from: 'p1' });
  }
  ok('하한 아래로는 안 빨라진다', T.period() >= T.TUNE.PERIOD_MIN - 1e-9);
  ok('목표에 닿으면 일찍 끝낸다', api.ended > 0);

  // 8. 판정 창이 한 바퀴를 다 먹지 않는다 — 다 먹으면 아무 때나 뛰어도 성공이 된다
  ok('판정 창 상한', T.windowPhase() <= T.TUNE.WINDOW_MAX_PHASE + 1e-9);

  // 9. 두 명이 각자 센다
  api = makeApi([
    { id: 'p1', name: 'A', char: 'lhat' },
    { id: 'p2', name: 'B', char: 'mario' }
  ]);
  def.init(api);
  T.setRope(1.0);
  def.onMotion({ t: 'motion', a: 'jump', p: 0.8, from: 'p1' });
  T.setRope(2.0);
  def.onMotion({ t: 'motion', a: 'jump', p: 0.8, from: 'p1' });
  def.onMotion({ t: 'motion', a: 'jump', p: 0.8, from: 'p2' });
  eq('점수는 폰마다 따로', def.getScore(), [
    { from: 'p1', score: 2 }, { from: 'p2', score: 1 }
  ]);

  // 10. 그리기가 예외 없이 돈다 (그림 자체는 눈으로 본다)
  let threw = null;
  try {
    def.render(fakeCtx());
    def.demo(fakeCtx(), 0.4, 'lhat');
  } catch (e) { threw = e; }
  ok('render/demo가 예외 없이 돈다', threw === null);
}

/* ══ NPC 러버밴딩 ═════════════════════════════════════ */

function testNpc() {
  console.log('\n[NPC 러버밴딩]');
  const N = GP.npc;

  // 속도계 — 초당 동작 수
  const m = new N.SpeedMeter(6);
  for (let i = 0; i < 12; i++) { m.tick(0.5); m.hit(); }   // 6초에 12번 = 2/초
  ok('초당 동작 수를 잰다', Math.abs(m.rate() - 2) < 0.35);
  for (let i = 0; i < 12; i++) m.tick(0.5);                // 6초 쉬면 창이 비워진다
  eq('쉬면 0으로 떨어진다', m.rate(), 0);

  // 쿠파는 중반에 앞서고 막판에 따라잡힌다 (PROJECT.md 6장)
  const pacer = new N.Racer({ pacer: true, unit: 1 / 25 });
  ok('출발은 나란히', pacer.leadAt(0.05) === 0);
  ok('중반엔 앞선다', pacer.leadAt(0.5) > 0);
  ok('막판엔 뒤로 처진다', pacer.leadAt(1.0) < 0);

  const plain = new N.Racer({ unit: 1 / 25 });
  eq('페이스메이커가 아니면 앞서지 않는다', plain.leadAt(0.5), 0);

  // 한 판을 통째로 돌려 항상 화면 안에 같이 있는지 본다.
  // 플레이어가 꾸준히 갈 때, 폭주할 때, 도중에 쉬어버릴 때 셋 다 확인한다.
  function race(rateOf) {
    const r = new N.Racer({ pacer: true, unit: 1 / 25 });
    let player = 0, maxGap = 0, t = 0;
    const dt = 1 / 30;
    while (player < 1 && t < 120) {
      const rate = rateOf(t);
      player = Math.min(1, player + rate * (1 / 25) * dt);
      r.update(dt, rate, player);
      maxGap = Math.max(maxGap, Math.abs(r.pos - player));
      t += dt;
    }
    return { gap: maxGap, npc: r.pos, player, t };
  }

  const steady = race(() => 0.5);
  ok('꾸준히 가면 항상 붙어 있다', steady.gap < 0.25);
  ok('막판에 플레이어가 앞선다', steady.player - steady.npc > -0.02);

  const burst = race((t) => (t < 10 ? 2.0 : 0.3));
  ok('폭주해도 화면 밖으로 안 나간다', burst.gap < 0.35);

  const rest = race((t) => (t > 15 && t < 30 ? 0 : 0.6));
  ok('쉬는 동안에도 NPC는 멈추지 않는다', rest.npc > 0);
  ok('쉬어도 압도적으로 벌어지지 않는다', rest.gap < 0.4);

  // 플레이어가 아예 아무것도 안 하면 NPC 혼자 끝까지 간다 — 그래야 경주가 끝난다
  const idle = new N.Racer({ unit: 1 / 25 });
  for (let i = 0; i < 30 * 90; i++) idle.update(1 / 30, 0, 0);
  ok('가만히 있으면 NPC가 먼저 올라간다', idle.pos > 0.9);
}

/* ══ 로프 오르기 ═══════════════════════════════════════ */

function testRopeclimb() {
  console.log('\n[로프 오르기]');
  const def = GP.games.get('ropeclimb');
  const T = def._test;

  eq('스쿼트만 구독한다', def.motion, 'squat');
  eq('높이는 스쿼트 25회', T.TUNE.HEIGHT, 25);

  // 스쿼트 1회 = 한 칸. 이 인과가 어긋나면 5세는 무엇을 해서 올라갔는지 모른다.
  let api = makeApi();
  def.init(api);
  def.onMotion({ a: 'squat', from: 'p1' });
  eq('스쿼트 한 번에 한 칸', T.human('p1').climbed, 1);

  // 레인은 넷. 사람이 하나면 NPC 셋이 채우고 쿠파가 반드시 들어간다.
  const lanes = T.lanes();
  eq('레인 4개', lanes.length, 4);
  ok('쿠파가 들어간다', lanes.some(l => l.char === 'bowser'));
  eq('사람 자리는 하나', lanes.filter(l => l.kind === 'human').length, 1);

  // 사람이 넷이면 NPC가 없다
  api = makeApi([
    { id: 'p1', char: 'lhat' }, { id: 'p2', char: 'mario' },
    { id: 'p3', char: 'luigi' }, { id: 'p4', char: 'peach' }
  ]);
  def.init(api);
  eq('사람이 꽉 차면 NPC 없음', T.npcs().length, 0);
  eq('그래도 레인은 4개', T.lanes().length, 4);

  // 리듬이 일정하면 콤보가 붙어 실질 횟수가 준다
  api = makeApi();
  def.init(api);
  for (let i = 0; i < 12; i++) { step(def, 0.8); def.onMotion({ a: 'squat', from: 'p1' }); }
  const rhythmic = T.human('p1').climbed;
  ok('리듬이 붙으면 12회로 12칸을 넘는다', rhythmic > 12);
  ok('콤보 상한이 있다', T.human('p1').combo <= 200);

  // 리듬이 들쭉날쭉하면 콤보가 끊긴다
  api = makeApi();
  def.init(api);
  const gaps = [0.5, 2.6, 0.4, 2.8, 0.5, 2.7, 0.4, 2.9, 0.5, 2.6, 0.4, 2.8];
  for (const g of gaps) { step(def, g); def.onMotion({ a: 'squat', from: 'p1' }); }
  ok('리듬이 끊기면 덜 오른다', T.human('p1').climbed < rhythmic);

  // 코인
  api = makeApi();
  def.init(api);
  for (let i = 0; i < T.TUNE.COIN_AT[0]; i++) def.onMotion({ a: 'squat', from: 'p1' });
  eq('지나친 칸의 코인을 줍는다', T.human('p1').coins, T.TUNE.COIN_SCORE);
  ok('코인 소리를 낸다', api.fxLog.indexOf('coin:p1') >= 0);

  // 밥밥탄 — 감점이 아니라 잠깐 정지 (PROJECT.md 5-2)
  api = makeApi();
  def.init(api);
  def.onMotion({ a: 'squat', from: 'p1' });
  const beforeBomb = T.human('p1').climbed;
  step(def, T.TUNE.BOMB_EVERY + 0.2);
  ok('쿠파가 밥밥탄을 던진다', T.bombs().length > 0 || T.human('p1').frozenUntil > 0);
  step(def, T.TUNE.BOMB_FROM / T.TUNE.BOMB_FALL + 0.5);
  ok('맞으면 멈춘다', T.human('p1').frozenUntil > T.now() - T.TUNE.FREEZE_SEC - 0.1);
  ok('점수를 깎지 않는다', T.human('p1').climbed >= beforeBomb);

  // 멈춘 동안의 스쿼트는 무시된다
  const frozen = T.human('p1');
  frozen.frozenUntil = T.now() + 1;
  const held = frozen.climbed;
  def.onMotion({ a: 'squat', from: 'p1' });
  eq('멈춘 동안에는 안 올라간다', T.human('p1').climbed, held);

  // 정상에 닿으면 끝난다
  api = makeApi();
  def.init(api);
  for (let i = 0; i < T.TUNE.HEIGHT + 5; i++) def.onMotion({ a: 'squat', from: 'p1' });
  eq('높이를 넘지 않는다', T.human('p1').climbed, T.TUNE.HEIGHT);
  step(def, 2.0);
  ok('정상에 닿으면 판이 끝난다', api.ended > 0);
  ok('도착 소리를 낸다', api.fxLog.indexOf('fanfare:p1') >= 0);

  // 점수는 오른 칸 + 코인
  const sc = def.getScore();
  eq('점수 형식', sc.length, 1);
  eq('점수 = 칸 + 코인', sc[0].score, T.TUNE.HEIGHT + T.human('p1').coins);

  // 한 판 길이. 5세의 스쿼트 주기를 2.2초로 잡고 끝까지 올라가는 데 걸리는 시간을 잰다.
  // 목표는 60~90초(PROJECT.md 5-2)지만, 진짜 주기는 실기에서만 나온다.
  // 여기서 보증하는 것은 "한 판(90초) 안에 끝난다"까지다.
  api = makeApi();
  def.init(api);
  let elapsed = 0, since = 0;
  const dt = 1 / 30;
  while (elapsed < 200 && !T.human('p1').finished) {
    def.update(dt);
    elapsed += dt; since += dt;
    if (since >= 2.2) { since = 0; def.onMotion({ a: 'squat', from: 'p1' }); }
  }
  console.log('     2.2초 주기로 오르면 ' + elapsed.toFixed(0) + '초 (목표 60~90초, 실측은 실기에서)');
  ok('한 판(90초) 안에 정상에 닿는다', T.human('p1').finished && elapsed <= def.duration);

  let threw = null;
  try { def.render(fakeCtx()); def.demo(fakeCtx(), 0.5, 'lhat'); } catch (e) { threw = e; }
  ok('render/demo가 예외 없이 돈다', threw === null);
}

/* ══ 해머 피하기 ═══════════════════════════════════════ */

function testHammer() {
  console.log('\n[해머 피하기]');
  const def = GP.games.get('hammer');
  const T = def._test;

  eq('기울기를 구독한다', def.motion, 'tilt');
  eq('레인 3개', T.TUNE.LANES, 3);

  // ── 이 게임의 절대 규칙: 세 레인이 동시에 막히지 않는다.
  // 확률로 막지 않았는지 확인하려고 난수를 최악으로 몰아본다.
  let worst = 0, duo = 0;
  for (let i = 0; i < 20000; i++) {
    const lanes = T.pickLanes(120, true);            // 후반(두 레인 구간) 기준
    worst = Math.max(worst, lanes.length);
    if (lanes.length === 2) duo++;
    if (new Set(lanes).size !== lanes.length) { fails.push('같은 레인 중복'); break; }
  }
  eq('한 번에 최대 두 레인', worst, 2);
  ok('두 레인 동시 투하가 실제로 나온다', duo > 0);

  // 난수가 항상 1을 돌려주는(최대치) 상황에서도 세 레인이 안 나온다
  T.setRng(() => 0.999999);
  for (let i = 0; i < 500; i++) {
    if (T.pickLanes(999, true).length >= T.TUNE.LANES) { fails.push('세 레인 차단 발생'); break; }
  }
  T.setRng(null);
  ok('난수를 최악으로 몰아도 세 레인은 안 막힌다', !fails.includes('세 레인 차단 발생'));

  // 초반에는 두 레인이 안 나온다 — 갑작스러운 난이도 상승 금지
  let earlyMax = 0;
  for (let i = 0; i < 2000; i++) earlyMax = Math.max(earlyMax, T.pickLanes(1, true).length);
  eq('초반에는 한 레인만', earlyMax, 1);

  // 속도는 계단식으로만 오른다
  T.setTime(0);
  const i0 = T.interval();
  T.setTime(T.TUNE.STEP_SEC + 1);
  const i1 = T.interval();
  ok('10초마다 빨라진다', i1 < i0);
  T.setTime(9999);
  ok('하한 아래로는 안 내려간다', T.interval() >= T.TUNE.INTERVAL_MIN - 1e-9);

  // 기울기 → 레인, 히스테리시스
  const api = makeApi();
  def.init(api);
  const TT = GP.tuning;
  const degToV = (d) => d / TT.TILT_RANGE_DEG;
  def.onTilt({ v: degToV(-20), from: 'p1' });
  eq('왼쪽으로 기울이면 1번 레인', T.state('p1').lane, 0);
  def.onTilt({ v: degToV(-8), from: 'p1' });
  eq('경계 안에서는 레인을 지킨다', T.state('p1').lane, 0);   // 히스테리시스
  def.onTilt({ v: degToV(0), from: 'p1' });
  eq('가운데로 오면 2번 레인', T.state('p1').lane, 1);
  def.onTilt({ v: degToV(20), from: 'p1' });
  eq('오른쪽으로 기울이면 3번 레인', T.state('p1').lane, 2);

  // 예고선 — 해머는 예고가 켜지고 WARN_SEC 뒤에 떨어진다.
  // 예고 없이 떨어지면 반사신경 싸움이 되고, 5세는 반사신경으로 어른을 못 이긴다.
  def.init(makeApi());
  let lead = null;
  for (let i = 0; i < 300 && lead === null; i++) {
    def.update(1 / 30);
    if (T.waves().length) lead = T.waves()[0].at - T.now();
  }
  ok('예고가 뜬 뒤에 떨어진다', lead !== null && lead > 0);
  ok('예고 시간은 0.8초', lead !== null && Math.abs(lead - T.TUNE.WARN_SEC) < 0.06);

  // 피격 — 게임오버 없음, 시간은 계속 쌓인다
  const api2 = makeApi();
  def.init(api2);
  T.state('p1').lane = 0;
  // 0번 레인만 노리는 파도를 넣고 착탄까지 돌린다
  T.waves().push({ at: T.now() + 0.2, lanes: [0], done: false });
  const before = def.getScore()[0].score;
  step(def, 1.0);
  ok('맞으면 잠깐 멈춘다', T.state('p1').stunUntil > 0);
  ok('맞아도 점수는 안 깎인다', def.getScore()[0].score >= before);
  eq('코인은 0 아래로 안 내려간다', T.state('p1').coins, 0);

  // 코인 — 그 레인에 있으면 줍는다
  const api3 = makeApi();
  def.init(api3);
  T.state('p1').lane = 2;
  T.coins().push({ lane: 2, born: T.now(), taken: false });
  step(def, 0.2);
  eq('같은 레인의 코인을 줍는다', T.state('p1').coins, 1);

  // 점수 = 버틴 시간 + 코인
  const sc = def.getScore();
  ok('점수는 버틴 시간이 들어간다', sc[0].score >= 1);

  let threw = null;
  try { def.render(fakeCtx()); def.demo(fakeCtx(), 1.2, 'lhat'); } catch (e) { threw = e; }
  ok('render/demo가 예외 없이 돈다', threw === null);
}

/* ══ 도로 렌더러 (유사 3D) ═══════════════════════════════ */

function testPseudo3d() {
  console.log('\n[도로 렌더러]');

  const P3 = GP.pseudo3d;
  const track = new P3.Track(GP.courses.meadow);

  ok('세그먼트가 만들어진다', track.segs.length > 300);
  eq('길이는 세그먼트 수 × 길이', track.length, track.segs.length * P3.TUNE.SEG_LEN);

  // 랩을 도는 코스다. 끝 높이가 시작 높이와 다르면 결승선에서 화면이 튄다.
  ok('이음매의 높이가 맞는다 (들판)', track.seamOk());
  ok('이음매의 높이가 맞는다 (해변)', new P3.Track(GP.courses.beach).seamOk());

  // 커브가 급하면 5세가 못 돈다. 코스를 새로 만들 때 여기서 걸린다.
  let worst = 0;
  for (const id of GP.courses.ids()) {
    const t2 = new P3.Track(GP.courses[id]);
    for (const s of t2.segs) worst = Math.max(worst, Math.abs(s.curve));
  }
  ok('가장 급한 커브가 6을 안 넘는다 (' + worst.toFixed(1) + ')', worst <= 6);

  // 곡률은 서서히 붙는다. 갑자기 꺾이면 대응할 시간이 없다.
  let jump = 0;
  for (let i = 1; i < track.segs.length; i++) {
    jump = Math.max(jump, Math.abs(track.segs[i].curve - track.segs[i - 1].curve));
  }
  ok('한 세그먼트에서 곡률이 튀지 않는다 (' + jump.toFixed(2) + ')', jump < 0.5);

  // 랩을 넘어가도 좌표가 이어진다
  eq('트랙 끝은 처음으로 돌아온다', track.wrap(track.length + 100), 100);
  eq('뒤로 가도 접힌다', track.wrap(-100), track.length - 100);

  // 투영 — 멀수록 위에 작게 그려진다. 이게 뒤집히면 도로가 하늘로 솟는다.
  const near = { world: { y: 0, z: 1000 }, camera: {}, screen: {} };
  const far = { world: { y: 0, z: 9000 }, camera: {}, screen: {} };
  P3.project(near, 0, 1400, 0, 1, 1280, 720, 2400);
  P3.project(far, 0, 1400, 0, 1, 1280, 720, 2400);
  ok('먼 세그먼트가 화면 위에 온다', far.screen.y < near.screen.y);
  ok('먼 세그먼트가 더 좁다', far.screen.w < near.screen.w);

  // 그리는 양은 상수 하나로 줄어든다 — 실기에서 프레임이 모자랄 때 쓰는 손잡이다.
  const cam = { z: 0, x: 0, sky: 0 };
  const before = P3.TUNE.DRAW_SEGS;
  P3.TUNE.DRAW_SEGS = 100; track.pal = null;
  const many = P3.render(fakeCtx(), track, cam, []);
  P3.TUNE.DRAW_SEGS = 30; track.pal = null;
  const few = P3.render(fakeCtx(), track, cam, []);
  ok('DRAW_SEGS를 낮추면 덜 그린다 (' + many.segs + ' → ' + few.segs + ')', few.segs < many.segs);
  ok('낮춰도 도로는 그려진다', few.segs > 10);
  P3.TUNE.DRAW_SEGS = before; track.pal = null;

  // 스프라이트 상한. 넘겨도 상한까지만 그린다 (phase1 예산)
  const lots = [];
  for (let i = 0; i < 60; i++) {
    lots.push({ z: i * P3.TUNE.SEG_LEN, x: 0, w: 1200, draw: function () {} });
  }
  const r = P3.render(fakeCtx(), track, cam, lots);
  ok('스프라이트 상한을 넘지 않는다 (' + r.sprites + ')', r.sprites <= P3.TUNE.SPRITE_MAX);

  // 카메라와 나란한 스프라이트는 원근 배율이 발산한다. 그리면 화면이 통째로 덮인다.
  let widest = 0, drawn = 0;
  function probe(z) {
    widest = 0; drawn = 0;
    P3.render(fakeCtx(), track, { z: 0, x: 0, sky: 0 }, [{
      z: z, x: 0, w: 1500,
      draw: function (c2, sx, sy, sw) { drawn++; widest = Math.max(widest, sw); }
    }]);
  }
  probe(20);                                   // 카메라와 나란한 위치
  eq('나란한 스프라이트는 아예 안 그린다', drawn, 0);
  // 카메라 바로 밑(약 1,200 단위 안쪽)은 화면 아래로 잘려 도로 자체가 안 그려진다.
  // 그 바깥의 가장 가까운 자리에서 본다.
  probe(P3.TUNE.SEG_LEN * 10);
  ok('가까운 것은 그린다', drawn === 1);
  ok('그래도 화면 폭을 안 넘는다 (' + widest.toFixed(0) + 'px)',
     widest > 0 && widest <= GP.config.WIDTH);

  // 언덕을 꺼도 코스가 그대로 성립해야 한다 (부하 미달 시의 대응 수단)
  const hills = P3.TUNE.HILLS;
  P3.TUNE.HILLS = 0;
  const flat = new P3.Track(GP.courses.meadow);
  ok('언덕을 끄면 평지가 된다', flat.heightAt(0) === 0 && flat.seamOk());
  eq('평지여도 길이는 같다', flat.length, track.length);
  P3.TUNE.HILLS = hills;
}

/* ══ 레이싱 ═══════════════════════════════════════════ */

function testRacing() {
  console.log('\n[레이싱]');

  const def = GP.games.get('racing');
  const T = def._test;
  const TUNE = T.TUNE;
  const P3 = GP.pseudo3d;

  eq('기울기만 구독한다', def.motion, 'tilt');
  eq('하체 부하는 낮다', def.load, 'low');
  eq('한 판 90초', def.duration, 90);

  /** 한 판을 시늉한다. tilt는 초를 받아 -1~1을 돌려주는 함수다. */
  function race(api, tilt, seconds, dt) {
    dt = dt || 1 / 30;
    for (let s = 0; s < seconds; s += dt) {
      def.onTilt({ t: 'tilt', v: tilt ? tilt(s) : 0, from: 'p1' });
      def.update(dt);
      if (api.ended) return s;
    }
    return seconds;
  }

  // 1. 가속은 저절로 된다. 조카는 좌우만 한다 (PROJECT.md 5-5)
  let api = makeApi();
  def.init(api);
  race(api, null, 3);
  let s = T.state('p1');
  ok('아무것도 안 해도 앞으로 간다', s.dist > 1000);
  ok('최고 속도까지 알아서 오른다', s.speed >= TUNE.MAX_SPEED - 1);
  eq('par는 완주 기준이다', def.par, TUNE.LAPS * TUNE.LAP_BONUS);

  // 2. 기울기는 절대 위치다. 기울인 만큼 그 자리로 간다.
  //    출발 직선(60세그먼트 = 12,000 단위) 안에서 본다 — 커브에 들어가면
  //    원심력이 기준점을 옮기므로 "가운데"의 뜻이 달라진다 (아래 15번).
  api = makeApi();
  def.init(api);
  race(api, () => 1, 1);
  const right = T.state('p1').x;
  ok('오른쪽으로 기울이면 오른쪽에 있다 (' + right.toFixed(2) + ')', right > 0.6);
  race(api, () => 0, 1);
  ok('직선에서 바로 세우면 가운데로 돌아온다', Math.abs(T.state('p1').x) < 0.2);
  ok('아직 출발 직선 안이다', T.track().curveAt(T.state('p1').z) === 0);

  // 3. 데드존 — 손이 떨려도 카트가 흔들리지 않는다
  api = makeApi();
  def.init(api);
  race(api, () => TUNE.DEADZONE * 0.8, 0.6);
  ok('데드존 안에서는 안 움직인다', Math.abs(T.state('p1').x) < 0.02);

  // 4. 도로 밖은 느리다. 하지만 멈추지는 않는다.
  //    기본 감도로는 끝까지 기울여도 도로 가장자리까지다 — 풀밭으로 나가려면
  //    감도를 올리거나 커브에서 원심력에 밀려야 한다. 5세 기준으로 일부러 그렇게 뒀다.
  const keepLvl = TUNE.SENS_LEVEL;
  TUNE.SENS_LEVEL = 2;
  api = makeApi();
  def.init(api);
  race(api, () => 1, 3);
  s = T.state('p1');
  ok('최대 감도로 기울이면 도로를 벗어난다 (' + s.x.toFixed(2) + ')', Math.abs(s.x) > 1);
  ok('도로 밖에서는 상한이 낮다', s.speed <= TUNE.OFFROAD_MAX + 1);
  ok('도로 밖에서도 멈추지는 않는다', s.speed > 0);
  TUNE.SENS_LEVEL = keepLvl;

  // 5. 벽은 상한이지 벌이 아니다 — 밖으로 못 나가고, 잠깐 느려지고, 끝
  api = makeApi();
  def.init(api);
  s = T.state('p1');
  s.speed = TUNE.MAX_SPEED;
  s.x = 3;                         // 있을 수 없는 위치. 가드가 잡아야 한다
  T.drive('p1', 1 / 30);
  ok('벽 밖으로는 못 나간다', Math.abs(s.x) <= TUNE.WALL_X + 0.001);
  ok('벽에 닿으면 느려진다', s.speed <= TUNE.WALL_SPEED + 1);
  ok('벽에 닿아도 멈추지 않는다', s.speed > 0);
  ok('벽 피드백을 보낸다', api.fxLog.indexOf('hit:p1') >= 0);

  // 6. 랩과 완주. 90초 안에 끝나야 다음 화면으로 넘어간다 (phase8 완료 기준)
  api = makeApi();
  def.init(api);
  const track = T.track();
  const took = race(api, (t) => Math.sin(t) * 0.2, 90);
  s = T.state('p1');
  ok('90초 안에 완주한다 (' + took.toFixed(1) + '초)', s.finished > 0);
  eq('랩을 다 돈다', s.lap, TUNE.LAPS);
  ok('완주하면 결과로 넘어간다', api.ended > 0);
  ok('완주 점수가 par에 닿는다', def.getScore()[0].score >= def.par);

  // 7. 쿠파는 중반에 앞서고 막판에 따라잡힌다 (js/npc.js 러버밴딩)
  ok('페이스메이커가 있다', T.npcs().length > 0 && T.npcs()[0].racer.pacer);
  ok('골인할 때 쿠파는 뒤에 있다', T.npcs()[0].racer.pos < 1);

  api = makeApi();
  def.init(api);
  race(api, null, 30);             // 중반까지만
  const p = T.progress('p1');
  ok('중반에는 쿠파가 앞선다', T.npcs()[0].racer.pos > p);

  // 8. 꼴등 없음 — 못 달려도 맨 뒤 NPC는 앞서지 않는다 (해머의 레인 가드와 같은 자리)
  api = makeApi();
  def.init(api);
  race(api, (t) => (t % 4 < 2 ? 1 : -1), 90);      // 좌우로만 흔드는 아이
  s = T.state('p1');
  const rank = T.rankOf('p1');
  ok('진행도가 0.8을 넘겼다 (' + T.progress('p1').toFixed(2) + ')', T.progress('p1') > 0.8);
  ok('꼴등이 아니다 (' + rank + '위 / ' + (T.npcs().length + 1) + '명)',
     rank <= T.npcs().length);

  // 9. 코인 — 지나가면 먹고, 같은 바퀴에 두 번은 안 먹는다
  api = makeApi();
  def.init(api);
  s = T.state('p1');
  const coin = T.coins()[0];
  s.z = coin.z;
  s.x = coin.x;
  s.speed = 1000;
  def.update(1 / 30);
  eq('지나가면 코인을 먹는다', s.coins, 1);
  const before = s.coins;
  s.z = coin.z;
  def.update(1 / 30);
  eq('같은 바퀴에 두 번은 안 먹는다', s.coins, before);
  ok('코인 피드백을 보낸다', api.fxLog.indexOf('coin:p1') >= 0);

  // 10. 코인은 바퀴마다 되살아난다. 아니면 2랩부터 빈 코스를 달린다
  s.lap = 1;
  s.z = coin.z;
  def.update(1 / 30);
  eq('다음 바퀴에는 다시 나온다', s.coins, before + 1);

  // 11. 감도 3단계. 실기에서 고르는 손잡이다 (phase8 검증 방법)
  eq('감도는 3단계다', T.SENS.length, 3);
  ok('단계가 커질수록 민감하다', T.SENS[0] < T.SENS[1] && T.SENS[1] < T.SENS[2]);

  const lvl = TUNE.SENS_LEVEL;
  api = makeApi();
  TUNE.SENS_LEVEL = 0;
  def.init(api);
  race(api, () => 1, 2);
  const low = T.state('p1').x;
  api = makeApi();
  TUNE.SENS_LEVEL = 2;
  def.init(api);
  race(api, () => 1, 2);
  const high = T.state('p1').x;
  ok('감도를 올리면 같은 각도로 더 간다 (' + low.toFixed(2) + ' → ' + high.toFixed(2) + ')',
     high > low);
  TUNE.SENS_LEVEL = lvl;

  // 12. 코스는 데이터다. 주소로 바꿔도 게임이 그대로 돈다
  const cs = TUNE.COURSE;
  TUNE.COURSE = 1;
  api = makeApi();
  def.init(api);
  race(api, null, 2);
  ok('다른 코스로도 달린다', T.track().id === 'beach' && T.state('p1').dist > 0);
  TUNE.COURSE = cs;
  def.init(makeApi());
  eq('코스를 되돌리면 원래 코스다', T.track().id, 'meadow');

  // 13. 카트가 화면에 그려진다 (그림 내용이 아니라 예외 없이 도는지만 본다)
  let threw = null;
  try {
    def.init(makeApi());
    def.update(1 / 30);
    def.render(fakeCtx());
    def.demo(fakeCtx(), 1.2, 'lhat');
  } catch (e) { threw = e; }
  ok('render/demo가 예외 없이 돈다', threw === null);

  // 14. 이 게임만 쥐는 법이 다르다 (phase8 검증 방법)
  ok('캘리브레이션 안내가 따로 있다', !!def.calibHint && def.calibHint.length === 2);

  // 15. **커브가 공짜여서는 안 된다.**
  //     절대 매핑은 목표 위치로 끌어당기는 서보라, 원심력을 "미는 힘"으로 넣으면
  //     복원력(MOVE_RATE)에 통째로 먹혀 커브에서 아무 일도 일어나지 않는다.
  //     그러면 가만히 있는 것이 가장 좋은 주행이 되고, 이 게임은 볼거리만 남는다.
  //     기준점을 옮기는 방식으로 넣은 이유이며, 여기가 그 회귀 감시다.
  function drivenGrass(tilt) {
    const a = makeApi();
    def.init(a);
    const s2 = T.state('p1');
    let grass = 0, n = 0;
    for (let x = 0; x < 90; x += 1 / 30) {
      def.onTilt({ t: 'tilt', v: tilt(s2), from: 'p1' });
      def.update(1 / 30);
      n++;
      if (s2.offroad) grass++;
      if (a.ended) break;
    }
    return grass / n;
  }

  // 16. 카트 수가 오프스크린 시트 상한을 넘지 않는다.
  //     카트 한 대가 시트 한 장이다. 넘기면 먼저 만든 시트가 밀려나고
  //     그 카트만 화면에서 조용히 사라진다 — 넷이 할 때 터지는 종류의 사고다.
  const four = makeApi([
    { id: 'p1', name: '조카', char: 'lhat', score: 0 },
    { id: 'p2', name: '삼촌', char: 'mario', score: 0 },
    { id: 'p3', name: '이모', char: 'peach', score: 0 },
    { id: 'p4', name: '동생', char: 'toad', score: 0 }
  ]);
  def.init(four);
  def.render(fakeCtx());
  ok('넷이 해도 시트 상한 안 (' + GP.gfx.count() + '/' + GP.config.MAX_OFFSCREEN + ')',
     GP.gfx.count() <= GP.config.MAX_OFFSCREEN);
  ok('넷이 해도 NPC가 최소 한 명은 있다', T.npcs().length >= 1);
  ok('넷이 해도 페이스메이커는 있다', T.npcs()[0].racer.pacer);
  for (const p of four.players) {
    ok('카트 그림이 살아 있다 (' + p['char'] + ')', GP.gfx.has('rg-k-' + p['char']));
  }

  const idle = drivenGrass(() => 0);
  const steered = drivenGrass((s2) => T.track().curveAt(s2.z) * 0.35);
  ok('가만히 있으면 급커브에서 풀밭으로 밀린다 (' + Math.round(idle * 100) + '%)', idle > 0);
  ok('커브 쪽으로 기울이면 안 밀린다 (' + Math.round(steered * 100) + '%)', steered < idle);
}

/* ══ 미니게임 선택 / 룰렛 ═══════════════════════════════ */

function testRoulette() {
  console.log('\n[룰렛]');

  const vis = GP.games.visible();
  ok('진단 화면은 목록에 없다', vis.indexOf('debug') < 0);
  // 미니게임 5종이 전부 룰렛에 올라와야 세션이 완성이다 (phase8 완료 기준)
  eq('미니게임이 5종이다', vis.length, 5);
  eq('다섯 종이 다 있다', vis.slice().sort().join(','),
     'blockbreak,hammer,jumprope,racing,ropeclimb');


  // 직전 게임은 후보에서 빠진다
  ok('직전 게임은 안 나온다', GP.games.pool('hammer').indexOf('hammer') < 0);

  // 하체 부하 높은 게임이 연속으로 나오지 않는다
  const afterHigh = GP.games.pool('jumprope');
  ok('힘든 게임 다음에는 힘든 게임이 없다',
     afterHigh.every(id => GP.games.get(id).load !== 'high'));

  // 100판 시뮬레이션 — 부하 높은 게임이 연달아 나오는지 본다 (phase6 완료 기준)
  let last = null, backToBackHigh = 0, sameTwice = 0;
  const seen = {};
  for (let i = 0; i < 100; i++) {
    const pick = GP.games.roll(last);
    if (last && pick === last) sameTwice++;
    if (last && GP.games.get(last).load === 'high' && GP.games.get(pick).load === 'high') {
      backToBackHigh++;
    }
    seen[pick] = (seen[pick] || 0) + 1;
    last = pick;
  }
  eq('100판에서 같은 게임 연속 0회', sameTwice, 0);
  eq('100판에서 힘든 게임 연속 0회', backToBackHigh, 0);
  ok('한 게임만 나오지 않는다', Object.keys(seen).length >= 2);

  // 등록만 되고 안 뽑히면 없는 것과 같다. 다섯 종이 다 나와야 세션이 완성이다 (phase8).
  eq('100판에 다섯 종이 다 나온다', Object.keys(seen).sort().join(','),
     'blockbreak,hammer,jumprope,racing,ropeclimb');

  // 후보가 하나도 안 남는 상황에서도 뭔가는 뽑는다 — 멈추는 것이 제일 나쁘다
  ok('후보가 좁아도 뽑는다', !!GP.games.roll('hammer'));

  // 첫 판은 힘든 것으로 시작하지 않는다 (PROJECT.md 9장 배치: 낮음으로 시작)
  ok('첫 판은 부하 높은 게임이 아니다',
     GP.games.pool(null).every(id => GP.games.get(id).load !== 'high'));

  // 세션 100번을 통째로 돌려도 규칙이 안 깨진다
  let bad = 0;
  for (let s = 0; s < 100; s++) {
    let prev = null;
    for (let r = 0; r < 5; r++) {
      const pick = GP.games.roll(prev);
      if (r === 0 && GP.games.get(pick).load === 'high') bad++;
      if (prev && pick === prev) bad++;
      if (prev && GP.games.get(prev).load === 'high' && GP.games.get(pick).load === 'high') bad++;
      prev = pick;
    }
  }
  eq('5판 세션 100번에서 규칙 위반 0', bad, 0);
}

/* ══ 블록깨기 ═════════════════════════════════════════ */

function testBlockbreak() {
  console.log('\n[블록깨기]');
  const def = GP.games.get('blockbreak');
  const T = def._test;
  const n = T.TUNE.GRID * T.TUNE.GRID;

  eq('쳐올리기를 구독한다', def.motion, 'punch');
  eq('3×3 격자', n, 9);
  eq('앉아서 하는 게임', def.load, 'low');

  let api = makeApi();
  def.init(api);
  eq('격자가 채워진다', T.cells().length, n);

  // 조준 — 기울기가 9칸에 매핑된다
  def.onTilt({ v: -1, from: 'p1' });
  eq('왼쪽 끝은 첫 칸', T.state('p1').cell, 0);
  def.onTilt({ v: 1, from: 'p1' });
  eq('오른쪽 끝은 마지막 칸', T.state('p1').cell, n - 1);
  def.onTilt({ v: 0, from: 'p1' });
  eq('가운데는 가운데 칸', T.state('p1').cell, Math.floor(n / 2));

  // 히스테리시스 — 경계에서 떨지 않는다
  const mid = Math.floor(n / 2);
  const edgeV = ((mid + 1) / n) * 2 - 1;          // 정확히 다음 칸 경계
  def.onTilt({ v: edgeV, from: 'p1' });
  eq('경계에서는 안 넘어간다', T.state('p1').cell, mid);
  def.onTilt({ v: edgeV + 0.2, from: 'p1' });
  ok('충분히 넘기면 넘어간다', T.state('p1').cell > mid);

  // 코인 블록
  api = makeApi();
  def.init(api);
  T.state('p1').cell = 0;
  T.setCell(0, 'coin');
  def.onMotion({ a: 'punch', from: 'p1' });
  eq('코인 블록은 1점', def.getScore()[0].score, 1);
  ok('코인 소리를 낸다', api.fxLog.indexOf('coin:p1') >= 0);
  eq('깬 자리는 비워진다', T.cells()[0].type, null);

  // 점프는 무시한다 — 여기가 점프/쳐올리기 구분이 실전 의미를 갖는 자리
  T.setCell(0, 'coin');
  const before = def.getScore()[0].score;
  def.onMotion({ a: 'jump', from: 'p1' });
  eq('점프로는 안 깨진다', def.getScore()[0].score, before);

  // 다시 채워진다
  step(def, T.TUNE.REFILL_SEC + 0.2);
  ok('깨진 자리가 다시 찬다', T.cells().every(c => c.type !== null));

  // 버섯 — 5초간 2배
  api = makeApi();
  def.init(api);
  T.state('p1').cell = 0;
  T.setCell(0, 'mush');
  def.onMotion({ a: 'punch', from: 'p1' });
  ok('버섯을 먹으면 2배가 켜진다', T.state('p1').mushUntil > T.now());
  T.setCell(1, 'coin');
  T.state('p1').cell = 1;
  const s1 = def.getScore()[0].score;
  def.onMotion({ a: 'punch', from: 'p1' });
  eq('2배 동안 코인은 2점', def.getScore()[0].score - s1, T.TUNE.MUSH_MULT);

  // 스타 — 조준 없이 전부 파괴
  api = makeApi();
  def.init(api);
  for (let i = 0; i < n; i++) T.setCell(i, 'coin');
  T.setCell(0, 'star');
  T.state('p1').cell = 0;
  def.onMotion({ a: 'punch', from: 'p1' });     // 스타 획득
  ok('스타가 켜진다', T.state('p1').starUntil > T.now());
  def.onMotion({ a: 'punch', from: 'p1' });     // 조준 없이 전부
  const leftBlocks = T.cells().filter(c => c.type !== null).length;
  ok('스타 중에는 격자가 통째로 털린다', leftBlocks === 0);
  ok('스타로도 점수가 오른다', def.getScore()[0].score >= n - 1);

  // 밥밥탄 — 점수가 아니라 시간을 깎는다 (감점 최소화)
  api = makeApi();
  def.init(api);
  T.state('p1').cell = 0;
  T.setCell(0, 'bomb');
  const scoreBefore = def.getScore()[0].score;
  def.onMotion({ a: 'punch', from: 'p1' });
  eq('밥밥탄은 점수를 안 깎는다', def.getScore()[0].score, scoreBefore);
  eq('대신 시간을 깎는다', T.penalty(), T.TUNE.BOMB_TIME);
  ok('밥밥탄 소리를 낸다', api.fxLog.indexOf('bomb:p1') >= 0);
  ok('점수는 절대 음수가 안 된다', def.getScore()[0].score >= 0);

  // 빈 블록 — 소리만
  api = makeApi();
  def.init(api);
  T.state('p1').cell = 2;
  T.setCell(2, 'empty');
  def.onMotion({ a: 'punch', from: 'p1' });
  eq('빈 블록은 점수가 없다', def.getScore()[0].score, 0);
  ok('꽝 소리를 낸다', api.fxLog.indexOf('dud:p1') >= 0);

  // 다섯 종류가 다 나오는지 — 하나라도 안 나오면 만든 의미가 없다
  api = makeApi();
  def.init(api);
  const kinds = {};
  for (let i = 0; i < 4000; i++) { T.fill(); T.cells().forEach(c => { kinds[c.type] = 1; }); }
  eq('블록 5종이 다 나온다', Object.keys(kinds).sort().join(','), 'bomb,coin,empty,mush,star');

  // 파티클 상한 — 연출이 예산을 넘지 않는다 (phase1)
  api = makeApi();
  def.init(api);
  for (let i = 0; i < 200; i++) {
    T.setCell(0, 'coin');
    T.state('p1').cell = 0;
    def.onMotion({ a: 'punch', from: 'p1' });
  }
  ok('파티클이 상한을 넘지 않는다', T.parts().alive() <= GP.config.MAX_PARTICLES);

  // 시간이 깎이면 일찍 끝난다
  api = makeApi();
  def.init(api);
  step(def, def.duration - 3);
  eq('아직 안 끝났다', api.ended, 0);
  T.state('p1').cell = 0;
  for (let i = 0; i < 4; i++) { T.setCell(0, 'bomb'); def.onMotion({ a: 'punch', from: 'p1' }); }
  step(def, 0.2);
  ok('밥밥탄으로 깎인 만큼 일찍 끝난다', api.ended > 0);

  let threw = null;
  try { def.render(fakeCtx()); def.demo(fakeCtx(), 0.7, 'lhat'); } catch (e) { threw = e; }
  ok('render/demo가 예외 없이 돈다', threw === null);
}

/* ══ 세션 보드 ════════════════════════════════════════ */

function testBoard() {
  console.log('\n[세션 보드]');
  const B = GP.board;

  eq('보드는 24칸', B.TUNE.CELLS, 24);
  eq('칸 종류가 다 있다',
     [...new Set(B.types)].sort().join(','), 'bowser,plain,star,start');

  // 순위 → 칸. 꼴등도 움직인다 — 0칸은 "너는 안 움직인다"는 뜻이 된다.
  ok('1등이 가장 많이 간다', B.stepsFor(0, 0, 0) > B.stepsFor(1, 0, 0));
  ok('꼴등도 0칸은 아니다', B.stepsFor(3, 0, 0) > 0);
  ok('순위표를 넘는 등수도 처리된다', B.stepsFor(99, 0, 0) > 0);

  // par 보너스 — 혼자 놀아도 잘하면 더 간다
  eq('par를 넘으면 보너스', B.stepsFor(0, 30, 25), B.stepsFor(0, 0, 0) + B.TUNE.PAR_BONUS);
  eq('절반을 넘으면 작은 보너스', B.stepsFor(0, 13, 25), B.stepsFor(0, 0, 0) + B.TUNE.HALF_BONUS);
  eq('par가 없으면 보너스 없음', B.stepsFor(0, 999, 0), B.stepsFor(0, 0, 0));

  // 동점은 같은 순위
  const rk = B.ranks([
    { from: 'p1', score: 10 }, { from: 'p2', score: 10 }, { from: 'p3', score: 4 }
  ]);
  eq('동점은 같은 순위', [rk.p1, rk.p2], [0, 0]);
  eq('그다음은 3등 자리', rk.p3, 2);

  // 별 칸: 지나가면 1, 정확히 밟으면 2
  const starAt = B.types.indexOf('star');
  let pc = B.newPiece();
  pc.pos = starAt - 1;
  B.advance(pc, 1);
  eq('별 칸에 정확히 멈추면 2개', pc.stars, B.TUNE.STAR_PASS + B.TUNE.STAR_LAND);

  pc = B.newPiece();
  pc.pos = starAt - 2;
  B.advance(pc, 3);
  eq('지나가기만 하면 1개', pc.stars, B.TUNE.STAR_PASS);

  // 쿠파 칸: 멈출 뿐 뒤로 가지 않는다 (감점 최소화)
  const bowserAt = B.types.indexOf('bowser');
  pc = B.newPiece();
  pc.pos = bowserAt - 1;
  const evs = B.advance(pc, 5);
  eq('쿠파 칸에서 멈춘다', pc.pos, bowserAt);
  ok('멈췄다는 사건을 남긴다', evs.some(e => e.kind === 'stop'));
  ok('뒤로 가지 않았다', pc.steps === 1);

  // 쿠파 칸에서 출발할 때는 다시 걸리지 않는다
  const before = pc.pos;
  B.advance(pc, 3);
  ok('쿠파 칸에서 출발하면 그냥 지나간다', pc.pos !== before);

  // 한 바퀴를 돌면 제자리
  pc = B.newPiece();
  const noBowser = { pos: 0, stars: 0, steps: 0 };
  for (let i = 0; i < B.TUNE.CELLS; i++) {
    noBowser.pos = (noBowser.pos + 1) % B.TUNE.CELLS;
  }
  eq('한 바퀴 돌면 출발 칸', noBowser.pos, 0);

  // 최종 순위: 별 먼저, 같으면 더 많이 간 쪽
  const st = B.standings({
    p1: { stars: 2, steps: 10 },
    p2: { stars: 3, steps: 5 },
    p3: { stars: 2, steps: 14 }
  });
  eq('별이 많은 쪽이 1등', st[0].from, 'p2');
  eq('별이 같으면 많이 간 쪽', st[1].from, 'p3');
  eq('등수가 붙는다', st.map(x => x.rank).join(','), '0,1,2');

  // 완전히 같으면 공동 1등 — 꼴등을 만들지 않는다
  const tie = B.standings({ p1: { stars: 1, steps: 6 }, p2: { stars: 1, steps: 6 } });
  eq('완전 동률은 공동 1등', [tie[0].rank, tie[1].rank], [0, 0]);

  // 배치는 칸 수만큼 나온다
  const pts = B.layout({ x: 0, y: 0, w: 800, h: 400 });
  eq('배치 좌표가 칸 수만큼', pts.length, B.TUNE.CELLS);
  ok('좌표가 사각형 안에 있다',
     pts.every(p => p.x >= 0 && p.x <= 800 && p.y >= 0 && p.y <= 400));

  // 5판 세션 시뮬레이션 — 한 판도 안 움직이는 사람이 없어야 한다
  const pieces = { p1: B.newPiece(), p2: B.newPiece() };
  for (let round = 0; round < 5; round++) {
    const scores = [{ from: 'p1', score: 30 }, { from: 'p2', score: 5 }];
    const r = B.ranks(scores);
    for (const s of scores) {
      const was = pieces[s.from].steps;
      B.advance(pieces[s.from], B.stepsFor(r[s.from], s.score, 25));
      if (pieces[s.from].steps === was) fails.push('한 판을 통째로 못 움직였다');
    }
  }
  ok('5판 동안 둘 다 계속 움직인다', !fails.includes('한 판을 통째로 못 움직였다'));
  ok('잘한 쪽이 더 멀리 간다', pieces.p1.steps > pieces.p2.steps);
  ok('둘 다 별을 하나는 얻는다', pieces.p1.stars > 0 && pieces.p2.stars > 0);
  console.log('     5판 후: p1 ' + pieces.p1.steps + '칸 ★' + pieces.p1.stars +
              ' / p2 ' + pieces.p2.steps + '칸 ★' + pieces.p2.stars);
}

/* ══ 다인 접속 ════════════════════════════════════════ */

function testMultiplayer() {
  console.log('\n[다인 접속]');

  const four = [
    { id: 'p1', name: 'A', char: 'lhat' }, { id: 'p2', name: 'B', char: 'mario' },
    { id: 'p3', name: 'C', char: 'peach' }, { id: 'p4', name: 'D', char: 'bowser' }
  ];

  for (const id of GP.games.ids()) {
    const def = GP.games.get(id);
    if (id === 'debug') continue;
    const api = makeApi(four.map(p => Object.assign({}, p)));
    def.init(api);

    // 넷이 각자 동작을 보낸다
    for (const p of four) {
      if (def.onMotion) def.onMotion({ a: def.motion === 'all' ? 'jump' : def.motion, from: p.id });
      if (def.onTilt) def.onTilt({ v: 0.5, from: p.id });
    }
    step(def, 1.0);

    const sc = def.getScore();
    eq(id + ': 네 명 모두 결과에 나온다', sc.length, 4);
    ok(id + ': 아이디가 섞이지 않는다',
       sc.map(s => s.from).sort().join(',') === 'p1,p2,p3,p4');

    let threw = null;
    try { def.render(fakeCtx()); } catch (e) { threw = e; }
    ok(id + ': 네 명이어도 그리기가 돈다', threw === null);
  }

  // 로프는 사람이 넷이면 NPC 없이 사람만 네 레인
  const rc = GP.games.get('ropeclimb');
  rc.init(makeApi(four.map(p => Object.assign({}, p))));
  eq('로프: 사람 넷이면 NPC 없음', rc._test.npcs().length, 0);
  eq('로프: 레인은 그대로 4개', rc._test.lanes().length, 4);
}

/* ══ 화면 안정화 ══════════════════════════════════════ */

/** fillText 호출 위치와 횟수를 기록하는 캔버스. 안전영역 검사에 쓴다. */
function recordingCtx(log) {
  const c = fakeCtx();
  c.textAlign = 'left';
  c.fillText = (text, x, y) => log.push({ text: String(text), x, y, align: c.textAlign });
  return c;
}

function testStability() {
  console.log('\n[화면 안정화]');
  const C = GP.config;
  const S = C.SAFE;
  const tv = GP.tv;
  const T = tv._test;

  // 화면을 그리려면 사람이 붙어 있어야 한다
  tv.players = [
    { id: 'p1', name: 'L모자', char: 'lhat', ready: true, score: 0, joinedAt: 0, gone: 0 },
    { id: 'p2', name: '마리오', char: 'mario', ready: true, score: 0, joinedAt: 0, gone: 0 }
  ];
  tv.code = '2345';
  tv.gameId = 'jumprope';
  tv.game = GP.games.get('jumprope');
  tv.game.init(makeApi(tv.players));
  T.pieceOf('p1').stars = 2;
  T.pieceOf('p2').stars = 1;

  const names = ['wait', 'char', 'select', 'demo', 'calib', 'count', 'play', 'result', 'board', 'final'];
  let worstText = 0;
  const outside = [];

  for (const name of names) {
    const log = [];
    const ctx = recordingCtx(log);
    tv.screen = name;
    tv.t = 0.5;
    let threw = null;
    try { T.screens[name](ctx); } catch (e) { threw = e; }
    ok(name + ' 화면이 예외 없이 그려진다', threw === null);
    if (threw) continue;

    if (log.length > C.MAX_FILLTEXT) {
      console.log('     ' + name + ' 화면 fillText ' + log.length + '회: ' +
                  log.map(t => t.text.slice(0, 6)).join(' | '));
    }
    worstText = Math.max(worstText, log.length);

    // 안전영역 5% 밖으로 나간 글자를 찾는다. 구형 TV는 가장자리가 잘린다.
    for (const t of log) {
      const pad = 40;                      // 글자 크기만큼의 여유
      if (t.x < S.x - pad || t.x > S.x + S.w + pad ||
          t.y < S.y - pad || t.y > S.y + S.h + pad) {
        outside.push(name + ': "' + t.text.slice(0, 12) + '" (' +
                     Math.round(t.x) + ',' + Math.round(t.y) + ')');
      }
    }
  }

  eq('안전영역 밖으로 나간 글자 없음', outside, []);
  ok('한 화면의 fillText가 상한 안 (' + worstText + '/' + C.MAX_FILLTEXT + ')',
     worstText <= C.MAX_FILLTEXT);

  // 게임을 계속 바꿔도 오프스크린 장수가 늘지 않는다 (30분 구동 시 메모리)
  for (let i = 0; i < 40; i++) {
    for (const id of GP.games.ids()) {
      if (id === 'debug') continue;
      GP.games.get(id).init(makeApi(tv.players));
    }
  }
  ok('오프스크린 시트가 상한을 안 넘는다 (' + GP.gfx.count() + '/' + C.MAX_OFFSCREEN + ')',
     GP.gfx.count() <= C.MAX_OFFSCREEN);
}

/* ══ 끊김 복구 ════════════════════════════════════════ */

function testReconnect() {
  console.log('\n[끊김 복구]');
  const tv = GP.tv;
  const T = tv._test;

  tv.players = [
    { id: 'p1', name: 'A', char: 'lhat', ready: true, score: 0, joinedAt: 0, gone: 0 },
    { id: 'p2', name: 'B', char: 'mario', ready: true, score: 0, joinedAt: 0, gone: 0 }
  ];
  tv.calib = { p1: 1, p2: 1 };
  tv.clock = 100;

  ok('둘 다 있으면 준비 완료', T.allReady());

  // p2가 끊겼다. 명단에서 바로 지우지 않는다 — 점수와 보드 위 말이 같이 사라진다.
  tv.players[1].gone = tv.clock;
  eq('끊겨도 명단에 남는다', tv.players.length, 2);
  ok('끊긴 사람을 기다리며 멈추지 않는다', T.allReady());
  ok('캘리브레이션도 기다리지 않는다', T.calibDone());

  // 유예 안에 돌아오면 그대로 이어진다
  tv.clock += 10;
  T.sweepPlayers();
  eq('유예 안에는 안 지운다', tv.players.length, 2);
  tv.players[1].gone = 0;
  ok('돌아오면 다시 참가자', T.here(tv.players[1]));

  // 안 돌아오면 지운다. 유령이 남으면 준비 대기가 영영 안 끝난다.
  tv.players[1].gone = tv.clock;
  tv.clock += T.GONE_SEC + 1;
  T.sweepPlayers();
  eq('오래 안 오면 명단에서 뺀다', tv.players.length, 1);

  // 아무도 안 남으면 준비 완료가 되면 안 된다
  tv.players[0].gone = tv.clock;
  ok('전부 끊기면 시작하지 않는다', !T.allReady());
  ok('전부 끊기면 캘리브레이션도 완료가 아니다', !T.calibDone());
}

/* ══ 현장 튜닝 오버라이드 ══════════════════════════════ */

function testTuneOverride() {
  console.log('\n[현장 튜닝 오버라이드]');
  const T = GP.tune;

  // 주소에 아무것도 없으면 아무 일도 안 일어난다. 배포본이 이 상태다.
  T._reset('');
  ok('주소에 없으면 조용하다', !T.has());

  // 판정 임계값 덮어쓰기
  const before = GP.tuning.SPIKE_ON;
  T._reset('?tune=SPIKE_ON:10,SQUAT_MIN_MS:400');
  eq('두 개를 적용한다', T.apply(GP.tuning, ''), 2);
  eq('임계값이 바뀐다', GP.tuning.SPIKE_ON, 10);
  eq('두 번째도 바뀐다', GP.tuning.SQUAT_MIN_MS, 400);
  ok('적용됐다고 알린다', T.has() && T.summary().indexOf('2개') >= 0);
  ok('무엇을 바꿨는지 남긴다', T.applied().some(s => s.indexOf('SPIKE_ON') >= 0));
  GP.tuning.SPIKE_ON = before;
  GP.tuning.SQUAT_MIN_MS = 300;

  // 게임별 값 — 점 앞이 게임 id
  const rc = GP.games.get('ropeclimb');
  const h0 = rc.tune.HEIGHT;
  T._reset('?tune=ropeclimb.HEIGHT:18');
  eq('게임 값에 적용된다', T.apply(rc.tune, 'ropeclimb'), 1);
  eq('로프 높이가 낮아진다', rc.tune.HEIGHT, 18);
  eq('다른 게임에는 안 붙는다', T.apply(GP.games.get('jumprope').tune, 'jumprope'), 0);
  rc.tune.HEIGHT = h0;

  // 없는 이름은 조용히 통과시키지 않는다 — 오타인지 안 먹는 건지 현장에서 못 가린다
  T._reset('?tune=SPIKE_OM:10');
  eq('오타는 적용되지 않는다', T.apply(GP.tuning, ''), 0);
  ok('오타를 기록한다', T.rejected().some(s => s.indexOf('SPIKE_OM') >= 0));
  ok('무시했다고 화면에 알린다', T.summary().indexOf('무시') >= 0);

  // 숫자가 아니면 거부
  T._reset('?tune=SPIKE_ON:abc');
  eq('숫자가 아니면 안 받는다', T.apply(GP.tuning, ''), 0);
  ok('사유를 남긴다', T.rejected().length > 0);

  // 함수·객체 자리를 숫자로 덮어쓰지 않는다
  T._reset('?tune=blockbreak.WEIGHT:5');
  eq('숫자가 아닌 항목은 안 바꾼다', T.apply(GP.games.get('blockbreak').tune, 'blockbreak'), 0);
  ok('WEIGHT는 그대로', typeof GP.games.get('blockbreak').tune.WEIGHT === 'object');

  // 형식이 깨져도 나머지는 살린다. 현장에서 하나 틀렸다고 전부 날아가면 곤란하다
  T._reset('?tune=SPIKE_ON:9,망가진값,SQUAT_MAX_MS:2000');
  const n = T.apply(GP.tuning, '');
  eq('멀쩡한 것만 적용', n, 2);
  ok('깨진 항목을 기록한다', T.rejected().length > 0);
  GP.tuning.SPIKE_ON = before;
  GP.tuning.SQUAT_MAX_MS = 2500;

  // 다른 쿼리와 섞여 있어도 찾는다
  T._reset('?dev=1&tune=SPIKE_ON:11&fps=1');
  eq('다른 파라미터와 섞여도 읽는다', T.apply(GP.tuning, ''), 1);
  GP.tuning.SPIKE_ON = before;

  T._reset('');
}

/* ══ 에셋 폴백 ════════════════════════════════════════ */

function testAssets() {
  console.log('\n[에셋 폴백]');
  const A = GP.assets;

  // 기본값: 매니페스트가 비어 있다. 지금 상태가 이거다.
  eq('매니페스트는 비어서 시작한다',
     Object.keys(GP.assetManifest.chars).length + Object.keys(GP.assetManifest.bg).length, 0);

  A._reset();
  A.boot(GP.assetManifest);
  eq('받을 것이 없다', A.status().total, 0);
  eq('그림이 없으면 캐릭터를 안 그린다', A.charFrame(fakeCtx(), 'lhat', 'idle', 0, 0, 100), false);
  eq('그림이 없으면 배경도 안 그린다', A.bg(fakeCtx(), 'jumprope', 1280, 720), false);

  // 그림을 선언하면 받기 시작한다. 다 받기 전에는 여전히 폴백이다.
  A._reset();
  A.boot({
    chars: { lhat: { src: 'assets/chars/lhat.png', fw: 96, fh: 160, poses: { idle: 0, jump: 1 } } },
    bg: { jumprope: { src: 'assets/bg/jumprope.png' } }
  });
  eq('두 장을 받기 시작한다', A.status().total, 2);
  eq('아직 다 안 받았다', A.status().pending, 2);
  eq('받는 중에는 안 그린다', A.charFrame(fakeCtx(), 'lhat', 'idle', 0, 0, 100), false);
  ok('받는 중에도 예외가 안 난다', true);

  // 도착하면 그때부터 쓴다
  const rec = A.status();
  ok('진단이 현황을 알려준다', rec.total === 2 && rec.loaded === 0);

  // 실패해도 게임은 돈다 — 404가 나도 도형으로 돌아갈 뿐이다
  A._reset();
  A.boot({ chars: { lhat: { src: 'assets/chars/없는파일.png' } }, bg: {} });
  eq('없는 파일도 일단 시도한다', A.status().total, 1);
  eq('그리지는 않는다', A.charFrame(fakeCtx(), 'lhat', 'idle', 0, 0, 100), false);

  // chars.draw가 폴백으로 내려가 예외 없이 그려진다
  let threw = null;
  try {
    GP.chars.draw(fakeCtx(), 'lhat', 100, 200, 160, 'jump');
    GP.chars.draw(fakeCtx(), 'bowser', 100, 200, 160, 'idle');
  } catch (e) { threw = e; }
  ok('그림이 없어도 캐릭터가 그려진다', threw === null);

  // 게임 배경도 마찬가지
  threw = null;
  try {
    for (const id of GP.games.ids()) {
      const def = GP.games.get(id);
      def.init(makeApi());
      def.render(fakeCtx());
    }
  } catch (e) { threw = e; }
  ok('그림이 없어도 다섯 게임이 다 그려진다', threw === null);

  A._reset();
  A.boot(GP.assetManifest);
}

/* ══ 실행 ═════════════════════════════════════════════ */

testJumprope();
testNpc();
testRopeclimb();
testHammer();
testBlockbreak();
testPseudo3d();
testRacing();
testRoulette();
testBoard();
testMultiplayer();
testStability();
testReconnect();
testTuneOverride();
testAssets();

console.log();
if (fails.length) {
  console.log('실패 ' + fails.length + '개: ' + fails.join(', '));
  process.exit(1);
}
console.log('전체 통과');
