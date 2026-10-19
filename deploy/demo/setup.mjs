import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const secrets = ['POSTGRES_PASSWORD', 'BETTER_AUTH_SECRET', 'KEY_ENCRYPTION_SECRET', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'LIVEKIT_REPORT_SECRET', 'DEMO_PASSWORD'];

export function setup(dir) {
  const path = join(dir, '.env');
  let text = readFileSync(existsSync(path) ? path : join(dir, '.env.example'), 'utf8');
  const values = parseEnv(text), added = [];
  for (const key of secrets) {
    if (!values[key]) {
      values[key] = randomBytes(32).toString('hex');
      added.push(`${key}=${values[key]}`);
    }
    if (!/^[a-f0-9]{64}$/.test(values[key])) throw new Error(`${key} must keep its generated 64-character hexadecimal value. Restore this installation's original .env.`);
  }
  if (added.length) text += `\n# Generated for this local installation; preserve these across restarts.\n${added.join('\n')}\n`;
  writeFileSync(path, text, { mode: 0o600 });
  const missing = ['OPENROUTER_API_KEY', 'SONIOX_API_KEY'].filter((key) => !values[key]?.trim());
  if (missing.length) throw new Error(`Created .env. Fill in ${missing.join(' and ')} in that file, then run Start again.`);
  writeFileSync(join(dir, 'demo-login.txt'), `Local IELTS Practice\nhttp://localhost:8787\nEmail: demo@example.test\nPassword: ${values.DEMO_PASSWORD}\n\nThis login belongs only to this local installation.\n`, { mode: 0o600 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    setup(dirname(fileURLToPath(import.meta.url)));
    console.log('Local configuration ready. Runtime keys were not printed.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
