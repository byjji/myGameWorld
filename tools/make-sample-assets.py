"""
견본 스프라이트를 만든다.

  python tools/make-sample-assets.py

**그림을 대신하려는 게 아니다.** "파일을 넣으면 정말로 바뀌는가"를 확인하고,
스프라이트 시트를 어떤 모양으로 만들어야 하는지 눈으로 보여주기 위한 것이다.

만들어지는 것 (assets/sample/):
  lhat.png        96×160 4칸 캐릭터 시트 (idle · jump · squat · punch)
  jumprope.png    1280×720 배경 한 장
  ropeclimb.png   640×720 세로로 이어지는 배경

쓰는 법은 `assets/README.md`. 매니페스트에서 sample 줄을 살리면 바로 보인다.

외부 라이브러리를 쓰지 않는다 — PNG 인코더를 직접 넣었다.
견본 하나 만들자고 Pillow를 설치하게 만들 이유가 없다.
"""

import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "sample")


def write_png(path, w, h, pixels):
    """pixels = [(r,g,b,a), ...] 길이 w*h. 위에서 아래, 왼쪽에서 오른쪽."""
    raw = bytearray()
    for y in range(h):
        raw.append(0)                       # 필터 없음
        row = y * w
        for x in range(w):
            raw += bytes(pixels[row + x])

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")

    with open(path, "wb") as f:
        f.write(png)
    print("  %-28s %d×%d  %.1fKB" % (os.path.basename(path), w, h, len(png) / 1024))


def blank(w, h, color=(0, 0, 0, 0)):
    return [color] * (w * h)


def rect(px, w, x0, y0, x1, y1, color):
    for y in range(max(y0, 0), min(y1, len(px) // w)):
        for x in range(max(x0, 0), min(x1, w)):
            px[y * w + x] = color


def char_sheet():
    """
    4칸 시트. 자세마다 몸 높이와 팔 위치가 다르다.
    **발이 프레임 아래 끝에 닿는다** — 기준점이 발밑 중앙이기 때문이다.
    """
    fw, fh, n = 96, 160, 4
    W, H = fw * n, fh
    px = blank(W, H)

    CAP, SKIN, BODY, STRAP = (224, 51, 44, 255), (240, 192, 144, 255), \
                             (47, 111, 208, 255), (27, 63, 122, 255)

    # (몸 시작 y, 팔 y, 이름)
    poses = [(38, 78), (26, 66), (62, 96), (38, 52)]   # idle, jump, squat, punch

    for i, (top, arm) in enumerate(poses):
        ox = i * fw
        head_h = 54
        rect(px, W, ox + 18, top, ox + 78, top + 22, CAP)             # 모자
        rect(px, W, ox + 24, top + 22, ox + 72, top + head_h, SKIN)   # 얼굴
        rect(px, W, ox + 26, top + head_h, ox + 70, fh, BODY)         # 몸통
        rect(px, W, ox + 36, top + head_h, ox + 42, fh, STRAP)        # 멜빵
        rect(px, W, ox + 54, top + head_h, ox + 60, fh, STRAP)
        rect(px, W, ox + 12, arm, ox + 26, arm + 40, SKIN)            # 팔
        rect(px, W, ox + 70, arm, ox + 84, arm + 40, SKIN)
        # 프레임 번호 표시. 어느 칸이 무엇인지 눈으로 세기 위한 것
        rect(px, W, ox + 4, 4, ox + 4 + 8 * (i + 1), 12, (255, 255, 255, 255))

    write_png(os.path.join(OUT, "lhat.png"), W, H, px)


def bg_jumprope():
    """정지 배경 한 장. 바닥선이 높이의 80% (js/games/jumprope.js GROUND_Y)."""
    W, H = 1280, 720
    ground = int(H * 0.80)
    px = blank(W, H, (124, 198, 239, 255))
    rect(px, W, 0, ground, W, H, (74, 154, 63, 255))
    rect(px, W, 0, ground, W, ground + 12, (61, 130, 53, 255))
    for x in range(120, W, 420):                                  # 구름
        rect(px, W, x, 90, x + 180, 150, (255, 255, 255, 255))
    write_png(os.path.join(OUT, "jumprope.png"), W, H, px)


def bg_ropeclimb():
    """
    세로로 흐르는 배경. **위 끝과 아래 끝이 맞물려야** 이음매가 안 보인다.
    높이를 720 이상으로 두면 화면을 두 장이면 덮는다.
    """
    W, H = 640, 720
    px = blank(W, H, (18, 32, 60, 255))
    for y in range(0, H, 90):                                     # 벽돌 줄
        rect(px, W, 0, y, W, y + 6, (43, 63, 107, 255))
        off = 0 if (y // 90) % 2 == 0 else 80
        for x in range(off, W, 160):
            rect(px, W, x, y, x + 6, y + 90, (35, 52, 88, 255))
    write_png(os.path.join(OUT, "ropeclimb.png"), W, H, px)


if __name__ == "__main__":
    if not os.path.isdir(OUT):
        os.makedirs(OUT)
    print("견본 생성:", OUT)
    char_sheet()
    bg_jumprope()
    bg_ropeclimb()
    print("\n`js/assets-manifest.js`의 sample 줄을 살리면 화면에 나온다.")
