import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from './app';
import { env } from './env';
import { purgeGuests, recoverStale } from './jobs';
import { attachLiveRelay } from './routes/live-ws';

const app = createApp();
const injectWebSocket = attachLiveRelay(app); // native GPT-Live relay; before the SPA catch-all below

if (existsSync(env.WEB_DIST)) {
  const indexHtml = readFileSync(join(env.WEB_DIST, 'index.html'), 'utf8');
  // Hashed /assets/* never change; the HTML shell must revalidate so a deploy is picked up.
  app.use('/*', async (c, next) => {
    await next();
    if (c.req.path.startsWith('/assets/') && c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable');
    else if (c.res.headers.get('Content-Type')?.startsWith('text/html')) c.header('Cache-Control', 'no-cache');
  });
  // precompressed: serves .br/.gz siblings when the build emitted them; otherwise compress() (app.ts) gzips on the fly.
  app.use('/*', serveStatic({ root: env.WEB_DIST, precompressed: true }));
  // A missing /assets/* file is a 404, never the HTML shell (which the middleware above would otherwise mark immutable, poisoning the cache after a deploy).
  app.get('*', (c) => (c.req.path.startsWith('/api') || c.req.path.startsWith('/assets/') ? c.notFound() : c.html(indexHtml)));
}

const sweep = () => recoverStale().catch((e) => console.error('recoverStale failed', e));
await sweep();
setInterval(sweep, 5 * 60_000).unref(); // rows orphaned by a restart become stale 10 min after submit
const purge = () => purgeGuests().catch((e) => console.error('purgeGuests failed', e));
void purge();
setInterval(purge, 6 * 3_600_000).unref();
const server = serve({ fetch: app.fetch, port: env.PORT }, (i) => console.log(`IELTS Practice API on http://localhost:${i.port} (docs: /docs)`));
injectWebSocket(server);
