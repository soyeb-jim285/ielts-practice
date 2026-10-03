import { createFileRoute } from '@tanstack/react-router';
import { LrHub } from '@/components/lr/Hub';
import { lrTestsQuery, requireLrAccess } from '@/lib/lr';

export const Route = createFileRoute('/_app/reading/')({
  beforeLoad: ({ context }) => requireLrAccess(context.queryClient),
  loader: ({ context }) => context.queryClient.ensureQueryData(lrTestsQuery('reading')),
  staleTime: 0,
  component: () => <LrHub skill="reading" />,
});
