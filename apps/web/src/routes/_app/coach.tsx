import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { CoachView } from '@/components/coach/CoachView';
import { coachQuery } from '@/components/coach/data';
import { AccountGate } from '@/components/community/AccountGate';
import { meQuery, useMe } from '@/lib/query';

export const Route = createFileRoute('/_app/coach')({
  // guests have a session and get a coach too; only a visitor with no session sees the gate
  loader: async ({ context }) => {
    if (await context.queryClient.ensureQueryData(meQuery)) await context.queryClient.ensureQueryData(coachQuery);
  },
  component: () => (useMe().data ? <CoachPage /> : <AccountGate what="coach" />),
});

function CoachPage() {
  // only this page polls while a report is being written; the dashboard card reads once
  return <CoachView data={useSuspenseQuery({ ...coachQuery, refetchInterval: (q) => (q.state.data?.updating ? 5000 : false) }).data} />;
}
