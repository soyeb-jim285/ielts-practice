# Admin: costs and UI

## Costs

Goal: every paid external call the server makes leaves one exact-cost row in `ai_costs`, attributed to a user, attempt and stage, so the admin can answer "what does a finished test cost, who spends it, how many days of OpenRouter balance are left". Today the admin only shows balances (`admin/costs.ts`: OpenRouter `GET /key`, ElevenLabs `GET /user/subscription`); nothing is per call.

### 1. Map of paid calls (runtime server only)

Nearly everything goes through two choke points in `apps/server/src/ai/openrouter.ts`, so recording is cheap:
- `call()` (line 56): every OpenRouter request (chat, STT, TTS). It already owns the retry loop and the key choice (`keyCtx.openrouter` = user's own key, else `env.OPENROUTER_API_KEY`). `paid_by` = `own_key` iff `keyCtx.getStore()?.openrouter` is set.
- `scribe()` (line 283): the one direct ElevenLabs call. Always house key (users with their own OpenRouter key are routed to Whisper instead, line 303).

| # | file:line | what | provider / model | belongs to | exact cost source | fail / retry |
|---|---|---|---|---|---|---|
| 1 | ai/speaking.ts:246 -> openrouter.ts `transcribe` | Speaking STT of the whole recording | ElevenLabs `scribe_v2` (house, when `ELEVENLABS_API_KEY` set and no own key), else OpenRouter `openai/whisper-large-v3` | attempt (skill speaking, part 1-3) | Scribe: no per-call price in the response; cost = audio seconds (`duration`) x plan rate per hour (env `ELEVENLABS_SCRIBE_USD_PER_HOUR`), reconciled with the `character_count` delta of `/v1/user/subscription` (already fetched by admin/costs.ts). Whisper via OpenRouter: `usage.cost` if the transcription response carries `usage` (probe once, see 4.3), else `GET /api/v1/generation?id=<x-generation-id>`, else `audio seconds x model price` from `/models` | Scribe error falls back to Whisper (a second, different-priced call; log the failed Scribe as `ok=false` with its seconds, it may still be billed). Whisper: `call()` retries 429/5xx x2, network x2; timeout (120 s) not retried |
| 2 | openrouter.ts:312 | Primed Whisper pass, parallel with plain pass (`verbatim: true`, Whisper only) | OpenRouter Whisper | attempt | same as above. This is a second full STT charge per recording; stage `stt_verbatim`. Often discarded by `verbatimSane` (`meta.kept=false`): pure waste worth showing | same |
| 3 | ai/speaking.ts:267 | Audio pronunciation pass (audio base64 + transcript) | OpenRouter `settings.models.audioPron` (default `google/gemini-2.5-flash`) | attempt | `usage.cost` | `chatJson` re-asks once on invalid JSON (bills again, `retry=true`); failure is swallowed (analysis continues), so `ok=false` rows matter here |
| 4 | ai/disfluency.ts:69 | Disfluency tagger (text) | OpenRouter `models.analysis` | attempt | `usage.cost` | same JSON re-ask; failure swallowed |
| 5 | ai/speaking.ts:296 (`feedbackOnce`) | Speaking feedback: errors, top fixes, vocab, rewrite ("improve") | OpenRouter `models.analysis` | attempt | `usage.cost` | `feedbackCall` retries once on retryable `AiError` (+ chatJson's own re-ask): up to 4 billable tries. Mark `retry=true` on all but the first |
| 6 | ai/speaking.ts:337 (`score`) | Speaking criterion scoring, SCORE_K=3 samples x 3 or 4 criteria (9-12 calls) | OpenRouter `models.analysis` | attempt, `meta.criterion`, `meta.sample` | `usage.cost` | `Promise.allSettled`; one failed sample is tolerated, so failures are silent today |
| 7 | ai/writing.ts:117 (`scoreWriting`) | Writing scorer, WRITING_K=3 joint samples (or 3 x 4 in `split` mode); `early` stops waiting but the calls still finish and still bill | OpenRouter `models.analysis` (vision when task 1 image) | attempt (writing, part = task) | `usage.cost` | `jagged()` draws 2 more samples (`meta.extra=true`); JSON re-ask |
| 8 | ai/writing.ts:302 | Writing feedback | OpenRouter `models.analysis` | attempt | `usage.cost` | `retryOnce` + JSON re-ask |
| 9 | routes/live.ts:216 | Turn-based live: STT per candidate turn (`verbatim:false`, Scribe or Whisper) | as row 1 | `session_id` (live session), no attempt yet; user pays own OpenRouter key unless owner | as row 1 | `ai()` wrapper maps errors; no retry beyond `call()` |
| 10 | routes/live.ts:241 | Turn-based live: examiner next line | OpenRouter `settings.models.examiner` (`chatText`, max 200 tokens) | session | `usage.cost` | no retry beyond `call()` |
| 11 | routes/live.ts:77 via openrouter.ts:384 `speak` | Examiner TTS; long lines split in up to 3 parallel `speakOnce` calls = up to 3 billable calls per line; cached in memory per process (cache hits cost 0, record nothing) | OpenRouter `models.tts` (default `google/gemini-3.8-flash-tts`) | session | `usage.cost` if returned, else `x-generation-id` lookup, else `characters x pricing.prompt` from `/models` (`meta.estimated=true`) | failure degrades to captions: `ok=false` row, no retry |
| 12 | routes/live.ts:280 -> ai/gpt-live.ts:38, ws 52 | GPT-Live session create + sideband / relay websocket | OpenAI `gpt-live-1` (billed $0.05/min per second, env.ts:21) | live session | the upstream `session.closed` event carries `usage` (already logged at gpt-live.ts:220 as JSON, shape not yet confirmed; store it raw in `meta.usage`). Until the shape is confirmed: `cost_usd = billed seconds x 0.05/60`, `meta.estimated=true`. Billed seconds = `session.started` to `session.closed`, falling back to `startRun`..`end()` | create failure = 0 cost. A dropped sideband loses the usage event: fall back to wall clock |
| 13 | routes/live.ts:335 -> ai/gemini-live.ts:53 | Gemini Live: server only mints a token; the browser/app talks to Google directly | Google `gemini-3.8-live` | live session | server never sees usage. Either (a) client posts the final `usageMetadata` token counts to a new `POST /api/live/gemini-live/usage` (untrusted, label `meta.reported=true`), or (b) estimate from token expiry/session length. Start with (b), `estimated=true` | n/a |
| 14 | ai/openrouter.ts:393 `listModels` | Model catalogue GET | OpenRouter | none | free, do not record | - |
| 15 | keys.ts:70-72, community.ts:12, admin/costs.ts:31,41 | Key validation, balance, subscription lookups | OpenRouter / OpenAI / Gemini / ElevenLabs | none | free, do not record | - |

Not runtime, not recorded in `ai_costs`: `scripts/gen-lr-*.ts`, `gen-lr-elevenlabs.py`, `gen-speaking-audio.py`, `lr-timings.py` (content generation, already logged to `data/*cost*.log`; ElevenLabs TTS lives only here, the server never calls ElevenLabs TTS). Listening/Reading attempts make no AI calls, so there is no `lr_attempt_id` column: an `lr_attempts` row can never own a cost. (Drop that column from the requested schema; add it only if LR ever gets AI feedback.)

Who pays: `paid_by='own_key'` when the call ran with the user's own OpenRouter key (`keyCtx.openrouter`), the user's OpenAI key (GPT-Live) or Gemini key. Owner using server keys, guests and community tier = `house`. Note that community analysis is forced to default models (jobs.ts), so house cost per attempt is predictable; own-key users may pick any model.

### 2. Getting the exact cost

- OpenRouter chat: add `usage: { include: true }` to the request body in `chat()`. The response then has `usage.{prompt_tokens, completion_tokens, cost}`; `cost` is USD actually charged (0 on a BYOK-free route is not expected; for BYOK keys OpenRouter reports `usage.cost` as its fee and `cost_details.upstream_inference_cost` as provider cost: store the sum in `cost_usd`, the parts in `meta`). Also read `data.id` and `data.provider`/`data.model` (already read as `Served`).
- OpenRouter STT/TTS: the response format is not documented to include `usage`. Do a one-time probe on the local stack with a 1 s clip and a short TTS line; log keys of the JSON body / response headers. Plan: use `usage.cost` if present; else capture the generation id (header `x-generation-id` or body `id`) and a background `reconcile()` that calls `GET /api/v1/generation?id=` (returns `total_cost`, `tokens_*`) a few seconds later and updates the row (`meta.reconciled=true`); else estimate (`meta.estimated=true`) from `/models` pricing and audio seconds/characters. Estimated rows are flagged in the UI.
- ElevenLabs Scribe: bill by audio duration. Record `audio_seconds`; `credits` = seconds-based credits from the plan; `cost_usd = credits x (plan_price / plan_credits)`. Read the plan price once from env (`ELEVENLABS_USD_PER_CREDIT`) and keep the nightly check: sum of `credits` for the period vs `characterCount` delta from `/user/subscription` (cached 5 min already), shown as a drift warning if more than 5 percent apart.
- Global reconciliation (cheap, trusts the provider): every 15 min store `usage` from `GET /api/v1/key` (already fetched) in a tiny `ai_cost_checks (at, openrouter_usage numeric)`; the admin shows "recorded by us" vs "OpenRouter says" per day so any unrecorded call site shows up as drift. Alternatively skip the table and compare `usage_daily` live (the key endpoint returns `usage_daily|weekly|monthly`). Prefer the live compare: no new table.
- GPT-Live: see row 12. Gemini Live: row 13.
- Retries: every attempt that may be billed is its own row. `call()` retries on 429/5xx/network are normally not billed (OpenRouter only charges completed generations); record them only as `retry` counters in the successful row's `meta.httpRetries` (n). A timeout (`AiError timeout`) may have been billed without us seeing it: record a zero-cost `ok=false` row with `meta.timeout=true` and let the key-usage drift reveal it. `chatJson`'s JSON re-ask and the writing/speaking `retryOnce` are real extra generations: each is a separate row with `retry=true`.

### 3. Ledger table `ai_costs`

Migration `apps/server/drizzle/0012_ai_costs.sql` (generate via drizzle-kit, name `ai_costs`). Add to `db/schema.ts`:

```ts
// One row per paid external call (docs/admin/COSTS-AND-UI.md). Append-only; survives attempt/user deletion for the books (no FKs).
export const aiCosts = pgTable('ai_costs', {
  id: id(),
  createdAt: createdAt(),
  userId: text('user_id'),                 // no FK on purpose: deleting a user must not erase what was spent
  attemptId: text('attempt_id'),           // speaking/writing attempt; null for live turns before an attempt exists
  sessionId: text('session_id'),           // test session (attempts.sessionId) or live_sessions.id
  promptId: text('prompt_id'),             // for "by test/prompt"
  skill: text('skill'),                    // 'speaking' | 'writing'
  part: integer('part'),
  stage: text('stage').notNull(),          // stt | stt_verbatim | pronunciation | disfluency | feedback | score | examiner_llm | examiner_tts | live_realtime
  provider: text('provider').notNull(),    // openrouter | elevenlabs | openai | gemini
  model: text('model').notNull(),          // requested model; meta.served has the one that answered
  paidBy: text('paid_by').notNull(),       // 'house' | 'own_key'
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  audioSeconds: numeric('audio_seconds', { mode: 'number' }),
  characters: integer('characters'),
  credits: numeric('credits', { mode: 'number' }),
  costUsd: numeric('cost_usd', { precision: 12, scale: 6, mode: 'number' }).notNull().default(0),
  ok: boolean('ok').notNull().default(true),
  retry: boolean('retry').notNull().default(false),
  meta: jsonb('meta').$type<Record<string, unknown>>(), // generationId, served provider, estimated, reconciled, criterion, sample, extra, kept, timeout, httpRetries, usage (raw)
}, (t) => [
  index('ai_costs_created_idx').on(t.createdAt),
  index('ai_costs_attempt_idx').on(t.attemptId),
  index('ai_costs_user_created_idx').on(t.userId, t.createdAt),
  index('ai_costs_session_idx').on(t.sessionId),
]);
```

Column notes: `lr_attempt_id` omitted (see above). Money as `numeric(12,6)`, summed in SQL, never floats in JS beyond display. Retention: keep forever (a few thousand rows a month); no cleanup job.

### 4. Recording: one helper, three touch points

#### 4.1 Context (extends what already exists)

`ai/keyctx.ts` already carries per-request provider credentials through `AsyncLocalStorage`, so call sites need no new parameters. Add an optional cost context to `KeyCtx`:

```ts
export type CostCtx = { userId?: string; attemptId?: string; sessionId?: string; promptId?: string; skill?: 'speaking' | 'writing'; part?: number };
export type KeyCtx = { openrouter?: string; onAuthFail?: () => void; cost?: CostCtx };
```

Set it where the ctx is already created:
- `jobs.ts:37` (`analyze`): `cost: { userId: a.userId, attemptId: a.id, sessionId: a.sessionId ?? undefined, promptId: a.promptId, skill: a.skill, part: a.part }`. Covers rows 1-8.
- `quota.ts:209` `withPayer`: `cost: { userId: u.id }`; `routes/live.ts` `loadSession` then does `keyCtx.getStore()!.cost!.sessionId = sessionId` (mutating the object is fine, it is request scoped). Covers rows 9-11.
- GPT-Live: `startRun` already has `userId` and `sessionId`; record from the `session.closed` branch (gpt-live.ts:220) and, as fallback, `end()`.

The stage cannot come from the context (one attempt runs many stages in parallel), so add one optional field `stage` to `chatJson`, `chatText`, `transcribe`, `speak` (6 call sites listed above pass a literal string; default `'other'`). `retry` for the re-ask is known inside `chatJson` (`attempt > 0`) and for `retryOnce`/`feedbackCall` by a small wrapper that sets `meta.retry`; simplest: those two helpers pass `{ retry: true }` through the same options object on the second call.

#### 4.2 The helper

New file `apps/server/src/ai/cost.ts`:

```ts
export type CostRow = { stage: string; provider: string; model: string; costUsd: number; ok?: boolean; retry?: boolean;
  inputTokens?: number; outputTokens?: number; audioSeconds?: number; characters?: number; credits?: number; meta?: Record<string, unknown> };
/** Never throws, never awaited on the hot path: a ledger failure must not fail a test. */
export function recordCost(row: CostRow): void {
  const ctx = keyCtx.getStore();
  const c = ctx?.cost;
  void db.insert(aiCosts).values({ ...row, userId: c?.userId, attemptId: c?.attemptId, sessionId: c?.sessionId, promptId: c?.promptId,
    skill: c?.skill, part: c?.part, paidBy: ctx?.openrouter ? 'own_key' : 'house' }).catch((e) => console.error('recordCost', e.message));
}
```

GPT-Live/Gemini pass `paidBy` explicitly (their key is not in `keyCtx.openrouter`): add optional `paidBy` to `CostRow` overriding the default. Under vitest the table is truncated with the rest (add `ai_costs` to test/setup.ts TRUNCATE).

#### 4.3 Call sites

1. `openrouter.ts chat()` after the response parses: `recordCost({ stage, provider: 'openrouter', model: data.model ?? body.model, inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens, costUsd: usage.cost + (usage.cost_details?.upstream_inference_cost ?? 0), meta: { generationId: data.id, served: data.provider } })`. Request body gets `usage: { include: true }`. A thrown `AiError` after the retries: one zero-cost `ok:false` row (`meta.status`) so failure waste and timeouts are visible.
2. `stt()` and `speakOnce()`: same, plus the probe/generation-id/estimate fallback chain from section 2; `speakOnce` records `characters: o.text.length`; chunks give one row each.
3. `scribe()`: success row with `audioSeconds = duration`, `provider:'elevenlabs'`, `credits`, computed `costUsd`; on throw, an `ok:false` row (seconds from the recording's `durationMs`), then the Whisper fallback records its own row with `meta.fallbackFrom:'scribe'`.
4. `gpt-live.ts` `session.closed` handler: parse `ev.usage` and write `live_realtime`, `provider:'openai'`, `model: env.OPENAI_LIVE_MODEL`, `audioSeconds`, `paidBy` from `payer.keys.openai ? 'own_key' : 'house'` (the run needs `paidBy` stored at `startRun`), `meta.usage` raw.
5. Gemini: row 13.
6. Speaking `noSpeech` result and failed analyses still keep their rows: cost was spent, the quota is refunded (`refundAttempt`), so the page shows "refunded but cost X".

Verify before building the rest: a unit test per path with the injected fetch (`setFetch`) returning `usage.cost`, asserting the row; a test that `recordCost` swallows a DB error; a test that the admin response never includes meta keys other than the whitelist.

### 5. Admin API (all `adminRoute`, owner only, 404 for others, numbers only)

New `apps/server/src/admin/spend.ts` (do not grow costs.ts; keep its balance code), registered in `admin/index.ts`. Add `Spend*` zod schemas to `admin/schemas.ts`. All money is `number` USD rounded to 6 decimals; all days use `dhakaDay` and `daysAgo` from `admin/common.ts`. Common query: `days` (1-365, default 30), `paidBy` (`house|own_key|all`, default `house` because the owner cares what the house pays; the balance forecast always uses house).

| Endpoint | Returns |
|---|---|
| GET `/api/admin/spend/summary` | today / 7d / 30d / all-time totals, split house vs own_key; calls count; ok-rate; waste (below); avg cost per finished attempt (30d, per skill and per skill+part); live reconciliation: recorded vs OpenRouter `usage_daily|weekly|monthly` (from existing `getCosts()`), with a drift warning |
| GET `/api/admin/spend/series?bucket=day\|week\|month&days=` | `[{ date, house, ownKey, calls }]`, Dhaka buckets; stacked chart on the web |
| GET `/api/admin/spend/by?dim=stage\|model\|provider\|skill_part\|user\|prompt&days=&limit=` | `[{ key, label, costUsd, calls, avgPerCall, share }]`; `user` joins `"user"` for email and guest label (`guestLabel`), `prompt` joins `prompts` for title/source and attempt count so you see cost per test |
| GET `/api/admin/spend/attempt/{id}` | the attempt (skill, part, user, status, createdAt) with its line items in time order (stage, model, tokens/seconds/characters, costUsd, ok, retry, estimated flag), subtotal per stage, total, and waste. For a speaking part that belongs to a session, also `sessionTotal` across the sessionId |
| GET `/api/admin/spend/waste?days=` | failed-or-retried spend: `ok=false` rows, `retry=true` rows, discarded primed-Whisper (`stt_verbatim` with `meta.kept=false`), extra jagged samples, attempts that ended `failed` or got refunded (join `attempts.status`, `quota_usage.refunded_at`); each with total and its share of all spend |
| GET `/api/admin/spend/forecast` | see below |

Per-attempt average (the key number): `sum(cost_usd) where attempt_id in (finished attempts) / count(finished attempts)`, grouped by `skill, part`, computed over `attempts.status='done'` created in the window, house-paid only; failed attempts' cost goes into waste, not the average, and the page shows both ("$0.041 per finished part, +$0.006 waste").

Forecast: `remaining` = `getCosts().openrouter.remaining` (key limit minus usage). `burn` = house OpenRouter spend per day, using the mean of the last 7 full Dhaka days (and 14-day mean as a second figure); `daysLeft = remaining / burn`, `runsOutOn = today + daysLeft`. Also `usableLeft = remaining - COMMUNITY_MIN_BALANCE` (community tests stop at the floor) and `testsLeft = usableLeft / avgCostPerFinishedTest`. If burn is 0 or there is no limit: `daysLeft: null`. ElevenLabs gets the same treatment on credits (`characterLimit - characterCount` over recorded `credits` per day, until `resetsAt`). Warn when `daysLeft < 7` (`low`) or `< 3` (`critical`), feeding the existing `warnings` list of `/api/admin/costs`.

Sketch SQL (`rows()` helper style as in `admin/stats.ts`): `select ${dhakaDay(sql`created_at`)} d, sum(cost_usd) filter (where paid_by='house') house, sum(cost_usd) filter (where paid_by='own_key') own, count(*) from ai_costs where created_at >= ${daysAgo(days)} group by 1 order by 1`.

### 6. Web (belongs to the UI section of this doc)

Extend the existing `routes/_app/admin/costs.tsx` rather than adding a route: balance cards on top (unchanged), then the forecast banner, the daily stacked bar (house / own key), a "Where it goes" table with a dimension switch (stage, model, skill+part, user, test), the waste panel, and a per-attempt drawer reachable from every attempt link in the admin (users page, attempts lists): line items with an "estimated" chip. Client in `lib/admin.ts`. Stay on OpenRouter dollars as the primary unit; ElevenLabs shows credits next to dollars.

### 7. Build order and decisions

1. Table + `recordCost` + context + `chat()` recording (covers rows 3-8, 10, most of the money). Tests.
2. STT/TTS/Scribe recording after the one-off probe on the local stack (never production) decides exact vs estimated.
3. Admin endpoints + page.
4. GPT-Live usage (needs one real session to confirm the `session.closed.usage` shape) and Gemini estimate.

Open items to verify, not assume: (a) whether OpenRouter's `/audio/transcriptions` and `/audio/speech` return `usage`/a generation id; (b) the `usage` shape in GPT-Live `session.closed`; (c) the ElevenLabs Scribe price on the actual plan; (d) BYOK `cost_details` fields for own-key OpenRouter calls. Until confirmed, those rows are written with `meta.estimated=true` and shown with an "estimated" chip, and the drift check against OpenRouter's own `usage_daily` keeps the totals honest.

## UI

Audit and redesign spec for the whole owner area. Method: impeccable critique/audit (product register), redesign-existing-projects, design-taste-frontend and high-end-visual-design read as guardrails (their marketing-page rules do not apply to a dense owner tool; what carried over is: no AI-slop cards, tabular numbers, real empty states, a single accent, no dead ends), dataviz for every chart. The app's own design system stays: "Ocean Teal" tokens in `apps/web/src/styles.css`, Hanken Grotesk body, Newsreader headings, `components/ui/*`. No new fonts, colours or libraries.

Evidence: 48 screenshots (12 pages x 1440x900 and 390x844 x light and dark) in `brag-output/work/admin-audit/before/`, named `<page>-<desktop|mobile>-<light|dark>.png`. Taken on the local stack (port 3100, local DB, local owner `soyeb.jim@gmail.com`; the local DB needed `pnpm db:migrate` for the 0011 admin tables). Local data is test data; judge layout, not numbers.

### A. Critique of what exists

Score in one line: the pages are correct, accessible and consistent with the app, but the area is a pile of reports, not a console. Nothing tells the owner what to do next, and nothing is visual except one line chart.

#### P0 - fix first (the owner cannot do the job)

1. **No dashboard; "Overview" is 14 numbers in 4 stacked sections.** Hierarchy is flat: "Accounts 277" and "Guests purged after 30 days" get the same weight as "Feedback to read". No deltas, no trend, no "vs yesterday", no sparkline, so no number can be judged good or bad. Four equal-weight `<h2>` sections with big gaps push "Tests today" (the live pulse) below the fold on 900 px. (`overview-desktop-light.png`)
2. **No alerts surface.** Failed analyses, stuck jobs, failed emails, new feedback and low balances live on three different tabs; the only cue is a "1" badge on Feedback and a dot on Costs. The owner has to visit Health to learn it is red. The same screen shows `Failed, 24 h` etc. as plain numbers with no colour even when non-zero.
3. **Costs page shows balances only, and its status lies by omission.** OpenRouter is $5.37 left of $30 (18 percent) and the badge says "OK" in green with no "runs out in N days". The owner's real question (how long does this last, what does a test cost, who burns it) is unanswerable. (`costs-desktop-light.png`)
4. **Tests page is an 8,555 px wall.** About 150 rows sorted by "started", no ranking cue, no filter, no search, no pagination; the first screen is Listening/Reading and the interesting thing (which tests are failing or hard) is not surfaced. Titles repeat as "Original practice · Reading 1 · generated" under each skill. On mobile each row becomes a 6-line card, hundreds deep. (`tests-desktop-light.png`)
5. **Navigation: 11 flat text tabs.** At 1440 it fits; at 390 the strip scrolls sideways and Funnel, Content, Costs, Health, Feedback, Recordings are off-screen with no affordance (the strip is cut mid-word "Recordin"). Mobile is the likeliest place the owner checks "is anything broken". The strip mixes three unrelated jobs (watch the business, operate the product, handle people) in one row. (`feedback-mobile-light.png`, `overview-mobile-light.png`)

#### P1 - clear friction

6. **Charts: one chart in the area (Growth) and it fails dataviz basics.** One shared y-scale for Sign-ups, New guests and Active, so a single spike (163) flattens everything else to the baseline; three series are told apart only by colour plus dash (teal, sky, ink) and the dotted ink line is the lowest contrast; no area/fill, no today marker, no value on hover other than the legend row, y-axis labelled only 0 and max, x only first and last date. Dashed/dotted strokes are used as identity encoding. Per dataviz: small multiples or indexed lines, direct labels on the last point, a real tooltip, recessive grid. (`growth-desktop-dark.png`)
7. **Funnel is bars with a track.** The track (`bg-surface-2`) reads as a "progress toward goal", which a funnel is not, and it shows a data problem without comment: "Signed up 277 = 95 percent" next to "Visited 291", while "Started a test 36 percent" is lower than "Signed up". The stages are not nested (signed-up is a different population), so the bar order lies. Needs conversion between adjacent steps and a note when a step exceeds the previous one. (`funnel-desktop-light.png`)
8. **Activity feed: wrapping emails, no grouping, no row state.** Emails break mid-word ("nusrat.demo@example.co / m") in a 90 px column while the Test column has space to spare; every row repeats "Result" in accent text; the "Score" cell holds 0.0 (0/40) next to 7.5 with no colour or relation to the user's norm; rows from the same person minutes apart (a full speaking session, 5 rows) are not grouped. Filters: skill and email only; no "failed only", "guests", "today". (`activity-desktop-light.png`)
9. **Users table is undifferentiated.** 25 rows per page of identical test-account emails; no sort by tests or recency except two toggles; the `0 / 0 / 0 / 0` column is the dominant visual and carries no information when zero; Cambridge column mostly "No". No row for "who is active right now". Test-account noise (`@test.dev`, `@example.com`, `shots...`) cannot be hidden. (`users-desktop-dark.png`)
10. **User detail is the best page, but long and flat.** Four band-trend charts with fixed 0-9 axis crush a 6-8 range into a thin line; 7 `<audio controls>` rows with default browser chrome (inconsistent widths) dominate; Tests table is 19 rows. Header lacks key facts at a glance (total tests, avg band per skill, spend, last seen, open feedback, replays). (`user-detail-desktop-light.png`)
11. **Health: dumps raw data.** On mobile each failed analysis is a 7-line card; 15 near-identical "The AI service returned an error (402)" rows are not grouped (the "Common errors" section below does group, but is below the fold, and it is the more useful view). No bulk retry. 402 (balance) is a cost problem and is not linked to Costs. (`health-mobile-dark.png`)
12. **Content page is two plain tables of counts** with the same repeated "Speaking | 1 | Cambridge | 89" structure; it is inventory, not insight (is anything missing, short, or stale?). No link from a row to the prompt bank or to the tests page.
13. **Recordings and Feedback have no triage.** Recordings: empty state only (fine) but, once data exists, it needs duration, page count, the user's tests in it, and "from feedback" jumps. Feedback: three status filters plus per-row segmented controls (New / Seen / Done) repeat on every row, which doubles the vertical size; the row's page link, replay link and user link are small text. (`feedback-mobile-light.png`)

#### P2 - polish and consistency

14. **Headline scale.** The Newsreader `<h1>` at 40 px is a marketing-page voice on a data page and, with the tab strip above it, eats about 200 px before any data. The `<h2>` sections use serif too, so a page with 4 sections has 5 serif headings competing with the numbers. In product UI the numbers, not the headings, should be the loudest thing.
15. **Section rhythm is uniform** (mt-10 between every section, same `<dl>` grid) so nothing groups: "Sign-ups" and "Active people" are one story split in two.
16. **Sidebar footer overlaps.** At 900 px high "Report a problem" and "Privacy" collide below the user chip in every screenshot (bottom of the sidebar, all pages). Pre-existing app-shell bug, visible in each admin screenshot.
17. **Empty/zero states.** Zero values show as bold "0" (Health: `0 0 0` in 24 px reads as success only if you know it is). "All clear" exists only for one table. Growth "Guest to account: 0 percent, 14 guests" shows a metric with no denominator context.
18. **Tooltips/hover.** `LineChart` hover only updates the legend row far from the pointer; `BarList` has none. Hit area equals the SVG, fine for touch.
19. **Dark mode.** Tokens carry over well (contrast of text is fine). The chart colours (sky `#38bdf8`, ink `#e6edf5` dotted) are near each other and the third series is hard to follow; badges (`done`, `submitted`) are the only strong colour on pages that should be calm, which makes status chips louder than anything else.
20. **Accessibility is actually good** (sr-only tables behind charts, `aria-label` on charts, real `<table>` plus mobile card list, 44 px targets on segmented controls). Keep all of it; the redesign must not regress it.

#### What is good, keep

Owner-only 404 route; `Load` skeleton/error wrapper; `DataTable` dual render; `Segmented` period switch with URL search params; Dhaka-time formatting helpers; `ProgressBar` with label; empty states with icon; consistent copy tone (plain, no "Oops"). The data layer (`useAdmin`, zod types from the server) is fine and is reused unchanged.

### B. Information architecture

Principle: three questions, in order. (1) Is anything broken or about to run out? (2) How is it going? (3) Who/what do I look into? The current 11 tabs become 8 destinations in a left sub-navigation on desktop and a horizontally-scrolling pill row **with a fade edge and the current item scrolled into view** on mobile. Order is by frequency of use.

| # | Destination | Route | Replaces | Job |
|---|---|---|---|---|
| 1 | **Dashboard** | `/admin` | Overview, Growth (headline), Funnel (headline) | The 10-second answer: alerts, KPIs with trend, spend runway, today. |
| 2 | **Users** | `/admin/users`, `/admin/users/$userId` | Users, Growth (detail), Funnel (detail) | People: list, segments, detail, guest-to-account. |
| 3 | **Activity** | `/admin/activity` | Activity | Live-ish feed of tests, grouped by person-session. |
| 4 | **Tests** | `/admin/tests` | Tests, Content | Per-test health: starts, completion, hardest questions, plus inventory (what exists). |
| 5 | **Costs** | `/admin/costs` | Costs | Balances, runway, spend by stage/model/skill/user, per-attempt line items, waste. |
| 6 | **Recordings** | `/admin/replays` | Recordings | Session replays. |
| 7 | **Feedback** | `/admin/feedback` | Feedback | Inbox with triage. Count badge stays. |
| 8 | **System** | `/admin/health` (kept URL) | Health | Failed/stuck analyses, grouped errors, emails, content integrity. |

Rules:
- Growth and Funnel stop being tabs. They become **sections of Dashboard** (trend and funnel summary) and **tabs inside Users** (`Overview | Growth | Funnel` on the Users index as a `Tabs` row; keeps the existing routes `/admin/growth` and `/admin/funnel` alive as redirects to `/admin/users?view=growth|funnel` so no bookmarks break). Content moves under Tests as a `Tests | Inventory` switch (`/admin/content` redirects).
- Badges in the nav, all driven by `/overview` and `/spend/summary`: Feedback = new count (existing), System = failed + stuck count (red dot, `aria-label`), Costs = amber/red dot when runway < 7 / 3 days (replaces the plain "low balance" dot; status colour plus a text label on the page, never colour alone).
- The sidebar link "Admin" in AppShell stays one item. Desktop: Admin pages get a 200 px secondary nav column (sticky, within `PageContainer` width) so the main column is not squeezed: use `grid-cols-[12rem_1fr]` from `lg`; below `lg` it becomes the scrolling pill row. No change to AppShell itself.
- Global: a **period selector** shared by Dashboard, Users, Tests, Costs (7 d, 30 d, 90 d, URL param `days`), so switching pages keeps the window. Today's `Segmented` per page stays the component.
- A **command palette is not needed** (rule: no speculative features); instead add one search box in the header of Users and Activity that accepts an email, attempt id or guest id prefix and goes straight to the match. Cheap and answers "someone emailed me, who are they".
- Breadcrumbs only on depth 2 (user detail, replay, attempt): `Users / nusrat.demo@example.com`, using the existing "All users" back link style.

### C. Visual language for admin

- Quiet frame, loud numbers. Page title becomes `type-heading` size (not the 40 px display serif) inside admin; Newsreader stays for the title only, not for section headings. Section headings are `text-sm font-semibold` sentence case, with a hairline. No eyebrows, no numbering.
- KPI = `Stat` (already tabular, `text-2xl`) plus a **delta chip** (`Stat delta` already exists: use `good/bad/neutral` with an arrow glyph and text, e.g. "+12 vs prev 7 d") plus an 80x24 **sparkline**. One row of 4-5 KPIs separated by hairlines, **not** cards (no box per number, no icon tiles). One card only where a group needs a boundary: the alerts panel and chart panels (`Card` from ui).
- Colour is information. Status colours (`good/warn/bad` and their `-soft` backgrounds) appear only for status; series use the categorical order below. Chips stay small; the loud accent is reserved for the primary action on a page (Retry, Open replay).
- Density: tables keep 44 px rows but add a **compact** variant (`py-2`, 36 px) for Activity, Users, Tests, Costs tables; a density toggle is not needed. Numeric columns right-aligned with tabular figures; zero shows as a muted en dash, not a bold 0.
- Dark mode: use the existing dark tokens only; chart ink uses `--muted`/`--line`; verify every series against the dark surface with the dataviz validator (see E).
- Motion: only data-meaningful: sparkline draw (200 ms, ease-out), number `CountUp` (exists), skeletons shaped like the final layout. Nothing else; `prefers-reduced-motion` honoured by existing tokens.

### D. Page-by-page layouts

All pages: `PageContainer`, then `AdminHeader` (title, one-line description, period selector right-aligned, "updated 23:34" caption). Widths: 12-column grid at `lg`, single column below `md`. Everything below lists desktop first, then the mobile collapse.

#### D1. Dashboard `/admin`

Order is the hierarchy:

1. **Needs attention** (full width, only rendered when non-empty; otherwise a single quiet line "Nothing needs attention" with a check icon, 40 px). A bordered list, one line per item, each with a status chip, a sentence, and one action link:
   - `bad` System: "3 analyses failed in the last 24 h (2 are 402, balance)" -> System.
   - `warn/bad` Costs: "OpenRouter runs out in about 6 days at $0.82/day" -> Costs.
   - `new` Feedback: "1 new report" -> Feedback.
   - `warn` "2 emails failed" -> System.
   - Source: `/overview` (feedbackNew), `/health` counts, `/spend/forecast`, existing `/costs` warnings. Sorted by severity then recency, max 5 then "and 2 more".
2. **KPI strip** (one row, 5 items, hairline dividers, `Stat` + delta + sparkline): Active people today (accounts + guests; the sub-hint "Guests n"), Sign-ups 7 d (delta vs previous 7 d), Tests finished 7 d (and completion rate as hint), Guest to account 30 d (rate), Spend 7 d house (delta, hint "$x per finished test"). Deltas are computed client-side from `/growth?days=14` series (this 7 vs previous 7) and from `/spend/series`, so no new endpoint beyond spend.
3. **Two-column row**: left (7/12) **Activity trend** chart (stacked-free line: Active people per day, 30 d, with Sign-ups as a second, separately scaled small chart below; see E); right (5/12) **Funnel summary** (visited -> started -> finished -> signed up -> returned) as a horizontal stepped bar without a track, each step with its conversion from the previous step, and a dismissible note when the data is non-nested.
4. **Today** table-less row: four `Stat`s "Speaking 0 / 7" etc. become one line each with a thin proportion bar `started -> finished` (no track), under the label "Tests today, started / finished", with a link "See activity".
5. **Spend runway** (full width or 6/12): from `/spend/forecast`: "$5.37 left, about 6 days at $0.82/day, runs out 11 Oct" with a mini area chart of cumulative spend and the floor line (`COMMUNITY_MIN_BALANCE`); link to Costs.
6. **Recent** (two short lists, 5 rows each): latest feedback (message truncated, page, time) and latest failed analyses (user, test, error, Retry).

Mobile: Needs attention first, KPI strip becomes a 2x3 grid (sparklines hidden under 400 px, deltas kept), charts full width at 160 px height, funnel and today stack, Recent lists last.

Empty/loading: skeletons match the strips (one `Skeleton h-16` per KPI, `h-48` per chart); if `/spend` has no rows yet show "No costs recorded yet. They start with the next analysis." instead of zeroes.

#### D2. Users `/admin/users`

- Header tabs (`Tabs`, URL `view=`): **People** (default) | **Growth** | **Funnel**.
- **People**: filter bar in one row: `Segmented` Accounts / Guests / All; new `Segmented` Segment (All, Active 7 d, Never started, Has own key, Cambridge); a toggle "Hide test accounts" (default on: hides `@test.dev`, `@example.com`, `shots*`, matched server-side by a `q` rule; saves the screenshot noise); search; sort dropdown (Newest, Last active, Most tests, Most spend). Table columns: User (email, with Guest badge, truncate with title tooltip, never mid-word wrap), Joined (relative "2 d ago", full time in `title`), Last active (relative), Tests (one cell: a 4-cell micro bar S/W/L/R with numbers on hover, plain `12` total in text, zeros hidden), Latest band (best known), Spend 30 d (house, from `/spend/by?dim=user`), Cambridge (chip only if allowed). Row click opens detail. Page size 25 with the existing `Pager`.
- **Growth**: the redesigned chart in E1 (Sign-ups small chart on its own scale, Active small chart, New guests small chart: three small multiples in a column, shared x axis), plus the Guest-to-account block as a single sentence-led stat: "14 guests, 0 signed up (0 percent). Guest data is purged after 30 days." with the denominator visible.
- **Funnel**: full-size funnel (E3) plus table of the same numbers; the explanatory paragraph collapses into an info popover (`Popover`), not a 5-line caption.
- **Detail `/admin/users/$userId`**: header with the key facts as a one-line `Stat` strip (Tests, Avg band S/W/L/R, Spend (30 d and total), Last seen, Replays, Open feedback) and the Cambridge switch moved to a right-aligned action area. Below: **Band trend** as a single chart, one line per skill with a y range fitted to the data (`min = floor(minBand) - 0.5`, `max = ceil(maxBand) + 0.5`, but labelled axis, so it is never misleading) instead of four 0-9 charts; **Timeline** (merged tests + recordings + feedback in time order, grouped by session day) replacing the separate Speaking recordings list and Tests table; each test row has a "Cost $0.043" link to the per-attempt drawer (D5) and a "Replay" jump. The 7 default `<audio controls>` collapse into a single player row per test that expands on click. Mobile: key facts 2-column grid, timeline cards.

#### D3. Activity `/admin/activity`

- Filters: skill `Segmented`, new status filter (All, Failed, In progress, Done), who (All, Accounts, Guests), search (email, id, guest prefix). Defaults to last 24 h with a period selector.
- Rows grouped by person and 30-minute window into **session groups**: a group header line "nusrat.demo@example.com, 4 Oct, 19:02 to 19:09, 5 tests, avg 7.2" that expands (default expanded for the newest 3 groups, collapsed otherwise). Inside, compact rows: time, test (Speaking P3, short title truncated with tooltip), score chip, status icon+text, links "Result" and "Replay" (icon buttons with labels), "Cost $0.04" (owner-only, from spend).
- Email column fixed: `min-w-0 truncate` with full email in `title`; width 220 px, never wraps mid-word.
- Score cell: band with tone only when notably off the person's median (a 0.0 with 0/40 gets a `bad-soft` chip and "no answers" text: reveals abandoned L/R).
- Live feel: a "N new" pill appears when polling (30 s `refetchInterval`) finds newer rows; click prepends without losing scroll. No websockets (not requested).
- Mobile: group headers stick, rows become two-line items (test + time on line 1, score + status on line 2).

#### D4. Tests `/admin/tests`

- Switch (`Segmented`): **Health** (default) | **Inventory** (old Content).
- **Health**: top strip of 4 headline numbers per skill (started, completion rate, avg band) as `Stat`s with a delta vs previous period; below, a **ranked list**, not a flat table: tabs by skill (Speaking, Writing, Listening, Reading) show only that skill's tests; sort chips (Most started, Lowest completion, Lowest avg band, Most missed); default sort = most started, **limit 20 with "Show 20 more"**; search box on the title. Columns: Test (title, source chip Cambridge/Generated, variant), Started, Completion (inline bar without track + percent, red text when under 50 percent), Avg band, Avg raw, and an action "Most missed". A `Cambridge | Generated | All` filter replaces repeating the source in every cell. The sheer length (150 rows) becomes 20 at a time.
- "Most missed" stays a `Dialog` on desktop and becomes a bottom sheet on mobile; add the question type if the server returns it, and a link "Open question" to the test.
- **Inventory**: collapsible groups per skill (counts as the group header: "Speaking 645 prompts"), inside a compact matrix: rows = part, columns = Cambridge / Generated / Total, plus the Examiner voice coverage block as a proper progress with "395 of 395 prompts voiced, 3,286 files". Zero gaps get a `warn` chip and a link ("11 generated Listening tests have no audio") when the server can supply it; else shown as "Complete".

#### D5. Costs `/admin/costs` (consumes the section "Costs" above, section 5 endpoints)

Top to bottom (this is the biggest page; the endpoints are `/spend/summary`, `/spend/series`, `/spend/by`, `/spend/attempt/{id}`, `/spend/waste`, `/spend/forecast`, plus the existing `/costs`):

1. **Runway banner** (full width, status-coloured with text, from `forecast`): "OpenRouter: $5.37 left. About 6 days at $0.82/day (7 d average), runs out on 11 Oct. Community tests stop at $0.25 (about 4 days 18 h of spend before the floor)". Right: ElevenLabs (credits left, resets). Status chip `OK / Low / Critical` is **derived from days left** (`< 7` low, `< 3` critical) as the server warns, and it also keeps the absolute-balance rule: never "OK" when days left is low. When `daysLeft` is `null` show "No spend recorded in the last 7 days" in neutral, not a green OK. A "Top up" link is out of scope.
2. **Totals** (`Stat` strip, 5): Today, 7 d, 30 d, All time (house), and "Own key (30 d)" in muted ink. Each with delta vs previous period and a hint "n calls". A `Segmented` Paid by: House | Own key | All (URL param `paidBy`, default House, mirrors the API).
3. **Spend per day** (stacked column chart, 30 d default, period selector shared): stacks = House (series 1, teal) and Own key (series 2, sky), 2 px surface gap between stacks, today partial-bar hatched, y axis in dollars with 3 ticks, tooltip "Tue 30 Sep: House $0.84, Own key $0.12, 38 calls". Ties to the OpenRouter balance via a thin line "OpenRouter says $0.81 for this day" shown only when the drift is above 5 percent (dot marker and caption, not a second axis).
4. **Where it goes** (the core table): `Segmented` dimension: **Stage | Model | Skill and part | User | Test**. Each shows horizontal ranked bars (no track; the bar IS the share) with: label, $ total, share percent, calls, avg per call. Stage labels are human ("Transcription", "Primed transcription (discarded)", "Pronunciation", "Disfluency", "Feedback", "Scoring (3 samples)", "Examiner reply", "Examiner voice", "Live realtime"). Top 8 then "Other" (a 9th series is folded, per dataviz). Row click filters the whole page by that key (chip in the header, "Stage: Scoring x"). User rows link to the user's detail; Test rows link to Tests. Colour: bars are one hue (teal) as magnitude; the dimension is not a colour encoding.
5. **Cost of a finished test** (`summary` per-attempt averages): a compact matrix: rows Speaking P1, P2, P3, Writing T1, T2 (and "Full speaking session" if `sessionTotal` exists), columns: avg cost, median, p90, waste per finished attempt, n. Sorted as the test flow. This is the number the owner prices against. Tooltips explain "waste".
6. **Waste** panel (`/spend/waste`): "$0.31 of $4.51 (6.9 percent) was spent on calls that produced nothing": a small stacked bar with four labelled parts (failed calls, retries, discarded primed transcription, refunded attempts), each with a "See the calls" link opening the line-item list filtered. Hidden when under 1 percent (a one-line "Waste under 1 percent").
7. **Attempts** list: recent attempts with cost (`/spend/by?dim=user` is not this; use `/spend/by?dim=attempt` if added, else the activity feed's cost link), sort by cost desc, each row opens the **attempt drawer**.
8. **Provider balances** (the old page) moves to the bottom as a two-column block (OpenRouter, ElevenLabs) with the existing `ProgressBar`s, and the "Community pool" block becomes one line. They are reference, no longer the headline.

**Attempt drawer** (`Dialog`, right sheet on desktop, full-screen sheet on mobile; route-addressable `?attempt=<id>` so it can be linked from Users, Activity and Health): header "Speaking Part 2, nusrat.demo@example.com, 4 Oct 19:07, status done, Total $0.043 (house)". Body is the **line-item table** in time order: Stage | Model (short, `title` full) | Input/Output tokens or seconds or characters | Cost | flags. Flag chips: `retry`, `failed` (bad), `estimated` (neutral outline with tooltip "Priced from the model rate, not billed amount"), `own key`. Subtotals per stage as group rows, a footer total, and under it "Session total $0.171 across 4 parts" when applicable. A tiny **waterfall strip** above the table (one segment per stage, widths proportional to $, labelled directly, the biggest stage named in the caption) shows at a glance that "Scoring is 61 percent". Empty: "No costs were recorded for this attempt (it ran before cost tracking started on 12 Oct)".

States: while the ledger is empty (feature just shipped) show runway and balances only with a notice "Per-call costs start from <date>"; never render $0.00 charts.

Mobile: runway banner stacks, totals as 2-column, day chart 180 px high with a horizontally scrollable x axis (30 bars) and tap tooltip, "Where it goes" bars full width (labels above bars), line-item table becomes stacked rows (stage + cost on line 1, model + tokens on line 2, flags on line 3).

#### D6. Recordings `/admin/replays` and `$sessionId`

List as a compact table: Started, User, Duration, Pages (first and last), Tests during it (chips), Size, and a flag if a feedback report came from it ("Report"). Filters: user, has-feedback, has-failed-test, length. Detail keeps the player; add a left rail of page changes and test events as a clickable timeline that seeks the player, and a "Skip inactivity" toggle (rrweb supports it). The default Back link returns to the filter state (URL params). Empty state keeps the icon + sentence, and adds "Recording starts for visitors who accept the privacy notice" if true.

#### D7. Feedback `/admin/feedback`

Inbox layout from `lg`: left list (360 px) with status filters on top, right detail pane with message, user card (email, link, last tests), page link, **Replay at that moment**, attempts linked, and the status control; on mobile list then detail route. Status is set once in the detail pane (`Segmented` New / Seen / Done), and rows show only a status dot + text. "Mark all seen" action. Opening a message auto-marks it seen after 3 s (debounced, undoable by toast). Keyboard: j/k to move, e to mark done (documented in a `Kbd` hint; `Kbd` exists).

#### D8. System `/admin/health`

- Top: status banner "All clear" or "N issues" (same alerts component as Dashboard).
- **Errors grouped first** ("Common errors" moves to the top, each group a row: message, count, first/last seen, affected users, a sparkline of occurrences, a link to Costs when it is a 402/balance error, and a **Retry all (n)** button that loops the existing per-attempt retry with a confirm dialog).
- Below, the failed/stuck table is collapsed into the group (expand shows the attempts). Emails failed likewise, with a Resend status line.
- New small blocks, cheap from existing data: queue depth (analyzing now), average analysis time (p50/p90 of attempts last 24 h), storage (replay bytes, audio files). Do not add monitoring that has no data source; list as optional.

### E. Charts (per dataviz)

Rules applied to all: one y-scale per chart (no dual axes), categorical colours assigned in fixed order from the existing tokens (`--accent` teal first, `--sky` second, `--chart-3` slate third), validated; magnitude uses a single hue light-to-dark; status colours only for status and always with an icon or text; direct labels on the last point and a legend whenever there are 2 or more series; recessive grid; every chart has a hover/touch tooltip with the date and all series values, and keeps the existing sr-only data table and `aria-label`.

Palette check: run `node <dataviz skill>/scripts/validate_palette.js "#0f766e,#0284c7,#64748b" --mode light` and `"#2dd4bf,#38bdf8,#94a3b8" --mode dark` before shipping; if adjacent-pair CVD separation fails (teal vs slate in greys is the likely pair), keep teal and sky as series 1-2, and use the third only with a direct label and a different mark (hollow marker). Do not use dashed or dotted lines as an identity channel (current Growth does).

| Need | Chart | Notes |
|---|---|---|
| E1 Growth: sign-ups, new guests, active people per day | **Small multiples, one line/area per measure**, each on its own y-scale, shared x axis, 3 stacked 96 px panels, last value direct-labelled, today marked with a dot | Fixes the 163 spike flattening the rest; 30/90 d; a 7-day moving average line (muted) over the daily bars for sign-ups |
| KPI sparklines | 80x24 line, no axes, last point dot, `aria-hidden` plus the text delta beside it | Stroke 2 px; teal if the trend is the "good" direction, ink-muted otherwise (never red/green by direction alone) |
| Spend per day | **Stacked columns** (House teal, Own key sky), 2 px surface gap, rounded 4 px data end at the top segment, today hatched | Y axis in dollars, 3 ticks; ties to the runway line |
| Spend share by stage/model/user | **Ranked horizontal bars**, single hue, bar = share, value text right | Not a pie or donut; top 8 plus Other |
| Cost per finished test | **Table with inline bar** (avg cost) and a dot for p90 | A "range" read, not a decoration |
| Per-attempt stage split | **One stacked horizontal bar** (waterfall strip), direct labels for segments over 8 percent, legend for the rest | Colour here is categorical stage; use the same fixed order everywhere stages appear |
| Runway | **Area** of cumulative house spend with the remaining balance as a horizontal reference line and the projected run-out as a dashed segment | One axis; dashed marks a projection (a standard use, not identity) |
| Funnel | **Stepped horizontal bars on a shared axis, no track**, the conversion from the previous step written between bars; a step above the previous one gets a "not nested" note | Replaces the track bars |
| Band trend per skill (user detail) | One **multi-line chart**, y fitted to the data range, labelled axis ticks every 0.5 band | Four skills = four colours in fixed order plus direct labels |
| Test completion/avg band | Inline **bar without track** and numbers; red text under threshold | In-table, no separate chart |
| Health error trends | **Sparkline** per error group | |

Implementation: extend `MiniChart.tsx` (it already does SVG with non-scaling strokes and HTML labels) with `Sparkline`, `ColumnChart` (stacked), `AreaChart`, and a shared `ChartTooltip` using the existing `Popover`/position helpers; no chart library (bundle, and the data volume is tiny). `LineChart` gets: `yTicks`, `xTicks`, direct end labels, a real tooltip anchored at the pointer, and the `dash` prop is removed. `BarList` drops the track (`bg-surface-2` background), gets `onSelect` and a tooltip.

### F. Components: reuse, extend, create

Reuse as is: `PageContainer`, `PageHeader`, `Stat` (delta), `Segmented`, `Tabs`, `Badge`, `Alert`, `EmptyState`, `Skeleton`, `Dialog`, `Popover`, `Tooltip`, `Switch`, `Button`, `Input`, `ProgressBar`, `Kbd`, `Load`, `DataTable`, `Pager`, `useAdmin`, `format.ts`.

Extend:
- `Table.tsx` -> `DataTable`: add `dense`, `sort` header buttons (`aria-sort`), `onRowClick`, `empty` slot, right-aligned numeric columns (`align: 'right'`), truncating cells with `title`.
- `AdminNav.tsx` -> `AdminNav` with the 8 destinations, side-rail on `lg`, scroll-fade pills below, per-item badge state (`count`, `dot: 'warn'|'bad'`).
- `Load.tsx` `Section` -> smaller heading style and `id` anchors; add `StatStrip`.
- `MiniChart.tsx` as in E.

Create (all in `apps/web/src/components/admin/`):
- `AttentionList.tsx`: the "Needs attention" list; one source of truth reused by Dashboard and System (items from overview + health + forecast).
- `StatStrip.tsx`: hairline-divided KPI row (`Stat` + delta + `Sparkline`), 2-col grid on mobile.
- `Sparkline.tsx`, `ColumnChart.tsx`, `AreaChart.tsx`, `ChartTooltip.tsx` (E).
- `RankedBars.tsx`: the track-less ranked bar list with share, calls, onSelect (used by Costs, Tests, Funnel).
- `PeriodSelect.tsx`: shared period `Segmented` bound to a URL search param, so every page behaves the same.
- `CostBadge.tsx` (`estimated`, `retry`, `failed`, `own key` chips) and `AttemptDrawer.tsx` (D5), mounted once in `admin.tsx` so any `?attempt=` link opens it.
- `Relative.tsx`: relative time with the Dhaka full time in `title` (extends `format.ts`).
- `SessionGroup.tsx` for the Activity grouping.
- `AdminHeader.tsx`: title + description + period + "updated" caption (wraps `PageHeader`).

Do not create: a design-token file, a chart library wrapper, a global store, icon sets, new fonts.

### G. Build order (small, shippable steps; web only unless noted)

1. Nav + shell: 8 destinations, redirects for `/admin/growth`, `/admin/funnel`, `/admin/content`; header component; fix the mobile pill fade. No server changes.
2. Dashboard: `AttentionList`, `StatStrip`, `Sparkline`, funnel summary, today, recent lists, from existing endpoints (`/overview`, `/growth?days=14`, `/health`, `/costs`).
3. Charts: replace `LineChart` hover/legend, add `ColumnChart`; Growth as small multiples inside Users.
4. Users list filters and "hide test accounts" (server: `q` rule and sort options in `admin/ops.ts`), detail key-facts strip and the merged timeline.
5. Activity grouping and status filter (server: `status` and `window` params, small).
6. Tests ranked list and Inventory switch (server: `limit`, `skill`, `sort` params on `/tests`).
7. Costs (after the ledger and `/spend/*` endpoints from section 5 ship): runway, totals, daily chart, where-it-goes, per-test costs, waste, attempt drawer. Link drawers from Users, Activity, System.
8. Recordings list columns and timeline, Feedback inbox layout, System grouping and bulk retry.

Tests: component tests for `DataTable` sort and `AttentionList` ordering; the existing `format.test.ts` extended for `Relative`; a Playwright pass at 1440x900 and 390x844, light and dark, over every page (script used for the before set: reuse it with `after/` as the output folder, the same 12 page names) and a manual contrast check with `scripts/check-contrast.mjs` for any new token pair (none expected).

Acceptance (what the owner should feel): open `/admin` and within 10 seconds know (a) is anything red, (b) how many people used it this week versus last, (c) how many days of OpenRouter money remain; open Costs and know the price of a finished Speaking Part 2 and the stage that dominates it; find a person from an email in two taps on a phone.

### H. Open questions for the build (not blockers)

- `/overview` has no previous-period numbers; the Dashboard computes deltas client-side from `/growth?days=14`. If a single dashboard call is wanted later, fold it into `/overview?compare=1`.
- "Hide test accounts" needs an agreed rule (suffixes `@test.dev`, `@example.com`, `@x.dev`, local-part prefixes `shots`, `e2e`, `smoke`); keep it a server constant in `admin/common.ts`, defaulted on in the UI, and visible as a toggle so it is never hidden magic.
- Funnel semantics (signed-up share above started share) deserve a server-side fix (nest the steps) before the redesigned chart can be honest; until then the UI shows the "not nested" note.
- The sidebar footer overlap ("Report a problem" over "Privacy") is an AppShell bug outside admin; fix in `AppShell.tsx` at short viewports (it appears at 900 px height).
