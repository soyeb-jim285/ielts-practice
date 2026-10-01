import { createFileRoute, Outlet, redirect, useMatches } from '@tanstack/react-router';
import { AppShell } from '@/components/layout/AppShell';
import { meQuery } from '@/lib/query';

/** What a guest may open: the dashboard, the two hubs, the prompt bank and the style guide. Everything else (tests, results, history, mistakes, review, settings) needs an account. */
const GUEST_PAGES = new Set(['/', '/speaking', '/writing', '/bank', '/styleguide']);

/**
 * App layout. Guests browse the pages above; any other page sends them to /login?redirect=<that page>, and sign-in brings them back to it.
 * Exam routes (staticData.exam) render bare in ExamShell; the rest inside AppShell.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQuery); // null for a guest
    if (!me && !GUEST_PAGES.has(location.pathname.replace(/(.)\/$/, '$1'))) throw redirect({ to: '/login', search: { redirect: location.href } });
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
