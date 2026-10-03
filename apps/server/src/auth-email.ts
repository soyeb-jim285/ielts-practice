import { and, count, desc, eq, gt, gte, sql } from 'drizzle-orm';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from './db/client';
import { emailLog, user } from './db/schema';
import { env } from './env';
import { sendEmail, type ErrorKind } from './email';

export type Purpose = 'email-verification' | 'forget-password';
export const COOLDOWN_S = 30; // one code email per address+purpose; the code itself is reused while valid, so a skipped resend loses nothing
const OTP_MINUTES = 10;
const MAIL = {
  'email-verification': { subject: 'Your IELTS Practice verification code', lead: 'Welcome to IELTS Practice! Enter this code to verify your email:' },
  'forget-password': { subject: 'Your IELTS Practice password reset code', lead: 'Enter this code to reset your password:' },
} as const;
export const isPurpose = (p: unknown): p is Purpose => p === 'email-verification' || p === 'forget-password';

/** Takes the cooldown slot for this address+purpose, atomically (an advisory lock serialises concurrent requests, so N at once yield one slot and N-1 skips).
 *  Writes the row either way: 'sent' (attempts 0 until the send finishes) or 'skipped_cooldown'. Returns the row id when the caller may send, else null.
 *  Unknown addresses go through the same function (finishRequest), so real and unknown addresses leave identical rows. */
async function claim(email: string, purpose: Purpose, userId: string | null): Promise<string | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${purpose}:${email}`}, 0))`);
    const recent = await tx.select({ id: emailLog.id }).from(emailLog)
      .where(and(eq(emailLog.email, email), eq(emailLog.purpose, purpose), eq(emailLog.status, 'sent'), gt(emailLog.createdAt, sql`now() - make_interval(secs => ${COOLDOWN_S})`))).limit(1);
    const [row] = await tx.insert(emailLog).values({ userId, email, purpose, status: recent.length ? 'skipped_cooldown' : 'sent', attempts: 0 }).returning({ id: emailLog.id });
    return recent.length ? null : row!.id;
  });
}

const sends = new Set<Promise<unknown>>();
/** Resolves when every background send has finished (tests; also lets a shutdown drain). */
export const sendsIdle = () => Promise.all([...sends]);

/** Better Auth's code hook. Claims the cooldown slot, then sends in the BACKGROUND with retries (so a real address answers as fast as an unknown one), and records the outcome on the claimed row:
 *  attempts/providerId on success, status 'failed' + a short error kind otherwise (which also frees the slot, so an immediate resend goes through).
 *  Never throws; GET /api/auth-email/status is how the user learns the outcome. */
export async function sendOtpEmail({ email: raw, otp, type }: { email: string; otp: string; type: string }) {
  if (!isPurpose(type)) return; // sign-in codes are not offered: passwords only
  const email = raw.toLowerCase();
  const id = await claim(email, type, null); // same work as an unknown address's stand-in claim (finishRequest): no user lookup before the response
  if (!id) return;
  const mail = MAIL[type];
  const p = (async () => {
    const r = await sendEmail({
      to: email,
      subject: mail.subject,
      html: `<p>${mail.lead}</p><p style="font-size:28px;font-weight:600;letter-spacing:6px;font-family:monospace">${otp}</p><p>It expires in ${OTP_MINUTES} minutes. If you didn't ask for it, you can ignore this email.</p>`,
    });
    const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
    await db.update(emailLog).set({ userId: u?.id ?? null, ...(r.ok ? { providerId: r.id, attempts: r.attempts } : { status: 'failed', error: r.kind, attempts: r.attempts }) }).where(eq(emailLog.id, id));
  })().catch((e) => console.error('[email] send/log failed', e instanceof Error ? e.message : e));
  sends.add(p);
  void p.finally(() => sends.delete(p));
}

export const maskEmail = (e: string) => {
  const [l = '', d = ''] = e.split('@');
  return `${l.slice(0, 1)}•••@${d}`;
};

