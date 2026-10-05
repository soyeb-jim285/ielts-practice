import type { Settings } from '@server/settings';
import createClient from 'openapi-fetch';
import type { components, paths } from './schema';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Machine-readable reason from the server (docs/community.md): quota_exceeded, community_balance_exhausted, live_requires_own_key, ... Clients map it to UX; `message` is only the fallback. */
    public code?: string,
    /** The rest of the error body (skill, resetAt, tier for quota_exceeded). */
    public body?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Tiny fetch wrapper typed by the caller (unchecked against the contract; see `client`). `path` is relative to /api (e.g. '/me'); a leading '/api' is also accepted. */
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path.startsWith('/api/') ? path : `/api${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (!res.ok) throw apiError(res, data);
  return data as T;
}

const apiError = (res: Response, body: unknown) => {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : undefined;
  const text = typeof b?.error === 'string' && b.error;
  return new ApiError(res.status, text || (res.status >= 500 ? 'Something went wrong on our side. Try again.' : res.statusText || 'Request failed'), typeof b?.code === 'string' ? b.code : undefined, b);
};

/**
 * Contract-typed client: paths, params, bodies and responses come from openapi.json (src/lib/schema.d.ts, `pnpm gen:api`),
 * so a server change that breaks the web fails `typecheck`. Prefer it over `api` for new code: `await call(client.GET('/api/progress'))`.
 */
export const client = createClient<paths>({ credentials: 'include' });

/** Unwraps an openapi-fetch result to its data, or throws ApiError like `api` does. */
export async function call<D>(req: Promise<{ data?: D; error?: unknown; response: Response }>): Promise<D> {
  const { data, error, response } = await req;
  if (!response.ok) throw apiError(response, error);
  return data as D;
}

export type Schemas = components['schemas'];

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
};

export type Me = Schemas['Me'];

export type { Settings };
