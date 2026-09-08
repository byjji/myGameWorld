# 배포 절차

릴레이 서버 코드와 배포 설정은 저장소에 들어 있다. 여기 적힌 것은 **사람이 계정과 기기 앞에서
해야 하는 일**과, 실제로 배포하면서 막혔던 지점들이다.

구조는 PROJECT.md 1장 그대로다.

```
Netlify   정적 파일 (HTML/JS/이미지/사운드)   — 우리 집 업로드 대역을 쓰지 않는다
NAS       WebSocket 릴레이만                  — wss://relay.ji-fam.synology.me:8443
```

---

## 0. 지금 구성

한 번 세워둔 값이다. 여기서 벗어나면 아래 절차가 안 맞는다.

| 항목 | 값 | 어디에 적혀 있나 |
|---|---|---|
| 정적 사이트 | `https://mygameworld.netlify.app` | Netlify, GitHub `byjji/myGameWorld` 연결 |
| 릴레이 | `wss://relay.ji-fam.synology.me:8443` | `js/net.js`의 `RELAY` |
| 외부 개방 포트 | 8443 하나 | 공유기 포트포워딩 |
| NAS 컨테이너 | `127.0.0.1:8181` → 컨테이너 `8000` | `docker-compose.yml` |
| 프로젝트 경로 | `/volume1/docker/mygameworld` | |
| 컨테이너 이름 | `mygameworld-relay` | |

### 8443을 DSM과 나눠 쓴다

외부에 열린 포트가 8443 하나뿐이라 릴레이도 그 위에 얹었다. **포트를 뺏은 게 아니라
호스트 이름으로 한 겹 더 나눈 것이다.** nginx가 `server_name`으로 갈라준다.

```
dms.ji-fam.synology.me          → DSM 관리 화면
relay.ji-fam.synology.me:8443   → 릴레이 컨테이너
```

역방향 프록시 항목 여러 개가 같은 포트를 공유할 수 있다. 새 포트를 여는 건 마지막 수단이다.

`ji-fam.synology.me:8443`으로 들어가면 **404가 정상이다.** 그 이름은 8443에
등록돼 있지 않다. nginx 설정에 `if ($host !~ ...) { return 404; }`가 들어 있어서
등록 안 된 이름은 DSM 404 페이지로 떨어진다. 고장이 아니다.

---

## 1. 릴레이 서버 (Synology NAS)

### 올릴 것 — 5개뿐

```
/volume1/docker/mygameworld/
├── docker-compose.yml
└── server/
    ├── Dockerfile
    ├── main.py
    ├── rooms.py
    └── requirements.txt
```

`server/__pycache__/`는 빼고 올린다. 정적 파일은 NAS에 올리지 않는다 — Netlify 몫이다.

```powershell
scp -r <로컬 묶음 경로> <사용자>@<NAS 내부 IP>:/volume1/docker/
```

### Container Manager 말고 SSH를 쓴다

CLI로 만든 컨테이너를 Container Manager 화면에서 멈추려 하면 **"undefined이 없습니다"**가
뜬다. UI의 프로젝트 목록에 등록이 안 돼 있어서 참조가 `undefined`가 되는 것이다.
Docker가 낸 에러가 아니다 — Docker라면 실제 이름을 찍는다.

전 과정을 SSH로 다룬다.

```sh
cd /volume1/docker/mygameworld
sudo docker compose up -d --build      # 첫 빌드는 python:3.12-slim 받느라 몇 분
sudo docker compose logs --tail 30 relay
```

로그에 `Uvicorn running on http://0.0.0.0:8000`이 뜨는 게 **정상이다.**
그건 컨테이너 안쪽 얘기고, 밖은 8181이다.

```sh
sudo docker ps --format '{{.Names}}\t{{.Ports}}'
# mygameworld-relay   127.0.0.1:8181->8000/tcp
```

### 포트를 바꿔야 하면

`docker-compose.yml`의 `ports`에서 **앞 숫자만** 바꾼다.

```yaml
ports:
  - "127.0.0.1:8181:8000"
#               ^^^^ 여기만. 뒤 8000은 Dockerfile CMD에 박혀 있어 바꾸면 죽는다
```

바꿨으면 역방향 프록시 대상 포트도 같은 숫자로 맞춘다.

`127.0.0.1`에만 연다. `0.0.0.0`으로 열면 인증서 없는 평문 ws가 공유기 포트포워딩
실수 한 번에 밖으로 샌다.

### 다루기

