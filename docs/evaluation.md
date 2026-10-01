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

## Iteration 3

Date: 2026-09-30. All AI calls went through OpenRouter with the default `openai/gpt-6-luna`. Writing accuracy was measured on a held-out set for the first time: 24 official samples from Cambridge 19, 13 and 12, none of which were used to fit the calibration (books 15–18).

### Scores (before fixes)

| Dimension | Score | Summary |
|---|---|---|
| Performance | 8 | The API is very fast (p50 under 3 ms on every key endpoint), with no N+1 queries, the right indexes and parallel queries. The first load is 141 KB gz JS plus 11.5 KB CSS, and recharts is lazy. The production build gets LCP 140–170 ms unthrottled and 1.8–2.4 s on Slow 4G with 4× CPU. Points were lost because: the 100 KB recharts chunk was on the critical path of the Writing Task 1 editor, and table and diagram prompts loaded it too; the bank fetched its list only after its page code loaded; the better-auth client (12 KB gz) loads up front; 83 small chunks meant 25 JS requests for the login page; and analysis takes 20.7 s for writing and 29 s for speaking, plus up to 2 s of polling. |
| Ease of use (first-time candidate, 390×844 + 1440×900) | 7.5 | Every journey completed without a crash, on both viewports. The dashboard has 3 numbered steps, speaking is one tap to record, the submit dialog explains too-short essays, and every empty state names a next action. Points were lost on result credibility: the writing criteria averaged 6.0 but the headline said 6.5 next to an "Off topic … caps your score" alert; the "one band higher" rewrite of an off-topic essay was still off topic; an off-topic speaking answer got 6.0 with the warning buried in the Language tab; and the live pace pill said 134 wpm while the result said 186 wpm. |
| UI/UX visual quality | 7.5 | 24 routes checked at 390 and 1440 px in light and dark. Nothing scrolls sideways, tokens are consistent, dark mode has no broken surfaces, and the results pages are the strongest screens. Points were lost for small polish faults that add up: a stray divider under the Settings account card; the logo word falling back to Times on a first visit; controls under 44 px; native selects next to custom segmented controls; a 3,400 px speaking overview on mobile; three stacked warnings on the writing result; empty space at 1440 px on the Transcript and Improve tabs; and a dark `--surface-2` barely different from the card. |
| Features vs spec | 8.5 | Almost all of spec §1–§13 works end to end with real OpenRouter calls: auth, settings, models, the bank and Cambridge gating, full speaking tests and practice sessions, writing with retry deltas and diff, review-focus edge cases, mistakes, SRS, progress, and the live examiner. iOS covers every flow, and `check-models.mjs` passes 24/24. The one real defect was the writing calibration: +0.5 was added to the overall but not to any criterion, so the overall no longer matched the bands shown. Minor gaps: the session report shows only a test overall, examiner captions start off, the realtime token has no retry, and history is cluttered with never-submitted attempts. |
| Scoring accuracy (24 held-out Cambridge samples × 2 runs; 2 synthetic speaking samples) | 6 | On the held-out set: MAE 0.53, bias −0.32, max error 1.5, 79% within 0.5, Pearson 0.59. Scores were compressed: nearly every script got criteria of 5–6, so band 5 scripts were over-scored (+0.36) and 6.5–7.5 scripts under-scored (−0.58). Academic Task 1 TA ran 0.8 band low because the model marked down "inaccuracies" from its own misreading of maps and diagrams. The calibration had a cliff at a mean of 5, which caused a 1.5-band miss. Speaking ranked correctly (fluent 8.0, halting 5.5, stable across runs), but Whisper silently corrected the halting speaker's grammar, and the pronunciation pass logged grammar slips as pronunciation errors. |

### Key evidence

- The Writing Task 1 line chart appeared at 3.5 s on Slow 4G, against an LCP of 2.2 s, because of the recharts chunk. A table prompt still downloaded `ChartRenderer` and `CartesianChart`.
- Writing result: TA 4, CC 7, LR 6, GRA 7 (mean 6.0) was shown as overall 6.5, because the hidden +0.5 calibration was added to the overall only.
- Held-out accuracy by band: official 5.0–5.5 bias +0.36; 6.0 bias −0.47; 6.5–7.5 bias −0.58. Criterion bias against the official overall: TA −0.70, CC −0.70, LR −0.87, GRA −0.98. Regression: official ≈ 0.96 × criterion mean + 1.03.
- Worst miss: 13_4_2, official 6.0, predicted 4.5 in both runs. The raw mean was 4.5, so the calibration (which started at a mean of 5) did not apply.
- The two runs gave different overall bands on 6 of 24 samples, despite the median of 3 samples.
- Speaking: Whisper turned "she help me", "it take very long time" and "I learn it" into correct grammar, so that evidence never reached GRA. It also inserted "Thank you" and "you" hallucinations, and counted 7 fillers where the script had about 13.
- Visual: the Settings divider came from a `<Dialog>` inside a `divide-y` card. The fallback serif came from `font-display: optional` on a font that was not preloaded. Dark `--surface-2` against `--surface` was about 1.05:1.
- Scratch output is in `.eval/3/{performance,ease,visual,feat,scoring}/`, with fixer output in `.eval/3/fix-*/`.

