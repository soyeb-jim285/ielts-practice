import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { anonymous, bearer, emailOTP } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { db } from './db/client';
import * as schema from './db/schema';
import { env, IS_TEST } from './env';
import { sendOtpEmail } from './auth-email';
import { sendEmail } from './email';
import { ApiError } from './errors';
import { linkGuest } from './link';
import { replayPrefix } from './replay';
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
        const replays = await db.select().from(schema.replaySessions).where(eq(schema.replaySessions.userId, u.id));
        for (const r of replays) await storage.deletePrefix(replayPrefix(r));
        await db.delete(schema.replaySessions).where(eq(schema.replaySessions.userId, u.id));
      },
    },
  },
  plugins: [
    bearer(),
    // Guests: POST /api/auth/sign-in/anonymous on the first test start. On sign-up/sign-in their attempts and used quota move to the real account (src/link.ts).
    anonymous({ emailDomainName: 'guest.invalid', onLinkAccount: ({ anonymousUser, newUser }) => linkGuest(anonymousUser.user.id, newUser.user.id) }),
    // Codes for email verification (replaces the link) and password reset. Better Auth rate-limits these endpoints to 3 per minute per IP (production).
    emailOTP({
      sendVerificationOTP: sendOtpEmail,
      overrideDefaultEmailVerification: true,
      otpLength: 6,
      expiresIn: 10 * 60,
      allowedAttempts: 5, // wrong guesses before the code is burned: 5 in 1,000,000
      storeOTP: 'encrypted',
      resendStrategy: 'reuse',
      disableSignUp: true, // no passwordless sign-up/sign-in; generic success for unknown addresses
    }),
  ],
});

/** The app owner: always an owner (Cambridge access, no test limits, server keys for live), whatever CAMBRIDGE_ALLOWED_EMAILS says. */
export const OWNER_EMAILS = ['soyeb.jim@gmail.com'];

// Emails granted Cambridge access from the admin UI (cambridge_access table). isCambridgeAllowed stays synchronous, so the table is cached here.
// ponytail: per-process; boot loads it and index.ts reloads every minute, so another process's toggle is honoured within a minute.
let granted = new Set<string>();
export async function loadCambridgeGrants() {
  granted = new Set((await db.select({ email: schema.cambridgeAccess.email }).from(schema.cambridgeAccess)).map((r) => r.email));
}
export const setCambridgeGrant = (email: string, on: boolean) => void (on ? granted.add(email.toLowerCase()) : granted.delete(email.toLowerCase()));

export type CambridgeSource = 'owner' | 'server-config' | 'granted' | null;
export const cambridgeSource = (email: string): CambridgeSource => {
  const e = email.toLowerCase();
  return OWNER_EMAILS.includes(e) ? 'owner' : env.CAMBRIDGE_ALLOWED_EMAILS.includes(e) ? 'server-config' : granted.has(e) ? 'granted' : null;
};

/** Cambridge content is licensed to specific owners: allow-listed (hard-coded owner, env list or admin grant) AND verified email (prevents sign-up spoofing).
 *  Also the "owner" flag in quota.ts: exempt from test limits. */
export const isCambridgeAllowed = (u: { email: string; emailVerified: boolean } | null | undefined) => !!u && u.emailVerified && cambridgeSource(u.email) !== null;

/** The signed-in, verified, non-guest owner (docs/admin/DESIGN.md). */
export const isOwner = (u: { email: string; emailVerified: boolean; isAnonymous?: boolean } | null | undefined) =>
  !!u && !u.isAnonymous && u.emailVerified && OWNER_EMAILS.includes(u.email.toLowerCase());

/** Admin endpoints: 404 for everyone but the owner, so the area is invisible. */
export const requireOwner = createMiddleware<AppEnv>(async (c, next) => {
  if (!isOwner(c.get('user'))) throw new HTTPException(404, { message: 'Not found' });
  await next();
});

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
  const user = s ? { id: s.user.id, email: s.user.email, name: s.user.name, emailVerified: s.user.emailVerified, isAnonymous: !!s.user.isAnonymous } : null;
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

/** Personal pages (history, mistakes, review, settings, keys): a guest has a session but no account yet. */
export const requireAccount = createMiddleware<AppEnv>(async (c, next) => {
  const u = c.get('user');
  if (!u) throw new HTTPException(401, { message: 'Sign in required' });
  if (u.isAnonymous) throw new ApiError(403, { error: 'Create an account to use this.', code: 'account_required' });
  await next();
});

/** Use inside handlers after requireUser. */
export const currentUser = (c: { get: (k: 'user') => AppEnv['Variables']['user'] }) => {
  const u = c.get('user');
  if (!u) throw new HTTPException(401, { message: 'Sign in required' });
  return u;
};
