import { createFileRoute, Outlet, useMatches } from '@tanstack/react-router';
import { AppShell } from '@/components/layout/AppShell';
import { meQuery } from '@/lib/query';

/**
 * App layout. Everyone browses everything: a visitor or guest can open the hubs, the prompt bank and take a free test (see TestGate); pages
 * that hold personal data (history, mistakes, review, settings) show a sign-up gate to them instead of redirecting.
 * Exam routes (staticData.exam) render bare in ExamShell; the rest inside AppShell.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context }) => context.queryClient.ensureQueryData(meQuery), // null for a visitor
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
