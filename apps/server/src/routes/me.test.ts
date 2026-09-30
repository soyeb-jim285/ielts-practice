import { it, expect } from 'vitest';
import { req, testUser } from '../test/helpers';
import { DEFAULT_SETTINGS } from '../settings';
import { db } from '../db/client';
import { liveSessions } from '../db/schema';
import { storage } from '../storage';

it('requires auth', async () => {
  expect((await req('/api/me')).status).toBe(401);
});

it('returns user, settings and access flags', async () => {
  const { headers, user } = await testUser();
  const me = (await (await req('/api/me', { headers })).json()) as any;
  expect(me.user).toMatchObject({ id: user.id, email: user.email });
  expect(me.settings).toEqual(DEFAULT_SETTINGS);
  expect(me.cambridgeAccess).toBe(false);
  expect(typeof me.realtimeAvailable).toBe('boolean');
});

it('deleting the account also deletes its recordings', async () => {
  const { headers, user } = await testUser();
  const keep = await testUser();
  const sid = crypto.randomUUID();
  await db.insert(liveSessions).values({ id: sid, userId: user.id, state: {} });
  const keys = [`audio/${user.id}/a.webm`, `live/${sid}/c-1.webm`, `audio/${keep.user.id}/b.webm`];
  for (const k of keys) await storage.put(k, new Uint8Array([1]), 'audio/webm');
  const res = await req('/api/auth/delete-user', { headers, body: { password: 'password1234' } });
  expect(res.status).toBe(200);
  expect(await Promise.all(keys.map((k) => storage.size(k)))).toEqual([null, null, 1]);
});
