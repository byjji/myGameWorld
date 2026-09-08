/**
 * 판정 확인 화면 (미니게임 인터페이스로 구현)
 *
 * 게임이 아니라 진단 도구다. 미니게임과 똑같은 인터페이스로 등록해서
 * 셸의 게임 붙이는 자리가 실제로 동작하는지도 같이 확인한다.
 *
 * 폰이 보내는 것은 판정 결과와 기울기 연속값뿐이다 (PROJECT.md 8장).
 * 원시 센서 파형은 폰 화면의 디버그 오버레이에서 본다.
 *
 * 문법 수준: ES5
 */
(function (global) {
  'use strict';

  var GP = global.GP;
  var C = GP.config;
  var T = GP.tuning;

  var api = null;
  var counts = {};        // playerId -> { jump, punch, squat }
  var last = {};          // playerId -> { a, p, at }
  var tilt = {};          // playerId -> { v, lane }
  var events = [];
  var t = 0;

  function pid(m) { return m.from || 'p1'; }

  function bucket(id) {
    if (!counts[id]) counts[id] = { jump: 0, punch: 0, squat: 0 };
    return counts[id];
  }

  function laneOf(v) {
    var deg = v * T.TILT_RANGE_DEG;
    if (deg <= -T.TILT_LANE_DEG) return 0;
    if (deg >= T.TILT_LANE_DEG) return 2;
    return 1;
  }

  GP.games.register('debug', {
    name: '판정 확인',
    // 진단 화면이라 네 동작을 전부 받는다. 실제 미니게임은 하나만 쓴다 (PROJECT.md 4장).
    motion: 'all',
    // 게임이 아니라 도구다. 룰렛에도 카드 목록에도 나오지 않는다.
    // 볼 일이 있으면 주소에 ?game=debug 를 붙인다.
    hidden: true,
    hint: '폰에서 점프 · 쳐올리기 · 스쿼트 · 좌우 기울이기를 해보세요',

    init: function (a) {
      api = a;
      counts = {}; last = {}; tilt = {}; events = []; t = 0;
    },

    update: function (dt) { t += dt; },

    onMotion: function (m) {
      var id = pid(m);
      var b = bucket(id);
      if (b[m.a] !== undefined) b[m.a]++;
      last[id] = { a: m.a, p: m.p, at: t };
      events.push({ t: t, s: id + ' ' + m.a + '  p=' + (m.p !== undefined ? m.p.toFixed(2) : '-') });
      if (events.length > 14) events.shift();
    },

    onTilt: function (m) {
      var id = pid(m);
      var prev = tilt[id];
      var lane = laneOf(m.v);
      if (!prev || prev.lane !== lane) {
        events.push({ t: t, s: id + ' 레인 ' + (lane + 1) });
        if (events.length > 14) events.shift();
      }
      tilt[id] = { v: m.v, lane: lane };
    },

    getScore: function () {
      var out = [];
      for (var id in counts) {
        if (!Object.prototype.hasOwnProperty.call(counts, id)) continue;
        var b = counts[id];
        out.push({ from: id, score: b.jump + b.punch + b.squat });
      }
      return out;
    },

    render: function (ctx) {
      var S = C.SAFE;

      ctx.fillStyle = '#0e1524';
      ctx.fillRect(0, 0, C.WIDTH, C.HEIGHT);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 34px sans-serif';
      ctx.fillText('판정 확인', S.x, S.y + 40);

      var players = api ? api.players : [];
      if (!players.length) {
        ctx.fillStyle = '#8ea2c0';
        ctx.font = '28px sans-serif';
        ctx.fillText('폰이 붙으면 여기에 표시됩니다', S.x, S.y + 110);
        return;
      }

      var rowH = 190;
      for (var i = 0; i < players.length; i++) {
        var p = players[i];
        var y = S.y + 90 + i * rowH;
        var b = bucket(p.id);
        var tl = tilt[p.id] || { v: 0, lane: 1 };
        var lz = last[p.id];

        // 최근 판정이 있으면 그 자세로 그린다. 인식 여부를 화면만 보고 알 수 있어야 한다.
        var pose = 'idle';
        if (lz && t - lz.at < 0.35) pose = lz.a;
        GP.chars.draw(ctx, p['char'], S.x + 80, y + 150, 150, pose);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 28px sans-serif';
        ctx.fillText(p.name, S.x + 170, y + 34);

        ctx.font = '26px monospace';
        ctx.fillStyle = '#8ea2c0';
        ctx.fillText('점프 ' + b.jump + '   쳐올리기 ' + b.punch + '   스쿼트 ' + b.squat,
                     S.x + 170, y + 72);

        // 기울기 막대. 가운데가 기준, 양끝이 레인 임계.
        var bw = 420, bx = S.x + 170, by = y + 96;
        ctx.fillStyle = '#26314a';
        ctx.fillRect(bx, by, bw, 30);
        ctx.fillStyle = '#4b7be3';
        var cx = bx + bw / 2;
        var w = tl.v * bw / 2;
        ctx.fillRect(w >= 0 ? cx : cx + w, by, Math.abs(w), 30);

        // 레인 임계 눈금
        var mark = (T.TILT_LANE_DEG / T.TILT_RANGE_DEG) * bw / 2;
        ctx.fillStyle = '#ffd23b';
        ctx.fillRect(cx - mark - 1, by - 6, 2, 42);
        ctx.fillRect(cx + mark - 1, by - 6, 2, 42);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 26px monospace';
        ctx.fillText('레인 ' + (tl.lane + 1), bx + bw + 20, by + 24);

        if (lz && t - lz.at < 0.5) {
          ctx.fillStyle = '#3bff7a';
          ctx.font = 'bold 40px sans-serif';
          ctx.fillText(lz.a, bx + bw + 140, by + 26);
        }
      }

      // 이벤트 기록. 콘솔이 없으니 화면에 남긴다.
      var lx = C.WIDTH - S.x - 380;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(lx - 12, S.y + 150, 392, 14 * 26 + 20);
      ctx.font = '20px monospace';
      for (var k = 0; k < events.length; k++) {
        ctx.fillStyle = '#8ea2c0';
        ctx.fillText(events[k].t.toFixed(1) + 's  ' + events[k].s, lx, S.y + 180 + k * 26);
      }
    }
  });

})(window);