### What was fixed

**Server (scoring)**
- The writing calibration now moves whole criterion bands (LR and GRA first on ties), so the four criteria shown always average to the overall. The `calibration` field is gone; no client read it. A criterion moved to a band that no sample gave shows the official descriptor for that band.
- The calibration is a smooth linear map (`b = 0.55, s = 0.1`) that ramps in from 3.5, with no cliff. It is skipped when TA averages below 4.5, and a test checks that it never decreases.
- Off-topic writing (TA ≤ 4 or a major `task.relevance` error) is capped at TA + 1 on the server. The web applies the same rule, so the dashboard, history and results page agree.
- The rubric has band 5/6/7 contrasts for each criterion. The model must name the missing band-7 feature before scoring below 7. For image figures it is told that its own reading of the image can be wrong.
- Writing makes 1 full call plus 4 scoring calls, in parallel, and each criterion is the mean of its samples. Cost goes up about 1.7×, and wall time stays about the same.
- An off-topic essay's rewrite must answer the question as set.
- Speaking:
  - The audio pass reports a `misheard` list (what was said against what was transcribed), and the grader treats the non-standard form as grammar evidence. The halting sample now scores 5.0.
  - Pronunciation entries whose `expected` is a different word form, or whose correction equals the original, are dropped.
  - Speaking and writing have separate mistake categories.
  - Low-confidence "you" / "Thank you" hallucinations next to a pause are dropped.
  - The filled-pause count uses the larger of the two sources.
- Held-out result after the fixes (43 analyses): **MAE 0.53 → 0.38, bias −0.32 → −0.13, max error 1.5 → 1.0, 95% within ±0.5, and runs giving different bands 6/24 → 0/21.**

**Web**
- The Writing Task 1 figure is plain SVG, with no recharts, loaded eagerly with the prompt panel. Pies use stable per-label colours.
- There is one alert on the writing result (off topic, or under length), and the header shows the capped band with a "Capped: off topic" badge.
- An off-topic speaking result shows an alert above the tabs that links to the relevance section.
- The live pace estimate is calibrated against Whisper rates and shares its thresholds with the Fluency tab. It shows "listening…" when there is too little voiced sound.
- Mobile criterion cards put the evidence behind "Show evidence", so the mobile speaking overview went from about 3,400 px to about 2,400 px. The transcript has a sticky side column from 1440 px up. Model-answer cards fit their text.
- The Part 2 notes only get autofocus on devices with a fine pointer, so the phone keyboard no longer covers the cue card.
- Retry is labelled "Retry Part N" for multi-question prompts.
- Shell fixes:
  - Review fix cards show the fix title as a small label.
  - Friendly 404 copy. An unknown URL shows inside the app shell.
  - The bank has T1 Academic / T1 General / Task 2 filters, sticky group headers, whole-row links and Segmented filters.
  - The Settings divider is gone. The serif italic is preloaded.
  - Segmented options are 44 px on phones, and the dashboard mistake rows and auth links have larger tap targets.
  - Mistakes stack on mobile and hide identical before/after pairs.
  - Dark `--surface-2` is `#262522`, and the sidebar has its own `--sidebar` token.
  - The history band is prominent. The dashboard no longer shows the Task 2 action twice during onboarding.
- In the verify pass: native `Select` now uses `appearance-none` with a lucide chevron, so it matches the Segmented controls. Writing vocabulary upgrades use the speaking panel's arrow and wrapping chips.

**Docs**
- Spec §5: writing makes 1 + 4 samples (speaking 1 + 2) and takes the mean per criterion, with the calibration over criterion bands and the off-topic cap. Design system: the SVG Task 1 figure, the `--sidebar` token, the italic preload, and Segmented sizing and filters.

### Verification after fixes

- `pnpm typecheck` is clean.
- `TEST_DB=verify pnpm test` passes: core 27, web 58, server 82 (1 skipped: the optional live TTS smoke test).
- `pnpm build` passes. `CartesianChart` (recharts) is still built, but only the dashboard and Fluency panel load it.
- `pnpm gen:api` produced no drift. `check-models.mjs`: 24 structs match `openapi.json`.
- Playwright e2e passes 6/6. The bank select chevron was checked in a screenshot at 390 px (`.eval/3/verify/`).
- Fixers checked with real OpenRouter runs: the held-out writing set, the halting and fluent speaking samples, and an off-topic essay through the running API, with screenshots at 390 and 1440 px.

