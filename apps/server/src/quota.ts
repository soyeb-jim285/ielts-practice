// Community quotas and plans (docs/community.md): who pays for a test, how many a person gets, and the reserve/refund ledger (quota_usage).
import { and, count, eq, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { keyCtx } from './ai/keyctx';
import { balanceExhausted, communityBalance, type Balance } from './community';
import { cambridgeSource, isCambridgeAllowed } from './auth';
import { db } from './db/client';
import { analyses, attempts, quotaUsage, userLimits } from './db/schema';
import { env } from './env';
import { ApiError, type ErrorCode } from './errors';
import { burstOk } from './ratelimit';
import type { AppEnv } from './types';

/** What a quota counts: a writing test, a recorded speaking practice test, or a live examiner session (LiveKit). */
export type Skill = 'speaking' | 'writing' | 'examiner';
export type Tier = 'guest' | 'community' | 'subscriber' | 'unlimited';
export const SKILLS: Skill[] = ['speaking', 'writing', 'examiner'];
const DAY = 86_400_000;

type Plan = 'guest' | 'community' | 'subscriber';
/** Rolling windows per plan and skill: [tests, days]; every window must have room. null = unlimited. docs/community.md */
export const PLANS: Record<Plan, Record<Skill, [number, number][] | null>> = {
  guest: { writing: [[2, 7]], speaking: [[5, 30]], examiner: [[3, 30]] },
  community: { writing: [[5, 7]], speaking: [[10, 30]], examiner: [[5, 30]] },
  subscriber: { writing: null, speaking: null, examiner: [[5, 1], [40, 30]] },
};
const WINDOW = { 1: 'day', 7: 'week', 30: 'month' } as const;

/** Who is paying and what they may do. `owner` (OWNER_EMAILS or CAMBRIDGE_ALLOWED_EMAILS, verified) is exempt from quotas.
 *  An admin Cambridge grant is content access only. `limits`: the owner's per-user overrides (admin, user_limits); `unlimited` is exempt like an owner.
 *  `subscribed`: on the paid plan (user_limits.subscribed_until in the future). */
export type Limits = { speaking: number | null; writing: number | null; unlimited: boolean };
export type Payer = { userId: string; tier: Tier; owner: boolean; limits?: Limits; subscribed?: boolean };

type Who = { id: string; email: string; emailVerified: boolean; isAnonymous?: boolean | null };
export async function payerOf(u: Who): Promise<Payer> {
  if (u.isAnonymous) return { userId: u.id, tier: 'guest', owner: false };
  const owner = isCambridgeAllowed(u) && cambridgeSource(u.email) !== 'granted';
  const [row] = await db.select({ speaking: userLimits.speaking, writing: userLimits.writing, unlimited: userLimits.unlimited, until: userLimits.subscribedUntil }).from(userLimits).where(eq(userLimits.userId, u.id));
  const limits = row && { speaking: row.speaking, writing: row.writing, unlimited: row.unlimited };
  const subscribed = !!row?.until && row.until > new Date();
  return { userId: u.id, owner, limits, subscribed, tier: owner || limits?.unlimited ? 'unlimited' : subscribed ? 'subscriber' : 'community' };
}

/** Is this account on the paid plan now (for content gates that do not need the whole payer). */
export const isSubscribed = async (userId: string) => {
  const [r] = await db.select({ until: userLimits.subscribedUntil }).from(userLimits).where(eq(userLimits.userId, userId));
  return !!r?.until && r.until > new Date();
};

/** The windows this payer is held to for one skill; null = no limit. */
export function rulesOf(p: Payer, skill: Skill): [number, number][] | null {
  if (p.owner || p.limits?.unlimited) return null;
  const rules = PLANS[p.subscribed ? 'subscriber' : p.tier === 'guest' ? 'guest' : 'community'][skill];
  const override = skill === 'examiner' ? null : p.limits?.[skill];
  return rules && override != null ? rules.map(([n, d], i) => [i === rules.length - 1 ? override : n, d]) : rules;
}

/** The LiveKit examiner runs on the server's keys (Soniox + OpenRouter) for everyone, limited like a test (see attachLiveKit). */
export const livekitReady = () => !!(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET && env.LIVEKIT_REPORT_SECRET && env.SONIOX_API_KEY && env.OPENROUTER_API_KEY);

export type SkillQuota = {
  used: number;
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
  window: 'day' | 'week' | 'month' | null;
  /** Why a test cannot start now (null: it can). */
  blocked: Extract<ErrorCode, 'quota_exceeded' | 'community_balance_exhausted' | 'community_busy'> | null;
};

type Executor = Pick<typeof db, 'select'>;
const hourlyCount = async (x: Executor) => (await x.select({ n: count() }).from(quotaUsage).where(and(gte(quotaUsage.createdAt, new Date(Date.now() - 3_600_000)), isNull(quotaUsage.refundedAt))))[0]!.n;

const UNLIMITED: SkillQuota = { used: 0, limit: null, remaining: null, resetAt: null, window: null, blocked: null };

async function evaluate(x: Executor, p: Payer, skill: Skill, ipHash: string | null, shared: { balance: Balance; hourly: number }): Promise<SkillQuota> {
  const rules = rulesOf(p, skill);
  if (!rules) return UNLIMITED;
  const counted = (since: Date, where: ReturnType<typeof and>) =>
    x.select({ n: count(), oldest: sql<string | null>`min(${quotaUsage.createdAt})` }).from(quotaUsage).where(and(eq(quotaUsage.skill, skill), gte(quotaUsage.createdAt, since), isNull(quotaUsage.refundedAt), where)).then((r) => r[0]!);
  // The window with the least room decides what the person sees.
  let tightest: SkillQuota | null = null;
  for (const [limit, days] of rules) {
    const since = new Date(Date.now() - days * DAY);
    const mine = await counted(since, eq(quotaUsage.userId, p.userId));
    let remaining = limit - mine.n;
    let oldest = mine.oldest;
    // Guests are also counted per client IP across all anonymous users, so clearing storage to get a fresh guest does not mint free tests.
    if (p.tier === 'guest' && ipHash) {
      const ip = await counted(since, and(eq(quotaUsage.ipHash, ipHash), eq(quotaUsage.tier, 'guest')));
      if (limit * env.GUESTS_PER_IP - ip.n < remaining) (remaining = limit * env.GUESTS_PER_IP - ip.n), (oldest = ip.oldest);
    }
    remaining = Math.max(0, Math.min(limit, remaining));
    // ponytail: the oldest counted test frees the next slot; exact unless the count is above the limit (an admin lowered it), then it is early.
    const q: SkillQuota = { used: limit - remaining, limit, remaining, resetAt: oldest ? new Date(new Date(oldest).getTime() + days * DAY).toISOString() : null, window: WINDOW[days as keyof typeof WINDOW], blocked: null };
    if (!tightest || remaining <= tightest.remaining!) tightest = q; // a tie goes to the longer window: its reset is when a test really frees up
  }
  const q = tightest!;
  q.blocked = q.remaining! <= 0 ? 'quota_exceeded' : balanceExhausted(shared.balance) ? 'community_balance_exhausted' : shared.hourly >= env.COMMUNITY_MAX_PER_HOUR ? 'community_busy' : null;
  return q;
}

/** GET /api/quota and /api/me: the whole picture for one person. */
export async function quotaSnapshot(p: Payer, ipHash: string | null) {
  const shared = { balance: await communityBalance(), hourly: await hourlyCount(db) };
  const [speaking, writing, examiner] = await Promise.all(SKILLS.map((s) => evaluate(db, p, s, ipHash, shared)));
  return { tier: p.tier, speaking: speaking!, writing: writing!, examiner: examiner!, live: livekitReady() };
}

const SKILL_NAME: Record<Skill, string> = { speaking: 'speaking practice tests', writing: 'writing tests', examiner: 'live examiner sessions' };
const PERIOD = { day: 'today', week: 'this week', month: 'this month' } as const;
function blockedError(p: Payer, skill: Skill, q: SkillQuota): ApiError {
  if (q.blocked === 'community_balance_exhausted')
    return new ApiError(402, { error: 'Scoring is paused for a short while. Please try again later.', code: 'community_balance_exhausted' });
  if (q.blocked === 'community_busy')
    return new ApiError(503, { error: 'A lot of people are practising right now. Please try again in a few minutes.', code: 'community_busy' });
  const more = p.tier === 'guest' ? ' Create a free account for more.' : '';
  return new ApiError(429, {
    error: `You've used your ${SKILL_NAME[skill]} for ${PERIOD[q.window ?? 'month']}.${more}`,
    code: 'quota_exceeded',
    skill,
    resetAt: q.resetAt,
    tier: p.tier,
    window: q.window,
  });
}

function burst(p: Payer, ipHash: string | null) {
  if (!burstOk(ipHash ?? p.userId)) throw new ApiError(429, { error: 'Too many requests, slow down.', code: 'too_many_requests' });
}

type Member = { part: number; id: string };
const tag = (m: Member) => `${m.part}:${m.id}`;
const unitRow = (x: Executor, p: Payer, skill: Skill, unitKey: string) =>
  x.select({ id: quotaUsage.id, refundedAt: quotaUsage.refundedAt, members: quotaUsage.members }).from(quotaUsage).where(and(eq(quotaUsage.userId, p.userId), eq(quotaUsage.skill, skill), eq(quotaUsage.unitKey, unitKey))).limit(1).then((r) => r[0]);
/** A paid unit covers an attempt of a session when it is already a member (a retry) or its part has not been paid yet. A part paid under another attempt (even a deleted one) is a new test, so one payment cannot be reused for endless re-takes. */
const covers = (row: Awaited<ReturnType<typeof unitRow>>, m?: Member) => !!row && !row.refundedAt && (!m || row.members.includes(tag(m)) || !row.members.some((t) => t.startsWith(`${m.part}:`)));

/** Before starting a test (create attempt, start live): throws the same errors a submit would, but reserves nothing, so people learn before writing the essay.
 *  A unit that is already paid (another part of the same test) always passes. */
export async function checkStart(p: Payer, skill: Skill, ipHash: string | null, unitKey?: string, member?: Member) {
  if (!rulesOf(p, skill)) return;
  burst(p, ipHash);
  if (unitKey && covers(await unitRow(db, p, skill, unitKey), member)) return;
  const q = await evaluate(db, p, skill, ipHash, { balance: await communityBalance(), hourly: await hourlyCount(db) });
  if (q.blocked) throw blockedError(p, skill, q);
}

const LOCK = 7_260_001; // one lock serialises every reservation: per-user, per-IP and global counts stay exact (a few per second at most)

/** Reserves one test for (user, skill, unit). Idempotent per unit: re-submitting or re-scoring the same attempt, or sending another part of the same test, costs nothing more.
 *  `member`: the attempt being paid when the unit is a session (all its parts share one payment, each part once); a part already paid under a different attempt is charged as its own unit (keyed by the attempt).
 *  An array is a finished live session registering all its parts at once: they join the payment as they are.
 *  Everything runs under the advisory lock, so concurrent submits of the same part cannot both ride on one payment. */
export async function reserve(p: Payer, skill: Skill, unitKey: string, ipHash: string | null, member?: Member | Member[]) {
  if (!rulesOf(p, skill)) return;
  burst(p, ipHash);
  const balance = await communityBalance();
  const ms = member === undefined ? [] : Array.isArray(member) ? member : [member];
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK})`);
    let key = unitKey;
    let members = ms.map(tag);
    let row = await unitRow(tx, p, skill, key);
    if (row && !row.refundedAt) {
      const add = members.filter((t) => !row!.members.includes(t));
      if (!add.length) return; // a retry of an attempt already paid
      if (Array.isArray(member) || !row.members.some((t) => t.startsWith(`${ms[0]!.part}:`))) {
        await tx.update(quotaUsage).set({ members: sql`${quotaUsage.members} || ARRAY[${sql.join(add.map((t) => sql`${t}`), sql`, `)}]::text[]` }).where(eq(quotaUsage.id, row.id));
        return;
      }
      // This part was already paid under another attempt: this one is a test of its own.
      key = ms[0]!.id;
      members = [];
      row = await unitRow(tx, p, skill, key);
      if (row && !row.refundedAt) return;
    }
    const q = await evaluate(tx, p, skill, ipHash, { balance, hourly: await hourlyCount(tx) });
    if (q.blocked) throw blockedError(p, skill, q);
    // A refunded unit (failed analysis, retried now) is charged again from now on.
    if (row) await tx.update(quotaUsage).set({ refundedAt: null, createdAt: new Date(), tier: p.tier, ipHash, members }).where(eq(quotaUsage.id, row.id));
    else await tx.insert(quotaUsage).values({ userId: p.userId, skill, unitKey: key, tier: p.tier, ipHash, members, createdAt: new Date() });
  });
}

type AttemptRef = { id: string; userId: string; skill: 'speaking' | 'writing'; mode?: string; part: number; sessionId: string | null };
/** A live attempt is paid under its examiner session. */
const kindOf = (a: AttemptRef): Skill => (a.mode === 'live' ? 'examiner' : a.skill);

/** The unit one attempt is paid under: its session (all parts of a full test count once) or itself. */
export const reserveAttempt = (p: Payer, a: AttemptRef, ipHash: string | null) => reserve(p, kindOf(a), a.sessionId ?? a.id, ipHash, a.sessionId ? { part: a.part, id: a.id } : undefined);
export const checkAttempt = (p: Payer, a: AttemptRef, ipHash: string | null) => checkStart(p, kindOf(a), ipHash, a.sessionId ?? a.id, a.sessionId ? { part: a.part, id: a.id } : undefined);

/** Refunds one user (or, for guests, one IP) may get in 24 h. Failed analyses and silent recordings are mostly honest accidents, but each one already spent STT/LLM credit, so they cannot be an endless free retry loop. */
export const REFUND_CAP = 5;

/** Gives the test back (analysis failed, or no speech was heard). For a session the unit is refunded only when no other part of it is still counting. Never throws.
 *  Past REFUND_CAP refunds in 24 h the test stays spent. */
export async function refundAttempt(ref: AttemptRef) {
  try {
    // A guest may have signed up while this attempt was being analysed (link.ts moved it and its quota row to the account): refund under the owner it has now, not the one the caller read earlier.
    const [cur] = await db.select({ userId: attempts.userId }).from(attempts).where(eq(attempts.id, ref.id));
    const a = { ...ref, userId: cur?.userId ?? ref.userId };
    const skill = kindOf(a);
    const [unit] = await db
      .select({ tier: quotaUsage.tier, ipHash: quotaUsage.ipHash })
      .from(quotaUsage)
      .where(and(eq(quotaUsage.userId, a.userId), eq(quotaUsage.skill, skill), inArray(quotaUsage.unitKey, a.sessionId ? [a.id, a.sessionId] : [a.id]), isNull(quotaUsage.refundedAt)))
      .limit(1);
    if (!unit) return; // nothing paid, nothing to give back
    const since = new Date(Date.now() - DAY);
    const [used] = await db
      .select({ n: sql<number>`coalesce(sum(${quotaUsage.refunds}), 0)::int` })
      .from(quotaUsage)
      .where(and(gte(quotaUsage.createdAt, since), unit.tier === 'guest' && unit.ipHash ? eq(quotaUsage.ipHash, unit.ipHash) : eq(quotaUsage.userId, a.userId)));
    if (used!.n >= REFUND_CAP) return console.warn('refund cap reached, test stays spent', a.id);
    const now = new Date();
    const free = (unitKey: string) => db.update(quotaUsage).set({ refundedAt: now, refunds: sql`${quotaUsage.refunds} + 1` }).where(and(eq(quotaUsage.userId, a.userId), eq(quotaUsage.skill, skill), eq(quotaUsage.unitKey, unitKey), isNull(quotaUsage.refundedAt))).returning({ id: quotaUsage.id });
    if ((await free(a.id)).length || !a.sessionId) return; // the attempt was its own unit
    const [sibling] = await db
      .select({ id: attempts.id })
      .from(attempts)
      .leftJoin(analyses, eq(analyses.attemptId, attempts.id))
      .where(and(eq(attempts.userId, a.userId), eq(attempts.sessionId, a.sessionId), ne(attempts.id, a.id), or(eq(attempts.status, 'analyzing'), and(eq(attempts.status, 'done'), sql`coalesce(${analyses.result}->>'noSpeech', 'false') <> 'true'`))))
      .limit(1);
    if (!sibling) await free(a.sessionId);
  } catch (e) {
    console.error('quota refund failed', ref.id, (e as Error).message);
  }
}

/** Loads the caller's payer once (c.get('payer')) and tags the request's AI costs with the user. Use after requireUser. */
export const withPayer = createMiddleware<AppEnv>(async (c, next) => {
  const u = c.get('user');
  if (!u) throw new HTTPException(401, { message: 'Sign in required' });
  const payer = await payerOf(u);
  c.set('payer', payer);
  await keyCtx.run({ cost: { userId: u.id } }, next);
});

/** The live examiner is LiveKit on the server's keys: unavailable only when the server has not configured it. */
export function requireLive() {
  if (!livekitReady()) throw new HTTPException(503, { message: 'The live examiner is not available right now.' });
}
