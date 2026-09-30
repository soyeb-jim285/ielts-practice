# Evaluation log

Each iteration scores the running stack on five dimensions (spec §12), fixes what it can, and records what is left. Scratch output (screenshots, scripts, sample answers) lives in `.eval/<n>/`, which is gitignored.

## Iteration 1

Date: 2026-09-30.

### Scores (before fixes)

| Dimension | Score | Summary |
|---|---|---|
| Performance | 6.5 | API and DB are fast: p50 is 6–9 ms on key endpoints, and 20 concurrent clients get about 260 rps at p95 ~100 ms. Delivery and the AI path were weak. The dashboard always loaded recharts (100 KB gz). There was no compression or immutable caching. Google Fonts blocked render. Authed pages waited on `/api/me` before loading route chunks. Writing analysis took 37 s with no streaming. Several FK/filter indexes were missing. |
| Ease of use (first-time candidate, 390×844 + 1440×900) | 6.5 | Core journeys are good: 3-step onboarding, 1-tap speaking, and a clear writing editor and result. It lost points for: the live pre-screen having no container or Exit; a raw "(402)" error with a Retry that could never work; every review grade reading "1 day"; linkers used once shown as "Overused"; developer jargon in Settings; the mobile tab bar hiding "Improve"; and metric keys leaking into evidence. |
| UI/UX visual quality | 7 | Calm, consistent tokens, clean dark mode, and no overflow at 390 px. Detail was unfinished. Raw model and metric text leaked into the UI, the diff ran words together ("hashave"), and the mobile Part 2 CTA sat below the fold. The pace and pause timelines did not line up, many tap targets were under 44 px, and there were nested cards and a card grid on Mistakes. |
| Features vs spec | 7 | Almost all of §1–§13 is built and works end to end. There are 113 passing workspace tests. Gaps: the unclear-word signal never fired, and there was no captions-only fallback when TTS failed. Web and server disagreed on the TTS default. Ranges collapsed to one band, and `planFollowed` was null. There was no retry diff and no iOS Mistakes/History screens. Clients did not use the generated OpenAPI types. |
| Scoring accuracy (24 Cambridge examiner-marked writing samples × 2 runs) | 5 | MAE 0.66 and bias −0.55, with only 62.5% of predictions within 0.5. Scoring was accurate for bands 4–5.5, but bias was −0.56 at 6–6.5 and −1.08 at 7–7.5. GRA was ≤ 5 in 81% of predictions, and 13 of 26 samples changed band between identical runs. Causes: strict "anchor at 5 / award the lower" rules, a non-official Task 2 "position in intro" cap, and `tokenize()` not counting numbers, which gave false under-length penalties. Speaking ranked correctly (fluent 7, halting 5). |

### Key evidence

- Production build: `CartesianChart` (recharts) was 342 KB / 99.7 KB gz. The network log for a 1-attempt dashboard showed recharts loading with no chart rendered.
- Responses had no `Content-Encoding` even with `accept-encoding: gzip`; `/api/models` was 122 KB raw.
- Throttled (150 ms RTT, 1.6 Mbps, 4× CPU): dashboard LCP was 2356 ms, against 1444 ms on the bank page.
- Writing analysis: one non-streamed gpt-5-mini call, 37.4 s wall time.
- Language tab: six linkers, each used once, were all badged "Overused" (`packages/core/src/text.ts` "templated" rule).
- Review deck: all four grades read "1 day" for a new card (`srs.ts`: `reps === 1 → 1`).
- Word count: `cam-18-1-w1` has 163 real words and was counted as 140, so it got a false UNDER LENGTH and TA 4 against an official 6.
- Examiner model answer `cam-18-2-w2` got 6.5 with TR 5, because "position given only in the conclusion".
- Whisper via OpenRouter returns no per-word confidence, so `pronunciation.unclear` was always `[]`.
- `POST /api/live/start` returned 502 "voice model unavailable" when the real cause was OpenRouter 402 (credits).

### What was fixed