### Remaining gaps

- **Writing scores are still compressed toward the middle.** Official band 5 scripts come out about 0.4 high and 6.5+ about 0.3 low. The calibration corrects the bias but not the spread. There is no official band 8+ script to test against.
- The off-topic cap (TA + 1) is a product decision. An essay with TA 1 drops to 2.0 overall, which is harsh but matches how a fully off-topic answer is treated. Revisit it if users find it confusing.
- History does not yet get an `Off topic` / `Under length` flag from the server. The web renders the flag when present. The Mistakes page can still offer "Add to deck" for an error that was already added as a top fix, because fix cards and mistake cards are matched exactly.
- OpenRouter seems to ignore the Whisper prompt, so grammar repair is handled only by the audio pass's `misheard` list, which is itself unreliable. `pronunciation.llm.misheard` is not shown in the clients yet.
- Performance: the bank list query still waits for the page code; better-auth loads up front; there are about 83 small chunks; and analysis takes about 20 s for writing and 29 s for speaking, with no partial results.
- Minor: session reports show only a test overall, examiner captions start off, the realtime token has no retry, never-submitted attempts clutter history, and weekly minutes can read 0 for a very fast essay.

## Scoring redesign

Writing scoring is now an anchored, model-agnostic grader. The scoring call shows examiner-marked anchor scripts, takes K=3 samples, and maps the result through a calibration fitted per (model, prompt hash, effort). Without an active calibration the app serves an uncalibrated result with a wider range and a label. Design: [scoring-research.md](scoring-research.md). Validation against the release gates, per-band error, probes, cost and ablations: [scoring-validation.md](scoring-validation.md).

Headline numbers (effort medium, K=3, frozen TEST n=42 / leave-one-prompt-out CV n=64):

| | luna TEST | deepseek TEST | luna CV | deepseek CV |
|---|---|---|---|---|
| QWK | 0.77 | 0.85 | 0.68 | 0.71 |
| MAE | 0.51 | 0.45 | 0.48 | 0.45 |
| Within ±0.5 | 71% | 83% | 77% | 83% |
| Band >= 7 bias | -0.50 | -0.21 | -0.43 | -0.50 |

- No model passes every release gate, so both fitted records are stored inactive and the default model is unchanged. `deepseek/deepseek-v4.1-flash` comes closest.
- The ends of the scale are still compressed: band 9 answers score about 0.9 (luna) and 0.6 (deepseek) low, and the floor scripts come back at 4 to 5.
- Anchors, per-criterion calls and higher effort showed no measurable gain, so the joint anchored call at medium effort stays.
- Script text stays out of git: it lives in the `scoring_scripts` table and the gitignored `data/scoring-gold/`. Only `data/scoring-gold-manifest.json` is committed.

## Iteration 4

Fresh evaluation of the running stack (real OpenRouter, ElevenLabs and OpenAI keys), followed by a fix pass. Evidence and screenshots live in the gitignored `.eval/4/`.

### Scores (before the fix pass)

| Dimension | Score | Summary |
|---|---|---|
| Performance | 7.5 | API and DB are very fast (p50 2-10 ms). Recharts is in a lazy chunk and does not load on /login. The eager shell was heavy (about 213 KB gzip JS), fonts about 560 KB, writing analysis 38 s. Preview FCP 240-330 ms at 1x CPU, 600-880 ms at 4x. |
| Ease of use | 7 | Guided first run, clear record, next, finish flow, good empty states, safe submit dialog. Lost points for a dev upload failing with a misleading error, result pages pushing tab content below the fold on mobile, contradictory score signals, jargon chips, unlabeled controls. |
| UI/UX visual quality | 7.3 | Coherent and calm, solid dark-mode parity. Shell, auth, settings and writing screens near the bar. Weak spots: dashboard score panel, sub-44 px tap targets, ghost skeleton on Review, clipped filter chips, dead canvas on recording and upload screens. The speaking result screen was not captured (uploads stalled in the eval). |
| Feature completeness vs spec | 7 | Core product works end to end. Missing: §5.2 ElevenLabs Scribe STT, and most of §5.1 (disfluency taxonomy, LLM tagger, chips and timeline). Slow live turns, unreachable examiner audio URL. iOS read only. |
| Scoring accuracy | 5.5 | Ranks scripts well (r 0.84) but bands are compressed. TEST MAE 0.74, 55% within ±0.5, SMD -0.57. Own 19 Cambridge samples: MAE 0.68, bias -0.47, max 1.5. Band 4-5 scripts about half a band high, band 7-8 scripts 1 to 1.5 low. Band 9 answers scored 7-8. |

