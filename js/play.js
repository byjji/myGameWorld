/**
 * L-Party 폰 컨트롤러
 *
 * 다섯 화면을 단일 페이지 + 상태 머신으로 처리한다. 라우팅 없음 (PROJECT.md 7장).
 * TV가 보낸 phase 메시지에 따라 UI를 바꾼다.
 *
 * 폰은 컨트롤러 전용이다. 게임 화면을 그리지 않는다.
 * 동작 중에는 폰 화면을 볼 수 없으므로 진동과 소리가 인식 여부를 알리는 유일한 수단이다.
 *
 * 문법 수준: ES5
 */
(function (global) {
  'use strict';

  var LP = global.LP || (global.LP = {});
  var T = LP.tuning;
  var doc = global.document;

  // 코드에 쓰는 숫자는 여섯 개뿐이다. 0과 6, 1과 7은 5세에게 비슷하게 보인다.
  // 그래서 키패드에도 그 여섯 개만 띄운다. 없는 숫자를 누를 일 자체를 없앤다.
  var CODE_DIGITS = ['2', '3', '4', '5', '8', '9'];

  var JOIN_TIMEOUT_MS = 4000;

  var ICON = { jump: '↑', squat: '↓', punch: '✊', tilt: '↔', all: '●' };
  var LABEL = {
    jump: '뛰기', squat: '앉았다 일어나기', punch: '위로 쳐올리기',
    tilt: '좌우로 기울이기', all: '아무 동작이나'
  };

  function el(id) { return doc.getElementById(id); }

  /**
   * TV가 보낸 피드백 이름 -> 진동 패턴(ms).
   *
   * 종류가 손끝으로 구분돼야 한다. 잘한 것은 짧고 산뜻하게, 잘못된 것은 길고 둔하게.
   * 길게 떨면 손이 흔들려 다음 판정이 흐려진다 — 200ms를 넘기지 않는다.
   */
  var VIB = {
    good:   40,
    combo:  [30, 40, 30],
    coin:   25,
    miss:   [90, 50, 90],
    hit:    [140],
    star:   [20, 30, 20, 30, 60],
    mush:   [40, 40, 80],
    dud:    15,
    bomb:   [120, 60, 120],
    go:     [60, 60, 60],
    fanfare:[80, 60, 160]
  };

  var S = {
    screen: 'code',
    code: '',
    'char': null,
    motion: 'jump',
    pid: null,        // 서버가 알려준 내 자리 (p1..p4). fx 필터에 쓴다
    net: null,
    det: null,
    detach: null,
    wakeLock: null,
    cancelCalib: null,
    joinTimer: 0,
    joined: false,
    lastCalibSend: 0,
    debug: false,
    wave: []          // 파형 오버레이용 최근 값
  };

  LP.play = { state: S };

  // 임계값을 주소로 덮어썼으면 그 사실을 폰 위쪽에 항상 띄운다.
  // 판정이 이상할 때 "튜닝을 켜둔 것"과 "판정이 잘못된 것"을 구분하려면 보여야 한다.
  if (LP.tune && LP.tune.has()) {
    var tw = el('tune-warn');
    if (tw) {
      tw.textContent = LP.tune.summary();
      tw.className = 'on' + (LP.tune.rejected().length ? ' bad' : '');
    }
  }

  /* 화면 전환 */

  var SCREENS = ['code', 'char', 'wait', 'calib', 'ctrl'];

  function show(name) {
    S.screen = name;
    for (var i = 0; i < SCREENS.length; i++) {
      var node = el('s-' + SCREENS[i]);
      if (node) node.className = 'screen' + (SCREENS[i] === name ? ' on' : '');
    }
    if (name === 'ctrl') requestWakeLock();
    else releaseWakeLock();

    // 파형은 컨트롤러 화면에서만 띄운다. 다른 화면에서는 버튼을 가린다.
    if (S.debug) el('wave').className = (name === 'ctrl' ? 'on' : '');
  }

  /* 1. 코드 입력 */

  function buildKeypad() {
    var pad = el('keypad');
    pad.innerHTML = '';

    for (var i = 0; i < CODE_DIGITS.length; i++) {
      (function (d) {
        var b = doc.createElement('button');
        b.className = 'key';
        b.textContent = d;
        b.addEventListener('click', function () { pressDigit(d); });
        pad.appendChild(b);
      })(CODE_DIGITS[i]);
    }

    var clear = doc.createElement('button');
    clear.className = 'key wide';
    clear.textContent = '지우기';
    clear.addEventListener('click', function () { S.code = ''; paintCode(); });
    pad.appendChild(clear);
  }

  function paintCode() {
    var v = el('code-view');
    var s = S.code;
    while (s.length < 4) s += '·';
    v.textContent = s;
  }

  function pressDigit(d) {
    if (S.code.length >= 4) return;
    S.code += d;
    paintCode();

    // 4자리가 채워지면 바로 접속한다. 확인 버튼은 없다.
    if (S.code.length === 4) tryJoin();
  }

  function wrongCode(msg) {
    var v = el('code-view');
    v.className = 'shake';
    global.setTimeout(function () { v.className = ''; }, 400);
    vibrate([80, 60, 80]);
    S.code = '';
    paintCode();
    if (msg) el('s-code').querySelector('.sub').textContent = msg;
    show('code');
  }

  /* 접속 */

  function tryJoin() {
    // 센서 권한은 반드시 사용자 제스처 안에서 요청해야 한다 (iOS).
    // 숫자를 누른 이 흐름이 그 제스처다.
    startSensors();

    var useDev = LP.devlink && LP.devlink.enabled();

    S.net = new LP.net.Net({
      url: LP.net.defaultUrl(),
      role: 'play',
      socketFactory: useDev ? LP.devlink.factory : undefined
    });

    S.net.on('status', function (st) {
      var off = el('offline');
      var bad = (st.status === 'reconnecting' || st.status === 'closed');
      off.className = bad && S.screen !== 'code' ? 'on' : '';
    });

    // 서버가 없는 방이라고 알려주는 경우
    S.net.on('err', function (m) { wrongCode(m.msg || '그런 방이 없어요'); });

    // 붙었다고 알린다. 서버는 릴레이일 뿐이라 TV가 스스로 알 방법이 없다.
    // 이걸 받은 TV가 현재 단계를 되돌려준다.
    S.net.on('open', function () { S.net.send({ t: 'hello' }); });

    // 서버가 자리(p1..p4)를 알려준다. 내 것만 골라 떨기 위해 필요하다.
    S.net.on('you', function (m) { S.pid = m.pid || null; });

    S.net.on('phase', function (m) { onPhase(m); });

    // TV가 보내는 피드백. 게임 결과를 폰이 판단하지 않는다 — TV가 알려준 대로 떤다.
    // 동작 중에는 폰 화면을 볼 수 없으므로 이 진동이 유일한 확인 수단이다 (PROJECT.md 7장).
    S.net.on('fx', function (m) {
      if (m.to && m.to !== S.pid) return;   // 나에게 온 것만
      var pat = VIB[m.v];
      if (pat) vibrate(pat);
      // TV가 소리를 못 냈다고 알려오면 폰이 대신 낸다.
      // TV는 입력을 안 받아 자동재생 제스처를 만들 수 없다 (js/sfx.js).
      if (m.snd) beep(m.v);
    });

    S.net.connect(S.code);

    // 응답이 없으면 틀린 코드로 본다. 확인 버튼이 없으니 여기서 걸러야 한다.
    S.joinTimer = global.setTimeout(function () {
      if (!S.joined) {
        if (S.net) { S.net.close(); S.net = null; }
        wrongCode('코드를 다시 확인해요');
      }
    }, JOIN_TIMEOUT_MS);

    show('char');
  }

  function onPhase(m) {
    S.joined = true;
    if (S.joinTimer) { global.clearTimeout(S.joinTimer); S.joinTimer = 0; }
    if (m.motion) S.motion = m.motion;

    // TV 화면과 폰 화면을 맞춘다. 폰이 앞서 나가지 않게 TV가 기준이다.
    switch (m.v) {
      case 'wait':
      case 'char':
        if (S['char']) show('wait'); else show('char');
        setWait('TV를 보세요', '');
        break;
      case 'select':
        // 룰렛은 TV에서 돈다. 폰은 흔들라는 말만 한다 —
        // 여기서 폰에 목록을 그리면 조카가 TV 대신 폰을 본다 (PROJECT.md 1장).
        show('wait');
        setWait('폰을 흔들어요', 'TV에서 놀이가 정해져요');
        break;
      case 'demo':
        show('wait');
        setWait(LABEL[S.motion] || '', '이렇게 하는 거예요');
        break;
      case 'calib':
        show('calib');
        runCalib();
        break;
      case 'count':
        show('wait');
        setWait('준비!', '');
        break;
      case 'play':
        show('ctrl');
        paintController();
        break;
      case 'result':
        show('wait');
        setWait('잘했어요!', 'TV를 보세요');
        break;
      case 'board':
        show('wait');
        setWait('말이 움직여요', 'TV를 보세요');
        break;
      case 'final':
        show('wait');
        setWait('오늘의 파티 끝!', '폰을 흔들면 다시 해요');
        break;
    }
  }

  function setWait(title, sub) {
    el('wait-title').textContent = title;
    el('wait-sub').textContent = sub || '';
  }

  /* 2. 캐릭터 선택 */

  function buildChars() {
    var box = el('chars');
    box.innerHTML = '';
    var list = LP.chars.list;

    for (var i = 0; i < list.length; i++) {
      (function (c) {
        var b = doc.createElement('div');
        b.className = 'chip';
        b.style.background = c.body;

        var dot = doc.createElement('div');
        dot.className = 'dot';
        dot.style.background = c.cap;
        b.appendChild(dot);

        var t = doc.createElement('div');
        t.textContent = c.name;
        b.appendChild(t);

        b.addEventListener('click', function () { pickChar(c.id); });
        b.setAttribute('data-id', c.id);
        box.appendChild(b);
      })(list[i]);
    }
  }

  function pickChar(id) {
    S['char'] = id;
    var chips = el('chars').children;
    for (var i = 0; i < chips.length; i++) {
      chips[i].className = 'chip' + (chips[i].getAttribute('data-id') === id ? ' sel' : '');
    }
    el('ready-btn').disabled = false;
    vibrate(30);
  }

  function sendReady() {
    if (!S['char'] || !S.net) return;
    var c = LP.chars.byId[S['char']];
    // 5세에게 이름 입력을 시키지 않는다. 캐릭터 이름을 그대로 쓴다.
    S.net.join(c ? c.name : '플레이어', S['char']);
    S.net.send({ t: 'ready' });
    show('wait');
    setWait('TV를 보세요', '곧 시작해요');
  }

  /* 3. 센서 + 판정 */

  function startSensors() {
    if (S.det) return;

    S.det = new LP.motion.Detector();

    // 합성 센서를 릴레이 선택과 분리한다.
    //   ?dev=1   로컬 릴레이(BroadcastChannel) + 키보드 센서 — 서버 없이 흐름만 볼 때
    //   ?keys=1  진짜 릴레이 서버 + 키보드 센서 — 통신까지 태워서 게임을 볼 때
    // 배포본 주소에는 둘 다 없다.
    if (/[?&](dev=1|keys=1)/.test(global.location.search) && LP.devsensor) {
      // 데스크톱에는 센서가 없어 키보드로 흉내낸다. 실기에서는 이 갈래를 타지 않는다.
      S.detach = LP.devsensor.attach(S.det);
    } else {
      S.detach = LP.motion.attach(S.det, function (err) {
        if (err) {
          setWait('센서를 쓸 수 없어요', err.message);
          show('wait');
        }
      });
    }

    // 판정 결과와 기울기 연속값만 나간다. 원시 센서값은 폰 밖으로 나가지 않는다.
    S.det.on('action', function (e) {
      if (S.net) S.net.motion(e.a, Math.round(e.p * 100) / 100);
      if (S.screen === 'ctrl') feedback(e);
    });
    S.det.on('tilt', function (e) {
      if (S.net) S.net.tilt(e.v);
    });

    if (S.debug) S.det.on('sample', pushWave);
  }

  /**
   * 인식 피드백. 화면 전체 번쩍 + 진동.
   * 없으면 인식 여부를 몰라 답답해한다 (PROJECT.md 7장).
   */
  function feedback(e) {
    var f = el('flash');
    f.className = 'on';
    global.setTimeout(function () { f.className = ''; }, 60);
    vibrate(e && e.p > 0.6 ? 60 : 35);
  }

  function vibrate(pattern) {
    if (global.navigator && global.navigator.vibrate) {
      try { global.navigator.vibrate(pattern); } catch (err) { /* 무시 */ }
    }
  }

  /**
   * TV가 소리를 못 낼 때의 대타. 짧은 삑 소리 하나뿐이다.
   *
   * BGM은 여기서 절대 내지 않는다. 폰에서 음악이 계속 흐르면 조카가 폰을 본다
   * (PROJECT.md 1장: 폰은 컨트롤러 전용).
   */
  var actx = null;
  var BEEP = { good: 880, combo: 1046, coin: 1318, miss: 220, hit: 180,
               star: 1568, mush: 660, dud: 240, bomb: 150, go: 880,
               fanfare: 1046, count: 700, step: 520, squat: 520, warn: 300 };

  function beep(name) {
    var hz = BEEP[name];
    if (!hz) return;
    try {
      var A = global.AudioContext || global.webkitAudioContext;
      if (!A) return;
      if (!actx) actx = new A();
      if (actx.state === 'suspended') { actx.resume(); return; }
      var o = actx.createOscillator();
      var g = actx.createGain();
      var t0 = actx.currentTime;
      o.type = 'square';
      o.frequency.setValueAtTime(hz, t0);
      g.gain.setValueAtTime(0.2, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
      o.connect(g);
      g.connect(actx.destination);
      o.start(t0);
      o.stop(t0 + 0.14);
    } catch (e) { /* 소리는 없어도 게임은 돈다 */ }
  }

  /* 4. 캘리브레이션 */

  function runCalib() {
    if (!S.det) startSensors();
    if (S.cancelCalib) S.cancelCalib();

    el('calib-msg').textContent = '';
    el('calib-fill').style.width = '0%';

    S.cancelCalib = LP.calib.run(S.det, {
      onProgress: function (r) {
        el('calib-fill').style.width = Math.round(r * 100) + '%';
        // 진행률을 TV에도 보낸다. 여러 명일 때 누가 아직인지 보여야 한다.
        var now = new Date().getTime();
        if (now - S.lastCalibSend > 200) {
          S.lastCalibSend = now;
          if (S.net) S.net.calib({ progress: r < 1 ? r * 0.99 : 0.99 });
        }
      },
      onDone: function (err, baseline) {
        S.cancelCalib = null;
        if (err) {
          el('calib-msg').textContent = err.message + '. 다시 해볼게요';
          vibrate([100, 80, 100]);
          global.setTimeout(runCalib, 800);
          return;
        }
        el('calib-fill').style.width = '100%';
        vibrate(60);
        if (S.net) S.net.calib({ progress: 1, samples: baseline.samples });
      }
    });
  }

  /* 5. 컨트롤러 */

  function paintController() {
    // 색 하나와 큰 아이콘 하나만. 점수도 캐릭터도 그리지 않는다.
    el('ctrl-icon').textContent = ICON[S.motion] || '●';
    el('ctrl-label').textContent = 'TV를 보세요';

    // 이 게임이 쓰는 동작만 켠다. 점프의 도약 스파이크가 쳐올리기로 새는 것을 막는다.
    // 'all'은 판정 확인 화면 전용이다. 실제 미니게임은 동작 하나만 켠다.
    if (S.det) {
      var all = (S.motion === 'all');
      S.det.setEnabled({
        jump: all || S.motion === 'jump',
        punch: all || S.motion === 'punch',
        squat: all || S.motion === 'squat'
      });
    }
  }

  /* 화면 잠김 방지 + 방향 고정 */

  function requestWakeLock() {
    if (S.wakeLock) return;
    if (!global.navigator || !global.navigator.wakeLock) { noWakeLock(); return; }
    try {
      global.navigator.wakeLock.request('screen').then(function (lock) {
        S.wakeLock = lock;
        lock.addEventListener('release', function () { S.wakeLock = null; });
      })['catch'](function () { noWakeLock(); });
    } catch (e) { noWakeLock(); }
  }

  /**
   * Wake Lock을 못 쓰는 브라우저의 폴백.
   *
   * 대신할 기술이 없다 — 무음 비디오 트릭은 기기마다 다르게 깨지고, 실패하면
   * 원인을 찾는 데 시간이 다 간다. 그래서 어른에게 한 번 알리는 것으로 대신한다.
   * 조카는 이 글자를 못 읽지만, 폰을 쥐여주는 것은 어른이다.
   */
  var wakeWarned = false;
  function noWakeLock() {
    if (wakeWarned) return;
    wakeWarned = true;
    var n = el('wake-warn');
    if (n) n.className = 'on';
  }

  /**
   * 화면이 가려졌다 돌아오면 Wake Lock이 풀려 있다. 다시 잡는다.
   * 전화가 오거나 다른 앱으로 갔다 오는 상황이 실제로 자주 생긴다 (phase9).
   */
  if (doc.addEventListener) {
    doc.addEventListener('visibilitychange', function () {
      if (doc.visibilityState !== 'visible') return;
      S.wakeLock = null;
      requestWakeLock();
      // 돌아온 김에 소리 통로도 다시 열어둔다.
      if (actx && actx.state === 'suspended') { try { actx.resume(); } catch (e) { /* 무시 */ } }
    }, false);
  }

  function releaseWakeLock() {
    if (!S.wakeLock) return;
    try { S.wakeLock.release(); } catch (e) { /* 무시 */ }
    S.wakeLock = null;
  }

  function lockOrientation() {
    try {
      if (global.screen && global.screen.orientation && global.screen.orientation.lock) {
        global.screen.orientation.lock('portrait')['catch'](function () { /* 전체화면 아니면 거부된다 */ });
      }
    } catch (e) { /* 무시 */ }
  }

  /* 센서 파형 오버레이 (?debug=1) */

  function pushWave(s) {
    var d = S.det.debug;
    S.wave.push({ vert: d.vert, mag: d.mag, pitch: d.pitchRel, roll: d.rollRel, ff: d.freefall });
    if (S.wave.length > 360) S.wave.shift();
  }

  function drawWave() {
    if (!S.debug) return;
    var cv = el('wave');
    var ctx = cv.getContext('2d');
    var w = cv.width, h = cv.height, mid = h / 2;

    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#38445e';
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();

    function line(key, scale, color) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (var i = 0; i < S.wave.length; i++) {
        var y = mid - S.wave[i][key] * scale;
        if (i === 0) ctx.moveTo(i, y); else ctx.lineTo(i, y);
      }
      ctx.stroke();
    }

    line('vert', 2, '#3bff7a');    // 세로 가속도
    line('pitch', 1.5, '#ffd23b'); // pitch
    line('roll', 1.5, '#4b7be3');  // roll

    // 자유낙하 구간을 붉게 표시. 점프 판정의 근거다.
    ctx.fillStyle = 'rgba(255,60,60,.5)';
    for (var i = 0; i < S.wave.length; i++) {
      if (S.wave[i].ff) ctx.fillRect(i, 0, 1, 8);
    }

    // 임계선
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.beginPath();
    ctx.moveTo(0, mid - T.SPIKE_ON * 2); ctx.lineTo(w, mid - T.SPIKE_ON * 2);
    ctx.stroke();

    global.requestAnimationFrame(drawWave);
  }

  /* 시작 */

  LP.play.start = function () {
    S.debug = /[?&]debug=1/.test(global.location.search);

    buildKeypad();
    buildChars();
    paintCode();
    lockOrientation();

    el('ready-btn').addEventListener('click', sendReady);

    if (S.debug) global.requestAnimationFrame(drawWave);

    show('code');
    return S;
  };

})(window);
