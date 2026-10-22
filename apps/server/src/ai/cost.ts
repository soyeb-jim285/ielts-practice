// Cost ledger writer (docs/admin/COSTS-AND-UI.md section 4). Every paid call leaves one `ai_costs` row; who/what it belongs to comes from keyCtx.cost.
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { aiCosts } from '../db/schema';
import { env } from '../env';
import { keyCtx } from './keyctx';
import { httpFetch } from './openrouter';

export type CostRow = {
  stage: string;
  provider: 'openrouter' | 'elevenlabs' | 'openai' | 'gemini' | 'soniox' | 'modal';
  model: string;
  costUsd: number;
  ok?: boolean;
  retry?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  audioSeconds?: number;
  characters?: number;
  credits?: number;
  meta?: Record<string, unknown>;
  /** Outside a request there is no keyCtx: pass the owner explicitly. */
  userId?: string;
  sessionId?: string;
  paidBy?: 'house' | 'own_key';
};

const pending = new Set<Promise<unknown>>();
/** Resolves once every recordCost write so far has settled (tests, graceful shutdown). */
export const flushCosts = () => Promise.allSettled([...pending]).then(() => undefined);

/** Never throws, never awaited on the hot path: a ledger failure must not fail a test. */
export function recordCost(row: CostRow): void {
  try {
    const ctx = keyCtx.getStore();
    const c = ctx?.cost;
    const { userId, sessionId, paidBy, ...rest } = row;
    if (ctx?.tally && Number.isFinite(row.costUsd)) ctx.tally.usd += row.costUsd;
    const p = Promise.resolve(
      db.insert(aiCosts).values({
        ...rest,
        costUsd: Number.isFinite(row.costUsd) ? row.costUsd : 0,
        retry: row.retry ?? c?.retry ?? false,
        userId: userId ?? c?.userId,
        attemptId: c?.attemptId,
        sessionId: sessionId ?? c?.sessionId,
        promptId: c?.promptId,
        skill: c?.skill,
        part: c?.part,
        paidBy: paidBy ?? (ctx?.openrouter ? 'own_key' : 'house'),
      }),
    ).catch((e: Error) => console.error('recordCost failed:', e.message));
    pending.add(p);
    void p.finally(() => pending.delete(p));
  } catch (e) {
    console.error('recordCost failed:', (e as Error).message);
  }
}

/** Runs `f` with every call inside marked as a retry (the second try of a failed generation is a real extra charge). */
export function asRetry<T>(f: () => Promise<T>): Promise<T> {
  const ctx = keyCtx.getStore();
  return keyCtx.run({ ...ctx, cost: { ...ctx?.cost, retry: true } }, f);
}

// Prices for calls whose response carries no cost (docs section 2). Rows built from them are flagged meta.estimated.
const WHISPER_USD_PER_HOUR = 0.11;
export const whisperUsd = (seconds: number) => (seconds / 3600) * WHISPER_USD_PER_HOUR;

/** USD actually charged from an OpenRouter `usage` block: `cost` plus, on a BYOK call (`is_byok`, e.g. the house Anthropic key), the upstream provider cost OpenRouter
 *  reports separately (`cost` is then only OpenRouter's fee, often 0; otherwise the upstream cost is already inside `cost`). */
export function usageCost(u: unknown): { costUsd: number; inputTokens?: number; outputTokens?: number; exact: boolean } {
  const x = (u ?? {}) as { cost?: unknown; is_byok?: unknown; prompt_tokens?: unknown; completion_tokens?: unknown; cost_details?: { upstream_inference_cost?: unknown } };
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const cost = n(x.cost);
  return { costUsd: (cost ?? 0) + ((x.is_byok ?? keyCtx.getStore()?.openrouter) ? (n(x.cost_details?.upstream_inference_cost) ?? 0) : 0), inputTokens: n(x.prompt_tokens), outputTokens: n(x.completion_tokens), exact: cost !== undefined };
}

/** Replaces estimated OpenRouter costs with what OpenRouter actually charged. The live examiner's LLM rows are priced from the catalogue, but OpenRouter
 *  routes to providers at different prices; /generation has the real figure a minute or two later. House-key rows only (a user's key is needed to look
 *  up their own generations). Runs from the periodic sweep; a row it cannot settle is retried until it is two days old. */
export async function reconcileCosts(limit = 500): Promise<number> {
  if (!env.OPENROUTER_API_KEY) return 0;
  const gen = sql<string>`coalesce(${aiCosts.meta}->>'generationId', ${aiCosts.meta}->>'requestId')`;
  const due = await db
    .select({ id: aiCosts.id, costUsd: aiCosts.costUsd, meta: aiCosts.meta, gen })
    .from(aiCosts)
    .where(and(eq(aiCosts.provider, 'openrouter'), eq(aiCosts.paidBy, 'house'), sql`${aiCosts.meta}->>'estimated' = 'true'`, sql`${gen} like 'gen-%'`,
      lt(aiCosts.createdAt, new Date(Date.now() - 120_000)), gt(aiCosts.createdAt, new Date(Date.now() - 2 * 86_400_000))))
    .limit(limit);
  let n = 0;
  const settle = async (r: (typeof due)[number]) => {
    const res = await httpFetch(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(r.gen)}`, { headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
    const total = res?.ok ? ((await res.json()) as { data?: { total_cost?: unknown } }).data?.total_cost : undefined;
    if (typeof total !== 'number' || !Number.isFinite(total)) return; // not ready yet: next sweep
    await db.update(aiCosts).set({ costUsd: total, meta: { ...r.meta, estimated: false, reconciled: true, estimatedUsd: r.costUsd } }).where(eq(aiCosts.id, r.id));
    n++;
  };
  for (let i = 0; i < due.length; i += 10) await Promise.all(due.slice(i, i + 10).map(settle));
  return n;
}
