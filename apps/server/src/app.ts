import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { auth, clearBearerCache, sessionMiddleware } from './auth';
import { env, R2_CONFIGURED } from './env';
import { MAX_AUDIO_BYTES, storage, verifyLocal } from './storage';
import type { AppEnv } from './types';
import { registerRoutes } from './routes';

export function createApp() {
  const app = new OpenAPIHono<AppEnv>({
    // zod validation failures → 400 JSON with readable issues
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: 'Invalid request', issues: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, 400);
      }
    },
  });

  // gzip/deflate for JSON and (in production) static files; skips responses already encoded (precompressed assets) or < 1 KB.
  app.use('*', compress());
  app.use('/api/*', cors({ origin: [env.WEB_ORIGIN, env.BETTER_AUTH_URL, ...env.EXTRA_ORIGINS], credentials: true, exposeHeaders: ['set-auth-token'] }));
  app.on(['GET', 'POST'], '/api/auth/*', (c) => {
    if (c.req.method === 'POST' && /\/(sign-out|revoke-|delete-user|change-password|reset-password)/.test(c.req.path)) clearBearerCache();
    return auth.handler(c.req.raw);
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
    const MIME: Record<string, string> = { webm: 'audio/webm', m4a: 'audio/mp4', mp4: 'audio/mp4', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', png: 'image/png', jpg: 'image/jpeg' };
    app.on(['GET', 'PUT', 'OPTIONS'], '/local-storage/*', async (c) => {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, PUT', 'Access-Control-Allow-Headers': 'Content-Type' };
      if (c.req.method === 'OPTIONS') return c.body(null, 204, cors);
      const key = decodeURIComponent(c.req.path.slice('/local-storage/'.length));
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
      return c.body(data as unknown as ArrayBuffer, 200, { ...cors, 'Content-Type': MIME[key.split('.').pop() ?? ''] ?? 'application/octet-stream', 'Accept-Ranges': 'none' });
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
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: 'Internal error' }, 500);
  });

  return app;
}
