/**
 * motion.js 판정 시험. 합성 센서 데이터를 넣고 기대한 이벤트가 나오는지 본다.
 * 브라우저 없이 돌린다 — 임계값 튜닝에 쓰는 판이다.
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.resolve(__dirname, '..');

const win = { performance: { now: () => 0 } };
win.window = win;
const sb = vm.createContext(win);
for (const f of ['js/tuning.js', 'js/motion.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
}
const { Detector } = win.GP.motion;
const T = win.GP.tuning;

const G = T.G;
const HZ = 60, DT = 1000 / HZ;
const BASE = { gx: 0, gy: 1, gz: 0, pitch0: 0, roll0: 0 };

/** 구간 목록을 60Hz 표본으로 펼친다. seg = {ms, vert, mag?, pitch, roll} */
function play(det, segs) {
  let t = 0;
  for (const seg of segs) {
    const n = Math.round(seg.ms / DT);
    for (let i = 0; i < n; i++) {
      const k = n > 1 ? i / (n - 1) : 1;
      const vert = seg.vert0 !== undefined ? seg.vert0 + (seg.vert - seg.vert0) * k : (seg.vert || 0);
      const pitch = seg.pitch0 !== undefined ? seg.pitch0 + (seg.pitch - seg.pitch0) * k : (seg.pitch || 0);
      const roll = seg.roll0 !== undefined ? seg.roll0 + (seg.roll - seg.roll0) * k : (seg.roll || 0);
      // 자유낙하 구간은 중력이 사라진다. 그 외에는 중력 + 세로 가속도.
      // 폰이 pitch만큼 기울면 그 벡터가 폰 좌표계에서 y·z로 갈라진다.
      // (실기에서 "카메라 쪽만 젖히기"가 만드는 바로 그 신호)
      const up = seg.freefall ? 0.4 : G + vert;
      const rad = pitch * Math.PI / 180;
      det.feed({ t, ax: 0, ay: up * Math.cos(rad), az: up * Math.sin(rad), pitch, roll });
      t += DT;
    }
  }
  return t;
}

function collect(det) {
  const got = [];
  ['jump', 'punch', 'squat'].forEach(a => det.on(a, e => got.push(a + '@' + Math.round(e.t) + ' p=' + e.p.toFixed(2))));
  det.on('lane', e => got.push('lane' + e.lane + '@' + Math.round(e.deg) + 'deg'));
  return got;
}

function make(enabled) {
  const d = new Detector();
  d.setBaseline(BASE);
  if (enabled) d.setEnabled(enabled);
  return d;
}

let fails = 0;
function check(name, actual, expect) {
  const ok = JSON.stringify(actual) === JSON.stringify(expect);
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name);
  console.log('       기대: ' + JSON.stringify(expect));
  console.log('       실제: ' + JSON.stringify(actual));
}

const kinds = a => a.map(s => s.split('@')[0]);

/* 1. 점프 — 웅크림, 도약 스파이크, 체공, 착지 스파이크 */
const JUMP = [
  { ms: 300, vert: 0 },
  { ms: 150, vert: -4 },                 // 웅크림
  { ms: 80, vert: 20 },                  // 도약 (발이 바닥에 있음)
  { ms: 300, vert: 0, freefall: true },  // 체공
  { ms: 70, vert: 28 },                  // 착지
  { ms: 300, vert: 0 }
];

// 게임처럼 점프만 켠다. 점프의 웅크림-도약은 세로 왕복이기도 해서 squat이 켜져 있으면 잡힌다.
const JUMP_ONLY = { punch: false, squat: false };
const dJumpOnly = make(JUMP_ONLY);
const gJumpOnly = collect(dJumpOnly);
play(dJumpOnly, JUMP);
check('점프 (jump만 켬) → jump 1회', kinds(gJumpOnly), ['jump']);

const dBoth = make();
const gBoth = collect(dBoth);
play(dBoth, JUMP);
check('점프 (둘 다 켬) → 도약=punch, 착지=jump (명세상 정상)', kinds(gBoth), ['punch', 'jump']);

/* 2. 쳐올리기 — 체공 없는 스파이크 */
const PUNCH = [
  { ms: 300, vert: 0 },
  { ms: 80, vert: 20 },
  { ms: 400, vert: 0 }
];
const dPunch = make();
const gPunch = collect(dPunch);
play(dPunch, PUNCH);
check('쳐올리기 → punch 1회, jump 없음', kinds(gPunch), ['punch']);

/* 3. 쳐올리기 20회 연속 — 오인식이 섞이는지 */
const dRep = make();
const gRep = collect(dRep);
const reps = [];
for (let i = 0; i < 20; i++) reps.push({ ms: 300, vert: 0 }, { ms: 80, vert: 18 + (i % 5) });
reps.push({ ms: 300, vert: 0 });   // 마지막 스파이크도 임계 아래로 내려와야 판정된다
play(dRep, reps);
const wrong = kinds(gRep).filter(k => k !== 'punch').length;
check('쳐올리기 20회 → punch 20회, 오인식 0', [gRep.length, wrong], [20, 0]);

/* 4. 점프 20회 연속 (jump만 켬) */
const dRepJ = make(JUMP_ONLY);
const gRepJ = collect(dRepJ);
const repsJ = [];
for (let i = 0; i < 20; i++) repsJ.push(...JUMP.slice(1));
play(dRepJ, repsJ);
check('점프 20회 → jump 20회', [gRepJ.length, kinds(gRepJ).filter(k => k !== 'jump').length], [20, 0]);

