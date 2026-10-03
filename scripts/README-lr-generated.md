# Generated Listening/Reading tests

Output (gitignored): `data/lr-generated/{slug}.json` (LrTest), `scripts/{slug}.json` (TTS turns), `assets/lr/gen/...` (mp3 + map PNGs), `cost*.log`, `elevenlabs-cost.log`, `solver-agreement.log`.

**Reading** — `pnpm tsx scripts/gen-lr.ts [slug ...]` — needs OPENROUTER_API_KEY in `.env`. Writer gpt-6-luna, solver deepseek-v4.1-flash, arbiter qwen3.8-flash. Resumable via `data/lr-generated/.cache`. Budget log `cost.log`.

**Listening** (Cambridge pattern, standard in `docs/question-audit/listening.md`)
1. `pnpm tsx scripts/gen-lr-listening.ts [slug ...]` — plans live in `PLANS` (one entry per test: 4 parts, question mix, word limits, chunks); maps/plans are hand-drawn SVG in `scripts/lr-maps.ts` (add one per map part). Writes the LrTest, the map PNGs and `scripts/{slug}.json` (rubric narrator lines, speakers with ElevenLabs voice ids, performance cues, silences). Resumable via `.cache-l`; `REGEN=1` rebuilds an existing test. Budget log `cost-listening.log` (`LR_BUDGET`, default 0.6 USD).
2. `python3 scripts/gen-lr-elevenlabs.py <slug> [part ...] [--dry] [--max-credits N]` — ElevenLabs Eleven v4 Turbo `text-to-dialogue`, needs ELEVENLABS_API_KEY and ffmpeg. Resumable (per-block cache `.el-cache`), exam silences made with ffmpeg, loudness -16 LUFS, mono 64 kbps mp3. `--dry` prints the character estimate and the account balance; refuses on the free tier. Credit use per call is appended to `elevenlabs-cost.log`.
3. `pnpm import:lr` imports the JSON and audio into the local dev database/storage.

**Structure gate** — `pnpm tsx scripts/lr-structure-check.ts [slug ...]` (or `--cambridge C10-T1 ...` for transcript-only answer order; flags `--parts 1,2`, `--lenient`, `--no-timings`). Answers must be spoken in question order and inside the narrator segment that announces them (see docs/question-audit/listening.md section 8). It is a hard gate in `gen-lr-listening.ts` (the part is regenerated up to 3 times, the prompt states the rule) and in `gen-lr-elevenlabs.py` (refuses to render a failing part before any credit is spent). After rendering, re-run it: it also checks the new word timings. Scripts are edited by hand when fixing; keep `section.transcript` and the enrich `evidence` (exact substring) in sync.
