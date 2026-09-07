"""
최소 PNG 인코더.

견본 스프라이트와 아이콘을 만드는 데만 쓴다. 그림 도구가 아니다.

외부 라이브러리를 쓰지 않는 이유: 이미지 몇 장 만들자고 Pillow를 설치하게 만들면,
저장소를 새로 받은 사람이 스크립트 하나 돌리려고 pip부터 해야 한다.
zlib과 struct는 파이썬에 들어 있다.
"""

import struct
import zlib


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
    return len(png)


def blank(w, h, color=(0, 0, 0, 0)):
    return [color] * (w * h)


def rect(px, w, x0, y0, x1, y1, color):
    h = len(px) // w
    for y in range(max(y0, 0), min(y1, h)):
        for x in range(max(x0, 0), min(x1, w)):
            px[y * w + x] = color


def disc(px, w, cx, cy, r, color):
    """원. 아이콘의 둥근 부분에 쓴다."""
    h = len(px) // w
    rr = r * r
    for y in range(max(cy - r, 0), min(cy + r + 1, h)):
        dy = y - cy
        for x in range(max(cx - r, 0), min(cx + r + 1, w)):
            dx = x - cx
            if dx * dx + dy * dy <= rr:
                px[y * w + x] = color


def round_rect(px, w, x0, y0, x1, y1, r, color):
    """모서리를 깎은 사각형. 홈 화면 아이콘이 각지면 촌스럽다."""
    rect(px, w, x0 + r, y0, x1 - r, y1, color)
    rect(px, w, x0, y0 + r, x1, y1 - r, color)
    disc(px, w, x0 + r, y0 + r, r, color)
    disc(px, w, x1 - r - 1, y0 + r, r, color)
    disc(px, w, x0 + r, y1 - r - 1, r, color)
    disc(px, w, x1 - r - 1, y1 - r - 1, r, color)
