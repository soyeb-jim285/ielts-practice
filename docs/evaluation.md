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

## Iteration 2

Date: 2026-09-30. All AI calls went through OpenRouter with the default `openai/gpt-6-luna`.

### Scores (before fixes)

| Dimension | Score | Summary |
|---|---|---|
| Performance | 8 | The API is very fast: p50 is 1–4 ms on every key endpoint, and there are no N+1 queries. recharts is lazy, and the eager set is 141 KB gz JS plus 11 KB CSS. Throttled first paint (150 ms RTT, 1.6 Mbps, 4× CPU) is 1.6–1.8 s, and about 150 ms unthrottled. Points were lost for: a chain of bundle → `/api/me` → route chunks and data; 325 KB of fonts that were not subset, with the serif italic swapping after first paint; one chunk per icon, so the dashboard makes 47 requests; and slow AI analysis with no partial results (writing 18.6 s; speaking 28.0 s, from three AI calls run one after another). |
| Ease of use (first-time candidate, 390×844 + 1440×900) | 7 | The happy paths are good: a 3-step first-run checklist, Part 1 in 2 taps, Task 2 in 1 tap with a live word count, well-organised result tabs and clear empty states. Points were lost because: silence with Whisper hallucinations ("you", "*Ding*") gave a red 0.0 with "fix" cards; the default Gemini TTS left the live examiner silent, with raw model IDs in the warning; one writing analysis timed out at 90 s with no automatic retry; and an off-topic essay scored 6.5 with no top-level warning. There were also smaller jargon, model-picker, review-card and weekly-minutes issues. |
| UI/UX visual quality | 7 | The UI is calm and consistent, with good token discipline, dark mode with no broken surfaces, no overflow at 390 px, and premium-looking auth pages. Points were lost for: transcript and essay prose at about 150 characters per line (`max-w-none`); a transcript that was almost all red underlines; a native `<audio>` element; the dark danger button at 2.78:1 contrast; speaking and writing panels that solve the same problems differently; no recording indicator; small tap targets; and settings copy that did not match `bandColor`. |
| Features vs spec | 7 | Nearly every spec feature works against real OpenRouter calls: speaking scoring (P2 in about 34 s), writing (T1 in 19 s), noSpeech, Band 1 for a near-empty essay, retry deltas and diff, Cambridge gating, the live endpoints, progress, mistakes, SRS, and the editor's anti-assist settings and timers. One critical defect: `speak()` always requested mp3, and the default Gemini TTS only returns pcm, so the live examiner was silent out of the box. Other gaps: no speaking lexical metrics (§5.2), iOS missing the word diff, forgot password and voice-error handling, a TTS list that included non-speech models, and an off-topic speaking answer scored FC 0. |
| Scoring accuracy (24 Cambridge samples × 2 runs; 2 synthetic speaking samples) | 5 | Writing MAE was 0.59, bias −0.51 (−0.93 for bands 6.5–7.5), max error 2.0, 25% exact and 73% within 0.5, Pearson 0.74. This is no better than iteration 1. Most of the deflation came from LR and GRA (means 5.35 and 5.31, against an official mean of 6.15), because every minor slip was counted. Runs are stable, differing by at most 0.5. Speaking ranked correctly (fluent 7.5–8, halting 5–5.5), but fluency metrics were implausible because Whisper drops ums and repetitions. The pronunciation pass also flagged correctly stressed words, and one error was mapped to the wrong word. |

### Key evidence

