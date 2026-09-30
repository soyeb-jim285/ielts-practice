import { useQuery, type QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { Compass } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorPage, RouteError } from '@/components/layout/RouteError';
import { buttonStyles, Toaster } from '@/components/ui';
import { meQuery } from '@/lib/query';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <>
      <Outlet />
      <Toaster />
    </>
  ),
  notFoundComponent: NotFound,
  errorComponent: RouteError,
});

/** Unknown URL: inside the app shell (nav stays) when signed in, bare otherwise. */
function NotFound() {
  const me = useQuery(meQuery);
  if (me.isPending) return null;
  const body = (
    <ErrorPage icon={<Compass />} title="Page not found" action={<Link to="/" className={buttonStyles({ variant: 'secondary' })}>{me.data ? 'Back to dashboard' : 'Go to sign in'}</Link>}>
      The link may be old or mistyped.
    </ErrorPage>
  );
  return me.data ? <AppShell>{body}</AppShell> : body;
}
