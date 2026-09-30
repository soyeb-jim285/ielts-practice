import { createFileRoute, Outlet, redirect, useMatches } from '@tanstack/react-router';
import { AppShell } from '@/components/layout/AppShell';
import { ApiError } from '@/lib/api';
import { meQuery } from '@/lib/query';

/**
 * Authed layout: every page under routes/_app/ requires a session. The session check is a loader (not beforeLoad) so it runs
 * in parallel with the page's own loaders instead of in front of them; a 401 redirect wins over the page loaders' 401 errors.
 * Exam routes (staticData.exam) render bare in ExamShell; the rest inside AppShell.
 */
export const Route = createFileRoute('/_app')({
  loader: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData(meQuery);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) throw redirect({ to: '/login', search: { redirect: location.href } });
      throw e;
    }
  },
  component: AppLayout,
});

function AppLayout() {
  const exam = useMatches({ select: (ms) => ms.some((m) => m.staticData.exam) });
  return exam ? (
    <Outlet />
  ) : (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
