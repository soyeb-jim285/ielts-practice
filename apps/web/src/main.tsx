import { QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouteError } from '@/components/layout/RouteError';
import { PageSkeleton } from '@/components/ui';
import { meQuery, queryClient } from '@/lib/query';
import { routeTree } from './routeTree.gen';
import './styles.css';

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0, // TanStack Query owns caching
  defaultPendingComponent: PageSkeleton,
  defaultErrorComponent: RouteError, // loader errors render inside the parent layout (AppShell)
  scrollRestoration: true,
});

// Hard load: fetch the session and the matched routes' split chunks in parallel. Otherwise _app's beforeLoad awaits /api/me
// (it reuses this in-flight query) before the router starts on the chunks: entry JS → me → chunks becomes entry JS → (me ‖ chunks).
if (!/^\/(login|signup|forgot-password|reset-password)\b/.test(location.pathname)) void queryClient.prefetchQuery(meQuery);
for (const r of router.getMatchedRoutes(location.pathname)[0]) router.loadRouteChunk(r)?.catch(() => {}); // the router retries and reports on navigation

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
  interface StaticDataRouteOption {
    /** Timed exam screen: rendered in ExamShell without the AppShell nav. */
    exam?: boolean;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
