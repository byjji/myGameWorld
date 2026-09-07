"""
L-Party 릴레이 서버 (FastAPI)

  WS  /ws/{code}?role=tv|play    방 접속. code가 `new`면 TV가 새 방을 연다
  GET /healthz                   헬스체크
  GET /                          간단한 안내 (정적 파일은 Netlify가 서빙한다)

게임 로직은 여기 없다. 방 규칙은 전부 rooms.py에 있고, 이 파일은
"소켓 ↔ 순수 로직" 어댑터일 뿐이다 (PROJECT.md 8장).

읽기와 쓰기를 태스크 두 개로 나눈 이유:
받는 쪽이 느려도 보내는 쪽이 막히면 안 된다. 폰 하나가 LTE로 버벅인다고
TV 프레임이 밀리면 게임이 무너진다. 송신은 Outbox(rooms.py)가 흡수하고,
넘치면 tilt/state는 최신값으로 덮어쓴다.

실행:
  python server/main.py                 개발용
  uvicorn main:app --host 0.0.0.0 --port 8000    컨테이너

환경변수:
  LP_PORT     기본 8000
  LP_HOST     기본 0.0.0.0
  LP_STATIC   지정하면 그 디렉터리를 정적 서빙한다. 개발·비상용.
              평시에는 비워둔다 — 정적 파일은 Netlify 몫이다 (PROJECT.md 1장).
"""

import asyncio
import json
import logging
import os
import sys
import time

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, PlainTextResponse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rooms import Hub  # noqa: E402

log = logging.getLogger("lparty")

# 방 정리 주기(초). 타임아웃 자체는 rooms.py가 정한다.
SWEEP_SEC = 10.0

hub = Hub()
STARTED = time.time()


def _dump(msg):
    # 한글 메시지를 \uXXXX로 부풀리지 않는다. TV로 나가는 바이트가 그만큼 준다.
    return json.dumps(msg, ensure_ascii=False, separators=(",", ":"))


def _wake(conn):
    ev = getattr(conn, "wake", None)
    if ev is not None:
        ev.set()


def _wake_room(code):
    """방 안의 모두를 깨운다. 한 방은 TV 1 + 폰 4가 상한이라 훑어도 싸다."""
    room = hub.rooms.get(code)
    if room is None:
        return
    if room.tv is not None:
        _wake(room.tv)
    for p in room.players.values():
        _wake(p)


async def _sweeper():
    """빈 방·TV 없는 방을 정리한다. 메모리 누수 방지."""
    while True:
        await asyncio.sleep(SWEEP_SEC)
        try:
            for conn in hub.sweep():
                _wake(conn)
                ws = getattr(conn, "ws", None)
                if ws is not None:
                    try:
                        await ws.close(code=1001)
                    except Exception:
                        pass
        except Exception:
            log.exception("sweep 실패")


async def _lifespan(app):
    task = asyncio.create_task(_sweeper())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(title="L-Party relay", lifespan=_lifespan)


@app.get("/healthz")
def healthz():
    s = hub.stats()
    s["ok"] = True
    s["uptime"] = round(time.time() - STARTED, 1)
    return JSONResponse(s)


@app.get("/")
def root():
    return PlainTextResponse("L-Party relay. 화면은 Netlify에 있다. WS: /ws/{code}?role=tv|play\n")


@app.websocket("/ws/{code}")
async def ws_room(ws: WebSocket, code: str, role: str = Query("play")):
    await ws.accept()

    conn, err = hub.attach(code, role)
    if conn is None:
        # 소켓 오류가 아니라 서버가 거절한 것이다. 폰이 "틀린 코드"로 보여줄 수 있게
        # 이유를 먼저 보내고 닫는다 (js/play.js의 err 핸들러).
        try:
            await ws.send_text(_dump({"t": "err", "msg": err}))
        except Exception:
            pass
        await ws.close(code=4004)
        return

    conn.ws = ws
    conn.wake = asyncio.Event()
    _wake(conn)   # attach가 넣어둔 room 메시지를 바로 내보낸다

    log.info("attach %s %s %s", conn.role, conn.code, conn.pid or "-")
    writer = asyncio.create_task(_writer(ws, conn))
    try:
        await _reader(ws, conn)
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("reader 실패 %s", conn)
    finally:
        writer.cancel()
        hub.detach(conn)
        _wake_room(conn.code)
        log.info("detach %s %s %s", conn.role, conn.code, conn.pid or "-")
        try:
            await ws.close()
        except Exception:
            pass


async def _reader(ws, conn):
    while True:
        raw = await ws.receive_text()
        try:
            msg = json.loads(raw)
        except ValueError:
            continue          # 깨진 메시지는 버린다. 다음 것이 온다
        hub.dispatch(conn, msg)
        _wake_room(conn.code)


async def _writer(ws, conn):
    # clear를 drain보다 먼저 한다. 순서를 뒤집으면 그 사이에 들어온 메시지의
    # 깨우기 신호를 지워버려 연결이 조용히 멈춘다.
    while True:
        conn.wake.clear()
        for msg in conn.outbox.drain():
            await ws.send_text(_dump(msg))
        if len(conn.outbox) == 0:
            await conn.wake.wait()


def _mount_static():
    path = os.environ.get("LP_STATIC")
    if not path:
        return
    from fastapi.staticfiles import StaticFiles

    # 개발용 서빙이므로 캐시를 끈다. 고친 JS가 반영되지 않아 원인을 코드에서 찾는
    # 시간이 캐시로 아끼는 시간보다 훨씬 비싸다. 배포본 캐시 정책은 netlify.toml에 있다.
    @app.middleware("http")
    async def _no_store(request, call_next):
        resp = await call_next(request)
        resp.headers["Cache-Control"] = "no-store"
        return resp

    app.mount("/", StaticFiles(directory=path, html=True), name="static")
    log.info("정적 서빙: %s (no-store)", path)


_mount_static()


if __name__ == "__main__":
    import uvicorn
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    uvicorn.run(
        app,
        host=os.environ.get("LP_HOST", "0.0.0.0"),
        port=int(os.environ.get("LP_PORT", "8000")),
        log_level="info",
    )
