import { createRoute, z } from '@hono/zod-openapi';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { emailCampaigns, emailSettings, emailTemplates } from '../db/schema';
import { sendEmail } from '../email';
import { docOf, getEmailSettings, isEmailKey, personalise, renderDoc, renderEmail, TEMPLATES, type EmailKey } from '../email-templates';
import { EmailDoc, EmailSettings } from '../emails/blocks';
import { audienceSize, CAMPAIGN_VARS, campaignEmail, startCampaign, unsubscribeUrl } from '../emails/campaigns';
import type { App } from '../types';
import { latestReport } from '../coach/report';
import { weeklyEmail } from '../coach/weekly';
import { adminRoute } from './common';

const route = { ...adminRoute, middleware: [...adminRoute.middleware] }; // ponytail: common.ts declares the tuple `as const`, which createRoute rejects (as in ops.ts)
const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });
const body = <T extends z.ZodType>(schema: T) => ({ required: true, content: { 'application/json': { schema } } });
const Err = z.object({ error: z.string() });
const Key = z.object({ key: z.string().openapi({ param: { name: 'key', in: 'path' } }) });
const Id = z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) });

const Template = z
  .object({
    key: z.string(),
    name: z.string(),
    description: z.string(),
    vars: z.record(z.string(), z.string()).openapi({ description: 'Placeholder → sample value used in previews and tests' }),
    doc: EmailDoc,
    defaults: EmailDoc,
    custom: z.boolean().openapi({ description: 'Edited (a saved row); false = the built-in default' }),
  })
  .openapi('AdminEmailTemplate');
const Rendered = z.object({ subject: z.string(), html: z.string() }).openapi('AdminEmailRendered');
const Sent = z.object({ to: z.string() }).openapi('AdminEmailTestSent');
const Audience = z.enum(['all', 'free', 'paid']);
const CampaignBody = EmailDoc.extend({ audience: Audience }).openapi('AdminCampaignBody');
const Campaign = CampaignBody.extend({
  id: z.string(),
  status: z.enum(['draft', 'sending', 'sent', 'failed']),
  recipients: z.number().int(),
  sent: z.number().int(),
  failed: z.number().int(),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
}).openapi('AdminCampaign');
const Overview = z
  .object({
    campaigns: z.array(Campaign),
    vars: z.record(z.string(), z.string()),
    audience: z.object({ all: z.number().int(), free: z.number().int(), paid: z.number().int() }).openapi({ description: 'Accounts each audience reaches now (product emails on)' }),
  })
  .openapi('AdminCampaigns');

async function template(key: EmailKey): Promise<z.infer<typeof Template>> {
  const t = TEMPLATES[key];
  const { custom, ...doc } = await docOf(key);
  return { key, name: t.name, description: t.description, vars: t.vars, doc, defaults: t.defaults, custom };
}
const campaign = (r: typeof emailCampaigns.$inferSelect): z.infer<typeof Campaign> => ({
  id: r.id, subject: r.subject, preheader: r.preheader, blocks: r.blocks, audience: r.audience, status: r.status,
  recipients: r.recipients, sent: r.sent, failed: r.failed, createdAt: r.createdAt.toISOString(), sentAt: r.sentAt?.toISOString() ?? null,
});
const me = (c: { get: (k: 'user') => { id: string; email: string; name: string } | null }) => c.get('user')!;
/** A campaign email as the owner would get it (their own unsubscribe link: clicking it in a test turns off their own product emails). */
const promoFor = async (doc: EmailDoc, u: { id: string; email: string; name: string }) => campaignEmail(await renderDoc(doc, 'promo'), u);

