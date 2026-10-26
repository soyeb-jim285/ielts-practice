import { render, toPlainText } from '@react-email/components';
import { eq } from 'drizzle-orm';
import { createElement } from 'react';
import { db } from './db/client';
import { emailSettings, emailTemplates } from './db/schema';
import { env } from './env';
import { DEFAULT_SETTINGS, EmailSettings, type EmailDoc } from './emails/blocks';
import { Email, type EmailKind } from './emails/Email';

/** Account emails (admin → Emails → Account emails edits them). `vars` are the placeholders each one fills, with the sample values previews use. */
type Template = { name: string; description: string; vars: Record<string, string>; defaults: EmailDoc };

export const TEMPLATES = {
  'verification-code': {
    name: 'Verification code',
    description: 'Sent on sign-up and when someone asks for a new code.',
    vars: { code: '482913', minutes: '10' },
    defaults: {
      subject: 'Your NextBand verification code',
      preheader: 'Your code is {{code}}. It expires in {{minutes}} minutes.',
      blocks: [
        { type: 'hero', eyebrow: 'Verify your email', title: 'Welcome to NextBand', subtitle: '', tone: 'brand' },
        { type: 'text', text: 'Enter this code in the app to confirm your email address:' },
        { type: 'code', value: '{{code}}' },
        { type: 'text', text: 'It expires in **{{minutes}} minutes**. If you did not sign up, you can ignore this email.' },
      ],
    },
  },
  'reset-code': {
    name: 'Password reset code',
    description: 'Sent from "Forgot password?".',
    vars: { code: '715204', minutes: '10' },
    defaults: {
      subject: 'Your NextBand password reset code',
      preheader: 'Your reset code is {{code}}.',
      blocks: [
        { type: 'hero', eyebrow: 'Security', title: 'Reset your password', subtitle: '', tone: 'ink' },
        { type: 'text', text: 'Enter this code to choose a new password:' },
        { type: 'code', value: '{{code}}' },
        { type: 'callout', tone: 'info', title: 'Did not ask for this?', text: 'You can ignore this email. Your password stays the same.' },
      ],
    },
  },
  'account-exists': {
    name: 'Account already exists',
    description: 'Someone signed up with the address of a verified account.',
    vars: {},
    defaults: {
      subject: 'You already have a NextBand account',
      preheader: 'Sign in with your password, or reset it.',
      blocks: [
        { type: 'hero', eyebrow: 'Your account', title: 'You already have an account', subtitle: '', tone: 'soft' },
        { type: 'text', text: 'Someone (hopefully you) tried to create a NextBand account with this email, but you already have one.\n\nSign in with your password, or use **Forgot password?** on the sign-in screen to get a reset code.' },
        { type: 'button', label: 'Sign in', url: '/login', variant: 'solid' },
        { type: 'text', text: 'If this was not you, you can ignore this email.' },
      ],
    },
  },
  'finish-setup': {
    name: 'Finish setting up',
    description: 'Sign-up on an address whose earlier, unverified sign-up is older than 10 minutes (sent instead of a code).',
    vars: {},
    defaults: {
      subject: 'Finish setting up your NextBand account',
      preheader: 'Set your password to finish signing up.',
      blocks: [
        { type: 'hero', eyebrow: 'Your account', title: 'Finish setting up your account', subtitle: '', tone: 'soft' },
        { type: 'text', text: 'Someone (hopefully you) tried to create a NextBand account with this email. An earlier sign-up with this address was never finished.\n\nTo finish, set your password with a reset code. That also confirms your email.' },
        { type: 'button', label: 'Set my password', url: '/forgot-password', variant: 'solid' },
        { type: 'text', text: 'If this was not you, you can ignore this email.' },
      ],
    },
  },
  'plan-granted': {
    name: 'Paid plan is on',
    description: 'Sent when you grant the paid plan on a user page with "Email them" ticked.',
    vars: { name: 'Ayesha', until: '31 December 2026' },
    defaults: {
      subject: 'Your NextBand paid plan is on',
      preheader: 'Unlimited practice until {{until}}.',
      blocks: [
        { type: 'hero', eyebrow: 'Paid plan', title: 'Your paid plan is on', subtitle: 'Active until {{until}}', tone: 'brand' },
        { type: 'text', text: 'Hi {{name}}, here is everything you now have:' },
        {
          type: 'details',
          title: 'Included',
          rows: [
            { label: 'Writing and speaking practice', value: 'Unlimited' },
            { label: 'Live examiner', value: '5 a day, 40 a month' },
            { label: 'Listening and Reading', value: 'Every test' },
          ],
        },
        { type: 'button', label: 'Start practising', url: '/', variant: 'solid' },
        { type: 'text', text: 'Good luck with your practice.' },
      ],
    },
  },
} satisfies Record<string, Template>;
export type EmailKey = keyof typeof TEMPLATES;
export const isEmailKey = (k: string): k is EmailKey => k in TEMPLATES;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** {{name}} → value; unknown placeholders stay as written. */
export const fill = (s: string, vars: Record<string, string>, escape = false) => s.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (k in vars ? (escape ? esc(vars[k]!) : vars[k]!) : m));

export const origin = () => env.WEB_ORIGIN.replace(/\/$/, '');

export async function getEmailSettings(): Promise<EmailSettings> {
  const [r] = await db.select().from(emailSettings).where(eq(emailSettings.id, 'default'));
  const p = EmailSettings.safeParse({ ...DEFAULT_SETTINGS, ...(r?.data ?? {}) });
  return p.success ? p.data : DEFAULT_SETTINGS;
}

/** Renders once with the placeholders in place, so a campaign renders one HTML and fills it per recipient. */
export async function renderDoc(doc: EmailDoc, kind: EmailKind, settings?: EmailSettings) {
  const html = await render(createElement(Email, { preheader: doc.preheader, blocks: doc.blocks, settings: settings ?? (await getEmailSettings()), origin: origin(), kind, unsubscribeUrl: '{{unsubscribeUrl}}' }));
  return { subject: doc.subject, html };
}

/** Per recipient: values go into the HTML escaped, into the subject as plain text. */
export function personalise(r: { subject: string; html: string }, vars: Record<string, string>) {
  const html = fill(r.html, vars, true);
  return { subject: fill(r.subject, vars), html, text: toPlainText(html) };
}

/** The saved copy of an account email, or its default. */
export async function docOf(key: EmailKey): Promise<EmailDoc & { custom: boolean }> {
  const [r] = await db.select().from(emailTemplates).where(eq(emailTemplates.key, key));
  return r ? { subject: r.subject, preheader: r.preheader, blocks: r.blocks, custom: true } : { ...TEMPLATES[key].defaults, custom: false };
}

/** Ready to send. `doc` previews unsaved edits; otherwise the saved copy (or the default). */
export async function renderEmail(key: EmailKey, vars: Record<string, string>, doc?: EmailDoc) {
  return personalise(await renderDoc(doc ?? (await docOf(key)), 'account'), vars);
}
