import { afterEach, expect, it } from 'vitest';
import { meQuery, queryClient } from './query';

afterEach(() => queryClient.clear());

// The first me fetch adopts the response index.html started early (window.__me), which is also how a test can feed it.
const serve = (status: number, body: unknown) => {
  (globalThis as { __me?: Promise<Response> }).__me = Promise.resolve(new Response(JSON.stringify(body), { status }));
};

it('a guest (401) resolves the me query to null instead of throwing', async () => {
  serve(401, { error: 'Sign in required' });
  expect(await queryClient.fetchQuery(meQuery)).toBeNull();
});

it('a server failure still throws', async () => {
  serve(500, { error: 'boom' });
  await expect(queryClient.fetchQuery({ ...meQuery, retry: false })).rejects.toThrow('boom');
});

it('a signed-in user comes back as is', async () => {
  serve(200, { user: { id: 'u1', name: 'A', email: 'a@b.co' }, settings: {}, cambridgeAccess: false });
  expect(((await queryClient.fetchQuery(meQuery)) as { user: { id: string } }).user.id).toBe('u1');
});
