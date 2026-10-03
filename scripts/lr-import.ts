// Imports Listening & Reading tests (LrTest JSON) as restricted lr_tests rows and uploads their assets to storage under lr/<key>.
// Reads data/cambridge-lr/*.json and data/lr-generated/*.json (assets in <dir>/assets/<key>); PRIVATE data, never commit it.
// Usage: pnpm tsx scripts/lr-import.ts [--dry] [--force] [--dev] [dir...]   (--dev adds the committed dev fixtures; --force imports tests that fail validation)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeLrTest, validateLrTest, type LrTest } from '../packages/core/src/lr';

const args = process.argv.slice(2);
const [dry, force, dev] = ['--dry', '--force', '--dev'].map((f) => args.includes(f));
const root = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const dirs = args.filter((a) => !a.startsWith('--'));
if (!dirs.length) dirs.push(root('data/cambridge-lr'), root('data/lr-generated'));
if (dev) dirs.push(root('apps/server/src/test/fixtures/lr'));

const MIME: Record<string, string> = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

if (!dry) {
  try {
    process.loadEnvFile(root('.env'));
  } catch {
    // env may come from the shell instead
  }
}
// server modules parse env on import, so load them only after .env
const server = dry ? null : { ...(await import('../apps/server/src/db/client')), ...(await import('../apps/server/src/storage')), ...(await import('../apps/server/src/db/schema')) };

let ok = 0, skipped = 0, uploaded = 0;
for (const dir of dirs) {
  if (!existsSync(dir)) {
    console.log(`${dir}: not found, skipping`);
    continue;
  }
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const t = normalizeLrTest(JSON.parse(readFileSync(join(dir, f), 'utf8')) as LrTest);
    const problems = validateLrTest(t);
    const keys = [...new Set(t.sections.flatMap((s) => [s.audio, ...s.groups.map((g) => g.image)]).filter((k): k is string => !!k))];
    const missing = keys.filter((k) => !existsSync(join(dir, 'assets', k)));
    if (missing.length) problems.push(`missing assets: ${missing.join(', ')}`);
    if (problems.length && !force) {
      skipped++;
      console.log(`SKIP ${f}: ${problems.join('; ')}`);
      continue;
    }
    if (problems.length) console.log(`FORCE ${f}: ${problems.join('; ')}`);
    if (server) {
      const { db, storage, lrTests } = server;
      for (const k of keys) {
        const file = join(dir, 'assets', k);
        if (!existsSync(file)) continue;
        if ((await storage.size(`lr/${k}`)) === statSync(file).size) continue; // already uploaded
        await storage.put(`lr/${k}`, readFileSync(file), MIME[extname(k).toLowerCase()] ?? 'application/octet-stream');
        uploaded++;
      }
      const row = { skill: t.skill, variant: t.variant, source: t.source, ref: t.ref, title: t.title, data: t, restricted: true };
      await db.insert(lrTests).values({ slug: t.slug, ...row }).onConflictDoUpdate({ target: lrTests.slug, set: row });
    }
    ok++;
    console.log(`${dry ? 'OK  ' : 'UP  '} ${t.slug} (${t.skill}, ${t.ref}, ${keys.length} assets)`);
  }
}
console.log(`lr-import: ${ok} ${dry ? 'valid' : 'upserted'}, ${skipped} skipped, ${uploaded} assets uploaded${dry ? ' [dry run]' : ''}`);
if (server) await server.sql.end();
