# Game-Party 개발 단계

`PROJECT.md` 9장(개발 순서)을 실행 가능한 단위로 쪼갠 문서. 각 파일은 독립 작업 단위이며 앞 단계의 완료 기준이 충족돼야 다음으로 넘어간다.

| 단계 | 제목 | 핵심 산출물 | 선행 |
|---|---|---|---|
| [phase1](phase1.md) | 렌더링 예산 확정 | `docs/render-budget.md`, `js/config.js` | - |
| [phase2](phase2.md) | 릴레이 서버 + 배포 인프라 | FastAPI WS 릴레이, HTTPS, Netlify | - |
| [phase3](phase3.md) | 공통 코어 (판정·통신·셸) | `motion.js`, `net.js`, 로비/캐릭터선택 | 1, 2 |
| [phase4](phase4.md) | 줄넘기 + 첫 실기 검증 | 첫 미니게임, 실기 플레이테스트 | 3 |
| [phase5](phase5.md) | 로프 클라이밍 + NPC | 스쿼트 판정, 러버밴딩, 결과 화면 | 4 |
| [phase6](phase6.md) | 해머 피하기 + 룰렛 | 레인 판정, 미니게임 선택/룰렛 | 5 |
| [phase7](phase7.md) | 블록깨기 | 조준 + 쳐올리기, 연출 | 6 |
| [phase8](phase8.md) | 레이싱 | 스캔라인 유사 3D | 7 |
| [phase9](phase9.md) | 세션 통합 · 마무리 | 총점 구조, 사운드, 안정화 | 8 |

**TV 성능 전제:** 조카 집 TV에서 30fps 안정 유지는 **가능한 것으로 판단하고 진행**한다. 성능 실측을 앞단의 차단 조건으로 두지 않는다. 전제 검증은 phase4 실기에서 게임과 함께 이뤄지며, 미달 시 `js/config.js` 상한을 낮추는 것으로 대응한다 (게임 로직은 손대지 않는다).

**phase4까지가 1차 목표.** phase6까지 끝나면 조카에게 보여주고 반응을 본 뒤 나머지를 만든다 (PROJECT.md §9).

## 진행 상태

| 단계 | 상태 |
|---|---|
| phase1 | 코드로 할 수 있는 것 끝. 남은 하나는 조카 집 TV에서 벤치를 돌리는 것뿐 |
| phase2 | **서버 코드 끝.** NAS·도메인·Netlify 계정 앞에서 할 일이 남았다 → `docs/deploy.md` |
| phase3 | 코드 끝. 남은 완료 기준 4개는 실제 폰 센서·진동이 있어야 확인된다 |
| phase4 | 줄넘기 끝. 남은 것은 전부 조카 집에서 → `docs/playtest-1.md` |
| phase5 | 로프 오르기 + NPC 러버밴딩 끝. 균형은 시뮬레이션까지만 확인 |
| phase6 | 해머 피하기 + 룰렛 끝. 3판 세션이 개발 PC에서 굴러간다 → `docs/playtest-2.md` |
| phase7 | 블록깨기 끝 |
| phase8 | 레이싱 끝. 도로 렌더러·코스 2개·NPC 경주. 남은 것은 전부 실기 → `docs/playtest-racing.md` |
| phase9 | 세션 통합 끝. 보드·총점·사운드·안정화. 남은 것은 전부 실기 → `docs/playtest-final.md` |

phase3을 phase2보다 먼저 만든 이유는 릴레이 서버를 기다리면 셸이 몇 주 멈추기 때문이다.
`?dev=1` 개발 배선(BroadcastChannel)으로 흐름을 먼저 세우고, 서버가 생긴 뒤 같은 코드를
진짜 WebSocket으로 다시 태워 확인했다. 배선은 배포본 흐름에 들어가지 않는다.

**phase6과 phase7 사이의 판단 지점은 아직 지나지 않았다.** PROJECT.md 9장과 phase6은
"3종을 조카에게 보여주고 반응을 본 뒤 나머지를 만든다"고 정해뒀는데, 방문 전에 phase7을
먼저 만들었다. 사용자 지시("phase7까지 이어서 진행해")에 따른 것이다.
`docs/playtest-2.md`를 채운 뒤 블록깨기를 손볼 여지가 그만큼 남아 있다.

**phase9를 phase8보다 먼저 했다.** 사용자 지시 — "나머지를 다 만들어 전체를 완성한 뒤
레이싱을 추가한다". 세션 구조(룰렛·보드·총점)는 게임 레지스트리 위에 얹혀 있어서
레이싱이 나중에 들어와도 `GP.games.register`만 하면 자동으로 낀다.
레이싱에 필요한 것은 `load`·`color`·`par` 세 값과 인터페이스 구현뿐이다.

## 지금 돌려볼 수 있는 것

```
python test/relay-test.py     릴레이 서버
node   test/motion-test.js    동작 판정
node   test/net-test.js       통신·보정
node   test/games-test.js     미니게임 5종 + 도로 렌더러 + NPC + 룰렛 + 보드 + 안정화 (277항목)

GP_STATIC=. python server/main.py
  → http://127.0.0.1:8000/dev/pair.html                     TV와 폰을 한 탭에 (?dev=1)
  → http://127.0.0.1:8000/tv/index.html?fps=1&game=hammer   게임 하나만 반복
  → http://127.0.0.1:8000/tools/road-bench_1.html           도로 렌더러만 (배포본은 /road)
```

`?game=<id>`를 주면 선택 화면을 건너뛰고 그 게임만 반복한다. 개발용이다.
`?keys=1`은 진짜 릴레이 서버를 쓰면서 키보드로 센서를 흉내낸다.

## 문서 규칙

- 각 phase는 `목표 / 산출물 / 작업 항목 / 완료 기준 / 검증 방법 / 리스크` 구조.
- 작업 항목 체크박스는 진행하며 갱신한다.
- PROJECT.md의 결정을 재논의하지 않는다. 바꿀 일이 생기면 PROJECT.md를 먼저 고친다.
