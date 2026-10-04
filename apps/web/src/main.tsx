import { QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouteError } from '@/components/layout/RouteError';
import { PageSkeleton } from '@/components/ui';
import { isStale } from '@/lib/freshBuild';
import { queryClient } from '@/lib/query';
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

// Hard load: /api/me is already in flight from index.html; start the matched routes' split chunks now too, so the
// router doesn't discover them only after the entry has rendered. _app's loader awaits me in parallel with the page loaders.
for (const r of router.getMatchedRoutes(location.pathname)[0]) router.loadRouteChunk(r)?.catch(() => {}); // the router retries and reports on navigation

// After a deploy, reload into the new build at the next navigation between ordinary pages (never into or out of an exam screen).
let stale = false;
const check = () => void isStale().then((s) => (stale ||= s));
setInterval(check, 10 * 60_000);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
const inExam = (path: string) => router.getMatchedRoutes(path)[0].some((r) => r.options.staticData?.exam);
router.subscribe('onBeforeNavigate', ({ fromLocation, toLocation }) => {
  if (stale && !inExam(toLocation.pathname) && !(fromLocation && inExam(fromLocation.pathname))) location.assign(toLocation.href);
});

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
