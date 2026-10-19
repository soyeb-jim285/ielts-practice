import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseEnv } from 'node:util';
import { setup } from './setup.mjs';

test('setup creates missing secrets once, preserves keys and rejects incomplete setup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ielts-demo-'));
  try {
    writeFileSync(join(dir, '.env.example'), 'OPENROUTER_API_KEY=\nSONIOX_API_KEY=\n');
    assert.throws(() => setup(dir), /Fill in OPENROUTER_API_KEY and SONIOX_API_KEY/);
    const first = parseEnv(readFileSync(join(dir, '.env'), 'utf8'));
    const secrets = Object.keys(first).filter((k) => !k.endsWith('API_KEY') || k === 'LIVEKIT_API_KEY');
    for (const key of secrets) assert.match(first[key], /^[a-f0-9]{64}$/);
    assert.equal(new Set(secrets.map((k) => first[k])).size, secrets.length);
    writeFileSync(join(dir, '.env'), `${readFileSync(join(dir, '.env'), 'utf8')}\nOPENROUTER_API_KEY='test-$-literal'\nSONIOX_API_KEY=test-soniox\n`);
    setup(dir);
    const before = readFileSync(join(dir, '.env'), 'utf8');
    setup(dir);
    assert.equal(readFileSync(join(dir, '.env'), 'utf8'), before, 'Never rotate credentials on restart');
    const result = parseEnv(before);
    for (const key of secrets) assert.equal(result[key], first[key]);
    assert.equal(result.OPENROUTER_API_KEY, 'test-$-literal');
    assert.match(readFileSync(join(dir, 'demo-login.txt'), 'utf8'), new RegExp(first.DEMO_PASSWORD));
    writeFileSync(join(dir, '.env'), `${before}\nPOSTGRES_PASSWORD=invalid\n`);
    assert.throws(() => setup(dir), /Restore this installation's original/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
