# Owner admin area + self-hosted session replay: design

Status: design for parallel implementation. Read the whole document before touching a file; the ownership table (section 8) is binding.

## 0. Ground rules

- Owner = signed-in, `emailVerified`, not anonymous, email in `OWNER_EMAILS` (`apps/server/src/auth.ts`). `isOwner(user)` and `requireOwner` live in auth.ts.
- Every `/api/admin/*` endpoint uses `requireOwner`, which answers **404 `{error:'Not found'}`** to everyone else (anonymous, guest, ordinary user, unverified owner). The web `/admin` route is invisible: no nav item unless `me.isOwner`, and the route's `beforeLoad` throws `notFound()` for non-owners.
- Times: the API returns ISO-8601 UTC strings. The web formats them with `timeZone: 'Asia/Dhaka'`. "Today", "7d", daily buckets and "next day" all use Asia/Dhaka calendar days (server helper `DHAKA_DAY(col)` in `admin/common.ts`).
- Emails are shown in full to the owner. Guests (`user.isAnonymous`) have email `''` in the DB-facing API; show `Guest <first 6 chars of id>`.
- Never return or log any API key. Costs endpoints return only numbers.
- Match code style: zod-openapi `createRoute` + `app.openapi`, `register(app: App)` per module, drizzle query builder, `ponytail:` comments for deliberate shortcuts, tests next to code.
- Phases. **Phase 1: foundation runs alone and finishes** (schema, migration, helpers, all stub files, registration, route tree). **Phase 2: all other slices run in parallel**, each editing only the files it owns (they exist as stubs). **Phase 3: lead** runs `pnpm gen:api`, both typechecks, the full server suite.
- A file needed from a non-owned file: put it in your result as a note. Do not edit it.

## 1. Database (one migration: `apps/server/drizzle/0011_admin.sql`, name `admin`, via `nice pnpm --filter server exec drizzle-kit generate --name admin`)

Add to `apps/server/src/db/schema.ts` (after `emailLog`), using the existing `id()/createdAt()/updatedAt()` helpers:

```ts
// ---------- Owner admin (docs/admin/DESIGN.md) ----------
// Emails granted Cambridge access from the admin UI; merged with OWNER_EMAILS and env CAMBRIDGE_ALLOWED_EMAILS in auth.ts (isCambridgeAllowed).
export const cambridgeAccess = pgTable('cambridge_access', {
  email: text('email').primaryKey(),                       // lowercased
  grantedBy: text('granted_by').notNull(),                 // owner email
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
});

// One row per browser tab recording (rrweb). Events live in R2: replay/<yyyy-mm-dd of started_at, UTC>/<id>/<seq>.json.gz. Deleted after 14 days (src/replay.ts).
export const replaySessions = pgTable('replay_sessions', {
  id: text('id').primaryKey(),                             // client-generated UUID, one per tab (sessionStorage)
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }), // guest or account; moves with link.ts when a guest signs up
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  lastAt: timestamp('last_at', { withTimezone: true }).notNull().defaultNow(),
  pages: jsonb('pages').$type<{ path: string; at: number }[]>().notNull().default([]), // visited paths with epoch ms, capped at 200
  bytes: integer('bytes').notNull().default(0),            // uncompressed JSON bytes accepted so far (cap 30 MB)
  chunks: integer('chunks').notNull().default(0),          // next expected seq (= highest accepted seq + 1)
  userAgent: text('user_agent'),
}, (t) => [index('replay_sessions_user_idx').on(t.userId, t.startedAt), index('replay_sessions_last_idx').on(t.lastAt)]);

// "Report a problem" inbox.
export const feedback = pgTable('feedback', {
  id: id(),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }), // null for a visitor with no session
  email: text('email'),                                    // snapshot at send time; null for guests/visitors
  message: text('message').notNull(),                      // 1..2000 chars
  page: text('page').notNull(),                            // path + search, max 300
  replaySessionId: text('replay_session_id'),              // replay_sessions.id when recording; no FK (replays expire)
  userAgent: text('user_agent'),
  status: text('status').$type<'new' | 'seen' | 'done'>().notNull().default('new'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('feedback_status_created_idx').on(t.status, t.createdAt)]);

// A guest who signed up or signed in to an existing account (the anonymous user row is deleted by Better Auth, so this is the only trace): guest→account conversion.
export const guestConversions = pgTable('guest_conversions', {
  guestId: text('guest_id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  guestCreatedAt: timestamp('guest_created_at', { withTimezone: true }).notNull(),
  linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('guest_conversions_linked_idx').on(t.linkedAt)]);
```

