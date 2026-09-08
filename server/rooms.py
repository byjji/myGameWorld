"""
Game-Party 릴레이 방 관리 — 순수 로직

여기에는 asyncio도 FastAPI도 없다. 소켓을 모르는 상태 기계다.
이유: 통신 계층의 실제 검증은 phase4(실기)에서야 끝나는데, 그때까지 방 규칙이
맞는지 확인할 방법이 없으면 곤란하다. 순수 로직으로 떼어두면 서버를 띄우지 않고
`python test/relay-test.py`로 규칙을 전부 돌려볼 수 있다.

서버는 게임 로직을 갖지 않는다 (PROJECT.md 8장).
페이로드를 해석하는 곳은 딱 세 군데뿐이다.

  - `t == "ping"`   : 릴레이하지 않고 pong으로 답한다 (프록시 idle timeout 방지 + RTT 측정)
  - `t == "create"` : TV에게 방 코드를 다시 알려준다
  - `from`          : 폰이 보낸 메시지에 서버가 플레이어 id를 찍는다

그 외에는 무엇이 들어오든 뜯어보지 않고 그대로 넘긴다.
"""

import random
import time

# 코드 문자는 2,3,4,5,8,9만 쓴다. 0과 6, 1과 7은 5세에게 비슷하게 보인다 (PROJECT.md 7장).
CODE_DIGITS = "234589"
CODE_LEN = 4

# 한 방에 붙을 수 있는 폰 개수. p1..p4.
MAX_PLAYERS = 4

# 연결 하나가 들고 있을 송신 버퍼 상한.
# tilt는 25Hz(js/tuning.js TILT_SEND_HZ)로 들어오므로 64면 2초 분량이다.
# 이보다 밀렸다면 이미 게임이 성립하지 않는 상태이고, 쌓아두는 것은 지연만 늘린다.
OUTBOX_MAX = 64

# TV가 끊긴 뒤 방을 유지하는 시간(초).
# 즉시 정리하지 않는 이유: net.js의 재접속 백오프가 최대 8초이고,
# TV가 잠깐 끊겼다고 방 코드가 바뀌면 조카가 4자리를 다시 입력해야 한다.
TV_GRACE_SEC = 60.0

# TV도 폰도 없는 방을 들고 있는 시간(초). 메모리 누수 방지.
EMPTY_ROOM_TTL_SEC = 60.0

# 방 코드 발급 재시도 횟수. 6^4 = 1296개 중에서 뽑으므로 충돌은 드물다.
CODE_TRIES = 40


def coalesce_key(msg):
    """
    최신값만 의미가 있어 덮어써도 되는 메시지인가.

    tilt는 연속값이고 state는 스냅샷이다. 밀렸을 때 예전 값을 굳이 보내면
    받는 쪽이 과거를 재생하게 된다. 반대로 motion/join/ready/leave는 사건이라
    하나라도 빠지면 안 된다 — 절대 덮어쓰지 않는다.
    """
    t = msg.get("t")
    if t == "tilt":
        return ("tilt", msg.get("from"))
    if t == "state":
        return ("state",)
    return None


class Outbox:
    """
    연결 하나의 송신 버퍼.

    느린 수신자(구형 TV 브라우저, LTE 폰) 하나 때문에 서버 전체가 멈추지 않게 한다.
    쓰는 쪽은 절대 막히지 않는다. 넘치면 버린다.
    """

    def __init__(self, limit=OUTBOX_MAX):
        self.limit = limit
        self._q = []          # [(coalesce_key | None, msg)]
        self.coalesced = 0    # 덮어쓴 횟수 (진단용)
        self.dropped = 0      # 버린 횟수 (진단용)

    def put(self, msg):
        key = coalesce_key(msg)
        if key is not None:
            for i in range(len(self._q)):
                if self._q[i][0] == key:
                    self._q[i] = (key, msg)   # 최신값으로 덮어쓴다
                    self.coalesced += 1
                    return
        self._q.append((key, msg))
        while len(self._q) > self.limit:
            self._q.pop(0)
            self.dropped += 1

    def drain(self):
        """쌓인 것을 전부 꺼내고 비운다."""
        out = [m for _, m in self._q]
        self._q = []
        return out

    def __len__(self):
        return len(self._q)


