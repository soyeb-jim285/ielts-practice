import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { countBefore, emailStatus, finishRequest, isPurpose, releaseAttempt, reserveAttempt, STATUS_HEADER } from './auth-email';
import { auth, clearBearerCache, sessionMiddleware } from './auth';
import { env, R2_CONFIGURED } from './env';
import { ApiError } from './errors';
import { clientIpHash } from './ip';
import { anonSignInOk, authStatusOk, codeCheckOk, codeRequestOk } from './ratelimit';
import { MAX_AUDIO_BYTES, requestOrigin, storage, verifyLocal } from './storage';
import type { AppEnv } from './types';
import { registerRoutes } from './routes';

/** Endpoints that make Better Auth send (or pretend to send) a code: which address and purpose, read from a copy of the body. */
async function codeRequest(path: string, raw: Request) {
  const purpose = path.endsWith('/sign-up/email') ? 'email-verification' : (path.endsWith('/email-otp/request-password-reset') || path.endsWith('/forget-password/email-otp')) ? 'forget-password' : path.endsWith('/email-otp/send-verification-otp') ? undefined : null;
  if (purpose === null) return null;
  const b = (await raw.clone().json().catch(() => null)) as { email?: unknown; type?: unknown } | null;
  const p = purpose ?? b?.type;
  return typeof b?.email === 'string' && isPurpose(p) ? { email: b.email.trim(), purpose: p } : null;
}

/** Endpoints that check a code: which address, read from a copy of the body. */
const CHECKS = /\/(email-otp\/(verify-email|reset-password|check-verification-otp|change-email)|sign-in\/email-otp)$/;
async function checkedEmail(path: string, raw: Request) {
  if (!CHECKS.test(path)) return null;
  const b = (await raw.clone().json().catch(() => null)) as { email?: unknown } | null;
  return typeof b?.email === 'string' ? b.email : null;
}

