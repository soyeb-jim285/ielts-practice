import { z } from '@hono/zod-openapi';

/** Email content is a list of blocks (admin → Emails edits them). Text fields are Markdown (tables included) and may hold {{placeholders}},
 *  filled per recipient after rendering, HTML-escaped. Button and image URLs may be app paths ('/settings'), resolved against the site. */
const s = (max: number) => z.string().max(max);
const url = s(500);

export const Block = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('hero'), eyebrow: s(80), title: s(200), subtitle: s(200), tone: z.enum(['brand', 'ink', 'soft']) }),
    z.object({ type: z.literal('text'), text: s(8000) }),
    z.object({ type: z.literal('button'), label: s(60), url, variant: z.enum(['solid', 'outline']) }),
    z.object({ type: z.literal('code'), value: s(40) }),
    z.object({ type: z.literal('details'), title: s(120), rows: z.array(z.object({ label: s(80), value: s(200) })).max(20) }),
    z.object({ type: z.literal('stats'), items: z.array(z.object({ value: s(30), label: s(60), change: s(20), trend: z.enum(['up', 'down', 'none']) })).max(6) }),
    z.object({ type: z.literal('callout'), tone: z.enum(['info', 'good', 'warn']), title: s(120), text: s(2000) }),
    z.object({ type: z.literal('image'), src: url, alt: s(200), href: url }),
    z.object({ type: z.literal('divider') }),
  ])
  .openapi('EmailBlock');
export type Block = z.infer<typeof Block>;

export const EmailDoc = z
  .object({
    subject: z.string().trim().min(1).max(200),
    preheader: s(200).openapi({ description: 'The grey line inboxes show after the subject' }),
    blocks: z.array(Block).min(1).max(40),
  })
  .openapi('EmailDoc');
export type EmailDoc = z.infer<typeof EmailDoc>;

/** Footer and links shared by every email (admin → Emails → Brand). A postal address is required by anti-spam law for promotional emails. */
export const EmailSettings = z
  .object({
    company: s(80),
    address: s(300),
    supportEmail: s(200),
    social: z.object({ facebook: url, instagram: url, youtube: url, x: url, tiktok: url }),
  })
  .openapi('EmailSettings');
export type EmailSettings = z.infer<typeof EmailSettings>;

export const DEFAULT_SETTINGS: EmailSettings = { company: 'NextBand', address: '', supportEmail: '', social: { facebook: '', instagram: '', youtube: '', x: '', tiktok: '' } };
