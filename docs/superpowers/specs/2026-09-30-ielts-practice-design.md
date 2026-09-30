# IELTS Practice (Speaking + Writing): Design Spec

Date: 2026-09-30. Status: approved in chat (§1 architecture, §2 features). Research basis: `docs/research.md`.

## 1. Goal

A public web app plus a native iOS app that measurably improves IELTS **Speaking** and **Writing** scores through:
- realistic timed practice,
- honest, descriptor-anchored scoring,
- focused feedback,
- repetition loops.

Listening and Reading are out of scope.

Success criteria:
- A user can complete a full speaking test (practice or live) or a writing task, and get a per-criterion band with a range and descriptor evidence within about 60 s.
- Every flagged mistake is locatable: a timestamp for audio, a character span for text.
- Scores are not inflated. The scoring prompt is conservative, and a script must fully fit a band before it is awarded.
- Web and iOS use the same documented API (`/openapi.json`).
- Self-evaluation loop: the product is scored /10 on performance, ease of use, UI/UX and features, and iterated until every score is ≥ 8.

## 2. Stack & repo

The repo is public on GitHub (`soyeb-jim285/ielts-practice`) as a pnpm workspace:

```
apps/server     Hono (Node 22+), @hono/zod-openapi, Scalar UI at /docs, spec at /openapi.json
                Better Auth (email+password, email verification + reset via Resend, bearer plugin for iOS)
                Drizzle ORM + PostgreSQL 17; R2 via @aws-sdk/client-s3 (+ presigner)
                serves apps/web/dist statically in production
apps/web        Vite + React 19 + TanStack Router + TanStack Query + Tailwind v4 + Recharts
                typed API client generated from /openapi.json (openapi-typescript + openapi-fetch)
apps/ios        SwiftUI (iOS 17+), Swift Package with swift-openapi-generator client, XcodeGen project
packages/core   pure TS: speech metrics, text metrics, band rounding, IELTS timing constants (unit tested)
scripts/        seed-bank (generate prompt bank via OpenRouter), cambridge-extract (private), openapi export
docker-compose.yml   app + postgres + nightly pg_dump → R2
```

The CI is GitHub Actions and has three jobs:
1. `check`: pnpm install, typecheck, test, and web build.
2. `docker`: builds the image and pushes it to `ghcr.io/soyeb-jim285/ielts-practice`, on `main` only.
3. `ios`: runs on macOS. It installs XcodeGen, generates the project, then runs an `xcodebuild` build for the iOS Simulator and uploads the `.app` artifact. Signing and archiving come later, once the user adds certificates.

Secrets are read from env; `.env.example` is committed.

| Service | Env vars |
|---|---|
| Database | `DATABASE_URL` |
| Better Auth | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` |
| AI | `OPENROUTER_API_KEY`, `OPENAI_API_KEY` (optional) |
| R2 | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` |
| Email | `RESEND_API_KEY`, `EMAIL_FROM` |
| Cambridge access | `CAMBRIDGE_ALLOWED_EMAILS` (default `soyebjim@gmail.com`) |

## 3. Data model (Postgres / Drizzle)

- Better Auth tables: `user`, `session`, `account`, `verification`.
- `user_settings`:
  - `userId` PK
  - `models` jsonb: `{ analysis, examiner, stt, tts, ttsVoice, audioPron }`
  - `audioPronEnabled` bool
  - `liveProvider`: `'turn' | 'openai-realtime'`
  - `targetBand` numeric
  - `writingAutoSubmit` bool
  - Defaults are resolved server-side, so rows can be sparse.
- `prompts`:
  - `id`
  - `skill`: `speaking | writing`
  - `part`: `1 | 2 | 3` for speaking, `1 | 2` for writing
  - `variant`: `academic | general`
  - `type`: e.g. `opinion`, `line-graph`, `letter-formal`, `cue-card`
  - `topic`
  - `title`, `body`
  - `bullets` jsonb (cue card / letter points)
  - `followUps` jsonb (P2 follow-ups, and linked P3 questions)
  - `chart` jsonb (data for generated T1 charts)
  - `imageKey` (R2, for Cambridge T1)
  - `source`: `generated | cambridge`
  - `sourceRef` (e.g. `C17 T2`)
  - `restricted` bool
  - `groupId` (links P1 set / P2 card / P3 set into one test)
- `attempts`:
  - `id`, `userId`, `promptId`, `skill`, `part`
  - `mode`: `practice | live | exam`
  - `sessionId` (groups parts of a full test)
  - `audioKey`, `text`, `durationMs`
  - `status`: `recording | analyzing | done | failed`
  - `error`
  - `parentAttemptId` (retry chain)
  - `createdAt`
