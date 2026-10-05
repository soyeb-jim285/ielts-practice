import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './api';

export type Page<T> = { items: T[]; page: number; pageSize: number; total: number };

const qs = (p: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== '') s.set(k, String(v));
  return s.size ? `?${s}` : '';
};

/** GET /api/admin<path>?params, cached per path + params. The previous result stays on screen while the next page or filter loads. */
export const useAdmin = <T>(path: string, params: Record<string, string | number | undefined> = {}, { enabled = true }: { enabled?: boolean } = {}) =>
  useQuery({ queryKey: ['admin', path, params], queryFn: () => api.get<T>(`/admin${path}${qs(params)}`), placeholderData: keepPreviousData, enabled });

/** The server hands out app paths ('/speaking/result/<id>'); the router wants its typed union. */
// ponytail: the cast is the price of server-provided paths; they are covered by the server tests.
export const appPath = (p: string) => p as '/';
