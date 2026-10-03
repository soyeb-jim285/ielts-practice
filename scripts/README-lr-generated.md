# Generated Listening/Reading tests

Output (gitignored): `data/lr-generated/{slug}.json` (LrTest), `scripts/{slug}.json` (TTS turns), `assets/lr/gen/...` (mp3 + map PNGs), `cost.log`, `solver-agreement.log`.

1. `pnpm tsx scripts/gen-lr.ts [slug ...]` — needs OPENROUTER_API_KEY in `.env`. Writer gpt-6-luna, solver deepseek-v4.1-flash, arbiter qwen3.8-flash (falls back to luna). Resumable via `data/lr-generated/.cache` (delete a step file to redo it). Hard budget cap 1.40 USD via cost.log. Tests moved to `data/lr-generated/unrendered/` are skipped.
2. `nice -n 19 uv run scripts/gen-lr-tts.py <slug> [part ...]` — Kokoro-82M via kokoro-onnx on CPU, 2 threads, skips existing mp3s. Put `kokoro-v1.0.onnx` and `voices-v1.0.bin` (kokoro-onnx GitHub release `model-files-v1.0`) in `data/lr-generated/models/`.
