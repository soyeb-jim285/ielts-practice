import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, emailOTP } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { db } from './db/client';
import * as schema from './db/schema';
import { env, IS_TEST } from './env';
import { sendEmail } from './email';
import { storage } from './storage';
import type { AppEnv } from './types';

const ORIGINS = [env.WEB_ORIGIN, env.BETTER_AUTH_URL, ...env.EXTRA_ORIGINS];

/** Email links open in the browser, so they point at the web origin the user signed up from (the Origin header when trusted, else WEB_ORIGIN), not at the API host:
 *  the web dev server proxies /api and production serves both from one origin. A relative callbackURL is made absolute against the same origin. */
export function webLink(url: string, request?: Request) {
  const o = request?.headers.get('origin');
  const base = new URL(o && ORIGINS.includes(o) ? o : env.WEB_ORIGIN);
  const u = new URL(url);
  u.protocol = base.protocol;
  u.host = base.host;
  for (const k of ['callbackURL', 'redirectTo']) {
    const v = u.searchParams.get(k);
    if (v?.startsWith('/')) u.searchParams.set(k, new URL(v, base).toString());
  }
  return u.toString();
}

const OTP_MINUTES = 10;
const OTP_MAIL = {
  'email-verification': { subject: 'Your IELTS Practice verification code', lead: 'Welcome to IELTS Practice! Enter this code to verify your email:' },
  'forget-password': { subject: 'Your IELTS Practice password reset code', lead: 'Enter this code to reset your password:' },
} as const;
// ponytail: per-process; one OTP email per address+purpose every 30 s. The code is reused while valid (resendStrategy), so a skipped resend loses nothing.
const OTP_COOLDOWN_MS = 30_000;
const otpSentAt = new Map<string, number>();

/** Sends the 6-digit code. Callers get the same response whether or not the address has an account (Better Auth only calls this for real users). */
export async function sendOtpEmail({ email, otp, type }: { email: string; otp: string; type: string }) {
  const mail = OTP_MAIL[type as keyof typeof OTP_MAIL];
  if (!mail) return; // sign-in codes are not offered: passwords only
  const key = `${type}:${email}`;
  const now = Date.now();
  if (now - (otpSentAt.get(key) ?? 0) < OTP_COOLDOWN_MS) return;
  if (otpSentAt.size > 5000) otpSentAt.clear();
  otpSentAt.set(key, now);
  await sendEmail({
    to: email,
    subject: mail.subject,
    html: `<p>${mail.lead}</p><p style="font-size:28px;font-weight:600;letter-spacing:6px;font-family:monospace">${otp}</p><p>It expires in ${OTP_MINUTES} minutes. If you didn't ask for it, you can ignore this email.</p>`,
  });
}

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  trustedOrigins: ORIGINS,
  // Web: session + user come from a signed cookie for 5 min instead of two DB lookups per request.
  session: { cookieCache: { enabled: true, maxAge: 300 } },
  // Behind the Cloudflare Tunnel the client address is cf-connecting-ip; Better Auth's built-in limiter (on in production) keys on it.
  advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'] } },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: env.NODE_ENV === 'production',
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url: api }, request) => {
      const url = webLink(api, request);
      await sendEmail({ to: user.email, subject: 'Reset your IELTS Practice password', html: `<p>Reset your password:</p><p><a href="${url}">${url}</a></p>` });
    },
  },
  // Verification uses the OTP plugin's code (see below). Links already emailed still verify through GET /api/auth/verify-email.
  emailVerification: { sendOnSignUp: !IS_TEST, autoSignInAfterVerification: true },
  user: {
    deleteUser: {
      enabled: true,
      // The DB cascades attempts and sessions; voice recordings in R2 must go too.
      beforeDelete: async (u) => {
        const sessions = await db.select({ id: schema.liveSessions.id }).from(schema.liveSessions).where(eq(schema.liveSessions.userId, u.id));
        await storage.deletePrefix(`audio/${u.id}/`);
        for (const { id } of sessions) await storage.deletePrefix(`live/${id}/`);
      },
    },
  },
  plugins: [
    bearer(),
    // Codes for email verification (replaces the link) and password reset. Better Auth rate-limits these endpoints to 3 per minute per IP (production).
    emailOTP({
      sendVerificationOTP: sendOtpEmail,
      overrideDefaultEmailVerification: true,
      otpLength: 6,
      expiresIn: OTP_MINUTES * 60,
      allowedAttempts: 5, // wrong guesses before the code is burned: 5 in 1,000,000
      storeOTP: 'encrypted',
      resendStrategy: 'reuse',
      disableSignUp: true, // no passwordless sign-up/sign-in; generic success for unknown addresses
    }),
  ],
});

/** Cambridge content is licensed to specific owners: allow-listed AND verified email (prevents sign-up spoofing). */
export const isCambridgeAllowed = (u: { email: string; emailVerified: boolean } | null | undefined) =>
  !!u && u.emailVerified && env.CAMBRIDGE_ALLOWED_EMAILS.includes(u.email.toLowerCase());

// Bearer (iOS) has no cookie cache: keep token → user for 30 s.
// ponytail: per-process, cleared wholesale on any session-ending auth call (see app.ts); other processes may honour a revoked token for up to 30 s.
const BEARER_TTL_MS = 30_000;
const bearerCache = new Map<string, { at: number; user: AppEnv['Variables']['user'] }>();
export const clearBearerCache = () => bearerCache.clear();

export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const bearer = c.req.header('authorization');
  const hit = bearer ? bearerCache.get(bearer) : undefined;
  if (hit && Date.now() - hit.at < BEARER_TTL_MS) {
    c.set('user', hit.user);
    return next();
  }
  const s = await auth.api.getSession({ headers: c.req.raw.headers });
  const user = s ? { id: s.user.id, email: s.user.email, name: s.user.name, emailVerified: s.user.emailVerified } : null;
  if (bearer && user) {
    if (bearerCache.size >= 5000) bearerCache.clear();
    bearerCache.set(bearer, { at: Date.now(), user });
  }
  c.set('user', user);
  await next();
});

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('user')) throw new HTTPException(401, { message: 'Sign in required' });
  await next();
});

/** Use inside handlers after requireUser. */
export const currentUser = (c: { get: (k: 'user') => AppEnv['Variables']['user'] }) => {
  const u = c.get('user');
  if (!u) throw new HTTPException(401, { message: 'Sign in required' });
  return u;
};
