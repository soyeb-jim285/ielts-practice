import { QueryClient, queryOptions, useQuery } from '@tanstack/react-query';
import { ApiError, call, client } from './api';

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

export const meQuery = queryOptions({ queryKey: ['me'], queryFn: () => call(client.GET('/api/me')), staleTime: 5 * 60_000 });

/** Current user + settings. Always resolved inside the authed `_app` layout (the guard preloads it). */
export const useMe = () => useQuery(meQuery);
