// The admin API contract (docs/admin/DESIGN.md section 3). The web imports the inferred types; slices implement against these shapes.
import { z } from '@hono/zod-openapi';
import { BalanceSchema } from '../routes/community';
import { Paged } from './common';

const iso = z.string().openapi({ description: 'ISO-8601 UTC' });
const int = z.number().int();

export const SkillS = z.enum(['speaking', 'writing', 'listening', 'reading']).openapi('AdminSkill');
export type Skill = z.infer<typeof SkillS>;

export const CambridgeInfo = z
  .object({ allowed: z.boolean(), source: z.enum(['owner', 'server-config', 'granted']).nullable(), canToggle: z.boolean().openapi({ description: 'source is null or granted' }) })
  .openapi('AdminCambridgeInfo');
export type CambridgeInfo = z.infer<typeof CambridgeInfo>;

export const ReplayRef = z.object({ id: z.string(), startedAt: iso });

export const ActivityItem = z
  .object({
    id: z.string(),
    kind: z.enum(['attempt', 'lr']),
    userId: z.string(),
    email: z.string().openapi({ description: "'' for a guest" }),
    isGuest: z.boolean(),
    skill: SkillS,
    title: z.string().openapi({ description: 'Prompt title / test title' }),
    mode: z.enum(['practice', 'live', 'exam']),
    parts: z.string().openapi({ description: "'Part 2' | 'Task 1' | 'Parts 1, 3' | 'All'" }),
    score: z.number().nullable().openapi({ description: 'Overall band (speaking/writing), band (L/R); null while pending or partial L/R' }),
    raw: z.object({ raw: z.number(), total: z.number() }).nullable().openapi({ description: 'L/R only' }),
    status: z.enum(['recording', 'analyzing', 'done', 'failed', 'in_progress', 'submitted']),
    startedAt: iso,
    resultPath: z.string().openapi({ description: "'/speaking/result/<id>' | '/writing/result/<id>' | '/lr/result/<id>' | '/lr/run/<id>' when in_progress" }),
    replays: z.array(ReplayRef).openapi({ description: "Replay sessions of that user whose [startedAt-5min, lastAt+5min] covers the attempt time, max 3" }),
  })
  .openapi('AdminActivityItem');
export type ActivityItem = z.infer<typeof ActivityItem>;

export const ReplayItem = z
  .object({
    id: z.string(),
    userId: z.string().nullable(),
    email: z.string().nullable(),
    startedAt: iso,
    lastAt: iso,
    durationS: z.number(),
    pages: z.array(z.object({ path: z.string(), at: z.number() })),
    bytes: z.number(),
    chunks: z.number(),
    userAgent: z.string().nullable(),
  })
  .openapi('AdminReplayItem');
export type ReplayItem = z.infer<typeof ReplayItem>;

export const UserRow = z
  .object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    isGuest: z.boolean(),
    emailVerified: z.boolean(),
    createdAt: iso,
    lastActiveAt: iso.nullable(),
    counts: z.object({ speaking: z.number(), writing: z.number(), listening: z.number(), reading: z.number() }),
    replays: z.number(),
    cambridge: CambridgeInfo,
  })
  .openapi('AdminUserRow');
export type UserRow = z.infer<typeof UserRow>;

export const FeedbackItem = z
  .object({
    id: z.string(),
    userId: z.string().nullable(),
    email: z.string().nullable(),
    message: z.string(),
    page: z.string(),
    replaySessionId: z.string().nullable(),
    userAgent: z.string().nullable(),
    status: z.enum(['new', 'seen', 'done']),
    createdAt: iso,
  })
  .openapi('AdminFeedbackItem');
export type FeedbackItem = z.infer<typeof FeedbackItem>;

// ---- 3.1 stats ----
const Day = z.object({ today: z.number(), d7: z.number(), d30: z.number() });
export const Overview = z
  .object({
    accounts: int,
    guests: int,
    signups: Day,
    newGuests: Day,
    activeUsers: z.object({ today: z.object({ accounts: int, guests: int }), d7: z.object({ accounts: int, guests: int }) }),
    testsToday: z.record(SkillS, z.object({ started: int, finished: int })),
    feedbackNew: int,
    generatedAt: iso,
  })
  .openapi('AdminOverview');
export type Overview = z.infer<typeof Overview>;

export const Growth = z
  .object({
    days: int,
    series: z.array(z.object({ date: z.string().openapi({ description: 'YYYY-MM-DD, Asia/Dhaka' }), signups: int, newGuests: int, active: int })),
    conversion: z.object({ guests: int, converted: int, rate: z.number().min(0).max(1) }),
  })
  .openapi('AdminGrowth');
export type Growth = z.infer<typeof Growth>;

export const ActivityPage = Paged(ActivityItem).openapi('AdminActivityPage');
export const UsersPage = Paged(UserRow).openapi('AdminUsersPage');