- `analyses`:
  - `attemptId` PK
  - `result` jsonb (schema in §6)
  - `overall` numeric
  - `criteria` jsonb: `{fc, lr, gra, p}` or `{ta, cc, lr, gra}`
  - `models` jsonb (which models produced it)
- `mistakes`:
  - `id`, `userId`, `attemptId`
  - `category`: `grammar.article | grammar.tense | lexis.collocation | cohesion.overuse | …`
  - `original`, `correction`, `explanation`
  - `createdAt`
- `cards` (SRS):
  - `id`, `userId`
  - `front`, `back`
  - `source`: `mistake | vocab`
  - `ease`, `interval`, `due`, `reps`
  - Scheduling uses SM-2.

Cambridge gating is enforced server-side in every prompt query (`restricted = false OR email ∈ allowlist`). R2 image URLs are presigned only after the same check. Extracted Cambridge data never enters git: the extractor writes to the DB and R2 directly, and `data/cambridge/` is gitignored.

## 4. API (all under `/api`, all described in OpenAPI with zod schemas)

| Method | Path | Purpose |
|---|---|---|
| * | `/api/auth/*` | Better Auth (sign-up/in/out, verify, reset; bearer token for iOS) |
| GET | `/api/me` | user + settings + `cambridgeAccess` |
| GET/PUT | `/api/settings` | settings |
| GET | `/api/models?capability=text\|audio-in\|stt\|tts` | proxied, cached OpenRouter model list filtered by modality |
| GET | `/api/prompts?skill&part&type&topic&source&q&page` | bank, with `done` flag per prompt |
| GET | `/api/prompts/:id` | single prompt (image URL presigned) |
| GET | `/api/speaking/test` | random linked set: P1 questions (3 topics × 4 q) + P2 card + P3 questions |
| POST | `/api/attempts` | create attempt → returns `{id, uploadUrl}` for audio (presigned PUT) or accepts `text` |
| POST | `/api/attempts/:id/submit` | start analysis (async). Response returns immediately |
| GET | `/api/attempts/:id` | attempt + analysis + presigned audio URL; clients poll until `done` |
| GET | `/api/attempts?skill&page` | history |
| POST | `/api/live/turn` | turn-based examiner. Body: session state + user audio key → `{transcript, examinerText, audioUrl, state}` |
| POST | `/api/live/realtime-token` | ephemeral OpenAI Realtime client secret with examiner instructions (only if key set + enabled) |
| POST | `/api/live/finish` | stores full live session recording + per-turn segments → analysis |
| GET | `/api/progress` | band trend per criterion, streak, minutes, weakest criterion, top recurring mistake categories |
| GET | `/api/mistakes?category` | error log |
| GET | `/api/cards/due`, POST `/api/cards/:id/review`, POST `/api/cards` | SRS |
| GET | `/api/health` | liveness |

Analysis runs in-process: a fire-and-forget promise tracked by a DB status field. On server start, `analyzing` rows older than 10 min are marked `failed` with a retry option.
*ponytail:* this is an in-process queue. Add a real queue (pg-boss) if concurrent load demands it.

## 5. Speaking pipeline

**Recording:**
- Web uses `MediaRecorder`, opus/webm (m4a on Safari). iOS uses `AVAudioRecorder` producing AAC m4a, 16 kHz mono.
- The client also records a **voice-activity timeline**: RMS energy per 50 ms frame, compressed to one byte per frame. It is sent with the submit request and powers filled-pause detection (below) and the live waveform.

**Analysis steps (server):**
1. **STT**: OpenRouter `/api/v1/audio/transcriptions` using the `models.stt` setting (default `openai/whisper-large-v3`), with `verbose_json` and `timestamp_granularities: ["word","segment"]`. Output is words `{w, start, end, conf}`.
2. **Deterministic metrics** (`packages/core/speech.ts`):
   - `wpmSeries`: 10 s windows, 5 s hop.
   - `speechRate`: words/min over total time.
   - `articulationRate`: over phonation time.
   - `pauses`: gaps ≥ 250 ms between words. Each is classified as `short` (< 1 s) or `long` (≥ 1 s), and as `midClause` or `boundary` (boundary when the previous word ends a sentence or clause per punctuation or a conjunction list).
   - `mlr`: mean words between pauses ≥ 250 ms.
   - `pauseRatio`.
   - `fillers`: lexical fillers ("um, uh, er, like, you know, I mean" when transcribed) plus **voiced gaps**, i.e. inter-word gaps ≥ 300 ms where the energy timeline shows voice. These are counted as filled pauses or unclear speech, because Whisper drops "um".
   - `repetitions`: immediate repeated 1–3-grams.
   - `selfCorrections`: repetition followed by an altered word.
   - `unclearWords`: `conf < 0.6`, graded into 3 tiers.
   - `lexical`: MTLD, type-token ratio, less-common-word %, overused words.
