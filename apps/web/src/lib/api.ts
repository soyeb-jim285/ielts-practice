import type { Settings } from '@server/settings';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Tiny typed fetch wrapper. `path` is relative to /api (e.g. '/me'); a leading '/api' is also accepted. */
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path.startsWith('/api/') ? path : `/api${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (!res.ok) {
    const msg = (data as { error?: string } | undefined)?.error;
    throw new ApiError(res.status, msg || (res.status >= 500 ? 'Something went wrong on our side. Try again.' : res.statusText || 'Request failed'));
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
};

export type Me = {
  user: { id: string; email: string; name: string; emailVerified: boolean };
  settings: Settings;
  cambridgeAccess: boolean;
  realtimeAvailable: boolean;
};

export type { Settings };
