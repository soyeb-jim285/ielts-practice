# Pipecat examiner service (server.py). Built by CI as ghcr.io/soyeb-jim285/ielts-voice; runs on the VPS host network (WebRTC needs its UDP ports
# reachable on the public IP) and listens for signalling only on the docker bridge address (VOICE_HOST), where the app container reaches it.
FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.9.7 /uv /bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY server.py ./
CMD ["/app/.venv/bin/python", "server.py"]