/* 5. 스쿼트 — 몸이 내려갔다 올라오는 세로 왕복. 각도가 아니라 가속도다.
 *    약 25cm를 0.5초에 내려가면 가속 -3, 제동 +3 m/s^2 정도가 난다 (실기 파형은 아직 못 봄). */
const SQUAT = [
  { ms: 300, vert: 0 },
  { ms: 250, vert: -3 },   // 내려가기 시작
  { ms: 250, vert: 3 },    // 바닥에서 멈춤
  { ms: 200, vert: 0 },    // 앉은 채
  { ms: 250, vert: 3 },    // 일어나기 시작
  { ms: 250, vert: -3 },   // 위에서 멈춤
  { ms: 300, vert: 0 }
];
const dSq = make();
const gSq = collect(dSq);
play(dSq, SQUAT);
check('스쿼트 1회 → squat 1회', kinds(gSq), ['squat']);

const dSq5 = make();
const gSq5 = collect(dSq5);
const sq5 = [];
for (let i = 0; i < 5; i++) sq5.push(...SQUAT.slice(1));
play(dSq5, sq5);
check('스쿼트 5회 → squat 5회', [gSq5.length, kinds(gSq5).filter(k => k !== 'squat').length], [5, 0]);

/* 6. 그냥 앉아 있기 — 내려가기만 하고 올라오지 않으면 발화하지 않아야 한다 */
const dSit = make();
const gSit = collect(dSit);
play(dSit, [{ ms: 300, vert: 0 }, { ms: 250, vert: -3 }, { ms: 250, vert: 3 }, { ms: 3000, vert: 0 }]);
check('앉아만 있기 → 발화 없음', gSit, []);

/* 6b. 실기에서 잡힌 오인식 — 같은 높이에서 폰 윗부분(카메라)만 젖혔다 세우기.
 *     높이가 안 변했으니 스쿼트가 아니다. */
const dTiltOnly = make();
const gTiltOnly = collect(dTiltOnly);
play(dTiltOnly, [
  { ms: 300, pitch: 0 },
  { ms: 400, pitch0: 0, pitch: -30 },
  { ms: 300, pitch: -30 },
  { ms: 400, pitch0: -30, pitch: 0 },
  { ms: 1000, pitch: 0 }
]);
check('기울이기만 → 발화 없음', gTiltOnly, []);

/* 6c. 보정 때와 다른 각도로 폰을 쥔 채 스쿼트 — 25도 젖힌 채 2초 있다가 한 번.
 *     세로축을 보정 때 중력에 고정하면 cos 손실이 상수 편향으로 끼어 속도가 한쪽으로 흐른다. */
const dTilted = make();
const gTilted = collect(dTilted);
play(dTilted, [{ ms: 500, pitch0: 0, pitch: 25 }, { ms: 2000, pitch: 25 }]
  .concat(SQUAT.slice(1).map(s => Object.assign({ pitch: 25 }, s))));
check('젖힌 채 스쿼트 → squat 1회', kinds(gTilted), ['squat']);

/* 6d. 제자리 걸음 — 2Hz로 위아래 흔들리지만 스쿼트가 아니다 */
const dWalk = make();
const gWalk = collect(dWalk);
const walk = [{ ms: 300, vert: 0 }];
for (let i = 0; i < 8; i++) walk.push({ ms: 125, vert: -2 }, { ms: 125, vert: 2 });
walk.push({ ms: 500, vert: 0 });
play(dWalk, walk);
check('제자리 걸음 2초 → 발화 없음', gWalk, []);

/* 7. 좌우 기울기 — 레인 매핑 */
const dT = make();
const gT = collect(dT);
play(dT, [
  { ms: 300, roll: 0 },
  { ms: 400, roll0: 0, roll: -20 },   // 왼쪽
  { ms: 400, roll0: -20, roll: 0 },
  { ms: 400, roll0: 0, roll: 20 },    // 오른쪽
  { ms: 400, roll0: 20, roll: 0 }
]);
check('기울기 → 레인 1-0-1-2-1', gT.map(s => s.split('@')[0]), ['lane0', 'lane1', 'lane2', 'lane1']);

/* 8. 임계 경계에서 떨기 — 히스테리시스가 막아야 한다 */
const dH = make();
const gH = collect(dH);
const wob = [{ ms: 300, roll: 0 }, { ms: 200, roll0: 0, roll: 12 }];
for (let i = 0; i < 12; i++) wob.push({ ms: 60, roll0: 12, roll: 10 }, { ms: 60, roll0: 10, roll: 12 });
play(dH, wob);
check('임계 경계 12회 진동 → 레인 전환 1회', gH.map(s => s.split('@')[0]), ['lane2']);

/* 9. 기울기 연속값 */
const dV = make();
play(dV, [{ ms: 1000, roll: T.TILT_RANGE_DEG }]);
check('roll이 TILT_RANGE_DEG면 연속값 1.0', Math.round(dV.tilt * 100) / 100, 1);
play(dV, [{ ms: 1000, roll: -60 }]);
check('범위를 넘으면 -1로 잘림', dV.tilt, -1);

console.log(fails === 0 ? '\n전체 통과' : '\n실패 ' + fails + '건');
process.exit(fails ? 1 : 0);
