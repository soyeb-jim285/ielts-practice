import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from './auth';
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
  if (map.size > 20_000) map.clear();
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
export const keyCheckOk = (key: string) => take(ipBuckets, `keys:${key}`, 5, 30_000);

/** Autosave of an in-progress Listening/Reading attempt: the client debounces to ~1 s, so 30 tokens + 1 per 2 s never blocks a real session. Use after requireUser. */
export const lrSaveLimit = createMiddleware<AppEnv>(async (c, next) => {
  if (!take(buckets, `lr:${currentUser(c).id}`, 30, 2_000)) throw new HTTPException(429, { message: 'Too many requests, slow down' });
  await next();
});

/** Delivery-status polls (GET /api/auth-email/status) per client address: the web and mobile screens poll every ~2 s for 20 s after a send, so 30 at once + 1 per 2 s never blocks a person and stops address probing. */
export const authStatusOk = (ipHash: string) => take(ipBuckets, `authstatus:${ipHash}`, 30, 2_000);

/** Code-sending endpoints (sign-up, send code, password reset), per client address. Deliberately NOT per target address: a bucket keyed by the victim's email would let anyone lock
 *  the victim out of their own code. Inbox bombing is capped by the atomic 30 s cooldown per address+purpose (auth-email.ts). Same for real and unknown addresses. */
export const codeRequestOk = (ipHash: string) => take(ipBuckets, `code-ip:${ipHash}`, 30, 3_000);