**Server**
- `compress()` on all responses. `serveStatic({ precompressed: true })` with immutable caching on `/assets/*` and `no-cache` on HTML. The Dockerfile now gzips text assets at build time.
- Analysis runs with `reasoning.effort: 'low'`, plus 2 scoring-only samples; each criterion takes the median, and the range covers all samples.
- New indexes on `attempts(user_id,prompt_id)`, `mistakes(attempt_id)`, `cards(user_id,front)`, `live_sessions(user_id)`, `session(user_id)` and `account(user_id)` (migration `0001`).
- better-auth cookie cache, plus a 30 s bearer-token cache.
- `AiError.retryable` and `attempts.error_retryable`. Credit and key failures get a candidate-facing "try later" message; operator hints go to the log.
- Evidence must quote the answer verbatim (anything else is dropped). The "UNDER LENGTH" instruction is no longer turned into a mistake.
- Live TTS failure now continues on captions only (`audioUrl: null`, `voiceError`), and realtime sends `skipTts`.
- Unclear words fall back to segment `exp(avg_logprob)`. Single-band ranges widen to ±1, and `planFollowed` is required when a plan was given.
- Negative-price models are filtered out. Writing without a duration counts its nominal time.
- Scoring rules rewritten to best fit: the band-5 anchor, "award the lower" and the 5–6.5 prior are removed, and the non-official Task 2 position cap is removed.
- `anchorSpan` re-anchors speaking error spans on their `original` words. Fillers are excluded from rate and MLR and end a run. The audio pronunciation pass is on by default.
- `/api/progress` returns `lastFailed`.

**Core**
- `countWords` counts numbers, `%` and currency, and feeds `textMetrics.words`.
- `overused` now means one linker opens 3+ sentences. The templated rate is reported separately as `linkerOpeningRatio`.
- SRS first review now differs by grade (Hard 1 d, Good 3 d, Easy 5 d).
- Pause length is rounded to ms before the long/short test.

**Web**
- recharts loads lazily (a dashboard SVG sparkline; Fluency and ChartRenderer are lazy). Fonts are self-hosted and preloaded. `/api/me` and route chunks start in parallel.
- Mobile tabs fit (Improve is visible) and tap targets are 44 px. Mistakes is one divided card with "In deck" state. Settings is plain-language, with AI models under "Advanced".
- Web defaults match the server (enforced by a test).
- The live pre-screen sits in ExamShell with an Exit link. The Part 2 CTA is sticky on mobile. Pace and pause timelines share one axis. Zero-count chips are hidden and duplicated cue-card titles removed.
- Failed state shows the recording, the questions and ways out. It says "Try again later" when not retryable. The dashboard flags a last attempt that could not be scored.
- The diff view spaces removed and added words apart. There are no nested cards on the essay tab, and the editor word counter is never red. An under-length alert appears on the writing result. Retries show a "Since your last attempt" diff.
- The editor uses core `countWords`, and submits under 21 words are blocked.
- A band is only red when 1.5+ bands below target. The bank type filter uses human labels.
- The typed OpenAPI client (`openapi-fetch` + `lib/schema.d.ts`) is used across shell pages. `pnpm gen:api` regenerates both `openapi.json` and `schema.d.ts`, and CI fails on drift.

**iOS**
- Mistakes and History screens, linked from Home (iOS CI run green; not run on a device).

**Docs**
- Spec §5 now describes best-fit marking with the median of 3. Spec §6 has an "as shipped" note.

### Verification after fixes

- `pnpm typecheck` is clean. `TEST_DB=verify pnpm test` passes: core 24, web 41, server 72. `pnpm build` passes; recharts is in its own chunk and is not requested by the dashboard. `pnpm gen:api` is idempotent. Playwright e2e passes 6/6 (desktop and mobile).
- Manual Playwright spot check (`.eval/1/verify/`): the live pre-screen has a container and Exit at 390 px. The mobile writing result shows all five tabs. `/api/progress.lastFailed` points at a failed attempt.

### Remaining gaps

- **Scoring accuracy has not been re-measured.** OpenRouter credits ran out, so the best-fit rewrite, the median of 3, range coverage and the low-effort wall time are unverified. Next step: re-run `.eval/1/scoring/run.ts` after topping up (target |bias| < 0.25 on the 7–7.5 group).
- Speaking analysis and the live examiner voice were not exercised end to end (audio endpoints need a $0.50+ OpenRouter balance).
- Pronunciation "unclear" is segment-level, so a whole low-confidence segment gets flagged.
- `wpmSeries` drops the last partial 10 s window.
- The prompt bank has near-duplicate topics (Art/Arts, Advertisements/Advertising, and others).
- Web still keeps its own copy of the default models, guarded by a test. `DEFAULT_SETTINGS` should move to a DB-free module or be returned by `/api/me`.
- Speaking, writing and live web code still use `api.get<T>` rather than the typed client.
- iOS uses a hand-written client instead of swift-openapi-generator, and the new iOS screens have not been seen on a device.
- Writing analysis still gives no streaming or progress feedback beyond a step list.
