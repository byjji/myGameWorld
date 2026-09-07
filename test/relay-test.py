"""
릴레이 서버 시험.

  python test/relay-test.py

1~3부는 server/rooms.py의 순수 로직이다. 소켓을 띄우지 않고, 시계와 난수를 주입해
결정적으로 돈다 — 타임아웃 60초를 기다리지 않고 시계를 앞으로 감는다.
4부만 실제로 uvicorn을 띄우고 websockets 클라이언트로 붙는다.

4부는 phase2 완료 기준의 "메시지가 왕복한다"를 로컬에서 확인하는 데까지만 쓴다.
외부망·TV 브라우저·wss 인증서는 실기에서만 확인되며 여기서 통과했다고 그것이 통과한 것은 아니다.
"""

import asyncio
import json
import os
import socket
import sys
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "server"))

# 윈도우 콘솔 기본 코드페이지(cp949)는 한글 일부와 em dash를 못 찍고 죽는다.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import rooms  # noqa: E402
from rooms import Hub, Outbox  # noqa: E402

fails = []


def ok(name, cond):
    if cond:
        print("PASS " + name)
    else:
        print("FAIL " + name)
        fails.append(name)


def eq(name, got, want):
    if got == want:
        print("PASS " + name)
    else:
        print("FAIL " + name)
        print("       기대: %r" % (want,))
        print("       실제: %r" % (got,))
        fails.append(name)


class Clock:
    """주입용 가짜 시계. 타임아웃을 기다리지 않고 앞으로 감는다."""

    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t

    def advance(self, sec):
        self.t += sec


class ScriptRng:
    """정해진 문자를 순서대로 내주는 난수 대역. 코드 충돌을 일부러 만든다."""

    def __init__(self, seq):
        self.seq = list(seq)
        self.i = 0

    def choice(self, _pool):
        c = self.seq[self.i % len(self.seq)]
        self.i += 1
        return c


def drain(conn):
    return conn.outbox.drain()


def types(msgs):
    return [m["t"] for m in msgs]


# ─────────────────────────────────────────────────────────
# 1부 — 방 규칙
# ─────────────────────────────────────────────────────────

