// Community quotas (docs/community.md): who pays for a test, how many a person gets, and the reserve/refund ledger (quota_usage).
import { and, count, eq, gte, isNull, ne, or, sql } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { keyCtx } from './ai/keyctx';
import { balanceExhausted, communityBalance, type Balance } from './community';
import { isCambridgeAllowed } from './auth';
import { db } from './db/client';
import { analyses, attempts, quotaUsage } from './db/schema';
import { env } from './env';
import { ApiError, type ErrorCode } from './errors';
import { getUserKeys, markKeyInvalid, type Keys } from './keys';
import { burstOk } from './ratelimit';
import type { AppEnv } from './types';

export type Skill = 'speaking' | 'writing';
export type Tier = 'guest' | 'community' | 'own-key';
export type LiveProvider = 'turn' | 'gpt-live' | 'gemini-live';
export const SKILLS: Skill[] = ['speaking', 'writing'];
/** Tests per window for the shared-balance tiers: guests 1 a week, signed-in users 1 a day, per skill. */
export const LIMIT = 1;
const DAY = 86_400_000;

/** Who is paying and what they may do. `owner` (CAMBRIDGE_ALLOWED_EMAILS, verified) is exempt from quotas and may use the server's own provider keys. */
export type Payer = { userId: string; tier: Tier; owner: boolean; keys: Keys };

type Who = { id: string; email: string; emailVerified: boolean; isAnonymous?: boolean | null };
export async function payerOf(u: Who): Promise<Payer> {
  if (u.isAnonymous) return { userId: u.id, tier: 'guest', owner: false, keys: {} };
  const owner = isCambridgeAllowed(u);
  const keys = await getUserKeys(u.id);
  return { userId: u.id, owner, keys, tier: owner || keys.openrouter ? 'own-key' : 'community' };
}

/** The key a live provider session is created with: the user's own, or (owner only) the server's. */
export const liveKey = (p: Payer, provider: 'openai' | 'gemini') => p.keys[provider] ?? (p.owner ? (provider === 'openai' ? env.OPENAI_API_KEY : env.GEMINI_API_KEY) : undefined);
export const liveProviders = (p: Payer): LiveProvider[] => [
  ...(p.keys.openrouter || p.owner ? (['turn'] as const) : []),
  ...(liveKey(p, 'openai') ? (['gpt-live'] as const) : []),
  ...(liveKey(p, 'gemini') ? (['gemini-live'] as const) : []),
];

/** Daily window resets 00:00 UTC; weekly resets Monday 00:00 UTC. */
export function windowOf(tier: 'guest' | 'community', now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (tier === 'community') return { kind: 'day' as const, start: new Date(today), resetAt: new Date(today + DAY) };
  const monday = today - ((now.getUTCDay() + 6) % 7) * DAY;
  return { kind: 'week' as const, start: new Date(monday), resetAt: new Date(monday + 7 * DAY) };
}

export type SkillQuota = {
  used: number;
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
  window: 'day' | 'week' | null;
  /** Why a test cannot start now (null: it can). */
  blocked: Extract<ErrorCode, 'quota_exceeded' | 'community_balance_exhausted' | 'community_busy'> | null;
};

type Executor = Pick<typeof db, 'select'>;
const hourlyCount = async (x: Executor) => (await x.select({ n: count() }).from(quotaUsage).where(and(gte(quotaUsage.createdAt, new Date(Date.now() - 3_600_000)), isNull(quotaUsage.refundedAt))))[0]!.n;

async function evaluate(x: Executor, p: Payer, skill: Skill, ipHash: string | null, shared: { balance: Balance; hourly: number }): Promise<SkillQuota> {
  if (p.tier === 'own-key') return { used: 0, limit: null, remaining: null, resetAt: null, window: null, blocked: null };
  const w = windowOf(p.tier);
  const live = (where: ReturnType<typeof and>) => x.select({ n: count() }).from(quotaUsage).where(and(eq(quotaUsage.skill, skill), gte(quotaUsage.createdAt, w.start), isNull(quotaUsage.refundedAt), where));
  let remaining = LIMIT - (await live(eq(quotaUsage.userId, p.userId)))[0]!.n;
  // Guests are also counted per client IP across all anonymous users, so clearing storage to get a fresh guest does not mint free tests.
  if (p.tier === 'guest' && ipHash) remaining = Math.min(remaining, env.GUEST_IP_WEEKLY_CAP - (await live(and(eq(quotaUsage.ipHash, ipHash), eq(quotaUsage.tier, 'guest'))))[0]!.n);
  remaining = Math.max(0, remaining);
  const blocked = remaining <= 0 ? 'quota_exceeded' : balanceExhausted(shared.balance) ? 'community_balance_exhausted' : shared.hourly >= env.COMMUNITY_MAX_PER_HOUR ? 'community_busy' : null;
  return { used: LIMIT - Math.min(LIMIT, remaining), limit: LIMIT, remaining: Math.min(LIMIT, remaining), resetAt: w.resetAt.toISOString(), window: w.kind, blocked };
}

