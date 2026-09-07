/**
 * net.js / calib.js 시험. 가짜 WebSocket을 주입해 브라우저 없이 돌린다.
 *
 *   node test/net-test.js
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.resolve(__dirname, '..');

let NOW = 0;                       // 가짜 시계. 스로틀링 시험에 필요하다
const win = {
  performance: { now: () => NOW },
  setTimeout, clearTimeout, setInterval, clearInterval,
  location: { search: '', protocol: 'https:', host: 'example.test' }
};
win.window = win;
const sb = vm.createContext(win);
for (const f of ['js/tuning.js', 'js/motion.js', 'js/calib.js', 'js/net.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
}
const LP = win.LP;
const T = LP.tuning;

/* 가짜 WebSocket */
const sockets = [];
function FakeWS(url) {
  this.url = url;
  this.readyState = 0;
  this.sent = [];
  sockets.push(this);
}
FakeWS.prototype.send = function (s) {
  if (this.readyState !== 1) throw new Error('not open');
  this.sent.push(JSON.parse(s));
};
FakeWS.prototype.close = function () {
  this.readyState = 3;
  if (this.onclose) this.onclose({ code: 1000 });
};
FakeWS.prototype.open = function () {
  this.readyState = 1;
  if (this.onopen) this.onopen();
};
FakeWS.prototype.recv = function (obj) {
  if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) });
};
FakeWS.prototype.drop = function () {          // 서버가 끊은 경우
  this.readyState = 3;
  if (this.onclose) this.onclose({ code: 1006 });
};

let fails = 0;
function check(name, actual, expect) {
  const ok = JSON.stringify(actual) === JSON.stringify(expect);
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name);
  if (!ok) {
    console.log('       기대: ' + JSON.stringify(expect));
    console.log('       실제: ' + JSON.stringify(actual));
  }
}

function makeNet(role) {
  sockets.length = 0;
  return new LP.net.Net({ url: 'wss://relay.test/', role, socketFactory: u => new FakeWS(u) });
}

/* 1. 접속 URL 형식 */
const tv = makeNet('tv');
tv.connect();
check('TV 최초 접속 URL', sockets[0].url, 'wss://relay.test/ws/new?role=tv');

const play = makeNet('play');
play.connect('2345');
check('폰 접속 URL', sockets[0].url, 'wss://relay.test/ws/2345?role=play');

/* 2. 연결 전 메시지는 큐에 쌓였다가 접속 시 나간다 */
const n2 = makeNet('tv');
n2.connect();
n2.createRoom();
check('접속 전에는 전송 안 됨', sockets[0].sent.length, 0);
sockets[0].open();
check('접속 후 큐가 비워짐', sockets[0].sent, [{ t: 'create' }]);

/* 3. 서버가 준 방 코드를 기억한다 */
sockets[0].recv({ t: 'room', code: '2839' });
check('방 코드 수신', n2.code, '2839');

/* 4. 상태 콜백 */
const seen = [];
const n4 = makeNet('play');
n4.on('status', s => seen.push(s.status));
n4.connect('2345');
sockets[0].open();
check('상태 전이 connecting → open', seen, ['connecting', 'open']);

/* 5. 예기치 않은 끊김이면 재접속을 예약한다 */
sockets[0].drop();
check('끊기면 reconnecting', seen[seen.length - 1], 'reconnecting');

/* 6. 사용자가 닫으면 재접속하지 않는다 */
const n6 = makeNet('play');
n6.connect('2345');
sockets[0].open();
n6.close();
check('close() 후 상태', n6.status, 'closed');
check('close() 후 소켓 추가 생성 없음', sockets.length, 1);

