import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { auth, sessionMiddleware } from './auth';
import { env } from './env';
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

  app.use('/api/*', cors({ origin: [env.WEB_ORIGIN, env.BETTER_AUTH_URL], credentials: true, exposeHeaders: ['set-auth-token'] }));
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));
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