```sh
sudo docker compose stop      # 멈추기만
sudo docker compose start
sudo docker compose restart
sudo docker compose logs -f
sudo docker compose down      # 컨테이너·네트워크 삭제. 릴레이는 볼륨이 없어 잃을 것 없음
```

`down -v`는 쓰지 않는다. 다른 프로젝트에서 습관이 되면 위험하다.

### 재부팅 자동 시작

`restart: unless-stopped`가 들어 있다. `always`가 아닌 이유는 사람이 일부러 멈춰둔
컨테이너를 재부팅이 되살리지 않게 하기 위함이다.

**재부팅 시험은 일부러 건너뛰었다.** NAS에 다른 것들이 같이 돌고 있어 확인 하나 때문에
전체를 내리는 비용이 크다고 봤다. 정전이나 DSM 업데이트로 재부팅이 걸리는 날 자연히
확인된다.

대신 조카 집에 가기 전에 한 줄만 본다.

```sh
curl http://127.0.0.1:8181/healthz
```

죽어 있으면 `sudo docker compose up -d` 한 번이면 되므로, 미리 확인하지 않은 대가는
그 자리에서 갚을 수 있는 크기다.

---

## 2. DNS와 인증서

### 서브도메인은 그냥 풀린다

Synology DDNS는 와일드카드를 준다. `relay.ji-fam.synology.me`를 따로 등록할 필요가 없다.

```sh
nslookup relay.ji-fam.synology.me     # DDNS 호스트와 같은 IP가 나온다
```

### 와일드카드 인증서는 한 단계만 덮는다

발급된 인증서는 `CN=ji-fam.synology.me`, SAN에 `*.ji-fam.synology.me`.

| 주소 | 덮이나 |
|---|---|
| `relay.ji-fam.synology.me` | 덮인다 |
| `mygameworld-relay.ji-fam.synology.me` | 덮인다 |
| `relay.mygameworld.ji-fam.synology.me` | **안 덮인다** — 점이 하나 더 |

점을 하나 더 넣는 순간 인증서가 안 맞고, TV 브라우저는 조용히 연결을 거부한다.
릴레이 이름은 한 단계로 유지한다.

갱신은 DSM이 자동으로 한다. **만료 60일 전에 도는지 한 번은 눈으로 확인한다.**

---

## 3. 역방향 프록시

DSM → 제어판 → 로그인 포털 → 고급 → 역방향 프록시 → **생성** (기존 항목 수정 아님)

| 항목 | 값 |
|---|---|
| 원본 프로토콜 | HTTPS |
| 원본 호스트 이름 | `relay.ji-fam.synology.me` |
| 원본 포트 | 8443 |
| 대상 프로토콜 | HTTP |
| 대상 호스트 이름 | **`127.0.0.1`** |
| 대상 포트 | 8181 |

여기서 세 가지를 반드시 한다. 하나라도 빠지면 증상이 전부 "그냥 안 된다"라서 구분이 안 된다.

### (가) 대상은 `localhost`가 아니라 `127.0.0.1`

`localhost`는 IPv6 `::1`로 먼저 풀린다. 컨테이너는 `127.0.0.1:8181`에만 묶여 있어
IPv4 전용이다. nginx가 `[::1]:8181`을 두드리고 아무도 없어서 **502**가 난다.

의심되면 NAS에서 셋을 비교한다.

```sh
curl -s -o /dev/null -w "127.0.0.1 %{http_code}\n" http://127.0.0.1:8181/healthz
curl -s -o /dev/null -w "localhost %{http_code}\n" http://localhost:8181/healthz
curl -s -o /dev/null -w "::1       %{http_code}\n" "http://[::1]:8181/healthz"
```

### (나) 사용자 정의 헤더 → WebSocket

`사용자 정의 헤더` 탭에서 **WebSocket 버튼**을 누른다. `Upgrade`·`Connection` 두 줄이 들어간다.

이걸 빼면 `/healthz`는 200이 나오는데 게임만 안 붙는다. HTTP는 되고 WS만 죽으므로
"통신은 되는 것 같은데"에서 한참 헤맨다.

### (다) 연결 설정 → 타임아웃

세 값을 모두 **300초**로 둔다 — 연결 시간제한, 보내기 시간제한, 읽기 시간제한.
기본값 60초는 빠듯하다.

클라이언트가 25초마다 ping을 보내므로(`js/net.js` `PING_MS`) 60초로도 대개 버틴다.
문제는 여유가 없다는 것이다. 폰이 잠기거나 전파가 잠깐 나빠져 ping 한 번을 놓치면
바로 한계에 닿는다. 300초면 ping을 열 번 넘게 놓쳐도 살아 있다.

