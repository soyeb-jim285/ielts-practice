import { useQuery, type QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { RouteError } from '@/components/layout/RouteError';
import { Toaster } from '@/components/ui';
import { meQuery } from '@/lib/query';

const NotFoundInShell = lazy(() => import('@/components/layout/NotFoundInShell'));

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

/** Unknown URL: inside the app shell (nav stays) once the session is known, signed in or not. */
function NotFound() {
  const me = useQuery(meQuery);
  if (me.isPending) return null;
  return (
    <Suspense fallback={null}>
      <NotFoundInShell />
    </Suspense>
  );
}