/* 7. tilt 스로틀링 — 60Hz로 넣어도 TILT_SEND_HZ 이하로 나간다 */
const n7 = makeNet('play');
n7.connect('2345');
sockets[0].open();
sockets[0].sent.length = 0;
const step = 1000 / 60;
for (let i = 0; i < 60; i++) {          // 1초치
  n7.tilt(Math.sin(i / 10), i * step);
}
const tiltCount = sockets[0].sent.filter(m => m.t === 'tilt').length;
// 60Hz 표본과 40ms 간격이 딱 안 맞아 실제로는 20Hz 근처가 된다. 상한만 지키면 된다.
check('60Hz 입력 → ' + T.TILT_SEND_HZ + 'Hz 이하로 전송 (실제 ' + tiltCount + ')', tiltCount <= T.TILT_SEND_HZ && tiltCount >= 15, true);

/* 8. 판정 결과만 나간다. 원시 표본은 절대 나가지 않는다 */
const n8 = makeNet('play');
n8.connect('2345');
sockets[0].open();
const det = new LP.motion.Detector();
det.setBaseline({ gx: 0, gy: 1, gz: 0, pitch0: 0, roll0: 0 });
det.setEnabled({ jump: false });
n8.bindDetector(det);
sockets[0].sent.length = 0;

const G = T.G, DT = 1000 / 60;
let t = 0;
function feedFlat(ms, vert) {
  for (let i = 0; i < Math.round(ms / DT); i++) {
    det.feed({ t, ax: 0, ay: G + vert, az: 0, pitch: 0, roll: 0 });
    t += DT;
  }
}
NOW = 0;
feedFlat(300, 0); feedFlat(80, 20); feedFlat(300, 0);

const types = [...new Set(sockets[0].sent.map(m => m.t))].sort();
check('전송된 메시지 종류', types, ['motion', 'tilt']);
check('원시 표본(sample)은 전송 안 됨', sockets[0].sent.some(m => m.ax !== undefined || m.t === 'sample'), false);
const motions = sockets[0].sent.filter(m => m.t === 'motion');
check('punch 1회 전송', motions.length, 1);
check('motion 메시지 형식', Object.keys(motions[0]).sort(), ['a', 'p', 't']);
check('세기 p는 0~1', motions[0].p >= 0 && motions[0].p <= 1, true);

/* 9. 캘리브레이션 — 가만히 서 있으면 기준 자세가 나온다 */
const det9 = new LP.motion.Detector();
let calibResult;
LP.calib.run(det9, { ms: 1000, onDone: (err, b) => { calibResult = { err, b }; } });
let ct = 0;
for (let i = 0; i < 70; i++) {                 // 약 1.17초치
  det9.feed({ t: ct, ax: 0.1, ay: 9.7, az: 0.2, pitch: 12, roll: -3 });
  ct += DT;
}
check('보정 성공', calibResult && calibResult.err === null, true);
check('기준 pitch/roll', [Math.round(calibResult.b.pitch0), Math.round(calibResult.b.roll0)], [12, -3]);
check('중력 단위벡터 크기 1', Math.round(Math.hypot(calibResult.b.gx, calibResult.b.gy, calibResult.b.gz) * 1000) / 1000, 1);
check('판정기에 기준이 들어감', det9.baseline.provisional, false);

/* 10. 보정 중 흔들리면 거부한다 */
const det10 = new LP.motion.Detector();
let r10;
LP.calib.run(det10, { ms: 1000, onDone: (err) => { r10 = err; } });
let ct2 = 0;
for (let i = 0; i < 70; i++) {
  det10.feed({ t: ct2, ax: Math.sin(i) * 6, ay: 9.7, az: 0, pitch: 12 + Math.sin(i) * 20, roll: -3 });
  ct2 += DT;
}
check('흔들리면 재보정 요구', !!(r10 && r10.message), true);

/* 11. 표본이 모자라면 신뢰하지 않는다 */
const det11 = new LP.motion.Detector();
let r11;
LP.calib.run(det11, { ms: 500, onDone: (err) => { r11 = err; } });
let ct3 = 0;
for (let i = 0; i < 5; i++) { det11.feed({ t: ct3, ax: 0, ay: 9.8, az: 0, pitch: 0, roll: 0 }); ct3 += 200; }
check('표본 부족이면 거부', !!(r11 && r11.message), true);

console.log(fails === 0 ? '\n전체 통과' : '\n실패 ' + fails + '건');
process.exit(fails ? 1 : 0);