- Throttled dashboard waterfall: the entry and preloads finish at about 1.54 s, and `/api/me` starts at 1635 ms. `/api/progress` and `/api/cards/due` waited for `/api/me` (1802 ms). FCP was 2436 ms.
- Load: 50 × `/api/progress` at 25 concurrent gave p50 68.6 ms and p95 113 ms. Each request runs 8 queries against a pool of 10.
- The server log had `Gemini TTS only supports response_format="pcm". Got "mp3".` (400 ×4), from `openrouter.ts` hard-coding `response_format: 'mp3'`. With `deepgram/aura-2` the voice worked (3.6 s mp3).
- A fake-mic Part 1 transcribed as "you" + "*Ding*", which bypassed `noSpeech` (`speaking.ts` only checked `words.length === 0`). The candidate saw overall 0.0, with fluency marked "On target".
- The off-topic essay got TR 4.0, CC 7, LR 7, GRA 8 → overall 6.5, labelled "Just below your target".
- Weekly minutes: one 1-minute writing attempt counted 40 minutes (`progress.ts` fallback to the nominal task time).
- Writing accuracy by band: 4.0–5.0 bias 0.0; 5.5–6.0 bias −0.27; 6.5–7.5 bias −0.93. Worst cases: 17_122 (official 7.5 → 5.5), 15g_132 (7 → 5). A post-hoc +0.5 offset gives MAE 0.43.
- Halting speech: Whisper dropped all 16 um/uh fillers and 5 repetitions, and turned "he go" into "went". Result: 1.8 fillers/min, MLR 8.7, 0 mid-clause pauses.
- The contrast of white on dark `--bad` was 2.78:1, and `--line` on `--surface` (input borders) was 1.27:1.
- Scratch output is in `.eval/2/{performance,ease,visual,featcomp,scoring-acc}/`, with fixer output in `.eval/2/fix-*/`.

### What was fixed

**Server**
- Gemini TTS is requested as `pcm` and wrapped in a WAV header; other voices still use mp3. The live route stores `eN.wav` or `eN.mp3`. The TTS list only offers speech models that list at least one voice.
- Voice failures send candidates one plain captions message. The model and voice names go only to the log.
- `noSpeech` is set when there are fewer than 3 real words after dropping sound-event tokens and known Whisper hallucinations, when there is under 2 s of speech, or when every criterion is 0.
- The main analysis call is retried once on timeout, network, 429/5xx or unreadable-JSON errors. Stale `analyzing` attempts (over 10 min) are failed at boot and every 5 min.
- Weekly minutes count only measured time.
- Scoring changes:
  - A writing LR/GRA rule judges the share of error-free sentences, where 10–15 minor slips are normal at band 7.
  - For `openai/gpt-6-luna` only, a +0.5 overall correction is applied from band 5 up and recorded in `calibration`. It was measured on the same set it was fitted on: bias −0.51 → 0.00 and MAE 0.59 → 0.33.
  - Task 2: thin support is a band-6 feature.
  - Speaking off-topic lowers FC to about 4–5, never 0.
  - Criterion ranges are ±1, and the overall range is at least ±0.5.
- Speaking additions:
  - `metrics.lexical` (MTLD, TTR, less-common %, overused words) uses a 5k spoken-frequency list (CC-BY-SA).
  - Stretched words count as hidden pauses. On the halting sample, MLR went from 8.7 to 3.3.
  - A self-correction needs a content word plus a pause or filler.
  - The pronunciation pass must report what it heard and what it expected, and drops entries where the two match. The fluent sample is now P 8 with 0 flagged words.
  - Errors are anchored across the whole transcript, or by timestamp for pronunciation errors.
- `grammar.punctuation` category; `GET /api/attempts/:id` returns `models`.
- The Part 2 question sent for scoring no longer repeats the cue-card title.