export function createApp() {
  const app = new OpenAPIHono<AppEnv>({
    // zod validation failures → 400 JSON with readable issues
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: 'Invalid request', issues: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, 400);
      }
    },
  });

  if (!R2_CONFIGURED) app.use('*', (c, next) => requestOrigin.run(new URL(c.req.url).origin, next)); // dev presigned URLs (storage.ts)

  // Behind Cloudflare an http:// visit served the whole app, then sign-in failed "Invalid origin" (only the https origin is trusted).
  // CF-Visitor carries the visitor's scheme (X-Forwarded-Proto is the proxy hop's); send http visitors to https and pin it with HSTS.
  app.use('*', async (c, next) => {
    const cf = c.req.header('cf-visitor');
    if (cf?.includes('"http"')) {
      const u = new URL(c.req.url);
      return c.redirect(`https://${c.req.header('host') ?? u.host}${u.pathname}${u.search}`, 308);
    }
    await next();
    if (cf) c.header('Strict-Transport-Security', 'max-age=31536000');
  });

  // gzip/deflate for JSON and (in production) static files; skips responses already encoded (precompressed assets) or < 1 KB.
  app.use('*', compress());
  app.use('/api/*', cors({ origin: [env.WEB_ORIGIN, env.BETTER_AUTH_URL, ...env.EXTRA_ORIGINS], credentials: true, exposeHeaders: ['set-auth-token', STATUS_HEADER] }));
  // Guests get an anonymous session on their first test start; one IP cannot mint them in bulk.
  app.post('/api/auth/sign-in/anonymous', async (c, next) => {
    const ip = clientIpHash(c);
    if (ip && !anonSignInOk(ip)) throw new ApiError(429, { error: 'Too many requests, slow down.', code: 'too_many_requests' });
    await next();
  });
  // Delivery status of the code email (see auth-email.ts): the same answer shape for real and unknown addresses.
  app.get('/api/auth-email/status', async (c) => {
    const ip = clientIpHash(c) ?? 'unknown';
    if (!authStatusOk(ip)) throw new ApiError(429, { error: 'Too many requests, slow down.', code: 'too_many_requests' });
    c.header('Cache-Control', 'no-store');
    return c.json(await emailStatus(c.req.header(STATUS_HEADER) ?? c.req.query('token')));
  });
  app.on(['GET', 'POST'], '/api/auth/*', async (c) => {
    const asked = c.req.method === 'POST' ? await codeRequest(c.req.path, c.req.raw) : null;
    if (asked && !codeRequestOk(clientIpHash(c) ?? 'unknown')) throw new ApiError(429, { error: 'Too many requests, slow down.', code: 'too_many_requests' });
    const checking = c.req.method === 'POST' ? await checkedEmail(c.req.path, c.req.raw) : null;
    let reserved: string | undefined;
    if (checking) {
      const ip = clientIpHash(c) ?? 'unknown';
      if (!codeCheckOk(ip)) throw new ApiError(429, { error: 'Too many requests, slow down.', code: 'too_many_requests' });
      const r = await reserveAttempt(checking, ip);
      // Budget spent (same answer for every address): refuse this caller. Live codes are left alone, so the owner is never locked out by someone else's guessing.
      if (r.id === undefined) throw new ApiError(429, { error: `Too many wrong codes. Try again in ${Math.max(1, Math.ceil(r.wait / 60))} ${r.wait <= 60 ? 'minute' : 'minutes'}.`, code: 'otp_locked', retryAfterSeconds: r.wait });
      reserved = r.id;
    }
    const before = asked ? await countBefore(asked) : 0;
    let res = await auth.handler(c.req.raw);
    if (reserved) {
      // Only a wrong guess keeps its count; a correct code (or any other error) gives the attempt back.
      const wrong = res.status >= 400 && ((await res.clone().json().catch(() => null)) as { code?: string } | null)?.code === 'INVALID_OTP';
      if (!wrong) await releaseAttempt(reserved);
    }
    if (asked) res = await finishRequest(asked, before, res);
    // sign-in/sign-up/verify-email can merge a guest into the account, which deletes the guest's session: drop it from the bearer cache (after the call, so nothing re-caches it).
    if (c.req.method === 'POST' && /\/(sign-out|revoke-|delete-user|change-password|reset-password|sign-in(?!\/anonymous)|sign-up|verify-email)/.test(c.req.path)) clearBearerCache();
    return res;
  });
  app.use('/api/*', sessionMiddleware);

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearer', { type: 'http', scheme: 'bearer' });

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/health',
      tags: ['System'],
      summary: 'Liveness check',
      responses: { 200: { description: 'OK', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } } },
    }),
    (c) => c.json({ ok: true }, 200),
  );

  registerRoutes(app);

  // Dev-only: serves localDisk storage's signed URLs when R2 isn't configured (never in production — env.ts enforces R2 there).
  if (!R2_CONFIGURED) {
    const MIME: Record<string, string> = { webm: 'audio/webm', m4a: 'audio/mp4', mp4: 'audio/mp4', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' };
    // /api/local-storage is what presigned URLs use (covered by the web dev proxy); /local-storage stays for URLs issued earlier.
    app.on(['GET', 'PUT', 'OPTIONS'], ['/api/local-storage/*', '/local-storage/*'], async (c) => {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, PUT', 'Access-Control-Allow-Headers': 'Content-Type, Range', 'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length' };
      if (c.req.method === 'OPTIONS') return c.body(null, 204, cors);
      const key = decodeURIComponent(c.req.path.replace(/^(\/api)?\/local-storage\//, ''));
      const method = c.req.method as 'GET' | 'PUT';
      if (!verifyLocal(method, key, Number(c.req.query('exp')), c.req.query('sig') ?? '')) return c.text('Forbidden', 403, cors);
      if (method === 'PUT') {
        const body = new Uint8Array(await c.req.arrayBuffer());
        if (body.length > MAX_AUDIO_BYTES) return c.text('Too large', 413, cors);
        await storage.put(key, body, c.req.header('content-type') ?? 'application/octet-stream');
        return c.body(null, 200, cors);
      }
      const size = await storage.size(key);
      if (size == null) return c.text('Not found', 404, cors);
      const data = await storage.get(key);
      const headers = { ...cors, 'Content-Type': MIME[key.split('.').pop() ?? ''] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes' };
      // HTTP Range so <audio> can seek (Listening practice mode); R2's presigned URLs support it natively.
      const m = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('range') ?? '');
      if (m && (m[1] || m[2])) {
        const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
        const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
        if (start > end || start >= size) return c.body(null, 416, { ...headers, 'Content-Range': `bytes */${size}` });
        return c.body(data.slice(start, end + 1) as unknown as ArrayBuffer, 206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) });
      }
      return c.body(data as unknown as ArrayBuffer, 200, headers);
    });
  }

  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'IELTS Practice API',
      version: '1.0.0',
      description: 'Speaking + Writing practice API. Auth: Better Auth at /api/auth/* (cookie for web, `Authorization: Bearer <token>` for iOS — token returned in the `set-auth-token` header on sign-in).',
    },
  });
  app.get('/docs', Scalar({ url: '/openapi.json', pageTitle: 'IELTS Practice API' }));

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(err.body, err.status);
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: 'Internal error' }, 500);
  });

  return app;
}