// Anti-enumeration. The status is only answered to whoever made the request: every call to a code-sending endpoint (real address or not) gets a signed token in the
// X-Email-Status-Token header, and the status endpoint reads nothing but that token. Better Auth sends nothing for unknown addresses, so right after the call we write the
// row a real send would have (same cooldown rule: 'sent', or 'skipped_cooldown' inside the window). Real and unknown addresses are then indistinguishable; only a genuine
// failure differs, and only the holder of the token sees it. Without a valid token the answer is the same generic "none" for every address.
export const STATUS_HEADER = 'x-email-status-token';
const TOKEN_TTL_MS = 15 * 60_000;
const sign = (b: string) => createHmac('sha256', env.BETTER_AUTH_SECRET).update(`email-status:${b}`).digest('base64url');
type Asked = { email: string; purpose: Purpose };
const mkToken = (a: Asked) => {
  const b = Buffer.from(JSON.stringify({ e: a.email.toLowerCase(), p: a.purpose, t: Date.now() })).toString('base64url');
  return `${b}.${sign(b)}`;
};
function readToken(tok: string | undefined | null): (Asked & { at: number }) | null {
  const [b = '', sig = ''] = (tok ?? '').split('.');
  const want = Buffer.from(sign(b));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const j = JSON.parse(Buffer.from(b, 'base64url').toString()) as { e: string; p: unknown; t: number };
    return isPurpose(j.p) && Date.now() - j.t < TOKEN_TTL_MS ? { email: j.e, purpose: j.p, at: j.t } : null;
  } catch {
    return null;
  }
}

const countRows = async (a: Asked) =>
  (await db.select({ n: count() }).from(emailLog).where(and(eq(emailLog.email, a.email.toLowerCase()), eq(emailLog.purpose, a.purpose))))[0]!.n;
export const countBefore = countRows;

/** Call after Better Auth handled a code request: backfills the row an unknown address never got, and attaches the status token. */
export async function finishRequest(a: Asked, before: number, res: Response) {
  const email = a.email.toLowerCase();
  if ((await countRows(a)) === before) await claim(email, a.purpose, null); // unknown address: the row a real one would have left
  const out = new Response(res.body, res);
  out.headers.set(STATUS_HEADER, mkToken(a));
  return out;
}

export type EmailStatus = {
  status: 'sent' | 'failed' | 'none';
  sentAt: string | null;
  maskedEmail: string | null;
  /** Seconds until another code email may be sent (0 when now). */
  resendAvailableIn: number;
  /** A resend was skipped because a code was sent a moment ago: it is still valid, check spam. */
  alreadySent: boolean;
  error: ErrorKind | null;
};

export async function emailStatus(token: string | undefined | null): Promise<EmailStatus> {
  const none: EmailStatus = { status: 'none', sentAt: null, maskedEmail: null, resendAvailableIn: 0, alreadySent: false, error: null };
  const t = readToken(token);
  if (!t) return none;
  const left = (d: Date) => Math.max(0, Math.ceil(COOLDOWN_S - (Date.now() - d.getTime()) / 1000));
  const out = { ...none, maskedEmail: maskEmail(t.email) };
  // Only rows from the holder's own request (and the cooldown window before it, so a skipped repeat still finds the send it was skipped for).
  const rows = await db.select().from(emailLog)
    .where(and(eq(emailLog.email, t.email), eq(emailLog.purpose, t.purpose), gte(emailLog.createdAt, new Date(t.at - COOLDOWN_S * 1000)))).orderBy(desc(emailLog.createdAt)).limit(5);
  const last = rows.find((r) => r.status !== 'skipped_cooldown');
  if (!last) return out;
  // A real failure would show only for real accounts. While the provider is failing for anyone, a still-unfinished row (which an unknown address never finishes) reads as failed too.
  let failure = last.status === 'failed' ? last.error : null;
  if (!failure && last.attempts === 0) {
    const [g] = await db.select({ error: emailLog.error }).from(emailLog).where(and(eq(emailLog.status, 'failed'), gt(emailLog.createdAt, sql`now() - interval '60 seconds'`))).orderBy(desc(emailLog.createdAt)).limit(1);
    failure = g?.error ?? null;
  }
  if (failure) return { ...out, status: 'failed', error: failure as ErrorKind };
  return { ...out, status: 'sent', sentAt: last.createdAt.toISOString(), resendAvailableIn: left(last.createdAt), alreadySent: rows.some((r) => r.status === 'skipped_cooldown' && r.createdAt > last.createdAt) };
}