/** GET /api/quota and /api/me: the whole picture for one person. */
export async function quotaSnapshot(p: Payer, ipHash: string | null) {
  const shared = { balance: await communityBalance(), hourly: p.tier === 'own-key' ? 0 : await hourlyCount(db) };
  const [speaking, writing] = await Promise.all(SKILLS.map((s) => evaluate(db, p, s, ipHash, shared)));
  return { tier: p.tier, speaking: speaking!, writing: writing!, liveProviders: liveProviders(p), communityBalance: shared.balance };
}

const SKILL_NAME: Record<Skill, string> = { speaking: 'speaking', writing: 'writing' };
function blockedError(p: Payer, skill: Skill, q: SkillQuota): ApiError {
  if (q.blocked === 'community_balance_exhausted')
    return new ApiError(402, { error: 'The community balance is used up for now. Add your own OpenRouter key in Settings to keep practising, or try again later.', code: 'community_balance_exhausted' });
  if (q.blocked === 'community_busy')
    return new ApiError(503, { error: 'A lot of people are practising right now. Please try again in a few minutes.', code: 'community_busy' });
  const when = q.window === 'week' ? 'this week' : 'today';
  return new ApiError(429, {
    error:
      p.tier === 'guest'
        ? `You've used your free ${SKILL_NAME[skill]} test ${when}. Create an account for 1 test a day.`
        : `You've used your free ${SKILL_NAME[skill]} test ${when}. Add your own OpenRouter key in Settings for unlimited tests.`,
    code: 'quota_exceeded',
    skill,
    resetAt: q.resetAt,
    tier: p.tier,
  });
}

function burst(p: Payer, ipHash: string | null) {
  if (!burstOk(ipHash ?? p.userId)) throw new ApiError(429, { error: 'Too many requests, slow down.', code: 'too_many_requests' });
}

const unitActive = async (x: Executor, p: Payer, skill: Skill, unitKey: string) =>
  (await x.select({ id: quotaUsage.id }).from(quotaUsage).where(and(eq(quotaUsage.userId, p.userId), eq(quotaUsage.skill, skill), eq(quotaUsage.unitKey, unitKey), isNull(quotaUsage.refundedAt))).limit(1)).length > 0;

/** Before starting a test (create attempt, start live): throws the same errors a submit would, but reserves nothing, so people learn before writing the essay.
 *  A unit that is already paid (another part of the same test) always passes. */
export async function checkStart(p: Payer, skill: Skill, ipHash: string | null, unitKey?: string) {
  if (p.tier === 'own-key') return;
  burst(p, ipHash);
  if (unitKey && (await unitActive(db, p, skill, unitKey))) return;
  const q = await evaluate(db, p, skill, ipHash, { balance: await communityBalance(), hourly: await hourlyCount(db) });
  if (q.blocked) throw blockedError(p, skill, q);
}

const LOCK = 7_260_001; // one lock serialises every reservation: per-user, per-IP and global counts stay exact (a few per second at most)

