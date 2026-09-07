/**
 * L-Party 효과음 — WebAudio 합성
 *
 * 에셋 파일이 없다. 사운드 확보 방법은 아직 미결정이고(PROJECT.md 12장),
 * 그것을 기다리면 게임 피드백이 통째로 비어 있게 된다. 그래서 오실레이터로 만든다.
 * phase9에서 실제 에셋이 생기면 play()의 안쪽만 갈아끼운다 — 부르는 쪽은 그대로 둔다.
 *
 * 소리는 TV에서 난다. 폰은 컨트롤러 전용이다 (PROJECT.md 1장).
 *
 * 주의: 브라우저 자동재생 정책 때문에 AudioContext는 사용자 제스처 전까지 멈춰 있다.
 * TV는 입력을 받지 않으므로 제스처가 없을 수 있다 — 소리가 안 나도 게임은 그대로 굴러가게
 * 만들었다. 실기에서 확인할 항목이다.
 *
 * 문법 수준: ES5
 */
(function (global) {
  'use strict';

  var LP = global.LP || (global.LP = {});

  var ctx = null;
  var enabled = true;
  var master = null;

  // 이름 -> [주파수(Hz), 끝 주파수, 길이(초), 파형, 음량]
  // 종류마다 확실히 다르게 들려야 한다. 5세는 화면을 보느라 소리를 곁눈으로 듣는다.
  var DEFS = {
    jump:   [660, 990, 0.10, 'square',   0.25],
    good:   [880, 1320, 0.12, 'square',  0.30],
    combo:  [1046, 1568, 0.16, 'square', 0.32],
    miss:   [220, 140, 0.22, 'sawtooth', 0.22],
    step:   [520, 520, 0.06, 'square',   0.18],
    coin:   [1318, 1976, 0.09, 'square', 0.30],
    squat:  [440, 620, 0.10, 'triangle', 0.25],
    hit:    [180, 90, 0.28, 'sawtooth',  0.26],
    warn:   [300, 300, 0.09, 'triangle', 0.20],
    star:   [784, 2093, 0.45, 'square',  0.32],
    mush:   [523, 1046, 0.28, 'triangle',0.28],
    dud:    [200, 180, 0.12, 'sine',     0.16],
    bomb:   [140, 70, 0.34, 'sawtooth',  0.28],
    count:  [700, 700, 0.12, 'square',   0.26],
    go:     [880, 1320, 0.30, 'square',  0.34],
    fanfare:[659, 1319, 0.50, 'square',  0.34]
  };

  function ac() {
    if (ctx) return ctx;
    var A = global.AudioContext || global.webkitAudioContext;
    if (!A) { enabled = false; return null; }
    try {
      ctx = new A();
      master = ctx.createGain();
      master.gain.value = 0.6;
      master.connect(ctx.destination);
    } catch (e) {
      enabled = false;
      return null;
    }
    return ctx;
  }

  /** 정책상 멈춰 있으면 깨운다. 실패해도 조용히 넘어간다. */
  function resume() {
    var a = ac();
    if (a && a.state === 'suspended' && a.resume) {
      try { a.resume(); } catch (e) { /* 무시 */ }
    }
  }

  function play(name) {
    if (!enabled) return false;
    var d = DEFS[name];
    if (!d) return false;
    var a = ac();
    if (!a) return false;
    if (a.state === 'suspended') { resume(); return false; }

    try {
      var o = a.createOscillator();
      var g = a.createGain();
      var t0 = a.currentTime;

      o.type = d[3];
      o.frequency.setValueAtTime(d[0], t0);
      if (d[1] !== d[0]) o.frequency.linearRampToValueAtTime(d[1], t0 + d[2]);

      // 딱 끊으면 클릭 잡음이 난다. 짧게라도 감쇠를 준다.
      g.gain.setValueAtTime(d[4], t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + d[2]);

      o.connect(g);
      g.connect(master);
      o.start(t0);
      o.stop(t0 + d[2] + 0.02);
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ── BGM ──────────────────────────────────────────────
     루프도 합성이다. 화면마다 성격만 다르게 하고 음량은 효과음보다 훨씬 낮게 둔다 —
     BGM이 크면 판정 소리가 묻히고, 판정 소리가 묻히면 조카가 인식 여부를 모른다. */

  // 화면 이름 -> { notes: [반음 오프셋], root: Hz, step: 초, gain }
  var BGM = {
    lobby:  { notes: [0, 4, 7, 4], root: 262, step: 0.42, gain: 0.05 },
    select: { notes: [0, 5, 7, 12, 7, 5], root: 294, step: 0.20, gain: 0.05 },
    play:   { notes: [0, 7, 12, 7, 5, 7], root: 330, step: 0.17, gain: 0.045 },
    board:  { notes: [0, 4, 7, 12], root: 349, step: 0.30, gain: 0.05 },
    result: { notes: [0, 4, 7, 12, 16], root: 392, step: 0.24, gain: 0.055 }
  };

  var bgmName = null;
  var bgmTimer = 0;
  var bgmStep = 0;
  var bgmNext = 0;

  function noteHz(root, semis) {
    return root * Math.pow(2, semis / 12);
  }

  /** 다음 몇 박자를 미리 예약한다. setInterval의 지터가 박자에 그대로 실리는 것을 막는다. */
  function pump() {
    var d = BGM[bgmName];
    if (!d || !enabled) return;
    var a = ac();
    if (!a || a.state === 'suspended') { resume(); return; }

    var horizon = a.currentTime + 0.5;
    if (bgmNext < a.currentTime) bgmNext = a.currentTime + 0.05;

    while (bgmNext < horizon) {
      try {
        var o = a.createOscillator();
        var g = a.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(noteHz(d.root, d.notes[bgmStep % d.notes.length]), bgmNext);
        g.gain.setValueAtTime(0.0001, bgmNext);
        g.gain.exponentialRampToValueAtTime(d.gain, bgmNext + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, bgmNext + d.step * 0.9);
        o.connect(g);
        g.connect(master);
        o.start(bgmNext);
        o.stop(bgmNext + d.step);
      } catch (e) { return; }
      bgmNext += d.step;
      bgmStep++;
    }
  }

  /** 화면에 맞는 루프로 갈아탄다. 같은 이름이면 끊지 않는다. */
  function bgm(name) {
    if (name === bgmName) return;
    bgmName = BGM[name] ? name : null;
    bgmStep = 0;
    bgmNext = 0;
    if (bgmTimer) { global.clearInterval(bgmTimer); bgmTimer = 0; }
    if (!bgmName || !enabled) return;
    pump();
    bgmTimer = global.setInterval(pump, 200);
  }

  LP.sfx = {
    play: play,
    bgm: bgm,
    resume: resume,

    /**
     * 지금 이 기기에서 소리가 나는가.
     *
     * TV는 입력을 받지 않으므로 자동재생 정책에 걸려 영영 suspended일 수 있다.
     * 그때는 TV가 소리를 포기하고 폰에게 대신 내달라고 부탁한다 (js/tv.js fx).
     */
    audible: function () {
      if (!enabled) return false;
      var a = ac();
      return !!a && a.state === 'running';
    },
    names: function () {
      var out = [];
      for (var k in DEFS) if (Object.prototype.hasOwnProperty.call(DEFS, k)) out.push(k);
      return out;
    },
    mute: function (on) { enabled = !on; },
    state: function () { return ctx ? ctx.state : 'none'; }
  };

})(window);