3. **Optional audio-LLM pronunciation pass** (setting `audioPronEnabled`, model `models.audioPron`, e.g. `google/gemini-2.5-flash`). The audio and transcript go to a chat model with audio input. It returns JSON: mispronounced words with time and issue (sound, stress, intonation), a prosody comment, and a pronunciation band estimate.
4. **LLM rubric pass** (`models.analysis`, structured JSON output, temperature 0.2). Inputs:
   - the prompt(s),
   - the timestamped transcript (word indices),
   - the metrics,
   - the pronunciation evidence,
   - the condensed official descriptors for bands 4–9.

   It returns the schema in §6. The rules are strict: award a band only if all its positive features are met, cite a descriptor phrase for each criterion, and give a range. Errors reference word index spans. Top 3 fixes. Topic relevance for each answer. A band+1 rewrite that is labelled "don't memorise". Mistake categories come from a fixed taxonomy.
5. **Band maths**: criteria are whole bands. Overall = mean, rounded by the IELTS rule (.25 → .5, .75 → next whole band). The raw value is shown too.
6. Mistakes are persisted and SRS cards are offered (not auto-created; the user clicks "add to deck").

**Full test:** each part is its own attempt sharing a `sessionId`. The session report aggregates the criteria across parts, weighted by speaking time.

**Live mode:**
- **Turn-based** (default):
  - Client-side VAD (energy threshold + 1.2 s trailing silence) ends the user's turn.
  - The audio chunk goes to R2, then `/api/live/turn`, which runs STT then the examiner LLM (`models.examiner`), and returns the next line plus TTS audio (`models.tts` + voice) through R2.
  - The examiner prompt encodes the real script: intro/ID, P1 × 3 topics, P2 card (the server starts a 60 s prep timer, then a 2 min talk with the examiner cutting in at 2:00), P3 linked, and the close.
  - The server is authoritative for state (part, elapsed, questions asked). The client shows the current part, a timer, and the examiner caption.
- **OpenAI Realtime** (if `liveProvider = openai-realtime` and the server has `OPENAI_API_KEY`):
  - The server mints an ephemeral token carrying the same examiner instructions. Web connects over WebRTC; iOS connects over WebSocket (`URLSessionWebSocketTask` + `AVAudioEngine` PCM16, no extra dependency).
  - The client records its own mic track locally for analysis.
- Both variants end in `/api/live/finish`, which runs the same pipeline per part (split by part-change timestamps).

## 6. Analysis result schema (shared, versioned `v: 1`)

```ts
{
  v: 1, skill, overall, overallRaw, range: [lo, hi],
  criteria: { [key]: { band, range, descriptor: string, evidence: string[], summary } },
  topFixes: [{ title, why, example: { before, after } }] // exactly 3
  errors: [{ id, category, severity: 'minor'|'major', span: { start, end } /* word idx or char offsets */,
             original, correction, explanation, time?: number }],
  // speaking only
  words?: [{ w, start, end, conf }], metrics?: SpeechMetrics, pronunciation?: { unclear: [...], llm?: {...} },
  relevance?: [{ questionIdx, onTopic: bool, note }],
  // writing only
  structure?: { paragraphs: [{ role, topicSentence, ok, note }], overview?: {...}, position?: {...} },
  cohesion?: { linkers: [{ word, count, overused }] }, textMetrics?: {...},
  rewrite: { text, note }, comparison?: { parentAttemptId, deltas: {...} }
}
```

## 7. Writing

- **Editor:**
  - `<textarea spellcheck="false" autocorrect="off" autocapitalize="off" autocomplete="off" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false">`.
  - Paste into the answer is blocked (toggle in settings).
  - On iOS, `UITextView` with `autocorrectionType = .no`, `spellCheckingType = .no`, `smartQuotesType/DashesType/InsertDeleteType = .no`, `inlinePredictionType = .no`.
- **Timer:** T1 20 min, T2 40 min, full 60 min. Countdown with amber at 5 min and red at 1 min. Auto-submit at 0 (setting, default on). Live word count is red under 150/250.
- **T1 Academic:**
  - Generated prompts carry `chart` JSON, rendered by Recharts on web and Swift Charts on iOS (line, bar, pie, table). Process and map prompts are text-described or SVG in generated data.
  - Cambridge prompts use the cropped image.
