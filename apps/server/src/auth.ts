import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { db } from './db/client';
import * as schema from './db/schema';
import { env, IS_TEST } from './env';
import { sendEmail } from './email';
import { storage } from './storage';
import type { AppEnv } from './types';

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  trustedOrigins: [env.WEB_ORIGIN, env.BETTER_AUTH_URL],
  // Web: session + user come from a signed cookie for 5 min instead of two DB lookups per request.
  session: { cookieCache: { enabled: true, maxAge: 300 } },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: env.NODE_ENV === 'production',
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({ to: user.email, subject: 'Reset your IELTS Practice password', html: `<p>Reset your password:</p><p><a href="${url}">${url}</a></p>` });
    },
  },
  emailVerification: {
    sendOnSignUp: !IS_TEST,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({ to: user.email, subject: 'Verify your email', html: `<p>Welcome to IELTS Practice!</p><p><a href="${url}">Verify your email</a></p>` });
    },
  },
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
  plugins: [bearer()],
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
