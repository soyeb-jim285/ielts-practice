// Community mode (docs/community.md): quota and balance queries, the error codes the server answers with, and the copy that goes with them.
import { queryOptions, useQuery } from '@tanstack/react-query';
import { ApiError, call, client, type Schemas } from './api';

export type Quota = Schemas['Quota'];
export type SkillQuota = Schemas['SkillQuota'];
export type Balance = Schemas['CommunityBalance'];
export type Tier = Quota['tier'];
export type Skill = 'speaking' | 'writing';
export type Provider = 'openrouter' | 'openai' | 'gemini';

/** What the person may start now, per skill. Without a session the server answers for a guest, so it is safe before the first sign-in. */
export const quotaQuery = queryOptions({ queryKey: ['quota'], queryFn: () => call(client.GET('/api/quota')), staleTime: 20_000 });
/** Public; the server caches it for 60 s, so the client asks at most once a minute too. */
export const balanceQuery = queryOptions({ queryKey: ['balance'], queryFn: () => call(client.GET('/api/community/balance')), staleTime: 60_000 });

export const useQuota = () => useQuery(quotaQuery);
export const useBalance = () => useQuery(balanceQuery);

// ---- Reset windows ----

const DAY = 86_400_000;

/** "in 5 h", "in 40 min", or "Monday 6:00" (local time). */
export function resetPhrase(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'soon';
  const at = new Date(iso);
  const ms = at.getTime() - now;
  if (ms < 60_000) return 'in a moment';
  if (ms < 3_600_000) return `in ${Math.round(ms / 60_000)} min`;
  if (ms < DAY) return `in ${Math.round(ms / 3_600_000)} h`;
  const day = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(at);
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(at);
  return `${day} ${time}`;
}

/** "Resets in 5 h" / "Resets Monday 6:00". */
export const resetLabel = (iso: string | null | undefined, now?: number) => `Resets ${resetPhrase(iso, now)}`;

// ---- Quota copy ----

const windowWord = (s: SkillQuota) => (s.window === 'week' ? 'this week' : 'today');

/** The line next to a Start button: "1 test left today", "No tests left. Resets Monday 6:00", "Unlimited with your key". `warn` when there is none left. */
export function quotaText(s: SkillQuota, tier: Tier, now?: number): { text: string; warn: boolean } {
  if (s.limit == null) return { text: tier === 'own-key' ? 'Unlimited with your key' : 'Unlimited', warn: false };
  const left = s.remaining ?? 0;
  if (left > 0) return { text: `${left} ${left === 1 ? 'test' : 'tests'} left ${windowWord(s)}`, warn: false };
  return { text: `No tests left. ${resetLabel(s.resetAt, now)}`, warn: true };
}

/** "$12.40" below $100, whole dollars above. */
export const usd = (n: number) => `$${n < 100 ? n.toFixed(2) : Math.round(n)}`;
/** The limit as a round figure when it is one: "$20". */
export const usdLimit = (n: number) => (Number.isInteger(n) ? `$${n}` : usd(n));

// ---- Blockers: why a test cannot start (or finish), and the way out ----

export type BlockCode = 'quota_exceeded' | 'community_balance_exhausted' | 'community_busy' | 'too_many_requests' | 'live_requires_own_key';
export type Blocker = { code: BlockCode; skill?: Skill; resetAt?: string | null; tier?: Tier; provider?: Provider };

const BLOCK_CODES: readonly string[] = ['quota_exceeded', 'community_balance_exhausted', 'community_busy', 'too_many_requests', 'live_requires_own_key'];

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

/** A guest's session, or a visitor with none yet: they get "Create an account", not "Add your own key". */
export const isGuestTier = (tier: Tier | undefined) => tier === 'guest';

export type Copy = { title: string; body: string };

/** One sentence each, shared word for word with the iOS and Android apps. */
export function blockerCopy(b: Blocker, now?: number): Copy {
  const guest = isGuestTier(b.tier);
  switch (b.code) {
    case 'quota_exceeded':
      return guest
        ? { title: "You've used this week's free test", body: `It resets ${resetPhrase(b.resetAt, now)}.` }
        : { title: "You've used today's free test", body: `It resets ${resetPhrase(b.resetAt, now)}.` };
    case 'community_balance_exhausted':
      return { title: 'The community balance is used up for now', body: 'Free tests are paid from one shared balance, and it has run out. Add your own OpenRouter key to keep practising, or try again later.' };
    case 'community_busy':
      return { title: 'A lot of people are practising right now', body: 'Try again in a few minutes.' };
    case 'too_many_requests':
      return { title: "You're going a bit fast", body: 'Try again in a moment.' };
    case 'live_requires_own_key':
      return { title: 'The live examiner runs on your own key', body: guest ? 'Create an account, then add an OpenAI or Gemini key in Settings.' : 'Add an OpenAI key for GPT-Live or a Gemini key for Gemini Live in Settings.' };
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

// ---- Your API keys ----

export const PROVIDERS: Record<Provider, { name: string; unlocks: string; help: string; url: string; placeholder: string }> = {
  openrouter: { name: 'OpenRouter', unlocks: 'Unlimited tests', help: 'Your tests are paid from your OpenRouter credit instead of the community balance.', url: 'https://openrouter.ai/keys', placeholder: 'sk-or-v1-…' },
  openai: { name: 'OpenAI', unlocks: 'GPT-Live examiner', help: 'Runs the GPT-Live conversation with your OpenAI account.', url: 'https://platform.openai.com/api-keys', placeholder: 'sk-…' },
  gemini: { name: 'Gemini', unlocks: 'Gemini Live examiner', help: 'Runs the Gemini Live conversation with your Google AI Studio key.', url: 'https://aistudio.google.com/apikey', placeholder: 'AIza…' },
};
