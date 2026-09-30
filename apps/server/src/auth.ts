import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { db } from './db/client';
import * as schema from './db/schema';
import { env, IS_TEST } from './env';
import { sendEmail } from './email';
import type { AppEnv } from './types';

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  trustedOrigins: [env.WEB_ORIGIN, env.BETTER_AUTH_URL],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: env.NODE_ENV === 'production' && !!env.RESEND_API_KEY,
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
  user: { deleteUser: { enabled: true } },
  plugins: [bearer()],
});

export const isCambridgeAllowed = (email: string | undefined | null) =>
  !!email && env.CAMBRIDGE_ALLOWED_EMAILS.includes(email.toLowerCase());

export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const s = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set('user', s ? { id: s.user.id, email: s.user.email, name: s.user.name } : null);
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