export const BandPoint = z.object({ at: iso, band: z.number() });
export const UserDetail = z
  .object({
    user: UserRow,
    attempts: z.array(ActivityItem),
    bandTrend: z.record(SkillS, z.array(BandPoint)),
    recordings: z.array(z.object({ attemptId: z.string(), part: int, createdAt: iso, durationMs: int.nullable(), audioUrl: z.string().nullable() })),
    replays: z.array(ReplayItem),
    cambridge: CambridgeInfo,
  })
  .openapi('AdminUserDetail');
export type UserDetail = z.infer<typeof UserDetail>;

export const TestHealth = z
  .object({
    id: z.string(),
    title: z.string(),
    skill: SkillS,
    part: int.nullable(),
    source: z.string(),
    started: int,
    finished: int,
    completionRate: z.number().min(0).max(1),
    avgBand: z.number().nullable(),
    avgRaw: z.number().nullable(),
  })
  .openapi('AdminTestHealth');
export type TestHealth = z.infer<typeof TestHealth>;
export const Tests = z.object({ prompts: z.array(TestHealth), lr: z.array(TestHealth) }).openapi('AdminTests');
export type Tests = z.infer<typeof Tests>;

export const Missed = z
  .object({
    testId: z.string(),
    title: z.string(),
    submitted: int,
    questions: z.array(z.object({ n: int, answered: int, missed: int, missRate: z.number() })),
  })
  .openapi('AdminMissed');
export type Missed = z.infer<typeof Missed>;

export const Funnel = z
  .object({
    days: int,
    steps: z.array(z.object({ key: z.enum(['visited', 'started', 'finished', 'signedUp', 'returned']), label: z.string(), users: int, pctOfVisited: z.number().min(0).max(1) })),
  })
  .openapi('AdminFunnel');
export type Funnel = z.infer<typeof Funnel>;

export const Content = z
  .object({
    prompts: z.array(z.object({ skill: z.enum(['speaking', 'writing']), part: int, source: z.enum(['generated', 'cambridge']), count: int })),
    lr: z.array(z.object({ skill: z.enum(['listening', 'reading']), source: z.enum(['cambridge', 'generated']), variant: z.enum(['academic', 'general']), tests: int })),
    speakingAudio: z.object({ prompts: int, promptsFullyRendered: int, lines: int, linesRendered: int, manifestEntries: int.nullable() }),
  })
  .openapi('AdminContent');
export type Content = z.infer<typeof Content>;

// ---- 3.2 ops ----
export const Warn = z.enum(['ok', 'low', 'critical']);
export const Costs = z
  .object({
    openrouter: z.object({ available: z.boolean(), limit: z.number().nullable(), usage: z.number().nullable(), remaining: z.number().nullable(), usageDaily: z.number().nullable(), usageWeekly: z.number().nullable(), usageMonthly: z.number().nullable(), warn: Warn }),
    elevenlabs: z.object({ available: z.boolean(), tier: z.string().nullable(), characterCount: z.number().nullable(), characterLimit: z.number().nullable(), remaining: z.number().nullable(), resetsAt: iso.nullable(), warn: Warn }),
    community: BalanceSchema,
    minBalance: z.number(),
    warnings: z.array(z.string()),
    cachedAt: iso,
  })
  .openapi('AdminCosts');
export type Costs = z.infer<typeof Costs>;

export const Health = z
  .object({
    counts: z.object({ failed24h: z.number(), stuckAnalyzing: z.number(), emailFailed24h: z.number() }),
    attempts: z.array(
      z.object({
        id: z.string(), userId: z.string(), email: z.string(), isGuest: z.boolean(), skill: z.enum(['speaking', 'writing']), part: z.number(), status: z.enum(['analyzing', 'failed']),
        stage: z.string().nullable(), error: z.string().nullable(), errorRetryable: z.boolean(), ageMin: z.number(), createdAt: iso, updatedAt: iso, canRetry: z.boolean(), resultPath: z.string(),
      }),
    ),
    emailFailures: z.array(z.object({ id: z.string(), email: z.string(), purpose: z.string(), status: z.string(), error: z.string().nullable(), attempts: z.number(), createdAt: iso })),
    recentErrors: z.array(z.object({ error: z.string(), count: z.number(), lastAt: iso })),
  })
  .openapi('AdminHealth');
export type Health = z.infer<typeof Health>;

// ---- 5. spend (docs/admin/COSTS-AND-UI.md section 5): money is USD rounded to 6 decimals ----
export const PaidBy = z.enum(['house', 'own_key', 'all']);
export const SpendQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  paidBy: PaidBy.default('house').openapi({ description: "Who paid: the owner's server keys ('house', default), the user's own keys, or both" }),
});
const Usd = z.number().openapi({ description: 'USD' });
const SpendTotal = z.object({ house: Usd, ownKey: Usd, calls: int });

