import { createFileRoute } from '@tanstack/react-router';
import { LrHub } from '@/components/lr/Hub';
import { lrTestsQuery } from '@/lib/lr';

export const Route = createFileRoute('/_app/reading/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(lrTestsQuery('reading')),
  staleTime: 0,
  component: () => <LrHub skill="reading" />,
});
