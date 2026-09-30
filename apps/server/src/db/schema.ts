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
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

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
  durationMs: integer('duration_ms'),
  overtime: boolean('overtime').notNull().default(false),
  status: statusEnum('status').notNull().default('recording'),
  error: text('error'),
  errorRetryable: boolean('error_retryable').notNull().default(true), // false: retrying now cannot help (AI credit/key), UI says "try later"
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('attempts_user_created_idx').on(t.userId, t.createdAt),
  index('attempts_user_prompt_idx').on(t.userId, t.promptId),
  index('attempts_session_idx').on(t.sessionId),
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
