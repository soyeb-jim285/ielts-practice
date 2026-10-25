// Plans and limits (docs/community.md): the quota query, the error codes the server answers with, and the copy that goes with them.
import { queryOptions, useQuery } from '@tanstack/react-query';
import { ApiError, call, client, type Schemas } from './api';

export type Quota = Schemas['Quota'];
export type SkillQuota = Schemas['SkillQuota'];
export type Tier = Quota['tier'];
/** examiner = live examiner sessions, speaking = recorded practice. */
export type Skill = 'speaking' | 'writing' | 'examiner';

/** What the person may start now, per skill. Without a session the server answers for a guest, so it is safe before the first sign-in. */
export const quotaQuery = queryOptions({ queryKey: ['quota'], queryFn: () => call(client.GET('/api/quota')), staleTime: 20_000 });

export const useQuota = () => useQuery(quotaQuery);

// ---- Reset windows ----

const DAY = 86_400_000;

/** "in 5 h", "in 40 min", or "Monday 6:00" (local time). Same rounding and wording as the iOS and Android apps. */
export function resetPhrase(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'soon';
  const at = new Date(iso);
  const ms = at.getTime() - now;
  if (ms <= 60_000) return 'in a moment';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `in ${minutes} min`;
  if (ms < DAY) return `in ${Math.max(1, Math.round(minutes / 60))} h`;
  const day = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(at);
  return `${day} ${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}`; // 24-hour H:mm like the apps ("Monday 6:00")
}

/** "Resets in 5 h" / "Resets Monday 6:00". */
export const resetLabel = (iso: string | null | undefined, now?: number) => `Resets ${resetPhrase(iso, now)}`;

// ---- Quota copy ----

/** Windows are rolling (last 24 h / 7 / 30 days); "this week" reads better and resetAt says when exactly. */
export const windowWord = (s: Pick<SkillQuota, 'window'>) => (s.window === 'month' ? 'this month' : s.window === 'week' ? 'this week' : 'today');
/** "writing test", "live session": one of what a skill counts. */
export const UNIT: Record<Skill, string> = { speaking: 'speaking test', writing: 'writing test', examiner: 'live session' };

/** The line next to a Start button: "1 test left today", "No tests left. Resets Monday 6:00", "Unlimited". `warn` when there is none left. */
export function quotaText(s: SkillQuota, now?: number): { text: string; warn: boolean } {
  if (s.limit == null) return { text: 'Unlimited', warn: false };
  const left = s.remaining ?? 0;
  if (left > 0) return { text: `${left} ${left === 1 ? 'test' : 'tests'} left ${windowWord(s)}`, warn: false };
  return { text: `No tests left. ${resetLabel(s.resetAt, now)}`, warn: true };
}

// ---- Blockers: why a test cannot start (or finish), and the way out ----

export type BlockCode = 'quota_exceeded' | 'community_balance_exhausted' | 'community_busy' | 'too_many_requests';
export type Blocker = { code: BlockCode; skill?: Skill; resetAt?: string | null; tier?: Tier };

const BLOCK_CODES: readonly string[] = ['quota_exceeded', 'community_balance_exhausted', 'community_busy', 'too_many_requests'];

/** The blocker behind a failed request, or null when the error is something else (network, 500, validation). */
export function blockerOf(e: unknown): Blocker | null {
  if (!(e instanceof ApiError) || !e.code || !BLOCK_CODES.includes(e.code)) return null;
  const b = e.body ?? {};
  return { code: e.code as BlockCode, skill: b.skill as Skill | undefined, resetAt: b.resetAt as string | undefined, tier: b.tier as Tier | undefined };
}

/** Why `/api/quota` says this skill cannot start, or null when it can. */
export function blockerFromQuota(q: Quota, skill: Skill): Blocker | null {
  const s = q[skill];
  return s.blocked ? { code: s.blocked, skill, resetAt: s.resetAt, tier: q.tier } : null;
}

/** A guest's session, or a visitor with none yet: they get "Create an account". */
export const isGuestTier = (tier: Tier | undefined) => tier === 'guest';

export type Copy = { title: string; body: string };

/** One sentence each, shared word for word with the iOS and Android apps. */
export function blockerCopy(b: Blocker, now?: number): Copy {
  const guest = isGuestTier(b.tier);
  switch (b.code) {
    case 'quota_exceeded':
      return { title: `You've used all your ${UNIT[b.skill ?? 'writing']}s for now`, body: `Your next one frees up ${resetPhrase(b.resetAt, now)}.${guest ? ' Create a free account for more.' : ''}` };
    case 'community_balance_exhausted':
      return { title: 'Scoring is paused for now', body: 'Scoring is paused for a short while. Please try again later.' };
    case 'community_busy':
      return { title: 'A lot of people are practising right now', body: 'Try again in a few minutes.' };
    case 'too_many_requests':
      return { title: "You're going a bit fast", body: 'Try again in a moment.' };
  }
}

// ---- Fair-use acknowledgement: once per person per UTC day (a guest: once per device) ----

const ackKey = (userId: string | null) => `ielts.fairUse.${userId ?? 'guest'}`;
const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export function fairUseAcknowledged(userId: string | null): boolean {
  try {
    return localStorage.getItem(ackKey(userId)) === utcDay();
  } catch {
    return false;
  }
}

export function acknowledgeFairUse(userId: string | null) {
  try {
    localStorage.setItem(ackKey(userId), utcDay());
  } catch {}
}

