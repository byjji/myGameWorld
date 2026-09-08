#!/bin/sh
# Game-Party 정적 배포용 파일 추리기
#
# 트랜스파일이 아니다. 복사만 한다 — PROJECT.md 2장의 "빌드 단계 없음"은
# 바닐라 JS를 가공하지 않는다는 뜻이고, 여기서도 JS는 손대지 않는다.
#
# 저장소 루트를 그대로 올리지 않는 이유:
#   dev/    개발 배선 (pair.html). 공개 주소에 있을 이유가 없다
#   test/   시험 코드
#   server/ 릴레이 서버. NAS에서 돈다
#   docs/, .claude/, PROJECT.md, README.md   설계 문서
#
# js/devlink.js와 js/devsensor.js는 tv/play 페이지가 <script>로 걸고 있어 함께 올린다.
# 둘 다 ?dev=1에서만 켜지므로 배포본 흐름에는 들어가지 않는다.

set -eu

OUT=dist
rm -rf "$OUT"
mkdir -p "$OUT"

cp -R js    "$OUT/"
cp -R tv    "$OUT/"
cp -R play  "$OUT/"

# 진단 페이지는 조카 집 TV 브라우저에서 열어야 의미가 있다. 배포본에 넣는다.
#   tools/tv-bench_1.html  렌더링 성능 (phase1)
#   tools/echo_1.html      릴레이 연결·RTT (phase2)
# html만 가져간다 — tools/에는 개발용 스크립트도 있고, 그것까지 공개할 이유는 없다.
mkdir -p "$OUT/tools"
cp tools/*.html "$OUT/tools/"

# 그림. 아직 비어 있어도 폴더째 올린다 —
# 파일을 넣는 순간 배포에 반영되게, 여기를 다시 고칠 일이 없도록.
# 설명 문서와 빈 폴더 표식은 뺀다. 그림만 나가면 된다.
if [ -d assets ]; then
  cp -R assets "$OUT/"
  find "$OUT/assets" -name '*.md' -delete
  find "$OUT/assets" -name '.gitkeep' -delete
fi

echo "dist 구성 완료:"
find "$OUT" -type f | sort