**Web**
- `/api/me` starts from an inline script, and page data no longer waits on it. Fonts are subset to about 30 KB each, and the serif italic uses `font-display: optional`.
- A 0.0 result shows the "No speech detected" page. Under 20 words or 15 s, the fluency measures show "—". The mic check needs about 1 s of speech-level sound and warns when the input is quiet. There is a shared `MicCheck`.
- Transcript and essay prose keep the 68ch measure. Task/relevance notes are a tint instead of red underlines, and fillers show a strikethrough. A branded audio player replaces the native one. The recording screen shows a red "Recording" dot. There are new part icons.
- Off-topic alert on writing results (TA/TR ≤ 4 or a major relevance mistake). The under-minimum submit dialog warns and makes "Keep writing" the primary button. The writing exam now sends `durationMs` (editor time, split across a full test's tasks).
- The mistake popover sits beside the phrase on desktop. The sheet no longer repeats the category (`ErrorDetails hideCategory`).
- `ResultHeader`: the raw mean moved into a tooltip, the "likely" range is capped at ±1 band around the score, and it is hidden at 0.
- `AnalyzingState` shows "Taking longer than usual — you can leave" after 45 s.
- The model picker has "Recommended", "Current" and "All models" groups, no `:batch` variants, and rough per-essay costs.
- Contrast:
  - A new `--bad-ink` token brings the dark danger button from 2.78:1 to 6.57:1. The recording mic button uses it too.
  - Input borders use `line-strong` (about 3.2:1).
  - Every `InfoTip` has a 44 px `hit` area.
- Mistakes: long spans clamp to two lines, and the meta line never truncates. Bank: the type filter is grouped by skill and part. The trend chart adds times for same-day attempts and uses non-warn series colours. The settings amber copy matches `bandColor`.

**iOS** (commit 733b377, iOS CI green; not checked visually)
- Voice-error banner with an "Open Settings" sheet, the retry word diff, and forgot password.
- `check-models.mjs` checks 24 `Models.swift` structs against `openapi.json` in CI.

**Docs**
- Spec: the "as shipped" notes cover the iOS client and drift check, `metrics.lexical`, `calibration` and `models`. The speaking session route row is now `/speaking/session?mode=…`.

### Verification after fixes

- `pnpm typecheck` is clean.
- `TEST_DB=verify pnpm test` passes: core 27, web 49, server 78 (1 skipped: the optional live TTS smoke test, which was run by hand and passed).
- `pnpm build` passes.
- `pnpm gen:api` regenerated `openapi.json` and `schema.d.ts` (`Attempt.models`), and `check-models.mjs` still passes.
- Playwright e2e passes 6/6.
- Fixers checked with real OpenRouter runs:
  - The default Gemini voice speaks (`e0.wav`, `audio/wav`).
  - Silence and noise both return `noSpeech`.
  - The off-topic Part 2 gets FC 5 and overall 6.5.
  - Halting and fluent speech: MLR 3.3 vs unchanged, and P 8 on the fluent sample.
  - The writing re-run gives bias 0.00 and MAE 0.33 on the calibration set.

### Remaining gaps

- **The writing calibration has not been checked on a held-out set.** The +0.5 offset was fitted on the same 24 samples it is scored on. It applies only to `openai/gpt-6-luna`, and the criterion bands themselves are still deflated in LR and GRA. Next: score a held-out set of Cambridge answers.
- Whisper still "repairs" grammar and drops most ums. The audio pass found 2 repetitions but 0 filled pauses on the halting sample.
- Speaking runs STT → audio pronunciation → scoring one after another (about 28 s), with no partial results. The dashboard still makes about 47 requests (one chunk per icon), and route chunks are not preloaded.
- Not shown in clients yet:
  - `metrics.lexical`, `models`, `calibration`, the pronunciation `heard`/`expected` fields and `disfluencies`, on web or iOS.
  - Shared `VocabUpgrades` and `MistakeBars` components, and the same card treatment for the transcript and the essay.
- The prompt bank still has near-duplicate topics (Food / Food and diet, Health / Health and fitness, Work / Work and study, Internet / The internet).
- The live page at 1440×900 has the avatar ring overlapping the "Introduction" heading.
- iOS still uses a hand-written client (it is drift-checked), and its new screens have not been seen on a device.
- The root disk filled up during this iteration and crashed Postgres (restarted with `docker start`). Keep an eye on disk space for the dev volume.