/** Reserves one test for (user, skill, unit). Idempotent per unit: re-submitting or re-scoring the same attempt, or sending another part of the same test, costs nothing more. */
export async function reserve(p: Payer, skill: Skill, unitKey: string, ipHash: string | null) {
  if (p.tier === 'own-key') return;
  burst(p, ipHash);
  const balance = await communityBalance();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK})`);
    const [row] = await tx.select({ id: quotaUsage.id, refundedAt: quotaUsage.refundedAt }).from(quotaUsage).where(and(eq(quotaUsage.userId, p.userId), eq(quotaUsage.skill, skill), eq(quotaUsage.unitKey, unitKey))).limit(1);
    if (row && !row.refundedAt) return;
    const q = await evaluate(tx, p, skill, ipHash, { balance, hourly: await hourlyCount(tx) });
    if (q.blocked) throw blockedError(p, skill, q);
    // A refunded unit (failed analysis, retried now) is charged again from now on.
    if (row) await tx.update(quotaUsage).set({ refundedAt: null, createdAt: new Date(), tier: p.tier, ipHash }).where(eq(quotaUsage.id, row.id));
    else await tx.insert(quotaUsage).values({ userId: p.userId, skill, unitKey, tier: p.tier, ipHash, createdAt: new Date() });
  });
}

type AttemptRef = { id: string; userId: string; skill: Skill; part: number; sessionId: string | null };

/** The unit one attempt is paid under: its session (all parts of a full test count once), unless that part was already submitted in the session (then it is its own test, so a reused sessionId cannot bundle unlimited tests). */
export async function unitFor(a: AttemptRef): Promise<string> {
  if (!a.sessionId) return a.id;
  const [dup] = await db.select({ id: attempts.id }).from(attempts).where(and(eq(attempts.userId, a.userId), eq(attempts.sessionId, a.sessionId), eq(attempts.part, a.part), ne(attempts.id, a.id), or(eq(attempts.status, 'analyzing'), eq(attempts.status, 'done')))).limit(1);
  return dup ? a.id : a.sessionId;
}

export async function reserveAttempt(p: Payer, a: AttemptRef, ipHash: string | null) {
  if (p.tier !== 'own-key') await reserve(p, a.skill, await unitFor(a), ipHash);
}
export async function checkAttempt(p: Payer, a: AttemptRef, ipHash: string | null) {
  if (p.tier !== 'own-key') await checkStart(p, a.skill, ipHash, await unitFor(a));
}

/** Gives the test back (analysis failed, or no speech was heard). For a session the unit is refunded only when no other part of it is still counting. Never throws. */
export async function refundAttempt(a: AttemptRef) {
  try {
    const now = new Date();
    const free = (unitKey: string) => db.update(quotaUsage).set({ refundedAt: now }).where(and(eq(quotaUsage.userId, a.userId), eq(quotaUsage.skill, a.skill), eq(quotaUsage.unitKey, unitKey), isNull(quotaUsage.refundedAt))).returning({ id: quotaUsage.id });
    if ((await free(a.id)).length || !a.sessionId) return; // the attempt was its own unit
    const [sibling] = await db
      .select({ id: attempts.id })
      .from(attempts)
      .leftJoin(analyses, eq(analyses.attemptId, attempts.id))
      .where(and(eq(attempts.userId, a.userId), eq(attempts.sessionId, a.sessionId), ne(attempts.id, a.id), or(eq(attempts.status, 'analyzing'), and(eq(attempts.status, 'done'), sql`coalesce(${analyses.result}->>'noSpeech', 'false') <> 'true'`))))
      .limit(1);
    if (!sibling) await free(a.sessionId);
  } catch (e) {
    console.error('quota refund failed', a.id, (e as Error).message);
  }
}

/** Loads the caller's payer once (c.get('payer')) and runs the rest of the request with their own OpenRouter key, so turn-based live (STT, LLM, TTS) is paid by them. Use after requireUser. */
export const withPayer = createMiddleware<AppEnv>(async (c, next) => {
  const u = c.get('user');
  if (!u) throw new HTTPException(401, { message: 'Sign in required' });
  const payer = await payerOf(u);
  c.set('payer', payer);
  await keyCtx.run({ openrouter: payer.keys.openrouter, onAuthFail: () => void markKeyInvalid(u.id, 'openrouter') }, next);
});

/** Live examiner is never paid from the community balance: turn-based needs the user's own OpenRouter key, GPT-Live an OpenAI key, Gemini Live a Gemini key
 *  ('duplex' = either of the last two, for starting a session before the client picks). The owner may use the server's keys. */
export function requireLive(p: Payer, provider: LiveProvider | 'duplex') {
  const have = liveProviders(p);
  if (provider === 'duplex' ? have.includes('gpt-live') || have.includes('gemini-live') : have.includes(provider)) return;
  const need = provider === 'turn' ? 'your own OpenRouter key' : provider === 'gpt-live' ? 'your own OpenAI key' : provider === 'gemini-live' ? 'your own Gemini key' : 'your own OpenAI or Gemini key';
  throw new ApiError(403, {
    error: p.tier === 'guest' ? `The live examiner needs an account and ${need}.` : `The live examiner runs on ${need}. Add it in Settings.`,
    code: 'live_requires_own_key',
    tier: p.tier,
  });
}
