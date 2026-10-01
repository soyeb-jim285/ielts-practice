import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { meQuery, queryClient } from './query';

/** Better Auth error as the pages read it (the same fields its own client returns). */
export type AuthError = { status: number; code?: string; message?: string };
type Result = { error: AuthError | null; data: { user?: { id: string }; token?: string | null } | null };

/**
 * Thin client for the few Better Auth endpoints the pages use: plain fetch + cookies. The official client (+ better-fetch, nanostores) was a
 * 12 KB gzip chunk on /login and on every authed page (AppShell signs out through it); we use no session hook or plugin from it.
 */
async function post(path: string, body: object = {}): Promise<Result> {
  try {
    const r = await fetch(`/api/auth${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    return r.ok ? { data: j, error: null } : { data: null, error: { status: r.status, code: j?.code, message: j?.message } };
  } catch {
    return { data: null, error: { status: 0, message: 'Network error. Check your connection and try again.' } };
  }
}

export const authClient = {
  signIn: { email: (b: { email: string; password: string }) => post('/sign-in/email', b) },
  signUp: { email: (b: { name: string; email: string; password: string; callbackURL: string }) => post('/sign-up/email', b) },
  signOut: () => post('/sign-out'),
  resetPassword: (b: { newPassword: string; token: string }) => post('/reset-password', b),
  /** 6-digit email codes (Better Auth emailOTP). `send` answers success for unknown addresses too. */
  emailOtp: {
    send: (b: { email: string; type: 'email-verification' | 'forget-password' }) => post('/email-otp/send-verification-otp', b),
    verifyEmail: (b: { email: string; otp: string }) => post('/email-otp/verify-email', b),
    resetPassword: (b: { email: string; otp: string; password: string }) => post('/email-otp/reset-password', b),
  },
  deleteUser: (b: { password: string }) => post('/delete-user', b),
};

/** Reader-friendly text for a failed code check or send. */
export function otpError(e: AuthError) {
  if (e.code === 'INVALID_OTP') return 'That code isn’t right. Check it and try again.';
  if (e.code === 'OTP_EXPIRED') return 'That code has expired. Request a new one.';
  if (e.code === 'TOO_MANY_ATTEMPTS') return 'Too many wrong tries. Request a new code.';
  if (e.status === 429) return 'Too many requests. Wait a minute, then try again.';
  return e.message || 'Something went wrong. Try again.';
}

/** Only same-app paths: blocks open redirects like `//evil.com`. */
export const safeRedirect = (to: unknown) => (typeof to === 'string' && to.startsWith('/') && !to.startsWith('//') ? to : '/');

export async function signOut() {
  await authClient.signOut();
  queryClient.clear();
}

/** beforeLoad for signed-out pages: bounce signed-in users to the dashboard. */
export async function redirectIfSignedIn({ context }: { context: { queryClient: QueryClient } }) {
  const me = await context.queryClient.fetchQuery(meQuery).catch(() => null);
  if (me) throw redirect({ to: '/' });
}
