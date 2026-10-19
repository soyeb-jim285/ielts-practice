import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { storage } from '/app/apps/server/src/storage.ts';

const require = createRequire('/app/apps/server/package.json');
const { RoomServiceClient } = require('livekit-server-sdk');
const base = 'http://localhost:8787';
assert.equal(process.env.BETTER_AUTH_URL, base, 'Only run this check in the local demo');
assert.equal((await fetch(`${base}/api/health`)).status, 200);
const login = await fetch(`${base}/api/auth/sign-in/email`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: base },
  body: JSON.stringify({ email: 'demo@example.test', password: process.env.DEMO_PASSWORD }),
});
assert.equal(login.status, 200, `Demo login: ${login.status}`);

// Query the bank directly: no quota/balance endpoints or provider requests.
const { sql } = await import('/app/apps/server/src/db/client.ts');
try {
  const [bank] = await sql`select count(*)::int as n from prompts where source = 'generated'`;
  assert.ok(bank.n > 0, 'Generated question bank must be seeded');
  const [user] = await sql`select l.unlimited from user_limits l join "user" u on u.id = l.user_id where u.email = 'demo@example.test'`;
  assert.equal(user.unlimited, true);
} finally { await sql.end(); }

const prefix = `demo-check/${randomUUID()}/`, key = `${prefix}recording.webm`;
try {
  const put = await fetch(await storage.presignPut(key, 'audio/webm'), { method: 'PUT', body: 'demo audio', headers: { 'content-type': 'audio/webm' } });
  assert.equal(put.status, 200, 'Signed local recording upload');
  const get = await fetch(await storage.presignGet(key));
  assert.equal(await get.text(), 'demo audio');
  const partial = await fetch(await storage.presignGet(key), { headers: { range: 'bytes=0-3' } });
  assert.equal(partial.status, 206);
  assert.equal(await partial.text(), 'demo');
} finally { await storage.deletePrefix(prefix); }

const rooms = new RoomServiceClient('http://127.0.0.1:7880', process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
const name = `demo-check-${randomUUID()}`;
await rooms.createRoom({ name, emptyTimeout: 10 });
try { assert.ok((await rooms.listRooms([name])).some((r) => r.name === name)); }
finally { await rooms.deleteRoom(name); }
console.log('PASS: app, demo login, question bank, persistent storage routes, and LiveKit room API. No paid inference was requested.');
