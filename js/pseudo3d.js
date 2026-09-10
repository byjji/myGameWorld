/**
 * 유사 3D 도로 렌더러 — 아웃런식 스캔라인 (PROJECT.md 5-5, phase8)
 *
 * WebGL도 Three.js도 쓰지 않는다 (PROJECT.md 2장, js/config.js ALLOW_WEBGL:false).
 * 도로를 세그먼트 단위 사다리꼴로 투영해 위에서 아래로 칠한다. 곱셈 몇 번과
 * fillRect·fill이 전부라 구형 TV 브라우저에서도 프레임이 나온다.
 *
 * 여기서 지키는 것 세 가지.
 *
 *   1. **그리는 세그먼트 수가 상수다** (TUNE.DRAW_SEGS). 실기에서 30fps가 안 나오면
 *      이 숫자 하나를 낮춘다. 게임 로직도 코스 데이터도 건드리지 않는다 (phase8 리스크).
 *   2. **매 프레임 색 문자열을 만들지 않는다.** 안개(원근에 따른 색 흐림)는 알파가 아니라
 *      미리 계산해 둔 색 배열로 낸다. globalAlpha는 예산에서 2배로 세는 항목이다.
 *   3. **먼 것부터 그리지 않는다.** 가까운 세그먼트를 먼저 칠하고 maxy로 잘라내면
 *      언덕 뒤가 저절로 가려진다. 스프라이트만 먼 것부터 그린다.
 *
 * 좌표
 *   z  코스를 따라가는 거리(월드 단위). 랩을 돌면 track.length로 나눈 나머지다
 *   x  도로 중심에서의 좌우 위치. **도로 반폭이 1이다.** |x| > 1 이면 도로 밖
 *   y  높이. 언덕. TUNE.HILLS를 0으로 두면 전부 평지로 그린다
 *
 * 문법 수준: ES5
 */