export function register(app: App) {
  // ---- Account emails ----
  app.openapi(
    createRoute({ ...route, method: 'get', path: '/api/admin/emails', summary: 'Account email templates with their current content', responses: { 200: json(z.array(Template), 'Templates') } }),
    async (c) => c.json(await Promise.all((Object.keys(TEMPLATES) as EmailKey[]).map(template)), 200),
  );
  app.openapi(
    createRoute({ ...route, method: 'put', path: '/api/admin/emails/{key}', summary: 'Save an account email (used from the next send)', request: { params: Key, body: body(EmailDoc) }, responses: { 200: json(Template, 'Saved'), 404: json(Err, 'Unknown template') } }),
    async (c) => {
      const { key } = c.req.valid('param');
      if (!isEmailKey(key)) return c.json({ error: 'Unknown template' }, 404);
      const row = { ...c.req.valid('json'), updatedBy: me(c).email.toLowerCase(), updatedAt: new Date() };
      await db.insert(emailTemplates).values({ key, ...row }).onConflictDoUpdate({ target: emailTemplates.key, set: row });
      return c.json(await template(key), 200);
    },
  );
  app.openapi(
    createRoute({ ...route, method: 'delete', path: '/api/admin/emails/{key}', summary: 'Back to the built-in default', request: { params: Key }, responses: { 200: json(Template, 'Reset'), 404: json(Err, 'Unknown template') } }),
    async (c) => {
      const { key } = c.req.valid('param');
      if (!isEmailKey(key)) return c.json({ error: 'Unknown template' }, 404);
      await db.delete(emailTemplates).where(eq(emailTemplates.key, key));
      return c.json(await template(key), 200);
    },
  );
  app.openapi(
    createRoute({ ...route, method: 'post', path: '/api/admin/emails/{key}/preview', summary: 'Render unsaved content with the sample values', request: { params: Key, body: body(EmailDoc) }, responses: { 200: json(Rendered, 'Rendered'), 404: json(Err, 'Unknown template') } }),
    async (c) => {
      const { key } = c.req.valid('param');
      if (!isEmailKey(key)) return c.json({ error: 'Unknown template' }, 404);
      const { subject, html } = await renderEmail(key, TEMPLATES[key].vars, c.req.valid('json'));
      return c.json({ subject, html }, 200);
    },
  );
  app.openapi(
    createRoute({ ...route, method: 'post', path: '/api/admin/emails/{key}/test', summary: 'Send unsaved content to your own address (sample values; the weekly email uses your own coach report when you have one)', request: { params: Key, body: body(EmailDoc) }, responses: { 200: json(Sent, 'Sent'), 404: json(Err, 'Unknown template'), 502: json(Err, 'The email provider refused it') } }),
    async (c) => {
      const { key } = c.req.valid('param');
      if (!isEmailKey(key)) return c.json({ error: 'Unknown template' }, 404);
      // the weekly email is built from your own latest coach report when you have one, as it would send on Monday
      const report = key === 'weekly-report' ? await latestReport(me(c).id) : null;
      const m = report ? await weeklyEmail(me(c), c.req.valid('json'), report) : await renderEmail(key, TEMPLATES[key].vars, c.req.valid('json'));
      const r = await sendEmail({ ...m, to: me(c).email, subject: `[Test] ${m.subject}` });
      return r.ok ? c.json({ to: me(c).email }, 200) : c.json({ error: `Could not send (${r.kind}).` }, 502);
    },
  );

  // ---- Brand and footer ----
  app.openapi(
    createRoute({ ...route, method: 'get', path: '/api/admin/email-settings', summary: 'Footer details every email shares', responses: { 200: json(EmailSettings, 'Settings') } }),
    async (c) => c.json(await getEmailSettings(), 200),
  );
  app.openapi(
    createRoute({ ...route, method: 'put', path: '/api/admin/email-settings', summary: 'Save the footer details', request: { body: body(EmailSettings) }, responses: { 200: json(EmailSettings, 'Saved') } }),
    async (c) => {
      const data = c.req.valid('json');
      await db.insert(emailSettings).values({ id: 'default', data }).onConflictDoUpdate({ target: emailSettings.id, set: { data, updatedAt: new Date() } });
      return c.json(await getEmailSettings(), 200);
    },
  );

  // ---- Campaigns ----
  app.openapi(
    createRoute({ ...route, method: 'get', path: '/api/admin/campaigns', summary: 'Promotional emails, newest first, and how many people each audience reaches', responses: { 200: json(Overview, 'Campaigns') } }),
    async (c) => {
      const [rows, all, free, paid] = await Promise.all([db.select().from(emailCampaigns).orderBy(desc(emailCampaigns.createdAt)).limit(100), audienceSize('all'), audienceSize('free'), audienceSize('paid')]);
      return c.json({ campaigns: rows.map(campaign), vars: CAMPAIGN_VARS, audience: { all, free, paid } }, 200);
    },
  );
  app.openapi(
    createRoute({ ...route, method: 'post', path: '/api/admin/campaigns', summary: 'New draft', request: { body: body(CampaignBody) }, responses: { 200: json(Campaign, 'Draft') } }),
    async (c) => {
      const [r] = await db.insert(emailCampaigns).values({ ...c.req.valid('json'), createdBy: me(c).email.toLowerCase() }).returning();
      return c.json(campaign(r!), 200);
    },
  );
  app.openapi(
    createRoute({ ...route, method: 'put', path: '/api/admin/campaigns/{id}', summary: 'Edit a draft', request: { params: Id, body: body(CampaignBody) }, responses: { 200: json(Campaign, 'Saved'), 409: json(Err, 'Already sent, or not found') } }),
    async (c) => {
      const [r] = await db.update(emailCampaigns).set({ ...c.req.valid('json'), updatedAt: new Date() }).where(sql`${emailCampaigns.id} = ${c.req.valid('param').id} and ${emailCampaigns.status} = 'draft'`).returning();
      return r ? c.json(campaign(r), 200) : c.json({ error: 'Only a draft can be edited.' }, 409);
    },
  );
  app.openapi(
    createRoute({ ...route, method: 'delete', path: '/api/admin/campaigns/{id}', summary: 'Delete a draft', request: { params: Id }, responses: { 200: json(z.object({ ok: z.boolean() }), 'Deleted'), 409: json(Err, 'Already sent, or not found') } }),
    async (c) => {
      const r = await db.delete(emailCampaigns).where(sql`${emailCampaigns.id} = ${c.req.valid('param').id} and ${emailCampaigns.status} = 'draft'`).returning({ id: emailCampaigns.id });
      return r.length ? c.json({ ok: true }, 200) : c.json({ error: 'Only a draft can be deleted.' }, 409);
    },
  );
  app.openapi(
    createRoute({ ...route, method: 'post', path: '/api/admin/campaigns/preview', summary: 'Render unsaved campaign content as you would get it', request: { body: body(EmailDoc) }, responses: { 200: json(Rendered, 'Rendered') } }),
    async (c) => {
      const { subject, html } = personalise(await renderDoc(c.req.valid('json'), 'promo'), { ...CAMPAIGN_VARS, unsubscribeUrl: unsubscribeUrl(me(c).id) });
      return c.json({ subject, html }, 200);
    },
  );
  app.openapi(
    createRoute({ ...route, method: 'post', path: '/api/admin/campaigns/test', summary: 'Send unsaved campaign content to your own address', request: { body: body(EmailDoc) }, responses: { 200: json(Sent, 'Sent'), 502: json(Err, 'The email provider refused it') } }),
    async (c) => {
      const m = await promoFor(c.req.valid('json'), me(c));
      const r = await sendEmail({ ...m, subject: `[Test] ${m.subject}` });
      return r.ok ? c.json({ to: me(c).email }, 200) : c.json({ error: `Could not send (${r.kind}).` }, 502);
    },
  );
  app.openapi(
    createRoute({ ...route, method: 'post', path: '/api/admin/campaigns/{id}/send', summary: 'Send a draft to its audience now (in the background; poll the list for progress)', request: { params: Id }, responses: { 200: json(Campaign, 'Sending'), 409: json(Err, 'Already sent, or not found') } }),
    async (c) => {
      const { id } = c.req.valid('param');
      if (!(await startCampaign(id))) return c.json({ error: 'Only a draft can be sent.' }, 409);
      const [r] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id));
      return c.json(campaign(r!), 200);
    },
  );
}
