import { QueryClient, queryOptions, useQuery } from '@tanstack/react-query';
import { ApiError, call, client, type Schemas } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Never retry client errors (401/404/400); retry server/network errors once.
      retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 1,
    },
  },
});

/** index.html starts GET /api/me before the entry bundle loads; the first me fetch adopts that response instead of waiting on the JS. */
function takeInlineMe() {
  const g = globalThis as { __me?: Promise<Response> };
  const res = g.__me;
  g.__me = undefined;
  return res?.then(async (response) => {
    const body = await response.json().catch(() => undefined);
    return { response, data: body, error: body };
  });
}

export const meQuery = queryOptions({
  queryKey: ['me'],
  // A guest is a normal state, not an error: 401 resolves to null.
  queryFn: () => call<Schemas['Me'] | null>(takeInlineMe() ?? client.GET('/api/me')).catch((e) => (e instanceof ApiError && e.status === 401 ? null : Promise.reject(e))),
  staleTime: 5 * 60_000,
});

/** Current user + settings, or null for a guest. Resolved by the `_app` layout loader. Pages behind `requireSignIn` can rely on it being set (`data!`). */
export const useMe = () => useQuery(meQuery);
