// OpenRouter + ElevenLabs spend (docs/admin/DESIGN.md section 3.2). Only numbers leave this module: no key, no upstream message.
import { httpFetch } from '../ai/openrouter';
import { communityBalance } from '../community';
import { env } from '../env';
import type { Costs } from './schemas';

const TTL_MS = 5 * 60_000;

/** 5-min cache + in-flight dedupe; a failed refresh serves the last good value (null if there never was one). */
function cached<T>(load: () => Promise<T>) {
  let hit: { at: number; value: T | null } | undefined;
  let inflight: Promise<T | null> | undefined;
  const get = () => {
    if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.value);
    inflight ??= load()
      .then((value) => ((hit = { at: Date.now(), value }), value))
      .catch((e) => {
        console.error('cost lookup failed:', (e as Error).message);
        hit = { at: Date.now(), value: hit?.value ?? null }; // retry after the TTL, not on every page view
        return hit.value;
      })
      .finally(() => (inflight = undefined));
    return inflight;
  };
  return Object.assign(get, { clear: () => ((hit = undefined), (inflight = undefined)) });
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const openrouter = cached(async () => {
  const res = await httpFetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` }, signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`openrouter key ${res.status}`);
  const d = ((await res.json()) as { data?: Record<string, unknown> }).data ?? {};
  const limit = num(d.limit);
  const usage = num(d.usage);
  return { limit, usage, remaining: num(d.limit_remaining) ?? (limit != null && usage != null ? Math.max(0, limit - usage) : null), usageDaily: num(d.usage_daily), usageWeekly: num(d.usage_weekly), usageMonthly: num(d.usage_monthly) };
});

const elevenlabs = cached(async () => {
  if (!env.ELEVENLABS_API_KEY) return null;
  const res = await httpFetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': env.ELEVENLABS_API_KEY }, signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`elevenlabs subscription ${res.status}`);
  const d = (await res.json()) as Record<string, unknown>;
  const characterCount = num(d.character_count);
  const characterLimit = num(d.character_limit);
  const reset = num(d.next_character_count_reset_unix);
  return { tier: typeof d.tier === 'string' ? d.tier : null, characterCount, characterLimit, remaining: characterCount != null && characterLimit != null ? Math.max(0, characterLimit - characterCount) : null, resetsAt: reset != null ? new Date(reset * 1000).toISOString() : null };
});

export const clearCostsCache = () => (openrouter.clear(), elevenlabs.clear());

const usd = (n: number) => `$${n.toFixed(2)}`;

export async function getCosts(): Promise<Costs> {
  const [or, el, community] = await Promise.all([openrouter(), elevenlabs(), communityBalance()]);
  const min = env.COMMUNITY_MIN_BALANCE;
  const orOut = { available: !!or, limit: or?.limit ?? null, usage: or?.usage ?? null, remaining: or?.remaining ?? null, usageDaily: or?.usageDaily ?? null, usageWeekly: or?.usageWeekly ?? null, usageMonthly: or?.usageMonthly ?? null, warn: 'ok' as Costs['openrouter']['warn'] };
  if (orOut.remaining != null) orOut.warn = orOut.remaining < min ? 'critical' : orOut.remaining < 4 * min ? 'low' : 'ok';
  const elOut = { available: !!el, tier: el?.tier ?? null, characterCount: el?.characterCount ?? null, characterLimit: el?.characterLimit ?? null, remaining: el?.remaining ?? null, resetsAt: el?.resetsAt ?? null, warn: 'ok' as Costs['elevenlabs']['warn'] };
  if (elOut.remaining != null && elOut.characterLimit) {
    const left = elOut.remaining / elOut.characterLimit;
    elOut.warn = left < 0.05 ? 'critical' : left < 0.2 ? 'low' : 'ok';
  }
  const warnings: string[] = [];
  if (orOut.warn !== 'ok') warnings.push(`OpenRouter has ${usd(orOut.remaining!)} left (community tests stop at ${usd(min)})`);
  if (elOut.warn !== 'ok') warnings.push(`ElevenLabs has ${elOut.remaining!.toLocaleString('en-US')} characters left of ${elOut.characterLimit!.toLocaleString('en-US')}`);
  return { openrouter: orOut, elevenlabs: elOut, community, minBalance: min, warnings, cachedAt: new Date().toISOString() };
}
