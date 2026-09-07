"""
앱 아이콘을 만든다.

  python tools/make-icon.py

만들어지는 것 (assets/icon/):
  lp-192.png   폰 홈 화면 · 브라우저 탭
  lp-512.png   고해상도

**두 가지를 해결한다.**

  1. favicon 404 — 콘솔 잡음. 나중에 진짜 에러를 찾을 때 이게 섞여 있으면 눈에 안 띈다
  2. 주소 입력 — 폰에서 "홈 화면에 추가"를 하면 주소를 매번 치지 않아도 된다.
     조카 집에서 폰을 쥐여줄 때마다 주소창을 여는 것과 아이콘 한 번 누르는 것은 다르다

그림은 주인공의 상징인 **빨간 모자 + 흰 원 + L 마크** (PROJECT.md 3장).
캐릭터 스프라이트가 생기면 이 아이콘도 같이 바꾸는 게 좋다.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pngwrite import write_png, blank, rect, disc, round_rect  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "icon")

BG   = (16, 24, 40, 255)      # 셸 배경과 같은 남색
CAP  = (224, 51, 44, 255)     # 모자
WHITE = (255, 255, 255, 255)
BRIM = (176, 34, 29, 255)     # 챙. 모자보다 어둡게


def icon(size):
    px = blank(size, size)
    u = size / 192.0                     # 192 기준으로 그리고 배율만 곱한다

    def s(v):
        return int(round(v * u))

    # 바탕
    round_rect(px, size, 0, 0, size, size, s(38), BG)

    # 모자 — 위쪽 둥근 부분 + 아래 챙
    cx, cy = size // 2, s(96)
    disc(px, size, cx, cy, s(46), CAP)
    rect(px, size, s(46), cy, size - s(46), cy + s(20), CAP)
    rect(px, size, s(38), cy + s(14), size - s(38), cy + s(30), BRIM)

    # 마크 자리 흰 원
    mr = s(26)
    disc(px, size, cx, cy - s(8), mr, WHITE)

    # L. 글자를 못 그리니 막대 두 개로 만든다
    lw = s(7)
    lx = cx - s(9)
    ly = cy - s(24)
    rect(px, size, lx, ly, lx + lw, ly + s(30), CAP)          # 세로
    rect(px, size, lx, ly + s(30) - lw, lx + s(21), ly + s(30), CAP)  # 가로

    return px


if __name__ == "__main__":
    if not os.path.isdir(OUT):
        os.makedirs(OUT)
    print("아이콘 생성:", OUT)
    for n in (192, 512):
        path = os.path.join(OUT, "lp-%d.png" % n)
        b = write_png(path, n, n, icon(n))
        print("  lp-%d.png  %.1fKB" % (n, b / 1024))
