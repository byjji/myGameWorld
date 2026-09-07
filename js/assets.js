/**
 * 에셋 로더 — 그림이 있으면 쓰고, 없으면 지금의 도형으로 돌아간다
 *
 * 이 파일이 있는 이유는 하나다. **에셋을 기다리느라 개발이 멈추지 않게 하려고.**
 * 지금 캐릭터와 배경은 전부 임시 도형이다. 나중에 진짜 그림이 생기면
 * `js/assets-manifest.js`에 한 줄 적고 파일을 넣기만 하면 된다.
 * 게임 코드는 한 줄도 안 고친다.
 *
 * 세 가지를 지킨다.
 *
 *   1. **없으면 조용히 폴백.** 404가 나도, 매니페스트가 비어 있어도 게임은 그대로 돈다
 *   2. **기다리지 않는다.** 이미지는 뒤에서 받고, 도착하면 그때부터 쓴다.
 *      로딩 화면을 만들지 않는다 — 5세는 로딩을 기다리지 않는다
 *   3. **덜 받은 그림은 안 그린다.** 로드 중인 이미지를 drawImage 하면
 *      브라우저마다 다르게 깨진다. `complete`를 확인하고 넘어간다
 *
 * 그리기 예산(phase1): 배경 한 장 = drawImage 1회, 캐릭터 한 명 = 1회.
 * 도형으로 그릴 때보다 오히려 싸다.
 *
 * 문법 수준: ES5
 */
(function (global) {
  'use strict';

  var LP = global.LP || (global.LP = {});

  var imgs = {};        // src -> { el, ok, failed }
  var manifest = { chars: {}, bg: {} };
  var booted = false;

  function get(src) {
    if (!src) return null;
    if (imgs[src]) return imgs[src];

    var rec = { el: null, ok: false, failed: false };
    imgs[src] = rec;

    try {
      var im = new global.Image();
      im.onload = function () { rec.ok = true; };
      im.onerror = function () { rec.failed = true; };
      im.src = src;
      rec.el = im;
    } catch (e) {
      rec.failed = true;
    }
    return rec;
  }

  /** 그릴 수 있는 상태인가. 로드 중이거나 실패했으면 false. */
  function usable(rec) {
    return !!(rec && rec.ok && rec.el && rec.el.complete && rec.el.naturalWidth > 0);
  }

  /**
   * 매니페스트를 읽고 이미지를 받기 시작한다.
   * 화면을 막지 않는다 — 도착하는 대로 폴백에서 그림으로 바뀐다.
   */
  function boot(m) {
    manifest = m || global.LP.assetManifest || { chars: {}, bg: {} };
    if (!manifest.chars) manifest.chars = {};
    if (!manifest.bg) manifest.bg = {};
    booted = true;

    var k;
    for (k in manifest.chars) {
      if (Object.prototype.hasOwnProperty.call(manifest.chars, k)) get(manifest.chars[k].src);
    }
    for (k in manifest.bg) {
      if (Object.prototype.hasOwnProperty.call(manifest.bg, k)) get(manifest.bg[k].src);
    }
    return LP.assets;
  }

  /**
   * 캐릭터 한 명. 발밑 중앙이 (x, y), h는 키(픽셀).
   * 그렸으면 true, 못 그렸으면 false — 부르는 쪽이 폴백을 그린다.
   *
   * 스프라이트 시트는 가로로 이어붙인 프레임 배열이고,
   * 어떤 자세가 몇 번째인지는 매니페스트의 poses가 정한다.
   */
  function charFrame(ctx, id, pose, x, y, h) {
    var d = manifest.chars[id];
    if (!d) return false;
    var rec = imgs[d.src];
    if (!usable(rec)) return false;

    var idx = (d.poses && d.poses[pose] !== undefined) ? d.poses[pose]
            : (d.poses && d.poses.idle !== undefined) ? d.poses.idle : 0;

    var fw = d.fw || rec.el.naturalWidth;
    var fh = d.fh || rec.el.naturalHeight;
    var w = h * (fw / fh);

    ctx.drawImage(rec.el, idx * fw, 0, fw, fh,
                  Math.round(x - w / 2), Math.round(y - h), Math.round(w), Math.round(h));
    return true;
  }

  /**
   * 배경 한 장을 화면 전체에 그린다. 그렸으면 true.
   * 정지 배경은 한 장뿐이다 (PROJECT.md 2장).
   */
  function bg(ctx, key, w, h) {
    var d = manifest.bg[key];
    if (!d) return false;
    var rec = imgs[d.src];
    if (!usable(rec)) return false;

    ctx.drawImage(rec.el, 0, 0, w, h);
    return true;
  }

  /**
   * 세로로 흐르는 배경. offY만큼 밀어서 위아래로 반복한다 (로프 오르기).
   *
   * 이미지가 화면보다 작으면 그만큼 drawImage 횟수가 는다.
   * **화면 높이(720) 이상으로 그려라** — 그러면 두 장이면 끝난다.
   */
  function bgTileY(ctx, key, offY, w, h) {
    var d = manifest.bg[key];
    if (!d) return false;
    var rec = imgs[d.src];
    if (!usable(rec)) return false;

    var ih = rec.el.naturalHeight;
    var start = -(((offY % ih) + ih) % ih);
    for (var y = start; y < h; y += ih) {
      ctx.drawImage(rec.el, 0, y, w, ih);
    }
    return true;
  }

  /** 진단용. 무엇이 왔고 무엇이 실패했는지. */
  function status() {
    var out = { total: 0, loaded: 0, failed: 0, pending: 0, misses: [] };
    for (var src in imgs) {
      if (!Object.prototype.hasOwnProperty.call(imgs, src)) continue;
      out.total++;
      if (imgs[src].failed) { out.failed++; out.misses.push(src); }
      else if (usable(imgs[src])) out.loaded++;
      else out.pending++;
    }
    return out;
  }

  LP.assets = {
    boot: boot,
    charFrame: charFrame,
    bg: bg,
    bgTileY: bgTileY,
    status: status,
    booted: function () { return booted; },
    /** 시험용. 받아둔 이미지를 비운다. */
    _reset: function () { imgs = {}; manifest = { chars: {}, bg: {} }; booted = false; }
  };

})(window);