증상이 "게임 중에 갑자기 끊긴다"라서 재현이 어렵다. 미리 넉넉히 잡아두는 편이 싸다.

**적용됐는지 확인하는 법.** ping을 보내지 않는 생 WebSocket을 하나 열고 놀린다.
앱 소켓은 25초마다 ping을 보내 이 값을 시험하지 못한다. 브라우저 콘솔에서:

```js
ws = new WebSocket('wss://relay.ji-fam.synology.me:8443/ws/9999?role=tv');
ws.onclose = e => console.log('끊김', e.code, Math.round(performance.now()/1000) + '초');
```

60초를 넘겨도 `ws.readyState === 1`이면 기본값을 벗어난 것이다.
확인 후 `ws.close()`. **170초까지 무통신 생존 확인함.**

### 고친 뒤 nginx를 다시 읽힌다

**설정을 고쳐도 돌고 있는 nginx는 옛 것을 쥐고 있을 수 있다.**
`nginx -T`는 파일을 다시 파싱해 보여주는 것이라, 설정이 맞는데도 502가 계속 나면
이걸 의심한다. 실제로 이번 배포에서 502의 진짜 원인이었다.

```sh
sudo synosystemctl restart nginx
```

### 설정 확인

```sh
sudo nginx -T 2>/dev/null | grep -A 80 "server_name relay.ji-fam.synology.me" \
  | grep -E "proxy_pass|Upgrade|Connection"
```

기대:
```
proxy_set_header Upgrade    $http_upgrade;
proxy_set_header Connection $connection_upgrade;
proxy_pass http://127.0.0.1:8181;
```

실패했을 때 볼 곳:
```sh
sudo tail -20 /var/log/nginx/error.log
```
`upstream:` 뒤에 찍힌 주소가 실제로 두드리는 곳이다. 거기가 8000이면 옛 설정으로 돌고 있는 것.

---

## 4. 정적 파일 (Netlify)

저장소를 연결하면 `netlify.toml`이 알아서 읽힌다. Netlify 화면에서 빌드 설정을 고칠 일이 없다 —
저장소 파일이 기준이다.

- 빌드 명령: `sh netlify-build.sh`
- 배포 디렉터리: `dist`

`netlify-build.sh`는 `js/ tv/ play/ tools/ assets/`만 복사한다.
`dev/`, `test/`, `server/`, 설계 문서는 공개 주소에 올라가지 않는다.

| 주소 | 내용 |
|---|---|
| `/` | TV 화면 |
| `/p` | 폰 컨트롤러 |
| `/echo` | 릴레이 연결·RTT 진단 |
| `/bench` | 렌더링 성능 측정 |

### 릴레이 주소는 코드에 박혀 있다

`js/net.js` 위쪽:

```js
var RELAY = 'wss://relay.ji-fam.synology.me:8443';
```

릴레이를 옮기면 **이 한 줄만** 고친다.

`defaultUrl()`의 순서:

1. `?relay=wss://...` 가 있으면 그것. 다른 릴레이를 시험할 때 쓴다
2. 로컬(`localhost`·사설 IP 대역)에서 열었으면 현재 호스트
3. 그 외에는 `RELAY`

예전에는 3번이 "현재 호스트"였다. 그래서 Netlify에 올리면 `wss://mygameworld.netlify.app`로
붙으려 해서 반드시 실패했다. TV 리모컨으로 `?relay=`를 칠 수는 없으므로 박아두는 게 맞다.

### 시험용 질의 문자열

| 플래그 | 하는 일 |
|---|---|
| `?relay=wss://...` | 릴레이 주소 덮어쓰기 |
| `?dev=1` | **가짜 릴레이**(BroadcastChannel) + 키보드 센서. 서버 없이 흐름만 볼 때 |
| `?keys=1` | 키보드 센서만. **릴레이는 진짜.** 실기 없이 배포본을 시험할 때 이쪽 |
| `?fps=1` | TV에 프레임 계기 표시 |
| `?game=<id>` | 룰렛 건너뛰고 그 게임으로 |
| `?tune=SPIKE_ON:10` | 판정 임계값 현장 덮어쓰기 (`docs/adult-guide.md`) |

`?dev=1`과 `?keys=1`을 헷갈리면 안 된다. 릴레이를 시험하는 중에 `?dev=1`을 쓰면
BroadcastChannel로 도느라 릴레이를 아예 안 탄다.