(function (global) {
  'use strict';

  var GP = global.GP || (global.GP = {});
  var C = GP.config;

  var TUNE = {
    SEG_LEN:     200,    // 세그먼트 하나의 길이(월드 단위)
    RUMBLE_SEGS: 4,      // 갓돌 줄무늬가 바뀌는 주기(세그먼트)

    ROAD_W:      2400,   // 도로 반폭(월드 단위). 넓힐수록 5세가 이탈을 덜 한다
    CAM_H:       1400,   // 카메라 높이
    FOV:         100,    // 시야각(도)

    // 한 프레임에 그리는 세그먼트 수. **실기에서 프레임이 모자라면 여기부터 낮춘다.**
    // 110 = 22,000 월드 단위 앞까지 보인다.
    DRAW_SEGS:   110,

    // 갓돌·중앙선까지 그리는 가까운 구간. 그 뒤는 도로면만 칠한다.
    // 멀리 있는 갓돌은 1픽셀도 안 되면서 값은 그대로 나간다.
    DETAIL_SEGS: 44,

    FOG_DENSITY: 4.5,    // 클수록 먼 곳이 빨리 배경색에 묻힌다
    HILLS:       1,      // 0으로 두면 언덕을 평지로 그린다 (부하 미달 시 대응)

    SPRITE_MAX:  14,     // 한 프레임에 그리는 스프라이트 상한 (phase1 예산)

    // 하늘과 땅의 경계. **이 투영에서 무한히 먼 평지는 정확히 화면 한가운데로 수렴한다**
    // (camera.y / camera.z -> 0). 0.5가 아닌 값을 넣으면 산이 도로 소실점과 어긋난 자리에
    // 서고, 그 사이에 정체 모를 띠가 생긴다.
    SKY_Y:       0.5
  };

  /* ── 색 ────────────────────────────────────────────── */

  var DEFAULT_COLORS = {
    sky:    '#7ec8ff',
    sky2:   '#bfe6ff',
    hill:   '#3f9e5a',
    ground: '#2e8b3d',
    light:  { road: '#6e6e78', grass: '#2e8b3d', rumble: '#f4f4f4', line: '#ffffff' },
    dark:   { road: '#63636d', grass: '#279032', rumble: '#d0332d', line: null }
  };

  function hex(c) {
    return [parseInt(c.substr(1, 2), 16),
            parseInt(c.substr(3, 2), 16),
            parseInt(c.substr(5, 2), 16)];
  }

  /** 두 색을 k만큼 섞는다. 문자열을 만드는 비싼 일이라 만들기 단계에서만 부른다. */
  function mix(a, b, k) {
    var A = hex(a), B = hex(b);
    return 'rgb(' + Math.round(A[0] + (B[0] - A[0]) * k) + ','
                  + Math.round(A[1] + (B[1] - A[1]) * k) + ','
                  + Math.round(A[2] + (B[2] - A[2]) * k) + ')';
  }

  function lerp(a, b, k) { return a + (b - a) * k; }

  /**
   * 깊이별 색표를 미리 만든다.
   *
   * 안개를 globalAlpha로 내면 세그먼트 수만큼 알파 그리기가 생긴다 (phase1 예산 2배 항목).
   * 어차피 깊이별로 같은 색이므로 만들 때 한 번 섞어 문자열로 굳혀 둔다.
   * DRAW_SEGS를 바꾸면 다시 만든다 — 현장에서 ?tune=으로 낮출 수 있어야 하기 때문이다.
   */
  function palette(track, n) {
    if (track.pal && track.palN === n) return track.pal;

    var col = track.colors;
    var pal = { light: {}, dark: {} };
    var keys = ['road', 'grass', 'rumble', 'line'];
    var v, k, i, key, base, arr, f;

    for (v = 0; v < 2; v++) {
      var name = v ? 'dark' : 'light';
      for (k = 0; k < keys.length; k++) {
        key = keys[k];
        base = col[name][key];
        if (!base) { pal[name][key] = null; continue; }
        arr = new Array(n);
        for (i = 0; i < n; i++) {
          // 아웃런식 지수 안개. 가까운 곳은 그대로, 먼 곳은 하늘색에 묻힌다.
          f = i / n;
          arr[i] = mix(base, col.sky2, 1 - 1 / Math.exp(f * f * TUNE.FOG_DENSITY));
        }
        pal[name][key] = arr;
      }
    }

    track.pal = pal;
    track.palN = n;
    return pal;
  }

  /* ── 코스 ─────────────────────────────────────────── */

  function easeIn(a, b, k)  { return a + (b - a) * k * k; }
  function easeOut(a, b, k) { return a + (b - a) * (1 - (1 - k) * (1 - k)); }
  function easeInOut(a, b, k) { return a + (b - a) * (-Math.cos(k * Math.PI) / 2 + 0.5); }

  /**
   * 코스 데이터 -> 세그먼트 배열.
   *
   * course = {
   *   id, name,
   *   colors: 위 DEFAULT_COLORS 모양 (일부만 줘도 된다)
   *   pieces: [ { n, curve, hill, enter, leave } ... ]
   *     n      세그먼트 수
   *     curve  좌우 곡률. 음수가 왼쪽. 2~4가 완만한 커브, 6 이상이면 5세에게 어렵다
   *     hill   이 구간에서 올라가거나 내려가는 높이(월드 단위)
   *     enter  곡률이 붙는 구간 수 (기본 n의 1/4). 갑자기 꺾이면 대응할 수 없다
   *     leave  곡률이 풀리는 구간 수
   * }
   */
  function Track(course) {
    this.id = course.id;
    this.name = course.name;

    var c = course.colors || {};
    this.colors = {
      sky:    c.sky    || DEFAULT_COLORS.sky,
      sky2:   c.sky2   || DEFAULT_COLORS.sky2,
      hill:   c.hill   || DEFAULT_COLORS.hill,
      ground: c.ground || DEFAULT_COLORS.ground,
      light:  c.light  || DEFAULT_COLORS.light,
      dark:   c.dark   || DEFAULT_COLORS.dark
    };

    this.segs = [];
    this.pal = null;
    this.palN = 0;

    var pieces = course.pieces || [];
    for (var i = 0; i < pieces.length; i++) this._piece(pieces[i]);

    this.length = this.segs.length * TUNE.SEG_LEN;
  }

  Track.prototype._lastY = function () {
    var s = this.segs.length;
    return s ? this.segs[s - 1].p2.world.y : 0;
  };

  Track.prototype._seg = function (curve, y) {
    var i = this.segs.length;
    var y1 = this._lastY();
    this.segs.push({
      index: i,
      curve: curve,
      p1: { world: { y: y1, z: i * TUNE.SEG_LEN },       camera: { x: 0, y: 0, z: 0 }, screen: { x: 0, y: 0, w: 0, scale: 0 } },
      p2: { world: { y: y,  z: (i + 1) * TUNE.SEG_LEN }, camera: { x: 0, y: 0, z: 0 }, screen: { x: 0, y: 0, w: 0, scale: 0 } },
      dark: Math.floor(i / TUNE.RUMBLE_SEGS) % 2 === 1,
      vis: 0,          // 마지막으로 화면에 나온 프레임 번호
      clip: 0
    });
  };

  Track.prototype._piece = function (p) {
    var n = p.n || 1;
    var curve = p.curve || 0;
    var enter = p.enter === undefined ? Math.floor(n / 4) : p.enter;
    var leave = p.leave === undefined ? Math.floor(n / 4) : p.leave;
    if (enter + leave > n) { enter = Math.floor(n / 3); leave = enter; }
    var hold = n - enter - leave;

    var y0 = this._lastY();
    var y1 = y0 + (TUNE.HILLS ? (p.hill || 0) : 0);
    var i, k;

    for (i = 0; i < enter; i++) {
      k = (i + 1) / n;
      this._seg(easeIn(0, curve, (i + 1) / Math.max(enter, 1)), easeInOut(y0, y1, k));
    }
    for (i = 0; i < hold; i++) {
      k = (enter + i + 1) / n;
      this._seg(curve, easeInOut(y0, y1, k));
    }
    for (i = 0; i < leave; i++) {
      k = (enter + hold + i + 1) / n;
      this._seg(easeOut(curve, 0, (i + 1) / Math.max(leave, 1)), easeInOut(y0, y1, k));
    }
  };

  /** z 위치의 세그먼트. 랩을 돌아도 그대로 쓸 수 있게 나머지로 접는다. */
  Track.prototype.at = function (z) {
    var n = this.segs.length;
    if (!n) return null;
    var i = Math.floor(this.wrap(z) / TUNE.SEG_LEN) % n;
    return this.segs[i];
  };

  Track.prototype.wrap = function (z) {
    var L = this.length;
    if (!L) return 0;
    z = z % L;
    return z < 0 ? z + L : z;
  };

  /** 그 지점의 곡률. 원심력 계산에 쓴다. */
  Track.prototype.curveAt = function (z) {
    var s = this.at(z);
    return s ? s.curve : 0;
  };

  /** 그 지점의 노면 높이. 카메라가 언덕을 타고 오르내린다. */
  Track.prototype.heightAt = function (z) {
    var s = this.at(z);
    if (!s) return 0;
    var pct = (this.wrap(z) % TUNE.SEG_LEN) / TUNE.SEG_LEN;
    return lerp(s.p1.world.y, s.p2.world.y, pct);
  };

  /**
   * 시작점과 끝점의 높이가 같은가.
   *
   * 랩을 도는 코스라 마지막 세그먼트 다음이 첫 세그먼트다. 높이가 다르면
   * 결승선을 지날 때마다 화면이 한 번씩 튄다. 코스를 새로 만들 때 이걸로 확인한다.
   */
  Track.prototype.seamOk = function () {
    return Math.abs(this._lastY()) < 1;
  };

  /* ── 투영 ─────────────────────────────────────────── */

  function project(p, camX, camY, camZ, camDepth, w, h, roadW) {
    p.camera.x = (p.world.x || 0) - camX;
    p.camera.y = (p.world.y || 0) - camY;
    p.camera.z = (p.world.z || 0) - camZ;
    if (p.camera.z < 1) p.camera.z = 1;              // 0으로 나누지 않는다
    p.screen.scale = camDepth / p.camera.z;
    p.screen.x = Math.round(w / 2 + p.screen.scale * p.camera.x * w / 2);
    p.screen.y = Math.round(h / 2 - p.screen.scale * p.camera.y * h / 2);
    p.screen.w = Math.round(p.screen.scale * roadW * w / 2);
  }

  function quad(ctx, x1, y1, w1, x2, y2, w2) {
    ctx.beginPath();
    ctx.moveTo(x1 - w1, y1);
    ctx.lineTo(x1 + w1, y1);
    ctx.lineTo(x2 + w2, y2);
    ctx.lineTo(x2 - w2, y2);
    ctx.closePath();
    ctx.fill();
  }

  /* ── 배경 ─────────────────────────────────────────── */

  var HILL_W = 420;      // 산 하나의 폭
  var HILL_N = 6;        // 화면을 채우는 데 필요한 산 개수 + 여유

  /**
   * 하늘과 산. 레이어 두 장이 전부다 (config.MAX_BG_LAYERS = 3).
   *
   * 산은 drawImage가 아니라 삼각형 채우기 한 번이다. 커브를 돌 때 반대로 흘러
   * 도는 느낌을 만든다 — 이 한 겹이 없으면 커브가 그냥 도로가 휘는 그림이 된다.
   */
  function background(ctx, track, skyX, groundColor) {
    var W = C.WIDTH, H = C.HEIGHT;
    var hz = Math.round(H * TUNE.SKY_Y);

    ctx.fillStyle = track.colors.sky;
    ctx.fillRect(0, 0, W, hz);
    ctx.fillStyle = track.colors.sky2;
    ctx.fillRect(0, Math.round(hz - H * 0.10), W, Math.round(H * 0.10));

    // 산. 톱니 하나로 이어 그리고 한 번에 채운다.
    var off = skyX % HILL_W;
    if (off > 0) off -= HILL_W;
    ctx.fillStyle = track.colors.hill;
    ctx.beginPath();
    ctx.moveTo(off - HILL_W, hz);
    for (var i = 0; i < HILL_N + 2; i++) {
      var x = off + i * HILL_W;
      var peak = hz - (i % 2 ? 92 : 148);
      ctx.lineTo(x - HILL_W / 2, peak);
      ctx.lineTo(x, hz);
    }
    ctx.lineTo(off + (HILL_N + 2) * HILL_W, hz);
    ctx.closePath();
    ctx.fill();

    // 지평선 아래는 일단 풀색으로 덮는다. 가까운 세그먼트가 그 위에 다시 칠한다.
    // **가장 멀리 있는 세그먼트와 같은(안개 먹은) 색이어야 한다.** 원색으로 덮으면
    // 도로가 닿지 않는 지평선 바로 아래에 원색 초록 띠가 남는다.
    ctx.fillStyle = groundColor || track.colors.ground;
    ctx.fillRect(0, hz, W, H - hz);
  }

  /* ── 그리기 ───────────────────────────────────────── */

  var frameNo = 0;

  /**
   * 한 프레임.
   *
   *   cam     { z, x, sky }   x는 도로 반폭 단위, sky는 배경 가로 오프셋(px)
   *   sprites [{ z, x, key, frame, w }] 또는 [{ z, x, w, draw:function(ctx,sx,sy,scale) }]
   *           w는 월드 단위 폭. 깊이에 따라 알아서 작아진다
   *
   * 반환값은 계측용 숫자다 — 단독 벤치 페이지가 이걸 화면에 띄운다.
   */
  function render(ctx, track, cam, sprites) {
    var W = C.WIDTH, H = C.HEIGHT;
    var segs = track.segs, N = segs.length;
    if (!N) return { segs: 0, sprites: 0 };

    var drawN = Math.min(TUNE.DRAW_SEGS, N);
    var pal = palette(track, drawN);
    var camDepth = 1 / Math.tan((TUNE.FOV / 2) * Math.PI / 180);
    var roadW = TUNE.ROAD_W;

    frameNo++;

    background(ctx, track, cam.sky || 0, pal.light.grass[drawN - 1]);

    var camZ = track.wrap(cam.z);
    var base = track.at(camZ);
    var basePct = (camZ % TUNE.SEG_LEN) / TUNE.SEG_LEN;
    var camY = TUNE.CAM_H + (TUNE.HILLS ? track.heightAt(camZ) : 0);

    var maxy = H;
    var x = 0;
    var dx = -(base.curve * basePct);
    var drawn = 0;
    var n, seg, p1, p2, tone, looped;

    for (n = 0; n < drawN; n++) {
      seg = segs[(base.index + n) % N];
      looped = seg.index < base.index;

      project(seg.p1, cam.x * roadW - x,      camY, camZ - (looped ? track.length : 0), camDepth, W, H, roadW);
      project(seg.p2, cam.x * roadW - x - dx, camY, camZ - (looped ? track.length : 0), camDepth, W, H, roadW);

      x += dx;
      dx += seg.curve;

      seg.clip = maxy;
      p1 = seg.p1.screen;
      p2 = seg.p2.screen;

      // 뒤에 있거나, 뒤집혀 있거나, 이미 그린 언덕에 가려지면 건너뛴다.
      if (seg.p1.camera.z <= camDepth || p2.y >= p1.y || p2.y >= maxy) { seg.vis = 0; continue; }

      seg.vis = frameNo;
      tone = seg.dark ? pal.dark : pal.light;

      // 풀밭. 세그먼트 하나가 차지하는 가로줄을 통째로 칠한다 (fillRect가 제일 싸다).
      ctx.fillStyle = tone.grass[n];
      ctx.fillRect(0, p2.y, W, p1.y - p2.y);

      // 갓돌. 가까운 구간에만 그린다 — 멀리서는 1픽셀도 안 되면서 값은 그대로 나간다.
      if (n < TUNE.DETAIL_SEGS && tone.rumble) {
        ctx.fillStyle = tone.rumble[n];
        quad(ctx, p1.x, p1.y, p1.w * 1.18, p2.x, p2.y, p2.w * 1.18);
      }

      ctx.fillStyle = tone.road[n];
      quad(ctx, p1.x, p1.y, p1.w, p2.x, p2.y, p2.w);

      // 중앙선. 밝은 세그먼트에만 있어서 저절로 점선이 된다.
      if (n < TUNE.DETAIL_SEGS && tone.line) {
        ctx.fillStyle = tone.line[n];
        quad(ctx, p1.x, p1.y, Math.max(p1.w * 0.02, 1), p2.x, p2.y, Math.max(p2.w * 0.02, 1));
      }

      drawn++;
      maxy = p1.y;
    }

    var used = sprites ? drawSprites(ctx, track, cam, sprites, roadW, W) : 0;
    return { segs: drawn, sprites: used };
  }

  /**
   * 스프라이트. **먼 것부터 그린다** — 가까운 카트가 먼 카트를 가려야 한다.
   *
   * 상한(SPRITE_MAX)을 넘으면 먼 것부터 버린다. 가까운 것을 버리면 눈에 띈다.
   */
  function drawSprites(ctx, track, cam, sprites, roadW, W) {
    var camZ = track.wrap(cam.z);
    var list = [];
    var i, sp, dz;

    for (i = 0; i < sprites.length; i++) {
      sp = sprites[i];
      dz = track.wrap(sp.z - camZ);
      if (dz > TUNE.DRAW_SEGS * TUNE.SEG_LEN) continue;   // 시야 밖
      // 카메라와 나란한 것은 그리지 않는다. 원근 배율이 발산해서
      // 카트 한 대가 화면을 통째로 덮는다 (NPC가 옆을 지나갈 때 생긴다).
      if (dz < TUNE.SEG_LEN) continue;
      list.push({ sp: sp, dz: dz });
    }

    list.sort(function (a, b) { return b.dz - a.dz; });      // 먼 것부터
    if (list.length > TUNE.SPRITE_MAX) list = list.slice(list.length - TUNE.SPRITE_MAX);

    var used = 0;
    for (i = 0; i < list.length; i++) {
      sp = list[i].sp;
      var seg = track.at(sp.z);
      if (!seg || seg.vis !== frameNo) continue;            // 화면에 안 나온 구간

      var sc = seg.p1.screen.scale;
      var sx = seg.p1.screen.x + sc * (sp.x || 0) * roadW * W / 2;
      var sy = seg.p1.screen.y;
      var sw = sc * (sp.w || 1200) * W / 2;

      if (sw < 2) continue;                                 // 점 하나를 그리자고 값을 치르지 않는다
      if (sw > W) sw = W;                                   // 위 걸러내기의 이중 안전장치

      if (sp.draw) sp.draw(ctx, sx, sy, sw);
      else if (sp.key && GP.gfx) {
        var sheet = GP.gfx.size ? GP.gfx.size(sp.key) : null;
        var fw = sheet ? sheet.fw : sw;
        var fh = sheet ? sheet.fh : sw;
        var k = sw / fw;
        GP.gfx.blit(ctx, sp.key, sp.frame || 0, sx, sy - fh * k / 2, k);
      }
      used++;
    }
    return used;
  }

  GP.pseudo3d = {
    TUNE: TUNE,
    Track: Track,
    project: project,
    render: render,
    background: background,
    palette: palette,
    quad: quad,
    /** 시험용 */
    _test: {
      mix: mix,
      lerp: lerp,
      frameNo: function () { return frameNo; }
    }
  };

})(window);
