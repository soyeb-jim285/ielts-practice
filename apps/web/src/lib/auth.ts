import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { ApiError, type Me } from './api';
import { isAccount, meQuery, queryClient, useMe } from './query';

export type EmailStatus = { status: 'sent' | 'failed' | 'none'; sentAt: string | null; maskedEmail: string | null; resendAvailableIn: number; alreadySent: boolean; error: 'rate_limited' | 'rejected' | 'network' | 'unavailable' | null };

/** Better Auth error as the pages read it (the same fields its own client returns). */
export type AuthError = { status: number; code?: string; message?: string };
type Result = { error: AuthError | null; data: { user?: { id: string }; token?: string | null } | null; /** Proof of this request for the delivery-status endpoint (code-sending calls only). */ statusToken?: string | null };

/**
 * Thin client for the few Better Auth endpoints the pages use: plain fetch + cookies. The official client (+ better-fetch, nanostores) was a
 * 12 KB gzip chunk on /login and on every authed page (AppShell signs out through it); we use no session hook or plugin from it.
 */
async function post(path: string, body: object = {}): Promise<Result> {
  try {
    const r = await fetch(`/api/auth${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    const statusToken = r.headers.get('x-email-status-token');
    return r.ok ? { data: j, error: null, statusToken } : { data: null, error: { status: r.status, code: j?.code, message: j?.message ?? j?.error } };
  } catch {
    return { data: null, error: { status: 0, message: 'Network error. Check your connection and try again.' } };
  }
}

export const authClient = {
  /** A guest session (Better Auth anonymous plugin): created on the first test start, never on page view. */
  signInAnonymous: () => post('/sign-in/anonymous'),
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
  /** Delivery status of the code email behind a status token (what the sender screen shows). A failed lookup reads as "no news". */
  emailStatus: async (token: string): Promise<EmailStatus | null> => {
    try {
      const r = await fetch('/api/auth-email/status', { headers: { 'x-email-status-token': token } });
      return r.ok ? ((await r.json()) as EmailStatus) : null;
    } catch {
      return null;
    }
  },
  deleteUser: (b: { password: string }) => post('/delete-user', b),
};

/** Reader-friendly text for a failed code check or send. */
export function otpError(e: AuthError) {
  if (e.code === 'INVALID_OTP') return 'That code isn’t right. Check it and try again.';
  if (e.code === 'OTP_EXPIRED') return 'That code has expired. Request a new one.';
  if (e.code === 'TOO_MANY_ATTEMPTS') return 'Too many wrong tries. Request a new code.';
  if (e.code === 'otp_locked') return e.message || 'Too many wrong codes. Try again later.'; // the server says how many minutes
  if (e.status === 429) return 'Too many requests. Wait a minute, then try again.';
  return e.message || 'Something went wrong. Try again.';
}

/** Only same-app paths: blocks open redirects like `//evil.com`. */
export const safeRedirect = (to: unknown) => (typeof to === 'string' && to.startsWith('/') && !to.startsWith('//') ? to : '/');

export async function signOut() {
  await authClient.signOut();
  queryClient.clear();
}

/** beforeLoad for sign-in and sign-up: bounce signed-in users to the dashboard. A guest session stays: it is linked to the account on sign-in. */
export async function redirectIfSignedIn({ context }: { context: { queryClient: QueryClient } }) {
  const me = await context.queryClient.fetchQuery(meQuery).catch(() => null);
  if (isAccount(me)) throw redirect({ to: '/' });
}

/**
 * Make sure there is a session before a test starts (a guest session when nobody is signed in), so attempts can be created.
 * Called when a test actually starts, so merely browsing never creates a guest. Resolves to the current me.
 */
export async function ensureSession() {
  const have = await queryClient.fetchQuery(meQuery).catch(() => null);
  if (have) return have;
  const { error } = await authClient.signInAnonymous();
  if (error) throw new ApiError(error.status, error.status === 429 ? 'You’re going a bit fast. Try again in a moment.' : error.message || 'Could not start the test. Try again.', error.status === 429 ? 'too_many_requests' : error.code);
  await queryClient.invalidateQueries({ queryKey: ['quota'] });
  return queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
}

/** After a sign-in or sign-up: the guest's tests now count on the account, so every cached answer about who you are and what you may do is stale. */
export const refreshSession = () => queryClient.removeQueries({ predicate: (q) => ['me', 'quota', 'keys', 'attempts', 'attempt'].includes(String(q.queryKey[0])) });

/** The site owner (me.isOwner): the only one who sees the Admin area. */
// ponytail: the cast goes when schema.d.ts is regenerated (pnpm gen:api) and Me carries isOwner.
export const useIsOwner = () => !!(useMe().data as (Me & { isOwner?: boolean }) | null | undefined)?.isOwner;
