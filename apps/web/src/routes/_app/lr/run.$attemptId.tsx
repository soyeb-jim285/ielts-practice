import { createFileRoute, redirect } from '@tanstack/react-router';
import { Runner } from '@/components/lr/Runner';
import { call, client } from '@/lib/api';

export const Route = createFileRoute('/_app/lr/run/$attemptId')({
  validateSearch: (s: Record<string, unknown>): { mock?: string } => ({ mock: typeof s.mock === 'string' ? s.mock : undefined }),
  loader: async ({ params }) => {
    const a = await call(client.GET('/api/lr/attempts/{id}', { params: { path: { id: params.attemptId } } }));
    if (a.status === 'submitted') throw redirect({ to: '/lr/result/$attemptId', params: { attemptId: a.id }, replace: true });
    return a;
  },
  // Never reload mid-test; a fresh visit refetches.
  staleTime: Infinity,
  gcTime: 0,
  staticData: { exam: true },
  component: RunPage,
});

function RunPage() {
  const attempt = Route.useLoaderData();
  const { mock } = Route.useSearch();
  return <Runner key={attempt.id} attempt={attempt} mockId={mock} />;
}
