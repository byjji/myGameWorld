/**
 * 레이싱 코스 데이터 (phase8)
 *
 * 코스는 데이터다. 새 코스를 만드는 데 게임 코드를 고칠 일이 없어야 한다 —
 * 조카가 "다른 데서 달리고 싶다"고 하면 여기에 배열 하나를 더 적는 것으로 끝나야 한다.
 *
 * 조각 하나(pieces[i])의 뜻은 js/pseudo3d.js Track 주석에 있다. 요약하면
 *
 *   n      길이(세그먼트 수). 200 월드 단위가 한 세그먼트다
 *   curve  곡률. 음수가 왼쪽. **5세 기준 2~4가 적당하고 6을 넘기지 않는다**
 *   hill   이 구간에서 오르내리는 높이. 코스 전체의 합이 0이어야 한다
 *
 * 마지막 조각이 끝난 지점이 곧 출발선이다. 높이 합이 0이 아니면 결승선을 지날 때마다
 * 화면이 튄다 — `Track.seamOk()`가 그것을 확인하고 시험이 잡아낸다.
 *
 * 문법 수준: ES5
 */
(function (global) {
  'use strict';

  var GP = global.GP || (global.GP = {});

  GP.courses = {

    /* 들판 서킷 — 기본 코스.
       직선이 길고 커브가 완만하다. 처음 달리는 아이가 완주하는 것이 목적이다.
       760 세그먼트 = 152,000 월드 단위. 최고 속도로 한 바퀴 21초쯤. */
    meadow: {
      id: 'meadow',
      name: '들판 서킷',
      colors: {
        sky: '#7ec8ff', sky2: '#c8e9ff', hill: '#3f9e5a', ground: '#2e8b3d',
        light: { road: '#6e6e78', grass: '#339944', rumble: '#f4f4f4', line: '#ffffff' },
        dark:  { road: '#63636d', grass: '#2b8d3a', rumble: '#d0332d', line: null }
      },
      propEvery: 13,
      pieces: [
        { n: 60 },                          // 출발 직선. 손목을 가만히 두는 법부터 익힌다
        { n: 70, curve: 2.4 },
        { n: 50, hill: 800 },
        { n: 60, curve: -3.0 },
        { n: 40, hill: -800 },
        { n: 70 },
        { n: 60, curve: 3.4 },
        { n: 50, curve: -2.0, hill: 600 },
        { n: 60, hill: -600 },
        { n: 70, curve: -3.6 },
        { n: 50 },
        { n: 60, curve: 2.0 },
        { n: 60 }                           // 결승 직선
      ]
    },

    /* 해변 8자 — 두 번째 코스.
       짧고 커브가 잦다. 들판을 완주하는 아이에게 다음으로 준다.
       590 세그먼트. 최고 속도로 한 바퀴 16초쯤. */
    beach: {
      id: 'beach',
      name: '해변 8자',
      colors: {
        sky: '#59c3f0', sky2: '#bdeaff', hill: '#c9b177', ground: '#e8d8a0',
        light: { road: '#7a7a86', grass: '#efe0ac', rumble: '#ffffff', line: '#ffffff' },
        dark:  { road: '#6e6e7a', grass: '#e3d199', rumble: '#3aa0d8', line: null }
      },
      propEvery: 11,
      pieces: [
        { n: 50 },
        { n: 60, curve: 4.0 },
        { n: 40, curve: -4.0 },
        { n: 70, hill: 900 },
        { n: 50, curve: 3.0 },
        { n: 60, hill: -900 },
        { n: 50, curve: -5.0 },
        { n: 40 },
        { n: 60, curve: 4.5 },
        { n: 50, curve: -3.0 },
        { n: 60 }
      ]
    }
  };

  GP.courses.ids = function () {
    var out = [];
    for (var k in GP.courses) {
      if (!Object.prototype.hasOwnProperty.call(GP.courses, k)) continue;
      if (typeof GP.courses[k] === 'function') continue;
      out.push(k);
    }
    return out;
  };

})(window);
