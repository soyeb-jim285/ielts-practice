import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { cambridgeSource, isCambridgeAllowed, isOwner, loadCambridgeGrants, OWNER_EMAILS, requireOwner, setCambridgeGrant } from '../auth';
import { db } from '../db/client';
import { cambridgeAccess, guestConversions, user as userTable } from '../db/schema';
import { env } from '../env';
import { linkGuest } from '../link';
import { createApp } from '../app';
import { guestUser, req, testUser } from '../test/helpers';

const OWNER = OWNER_EMAILS[0]!;
const probe = createApp();
probe.get('/api/owner-probe', requireOwner, (c) => c.json({ ok: true }));
const get = (headers?: Headers) => probe.request('/api/owner-probe', { headers });

describe('isOwner', () => {
  it('needs a verified, non-guest owner email (case-insensitive)', () => {
    expect(isOwner({ email: OWNER, emailVerified: true })).toBe(true);
    expect(isOwner({ email: OWNER.toUpperCase(), emailVerified: true, isAnonymous: false })).toBe(true);
    expect(isOwner({ email: OWNER, emailVerified: false })).toBe(false);
    expect(isOwner({ email: OWNER, emailVerified: true, isAnonymous: true })).toBe(false);
    expect(isOwner({ email: 'other@x.com', emailVerified: true })).toBe(false);
    expect(isOwner(null)).toBe(false);
  });
});

describe('Cambridge access merge', () => {
  it('owner > server-config > granted > none, and verification is still required', async () => {
    const [cfg] = env.CAMBRIDGE_ALLOWED_EMAILS;
    expect(cambridgeSource(OWNER)).toBe('owner');
    expect(cambridgeSource(cfg!.toUpperCase())).toBe('server-config');
    expect(cambridgeSource('Grant@x.com')).toBeNull();

    await db.insert(cambridgeAccess).values({ email: 'grant@x.com', grantedBy: OWNER });
    expect(cambridgeSource('grant@x.com')).toBeNull(); // cached until reloaded
    await loadCambridgeGrants();
    expect(cambridgeSource('Grant@x.com')).toBe('granted');
    expect(isCambridgeAllowed({ email: 'grant@x.com', emailVerified: true })).toBe(true);
    expect(isCambridgeAllowed({ email: 'grant@x.com', emailVerified: false })).toBe(false);

    setCambridgeGrant('Grant@x.com', false);
    expect(isCambridgeAllowed({ email: 'grant@x.com', emailVerified: true })).toBe(false);
    setCambridgeGrant('grant@x.com', true);
    expect(cambridgeSource('grant@x.com')).toBe('granted');
  });
});

describe('requireOwner', () => {
  it('answers 404 to anonymous, guest, ordinary and unverified-owner callers, 200 to the owner', async () => {
    for (const h of [undefined, (await guestUser()).headers, (await testUser()).headers, (await testUser(OWNER, { verified: false })).headers]) {
      const r = await get(h);
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ error: 'Not found' });
      if (h?.get('Authorization')) await db.delete(userTable).where(eq(userTable.email, OWNER)); // free the owner address for the next case
    }
    expect((await get((await testUser(OWNER)).headers)).status).toBe(200);
  });

  it('is reported to the web as me.isOwner', async () => {
    const o = await testUser(OWNER);
    expect(((await (await req('/api/me', { headers: o.headers })).json()) as { isOwner: boolean }).isOwner).toBe(true);
    const u = await testUser();
    expect(((await (await req('/api/me', { headers: u.headers })).json()) as { isOwner: boolean }).isOwner).toBe(false);
  });
});

describe('linkGuest', () => {
  it('records the guest to account conversion', async () => {
    const g = await guestUser();
    const u = await testUser();
    await linkGuest(g.user.id, u.user.id);
    const [row] = await db.select().from(guestConversions).where(eq(guestConversions.guestId, g.user.id));
    expect(row?.userId).toBe(u.user.id);
    await linkGuest(g.user.id, u.user.id); // idempotent
  });
});
