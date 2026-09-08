/**
 * Game-Party 그리기 도우미 — 오프스크린 프리렌더 · 파티클 · 화면 흔들림
 *
 * phase1 예산(js/config.js)을 지키기 위한 공용 자리다. 게임마다 따로 만들면
 * 상한이 게임 수만큼 늘어나 예산이 의미를 잃는다.
 *
 * 세 가지를 여기서 강제한다.
 *   1. 반복 연출은 매 프레임 계산하지 않고 오프스크린에 한 번 그려 blit 한다
 *   2. 오프스크린 장수와 한 변 길이를 MAX_OFFSCREEN / MAX_OFFSCREEN_SIDE로 막는다
 *   3. 파티클은 MAX_PARTICLES를 넘기지 않는다. 넘으면 오래된 것을 재사용한다
 *
 * 문법 수준: ES5
 */
(function (global) {
  'use strict';

  var GP = global.GP || (global.GP = {});
  var C = GP.config;

  var sheets = {};      // key -> { canvas, fw, fh, n }
  var order = [];       // 만든 순서. 상한을 넘으면 앞에서 버린다

  /**
   * 프레임 시퀀스를 오프스크린에 미리 그려둔다. 같은 key로 다시 부르면 그대로 돌려준다.
   *
   *   draw(ctx2d, frameIndex)  — 프레임 하나를 (0,0)~(fw,fh)에 그린다
   *
   * 가로로 n장을 이어붙인다. 세로로 쌓지 않는 이유는 blit 계산을 단순하게 두기 위함.
   *
   * pin을 주면 상한을 넘어도 버리지 않는다. 캐릭터 모자 마크처럼 모든 화면이 쓰는 것은
   * 게임 시트와 자리를 다투면 안 된다 — 밀려나면 글자가 통째로 사라진다.
   */
  function sheet(key, n, fw, fh, draw, pin) {
    if (sheets[key]) return sheets[key];

    fw = Math.round(fw);
    fh = Math.round(fh);

    // 한 변 상한을 넘으면 TV 메모리를 밀어낸다. 프레임 수를 줄여서라도 맞춘다.
    var maxN = Math.max(1, Math.floor(C.MAX_OFFSCREEN_SIDE / fw));
    if (n > maxN) n = maxN;
    if (fh > C.MAX_OFFSCREEN_SIDE) fh = C.MAX_OFFSCREEN_SIDE;

    var cv = global.document.createElement('canvas');
    cv.width = fw * n;
    cv.height = fh;
    var c2 = cv.getContext('2d');

    for (var i = 0; i < n; i++) {
      c2.save();
      c2.translate(i * fw, 0);
      c2.beginPath();
      c2.rect(0, 0, fw, fh);
      c2.clip();
      draw(c2, i);
      c2.restore();
    }

    var s = { canvas: cv, fw: fw, fh: fh, n: n, pinned: !!pin };
    sheets[key] = s;
    if (pin) return s;

    order.push(key);

    // 오래된 시트를 버린다. 게임을 바꾸면 이전 게임 시트는 다시 쓰이지 않는다.
    while (order.length > C.MAX_OFFSCREEN) {
      var old = order.shift();
      delete sheets[old];
    }
    return s;
  }

  /** 프레임 하나를 그린다. 중심이 (x, y). scale은 1이면 원본 크기. */
  function blit(ctx, key, frame, x, y, scale) {
    var s = sheets[key];
    if (!s) return;
    var f = ((frame % s.n) + s.n) % s.n;
    var w = s.fw * (scale || 1);
    var h = s.fh * (scale || 1);
    ctx.drawImage(s.canvas, f * s.fw, 0, s.fw, s.fh,
                  Math.round(x - w / 2), Math.round(y - h / 2), Math.round(w), Math.round(h));
  }

  function drop(key) {
    delete sheets[key];
    for (var i = 0; i < order.length; i++) {
      if (order[i] === key) { order.splice(i, 1); break; }
    }
  }

  /**
   * 파티클 풀.
   *
   * 물리 계산이 아니다. 미리 그린 스프라이트를 포물선으로 던지는 것뿐이다
   * (PROJECT.md 2장: 대량 파티클 금지).
   * 상한을 넘으면 새로 만들지 않고 가장 오래된 것을 되쓴다 — 개수가 절대 늘지 않는다.
   */
  function Particles(limit) {
    this.limit = Math.min(limit || C.MAX_PARTICLES, C.MAX_PARTICLES);
    this.list = [];
    this.next = 0;
  }

  Particles.prototype.spawn = function (x, y, vx, vy, life, sheetKey) {
    var p;
    if (this.list.length < this.limit) {
      p = {};
      this.list.push(p);
    } else {
      p = this.list[this.next];
      this.next = (this.next + 1) % this.limit;
    }
    p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.t = 0; p.life = life; p.key = sheetKey;
    return p;
  };

  Particles.prototype.update = function (dt) {
    for (var i = 0; i < this.list.length; i++) {
      var p = this.list[i];
      if (p.t >= p.life) continue;
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 900 * dt;      // 중력. 숫자 하나짜리 포물선이면 충분하다
    }
  };

  Particles.prototype.render = function (ctx) {
    for (var i = 0; i < this.list.length; i++) {
      var p = this.list[i];
      if (p.t >= p.life) continue;
      blit(ctx, p.key, Math.floor(p.t * 12), p.x, p.y, 1);
    }
  };

  Particles.prototype.clear = function () {
    for (var i = 0; i < this.list.length; i++) this.list[i].t = this.list[i].life;
  };

  Particles.prototype.alive = function () {
    var n = 0;
    for (var i = 0; i < this.list.length; i++) {
      if (this.list[i].t < this.list[i].life) n++;
    }
    return n;
  };

  /**
   * 화면 흔들림. 블러·그림자가 금지라 타격감을 낼 수단이 이것뿐이다.
   * 길게 흔들면 5세가 화면을 못 읽는다. 0.25초 안쪽으로 짧게 쓴다.
   */
  function shake(t, dur, mag) {
    if (t >= dur) return { x: 0, y: 0 };
    var k = 1 - t / dur;
    var a = t * 60;
    return { x: Math.sin(a) * mag * k, y: Math.cos(a * 1.7) * mag * k };
  }

  GP.gfx = {
    sheet: sheet,
    blit: blit,
    drop: drop,
    has: function (key) { return !!sheets[key]; },
    count: function () { return order.length; },
    Particles: Particles,
    shake: shake
  };

})(window);
