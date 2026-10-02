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

/** Signed in with a real account: not signed out, and not a guest (anonymous session). Guests browse and take their few tests but have no history, keys or settings. */
export const isAccount = (me: Schemas['Me'] | null | undefined): me is Schemas['Me'] => !!me && !me.user.isAnonymous;

/** The signed-in account, or null for a visitor and for a guest session. */
export const useAccount = () => {
  const me = useMe().data;
  return isAccount(me) ? me : null;
};

/** Loader helper for personal pages: runs `load` only for a signed-in account. A visitor or a guest gets the page's sign-up gate and no request that would answer 403. */
export async function loadForAccount(qc: QueryClient, load: () => unknown) {
  if (isAccount(await qc.ensureQueryData(meQuery))) await load();
}
