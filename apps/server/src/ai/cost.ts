// Cost ledger writer (docs/admin/COSTS-AND-UI.md section 4). Every paid call leaves one `ai_costs` row; who/what it belongs to comes from keyCtx.cost.
import { db } from '../db/client';
import { aiCosts } from '../db/schema';
import { env } from '../env';
import { keyCtx } from './keyctx';

export type CostRow = {
  stage: string;
  provider: 'openrouter' | 'elevenlabs' | 'openai' | 'gemini';
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
  /** Outside a request (GPT-Live websocket events) there is no keyCtx: pass the owner explicitly. */
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
export const scribeUsd = (seconds: number) => (seconds / 3600) * env.ELEVENLABS_SCRIBE_USD_PER_HOUR;
/** GPT-Live is billed per second: $0.05/min (env.ts). */
export const gptLiveUsd = (seconds: number) => (seconds / 60) * 0.05;

/** USD actually charged from an OpenRouter `usage` block: `cost` plus, on a BYOK key only, the upstream provider cost OpenRouter reports separately (on the house key it is already inside `cost`). */
export function usageCost(u: unknown): { costUsd: number; inputTokens?: number; outputTokens?: number; exact: boolean } {
  const x = (u ?? {}) as { cost?: unknown; prompt_tokens?: unknown; completion_tokens?: unknown; cost_details?: { upstream_inference_cost?: unknown } };
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const cost = n(x.cost);
  return { costUsd: (cost ?? 0) + (keyCtx.getStore()?.openrouter ? (n(x.cost_details?.upstream_inference_cost) ?? 0) : 0), inputTokens: n(x.prompt_tokens), outputTokens: n(x.completion_tokens), exact: cost !== undefined };
}
