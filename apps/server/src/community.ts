// The shared OpenRouter balance (the owner's key, with a spend limit): GET /api/v1/key → data.limit, data.usage, data.limit_remaining (USD).
import { httpFetch } from './ai/openrouter';
import { env } from './env';

export type Balance = { limit: number | null; used: number | null; remaining: number | null; updatedAt: string };
const TTL_MS = 60_000;
let cache: { at: number; value: Balance } | undefined;
let inflight: Promise<Balance> | undefined;
export const clearBalanceCache = () => ((cache = undefined), (inflight = undefined));

async function load(): Promise<Balance> {
  const res = await httpFetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` }, signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`openrouter key ${res.status}`);
  const d = ((await res.json()) as { data?: { limit?: number | null; usage?: number; limit_remaining?: number | null } }).data ?? {};
  const limit = d.limit ?? null;
  const used = d.usage ?? null;
  // No spend limit on the key: nothing to show or enforce (remaining null = unlimited).
  const remaining = d.limit_remaining ?? (limit != null && used != null ? Math.max(0, limit - used) : null);
  return { limit, used, remaining, updatedAt: new Date().toISOString() };
}

/** Cached for 60 s. If OpenRouter cannot be reached, the last known value is served; with none, all fields are null and nothing is blocked
 *  (OpenRouter itself stops the key at its limit, and the analysis then fails with a "try later" message). */
export async function communityBalance(): Promise<Balance> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  inflight ??= load()
    .then((value) => ((cache = { at: Date.now(), value }), value))
    .catch((e) => {
      console.error('community balance unavailable:', (e as Error).message);
      const value = cache?.value ?? { limit: null, used: null, remaining: null, updatedAt: new Date().toISOString() };
      cache = { at: Date.now(), value }; // retry in a minute, not on every request
      return value;
    })
    .finally(() => (inflight = undefined));
  return inflight;
}

export const balanceExhausted = (b: Balance) => b.remaining != null && b.remaining < env.COMMUNITY_MIN_BALANCE;
