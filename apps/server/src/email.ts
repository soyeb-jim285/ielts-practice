import { Resend } from 'resend';
import { env } from './env';

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export type SendResult = { ok: true; id: string | null; attempts: number } | { ok: false; kind: ErrorKind; attempts: number };
/** Short, user-safe reason; the raw provider message is only ever logged to the console. */
export type ErrorKind = 'rate_limited' | 'rejected' | 'network' | 'unavailable';

// Waits before attempt 2 and 3 (~5 s in all). Exported so tests can shrink them.
export const retryDelaysMs = [1_000, 4_000];

function kindOf(e: { statusCode?: number | null; name?: string } | null): ErrorKind {
  if (e?.statusCode === 429 || e?.name === 'rate_limit_exceeded') return 'rate_limited';
  if (e?.statusCode && e.statusCode >= 500) return 'unavailable';
  if (e?.statusCode && e.statusCode >= 400) return 'rejected'; // bad key, unverified domain, invalid address: retrying cannot help
  return 'network';
}

/** Sends one email, retrying Resend errors and thrown network errors with backoff (not 4xx other than 429). Never throws. */
export async function sendEmail(o: Outgoing): Promise<SendResult> {
  if (!resend) {
    console.log(`[email:dev] to=${o.to} subject="${o.subject}"\n${o.html}`);
    return { ok: true, id: null, attempts: 1 };
  }
  let kind: ErrorKind = 'network';
  for (let attempt = 1; attempt <= retryDelaysMs.length + 1; attempt++) {
    try {
      const { data, error } = await resend.emails.send({ from: env.EMAIL_FROM, ...o });
      if (!error) return { ok: true, id: data?.id ?? null, attempts: attempt };
      kind = kindOf(error);
      console.error('[email] send failed', { attempt, kind, status: error.statusCode, name: error.name });
    } catch (e) {
      kind = 'network';
      console.error('[email] send threw', { attempt, error: e instanceof Error ? e.name : 'unknown' });
    }
    if (kind === 'rejected' || attempt > retryDelaysMs.length) return { ok: false, kind, attempts: attempt };
    await new Promise((r) => setTimeout(r, retryDelaysMs[attempt - 1]));
  }
  return { ok: false, kind, attempts: retryDelaysMs.length + 1 };
}

export type Outgoing = { to: string; subject: string; html: string; text?: string; headers?: Record<string, string> };

/** Up to 100 emails in one Resend call (campaigns), with the same retries as sendEmail. `key` makes a retried chunk send at most once (idempotency). */
export async function sendBatch(items: Outgoing[], key: string): Promise<{ ok: boolean; kind?: ErrorKind }> {
  if (!resend) {
    console.log(`[email:dev] batch ${key}: ${items.length} emails, first to=${items[0]?.to} subject="${items[0]?.subject}"`);
    return { ok: true };
  }
  let kind: ErrorKind = 'network';
  for (let attempt = 1; attempt <= retryDelaysMs.length + 1; attempt++) {
    try {
      const { error } = await resend.batch.send(items.map((o) => ({ from: env.EMAIL_FROM, ...o })), { idempotencyKey: key });
      if (!error) return { ok: true };
      kind = kindOf(error);
      console.error('[email] batch failed', { key, attempt, kind, status: error.statusCode, name: error.name });
    } catch (e) {
      kind = 'network';
      console.error('[email] batch threw', { key, attempt, error: e instanceof Error ? e.name : 'unknown' });
    }
    if (kind === 'rejected') break;
    if (attempt <= retryDelaysMs.length) await new Promise((r) => setTimeout(r, retryDelaysMs[attempt - 1]));
  }
  return { ok: false, kind };
}