class Conn:
    """방에 붙은 연결 하나. 소켓 자체는 어댑터(main.py)가 들고 있다."""

    def __init__(self, role, code, pid=None):
        self.role = role      # 'tv' | 'play'
        self.code = code
        self.pid = pid        # 폰이면 'p1'..'p4', TV면 None
        self.outbox = Outbox()

    def __repr__(self):
        return "<Conn %s %s %s>" % (self.role, self.code, self.pid or "-")


class Room:
    """방 하나. DB 없음. 서버가 죽으면 같이 사라진다 (PROJECT.md 2장)."""

    def __init__(self, code, now):
        self.code = code
        self.tv = None            # Conn | None
        self.players = {}         # pid -> Conn
        self.created = now
        self.tv_left_at = None    # TV가 끊긴 시각. 붙어 있으면 None
        self.idle_since = now     # TV도 폰도 없어진 시각

    def free_pid(self):
        """비어 있는 가장 앞 슬롯. 먼저 나간 자리를 다시 채운다."""
        for i in range(1, MAX_PLAYERS + 1):
            pid = "p%d" % i
            if pid not in self.players:
                return pid
        return None

    def empty(self):
        return self.tv is None and not self.players


class Hub:
    """
    방 전체. 서버 메모리 딕셔너리가 전부다.

    now/rng를 주입받는 이유: 타임아웃과 코드 발급을 시험에서 결정적으로 돌리기 위함.
    """

    def __init__(self, now=None, rng=None):
        self._now = now or time.monotonic
        self._rng = rng or random.Random()
        self.rooms = {}

    # ── 코드 ──────────────────────────────────────────────

    def new_code(self):
        for _ in range(CODE_TRIES):
            code = "".join(self._rng.choice(CODE_DIGITS) for _ in range(CODE_LEN))
            if code not in self.rooms:
                return code
        # 1296개가 다 찰 일은 없지만, 그래도 조용히 겹친 코드를 내주지는 않는다.
        raise RuntimeError("빈 방 코드를 찾지 못했다")

    @staticmethod
    def valid_code(code):
        if not code or len(code) != CODE_LEN:
            return False
        for ch in code:
            if ch not in CODE_DIGITS:
                return False
        return True

    # ── 접속 ──────────────────────────────────────────────

    def attach(self, code, role):
        """
        방에 붙인다. 성공하면 (conn, None), 실패하면 (None, 사유 문자열).

        TV는 코드가 없으면(`new`) 방을 만들고, 있으면 그 코드의 방을 차지한다.
        없는 코드라도 만들어서 준다 — TV가 재접속했는데 코드가 바뀌면
        이미 그 숫자를 보고 있던 폰이 전부 틀린 코드가 되기 때문이다.

        폰은 반드시 있는 방에만 붙는다. 없으면 거부한다.
        """
        if role not in ("tv", "play"):
            return None, "역할이 올바르지 않아요"

        if role == "tv":
            if not code or code == "new":
                code = self.new_code()
            elif not self.valid_code(code):
                return None, "방 코드 형식이 올바르지 않아요"

            room = self.rooms.get(code)
            if room is None:
                room = Room(code, self._now())
                self.rooms[code] = room

            # 같은 방에 TV가 이미 있으면 새 쪽이 차지한다.
            # 죽은 소켓이 남아 방을 붙잡고 있는 상황이 더 나쁘다.
            old = room.tv
            conn = Conn("tv", code)
            room.tv = conn
            room.tv_left_at = None
            if old is not None:
                old.outbox.put({"t": "err", "msg": "다른 화면이 이 방을 이어받았어요"})
                self._detach_conn(room, old)

            conn.outbox.put({"t": "room", "code": code})
            return conn, None

        # role == 'play'
        if not self.valid_code(code):
            return None, "그런 방이 없어요"
        room = self.rooms.get(code)
        if room is None:
            return None, "그런 방이 없어요"

        pid = room.free_pid()
        if pid is None:
            return None, "방이 가득 찼어요"

        conn = Conn("play", code, pid)
        room.players[pid] = conn
        # 자기 자리를 알려준다. TV가 특정 폰만 떨게 하는 fx를 걸러내려면 폰이 자기 pid를 알아야 한다.
        conn.outbox.put({"t": "you", "pid": pid})
        return conn, None

    def detach(self, conn):
        """연결이 끊겼다. 방에서 뺀다."""
        room = self.rooms.get(conn.code)
        if room is None:
            return
        self._detach_conn(room, conn)

    def _detach_conn(self, room, conn):
        now = self._now()
        if conn.role == "tv":
            if room.tv is conn:
                room.tv = None
                room.tv_left_at = now
        else:
            if room.players.get(conn.pid) is conn:
                del room.players[conn.pid]
                # 대기 화면의 목록에서 지워야 한다. 폰이 스스로 알릴 방법이 없다.
                if room.tv is not None:
                    room.tv.outbox.put({"t": "leave", "from": conn.pid})
        if room.empty():
            room.idle_since = now

    # ── 릴레이 ────────────────────────────────────────────

    def dispatch(self, conn, msg):
        """
        메시지 하나를 처리한다. 페이로드는 해석하지 않는다.

        폰 → 같은 방 TV, TV → 같은 방 전체 폰.
        상대가 없으면 조용히 버린다. 큐에 쌓아두지 않는다 —
        나중에 붙은 쪽이 과거 동작을 한꺼번에 받으면 더 이상하다.
        """
        if not isinstance(msg, dict):
            return
        t = msg.get("t")
        if not isinstance(t, str) or not t:
            return

        room = self.rooms.get(conn.code)
        if room is None:
            return

        if t == "ping":
            pong = {"t": "pong"}
            if "id" in msg:
                pong["id"] = msg["id"]        # RTT 측정용. 보낸 쪽이 붙인 값을 그대로 돌려준다
            conn.outbox.put(pong)
            return

        if conn.role == "tv":
            if t == "create":
                # 방은 접속할 때 이미 만들어졌다. 코드만 다시 알려준다.
                conn.outbox.put({"t": "room", "code": room.code})
                return
            for p in room.players.values():
                p.outbox.put(msg)
            return

        # 폰 → TV. 누가 보냈는지는 서버가 찍는다.
        # 폰이 스스로 붙인 from은 덮어쓴다. 다른 플레이어인 척할 수 없어야 한다.
        out = dict(msg)
        out["from"] = conn.pid
        if room.tv is not None:
            room.tv.outbox.put(out)

    # ── 정리 ──────────────────────────────────────────────

    def sweep(self):
        """
        타임아웃된 방을 정리한다. 주기적으로 불린다.
        정리하면서 끊어야 할 연결 목록을 돌려준다 — 소켓을 닫는 것은 어댑터 몫.
        """
        now = self._now()
        doomed = []
        for code, room in list(self.rooms.items()):
            if room.empty():
                if now - room.idle_since >= EMPTY_ROOM_TTL_SEC:
                    doomed.append((code, room, []))
                continue
            if room.tv is None and room.tv_left_at is not None:
                if now - room.tv_left_at >= TV_GRACE_SEC:
                    # TV가 돌아오지 않았다. 폰만 남은 방은 아무것도 할 수 없다.
                    doomed.append((code, room, list(room.players.values())))

        closing = []
        for code, room, conns in doomed:
            for c in conns:
                c.outbox.put({"t": "err", "msg": "TV 연결이 끊겼어요"})
                closing.append(c)
            self.rooms.pop(code, None)
        return closing

    def stats(self):
        players = sum(len(r.players) for r in self.rooms.values())
        tvs = sum(1 for r in self.rooms.values() if r.tv is not None)
        return {"rooms": len(self.rooms), "tvs": tvs, "players": players}