### Key evidence

- Bundle: eager JS 212.7 KB gzip, one 75 KB-gzip catch-all `ui` chunk, about 580 KB of fonts (Newsreader italic and opsz subsets). API p50 2.6-9.8 ms on every endpoint checked. No N+1 in `/api/progress`.
- Writing analysis took 38 s end to end, with no partial result and no stage breakdown.
- Dev presigned upload URLs used the LAN IP (`192.168.0.105`), unreachable from `localhost`, so every speaking upload failed with "Check your connection" and Retry could not recover. The same host broke the live examiner `audioUrl`.
- `grep ELEVENLABS` found nothing in the server. `Disfluency.kind` had only filled, repetition and repair. The web showed only struck-through fillers.
- Scoring: the shipped default (identity map) was worse than the docs' headline (fitted, inactive) numbers. Ceiling probe 0/48, floor probe 0/3. 2 of 19 concurrent writing calls failed with "Could not reach the AI service" (one retry only).
- Speaking: the fluent TTS sample scored 7.5 and the halting one 4.5. Timestamps, fillers and repetitions matched the scripts. Pronunciation notes for TTS audio looked invented.

### Fixed in this iteration

**Server and scoring**
- Two-phase pipeline with a per-attempt `stage` and a `partial` (feedback before scores) on `GET /api/attempts/:id`, per-stage timings in `analysis.timings`. One real essay: feedback at 16 s, full result at 28 s (was 38 s). Migration 0003 also adds `pg_trgm` indexes for prompt search.
- Dev presigned URLs use the request origin, so uploads and examiner audio work through the Vite proxy. A missing `/assets/*` now returns 404 instead of the HTML shell with an immutable header. `/api/prompts/meta` has `Cache-Control: private, max-age=300` and an ETag.
- ElevenLabs Scribe v2 STT (§5.2), default when `ELEVENLABS_API_KEY` is set, with a Whisper fallback; live `/turn` uses it too. Live Part 1 turns take 2.6-4.6 s (was 8-19 s).
- Disfluency taxonomy (§5.1): false start, partial and prolongation added, a rule tagger plus a text-LLM tagger fused together, a per-type profile, and `scripts/eval-disfluency.ts` (filler, repetition and false start at or above 0.8 recall and 0.9 precision with the LLM tagger).
- Scoring: a fixed default map for luna replaces the identity default. TEST n=42, shipped default: MAE 0.74 to 0.50, within ±0.5 55% to 81%, SMD -0.57 to -0.25, QWK 0.61 to 0.76, band >= 7 bias -1.12 to -0.62. Band 3 and 4 descriptors, a whole-scale rule, length and cut-off caps, ceiling probes 0/48 to 19/48 (bias -1.57 to -0.89). Pronunciation claims need acoustic evidence. AI calls retry network errors and 5xx/429 twice with backoff. First SRS review is 1 day, second 6.

**Web**
- `/login` JS 211 kB to 169 kB gzip: `ui-core` and `overlay` chunks replace the catch-all, sonner and the 404 page load lazily, the dashboard trend chart is plain SVG (no recharts), Newsreader is upright and weight-axis only (58 kB latin), latin fonts are preloaded. Poll back-off (`lib/attempt.ts`, about 13 calls in 40 s instead of 20). The result routes now load `attemptQuery` from `lib/attempt` and `result.ts` re-exports it.
- Speaking: upload step timeouts, specific error messages, the recording kept in IndexedDB with a resumable retry and an "Upload now" / Delete banner on the hub, a Resume upload page for "Not submitted" attempts, an "N of 5 answered" confirm on early finish, a centred recorder and upload screen with a visible progress track. Off-topic counts only answered questions, and the overview explains how the overall is averaged. History shows "No speech" instead of 0.0. Disfluency chips in the transcript and a timeline plus per-type cards on the Fluency tab.
- Writing: word count "N / 250" in the sticky header, the question folds to a one-line summary on the first keystroke on mobile, icon-only 44 px Random targets, the off-topic chip is neutral so the alert carries the red. The stray bar on the target-band footnote is gone. The "uncalibrated" chip reads "AI estimate".
- Dashboard: predicted bands are two divided rows in one card, the "Next up" card targets the weakest part and criterion. The Review ghost card is removed, Mistakes chips fade and snap, tap targets are 44 px, Live examiner selected row stays in its column, the auth form is centred at 420 px. The model picker lists `elevenlabs/scribe_v2`.
- iOS: a Disfluencies section (chips, timeline, per-type breakdown) on the Fluency tab, built from `metrics.fluency.events`. No Swift toolchain locally: verified by CI only.
- Docs: `docs/scoring-validation.md` leads with the shipped default, `.env.example` has `ELEVENLABS_API_KEY`, the spec names `seed-bank.ts` and `gen-bank.ts` correctly, the design system has a bundle budget section.

