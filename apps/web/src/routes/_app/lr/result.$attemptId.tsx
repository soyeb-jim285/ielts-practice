import { createFileRoute, redirect } from '@tanstack/react-router';
import { Results } from '@/components/lr/Results';
import { call, client } from '@/lib/api';

export const Route = createFileRoute('/_app/lr/result/$attemptId')({
  loader: async ({ params }) => {
    const a = await call(client.GET('/api/lr/attempts/{id}', { params: { path: { id: params.attemptId } } }));
    if (a.status !== 'submitted') throw redirect({ to: '/lr/run/$attemptId', params: { attemptId: a.id }, replace: true });
    return a;
  },
  component: () => <Results attempt={Route.useLoaderData()} />,
});
