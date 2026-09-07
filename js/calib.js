/**
 * L-Party 센서 캘리브레이션
 *
 * "폰을 가슴에 대고 똑바로 서세요" 3초 (PROJECT.md 4장).
 * 없으면 폰을 쥔 각도에 따라 기준이 매번 달라져 판정이 무너진다.
 *
 * 미니게임이 바뀔 때마다 재보정한다. 게임 전환 흐름에 강제로 끼워 넣을 것.
 *
 * 문법 수준: ES5
 */
(function (global) {
  'use strict';

  var LP = global.LP || (global.LP = {});
  var T = LP.tuning;

  function mean(arr) {
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return arr.length ? s / arr.length : 0;
  }

  function stdev(arr) {
    if (arr.length < 2) return 0;
    var m = mean(arr), s = 0;
    for (var i = 0; i < arr.length; i++) s += (arr[i] - m) * (arr[i] - m);
    return Math.sqrt(s / (arr.length - 1));
  }

  LP.calib = {

    /**
     * 보정을 시작한다.
     *
     * opts = {
     *   ms:         수집 시간. 기본 CALIB_MS
     *   onProgress: function(ratio 0~1)
     *   onDone:     function(err, baseline)
     * }
     *
     * 반환값: 중단 함수. 화면을 벗어날 때 호출한다.
     */
    run: function (detector, opts) {
      opts = opts || {};
      var ms = opts.ms || T.CALIB_MS;

      var ax = [], ay = [], az = [], pit = [], rol = [];
      var t0 = null;
      var done = false;

      function finish(err, baseline) {
        if (done) return;
        done = true;
        detector.off('sample', onSample);
        if (timer) global.clearInterval(timer);
        if (opts.onDone) opts.onDone(err, baseline);
      }

      function onSample(s) {
        if (done) return;
        if (t0 === null) t0 = s.t;
        ax.push(s.ax); ay.push(s.ay); az.push(s.az);
        pit.push(s.pitch); rol.push(s.roll);

        if (s.t - t0 >= ms) evaluate();
      }

      function evaluate() {
        if (ax.length < T.CALIB_MIN_SAMPLES) {
          // 센서 주기가 너무 낮다. 이 상태로 만든 기준은 믿을 수 없다.
          return finish(new Error('표본 부족 (' + ax.length + '개)'), null);
        }

        var mx = mean(ax), my = mean(ay), mz = mean(az);
        var mag = Math.sqrt(mx * mx + my * my + mz * mz);
        if (mag < 1) return finish(new Error('중력을 못 읽었다'), null);

        // 보정 중 몸이 흔들렸으면 기준 자세가 아니다. 다시 하라고 한다.
        var accelDev = Math.max(stdev(ax), stdev(ay), stdev(az));
        var angleDev = Math.max(stdev(pit), stdev(rol));
        if (accelDev > T.CALIB_MAX_ACCEL_DEV || angleDev > T.CALIB_MAX_ANGLE_DEV) {
          return finish(new Error('움직임이 너무 컸다'), null);
        }

        var baseline = {
          gx: mx / mag, gy: my / mag, gz: mz / mag,
          pitch0: mean(pit),
          roll0: mean(rol),
          samples: ax.length,
          accelDev: accelDev,
          angleDev: angleDev,
          provisional: false
        };

        detector.setBaseline(baseline);
        finish(null, baseline);
      }

      // 진행률은 표본이 아니라 시계로 센다. 센서가 멈춰도 화면은 돈다.
      var startedAt = (global.performance && global.performance.now)
        ? global.performance.now() : new Date().getTime();

      var timer = global.setInterval(function () {
        var now = (global.performance && global.performance.now)
          ? global.performance.now() : new Date().getTime();
        var r = Math.min((now - startedAt) / ms, 1);
        if (opts.onProgress) opts.onProgress(r);

        // 시간이 다 됐는데 표본이 안 들어왔으면 센서가 죽은 것이다.
        if (r >= 1 && !done) {
          if (ax.length >= T.CALIB_MIN_SAMPLES) evaluate();
          else finish(new Error('센서 응답 없음'), null);
        }
      }, 100);

      detector.on('sample', onSample);

      return function cancel() { finish(new Error('취소됨'), null); };
    }
  };

})(window);
