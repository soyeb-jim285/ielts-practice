import { createFileRoute } from '@tanstack/react-router';
import { LrHub } from '@/components/lr/Hub';
import { lrTestsQuery, requireLrAccess } from '@/lib/lr';

export const Route = createFileRoute('/_app/listening/')({
  beforeLoad: ({ context }) => requireLrAccess(context.queryClient),
  loader: ({ context }) => context.queryClient.ensureQueryData(lrTestsQuery('listening')),
  staleTime: 0,
  component: () => <LrHub skill="listening" />,
});
