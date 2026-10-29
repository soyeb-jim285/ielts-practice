import { render, toPlainText } from '@react-email/components';
import { eq } from 'drizzle-orm';
import { createElement } from 'react';
import { db } from './db/client';
import { emailSettings, emailTemplates } from './db/schema';
import { env } from './env';
import { DEFAULT_SETTINGS, EmailSettings, type EmailDoc } from './emails/blocks';
import { Email, type EmailKind } from './emails/Email';

/** Account emails (admin → Emails → Account emails edits them). `vars` are the placeholders each one fills, with the sample values previews use.
 *  `reason` is the footer line saying why this email arrived. */
type Template = { name: string; description: string; reason: string; kind?: 'promo'; vars: Record<string, string>; defaults: EmailDoc };

export const TEMPLATES = {
  'verification-code': {
    name: 'Verification code',
    description: 'Sent on sign-up and when someone asks for a new code.',
    reason: 'You got this because this email was used to sign up for NextBand.',
    vars: { code: '482913', minutes: '10' },
    defaults: {
      subject: 'Your NextBand code: {{code}}',
      preheader: 'Enter it in the app to confirm your email. It works for {{minutes}} minutes.',
      blocks: [
        { type: 'hero', eyebrow: 'Confirm your email', title: 'Welcome to NextBand', subtitle: '', tone: 'brand' },
        { type: 'text', text: 'Here is your code. Enter it in the app to confirm your email:' },
        { type: 'code', value: '{{code}}' },
        { type: 'text', text: 'It works for **{{minutes}} minutes**. If you did not sign up, ignore this email and nothing will happen.' },
      ],
    },
  },
  'reset-code': {
    name: 'Password reset code',
    description: 'Sent from "Forgot password?".',
    reason: 'You got this because someone asked to reset the password for this account.',
    vars: { code: '715204', minutes: '10' },
    defaults: {
      subject: 'Reset your NextBand password', // no code in the subject: lock-screen previews would expose a reset credential
      preheader: 'Use it to choose a new password. It works for {{minutes}} minutes.',
      blocks: [
        { type: 'hero', eyebrow: 'Password reset', title: 'Choose a new password', subtitle: '', tone: 'ink' },
        { type: 'text', text: 'Enter this code in the app, then pick your new password:' },
        { type: 'code', value: '{{code}}' },
        { type: 'text', text: 'It works for **{{minutes}} minutes**.' },
        { type: 'callout', tone: 'info', title: 'Not you?', text: 'Ignore this email. Your password stays the same.' },
      ],
    },
  },
  'account-exists': {
    name: 'Account already exists',
    description: 'Someone signed up with the address of a verified account.',
    reason: 'You got this because someone tried to sign up for NextBand with this email.',
    vars: {},
    defaults: {
      subject: 'You already have a NextBand account',
      preheader: 'Sign in with your password, or reset it if you forgot.',
      blocks: [
        { type: 'hero', eyebrow: 'Your account', title: 'You already have an account', subtitle: '', tone: 'soft' },
        { type: 'text', text: 'Someone just tried to sign up with this email, but it already has a NextBand account.\n\nIf that was you, sign in with your password. Forgot it? Tap **Forgot password?** on the sign-in screen and we will send you a code.' },
        { type: 'button', label: 'Sign in', url: '/login', variant: 'solid' },
        { type: 'text', text: 'If it was not you, ignore this email. Your account is safe.' },
      ],
    },
  },
  'finish-setup': {
    name: 'Finish setting up',
    description: 'Sign-up on an address whose earlier, unverified sign-up is older than 10 minutes (sent instead of a code).',
    reason: 'You got this because someone tried to sign up for NextBand with this email.',
    vars: {},
    defaults: {
      subject: 'Finish setting up your NextBand account',
      preheader: 'Set a password to finish signing up.',
      blocks: [
        { type: 'hero', eyebrow: 'Your account', title: 'Finish setting up', subtitle: '', tone: 'soft' },
        { type: 'text', text: 'You started signing up with this email earlier but did not finish.\n\nSet a password to finish. We will send a code to this email, which also confirms it is yours.' },
        { type: 'button', label: 'Set my password', url: '/forgot-password', variant: 'solid' },
        { type: 'text', text: 'If you did not sign up, ignore this email.' },
      ],
    },
  },
  'plan-granted': {
    name: 'Paid plan is on',
    description: 'Sent when a PayStation payment is confirmed, or when you grant the paid plan on a user page with "Email them" ticked.',
    reason: 'You got this because the paid plan was turned on for your account.',
    vars: { name: 'Ayesha', until: '31 December 2026' },
    defaults: {
      subject: 'Your NextBand paid plan is on',
      preheader: 'Unlimited practice until {{until}}.',
      blocks: [
        { type: 'hero', eyebrow: 'Paid plan', title: 'Your paid plan is on', subtitle: 'Active until {{until}}', tone: 'brand' },
        { type: 'text', text: 'Hi {{name}}, here is what you get now:' },
        {
          type: 'details',
          title: 'Included',
          rows: [
            { label: 'Writing and Speaking practice', value: 'Unlimited' },
            { label: 'Live examiner', value: '5 a day, 40 a month' },
            { label: 'Listening and Reading', value: 'Every test' },
          ],
        },
        { type: 'button', label: 'Start practising', url: '/', variant: 'solid' },
        { type: 'text', text: 'Happy practising!' },
      ],
    },
  },
  'plan-ending': {
    name: 'Paid plan ending soon',
    description: 'Sent 7 days, 3 days and 1 day before a paid plan ends. A new end date starts the reminders again.',
    reason: 'You got this because your paid plan is ending soon.',
    vars: { name: 'Ayesha', when: 'in 3 days', until: '31 December 2026' },
    defaults: {
      subject: 'Your NextBand paid plan ends {{when}}',
      preheader: 'Active until {{until}}.',
      blocks: [
        { type: 'hero', eyebrow: 'Paid plan', title: 'Your paid plan ends {{when}}', subtitle: 'Active until {{until}}', tone: 'brand' },
        { type: 'text', text: 'Hi {{name}}, after that you go back to the free limits. Plans do not renew by themselves: buy another month or three to keep unlimited practice. The new time is added to the end, so you lose nothing by renewing early.' },
        { type: 'button', label: 'Renew from ৳499', url: '/pricing', variant: 'solid' },
      ],
    },
  },
  'weekly-report': {
    name: 'Weekly coach report',
    description: 'Sent on Monday morning (from 9am local time) to students who practised that week and have news and tips on. The headline is the win line when there is one; stats are added when it sends.',
    reason: 'You got this because you have a NextBand account with news and tips turned on.',
    kind: 'promo',
    vars: { firstName: 'Ayesha', headline: 'Listening is at your target' },
    defaults: {
      // the headline is a whole sentence: it reads as the inbox preview, the subject stays short and says what the email is
      subject: '{{firstName}}, your week on NextBand',
      preheader: '{{headline}}',
      blocks: [
        { type: 'hero', eyebrow: 'Your week', title: '{{headline}}', subtitle: '', tone: 'brand' },
        { type: 'text', text: "Hi {{firstName}}, here's your week." },
        { type: 'button', label: 'Open your coach', url: '/coach', variant: 'solid' },
      ],
    },
  },
} satisfies Record<string, Template>;
const PROMO_REASON = 'You got this because you have a NextBand account with news and tips turned on.';
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
export async function renderDoc(doc: EmailDoc, kind: EmailKind, reason = PROMO_REASON) {
  const html = await render(createElement(Email, { preheader: doc.preheader, blocks: doc.blocks, settings: await getEmailSettings(), origin: origin(), kind, reason, unsubscribeUrl: '{{unsubscribeUrl}}' }));
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
  const t: Template = TEMPLATES[key];
  const kind = t.kind ?? 'account';
  return personalise(await renderDoc(doc ?? (await docOf(key)), kind, t.reason), kind === 'promo' ? { unsubscribeUrl: '#', ...vars } : vars); // '#': previews have no recipient
}
