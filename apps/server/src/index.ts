import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from './app';
import { env } from './env';
import { recoverStale } from './jobs';

const app = createApp();

if (existsSync(env.WEB_DIST)) {
  const indexHtml = readFileSync(join(env.WEB_DIST, 'index.html'), 'utf8');
  app.use('/*', serveStatic({ root: env.WEB_DIST }));
  app.get('*', (c) => (c.req.path.startsWith('/api') ? c.notFound() : c.html(indexHtml)));
}

await recoverStale().catch((e) => console.error('recoverStale failed', e));
serve({ fetch: app.fetch, port: env.PORT }, (i) => console.log(`IELTS Practice API on http://localhost:${i.port} (docs: /docs)`));
