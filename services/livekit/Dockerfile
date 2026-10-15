# Build this image in CI, not on the development laptop.
FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.12.24 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy OTEL_SDK_DISABLED=true \
    PYTHONUNBUFFERED=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libportaudio2 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY . .
# Silero ships its ONNX weights in the wheel; v1-mini is embedded in
# livekit-local-inference's native library. No Cloud model download is needed.
# Run the SDK's model download step and eagerly initialize both local models
# during CI so missing assets fail the build rather than the first session.
RUN uv run --no-dev python -m livekit.agents download-files \
    && uv run --no-dev python -c "from livekit.local_inference import init_eot; from livekit.plugins import silero; init_eot(); silero.VAD.load()"
RUN useradd --create-home worker && chown -R worker:worker /app
USER worker
EXPOSE 8081
CMD ["uv", "run", "--frozen", "--no-dev", "python", "-m", "livekit.agents", "start", "worker.py", "--log-level", "INFO"]
