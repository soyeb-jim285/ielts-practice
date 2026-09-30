import createClient from 'openapi-fetch';
import { describe, expect, it } from 'vitest';
import { ApiError, call } from './api';
import type { paths } from './schema';

const clientFor = (status: number, body: unknown) =>
  createClient<paths>({ baseUrl: 'http://test', fetch: async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }) });

describe('call', () => {
  it('returns the typed data on 2xx', async () => {
    await expect(call(clientFor(200, { total: 0, cards: [] }).GET('/api/cards/due'))).resolves.toEqual({ total: 0, cards: [] });
  });
  it("throws ApiError with the server's {error} message", async () => {
    const e = await call(clientFor(404, { error: 'Mistake not found' }).POST('/api/mistakes/{id}/card', { params: { path: { id: 'x' } } })).catch((e: unknown) => e);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 404, message: 'Mistake not found' });
  });
  it('falls back to a friendly message on 5xx without a body', async () => {
    await expect(call(clientFor(502, null).GET('/api/progress'))).rejects.toMatchObject({ status: 502, message: 'Something went wrong on our side. Try again.' });
  });
});
