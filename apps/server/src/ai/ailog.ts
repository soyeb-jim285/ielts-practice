// AI call log (admin → AI logs): every OpenRouter call's request and response, kept AI_LOG_DAYS days. Fire-and-forget like the cost ledger:
// a log failure never fails the call. Base64 payloads (audio in STT requests) are replaced by a size note so rows stay small.
import { lt, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { aiLogs } from '../db/schema';
import { keyCtx } from './keyctx';

export const AI_LOG_DAYS = 14;
const LONG = 4000; // this many base64 characters with no space is a binary payload: text always has spaces
const MAX_STRING = 200_000; // text longer than this is cut (a runaway model output)

/** Deep copy with base64 blobs replaced by "[base64, N KB]" and very long strings cut. */
export function sanitize(v: unknown): unknown {
  if (typeof v === 'string') {
    if (v.length > LONG && /^[A-Za-z0-9+/=]+$/.test(v.slice(0, LONG))) return `[base64, ${Math.round((v.length * 3) / 4 / 1024)} KB]`;
    return v.length > MAX_STRING ? `${v.slice(0, MAX_STRING)}… [cut, ${v.length} chars]` : v;
  }
  if (Array.isArray(v)) return v.map(sanitize);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sanitize(x)]));
  return v;
}

export type AiLogRow = { stage: string; path: string; model?: string; served?: string; ok: boolean; status?: number; latencyMs: number; costUsd?: number | null; request?: unknown; response?: unknown; error?: string };

const pending = new Set<Promise<unknown>>();
/** Waits for queued log writes (tests). */
export const flushAiLogs = () => Promise.all([...pending]);

/** Never throws, never awaited on the hot path. Who the call belongs to comes from keyCtx.cost, as for the cost ledger. */
export function logAi(row: AiLogRow): void {
  try {
    const c = keyCtx.getStore()?.cost;
    const p = Promise.resolve(
      db.insert(aiLogs).values({
        ...row,
        request: sanitize(row.request) ?? null,
        response: sanitize(row.response) ?? null,
        error: row.error?.slice(0, 2000),
        latencyMs: Math.round(row.latencyMs),
        userId: c?.userId,
        attemptId: c?.attemptId,
        sessionId: c?.sessionId,
      }),
    ).catch((e: Error) => console.error('logAi failed:', e.message));
    pending.add(p);
    void p.finally(() => pending.delete(p));
  } catch (e) {
    console.error('logAi failed:', (e as Error).message);
  }
}

export const purgeAiLogs = () => db.delete(aiLogs).where(lt(aiLogs.createdAt, sql`now() - ${AI_LOG_DAYS} * interval '1 day'`));