### Verification

`pnpm typecheck` clean, `TEST_DB=verify pnpm test` passes (core 55, web 70, server 105 with 1 skipped), `pnpm build` passes, `pnpm gen:api` regenerated `openapi.json` and `schema.d.ts` (the new `stage` and `partial` fields) and `check-models.mjs` matches 24 structs, Playwright e2e 6/6.

### Remaining gaps

- The web does not yet show the server's `stage` and `partial` (the feedback-first result); it still polls to `done`. The real upload failure cause on the client is surfaced only as the new specific messages.
- Writing scores are still compressed at the ends. Band 9 answers average about 0.9 low, the authored band 3 floor scripts still score 4.5-5, and there are no official band 8+ scripts to calibrate against. The default map is labelled unvalidated and the fitted records remain inactive (CV gate fails).
- `/login` still loads about 18.5 kB of `@ielts/core` and about 12 kB of the better-auth client. The entry is about 169 kB gzip. Streaming TTS for the live examiner is not done.
- Mobile result pages still spend about 560 px above the tabs (hero collapse and moving the off-topic banner to the Overview tab are not done). The overall numeral is still tone-coloured rather than ink with a delta chip. "Not submitted" rows in History have no inline Delete (the result page has one). The Part 1 bank rows have no preview sheet. The hubs' prompt-bank link is not yet prominent on mobile.
- The Scribe prolongation threshold (0.6 s on one character) and the disfluency tagger are validated only on scripted fixtures, not real speech. The iOS disfluency section has not been run on a device, and the iOS kind list may not yet include the new kinds.
- The speaking result charts were never captured against a real scored run in the evaluation (uploads stalled before the fix). A re-run is needed to score visual quality there.
- Dev-server perf numbers are inflated by unbundled modules and were not used for scoring.

## Iteration 5

Fresh evaluation of the running stack (OpenRouter only, plus ElevenLabs Scribe and OpenAI Realtime), then a fix pass. Evidence and screenshots are in the gitignored `.eval/5/`. OpenRouter spend stayed under the $3 budget (harness about $0.7, server fixer about $1.3). Judges seeded speaking results so the transcript and fluency charts were judged for the first time.

### Scores (before the fix pass)

| Dimension | Score | Summary |
|---|---|---|
| Performance | 7.6 | Fast and well split. Endpoints answer in 2-3.5 ms p50, production LCP about 0.5 s, the charting chunk is lazy. Weak spots: eager entry about 150 KB gzip, analysis pipeline 26 s, polling returned the whole attempt, `/api/models` 122 KB with no cache header. Timings came from a near-empty account. |
| Ease of use | 7.3 | Low-click core journeys (sign-up to first recording in 2 clicks), good guardrails (early-finish confirm, word-count warning, no-speech retry). Remaining: mobile result hero, persistent off-topic banner, hidden live-test start button, ghost skeletons on empty states. |
| UI/UX visual quality | 7.4 | Coherent and calm, dark mode well tuned, fluency charts legible, no hover lifts or decorative dots, static tinted hub cards work. Defects: broken glyph on transcript pause chips, banner above the tabs, tiny mobile tab type, skeleton rows under the mistakes empty state, sparse criterion rows. Not a complete sweep (full-test session, live examiner and most 390 px dark screens unopened). |
| Feature completeness vs spec | 7.6 | Nearly every spec section works end to end on the live stack: speaking upload, Scribe transcript, scored result with disfluency events and pronunciation; writing with feedback first then scores; retry comparison; SRS cards; live examiner speaks; realtime token. Gaps: web ignored `stage`/`partial`, no status endpoint, iOS lacked new disfluency kinds, mobile hero, off-topic banner, speaking calibration on disfluent audio, verification emails pointed at the LAN IP. |
| Scoring accuracy | 7 | Clearly better than iteration 4 in the middle of the scale, extremes still compressed (band 8-9 low, weak answers high). Speaking ranks fluent over halting correctly (7.5 vs 4.5) but mislabels the verb "like" as a filler and gave the halting clip a pronunciation score far above its fluency. |

### Key evidence

