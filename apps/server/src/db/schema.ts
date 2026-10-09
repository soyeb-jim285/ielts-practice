import { sql } from 'drizzle-orm';
import { pgTable, pgEnum, text, timestamp, boolean, integer, jsonb, numeric, index, uniqueIndex, real } from 'drizzle-orm/pg-core';

const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());

// ---------- Better Auth core tables ----------
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  isAnonymous: boolean('is_anonymous').default(false), // Better Auth anonymous plugin: guests get a real user row until they sign up (docs/community.md)
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('user_created_idx').on(t.createdAt)]);

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
}, (t) => [index('session_user_idx').on(t.userId)]);

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('account_user_idx').on(t.userId)]);

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------- App tables ----------
export const skillEnum = pgEnum('skill', ['speaking', 'writing']);
export const variantEnum = pgEnum('variant', ['academic', 'general']);
export const sourceEnum = pgEnum('prompt_source', ['generated', 'cambridge']);
export const modeEnum = pgEnum('attempt_mode', ['practice', 'live', 'exam']);
export const statusEnum = pgEnum('attempt_status', ['recording', 'analyzing', 'done', 'failed']);

export const userSettings = pgTable('user_settings', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  // sparse: only fields the user changed; merged over DEFAULT_SETTINGS (src/settings.ts)
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: updatedAt(),
});

export const prompts = pgTable('prompts', {
  id: id(),
  slug: text('slug').notNull(),
  skill: skillEnum('skill').notNull(),
  part: integer('part').notNull(), // speaking 1|2|3, writing 1|2
  variant: variantEnum('variant'), // writing task 1 only
  type: text('type').notNull(), // opinion, discussion, line, bar, letter-formal, cue-card, p1-topic, p3-discussion …
  topic: text('topic').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  bullets: jsonb('bullets').$type<string[]>(),
  followUps: jsonb('follow_ups').$type<string[]>(), // P1 questions / P2 rounding-off qs / P3 questions
  chart: jsonb('chart').$type<unknown>(), // ChartSpec (see ai/types.ts)
  imageKey: text('image_key'),
  source: sourceEnum('source').notNull().default('generated'),
  sourceRef: text('source_ref'),
  restricted: boolean('restricted').notNull().default(false),
  groupId: text('group_id'), // links a P2 card with its P3 set
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('prompts_slug_idx').on(t.slug),
  index('prompts_skill_part_idx').on(t.skill, t.part),
  index('prompts_group_idx').on(t.groupId),
  // free-text search (routes/prompts.ts ilike '%q%'); needs the pg_trgm extension (created in migration 0003)
  index('prompts_title_trgm_idx').using('gin', t.title.op('gin_trgm_ops')),
  index('prompts_body_trgm_idx').using('gin', t.body.op('gin_trgm_ops')),
]);

