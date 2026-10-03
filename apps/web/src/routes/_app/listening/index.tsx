import { createFileRoute } from '@tanstack/react-router';
import { LrHub } from '@/components/lr/Hub';
import { lrTestsQuery } from '@/lib/lr';

export const Route = createFileRoute('/_app/listening/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(lrTestsQuery('listening')),
  staleTime: 0,
  component: () => <LrHub skill="listening" />,
});
