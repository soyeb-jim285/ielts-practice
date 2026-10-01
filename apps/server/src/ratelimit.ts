import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from './auth';
import type { AppEnv } from './types';

// A full live test makes ~25 paid calls in ~14 min (bursty in Part 1), so 20 tokens + 1 per 20 s never blocks a real session.
const CAPACITY = 20;
const REFILL_MS = 20_000;
// ponytail: per-process memory; move to Postgres/Redis if the server ever runs more than one instance.
const buckets = new Map<string, { t: number; at: number }>();

/** Per-user token bucket for routes that spend AI credit (STT/LLM/TTS/live sessions). Use after requireUser. */
export const aiLimit = createMiddleware<AppEnv>(async (c, next) => {
  const id = currentUser(c).id;
  const now = Date.now();
  const b = buckets.get(id);
  const t = b ? Math.min(CAPACITY, b.t + (now - b.at) / REFILL_MS) : CAPACITY;
  if (t < 1) throw new HTTPException(429, { message: 'Too many requests, slow down' });
  buckets.set(id, { t: t - 1, at: now });
  await next();
});
