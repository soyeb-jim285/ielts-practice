import { Resend } from 'resend';
import { env } from './env';

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export async function sendEmail(o: { to: string; subject: string; html: string }) {
  if (!resend) {
    console.log(`[email:dev] to=${o.to} subject="${o.subject}"\n${o.html}`);
    return;
  }
  const { error } = await resend.emails.send({ from: env.EMAIL_FROM, ...o });
  if (error) console.error('[email] send failed', error);
}
