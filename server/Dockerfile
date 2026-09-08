# Game-Party 릴레이 서버 — Synology NAS Docker용
#
# slim을 쓰는 이유: NAS 저장공간과 빌드 시간을 아낀다. 컴파일이 필요한 패키지가 없다.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# 의존성을 먼저 복사한다. 코드만 바뀌었을 때 pip 레이어를 재사용하기 위함.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY rooms.py main.py ./

EXPOSE 8000

# 헬스체크. 컨테이너가 살아 있는지 NAS가 판단하는 근거.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz',timeout=3).status==200 else 1)"

# --ws websockets: uvicorn이 wsproto를 고르지 않게 못박는다. 둘 다 있으면 선택이 흔들린다.
# --proxy-headers: 리버스 프록시 뒤에 있으므로 원 IP를 로그에 남기려면 필요하다.
CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--ws", "websockets", \
     "--proxy-headers", "--forwarded-allow-ips", "*", \
     "--timeout-keep-alive", "75"]
