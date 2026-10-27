import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { emailCampaigns } from '../db/schema';
import { sendBatch } from '../email';
import { origin, personalise, renderDoc } from '../email-templates';
import { env } from '../env';
import { updateSettings } from '../settings';

export type Audience = 'all' | 'free' | 'paid';
type Recipient = { id: string; email: string; name: string | null };

/** Signed, non-expiring unsubscribe token for one account (the link must keep working in old emails). */
const sign = (userId: string) => createHmac('sha256', env.BETTER_AUTH_SECRET).update(`unsubscribe:${userId}`).digest('base64url').slice(0, 32);
export const unsubscribeToken = (userId: string) => `${userId}.${sign(userId)}`;
export function readUnsubscribeToken(t: string | undefined): string | null {
  const i = t?.lastIndexOf('.') ?? -1;
  if (!t || i < 1) return null;
  const id = t.slice(0, i);
  const want = Buffer.from(sign(id));
  const got = Buffer.from(t.slice(i + 1));
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}
export const unsubscribe = (userId: string) => updateSettings(userId, { productEmails: false });
export const unsubscribeUrl = (userId: string) => `${origin()}/api/email/unsubscribe?t=${encodeURIComponent(unsubscribeToken(userId))}`;

/** Verified, non-guest accounts with product emails on, by plan. */
export async function audienceOf(a: Audience): Promise<Recipient[]> {
  const paid = sql`exists (select 1 from user_limits l where l.user_id = u.id and l.subscribed_until > now())`;
  const plan = a === 'paid' ? sql`and ${paid}` : a === 'free' ? sql`and not ${paid}` : sql``;
  const rows = await db.execute(sql`select u.id, u.email, u.name from "user" u left join user_settings s on s.user_id = u.id
    where not coalesce(u.is_anonymous, false) and u.email_verified and coalesce((s.data->>'productEmails')::boolean, true) ${plan} order by u.created_at`);
  return rows as unknown as Recipient[];
}
export const audienceSize = async (a: Audience) => (await audienceOf(a)).length;

/** "Md. Al-Amin Mridha" → "Al-Amin": a leading Md./Mohammad is a common prefix here, not the name anyone is called by. */
export const firstName = (n: string | null) => {
  const w = n?.trim().split(/\s+/).filter(Boolean) ?? [];
  return (w.length > 1 && /^(md|mohd|mohammad|mohammed|muhammad)\.?$/i.test(w[0]!) ? w[1] : w[0]) || 'there';
};
/** Placeholders a campaign may use. */
export const CAMPAIGN_VARS = { name: 'Ayesha Rahman', firstName: 'Ayesha' };

/** One recipient's email: personal unsubscribe link in the footer and the one-click List-Unsubscribe headers (Gmail/Yahoo bulk-sender rules). */
export function campaignEmail(r: { subject: string; html: string }, u: Recipient) {
  const url = unsubscribeUrl(u.id);
  const m = personalise(r, { name: u.name?.trim() || 'there', firstName: firstName(u.name), unsubscribeUrl: url });
  return { to: u.email, ...m, headers: { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
}

const CHUNK = 100; // Resend batch limit
export const pause = { ms: 600 }; // Resend allows 2 requests a second; tests set 0

/** Sends a draft in the background, 100 at a time, counting as it goes. Claims the draft atomically, so a double click sends once. */
export async function startCampaign(id: string): Promise<boolean> {
  const [c] = await db.update(emailCampaigns).set({ status: 'sending' }).where(sql`${emailCampaigns.id} = ${id} and ${emailCampaigns.status} = 'draft'`).returning();
  if (!c) return false;
  void (async () => {
    const people = await audienceOf(c.audience);
    await db.update(emailCampaigns).set({ recipients: people.length }).where(eq(emailCampaigns.id, id));
    const r = await renderDoc({ subject: c.subject, preheader: c.preheader, blocks: c.blocks }, 'promo');
    let sent = 0, failed = 0;
    for (let i = 0; i < people.length; i += CHUNK) {
      const chunk = people.slice(i, i + CHUNK);
      const res = await sendBatch(chunk.map((u) => campaignEmail(r, u)), `campaign-${id}-${i / CHUNK}`);
      if (res.ok) sent += chunk.length;
      else failed += chunk.length;
      await db.update(emailCampaigns).set({ sent, failed }).where(eq(emailCampaigns.id, id));
      if (i + CHUNK < people.length) await new Promise((x) => setTimeout(x, pause.ms));
    }
    await db.update(emailCampaigns).set({ status: failed && !sent ? 'failed' : 'sent', sentAt: new Date() }).where(eq(emailCampaigns.id, id));
  })().catch(async (e) => {
    console.error('[email] campaign failed', id, e instanceof Error ? e.message : e);
    await db.update(emailCampaigns).set({ status: 'failed' }).where(eq(emailCampaigns.id, id));
  });
  return true;
}