export const SpendSummary = z
  .object({
    since: iso.nullable().openapi({ description: 'First recorded call; earlier attempts have no cost rows ("not recorded")' }),
    today: SpendTotal,
    last7d: SpendTotal,
    last30d: SpendTotal,
    allTime: SpendTotal,
    okRate: z.number().nullable().openapi({ description: '0-1 share of successful calls, last 30 d (all payers)' }),
    waste: z.object({ usd: Usd, share: z.number() }).openapi({ description: 'Wasted spend and its share of all spend in the window' }),
    perAttempt: z.array(z.object({ skill: z.enum(['speaking', 'writing']), part: int, n: int, avgUsd: Usd, medianUsd: Usd, p90Usd: Usd, wasteUsd: Usd.openapi({ description: 'Waste per finished attempt' }) })).openapi({ description: 'Finished attempts (status done) that have cost rows, in the window' }),
    unrecordedAttempts: int.openapi({ description: 'Finished speaking/writing attempts in the window with no cost rows (ran before tracking started)' }),
    drift: z.object({
      recorded: z.object({ day: Usd, week: Usd, month: Usd }),
      openrouter: z.object({ day: Usd.nullable(), week: Usd.nullable(), month: Usd.nullable() }),
      warn: z.boolean().openapi({ description: 'Recorded house OpenRouter spend and OpenRouter usage_weekly differ by more than 5 percent: some call site is not recorded' }),
    }),
  })
  .openapi('AdminSpendSummary');
export type SpendSummary = z.infer<typeof SpendSummary>;

export const SpendSeries = z
  .object({ bucket: z.enum(['day', 'week', 'month']), points: z.array(z.object({ date: z.string().openapi({ description: 'Dhaka bucket start, YYYY-MM-DD' }), house: Usd, ownKey: Usd, calls: int })) })
  .openapi('AdminSpendSeries');
export type SpendSeries = z.infer<typeof SpendSeries>;

export const SpendDim = z.enum(['stage', 'model', 'provider', 'skill_part', 'user', 'prompt']);
export const SpendBy = z
  .object({
    dim: SpendDim,
    total: Usd,
    items: z.array(z.object({ key: z.string(), label: z.string(), costUsd: Usd, calls: int, attempts: int, avgPerCall: Usd, share: z.number() })),
  })
  .openapi('AdminSpendBy');
export type SpendBy = z.infer<typeof SpendBy>;

export const SpendAttempt = z
  .object({
    attempt: z.object({ id: z.string(), skill: SkillS, part: int, status: z.string(), createdAt: iso, userId: z.string(), email: z.string().openapi({ description: "'' for a guest" }), isGuest: z.boolean(), title: z.string() }),
    recorded: z.boolean().openapi({ description: 'false: no cost rows exist (the attempt ran before tracking started); show "not recorded", not $0' }),
    items: z.array(z.object({
      at: iso, stage: z.string(), provider: z.string(), model: z.string(), paidBy: z.enum(['house', 'own_key']),
      inputTokens: int.nullable(), outputTokens: int.nullable(), audioSeconds: z.number().nullable(), characters: int.nullable(),
      costUsd: Usd, ok: z.boolean(), retry: z.boolean(), estimated: z.boolean(),
      criterion: z.string().nullable(), sample: int.nullable(), extra: z.boolean(), kept: z.boolean().nullable(), timeout: z.boolean(),
    })),
    stages: z.array(z.object({ stage: z.string(), costUsd: Usd, calls: int })),
    totalUsd: Usd,
    wasteUsd: Usd,
    sessionTotal: z.object({ usd: Usd, parts: int }).nullable().openapi({ description: 'Everything recorded for the test session this attempt belongs to' }),
  })
  .openapi('AdminSpendAttempt');
export type SpendAttempt = z.infer<typeof SpendAttempt>;

export const SpendWaste = z
  .object({
    totalUsd: Usd,
    spendUsd: Usd,
    share: z.number(),
    parts: z.array(z.object({ kind: z.enum(['failed', 'retry', 'discarded_stt', 'extra_samples', 'failed_attempt']), usd: Usd, calls: int })),
  })
  .openapi('AdminSpendWaste');
export type SpendWaste = z.infer<typeof SpendWaste>;

export const SpendForecast = z
  .object({
    remaining: Usd.nullable().openapi({ description: 'OpenRouter key limit minus usage' }),
    burnPerDay7d: Usd.nullable().openapi({ description: 'House OpenRouter spend per day, mean of the last 7 full Dhaka days; null with nothing recorded' }),
    burnPerDay14d: Usd.nullable(),
    daysLeft: z.number().nullable(),
    runsOutOn: z.string().nullable().openapi({ description: 'Dhaka date YYYY-MM-DD' }),
    usableLeft: Usd.nullable().openapi({ description: 'remaining minus COMMUNITY_MIN_BALANCE' }),
    avgCostPerTest: Usd.nullable().openapi({ description: 'Mean house cost of a finished speaking/writing attempt, last 30 d' }),
    testsLeft: z.number().nullable(),
    status: z.enum(['ok', 'low', 'critical', 'unknown']).openapi({ description: 'low < 7 days left, critical < 3, unknown without a burn rate or balance' }),
  })
  .openapi('AdminSpendForecast');
export type SpendForecast = z.infer<typeof SpendForecast>;