- Build: eager JS about 150 KB gzip plus 23 KB CSS. FluencyPanel (recharts, 104 KB) and overlay (60 KB) are lazy. Preview FCP 160-245 ms, LCP 480-580 ms. No N+1 found, indexes present.
- Analysis pipeline: submit 5 ms, feedback stage at about 1 s, scoring at 11 s, done at 26 s. The scorer calls themselves are about 25 s each.
- Harness, test split (n=42, luna, default map): QWK 0.84, MAE 0.42, within 0.5 81%, SMD -0.14, band >= 7 bias -0.50 (gate 0.35 not met). Iteration 4: QWK 0.76, MAE 0.50. Band 8 bias -0.88, band 4 bias +0.38.
- Probe split (n=83): ceiling 20/48 (was 19/48), floor 1/3, short 2/4, copied 4/4, errors 12/12, offtopic 4/4.
- Independent 15 Cambridge samples (band 5-8) through the real `analyzeWriting` path: MAE 0.43, bias -0.10, max error 1.5. These share books with the harness test split, so they are not independent of it.
- Speaking: TTS fluent 7.5 (179 wpm, MTLD 148) vs halting 4.5 (63 wpm, 7 long pauses, 11 fillers). Word times line up with the transcript. The audio pass returned pronunciation 8 for the halting clip while fluency was 4.
- Speaking result in the browser: five tabs, colour-coded disfluency chips, clicking a word seeks the audio, pace chart with band-7 zone, pause and filler strips.

### Fixed in this iteration

**Server and scoring**
- Top-end compression: default map refit on the calibration pool plus the 22 anchors, each scored leave-one-out (slope 1.17, intercept -0.32), and a top-band profile flattening for calibrated overall >= 8.5. Ceiling probes 20/48 to 35/48. The flattening rule was designed after seeing the ceiling failures, so that gain is not independent evidence.
- Under 80% of the word minimum caps CC, LR and GRA at TA+1 and adds an UNDER LENGTH line to the scorer message. Short probes 2/4 to 4/4.
- Low-band prompt rule (basic errors in most sentences means band 4 or below for GRA and LR). The copy detector now counts only runs of 8 or more shared words, so cam-7-4-w2 no longer trips `copied`. Floor probes are still 1/3.
- TA instability: per-criterion spread across samples is logged, and a TA spread of 2 or more widens the range by a band. Early exit once two samples agree.
- Speaking: LLM FC clamped to within 1 band of the measured fluency band, pronunciation capped at FC+1 (FC+2 with an audio report). Transcript-only "like" and "you know" count as fillers only between two pauses. The feedback prompt fills thin error lists with fluency habits.
- `/api/models` has `Cache-Control: private, max-age=3600` and an ETag (304 tested). Verification and reset links use the web origin. Live examiner lines are voiced as up to 3 parallel sentence chunks, with fixed-wording lines cached; a route test covers p1 to p2-prep to p2-talk and the 2:00 cut-in. `pnpm seed` and `pnpm gen:bank` root scripts, `scripts/README.md`.
- `GET /api/attempts/:id/status` (`status`, `stage`, `error`, `retryable`).

**Web**
- Better Auth client replaced by a small fetch wrapper with the same API (auth chunk 31.5 KB to 1 KB); the unused `better-auth` dependency is removed from the web package. The styleguide is stubbed out of production builds (12.6 KB gzip less).
- Polling uses the status endpoint and reloads the full attempt only when the stage changes. `AnalyzingState` shows real stage labels and, once partial feedback exists, "Your feedback is ready" with the mistake count and top fixes while scores are pending.
- Result hero collapses to one row on phones (tabs at about y=310, was 450), the numeral is ink, and the off-topic alert lives in the Overview tab, with an "Off topic" header badge linking to it. The writing off-topic alert has a "Rewrite on this topic" action. The "Last try" comparison now renders after the criteria.
- Transcript pause chips read "pause 0.5s" (the double box was a 12 px lucide icon). Fluency tab: the normal / hurts-when text is behind a disclosure, the "Typical band 7" label no longer overlaps the line, and the chunk is prefetched while analysing. Criterion rows keep the band to the right of the label at all widths.
- Tabs are `h-11 text-sm` and scroll horizontally with an edge fade. Mobile nav labels are 12 px with a soft pill on the active icon. The mistakes and history empty states no longer show skeleton rows. The bank filters are reduced, and the dashboard right column matches the hero height.
- Live pre-screen: the mic check comes first and the Start bar is sticky with its reason text. The Part 1 question is top-aligned on phones.

**iOS:** all six disfluency kinds with a per-type breakdown and normal-vs-hurts guidance, `FluencyDetail.profile`, and a `check-models.mjs` check that Swift and core kind lists match. CI green.

### Accuracy gate

