import { createFileRoute, Outlet, redirect, useMatches } from '@tanstack/react-router';
import { AppShell } from '@/components/layout/AppShell';
import { ApiError } from '@/lib/api';
import { meQuery } from '@/lib/query';

/** Authed layout: every page under routes/_app/ requires a session. Exam routes (staticData.exam) render bare in ExamShell; the rest inside AppShell. */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
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