export const attempts = pgTable('attempts', {
  id: id(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  promptId: text('prompt_id').notNull().references(() => prompts.id),
  skill: skillEnum('skill').notNull(),
  part: integer('part').notNull(),
  mode: modeEnum('mode').notNull().default('practice'),
  sessionId: text('session_id'),
  parentAttemptId: text('parent_attempt_id'),
  audioKey: text('audio_key'),
  audioMime: text('audio_mime'),
  text: text('text'),
  plan: text('plan'),
  energy: jsonb('energy').$type<number[]>(), // 50ms RMS frames 0-255
  marks: jsonb('marks').$type<number[]>(), // question start offsets (ms) within the recording
  conversationKey: text('conversation_key'), // live duplex: the candidate's mic mixed with the examiner's voice, for playback only (scoring uses audioKey)
  segments: jsonb('segments').$type<{ q: number; startMs: number; endMs: number; question?: string }[]>(), // when each answer window ran within the recording (practice: the app's question audio; live: the recorder paused while the examiner was audible); the gaps between them are examiner/app time, not pauses
  durationMs: integer('duration_ms'),
  overtime: boolean('overtime').notNull().default(false),
  status: statusEnum('status').notNull().default('recording'),
  error: text('error'),
  errorRetryable: boolean('error_retryable').notNull().default(true), // false: retrying now cannot help (AI credit/key), UI says "try later"
  stage: text('stage').$type<import('../ai/types').AnalysisStage>(), // while analyzing: the pipeline step now running (ai/types.ts AnalysisStage); null otherwise
  partial: jsonb('partial').$type<unknown>(), // while analyzing: feedback that is ready before the scores (AnalysisPartial)
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('attempts_user_created_idx').on(t.userId, t.createdAt),
  index('attempts_user_prompt_idx').on(t.userId, t.promptId),
  index('attempts_session_idx').on(t.sessionId),
  index('attempts_status_updated_idx').on(t.status, t.updatedAt),
  index('attempts_created_idx').on(t.createdAt),
]);

export const analyses = pgTable('analyses', {
  attemptId: text('attempt_id').primaryKey().references(() => attempts.id, { onDelete: 'cascade' }),
  result: jsonb('result').$type<unknown>().notNull(), // AnalysisResult (ai/types.ts)
  overall: numeric('overall', { mode: 'number' }).notNull(),
  criteria: jsonb('criteria').$type<Record<string, number>>().notNull(),
  models: jsonb('models').$type<Record<string, string>>().notNull(),
  createdAt: createdAt(),
});

export const mistakes = pgTable('mistakes', {
  id: id(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  attemptId: text('attempt_id').notNull().references(() => attempts.id, { onDelete: 'cascade' }),
  errorId: text('error_id').notNull(), // AnalysisResult.errors[].id
  category: text('category').notNull(),
  original: text('original').notNull(),
  correction: text('correction').notNull(),
  explanation: text('explanation').notNull(),
  time: real('time'), // seconds into audio (speaking)
  createdAt: createdAt(),
}, (t) => [index('mistakes_user_cat_idx').on(t.userId, t.category), index('mistakes_attempt_idx').on(t.attemptId)]);

export const cards = pgTable('cards', {
  id: id(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  front: text('front').notNull(),
  back: text('back').notNull(),
  source: text('source').notNull(), // 'mistake' | 'vocab' | 'fix'
  ease: real('ease').notNull().default(2.5),
  interval: integer('interval').notNull().default(0),
  reps: integer('reps').notNull().default(0),
  due: timestamp('due', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (t) => [index('cards_user_due_idx').on(t.userId, t.due), index('cards_user_front_idx').on(t.userId, t.front)]);

export const liveSessions = pgTable('live_sessions', {
  id: id(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  state: jsonb('state').$type<unknown>().notNull(), // LiveState (ai/examiner.ts)
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('live_sessions_user_idx').on(t.userId)]);

// ---------- Scoring gold set + per-model calibration (docs/scoring-research.md §2.4, §4, §6 P0-4) ----------
// PRIVATE: Cambridge / ielts.org script text lives only here (loaded by scripts/gold-import.ts), never in git.
export const scoringScripts = pgTable('scoring_scripts', {
  id: text('id').primaryKey(), // cam-{book}-{test}-w{task}, ieltsorg-{doc}-{n}, probe-…
  skill: skillEnum('skill').notNull(),
  taskFamily: text('task_family').notNull(), // writing: t2 | t1a | t1g; speaking: p1 | p2 | p3 | full
  role: text('role').notNull(), // anchor | calib | test | probe
  split: text('split').notNull(), // anchor | calibration | test (probes inherit their base script's split)
  band: real('band'), // official overall task band; for probes the nominal expected band
  groupId: text('group_id').notNull(), // task prompt (+ book/doc): CV folds and the anchor/scored split never straddle it
  prompt: jsonb('prompt').$type<{ slug?: string; title: string; body: string; bullets?: string[]; imageKey?: string; figure?: string; reconstructed?: boolean }>(),
  text: text('text'), // writing script or speaking transcript
  audioKey: text('audio_key'),
  note: text('note'), // short examiner comment
  expect: jsonb('expect').$type<Record<string, unknown>>(), // probes: { base, kind, level, maxBand, minBand, criterionMin, … }
  source: text('source').notNull(), // 'Cambridge IELTS 12 p124' | ielts.org URL | 'variant'
  sha256: text('sha256').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('scoring_scripts_skill_split_idx').on(t.skill, t.split, t.role)]);

export const scoringCalibrations = pgTable('scoring_calibrations', {
  key: text('key').primaryKey(), // sha256(modelId | promptHash | effort | k)
  skill: skillEnum('skill').notNull(),
  modelId: text('model_id').notNull(),
  promptHash: text('prompt_hash').notNull(),
  effort: text('effort').notNull(),
  k: integer('k').notNull(),
  provider: text('provider'),
  form: text('form').notNull(), // shift | linear | provisional
  slope: real('slope').notNull(),
  intercept: real('intercept').notNull(),
  mLo: real('m_lo'),
  mHi: real('m_hi'),
  lambda: real('lambda'),
  q90: real('q90').notNull(),
  q95: real('q95'),
  cv: jsonb('cv').$type<Record<string, unknown>>(),
  scriptIds: jsonb('script_ids').$type<string[]>().notNull().default([]),
  active: boolean('active').notNull().default(false),
  createdAt: createdAt(),
}, (t) => [index('scoring_calibrations_lookup_idx').on(t.modelId, t.promptHash, t.effort, t.k)]);

// ---------- Community mode (docs/community.md) ----------
export const providerEnum = pgEnum('key_provider', ['openrouter', 'openai', 'gemini']);

// A user's own API keys. The key itself is AES-256-GCM encrypted (src/keys.ts); only last4 is ever shown.
export const userApiKeys = pgTable('user_api_keys', {
  id: id(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  provider: providerEnum('provider').notNull(),
  ciphertext: text('ciphertext').notNull(), // base64(ciphertext || 16-byte GCM tag)
  iv: text('iv').notNull(), // base64, random per row
  last4: text('last4').notNull(),
  valid: boolean('valid').notNull().default(true), // false once the provider rejected it (401/403); the user must re-enter it
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('user_api_keys_user_provider_idx').on(t.userId, t.provider)]);

// One row per test paid from the community balance ("reservation"). unit_key = the speaking/writing session id, else the attempt id,
// so every part of one full test shares one row. refunded_at: analysis failed permanently or heard no speech.
export const quotaUsage = pgTable('quota_usage', {
  id: id(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  skill: skillEnum('skill').notNull(),
  unitKey: text('unit_key').notNull(),
  tier: text('tier').notNull(), // 'guest' | 'community' at reservation time
  ipHash: text('ip_hash'), // salted HMAC of the client IP; null when the address is unknown
  createdAt: createdAt(),
  refundedAt: timestamp('refunded_at', { withTimezone: true }),
  // Session units only: "part:attemptId" of every attempt this payment covers, kept even if the attempt is deleted, so a part can never be paid once and submitted again and again.
  members: text('members').array().notNull().default([]),
  refunds: integer('refunds').notNull().default(0), // times this unit was given back (failed analysis / no speech): capped per user and IP so refunds cannot be farmed
}, (t) => [
  uniqueIndex('quota_usage_unit_idx').on(t.userId, t.skill, t.unitKey),
  index('quota_usage_user_idx').on(t.userId, t.skill, t.createdAt),
  index('quota_usage_ip_idx').on(t.ipHash, t.skill, t.createdAt),
  index('quota_usage_created_idx').on(t.createdAt),
]);

// ---------- Listening & Reading tests (Cambridge-allow-listed users only; objective scoring, no AI) ----------
export const lrTests = pgTable('lr_tests', {
  id: id(),
  slug: text('slug').notNull().unique(),
  skill: text('skill').$type<'listening' | 'reading'>().notNull(),
  variant: text('variant').$type<'academic' | 'general'>().notNull(),
  source: text('source').$type<'cambridge' | 'generated'>().notNull(),
  ref: text('ref').notNull(),
  title: text('title').notNull(),
  data: jsonb('data').$type<import('@ielts/core').LrTest>().notNull(), // LrTest with answers + transcripts: never sent unstripped before submit
  restricted: boolean('restricted').notNull().default(true),
  /** Replaced by a newer version: hidden from lists and new attempts, still readable for past results. */
  retired: boolean('retired').notNull().default(false),
  createdAt: createdAt(),
}, (t) => [index('lr_tests_skill_source_idx').on(t.skill, t.source)]);

export const lrAttempts = pgTable('lr_attempts', {
  id: id(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  testId: text('test_id').notNull().references(() => lrTests.id),
  mode: text('mode').$type<'exam' | 'practice'>().notNull(),
  status: text('status').$type<'in_progress' | 'submitted'>().notNull().default('in_progress'),
  responses: jsonb('responses').$type<import('@ielts/core').LrResponses>().notNull().default({}),
  elapsedS: integer('elapsed_s').notNull().default(0),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  raw: integer('raw'),
  total: integer('total'),
  band: numeric('band', { mode: 'number' }),
  marks: jsonb('marks').$type<import('@ielts/core').LrMark[]>(),
  stats: jsonb('stats').$type<import('@ielts/core').LrStats>(), // runner pacing: seconds per part, answer changes, late answers
  analysis: jsonb('analysis').$type<import('@ielts/core').LrAnalysis>(), // deterministic review of the submit (gap mistake labels, TFNG rows, accuracy by type)
  parts: jsonb('parts').$type<number[]>(), // chosen parts (listening 1–4, reading passages 1–3); null = the whole test. Partial attempts get no band.
}, (t) => [
  index('lr_attempts_user_started_idx').on(t.userId, t.startedAt),
  index('lr_attempts_user_test_idx').on(t.userId, t.testId, t.status),
  index('lr_attempts_started_idx').on(t.startedAt),
]);

// ---------- Auth emails: one row per send attempt (sign-up / verification / password-reset codes), so a failed send leaves a record that survives deploys ----------
export const emailLog = pgTable('email_log', {
  id: id(),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  email: text('email').notNull(), // lowercased; masked whenever it is returned
  purpose: text('purpose').notNull(), // email-verification | forget-password
  status: text('status').notNull(), // sent | failed | skipped_cooldown
  providerId: text('provider_id'), // Resend email id
  error: text('error'), // short error kind (rate_limited | rejected | network | …), never the raw provider message
  attempts: integer('attempts').notNull().default(0),
  createdAt: createdAt(),
}, (t) => [index('email_log_lookup_idx').on(t.email, t.purpose, t.createdAt)]);

// ---------- Owner admin (docs/admin/DESIGN.md) ----------
// Emails granted Cambridge access from the admin UI; merged with OWNER_EMAILS and env CAMBRIDGE_ALLOWED_EMAILS in auth.ts (isCambridgeAllowed).
export const cambridgeAccess = pgTable('cambridge_access', {
  email: text('email').primaryKey(), // lowercased
  grantedBy: text('granted_by').notNull(), // owner email
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
});

// One row per browser tab recording (rrweb). Events live in R2: replay/<yyyy-mm-dd of started_at, UTC>/<id>/<seq>.json.gz. Deleted after 14 days (src/replay.ts).
export const replaySessions = pgTable('replay_sessions', {
  id: text('id').primaryKey(), // client-generated UUID, one per tab (sessionStorage)
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }), // guest or account; moves with link.ts when a guest signs up
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  lastAt: timestamp('last_at', { withTimezone: true }).notNull().defaultNow(),
  pages: jsonb('pages').$type<{ path: string; at: number }[]>().notNull().default([]), // visited paths with epoch ms, capped at 200
  bytes: integer('bytes').notNull().default(0), // uncompressed JSON bytes accepted so far (cap 30 MB)
  chunks: integer('chunks').notNull().default(0), // next expected seq (= highest accepted seq + 1)
  userAgent: text('user_agent'),
}, (t) => [index('replay_sessions_user_idx').on(t.userId, t.startedAt), index('replay_sessions_last_idx').on(t.lastAt)]);

// "Report a problem" inbox.
export const feedback = pgTable('feedback', {
  id: id(),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }), // null for a visitor with no session
  email: text('email'), // snapshot at send time; null for guests/visitors
  message: text('message').notNull(), // 1..2000 chars
  page: text('page').notNull(), // path + search, max 300
  replaySessionId: text('replay_session_id'), // replay_sessions.id when recording; no FK (replays expire)
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

// ---------- AI cost ledger (docs/admin/COSTS-AND-UI.md) ----------
// One row per paid external call. Append-only; no FKs on purpose: deleting a user or attempt must not erase what was spent.
export const aiCosts = pgTable('ai_costs', {
  id: id(),
  createdAt: createdAt(),
  userId: text('user_id'),
  attemptId: text('attempt_id'), // speaking/writing attempt; null for live turns
  sessionId: text('session_id'), // test session (attempts.sessionId) or live_sessions.id
  promptId: text('prompt_id'),
  skill: text('skill'), // 'speaking' | 'writing'
  part: integer('part'),
  stage: text('stage').notNull(), // stt | stt_verbatim | pronunciation | disfluency | feedback | score | examiner_llm | examiner_tts | live_realtime | lr_mistake | other
  provider: text('provider').notNull(), // openrouter | elevenlabs | openai | gemini
  model: text('model').notNull(),
  paidBy: text('paid_by').notNull(), // 'house' | 'own_key'
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  audioSeconds: numeric('audio_seconds', { mode: 'number' }),
  characters: integer('characters'),
  credits: numeric('credits', { mode: 'number' }),
  costUsd: numeric('cost_usd', { precision: 12, scale: 6, mode: 'number' }).notNull().default(0),
  ok: boolean('ok').notNull().default(true),
  retry: boolean('retry').notNull().default(false),
  meta: jsonb('meta').$type<Record<string, unknown>>(), // generationId, served, estimated, criterion, sample, extra, kept, timeout, status, usage
}, (t) => [
  index('ai_costs_created_idx').on(t.createdAt),
  index('ai_costs_user_created_idx').on(t.userId, t.createdAt),
  index('ai_costs_attempt_idx').on(t.attemptId),
  index('ai_costs_stage_idx').on(t.stage),
]);

// ---------- Full mock test (docs/mock-exam.md): one guided run of L, R, W, S. Section state is derived from the linked attempts; only the links live here ----------
export const mockExams = pgTable('mock_exams', {
  id: id(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  variant: variantEnum('variant').notNull(),
  source: text('source').$type<'cambridge' | 'generated'>().notNull(),
  ref: text('ref'), // "C19 T2" when source = cambridge
  listeningTestId: text('listening_test_id').notNull().references(() => lrTests.id),
  readingTestId: text('reading_test_id').notNull().references(() => lrTests.id),
  writingPromptIds: text('writing_prompt_ids').array().notNull(), // [task1, task2]
  speakingPromptIds: text('speaking_prompt_ids').array(), // recorded: [p1.., p2, p3]; null until Recorded is chosen
  listeningAttemptId: text('listening_attempt_id'),
  readingAttemptId: text('reading_attempt_id'),
  writingSessionId: text('writing_session_id').notNull(),
  writingAttemptIds: text('writing_attempt_ids').array().notNull().default(sql`'{}'::text[]`),
  writingStartedAt: timestamp('writing_started_at', { withTimezone: true }),
  writingElapsedS: integer('writing_elapsed_s').notNull().default(0),
  speakingMode: text('speaking_mode').$type<'recorded' | 'live'>(),
  speakingSessionId: text('speaking_session_id'),
  status: text('status').$type<'in_progress' | 'completed' | 'closed'>().notNull().default('in_progress'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (t) => [
  index('mock_exams_user_started_idx').on(t.userId, t.startedAt),
  uniqueIndex('mock_exams_one_open_idx').on(t.userId).where(sql`status = 'in_progress'`),
]);
