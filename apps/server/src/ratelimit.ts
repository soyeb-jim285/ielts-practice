import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from './auth';
import { clientIpHash } from './ip';
import type { AppEnv } from './types';

// A full live test makes ~25 paid calls in ~14 min (bursty in Part 1), so 20 tokens + 1 per 20 s never blocks a real session.
const CAPACITY = 20;
const REFILL_MS = 20_000;
// ponytail: per-process memory; move to Postgres/Redis if the server ever runs more than one instance.
type Buckets = Map<string, { t: number; at: number }>;
const buckets: Buckets = new Map();
const ipBuckets: Buckets = new Map();

/** Takes one token from `key`'s bucket; false when it is empty. */
function take(map: Buckets, key: string, capacity: number, refillMs: number) {
  const now = Date.now();
  const b = map.get(key);
  const t = b ? Math.min(capacity, b.t + (now - b.at) / refillMs) : capacity;
  if (t < 1) return false;
  if (map.size > 20_000) for (const k of [...map.keys()].slice(0, 2_000)) map.delete(k); // oldest first (insertion order); clearing all would reset every bucket
  map.delete(key); // re-insert so an active key counts as newest
  map.set(key, { t: t - 1, at: now });
  return true;
}

/** Per-user token bucket for routes that spend AI credit (STT/LLM/TTS/live sessions). Use after requireUser. */
export const aiLimit = createMiddleware<AppEnv>(async (c, next) => {
  if (!take(buckets, currentUser(c).id, CAPACITY, REFILL_MS)) throw new HTTPException(429, { message: 'Too many requests, slow down' });
  await next();
});

/** Per-client burst limit on creating/submitting attempts (guests and community users; quota.ts). Generous for one person (a full test is ~6 calls), tight for a script.
 *  `key` is the IP hash, or the user id when the address is unknown. */
export const BURST = { capacity: 20, refillMs: 3_000 };
export const burstOk = (key: string) => take(ipBuckets, `burst:${key}`, BURST.capacity, BURST.refillMs);

/** Anonymous sign-ins per IP: guests may share a network (school, office), but nobody needs more than a handful a minute. */
export const anonSignInOk = (ipHash: string) => take(ipBuckets, `anon:${ipHash}`, 15, 30_000);

/** Key checks (PUT /api/keys) per client address: each one makes an outbound call to a provider with a key the caller typed, so without this the server is a key-testing oracle. 5 at once, then 1 per 30 s.
 *  `key` is the IP hash, or the user id when the address is unknown. */

/** Autosave of an in-progress Listening/Reading attempt: the client debounces to ~1 s, so 30 tokens + 1 per 2 s never blocks a real session. Use after requireUser. */
export const lrSaveLimit = createMiddleware<AppEnv>(async (c, next) => {
  if (!take(buckets, `lr:${currentUser(c).id}`, 30, 2_000)) throw new HTTPException(429, { message: 'Too many requests, slow down' });
  await next();
});

/** Listening/Reading submit: each one may ask the model to explain up to 15 wrong gap answers. A person submits a part every few minutes at most;
 *  per account and per client address, so minting guests does not multiply it. Use after requireUser. */
export const lrSubmitLimit = createMiddleware<AppEnv>(async (c, next) => {
  const ip = clientIpHash(c) ?? currentUser(c).id;
  if (!take(buckets, `lrsubmit:${currentUser(c).id}`, 8, 60_000) || !take(ipBuckets, `lrsubmit-ip:${ip}`, 20, 30_000)) throw new HTTPException(429, { message: 'Too many submissions, slow down' });
  await next();
});

/** Delivery-status polls (GET /api/auth-email/status) per client address: the web and mobile screens poll every ~2 s for 20 s after a send, so 30 at once + 1 per 2 s never blocks a person and stops address probing. */
export const authStatusOk = (ipHash: string) => take(ipBuckets, `authstatus:${ipHash}`, 30, 2_000);

/** Code-sending endpoints (sign-up, send code, password reset), per client address. Deliberately NOT per target address: a bucket keyed by the victim's email would let anyone lock
 *  the victim out of their own code. Inbox bombing is capped by the atomic 30 s cooldown per address+purpose (auth-email.ts). Same for real and unknown addresses. */
export const codeRequestOk = (ipHash: string) => take(ipBuckets, `code-ip:${ipHash}`, 30, 3_000);

/** Code checks (verify-email, reset-password, ...) per client address, on top of the per-email wrong-code budget. A person types a code a few times; 20 at once, then 1 per 6 s. */
export const codeCheckOk = (ipHash: string) => take(ipBuckets, `code-check:${ipHash}`, 20, 6_000);

/** Replay chunk uploads per account: a recorder flushes every 10 s, so 12 at once + 1 per 5 s never blocks a real tab. `key` is the user id. */
export const replayChunkOk = (key: string) => take(ipBuckets, `replay:${key}`, 12, 5_000);

/** The same uploads per client address, a looser net over many accounts (a school or office shares one): 200 at once, then 1 per second. */
export const replayIpOk = (ipHash: string) => take(ipBuckets, `replay-ip:${ipHash}`, 200, 1_000);

/** "Report a problem" posts per client address: 5, then 1 per 10 min. */
export const feedbackOk = (key: string) => take(ipBuckets, `feedback:${key}`, 5, 600_000);
