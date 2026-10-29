import { app, json, req, testUser } from '../test/helpers'; // first: loads the app before the modules that import it back
import { eq } from 'drizzle-orm';
import { afterEach, expect, it, vi } from 'vitest';
import { db } from '../db/client';
import { payments, userLimits } from '../db/schema';
import { settle } from './pay';

vi.mock('../email', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'e1', attempts: 1 })), sendBatch: vi.fn(async () => ({ ok: true })) }));
afterEach(() => vi.unstubAllGlobals());
const DAY = 86_400_000;

/** PayStation's transaction-status answer for every call. */
const paystation = (data: Record<string, string>) => vi.stubGlobal('fetch', vi.fn(async () => json({ status_code: '200', status: 'success', data })));

async function invoice(userId: string, plan: 'month' | 'quarter', amount: number) {
  const inv = `t${Math.random().toString().slice(2, 14)}`;
  await db.insert(payments).values({ invoice: inv, userId, plan, amount, termsAcceptedAt: new Date() });
  return inv;
}
const until = async (userId: string) => (await db.select().from(userLimits).where(eq(userLimits.userId, userId)))[0]?.subscribedUntil;

it('a verified payment turns the plan on once, and a renewal adds to the time left', async () => {
  const { user } = await testUser(undefined, { unlimited: false });
  const inv = await invoice(user.id, 'month', 499);
  paystation({ trx_status: 'Success', trx_id: 'X1', payment_amount: '499.00', payment_method: 'bKash' });
  expect(await settle(inv)).toBe('paid');
  expect(await settle(inv)).toBe('paid'); // IPN retry: no second extension
  const first = (await until(user.id))!.getTime();
  expect(first - Date.now()).toBeGreaterThan(29.9 * DAY);
  expect(first - Date.now()).toBeLessThan(30.1 * DAY);
  const [row] = await db.select().from(payments).where(eq(payments.invoice, inv));
  expect(row).toMatchObject({ status: 'paid', trxId: 'X1', method: 'bKash' });

  const inv2 = await invoice(user.id, 'quarter', 1199);
  paystation({ trx_status: 'success', trx_id: 'X2', payment_amount: '1199', payment_method: 'Nagad' });
  expect(await settle(inv2)).toBe('paid');
  expect((await until(user.id))!.getTime() - first).toBeGreaterThan(89.9 * DAY);
});

it('does not trust a short or unfinished payment', async () => {
  const { user } = await testUser(undefined, { unlimited: false });
  const inv = await invoice(user.id, 'month', 499);
  paystation({ trx_status: 'Success', payment_amount: '1.00' });
  expect(await settle(inv)).toBe('pending');
  paystation({ trx_status: 'processing', payment_amount: '499.00' });
  expect(await settle(inv)).toBe('pending');
  paystation({ trx_status: 'Failed', payment_amount: '499.00' });
  expect(await settle(inv)).toBe('failed');
  expect(await until(user.id)).toBeUndefined();
});

it('IPN re-checks with PayStation instead of believing the body', async () => {
  const { user } = await testUser(undefined, { unlimited: false });
  const inv = await invoice(user.id, 'month', 499);
  paystation({ trx_status: 'processing', payment_amount: '499.00' });
  const forged = await app.request('/api/pay/ipn', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invoice_number: inv, trx_status: 'Success', trx_amount: 499 }) });
  expect(forged.status).toBe(503); // still processing on PayStation's side: retry later
  expect(await until(user.id)).toBeUndefined();
  const unknown = await app.request('/api/pay/ipn', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invoice_number: 'nope' }) });
  expect(unknown.status).toBe(404);
});

it('checkout needs the terms accepted and an account', async () => {
  const { headers } = await testUser(undefined, { unlimited: false });
  const noTerms = await req('/api/pay/checkout', { method: 'POST', headers, body: { plan: 'month', phone: '01712345678', acceptTerms: false } });
  expect(noTerms.status).toBe(400);
  const ok = await req('/api/pay/checkout', { method: 'POST', headers, body: { plan: 'month', phone: '01712345678', acceptTerms: true } });
  expect(ok.status).toBe(503); // no PayStation credentials in tests: "payments open soon"
  const anon = await app.request('/api/pay/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  expect(anon.status).toBe(401);
});
