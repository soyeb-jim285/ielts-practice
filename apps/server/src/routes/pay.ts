// PayStation hosted checkout (https://www.paystation.com.bd/documentation): start → PayStation page → return URL and IPN → verify server-side → extend the paid plan once.
import { createRoute, z } from '@hono/zod-openapi';
import { PAID_PLANS, type PaidPlan } from '@ielts/core';
import { and, eq, gt, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { currentUser, requireAccount } from '../auth';
import { DHAKA } from '../admin/common';
import { db } from '../db/client';
import { payments, user, userLimits } from '../db/schema';
import { sendEmail } from '../email';
import { renderEmail } from '../email-templates';
import { env } from '../env';
import { feedbackOk } from '../ratelimit'; // ponytail: 5 per 10 min per key, plenty for checkout starts
import type { App } from '../types';

const PLAN_KEYS = Object.keys(PAID_PLANS) as [PaidPlan, ...PaidPlan[]];

const Body = z
  .object({
    plan: z.enum(PLAN_KEYS),
    phone: z.string().trim().regex(/^(\+?88)?01[3-9]\d{8}$/, 'Enter a Bangladeshi mobile number, like 01712345678'),
    acceptTerms: z.literal(true).openapi({ description: 'The customer ticked "I agree to the Terms, Refund policy and Privacy policy"' }),
  })
  .openapi('CheckoutBody');

const ready = () => !!(env.PAYSTATION_MERCHANT_ID && env.PAYSTATION_PASSWORD);

/** PayStation's own record of the invoice. Never trust the return URL or IPN body: they are unauthenticated. */
async function trxStatus(invoice: string) {
  const res = await fetch(`${env.PAYSTATION_URL}/transaction-status`, {
    method: 'POST',
    headers: { merchantId: env.PAYSTATION_MERCHANT_ID!, accept: 'application/json' },
    body: new URLSearchParams({ invoice_number: invoice }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await res.json().catch(() => null)) as { status_code?: string; data?: { trx_status?: string; trx_id?: string; payment_amount?: string; payment_method?: string } } | null;
  return j?.status_code === '200' ? j.data : undefined;
}

/** Check one invoice with PayStation and, if paid in full, mark it paid and extend the plan. Safe to call repeatedly (return URL + IPN retries). */
export async function settle(invoice: string): Promise<'paid' | 'failed' | 'pending' | 'unknown'> {
  const [p] = await db.select().from(payments).where(eq(payments.invoice, invoice));
  if (!p) return 'unknown';
  if (p.status !== 'pending') return p.status;
  const t = await trxStatus(invoice);
  const s = t?.trx_status?.toLowerCase();
  if (s === 'failed') {
    await db.update(payments).set({ status: 'failed' }).where(and(eq(payments.invoice, invoice), eq(payments.status, 'pending')));
    return 'failed';
  }
  if (s !== 'success' || Number(t!.payment_amount) < p.amount) return 'pending'; // processing, or short: leave for a person to look at

  const days = PAID_PLANS[p.plan].days;
  const until = await db.transaction(async (tx) => {
    const [won] = await tx
      .update(payments)
      .set({ status: 'paid', trxId: t!.trx_id || null, method: t!.payment_method || null, paidAt: new Date() })
      .where(and(eq(payments.invoice, invoice), eq(payments.status, 'pending')))
      .returning({ userId: payments.userId });
    if (!won?.userId) return null; // another call settled it first, or the account is gone
    // A renewal adds to what is left; a lapsed plan starts today.
    const next = sql`greatest(coalesce(${userLimits.subscribedUntil}, now()), now()) + make_interval(days => ${days})`;
    const [r] = await tx
      .insert(userLimits)
      .values({ userId: won.userId, unlimited: false, subscribedUntil: sql`now() + make_interval(days => ${days})`, updatedBy: 'paystation', updatedAt: new Date() })
      .onConflictDoUpdate({ target: userLimits.userId, set: { subscribedUntil: next, updatedBy: 'paystation', updatedAt: new Date() } })
      .returning({ until: userLimits.subscribedUntil });
    return r?.until ? { userId: won.userId, until: r.until } : null;
  });
  if (until) {
    const [u] = await db.select({ email: user.email, name: user.name }).from(user).where(eq(user.id, until.userId));
    if (u) {
      const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: DHAKA }).format(until.until);
      void renderEmail('plan-granted', { name: u.name?.trim() || 'there', until: day })
        .then((m) => sendEmail({ to: u.email, ...m }))
        .catch((e) => console.error('[pay] plan email failed', e instanceof Error ? e.message : e));
    }
  }
  return 'paid';
}

/** Re-check the last day's pending payments: covers a missed IPN or a browser closed before the return URL. */
export async function settlePending() {
  if (!ready()) return;
  const rows = await db.select({ invoice: payments.invoice }).from(payments).where(and(eq(payments.status, 'pending'), gt(payments.createdAt, new Date(Date.now() - 86_400_000))));
  for (const r of rows) await settle(r.invoice).catch((e) => console.error('[pay] settle failed', r.invoice, e instanceof Error ? e.message : e));
}

export function register(app: App) {
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/pay/checkout',
      tags: ['Payments'],
      summary: 'Start a PayStation payment for a paid plan; returns the hosted checkout URL',
      security: [{ bearer: [] }],
      middleware: [requireAccount] as const,
      request: { body: { required: true, content: { 'application/json': { schema: Body } } } },
      responses: { 200: { description: 'Redirect the browser here', content: { 'application/json': { schema: z.object({ url: z.string() }).openapi('CheckoutStarted') } } } },
    }),
    async (c) => {
      const u = currentUser(c);
      if (!ready()) throw new HTTPException(503, { message: 'Payments open soon.' });
      if (!feedbackOk(`pay:${u.id}`)) throw new HTTPException(429, { message: 'Too many tries. Wait a few minutes.' });
      const b = c.req.valid('json');
      const plan = PAID_PLANS[b.plan];
      const invoice = `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
      await db.insert(payments).values({ invoice, userId: u.id, plan: b.plan, amount: plan.bdt, termsAcceptedAt: new Date() });
      const res = await fetch(`${env.PAYSTATION_URL}/initiate-payment`, {
        method: 'POST',
        headers: { accept: 'application/json' },
        body: new URLSearchParams({
          merchantId: env.PAYSTATION_MERCHANT_ID!,
          password: env.PAYSTATION_PASSWORD!,
          invoice_number: invoice,
          currency: 'BDT',
          payment_amount: String(plan.bdt),
          pay_with_charge: '0', // we absorb the gateway fee, so the price shown is the price paid
          reference: `NextBand ${plan.label}`,
          cust_name: u.name?.trim() || u.email,
          cust_phone: b.phone.replace(/^\+?88/, ''),
          cust_email: u.email,
          callback_url: `${env.BETTER_AUTH_URL}/api/pay/return/${invoice}`,
          checkout_items: `NextBand paid plan, ${plan.label}`,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const j = (await res.json().catch(() => null)) as { status_code?: string; payment_url?: string; message?: string } | null;
      if (j?.status_code !== '200' || !j.payment_url) {
        console.error('[pay] initiate failed', invoice, j?.status_code, j?.message);
        await db.update(payments).set({ status: 'failed' }).where(eq(payments.invoice, invoice));
        throw new HTTPException(502, { message: "Couldn't open the payment page. Try again." });
      }
      return c.json({ url: j.payment_url }, 200);
    },
  );

  // PayStation sends the browser back here (paid, failed or cancelled); verify, then show the result page.
  app.get('/api/pay/return/:invoice', async (c) => {
    const verified = await settle(c.req.param('invoice')).catch(() => 'pending' as const);
    // PayStation keeps a cancelled checkout as "processing"; its ?status=Canceled|Failed only picks the message, never fulfils.
    const said = c.req.query('status')?.toLowerCase();
    const status = verified === 'pending' && (said === 'canceled' || said === 'cancelled' || said === 'failed') ? 'cancelled' : verified;
    return c.redirect(`${env.WEB_ORIGIN}/checkout/done?status=${status}`);
  });

  // Server-to-server IPN after a successful payment (configured with PayStation). The body only tells us which invoice to re-check.
  app.post('/api/pay/ipn', async (c) => {
    const b = (await c.req.json().catch(() => null)) as { invoice_number?: unknown } | null;
    const invoice = typeof b?.invoice_number === 'string' ? b.invoice_number : '';
    const r = invoice ? await settle(invoice) : 'unknown';
    // 5xx makes PayStation retry while its side still says processing.
    return r === 'pending' ? c.json({ status: 'pending' }, 503) : c.json({ status: 'success' }, r === 'unknown' ? 404 : 200);
  });
}