Foundation also: `link.ts` `linkGuest` additionally (a) inserts a `guest_conversions` row (read the guest's `createdAt` first; `onConflictDoNothing`), (b) `update replay_sessions set user_id = newId where user_id = anonId`, (c) `update feedback set user_id = newId where user_id = anonId`.

Index additions for the stats queries (in the same migration): `attempts_status_updated_idx on attempts(status, updated_at)`, `lr_attempts_started_idx on lr_attempts(started_at)`, `attempts_created_idx on attempts(created_at)`, `user_created_idx on "user"(created_at)`. Declare them in the schema's table callbacks so drizzle-kit emits them.

### Cambridge access merge (auth.ts)

`isCambridgeAllowed` stays **synchronous** (used by prompts/lr/me/access/quota). Add a module cache:

```ts
let granted = new Set<string>();                           // cambridge_access emails, lowercased
export async function loadCambridgeGrants() { granted = new Set((await db.select({ email: cambridgeAccess.email }).from(cambridgeAccess)).map((r) => r.email)); }
export const setCambridgeGrant = (email: string, on: boolean) => void (on ? granted.add(email.toLowerCase()) : granted.delete(email.toLowerCase()));
export type CambridgeSource = 'owner' | 'server-config' | 'granted' | null;
export const cambridgeSource = (email: string): CambridgeSource => { const e = email.toLowerCase(); return OWNER_EMAILS.includes(e) ? 'owner' : env.CAMBRIDGE_ALLOWED_EMAILS.includes(e) ? 'server-config' : granted.has(e) ? 'granted' : null; };
export const isCambridgeAllowed = (u) => !!u && u.emailVerified && cambridgeSource(u.email) !== null;
export const isOwner = (u: { email: string; emailVerified: boolean; isAnonymous?: boolean } | null | undefined) => !!u && !u.isAnonymous && u.emailVerified && OWNER_EMAILS.includes(u.email.toLowerCase());
export const requireOwner = createMiddleware<AppEnv>(async (c, next) => { if (!isOwner(c.get('user'))) throw new HTTPException(404, { message: 'Not found' }); await next(); });
```

`src/index.ts` boot: `await loadCambridgeGrants()` then `setInterval(…, 60_000).unref()` (another process's toggle is honoured within a minute). Tests call `loadCambridgeGrants()` after inserting rows.

## 2. Server module layout (`apps/server/src`)

```
admin/index.ts      register(app): calls stats/ops/replay/feedback registers          (foundation)
admin/common.ts     shared helpers (below)                                              (foundation)
admin/schemas.ts    EVERY admin zod schema + exported z.infer types (the contract)     (foundation)
admin/stats.ts      overview, growth, activity, users, users/{id}, tests, funnel, content (server-stats)
admin/ops.ts        costs, health, retry, cambridge toggle                              (server-ops)
admin/costs.ts      OpenRouter + ElevenLabs fetch + 5-min cache + warnings              (server-ops)
admin/replay.ts     GET replays, GET replay, GET replay events                          (replay)
admin/feedback.ts   GET inbox, PATCH status                                              (feedback)
replay.ts           chunk storage helpers, purgeReplays() retention                     (replay)
routes/replay.ts    POST /api/replay/{sessionId}/chunks                                 (replay)
routes/feedback.ts  POST /api/feedback                                                  (feedback)
```

`routes/index.ts` list gains `admin` (admin/index.ts exports `register`), `replay`, `feedback`. `admin/index.ts` imports the four slice modules (each exports `register(app)`; stubs are empty functions until phase 2).

### admin/common.ts (foundation implements fully)

```ts
export const adminRoute = { tags: ['Admin'], security: [{ bearer: [] }], middleware: [requireOwner] as const };   // spread into createRoute
export const DHAKA = 'Asia/Dhaka';
export const dhakaDay = (col: SQL | AnyColumn) => sql<string>`to_char(${col} at time zone 'Asia/Dhaka', 'YYYY-MM-DD')`;
export const dhakaTodayStart = sql`(date_trunc('day', now() at time zone 'Asia/Dhaka') at time zone 'Asia/Dhaka')`; // timestamptz
export const daysAgo = (n: number) => sql`(${dhakaTodayStart} - ${n} * interval '1 day')`;  // start of the Dhaka day n days ago
/** (user_id, at) rows of anything a person did: attempts, L/R attempts, replay sessions. Use as a subquery: `sql`${ACTIVITY} a``. */
export const ACTIVITY = sql`(select user_id, created_at as at from attempts union all select user_id, started_at from lr_attempts union all select user_id, last_at from replay_sessions where user_id is not null)`;
export const pageQuery = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });
export const Paged = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item), page: z.number().int(), pageSize: z.number().int(), total: z.number().int() });
export const guestLabel = (u: { id: string; email: string; isAnonymous: boolean | null }) => (u.isAnonymous ? `Guest ${u.id.slice(0, 6)}` : u.email);
```

## 3. API contract

All paths below are `GET` unless stated, JSON in/out, `requireOwner` (404 for non-owners) unless marked **public/session**. Query params are `z.coerce`. `Page<T> = {items: T[], page, pageSize, total}`. Dates are ISO strings. Skills: `Skill = 'speaking'|'writing'|'listening'|'reading'`.

Shared schemas (in `admin/schemas.ts`, named with `.openapi('Admin…')`):

```ts
SkillS = z.enum(['speaking','writing','listening','reading'])
CambridgeInfo = z.object({ allowed: z.boolean(), source: z.enum(['owner','server-config','granted']).nullable(), canToggle: z.boolean() }) // canToggle = source is null|'granted'
ActivityItem = z.object({
  id: z.string(), kind: z.enum(['attempt','lr']), userId: z.string(), email: z.string(),   // email '' for a guest
  isGuest: z.boolean(), skill: SkillS, title: z.string(),            // prompt title / test title
  mode: z.enum(['practice','live','exam']), parts: z.string(),        // 'Part 2' | 'Task 1' | 'Parts 1, 3' | 'All'
  score: z.number().nullable(),                                       // overall band (speaking/writing), band (L/R); null while pending or partial L/R
  raw: z.object({ raw: z.number(), total: z.number() }).nullable(),   // L/R only
  status: z.enum(['recording','analyzing','done','failed','in_progress','submitted']),
  startedAt: z.string(),
  resultPath: z.string(),   // '/speaking/result/<id>' | '/writing/result/<id>' | '/lr/result/<id>' | '/lr/run/<id>' when in_progress
  replays: z.array(z.object({ id: z.string(), startedAt: z.string() })), // replay sessions of that user whose [startedAt-5min, lastAt+5min] covers the attempt time, max 3
})
ReplayItem = z.object({ id, userId: z.string().nullable(), email: z.string().nullable(), startedAt, lastAt, durationS: z.number(), pages: z.array(z.object({ path: z.string(), at: z.number() })), bytes: z.number(), chunks: z.number(), userAgent: z.string().nullable() })
UserRow = z.object({ id, email, name, isGuest: z.boolean(), emailVerified: z.boolean(), createdAt, lastActiveAt: z.string().nullable(),
  counts: z.object({ speaking: z.number(), writing: z.number(), listening: z.number(), reading: z.number() }), replays: z.number(), cambridge: CambridgeInfo })
FeedbackItem = z.object({ id, userId: z.string().nullable(), email: z.string().nullable(), message, page, replaySessionId: z.string().nullable(), userAgent: z.string().nullable(), status: z.enum(['new','seen','done']), createdAt })
```

Every schema above is exported with its inferred TS type (`export type ActivityItem = z.infer<…>`) for the web (`import type { … } from '@server/admin/schemas'`).

### 3.1 server-stats (`admin/stats.ts`)

| Method + path | Query | Response |
|---|---|---|
| GET `/api/admin/overview` | none | `{ accounts: int, guests: int, signups: {today,d7,d30: int}, newGuests: {today,d7,d30: int}, activeUsers: {today: {accounts:int,guests:int}, d7: {accounts:int,guests:int}}, testsToday: Record<Skill,{started:int, finished:int}>, feedbackNew: int, generatedAt }` |
| GET `/api/admin/growth` | `days: 30\|90` (default 30) | `{ days, series: [{date:'YYYY-MM-DD', signups:int, newGuests:int, active:int}] (one per Dhaka day, zero-filled, oldest first), conversion: {guests:int, converted:int, rate:number 0..1} }` |
| GET `/api/admin/activity` | `pageQuery` + `skill?: Skill` + `q?: string` (email substring) | `Page<ActivityItem>` newest first |
| GET `/api/admin/users` | `pageQuery` + `q?` + `kind: all\|accounts\|guests` (default accounts) + `sort: created\|active` (default created) | `Page<UserRow>` |
| GET `/api/admin/users/{id}` | none | `{ user: UserRow, attempts: ActivityItem[] (newest 100, speaking/writing/L/R), bandTrend: Record<Skill, {at:string, band:number}[]> (oldest first, done/submitted with a band, last 60 each), recordings: {attemptId:string, part:int, createdAt:string, durationMs:int\|null, audioUrl:string\|null}[] (speaking attempts with audio, newest 50, audioUrl = storage.presignGet(audioKey, 3600)), replays: ReplayItem[] (newest 30), cambridge: CambridgeInfo }` · 404 unknown id |
| GET `/api/admin/tests` | `days: coerce int 1..365 default 90` | `{ prompts: TestHealth[], lr: TestHealth[] }` |
| GET `/api/admin/tests/{testId}/missed` | none (`testId` = lr_tests.id) | `{ testId, title, submitted:int, questions: {n:int, answered:int, missed:int, missRate:number}[] }` sorted by missRate desc, top 15, from `lr_attempts.marks` (`LrMark.correct === false` counts as missed; only `status='submitted'` with `marks`) |
| GET `/api/admin/funnel` | `days: 7\|30\|90` default 30 | `{ days, steps: [{key:'visited'\|'started'\|'finished'\|'signedUp'\|'returned', label:string, users:int, pctOfVisited:number 0..1}] }` (always the five steps in that order) |
| GET `/api/admin/content` | none | `{ prompts: {skill:'speaking'\|'writing', part:int, source:'generated'\|'cambridge', count:int}[], lr: {skill:'listening'\|'reading', source:'cambridge'\|'generated', variant:'academic'\|'general', tests:int}[], speakingAudio: {prompts:int, promptsFullyRendered:int, lines:int, linesRendered:int, manifestEntries:int\|null} }` |

`TestHealth = { id: string, title: string, skill: Skill, part: int\|null, source: string, started: int, finished: int, completionRate: number 0..1, avgBand: number\|null, avgRaw: number\|null }` — `prompts`: group `attempts` by `prompt_id` (finished = status `done`; avg of `analyses.overall`, `avgRaw` null), `lr`: group `lr_attempts` by `test_id` (finished = `submitted`; avgBand of band where not null; avgRaw of raw). Rows with `started >= 1` in the window only, sorted by `started` desc, limit 200.

Funnel definitions (state them in the UI footnote): cohort = `user` rows created in the last `days` Dhaka days (guests get a row when they start their first test or sign up, so "visited" means "a session was created"; browsing visitors with no session are not countable). started = ≥1 `attempts`/`lr_attempts` row; finished = ≥1 attempt `done` or L/R `submitted`; signedUp = `is_anonymous = false`; returned = any `ACTIVITY` row on a later Dhaka calendar day than the user's `created_at` day. Active users = distinct `ACTIVITY.user_id` in the window. Growth `conversion.guests` = guest rows created in window + `guest_conversions` rows with `guest_created_at` in window; `converted` = `guest_conversions` rows with `guest_created_at` in window. (Guests purge after 30 days, so 90-day conversion is an approximation: say so in the UI footnote.)

Speaking-audio coverage: reuse `speakingLines()` (`@ielts/core`) per speaking prompt, hash each line with `speakingAudioHash`, compare with the manifest key set. `ai/speaking-audio.ts` currently keeps the manifest set private: server-stats may add one small export there (`renderedHashes(): Promise<Set<string> | null>`; null when the manifest is missing) and must keep existing behaviour/tests.

### 3.2 server-ops (`admin/ops.ts`, `admin/costs.ts`, `routes/attempts.ts`, `routes/lr.ts`)

| Method + path | Body / query | Response |
|---|---|---|
| GET `/api/admin/costs` | none | `Costs` below |
| GET `/api/admin/health` | none | `Health` below |
| POST `/api/admin/attempts/{id}/retry` | none | 202 `{ id, status:'analyzing' }` · 404 unknown · 409 `{error}` when not retryable (status not `failed`, and not `analyzing` older than 10 min) or the attempt has no input (speaking without `audioKey`, writing without `text`) |
| POST `/api/admin/users/{id}/cambridge` | `{ granted: boolean }` | `CambridgeInfo` · 404 unknown/guest user · 409 `{error:'Managed in server config'}` when `cambridgeSource(email)` is `owner` or `server-config` |

```ts
Warn = z.enum(['ok','low','critical'])
Costs = z.object({
  openrouter: z.object({ available: z.boolean(), limit: z.number().nullable(), usage: z.number().nullable(), remaining: z.number().nullable(), usageDaily: z.number().nullable(), usageWeekly: z.number().nullable(), usageMonthly: z.number().nullable(), warn: Warn }),
  elevenlabs: z.object({ available: z.boolean(), tier: z.string().nullable(), characterCount: z.number().nullable(), characterLimit: z.number().nullable(), remaining: z.number().nullable(), resetsAt: z.string().nullable(), warn: Warn }),
  community: BalanceSchema,   // from communityBalance() (routes/community.ts export)
  minBalance: z.number(),     // env.COMMUNITY_MIN_BALANCE
  warnings: z.array(z.string()),   // human lines, e.g. "OpenRouter has $1.20 left (community tests stop at $0.25)"
  cachedAt: z.string(),
})
Health = z.object({
  counts: z.object({ failed24h: z.number(), stuckAnalyzing: z.number(), emailFailed24h: z.number() }),
  attempts: z.array(z.object({ id, userId, email, isGuest, skill: z.enum(['speaking','writing']), part: z.number(), status: z.enum(['analyzing','failed']), stage: z.string().nullable(), error: z.string().nullable(), errorRetryable: z.boolean(), ageMin: z.number(), createdAt, updatedAt, canRetry: z.boolean(), resultPath: z.string() })), // failed in the last 7 days, or analyzing > 10 min; newest first, max 100
  emailFailures: z.array(z.object({ id, email, purpose, status: z.string(), error: z.string().nullable(), attempts: z.number(), createdAt })), // email_log status = 'failed', last 7 days, max 50, full address
  recentErrors: z.array(z.object({ error: z.string(), count: z.number(), lastAt: z.string() })), // attempts.error grouped, last 7 days, top 10 (there is no separate error log)
})
```

Costs rules: 5-minute in-memory cache (and in-flight dedupe) per upstream, `?refresh` not offered. OpenRouter: `GET https://openrouter.ai/api/v1/key`, `Authorization: Bearer ${env.OPENROUTER_API_KEY}`, fields `data.limit`, `data.usage`, `data.limit_remaining`, `data.usage_daily|weekly|monthly`; use `httpFetch` from `ai/openrouter` and `AbortSignal.timeout(8000)`. ElevenLabs: only when `env.ELEVENLABS_API_KEY`; `GET https://api.elevenlabs.io/v1/user/subscription` header `xi-api-key`; fields `tier`, `character_count`, `character_limit`, `next_character_count_reset_unix` (seconds). On upstream failure return `available:false` with nulls and serve the last good value if one exists; never throw, never put an upstream message or key in a response. Warn levels: OpenRouter `critical` when `remaining < COMMUNITY_MIN_BALANCE`, `low` when `< 4 × COMMUNITY_MIN_BALANCE` (a key with no limit is `ok`); ElevenLabs `critical` when remaining characters `< 5%` of the limit, `low` when `< 20%`. `warnings` has one line per non-ok level. Tests inject `httpFetch` mocks; assert no key string appears in any response.

Retry implementation: validate as above, `update attempts set status='analyzing', error=null, errorRetryable=true, stage=null, partial=null`, then `void runAnalysis(id)` (jobs.ts). No quota is reserved: failed analyses were already refunded, an owner retry is free to the user.

**Owner bypass on result endpoints** (read-only): in `routes/attempts.ts` the handlers `GET /api/attempts/{id}` and `GET /api/attempts/{id}/status`, and in `routes/lr.ts` `GET /api/lr/attempts/{id}`, look the row up by id alone when `isOwner(currentUser(c))`, else keep the `userId` filter. Every write (submit, delete, PUT autosave, finish) stays own-rows-only. The user's `email`/`id` are never added to these payloads. For `lr` the `canOpen` test check is skipped for the owner (the owner is always Cambridge-allowed anyway). Add tests: owner reads another user's speaking attempt (audio URL present) and L/R attempt; an ordinary user still gets 404; owner cannot delete another user's attempt.

### 3.3 replay (`routes/replay.ts`, `admin/replay.ts`, `replay.ts`)

**POST `/api/replay/{sessionId}/chunks`**: public/session. Needs `sessionMiddleware` user (guest or account) else 401. Not under `requireOwner`.
- Params: `sessionId` = UUID (zod `.uuid()`).
- Body (JSON, `application/json`; the client uses `fetch(..., {keepalive:true})` or `navigator.sendBeacon(url, new Blob([json], {type:'application/json'}))`): `{ seq: int ≥ 0, events: unknown[] (1..5000), pages?: {path: string ≤200, at: number}[] (≤20) }`.
- Limits: raw body ≤ 1 MB (read the raw text, check `.length`/byte length before parsing) else 413 `{error, code:'chunk_too_large'}`; session total `bytes + chunkBytes > 30 MB` else 413 `{code:'replay_full'}` (client stops recording for that tab); per IP-hash+session token bucket `replayChunkOk(key)` (foundation adds it to `ratelimit.ts`: capacity 12, refill 1 per 5 s) else 429; path must not be an excluded one (server also rejects chunks whose `pages` contain `/login|/signup|/forgot-password|/reset-password` prefixes with 400, defense in depth).
- Behaviour: first chunk inserts the row (`started_at = now()`, `user_agent` header truncated to 300). A later chunk by a different `user_id` (guest signed up in the same tab) takes the row over. `seq < chunks` is a duplicate retry → 200 no-op. Otherwise gzip `JSON.stringify(events)` (`node:zlib` `gzipSync`), `storage.put('replay/<yyyy-mm-dd of started_at UTC>/<sessionId>/<seq>.json.gz', gz, 'application/gzip')`, then update `chunks = seq+1`, `bytes += rawBytes`, `last_at = now()`, `pages = (pages || new).slice(-200)`.
- Response 200 `{ ok: true }`.

**GET `/api/admin/replays`**: `pageQuery` + `userId?` → `Page<ReplayItem>` newest first (`email` joined, null for none/guest-deleted). `durationS = (lastAt - startedAt)/1000`.
**GET `/api/admin/replays/{id}`**: `ReplayItem`, 404 if gone.
**GET `/api/admin/replays/{id}/events`**: `{ events: unknown[] }` — list the objects under `replay/<date>/<id>/` in seq order (`storage.get` each key `0..chunks-1`, skipping missing), gunzip, concatenate. 404 if the row is gone.

**Retention**: `src/replay.ts` exports `purgeReplays(): Promise<number>`: rows with `last_at < now() - interval '14 days'` (limit 500 per run) → `storage.deletePrefix('replay/<date>/<id>/')` then delete the row. Scheduled by foundation in `index.ts` (boot + every 24 h, same pattern as `purgeGuests`). Foundation creates `replay.ts` with `export async function purgeReplays() { return 0; }` and the replay slice fills it. Also export from `replay.ts` the key helper `replayPrefix(row)` used by the three consumers.

### 3.4 feedback (`routes/feedback.ts`, `admin/feedback.ts`)

**POST `/api/feedback`**: public (optional session: `sessionMiddleware` only, no `requireUser`, so a visitor who cannot sign up can still report). Body `{ message: string 1..2000 (trimmed), page: string 1..300, replaySessionId?: string uuid }` → 201 `{ id }`. Rate limit `feedbackOk(clientIpHash(c) ?? 'unknown')` (foundation adds it to `ratelimit.ts`: capacity 5, refill 1 per 10 min) else 429 `{error:'Too many requests, slow down.'}`. Stores `user_id` and `email` (null for guests/visitors), `user_agent` (≤300).
**GET `/api/admin/feedback`**: `pageQuery` + `status: new|seen|done|all` (default `all`; ordering: `new` first then newest) → `Page<FeedbackItem>`.
**PATCH `/api/admin/feedback/{id}`**: `{ status: 'new'|'seen'|'done' }` → `FeedbackItem` (404 unknown).

## 4. Web layout (`apps/web/src`)

Types for the admin API come from `import type { … } from '@server/admin/schemas'` (the `@server/*` alias already exists, e.g. `@server/settings`); calls use `api.get<T>('/admin/…')`, `api.post`, and a new `api.patch` (foundation adds `patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {})` to `lib/api.ts` in phase 1). `pnpm gen:api` in phase 3 will also expose the endpoints in `schema.d.ts`; admin code may move to the typed `client` afterwards but must work without it.

Routes (all created as stubs by foundation, filled by their owner; none may be added later; `routeTree.gen.ts` is regenerated by foundation after creating them via `nice pnpm --filter web exec vite build`, and again by the lead in phase 3):

```
routes/_app/admin.tsx                         layout: beforeLoad ensures me.isOwner else throw notFound(); tab nav + <Outlet/>   (admin-ui)
routes/_app/admin/index.tsx                   Overview                                                                               (admin-ui)
routes/_app/admin/growth.tsx                  Growth + guest conversion                                                              (admin-ui)
routes/_app/admin/activity.tsx                Activity feed (paginated, ?page&skill&q)                                               (admin-ui)
routes/_app/admin/users.index.tsx             Users list (?q&kind&page)                                                              (admin-ui)
routes/_app/admin/users.$userId.tsx           User page: attempts, band trend, recordings player, replays, Cambridge toggle          (admin-ui)
routes/_app/admin/tests.tsx                   Test health + most-missed drill-down                                                   (admin-ui)
routes/_app/admin/funnel.tsx                  Funnel                                                                                 (admin-ui)
routes/_app/admin/costs.tsx                   Costs + warnings                                                                       (admin-ui)
routes/_app/admin/health.tsx                  System health + Retry buttons                                                          (admin-ui)
routes/_app/admin/content.tsx                 Content counts                                                                         (admin-ui)
routes/_app/admin/feedback.tsx                Feedback inbox with status switch                                                      (admin-ui)
routes/_app/admin/replays.index.tsx           Replay list (?userId&page)                                                             (replay)
routes/_app/admin/replays.$sessionId.tsx      Player page: pages list (jump), duration, back link                                    (replay)
routes/_app/privacy.tsx                       Privacy policy page (public; inside the shell)                                         (privacy)
```

Admin shared UI (all admin-ui): `lib/admin.ts` (query options, `useOwner()`), `components/admin/AdminNav.tsx` (tab strip; shows a count badge for `feedbackNew`), `components/admin/format.ts` (`dhakaTime(iso)` = `Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Dhaka', …})`, `userLabel`), `components/admin/Table.tsx`, `components/admin/Pager.tsx`, `components/admin/MiniChart.tsx` (hand-rolled SVG line/bars, no chart dependency; reuse tokens from `components/dashboard/Charts.tsx` if suitable). Use existing `components/ui` (`PageContainer`, `PageHeader`, `Stat`, `Badge`, `Segmented`, `Tabs`, `EmptyState`, `Skeleton`, `Alert`, `Button`). Follow `docs/design-system.md`, AA contrast, mobile-first (tables become stacked cards under `md`). Links from the activity feed and user page: user → `/admin/users/$userId`, result → `resultPath` (the existing result routes work for the owner thanks to the server bypass), replay → `/admin/replays/$sessionId`. Speaking recordings: `<audio controls preload="none" src={audioUrl}>`.

Navigation (foundation, `components/layout/AppShell.tsx`): when `me.isOwner`, add an `Admin` item (icon `ShieldCheck`) to the sidebar group and the mobile "More" list (`MORE`); add a quiet `Privacy` link in the sidebar footer and in the More sheet. Nothing for non-owners. `Me` gets `isOwner: boolean` (server `routes/me.ts` MeSchema, `isOwner(user)`); the web reads it through `useIsOwner()` in `lib/auth.ts` (foundation), which casts `Me & { isOwner?: boolean }` until `schema.d.ts` is regenerated in phase 3.

### Replay: recorder (replay slice)

- `apps/web/src/lib/replay.ts`: `startReplay(): void`. `apps/web/src/components/ReplayRecorder.tsx`: renders `null`; mounted once by foundation in `__root.tsx` next to `<Toaster/>`. Must not delay first paint: on mount, `requestIdleCallback` (fallback `setTimeout 2000`) then `await import('rrweb')` (a separate chunk, nothing from rrweb imported statically).
- Session id: `sessionStorage['ielts.replay.sid']` (UUID created once per tab; this key name is a contract, the feedback button reads it).
- Excluded routes: pathname starting with `/login`, `/signup`, `/forgot-password`, `/reset-password`. On entering one: call rrweb's stop function, **drop** buffered unsent events recorded since the last flush? No: flush what exists from before, then stop. On leaving: start a new `record()` (new full snapshot) with the same session id. Subscribe through `router.subscribe('onResolved')` (import the router from the Router context via `useRouter()`); also apply the check at first start (a direct load of `/signup` records nothing).
- rrweb options: `{ emit, maskAllInputs: false, maskInputOptions: { password: true }, blockSelector: '[data-replay-block]', recordCanvas: false, collectFonts: false, inlineStylesheet: true, sampling: { scroll: 150, input: 'last' }, checkoutEveryNms: 5 * 60_000 }`. No audio/mic capture of any kind (do not touch `getUserMedia`; rrweb does not record media streams). Essays and test answers are recorded (owner requirement), so no extra masking beyond password and block.
- Block markers (`data-replay-block` attribute): replay slice adds it to every element in `components/settings/ApiKeys.tsx` and `components/settings/LiveProvider.tsx` that is or shows a key (inputs, last4 displays, any bearer/token text). It also greps `apps/web/src` for any other place that renders a key/token and lists those files in its result as notes (it does not edit files it does not own).
- Buffering and upload: events accumulate in memory; every 10 s, if non-empty, flush; also on `pagehide` and `visibilitychange: hidden` (flush by `navigator.sendBeacon` with a JSON Blob; fall back to `fetch keepalive`). Chunks are sent strictly one at a time and in `seq` order; a failed chunk is retried with the same `seq` on the next tick (max 5 attempts, then dropped and `seq` advances). If a single chunk's JSON would exceed 900 KB split it. `413 replay_full` or `401` for a tab with no session: stop uploading; for no-session (guest not created yet) keep buffering up to 2 MB, retry after each `meQuery` change (watch `queryClient.getQueryCache().subscribe`), drop beyond 2 MB but always keep the first Meta + FullSnapshot events. Send `pages` entries (`{path, at}` on every resolved navigation, pathname only, no search string).
- `lib/replay.test.ts`: unit-test the pure helpers (excluded-route check, chunk splitter, buffer cap).

### Replay: player (replay slice)

`components/admin/ReplayPlayer.tsx`: `lazy` loads `rrweb-player` and its CSS only when opened; props `{ sessionId: string }`; fetches `/admin/replays/{id}/events`; renders the player with `autoPlay: false, showController: true, skipInactive: true`, width from the container, plus the pages list (click → `player.goto(offsetMs)` using `page.at - events[0].timestamp`) and the duration. `routes/_app/admin/replays.$sessionId.tsx` renders it with user link and meta. `routes/_app/admin/replays.index.tsx` lists sessions (time Dhaka, user, duration, pages count, size).

New web dependencies (foundation, phase 1, `nice pnpm --filter web add rrweb rrweb-player`; pin both to the same latest `2.0.0-alpha.x` that installs): `rrweb`, `rrweb-player`. Both are only dynamically imported.

### Feedback button (feedback slice)

`components/layout/FeedbackButton.tsx`, mounted by foundation in `__root.tsx`. A small ghost button "Report a problem" (icon `MessageSquareWarning`), fixed bottom-left on desktop, above the mobile tab bar (`bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-4`), hidden on the four auth routes and on exam routes (`staticData.exam`). Opens the existing `Dialog` with a textarea (max 2000, counter), submit POSTs `/feedback` `{ message, page: location.pathname + location.search, replaySessionId: sessionStorage['ielts.replay.sid'] ?? undefined }`, success toast "Thanks, we got it." The dialog's textarea gets `data-replay-block`? No: feedback text is not secret; leave recorded. The button is part of the page so is also recorded (fine).

### Privacy (privacy slice)

No privacy page exists today. Create `routes/_app/privacy.tsx` (public: no login needed, noindex not required; add `/privacy` to `PAGES` in `packages/core/src/seo.ts` with a title/description, and `/admin` to `NOINDEX_TITLES` as `'Admin'`). Sections: what we collect (account email/name, your tests, recordings, results), **session recording** (records clicks, scrolling, pages visited and what you type into answers and essays so we can find and fix problems; passwords, the sign-in / sign-up / password-reset pages and API keys are never recorded; this feature records no audio, the microphone is only used for the speaking test itself; recordings are deleted automatically after 14 days; only the site owner can view them), third parties (AI model providers, email delivery), retention (guest data 30 days, account deletion removes tests and recordings), your rights/contact, last-updated date. Use the `privacy-policy` skill structure only as a checklist; keep prose plain and short. Links: `signup.tsx` ("By creating an account you agree to the privacy policy" under the submit button) and a "Privacy" row in `settings.tsx`. (The sidebar/More links are foundation's.) Contact address: use the first `OWNER_EMAILS` entry via a constant `CONTACT_EMAIL = 'soyeb.jim@gmail.com'` in the page.

## 5. Bug fixes (bugfix slice; web + core only)

Each gets a regression test where a test file exists nearby.

a. `routes/_app/writing/result.$attemptId.tsx`: the `setTab` navigate call gets `resetScroll: false` (alongside `replace: true`).
b. Speaking "Fluency measures" shows Repetitions 0 / Self-corrections 0 while the cards below count 3 each: trace where each is computed (`packages/core/src/speech.ts` fluency features vs the fused disfluency events used by the cards; `lib/result.ts`, `lib/timeline.ts`, `components/speaking/*`). Make the measures derive from the same fused events as the cards (single source), with a test using fixtures from `disfluency.fixtures.ts`.
c. Natural sort of L/R test lists (`components/lr/Hub.tsx`, `lib/lr.ts`): compare refs/titles with `localeCompare(b, undefined, {numeric: true})` or the parsed numbers; "Test 10" after "Test 9".
d. SRS new-card intervals (`packages/core/src/srs.ts`): today every first success gives 1 day. Make a new card (reps 0) distinct by grade: grade 3 (Hard) 1 day, grade 4 (Good) 3 days, grade 5 (Easy) 7 days; second success keeps SM-2 6 days (Easy may use 10); `ease` update unchanged; failed grades still reset to 1 day. Update `routes/_app/review.tsx` labels to read the real interval from `review()` so labels and scheduling cannot drift. Existing `srs.test.ts` must stay green except assertions that encoded the old new-card behaviour (update those deliberately and say so in the result).
e. "Add top fixes to review deck": after adding (response says all added, or `inDeck` already true) the button shows the added state ("Added to review deck" with a check icon, disabled) and stays so after re-render/navigation (check `inDeck`). Find it with `grep -rn "top fixes" apps/web/src`.
f. `components/lr/Results.tsx`: the effect that scrolls to the highlight for "Show in passage/transcript" lists the active tab (and the highlight target) in its dependency array so clicking from an already-open Answers row scrolls once the tab switches.

## 6. Tests required

- foundation: auth unit tests (`isOwner`, `cambridgeSource`, merge with env + table, `requireOwner` 404 for anon/guest/user/unverified-owner, 200 for owner), migration applies on a fresh test DB.
- server-stats: one test file creating users/attempts/lr_attempts/replay rows, asserting every endpoint's numbers incl. Dhaka-day boundaries and funnel steps.
- server-ops: costs (mocked upstream, no key leakage, warn levels, cache), health, retry, toggle (granted → `isCambridgeAllowed` true after cache update; env email → 409), owner bypass tests.
- replay: chunk limits (1 MB, 30 MB, rate limit, duplicate seq, no session 401, excluded paths 400), storage layout (memory storage), retention (backdated `last_at`), admin events concatenation order.
- feedback: post (guest, visitor, user), rate limit, inbox list/status, 404 for non-owner.
- Run server tests as `TEST_DB=<unique-name> nice pnpm --filter server exec vitest run <files>`; typecheck with `nice pnpm --filter web exec tsc --noEmit` and `nice pnpm --filter server exec tsc --noEmit`. No Android/iOS/Gradle/Xcode. Never touch production or print secrets from `.env`. Nothing is committed.

## 7. Out of scope (decided, do not build)

Audio capture, canvas/WebGL recording, cross-origin iframes, console/network recording, heatmaps, alert emails/push for low balance (warnings render in the Costs page and as an Admin-nav dot), per-user data export, OpenAI/Gemini spend (no key-usage API in use), a real error log table, CSV export, role system beyond `OWNER_EMAILS`.

## 8. File ownership (each file has exactly one owner; foundation creates all stubs in phase 1, the owner column is who edits in phase 2)

| File | Owner |
|---|---|
| `apps/server/src/db/schema.ts` | foundation |
| `apps/server/drizzle/0011_admin.sql`, `apps/server/drizzle/meta/*` | foundation |
| `apps/server/src/auth.ts` (isOwner, requireOwner, cambridgeSource, grants cache) | foundation |
| `apps/server/src/link.ts` (conversion row, replay/feedback re-point) | foundation |
| `apps/server/src/ratelimit.ts` (`replayChunkOk`, `feedbackOk`) | foundation |
| `apps/server/src/index.ts` (boot grants load, purgeReplays schedule) | foundation |
| `apps/server/src/routes/index.ts` (register admin, replay, feedback) | foundation |
| `apps/server/src/routes/me.ts` (`isOwner` in Me) | foundation |
| `apps/server/src/admin/index.ts`, `admin/common.ts`, `admin/schemas.ts` | foundation |
| `apps/server/src/auth.test.ts` additions or new `admin/auth.test.ts` | foundation |
| `apps/web/package.json`, `pnpm-lock.yaml` | foundation |
| `apps/web/src/lib/api.ts` (`patch`), `apps/web/src/lib/auth.ts` (`useIsOwner`) | foundation |
| `apps/web/src/routes/__root.tsx` (mount `ReplayRecorder`, `FeedbackButton`) | foundation |
| `apps/web/src/components/layout/AppShell.tsx` (Admin + Privacy links) | foundation |
| `apps/web/src/routeTree.gen.ts`, `apps/web/src/openapi.json`, `apps/web/src/lib/schema.d.ts` | foundation (regenerated again by the lead in phase 3) |
| `apps/server/src/admin/stats.ts`, `admin/stats.test.ts`, `apps/server/src/ai/speaking-audio.ts` | server-stats |
| `apps/server/src/admin/ops.ts`, `admin/costs.ts`, `admin/ops.test.ts`, `apps/server/src/routes/attempts.ts`, `routes/lr.ts` (+ their tests) | server-ops |
| `apps/server/src/replay.ts`, `routes/replay.ts`, `admin/replay.ts`, `replay.test.ts` | replay |
| `apps/web/src/lib/replay.ts`, `lib/replay.test.ts`, `components/ReplayRecorder.tsx` | replay |
| `apps/web/src/components/admin/ReplayPlayer.tsx` | replay |
| `apps/web/src/routes/_app/admin/replays.index.tsx`, `replays.$sessionId.tsx` | replay |
| `apps/web/src/components/settings/ApiKeys.tsx`, `components/settings/LiveProvider.tsx` (`data-replay-block`) | replay |
| `apps/server/src/routes/feedback.ts`, `admin/feedback.ts`, `feedback.test.ts` | feedback |
| `apps/web/src/components/layout/FeedbackButton.tsx` | feedback |
| `apps/web/src/routes/_app/privacy.tsx`, `routes/_app/settings.tsx`, `routes/signup.tsx` | privacy |
| `packages/core/src/seo.ts` (+ `seo` tests under it or `apps/server/src/seo.test.ts` if it enumerates pages) | privacy |
| `apps/web/src/routes/_app/writing/**`, `routes/_app/speaking/**`, `routes/_app/listening/**`, `routes/_app/reading/**`, `routes/_app/lr/**`, `routes/_app/review.tsx` | bugfix |
| `apps/web/src/components/speaking/**`, `components/results/**`, `components/lr/**` | bugfix |
| `apps/web/src/lib/result.ts`, `lib/timeline.ts`, `lib/lr.ts`, `lib/format.ts`, `lib/attempt.ts` (+ tests) | bugfix |
| `packages/core/src/**` except `seo.ts` (srs.ts, speech.ts, types.ts, their tests) | bugfix |
| `apps/web/src/routes/_app/admin.tsx`, `routes/_app/admin/index.tsx`, `growth.tsx`, `activity.tsx`, `users.index.tsx`, `users.$userId.tsx`, `tests.tsx`, `funnel.tsx`, `costs.tsx`, `health.tsx`, `content.tsx`, `feedback.tsx` | admin-ui |
| `apps/web/src/lib/admin.ts`, `components/admin/AdminNav.tsx`, `format.ts`, `Table.tsx`, `Pager.tsx`, `MiniChart.tsx` (+ tests) | admin-ui |

Not touched by anyone: `apps/server/src/jobs.ts` (the retention timer lives in `index.ts` next to `purgeGuests`; the job body is `replay.ts`), `app.ts`, `env.ts`, `community.ts` (read-only reuse), `docs/*` other than this file.

Cross-slice contracts that must not drift: the zod shapes in `admin/schemas.ts` (foundation writes them from section 3, exactly; slices implement against them and may only request changes via a note), the sessionStorage key `ielts.replay.sid`, the R2 key layout `replay/<yyyy-mm-dd>/<sessionId>/<seq>.json.gz`, the excluded route list, and `Me.isOwner`.

## 9. Foundation decisions (phase 1, done)

- Migration `0011_admin.sql` as specified (4 tables, 4 stats indexes). `docker start ielts-prtactice-db-1` brings up the local test Postgres on :5433.
- `jobs.ts` is untouched (section 8): `purgeReplays` is scheduled in `index.ts` (boot + 24 h), `loadCambridgeGrants` at boot + every 60 s. `src/replay.ts` is a stub returning 0 (the replay slice also adds `replayPrefix`).
- `admin/schemas.ts` has every contract schema and type, plus `Paged` pages for activity (`ActivityPage`) and users (`UsersPage`); `Paged(ReplayItem)` / `Paged(FeedbackItem)` are for the replay and feedback slices to build. Reuse `ReplayRef` for the `replays` refs. Request bodies/query schemas are the slice's own.
- Every slice module (`admin/stats|ops|replay|feedback.ts`, `routes/replay.ts`, `routes/feedback.ts`) exports an empty `register(_app: App)`; fill it, rename the parameter to `app`.
- `src/test/setup.ts` (not in the ownership table, edited by foundation) truncates the four new tables + `cambridge_access` and reloads the grants cache before each test. It imports `auth` lazily on purpose: a static import would load the real `./email` before a test file's `vi.mock('./email')` applies and break `auth.test.ts`.
- Owner guard test: `admin/auth.test.ts` mounts a probe route behind `requireOwner` on `createApp()` (no admin endpoints exist yet). Slices should add their own 404-for-non-owner assertion.
- `Me.isOwner` is on the server `MeSchema`; the web reads it with `useIsOwner()` (`lib/auth.ts`, cast until `pnpm gen:api`).
- Web: `rrweb` / `rrweb-player` installed as `^2.1.7` (latest stable on npm; no `alpha` pin needed). `api.patch` added. Nav: `Admin` (ShieldCheck) in the sidebar footer under Settings and in the More sheet for owners; `Privacy` link at the bottom of the sidebar (hidden when collapsed) and the More sheet.
- `routes/_app/admin.tsx` already has the owner `beforeLoad` (`notFound()`) and renders `<Outlet/>`; admin-ui adds the tab nav. All other route files are `component: () => null` stubs; `routeTree.gen.ts` regenerated via `vite build`. Stubs also exist for `components/ReplayRecorder.tsx`, `components/layout/FeedbackButton.tsx` (both mounted in `__root.tsx`), `lib/replay.ts`, `components/admin/ReplayPlayer.tsx`, `routes/_app/privacy.tsx`.
- Not done by foundation: `openapi.json` / `schema.d.ts` (lead, phase 3: admin endpoints do not exist yet).
