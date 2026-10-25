import { AsyncLocalStorage } from 'node:async_hooks';

/** Who a paid call belongs to (ai/cost.ts recordCost reads it). `retry` marks everything run inside asRetry(). */
export type CostCtx = { userId?: string; attemptId?: string; sessionId?: string; promptId?: string; skill?: 'speaking' | 'writing' | 'listening' | 'reading'; part?: number; retry?: boolean };
export type KeyCtx = {
  cost?: CostCtx;
  /** Sums every recordCost in this context (a request that reports its own cost). */
  tally?: { usd: number };
};
export const keyCtx = new AsyncLocalStorage<KeyCtx>();

/** Replaces every secret in `text` (upstream error bodies, messages) so keys never reach a log or a response. */
export function redact(text: string, ...secrets: (string | undefined)[]) {
  let out = text;
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join('[redacted]');
  return out;
}