def test_rooms():
    print("\n[1부] 방 규칙")

    # 코드 문자 제한 (PROJECT.md 7장)
    h = Hub(now=Clock())
    codes = [h.new_code() for _ in range(200)]
    ok("코드는 2,3,4,5,8,9만 쓴다",
       all(len(c) == 4 and all(ch in "234589" for ch in c) for c in codes))
    ok("0/6/1/7은 코드에 없다", not any(ch in "0617" for c in codes for ch in c))

    # 중복 코드 회피
    h = Hub(now=Clock(), rng=ScriptRng("2345" "2345" "8888"))
    tv1, _ = h.attach("new", "tv")
    tv2, _ = h.attach("new", "tv")
    eq("첫 방 코드", tv1.code, "2345")
    eq("겹치면 다시 뽑는다", tv2.code, "8888")

    # TV 접속 = 방 생성 + room 통지
    h = Hub(now=Clock(), rng=ScriptRng("2345"))
    tv, err = h.attach("new", "tv")
    eq("TV 접속은 거절되지 않는다", err, None)
    eq("TV에 방 코드를 알린다", drain(tv), [{"t": "room", "code": "2345"}])

    # create는 방을 새로 만들지 않는다
    h.dispatch(tv, {"t": "create"})
    eq("create는 같은 코드를 다시 알려준다", drain(tv), [{"t": "room", "code": "2345"}])
    eq("방은 하나뿐", len(h.rooms), 1)

    # 폰 입장
    p1, err = h.attach("2345", "play")
    eq("폰 입장 성공", err, None)
    eq("첫 폰은 p1", p1.pid, "p1")
    eq("폰에게 자리를 알려준다", drain(p1), [{"t": "you", "pid": "p1"}])
    p2, _ = h.attach("2345", "play")
    eq("둘째 폰은 p2", p2.pid, "p2")
    drain(p2)

    # 없는 코드 거부
    none, err = h.attach("8888", "play")
    ok("없는 코드는 거부", none is None)
    eq("거부 사유를 준다", err, "그런 방이 없어요")
    none, err = h.attach("0000", "play")
    ok("코드 문자가 틀려도 거부", none is None and err is not None)

    # 폰 → TV 릴레이 + from 스탬프
    drain(tv)
    h.dispatch(p1, {"t": "join", "name": "조카", "char": "lhat"})
    got = drain(tv)
    eq("폰 메시지는 TV로 간다", len(got), 1)
    eq("서버가 보낸 사람을 찍는다", got[0].get("from"), "p1")
    eq("페이로드는 건드리지 않는다", got[0].get("name"), "조카")

    # from 스푸핑 차단
    h.dispatch(p2, {"t": "ready", "from": "p1"})
    eq("폰이 붙인 from은 덮어쓴다", drain(tv)[0]["from"], "p2")

    # 서버는 모르는 필드도 그대로 넘긴다
    h.dispatch(p1, {"t": "몰라도되는것", "x": {"deep": [1, 2, 3]}})
    eq("해석하지 않고 통과시킨다", drain(tv)[0]["x"], {"deep": [1, 2, 3]})

    # TV → 전체 폰 브로드캐스트
    h.dispatch(tv, {"t": "phase", "v": "play", "game": "rope"})
    a, b = drain(p1), drain(p2)
    eq("TV는 폰 전체에 뿌린다", (types(a), types(b)), (["phase"], ["phase"]))
    eq("브로드캐스트에는 from을 찍지 않는다", "from" in a[0], False)

    # ping은 릴레이하지 않는다
    h.dispatch(p1, {"t": "ping", "id": 7})
    eq("ping은 TV로 가지 않는다", drain(tv), [])
    eq("ping에는 pong으로 답한다", drain(p1), [{"t": "pong", "id": 7}])

    # 방 정원
    h.attach("2345", "play")
    h.attach("2345", "play")
    full, err = h.attach("2345", "play")
    ok("정원을 넘으면 거부", full is None)
    eq("정원 초과 사유", err, "방이 가득 찼어요")

    # 폰 이탈 → TV에 leave
    drain(tv)
    h.detach(p2)
    eq("폰이 나가면 TV에 알린다", drain(tv), [{"t": "leave", "from": "p2"}])
    p_new, _ = h.attach("2345", "play")
    eq("빈 자리를 다시 쓴다", p_new.pid, "p2")

    # 깨진 메시지
    h.dispatch(p1, {"nope": 1})
    h.dispatch(p1, {"t": ""})
    h.dispatch(p1, "문자열")
    eq("t 없는 메시지는 버린다", drain(tv), [])


def test_reconnect_and_sweep():
    print("\n[2부] 재접속과 정리")

    # TV 재접속 시 코드 유지 — 폰이 이미 보고 있는 숫자가 바뀌면 안 된다
    clk = Clock()
    h = Hub(now=clk, rng=ScriptRng("2345" "8888"))
    tv, _ = h.attach("new", "tv")
    p1, _ = h.attach("2345", "play")
    drain(p1)                      # 자리 통지(you)를 비우고 시작한다
    h.detach(tv)
    tv2, _ = h.attach("2345", "tv")
    eq("TV가 재접속해도 코드가 같다", tv2.code, "2345")
    eq("재접속한 TV도 코드를 받는다", drain(tv2), [{"t": "room", "code": "2345"}])
    h.dispatch(p1, {"t": "motion", "a": "jump", "p": 0.8})
    eq("재접속한 TV로 릴레이된다", types(drain(tv2)), ["motion"])

    # TV 자리 뺏기
    tv3, _ = h.attach("2345", "tv")
    eq("이전 TV는 사유를 듣고 끊긴다", types(drain(tv2)), ["err"])
    eq("방의 TV는 새 쪽", h.rooms["2345"].tv is tv3, True)

    # TV 이탈 유예 — 바로 정리하지 않는다
    h.detach(tv3)
    eq("유예 중에는 방이 살아 있다", h.sweep(), [])
    ok("방이 아직 있다", "2345" in h.rooms)
    clk.advance(rooms.TV_GRACE_SEC + 1)
    closing = h.sweep()
    eq("유예가 지나면 남은 폰을 끊는다", [c.pid for c in closing], ["p1"])
    eq("끊기 전에 사유를 준다", types(drain(p1)), ["err"])
    ok("방이 정리됐다", "2345" not in h.rooms)

    # 빈 방 타임아웃
    clk = Clock()
    h = Hub(now=clk, rng=ScriptRng("2222"))
    tv, _ = h.attach("new", "tv")
    h.detach(tv)
    clk.advance(rooms.EMPTY_ROOM_TTL_SEC + 1)
    h.sweep()
    eq("빈 방은 사라진다", len(h.rooms), 0)
    eq("정리 후 통계", h.stats(), {"rooms": 0, "tvs": 0, "players": 0})


