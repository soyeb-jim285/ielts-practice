import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { call, client } from '@/lib/api';
import { currentMockQuery, mockQuery, type Mock } from '@/lib/mock';
import { useAccount } from '@/lib/query';

/** The open mock test of this account, for the dashboard, the hubs and the start screen. Guests have none. */
export const useCurrentMock = () => {
  const account = !!useAccount();
  return useQuery({ ...currentMockQuery, enabled: account });
};

export const useMock = (id: string) => useQuery(mockQuery(id));

/** Every mutation refreshes the mock lists and that mock, so the hub, dashboard and History agree. */
export function useMockActions(id?: string) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const refresh = () => qc.invalidateQueries({ queryKey: ['mock'] });
  const to = (m: string) => navigate({ to: '/mock/$id', params: { id: m } });

  return {
    create: useMutation({
      mutationFn: (b: { variant: Mock['variant']; source: Mock['source']; ref?: string; replace?: boolean }) =>
        call(client.POST('/api/mock', { params: { query: { replace: b.replace ? 'true' : 'false' } }, body: { variant: b.variant, source: b.source, ...(b.ref && { ref: b.ref }) } })),
      onSuccess: async (m) => {
        await refresh();
        await to((m as Mock).id);
      },
    }),
    /** Listening / Reading: create (or fetch) the exam-mode attempt and open it inside the mock. */
    startLr: useMutation({
      mutationFn: (skill: 'listening' | 'reading') => call(client.POST('/api/mock/{id}/sections/{skill}/start', { params: { path: { id: id!, skill } } })),
      onSuccess: (r) => navigate({ to: '/lr/run/$attemptId', params: { attemptId: r.attemptId }, search: { mock: id } }),
    }),
    close: useMutation({
      mutationFn: () => call(client.POST('/api/mock/{id}/close', { params: { path: { id: id! } } })),
      onSuccess: refresh,
    }),
    abandon: useMutation({
      mutationFn: () => call(client.DELETE('/api/mock/{id}', { params: { path: { id: id! } } })),
      onSuccess: async () => {
        await refresh();
        await navigate({ to: '/mock' });
      },
    }),
    chooseLive: useMutation({
      mutationFn: () => call(client.POST('/api/mock/{id}/speaking/choose', { params: { path: { id: id! } }, body: { mode: 'live' } })),
      onSuccess: (r) => navigate({ to: '/speaking/live', search: { source: r.source, mock: id } }),
    }),
  };
}
