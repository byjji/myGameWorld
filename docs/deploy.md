# 배포 절차 (phase2)

릴레이 서버 코드와 배포 설정은 저장소에 들어 있다. 여기 적힌 것은 **사람이 계정과 기기 앞에서
해야 하는 일**이다. NAS 로그인, 도메인 구매, Netlify 연결은 코드로 대신할 수 없다.

구조는 PROJECT.md 1장 그대로다.

```
Netlify   정적 파일 (HTML/JS/이미지/사운드)   — 우리 집 업로드 대역을 쓰지 않는다
NAS       WebSocket 릴레이만                  — wss://relay.도메인
```

---

## 1. 릴레이 서버 (Synology NAS)

### 올릴 것

```
server/main.py
server/rooms.py
server/requirements.txt
server/Dockerfile
docker-compose.yml
```

### 기동

Container Manager → 프로젝트 → 생성 → 위 폴더를 지정하고 `docker-compose.yml`을 쓴다.
SSH가 편하면 그냥:

```sh
cd /volume1/docker/mygameworld
docker compose up -d --build
docker compose logs -f relay
```

확인:

```sh
curl http://127.0.0.1:8000/healthz
# {"rooms":0,"tvs":0,"players":0,"ok":true,"uptime":...}
```

### 재부팅 자동 시작

`docker-compose.yml`에 `restart: unless-stopped`가 들어 있다. Container Manager로 만든
프로젝트는 이 값을 그대로 쓴다. **NAS를 실제로 재부팅해 보고 확인한다** — 설정만 보고 넘어가면
정작 조카 집에 갔을 때 죽어 있다.

### 포트

컨테이너는 `127.0.0.1:8000`에만 열린다. 공유기에서 8000을 포트포워딩하지 않는다.
외부 노출은 443(리버스 프록시) 하나로 끝낸다.

---

## 2. 도메인과 인증서

### DDNS

Synology DSM → 제어판 → 외부 액세스 → DDNS.
`.synology.me` 무료 호스트네임이면 인증서까지 DSM이 알아서 처리한다.

짧은 주소를 따로 살 거면 도메인 하나를 사서 CNAME으로 DDNS 호스트를 가리킨다.
**리모컨으로 칠 주소이므로 짧을수록 좋다** (PROJECT.md 12장). TV 리모컨은 한 글자에 방향키 서너 번이다.

- TV가 칠 주소: 정적 사이트 루트. 예) `lp.kr` → 이 한 줄이 TV 화면을 연다
- 폰이 칠 주소: `lp.kr/p`
- 릴레이는 사람이 치지 않는다. 길어도 된다. 예) `relay.lp.kr`

### Let's Encrypt

DSM → 제어판 → 보안 → 인증서 → 추가 → Let's Encrypt.
도메인에 `relay.도메인`을 넣는다. 갱신은 DSM이 자동으로 한다 — **만료 60일 전에 도는지
한 번은 눈으로 확인한다.** 인증서가 만료되면 TV 브라우저는 조용히 연결을 거부한다.

### 리버스 프록시

DSM → 제어판 → 로그인 포털 → 고급 → 역방향 프록시.

| 항목 | 값 |
|---|---|
| 원본 | HTTPS / `relay.도메인` / 443 |
| 대상 | HTTP / `localhost` / 8000 |

**사용자 정의 헤더에 WebSocket을 반드시 추가한다.** (`Upgrade`, `Connection`)
이걸 빼면 HTTP는 되는데 WS만 안 되고, 증상이 "그냥 안 붙는다"라서 원인 찾기가 오래 걸린다.

프록시 타임아웃은 60초보다 길게 잡는다. 클라이언트가 25초마다 ping을 보내지만
(`js/net.js` PING_MS), 여유가 없으면 게임 중에 끊긴다.

---

## 3. 정적 파일 (Netlify)

저장소를 연결하면 `netlify.toml`이 알아서 읽힌다.

- 빌드 명령: `sh netlify-build.sh`
- 배포 디렉터리: `dist`

`netlify-build.sh`는 `js/ tv/ play/ tools/ assets/`만 복사한다.
`dev/`, `test/`, `server/`, 설계 문서는 공개 주소에 올라가지 않는다.

`assets/`는 지금 비어 있다. 그림을 넣으면 자동으로 배포에 들어간다 —
빌드 스크립트를 다시 고칠 일이 없다 (`assets/README.md`).

리다이렉트:

| 주소 | 내용 |
|---|---|
| `/` | TV 화면 |
| `/p` | 폰 컨트롤러 |
| `/echo` | 릴레이 연결·RTT 진단 |
| `/bench` | 렌더링 성능 측정 |

### 릴레이 주소 지정

정적 파일과 WebSocket이 다른 호스트에 있으므로 페이지에 릴레이 주소를 알려줘야 한다.
`js/net.js`의 `defaultUrl()`은 `?relay=`가 없으면 **현재 호스트**를 쓴다. 즉 Netlify에
그냥 올리면 `wss://내사이트`로 붙으려 해서 실패한다.

둘 중 하나를 한다.

1. 주소에 붙인다: `https://lp.kr/?relay=wss://relay.lp.kr`
   — 확실하지만 TV 리모컨으로 치기에 길다
2. `js/net.js`의 `defaultUrl()`에 기본 릴레이 호스트를 박는다
   — 도메인이 확정되면 이쪽으로 바꾼다. 도메인이 정해지기 전에는 1번으로 확인한다

---

## 4. 확인 순서

한 번에 다 켜고 "안 된다"를 만나면 원인을 가릴 수 없다. 아래 순서대로 하나씩 본다.

1. **NAS 안에서** `curl http://127.0.0.1:8000/healthz` → 200
2. **집 밖 폰에서** `https://relay.도메인/healthz` → 200 (프록시·인증서 확인)
3. **개발 PC 브라우저 두 개**로 `https://사이트/echo` 와 `/echo?role=play`
   → 왕복 카운터가 오르고 RTT가 찍힌다
4. **폰(LTE) + 개발 PC**로 같은 것 → 외부망 왕복 확인. RTT 30~50ms 범위인지 본다
5. **조카 집 TV 브라우저**로 `사이트/echo` → 여기가 제일 까다롭다.
   구형 TV 브라우저는 인증서 체인이나 TLS 버전에서 걸린다
6. `/echo`를 **30분 켜두고** 끊김 카운터가 0인지 본다 (프록시 idle timeout)
7. 폰을 Wi-Fi ↔ LTE로 전환 → 자동 재접속되는지 (`js/net.js` 백오프)

`/echo`는 통신만 떼어 본 페이지다. 게임이 안 될 때 이 페이지가 되면 통신은 무죄다.

---

## 5. 아직 정하지 않은 것

- 도메인 (PROJECT.md 12장). 정해지면 `js/net.js`의 릴레이 기본값을 바꾼다
- 릴레이 접근 제한. 지금은 누구나 붙을 수 있다. 코드 1296개짜리 방에
  모르는 사람이 들어올 확률은 낮고, 들어와도 얻을 것이 없다(센서값을 넘기고 버린다).
  문제가 생기면 그때 Origin 검사를 넣는다 — 미리 넣으면 TV 브라우저가 Origin을
  어떻게 보내는지 몰라 디버깅 대상만 는다