- **T1 General:** letter with 3 bullets.
- **Optional planning pad** for T2 (5 min, not graded). The analysis reports whether the essay followed the plan.
- **Analysis:**
  - The LLM rubric with TA/TR, CC, LR, GRA.
  - Deterministic text metrics (`packages/core/text.ts`): word count, paragraphs, sentence length, MTLD, linker counts against a curated list with an overuse threshold, repeated words.
  - Structure check: T1 overview present, states main trends, no data in the overview. T2 position is clear and consistent, and body paragraphs have topic sentences.
  - Errors carry char spans.
- **Retry** creates a child attempt. The result shows the criterion deltas and a word diff against the parent.

## 8. Content

- **Generated bank** (`scripts/seed-bank.ts`, committed JSON under `data/bank/`, idempotent seed):
  - Speaking: about 60 P1 topics × 4–5 questions, about 120 P2 cue cards each with a linked P3 set (5–6 questions), about 80 standalone P3 themes.
  - Writing: about 120 T2 prompts covering all 5 essay types across topics, about 60 Academic T1 prompts with chart JSON, about 30 GT letters.
  - Generated by OpenRouter in batches, deduped by normalised title, and reviewed by a sampling script.
- **Cambridge** (`scripts/cambridge-extract.py`, gitignored output):
  - PyMuPDF text extraction per book. Scanned pages fall back to a vision LLM through OpenRouter.
  - An LLM segments out Writing T1/T2 and Speaking P1/P2/P3.
  - The T1 figure region is cropped to PNG and uploaded to R2 `cambridge/…`.
  - Rows are inserted with `restricted = true` and `sourceRef = "C{book} T{test}"`.

## 9. UX

- **Visual direction:** calm, focused, and readable. Neutral warm surfaces and one accent colour. Semantic colours: green good, amber watch, red issue. Light and dark themes, mobile-first. Exam screens are distraction-free with large type and a timer. Results pages are information-rich but tabbed.
- **Web routes:**

  | Route | Screen |
  |---|---|
  | `/` | dashboard |
  | `/speaking` | choose: full test / part / live |
  | `/speaking/session/:id` | recording flow |
  | `/speaking/result/:attemptId` | results |
  | `/writing` | writing home |
  | `/writing/:promptId` | editor |
  | `/writing/result/:attemptId` | results |
  | `/bank` | prompt bank |
  | `/mistakes` | error log |
  | `/review` | SRS |
  | `/history` | past attempts |
  | `/settings` | settings |
  | `/login`, `/signup` | auth |

- **Recording UI:** big mic button, timer with target zones (P1 answer 15–40 s; P2 60–120 s, green from 1:30; P3 30–60 s), live waveform, live WPM pill (from local VAD syllable estimate), and a silence warning after 3 s.
- **Results tabs:** Overview · Transcript · Fluency · Language · Improve (for writing, Fluency becomes Structure). The Transcript is interactive: clicking a word seeks the audio, hovering or tapping an error opens its explanation, and a filter shows only grammar, lexis, pauses or unclear words.
- **iOS:** tab bar with Home · Speaking · Writing · Review · Settings. The same flows and result tabs, native controls, Swift Charts, `AVAudioPlayer` seek-on-tap.

## 10. Error handling

- Every AI call has a timeout and one retry on 429/5xx. Failures mark the attempt `failed` with a readable message and a "Retry analysis" button; the audio and text are kept.
- LLM JSON is validated with zod, with one repair retry that sends the validation errors back.
- If STT returns no words, the result says "No speech detected".
- Uploads use presigned PUT. The server verifies the object exists before analysis.
- Rate limiting: a per-user in-memory token bucket on AI endpoints.
- Input validation happens at every route via zod-openapi.

## 11. Testing

- `packages/core`: unit tests (vitest) for pauses/MLR/WPM windows/fillers on synthetic word arrays, band rounding table, MTLD, linker overuse.
- Server: route tests with a mocked OpenRouter (injected `fetch` in the AI client) for attempts → analysis happy path, and Cambridge gating (restricted rows are hidden for other emails).
- Web: typecheck + build. Playwright smoke test for the main flows against the local stack (for self-evaluation).
- iOS: builds in CI.

## 12. Self-evaluation loop

After the build, run the app locally (docker compose) and drive it with Playwright. Score it /10 on:
- performance (Lighthouse and API latency),
- ease of use,
- UI/UX (screenshots in light and dark, mobile and desktop),
- features vs this spec,
- accuracy (score sample speaking and writing answers of known band from public band-sample essays).

Fix the lowest score and repeat until every score is ≥ 8.

## 13. Out of scope

Listening/Reading, payments, social, tutor features, Android, App Store signing/distribution (needs the user's Apple certificates).