Shipped default map, prompt hash `c2c869d31a9fcf39`:

| | QWK | MAE | within 0.5 | SMD | bias <= 5 | bias >= 7 | band 8 | band 4 |
|---|---|---|---|---|---|---|---|---|
| Test (n=42) | 0.83 | 0.48 | 0.86 | -0.07 | +0.36 | -0.35 | -0.63 | +0.50 |
| Calibration + anchors, cross-validated (n=86) | 0.80 | 0.51 | 0.71 | | | -0.26 | | |

The gate fails on test MAE (0.48 against 0.45) and on the >= 7 bias confidence interval (-0.69 to -0.06). The calibration record is stored inactive and the same map ships as the unvalidated default.

### Verification

`pnpm typecheck` clean, `TEST_DB=verify pnpm test` passes (core 55, web 75, server 118 with 1 skipped), `pnpm build` passes, `pnpm gen:api` regenerated `openapi.json` and `schema.d.ts` (status endpoint), Playwright e2e 6/6 (desktop and mobile).

### Remaining gaps

- Accuracy is not at the gate: band >= 7 is still biased low (about -0.35), band 4-5 about +0.4 high, floor probes 1/3. No new 8.5-9 anchors exist because the only other 9.0 scripts are the excluded model probes. The MTLD / error-density calibration feature and the keyword overview cap were not built (a keyword detector flagged about half of official band 6-8 scripts as missing an overview, so the cap stays tied to the feedback call's flag).
- Analysis latency is still about 26 s: the K=3 scorer calls dominate and the early exit fires only when the first two samples agree. A live run of a 272-word essay took 27 s.
- Pronunciation without word-level evidence is capped at 7, not 6, so clean speakers are not penalised. The audio pass can still over-score TTS voices.
- The status endpoint has no `partial`, so the web refetches the full attempt on stage change. `metrics.fluency` is not typed in OpenAPI, so the iOS `profile` decode is not schema-checked.
- Hierarchy on the fluency tab is only partly improved (section headings are the same size). Streaming TTS for the live examiner is not done. The Scribe prolongation threshold and disfluency tagger are validated only on scripted fixtures.
- Unreviewed screens: full-test session, live examiner and review/history at 1440, most 390 px dark screens. The AI models section of Settings was only glimpsed.

## Iteration 6

### Scores

| Dimension | Score | Summary |
|---|---|---|
| performance | 8.6 | Every API call measured runs at 1-5 ms p50. Production build: FCP 136-360 ms, LCP 320-710 ms, 0 CLS, about 136 KB gzip eager JS. Weak spots: AI pipeline wall time (26 s), a 60 KB gzip shared overlay chunk loaded on nearly every signed-in route, the 105 KB recharts chunk on the speaking result page, a few non-indexed query paths that are fine at 1k rows. |
| Ease of use (first-time candidate, 390x844 and 1440x900) | 7.4 | Core flows are clear with few clicks; under-250-words confirm, actionable "no speech" state, early writing feedback while the band is checked. Remaining trust and clarity issues: the writing result said an off-topic essay was capped and also not capped; Pronunciation 8.0 beside Fluency 4.0 reads as broken; tall mobile result hero; unclear 'Pace: listening'; title cut mid-word; disabled live Start button. Not walked: review deck with cards due, full-test flows, live examiner session. |
| UI/UX visual quality | 7.2 | Coherent Ocean Teal system in light and dark, no horizontal scroll, no page errors. Fixed from iteration 5: mistakes empty state, pause chips, speaking off-topic note, live start button. Remaining: tall mobile hero, clipped mobile tabs and chips, writing off-topic banner above the tabs, flat dashboard charts, low-contrast disabled states. About 12 of 88 screenshots were read. |
| features | 8.3 | Nearly every spec feature works end to end (writing T2 with plan and retry, speaking with disfluency analysis, turn-based live examiner with TTS, Realtime token, SRS and mistakes loop, progress, bank gating, editor rules). Gaps: writing editor route differs from the spec, speaking session report shows one overall number, thin writing error recall, 1-band stub essays drag the dashboard. Unverified: live/finish, Realtime WebRTC, iOS runtime, disfluency recall. |
| SCORING ACCURACY | 6.5 | Usable and unbiased overall, better at the top than iteration 5, but misses the release gate and is noisy run to run. Harness test split (luna, n=42): MAE 0.48, QWK 0.83, SMD -0.07, 86% within 0.5, band >= 7 bias -0.35 CI [-0.69, -0.06]. Own 18-script full-pipeline run: MAE 0.53, bias -0.08, max error 2.0. Probes: ceiling 35/48, floor 1/3, prompt-copy 4/4, error-density chains 12/12, no-overview 1/1. |

### Key evidence

- Spend was held under the $3 budget by reusing the scoring cache; openai/gpt-6-sol was tested and rejected (13 essays: Sol QWK 0.85, MAE 0.58, band 7+ bias -0.75; Luna QWK 0.89, MAE 0.54, bias -0.25, at 15-20x lower cost). Luna stays the grader.
- A facts-first two-stage grader was worse (test QWK 0.68), but errors per 100 words alone correlates -0.66 with the gold band, so density is used as a calibration feature only.
- Performance: the eager graph is about 136 KB gzip; API p50 1-5 ms; the status endpoint payload is 60 B and the web polls it instead of the full attempt. Writing wall time 26 s (feedback about 13 s, scoring about 13 s before the parallelisation fix below).
- Scoring: one run-to-run swing (cam-5-2-w1, official 8, scored 6.0 then 7.0) traced to the feedback call's "no overview" flag, not to scorer temperature. cam-5-5-w2 is a truncated source excerpt (191 words) and is now excluded from MAE and the fit.
- Speaking: fluent sample 8, halting sample 4.5, ordering correct, error timestamps match word times. Articulation rate was wrong (262 and 356 wpm), pronunciation sat 2 bands above fluency on halting speech, and 'like' / 'you know' fillers were missed.

### What was fixed

- Scoring: the default map is now a 4-knot map on raw mean plus grammar-error density (knots 3.5, 4.5, 7.5, 8.5), fitted on the calibration split plus calibration-only anchors, ceilings and 6 authored floors, so it can reach 8.5-9. Grammar density caps GRA at 4 above 12 per 100 words and the overall at 4 above 14. The copied-prompt rule now caps LR and GRA as well as TR. TA is capped at 7 when the feedback call lists an off-topic paragraph. Scorer and feedback calls run in parallel, so wall time is the slower of the two. Server-side test result after the fix: MAE 0.45, QWK 0.85, band >= 7 bias -0.47 CI [-0.65, -0.29], band <= 5 bias +0.14, floor probes 3/3; band 8 bias is still -0.63 (n=4).
- Speaking: articulation rate uses first-to-last word span minus pauses and fillers (260 wpm clamp, with a test); pronunciation is capped at FC + 1 when FC <= 4; 'like' and 'you know' are detected context-aware; the web flags pronunciation more than 2 bands above fluency as "Audio check only, low confidence" with a widened range.
- Web writing result: the cap sentence no longer contradicts the banner; the off-topic and short-essay alerts live inside the Overview tab; the mobile hero is collapsed with a clipped title and a Show prompt toggle; criterion rows use a 240px / 1fr grid.
- Web speaking result: all five tabs fit at 390 px (Transcript is "Text" on phones), filter chips scroll with a fade, the title is "Part 1: Reading" with a question count, the mobile hero is about 140 px, pauses under 1 s are hidden inline, and only the three worst fluency measures get text badges. The hub shows "Start with one part" first for users with no attempts.
- Shell: the live pre-screen requests the mic on entry and Start is never disabled; the review empty state distinguishes "No cards yet" from "All caught up" using the new `deck` field on `/api/cards/due`; the model reset label shows the display name; the dashboard minutes use `formatMinutes` ("<1 min"); the dashboard chart shows per-criterion bars under 3 attempts and direct-labelled lines after; the auth layout is centred; the mobile tab bar shows the current More page.

### Verification

`pnpm typecheck` clean, `TEST_DB=verify pnpm test` passes (core 59, web 82, server 125 with 1 skipped), `pnpm build` passes, `pnpm gen:api` regenerated `openapi.json` and `schema.d.ts`, Playwright e2e 6/6 (desktop and mobile).

### Remaining gaps

- Accuracy still does not clear the full gate: band 8 is biased low (-0.63, n=4, regression to the mean), mid-range Task 1 scripts are over-scored by 0.5-1.0, and the same essay can still swing a band between runs through the feedback call's overview flag. Weighted knots, isotonic fits and extra knots traded top-end bias against MAE.
- Pronunciation is only tempered client-side plus a server cap at FC + 1; articulation rate on the TTS samples (215-258 wpm) is the fast synthetic speech itself.
- Live Part 1 attempts title from the first topic only; a multi-topic title or per-question topics needs a server change. The speech-to-text default model depends on an env var and is still hard-coded in `ModelPicker.tsx` (`DEFAULT_MODELS`); the server should expose real defaults.
- Dashboard minutes already round up on the server; seconds are not exposed.
- Unreviewed or unwalked: review deck with cards due, full-test flow, live examiner session, history/settings/signup screens, iOS runtime (not built), Realtime WebRTC and `/api/live/finish`.