`dev/pair.html`은 TV와 폰을 한 탭에 iframe으로 띄운다. 두 탭으로 열면 배경 탭의
`requestAnimationFrame`이 늦춰져 흐름을 볼 수 없다. 배포본에는 안 들어간다.

---

## 5. 확인 순서

한 번에 다 켜고 "안 된다"를 만나면 원인을 가릴 수 없다. **앞 단계가 실패하면 다음으로 넘어가지 않는다.**

1. **NAS 안에서** `curl http://127.0.0.1:8181/healthz` → 200
   ```json
   {"rooms":0,"tvs":0,"players":0,"ok":true,"uptime":...}
   ```
2. **밖에서**(폰 LTE) `https://relay.ji-fam.synology.me:8443/healthz` → 200
   프록시·인증서까지 통과한 것

3. **WebSocket 업그레이드** — HTTP가 된다고 WS가 되는 게 아니다
   ```sh
   curl -si -H "Connection: Upgrade" -H "Upgrade: websocket" \
        -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
        "https://relay.ji-fam.synology.me:8443/ws/1234?role=play" | head -3
   ```
   `HTTP/1.1 101 Switching Protocols`가 나와야 한다. 이어서 없는 방이므로
   `{"t":"err","msg":"그런 방이 없어요"}`가 오면 앱 로직까지 산 것이다

4. **브라우저 두 개**로 `/echo`와 `/echo?role=play` → 왕복 카운터·RTT
5. **폰(LTE) + PC**로 같은 것 → RTT 30~50ms 범위인지
6. **조카 집 TV 브라우저**로 `/echo` → 제일 까다롭다. 구형 TV는 인증서 체인이나 TLS 버전에서 걸린다
7. `/echo`를 **30분 켜두고** 끊김 카운터가 0인지 (프록시 idle timeout)
8. 폰을 Wi-Fi ↔ LTE 전환 → 자동 재접속되는지 (`js/net.js` 백오프)

`/echo`는 통신만 떼어 본 페이지다. 게임이 안 될 때 이 페이지가 되면 통신은 무죄다.

### 증상별

| 증상 | 원인 | 볼 곳 |
|---|---|---|
| 인증서 경고 | 이름이 인증서에 없음 | 2장. 점이 하나 더 붙지 않았는지 |
| 404 (DSM 페이지) | 그 포트에 그 호스트 이름이 등록 안 됨 | 0장. 오타 아니면 정상 동작 |
| 502 | 프록시가 뒤쪽에 못 붙음 | 3장 (가). `localhost` → `127.0.0.1`, nginx 재적용 |
| `/healthz`는 200인데 게임만 안 붙음 | WebSocket 헤더 누락 | 3장 (나) |
| 게임 중 끊김 | 프록시 타임아웃 | 3장 (다) |

---

## 6. 아직 안 한 것

- **폰 실기 판정.** 임계값(`SPIKE_ON`, `SQUAT_DOWN_DEG` 등)은 전부 합성 파형으로만 맞춘
  추측이다. 실제 폰을 한 번 태우면 크게 흔들릴 수 있다. 현장에서 `?tune=`으로 덮어쓴다
- **TV 브라우저.** 우리 집 TV로 먼저 본다. 조카 집 TV는 현장에서 처음 켜게 된다 —
  기종이 다르면 인증서 체인이나 TLS 버전에서 갈릴 수 있다. 우리 집 TV가 되면
  "웹앱이 도는 TV에서는 된다"까지가 확인되는 것이고, 조카 집 기종은 여전히 미지수다.
  현장에서 막히면 볼 것은 `/echo` 한 페이지다 — 거기가 되면 통신은 무죄다
- **릴레이 접근 제한.** 지금은 누구나 붙을 수 있다. 릴레이 주소가 공개 저장소의
  `js/net.js`에 박혀 있으니 주소는 이미 공개된 셈이다. 다만 코드 1296개짜리 방에
  모르는 사람이 들어올 확률은 낮고, 들어와도 얻을 것이 없다 — 센서값을 넘기고 버린다.
  문제가 생기면 그때 Origin 검사를 넣는다. 미리 넣으면 TV 브라우저가 Origin을
  어떻게 보내는지 몰라 디버깅 대상만 는다
- **짧은 도메인.** TV 리모컨은 한 글자에 방향키 서너 번이다 (PROJECT.md 12장).
  사면 CNAME으로 DDNS를 가리키고 `js/net.js`의 `RELAY`를 바꾼다.
  릴레이 주소는 사람이 안 치므로 길어도 된다 — 짧게 만들 것은 TV가 칠 정적 사이트 주소다
