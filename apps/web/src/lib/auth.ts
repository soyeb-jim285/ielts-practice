import { createAuthClient } from 'better-auth/react';
import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { meQuery, queryClient } from './query';

export const authClient = createAuthClient({ baseURL: window.location.origin });
export const { useSession } = authClient;

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
