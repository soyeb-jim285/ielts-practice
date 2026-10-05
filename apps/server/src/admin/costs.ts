// OpenRouter + ElevenLabs spend (docs/admin/DESIGN.md section 3.2). Only numbers leave this module: no key, no upstream message.
import { httpFetch } from '../ai/openrouter';
import { communityBalance } from '../community';
import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { env } from '../env';
import { daysAgo, dhakaTodayStart } from './common';
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

/** House OpenRouter spend per day (USD), mean over the last 7 / 14 full Dhaka days, counting only the full days the ledger covers (it is new: a fixed divisor would understate the burn); null when fewer than one full day is covered or nothing was spent. */
export async function houseBurn(): Promise<{ p7: number | null; p14: number | null }> {
  const win = (n: number) => sql`greatest(${daysAgo(n)}, (select first_full from b))`;
  const col = (n: number) => sql`(select coalesce(sum(cost_usd), 0) from ai_costs where provider = 'openrouter' and paid_by = 'house' and created_at >= ${win(n)} and created_at < ${dhakaTodayStart}) as ${sql.raw(`s${n}`)},
    round(extract(epoch from ${dhakaTodayStart} - ${win(n)}) / 86400) as ${sql.raw(`d${n}`)}`;
  const [r] = [...(await db.execute(sql`with b as (select (date_trunc('day', (min(created_at) at time zone 'Asia/Dhaka') - interval '1 microsecond') + interval '1 day') at time zone 'Asia/Dhaka' as first_full from ai_costs where provider = 'openrouter' and paid_by = 'house')
    select ${col(7)}, ${col(14)}`))] as { s7: string; d7: string; s14: string; d14: string }[];
  const mean = (s: string, d: string) => (Number(d) >= 1 && Number(s) > 0 ? Number(s) / Number(d) : null);
  return { p7: mean(r!.s7, r!.d7), p14: mean(r!.s14, r!.d14) };
}

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
  const burn = orOut.remaining != null ? (await houseBurn().catch(() => ({ p7: null }))).p7 : null;
  if (burn && orOut.remaining! / burn < 7) warnings.push(`OpenRouter runs out in about ${Math.max(1, Math.round(orOut.remaining! / burn))} days at ${usd(burn)}/day`);
  if (orOut.warn !== 'ok') warnings.push(`OpenRouter has ${usd(orOut.remaining!)} left (community tests stop at ${usd(min)})`);
  if (elOut.warn !== 'ok') warnings.push(`ElevenLabs has ${elOut.remaining!.toLocaleString('en-US')} characters left of ${elOut.characterLimit!.toLocaleString('en-US')}`);
  return { openrouter: orOut, elevenlabs: elOut, community, minBalance: min, warnings, cachedAt: new Date().toISOString() };
}
