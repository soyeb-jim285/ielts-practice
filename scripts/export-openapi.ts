// Writes the API contract (GET /openapi.json) to a file without a running server or real secrets.
// Usage (via `pnpm gen:api`): tsx ../../scripts/export-openapi.ts [out=apps/web/src/openapi.json]
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// env.ts requires these outside tests; the spec does not depend on them and nothing connects anywhere.
for (const k of ['BETTER_AUTH_SECRET', 'OPENROUTER_API_KEY', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) process.env[k] ||= crypto.randomUUID() + crypto.randomUUID();
const { createApp } = await import('../apps/server/src/app');
const { sql } = await import('../apps/server/src/db/client');

const out = process.argv[2] ?? fileURLToPath(new URL('../apps/web/src/openapi.json', import.meta.url));
const spec = await (await createApp().request('/openapi.json')).json();
await writeFile(out, `${JSON.stringify(spec, null, 2)}\n`);
await sql.end();
console.log(`openapi: wrote ${out}`);
