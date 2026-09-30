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
  sendVerificationEmail: (b: { email: string; callbackURL: string }) => post('/send-verification-email', b),
  requestPasswordReset: (b: { email: string; redirectTo: string }) => post('/request-password-reset', b),
  resetPassword: (b: { newPassword: string; token: string }) => post('/reset-password', b),
  deleteUser: (b: { password: string }) => post('/delete-user', b),
};

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