def test_backpressure():
    print("\n[3부] 백프레셔")

    # tilt는 최신값만 남는다 — 25Hz가 계속 들어와도 큐가 자라면 안 된다
    ob = Outbox()
    for i in range(1000):
        ob.put({"t": "tilt", "v": i / 1000.0, "from": "p1"})
    eq("tilt는 하나로 뭉친다", len(ob), 1)
    eq("남는 것은 마지막 값", ob.drain()[0]["v"], 0.999)

    # 플레이어별로 따로 뭉친다. 남의 기울기를 덮어쓰면 안 된다
    ob = Outbox()
    ob.put({"t": "tilt", "v": 0.1, "from": "p1"})
    ob.put({"t": "tilt", "v": 0.2, "from": "p2"})
    ob.put({"t": "tilt", "v": 0.3, "from": "p1"})
    got = ob.drain()
    eq("기울기는 폰별로 유지된다",
       sorted((m["from"], m["v"]) for m in got),
       [("p1", 0.3), ("p2", 0.2)])

    # state도 스냅샷이라 덮어쓴다
    ob = Outbox()
    for i in range(50):
        ob.put({"t": "state", "v": {"n": i}})
    eq("state는 최신 하나만", [m["v"]["n"] for m in ob.drain()], [49])

    # 사건 메시지는 절대 뭉치지 않는다
    ob = Outbox()
    for i in range(5):
        ob.put({"t": "motion", "a": "jump", "p": i / 10.0})
    eq("motion은 전부 남는다", len(ob.drain()), 5)

    # 상한을 넘으면 오래된 것부터 버린다. 쓰는 쪽은 막히지 않는다
    ob = Outbox(limit=4)
    for i in range(10):
        ob.put({"t": "motion", "n": i})
    got = [m["n"] for m in ob.drain()]
    eq("상한을 지킨다", len(got), 4)
    eq("최근 것이 남는다", got, [6, 7, 8, 9])
    eq("버린 개수를 센다", ob.dropped, 6)

    # 실제 방에서 tilt 폭주 — TV 큐가 자라지 않아야 한다
    h = Hub(now=Clock(), rng=ScriptRng("2345"))
    tv, _ = h.attach("new", "tv")
    drain(tv)
    p1, _ = h.attach("2345", "play")
    for i in range(2000):
        h.dispatch(p1, {"t": "tilt", "v": 0.5})
    eq("느린 TV 앞에서도 큐가 자라지 않는다", len(tv.outbox), 1)
    eq("버린 것 없음", tv.outbox.dropped, 0)


# ─────────────────────────────────────────────────────────
# 4부 — 실제 WebSocket 왕복
# ─────────────────────────────────────────────────────────

