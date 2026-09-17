/**
 * 개발용 합성 센서
 *
 * 데스크톱 브라우저에는 devicemotion이 없다. 그러면 캘리브레이션부터 막혀
 * 셸 흐름을 전혀 확인할 수 없다. 그래서 키보드로 동작을 흉내낸다.
 *
 * ?dev=1 일 때만 붙는다. 실기 폰에서는 진짜 센서를 쓴다.
 *
 *   J = 점프 (도약 - 체공 - 착지)
 *   P = 쳐올리기
 *   S = 스쿼트
 *   ← → = 좌우 기울이기 (누르고 있는 동안)
 *
 * 문법 수준: ES5
 */
(function (global) {
  'use strict';

  var GP = global.GP || (global.GP = {});
  var T = GP.tuning;

  var HZ = 60;
  var DT = 1000 / HZ;

  // 구간 목록. { ms, vert, freefall, pitch }
  var JUMP = [
    { ms: 150, vert: -4 },
    { ms: 80, vert: 20 },
    { ms: 300, vert: 0, freefall: true },
    { ms: 70, vert: 28 },
    { ms: 200, vert: 0 }
  ];
  // 쳐올리고 꼭대기에서 멈춘다. 올린 만큼 감속이 없으면 폰이 날아가는 셈이라 판정기가 속도를 못 되돌린다.
  var PUNCH = [
    { ms: 80, vert: 20 },
    { ms: 80, vert: -20 },
    { ms: 300, vert: 0 }
  ];
  // 스쿼트는 각도가 아니라 세로 왕복이다. 내려가는 가속 - 바닥 제동 - 일어나는 가속 - 위 제동.
  var SQUAT = [
    { ms: 250, vert: -3 },
    { ms: 250, vert: 3 },
    { ms: 200, vert: 0 },
    { ms: 250, vert: 3 },
    { ms: 250, vert: -3 },
    { ms: 300, vert: 0 }
  ];

  function attach(detector) {
    var t = 0;
    var queue = [];
    var seg = null;
    var segLeft = 0;
    var pitch = 0, pitchFrom = 0;
    var rollTarget = 0, roll = 0;
    var timer = 0;

    function push(profile) {
      // 이미 재생 중이면 무시한다. 연타로 겹치면 판정이 엉킨다.
      if (queue.length || seg) return;
      for (var i = 0; i < profile.length; i++) queue.push(profile[i]);
    }

    function tick() {
      if (!seg) {
        seg = queue.shift() || null;
        if (seg) { segLeft = seg.ms; pitchFrom = pitch; }
      }

      var vert = 0, freefall = false;
      if (seg) {
        vert = seg.vert || 0;
        freefall = !!seg.freefall;
        if (seg.pitchTo !== undefined) {
          var k = 1 - (segLeft / seg.ms);
          pitch = pitchFrom + (seg.pitchTo - pitchFrom) * k;
        }
        segLeft -= DT;
        if (segLeft <= 0) seg = null;
      }

      // 기울기는 눌린 동안 목표값으로 부드럽게 따라간다.
      roll += (rollTarget - roll) * 0.25;

      detector.feed({
        t: t,
        ax: 0,
        ay: freefall ? 0.4 : T.G + vert,
        az: 0,
        pitch: pitch,
        roll: roll
      });
      t += DT;
    }

    function onKeyDown(e) {
      var k = e.key ? e.key.toLowerCase() : '';
      if (k === 'j') push(JUMP);
      else if (k === 'p') push(PUNCH);
      else if (k === 's') push(SQUAT);
      else if (e.key === 'ArrowLeft') rollTarget = -T.TILT_RANGE_DEG;
      else if (e.key === 'ArrowRight') rollTarget = T.TILT_RANGE_DEG;
      else return;
      e.preventDefault();
    }

    function onKeyUp(e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') rollTarget = 0;
    }

    global.addEventListener('keydown', onKeyDown, false);
    global.addEventListener('keyup', onKeyUp, false);
    timer = global.setInterval(tick, DT);

    return function detach() {
      global.clearInterval(timer);
      global.removeEventListener('keydown', onKeyDown, false);
      global.removeEventListener('keyup', onKeyUp, false);
    };
  }

  GP.devsensor = { attach: attach };

})(window);
