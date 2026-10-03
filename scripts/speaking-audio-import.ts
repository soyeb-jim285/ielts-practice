// Uploads the rendered examiner lines (data/speaking-audio/<hash>.mp3, see gen-speaking-audio.py) to storage under speaking/<hash>.mp3
// and writes speaking/manifest.json ({hash: key} of what exists), which the API reads to decide which prompt lines get audio.
// Usage: pnpm tsx scripts/speaking-audio-import.ts [--dry]   (storage per .env: R2; to seed local disk blank R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY and set LOCAL_STORAGE_DIR=$PWD/data/local-storage)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dry = process.argv.includes('--dry');
const dir = fileURLToPath(new URL('../data/speaking-audio/', import.meta.url));
const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^[0-9a-f]{16}\.mp3$/.test(f)) : [];
if (dry || !files.length) {
  console.log(`${files.length} rendered lines${dry ? ' (dry)' : ''}`);
  process.exit(0);
}
try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
  // env may come from the shell instead
}
const { storage } = await import('../apps/server/src/storage'); // parses env on import
const manifest: Record<string, string> = {};
let up = 0;
for (const f of files) {
  const hash = f.slice(0, -4), key = `speaking/${f}`;
  manifest[hash] = key;
  if ((await storage.size(key)) === statSync(dir + f).size) continue;
  await storage.put(key, readFileSync(dir + f), 'audio/mpeg');
  up++;
}
await storage.put('speaking/manifest.json', new TextEncoder().encode(JSON.stringify(manifest)), 'application/json');
console.log(`${files.length} lines in the manifest, ${up} uploaded`);
process.exit(0);