def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def start_server(port):
    import uvicorn
    import main

    # 서버는 방 상태를 모듈 전역에 들고 있다. 시험마다 새로 시작한다.
    main.hub = Hub()

    cfg = uvicorn.Config(main.app, host="127.0.0.1", port=port,
                         log_level="warning", ws="websockets")
    server = uvicorn.Server(cfg)
    server.install_signal_handlers = lambda: None   # 메인 스레드가 아니면 시그널을 못 건다
    th = threading.Thread(target=server.run, daemon=True)
    th.start()

    for _ in range(200):
        if server.started:
            return server
        time.sleep(0.05)
    raise RuntimeError("서버가 뜨지 않았다")


async def recv_json(ws, timeout=3.0):
    raw = await asyncio.wait_for(ws.recv(), timeout)
    return json.loads(raw)


async def send_json(ws, obj):
    await ws.send(json.dumps(obj, ensure_ascii=False))


async def e2e(port):
    import websockets

    base = "ws://127.0.0.1:%d/ws/" % port

    async with websockets.connect(base + "new?role=tv") as tv:
        m = await recv_json(tv)
        eq("실접속: TV가 방 코드를 받는다", m["t"], "room")
        code = m["code"]
        ok("실접속: 코드가 규칙에 맞는다",
           len(code) == 4 and all(c in "234589" for c in code))

        # 없는 코드로 붙으면 거절당한다
        bad = "".join("8" if c != "8" else "9" for c in code)
        async with websockets.connect(base + bad + "?role=play") as ph:
            m = await recv_json(ph)
            eq("실접속: 없는 코드는 err", m["t"], "err")

        async with websockets.connect(base + code + "?role=play") as ph:
            m = await recv_json(ph)
            eq("실접속: 폰이 자기 자리를 받는다", (m["t"], m["pid"]), ("you", "p1"))

            await send_json(ph, {"t": "hello"})
            m = await recv_json(tv)
            eq("실접속: hello가 TV에 닿는다", (m["t"], m["from"]), ("hello", "p1"))

            await send_json(tv, {"t": "phase", "v": "char", "game": None})
            m = await recv_json(ph)
            eq("실접속: phase가 폰에 닿는다", (m["t"], m["v"]), ("phase", "char"))

            await send_json(ph, {"t": "join", "name": "조카", "char": "lhat"})
            m = await recv_json(tv)
            eq("실접속: 한글이 깨지지 않는다", m["name"], "조카")

            # 왕복 지연. 로컬이라 목표(30~50ms)와 비교할 값은 아니지만,
            # 측정 경로 자체가 도는지는 여기서 확인한다.
            rtts = []
            for i in range(20):
                t0 = time.perf_counter()
                await send_json(ph, {"t": "ping", "id": i})
                m = await recv_json(ph)
                rtts.append((time.perf_counter() - t0) * 1000)
                if m["t"] != "pong" or m["id"] != i:
                    fails.append("ping id 불일치")
            rtts.sort()
            print("     로컬 RTT 중앙값 %.1fms (최대 %.1fms) — 실측은 실기에서"
                  % (rtts[len(rtts) // 2], rtts[-1]))
            ok("실접속: ping/pong 왕복", len(rtts) == 20)

        # 폰이 끊기면 TV가 안다
        m = await recv_json(tv)
        eq("실접속: 폰 이탈을 TV에 알린다", (m["t"], m["from"]), ("leave", "p1"))


def test_live():
    print("\n[4부] 실제 WebSocket")
    port = free_port()
    server = start_server(port)
    try:
        import urllib.request
        with urllib.request.urlopen("http://127.0.0.1:%d/healthz" % port, timeout=3) as r:
            body = json.loads(r.read().decode())
        eq("헬스체크 200", r.status, 200)
        ok("헬스체크가 방 수를 알려준다", body.get("ok") is True and "rooms" in body)

        asyncio.run(e2e(port))
    finally:
        server.should_exit = True
        time.sleep(0.3)


if __name__ == "__main__":
    test_rooms()
    test_reconnect_and_sweep()
    test_backpressure()
    test_live()

    print()
    if fails:
        print("실패 %d개: %s" % (len(fails), ", ".join(fails)))
        sys.exit(1)
    print("전체 통과")
