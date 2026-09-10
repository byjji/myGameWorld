# Game-Party

조카(2021년생)와 함께 놀기 위한 웹 기반 동작인식 파티게임.
폰을 컨트롤러로 쓰고 TV 화면에서 논다.

**설계 원본은 [`PROJECT.md`](PROJECT.md).** 여기 있는 결정은 재논의하지 않는다.
개발 단계는 [`.claude/phase/README.md`](.claude/phase/README.md).

```
조카 집                           우리 집
┌─────────────┐                ┌──────────────┐
│ 폰 (컨트롤러) │ ──센서 판정──┐  │  NAS         │
│  /p         │              ├─→│  FastAPI 릴레이│
├─────────────┤              │  └──────────────┘
│ TV (화면)    │ ←──게임 상태──┘
│  /          │                Netlify: 정적 파일
└─────────────┘
```

- **폰은 컨트롤러 전용.** 게임 화면을 그리지 않는다 — 그리면 조카가 TV 대신 폰을 본다
- **TV는 화면 전용.** 입력을 받지 않는다
- 서버는 **릴레이일 뿐**이다. 게임 로직도 DB도 없다

## 폴더

```
js/               프론트엔드 (바닐라 JS, ES5)
  config.js       렌더링 예산 — 실기에서 30fps가 안 나오면 여기 숫자만 낮춘다
  tuning.js       판정 임계값 + 주소로 값을 덮어쓰는 현장 오버라이드
  motion.js       동작 판정 (점프·쳐올리기·스쿼트·기울기). 폰에서 돈다
  calib.js        자세 보정
  net.js          WebSocket 클라이언트 (폰·TV 공용)
  loop.js         게임 루프 (deltaTime 기반)
  fps.js          fps 오버레이 + 그리기 예산 계측 (?fps=1)
  gfx.js          오프스크린 프리렌더 · 파티클 · 화면 흔들림
  sfx.js          효과음·BGM (에셋 없이 WebAudio 합성)
  assets.js       그림 로더 — 있으면 쓰고 없으면 도형으로 폴백
  assets-manifest.js  어떤 그림이 있는지 선언하는 한 파일
  chars.js        캐릭터 정의 + 임시 도형
  npc.js          러버밴딩 (경쟁 NPC)
  pseudo3d.js     유사 3D 도로 렌더러 (레이싱). 아웃런식 세그먼트 투영
  courses.js      레이싱 코스 데이터 — 새 코스는 배열 하나만 더 적는다
  board.js        세션 보드 — 판 결과를 칸 수로 바꾼다
  tv.js           TV 셸 (화면 전환 · 룰렛 · 세션)
  play.js         폰 컨트롤러
  devlink.js      개발용 로컬 릴레이 (?dev=1)
  devsensor.js    개발용 키보드 센서 (?dev=1 / ?keys=1)
  games/          미니게임. 레지스트리에 등록만 하면 셸이 알아서 쓴다

server/           릴레이 서버 (FastAPI). NAS Docker에서 돈다
  rooms.py        방 규칙 — 소켓을 모르는 순수 로직
  main.py         소켓 어댑터

assets/           그림 넣는 자리 (지금은 비어 있다) → assets/README.md
tv/  play/        TV 화면 · 폰 컨트롤러 페이지
tools/            진단 페이지 (통신 에코, 렌더링 벤치, 도로 렌더러 벤치)
dev/              개발 배선 (TV와 폰을 한 탭에)
test/             시험
docs/             배포 절차 · 플레이테스트 양식 · 어른용 안내
```

## 돌려보기

```sh
GP_STATIC=. python server/main.py
```

| 주소 | 용도 |
|---|---|
| `/dev/pair.html` | TV와 폰을 한 탭에 나란히 (서버 없이도 됨) |
| `/tv/index.html?fps=1` | TV 화면 + 예산 계측 |
| `/play/index.html?keys=1` | 폰 화면 + 키보드 센서 (J 점프 · S 스쿼트 · P 쳐올리기 · ←→ 기울기) |
| `/tools/echo_1.html` | 통신만 떼어 확인 |

개발용 주소 파라미터

| 파라미터 | 뜻 |
|---|---|
| `?fps=1` | 프레임 수 · 그리기 예산 표시 |
| `?game=hammer` | 룰렛을 건너뛰고 그 게임만 반복 |
| `?rounds=2` | 세션을 두 판으로 |
| `?dev=1` | 로컬 릴레이 + 키보드 센서 (서버 불필요) |
| `?keys=1` | 진짜 서버 + 키보드 센서 |
| `?tune=SPIKE_ON:10` | 임계값 덮어쓰기 (현장 조정) |
| `?relay=wss://...` | 릴레이 주소 지정 |

## 시험

```sh
node   test/games-test.js    미니게임 · NPC · 보드 · 룰렛 · 안정화
node   test/motion-test.js   동작 판정
node   test/net-test.js      통신 · 보정
python test/relay-test.py    릴레이 서버
```

## 배포

[`docs/deploy.md`](docs/deploy.md) — NAS · DDNS · 인증서 · 리버스 프록시 · Netlify.
조카 집에서 세션을 시작하는 절차는 [`docs/adult-guide.md`](docs/adult-guide.md).

## 상태

미니게임 5종(줄넘기 · 로프 오르기 · 해머 피하기 · 블록깨기 · 레이싱)과 5판 세션 구조까지 완성.
**코드로 만들 것은 다 만들었다.**

남은 것은 대부분 **실기 확인**이다 — 조카 집 TV 성능, 실제 폰 센서, 조카 반응.
임계값은 전부 합성 파형으로만 맞춰본 추측이다.

캐릭터는 원작을 그대로 쓴다. **집에서만 쓰는 전제다** — 외부 공개 시 전부 교체해야 한다.
