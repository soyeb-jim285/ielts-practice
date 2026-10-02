import { createApp } from '../app';
import { auth } from '../auth';
import { db } from '../db/client';
import { prompts, user as userTable } from '../db/schema';
import { saveKey, type Provider } from '../keys';
import { eq } from 'drizzle-orm';

export const app = createApp();

let n = 0;
/** Stores a user's own provider key (encrypted, as PUT /api/keys does after its live check). */
export const setKey = (userId: string, provider: Provider, key = `sk-test-${provider}-0000`) => saveKey(userId, provider, key);

/** Signs up a user and returns bearer auth headers. Verified by default (pass verified:false to test unverified).
 *  By default the user has their own OpenRouter key (unlimited, no community quota) so tests that are not about quotas are unaffected; pass key:false for a community-tier user. */
export async function testUser(email = `user${++n}_${Math.random().toString(36).slice(2, 7)}@test.dev`, opts: { verified?: boolean; key?: boolean } = {}) {
  const res = await auth.api.signUpEmail({ body: { email, password: 'password1234', name: 'Test User' }, asResponse: true });
  const token = res.headers.get('set-auth-token');
  if (!token) throw new Error(`signup failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { user: { id: string; email: string } };
  if (opts.verified !== false) await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.id, body.user.id));
  if (opts.key !== false) await setKey(body.user.id, 'openrouter');
  const headers = new Headers({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
  return { headers, user: body.user };
}

/** A guest: an anonymous session from POST /api/auth/sign-in/anonymous, bearer token like the apps get it. `ip` sets CF-Connecting-IP on every request made with these headers. */
export async function guestUser(ip?: string) {
  const res = await app.request('/api/auth/sign-in/anonymous', { method: 'POST', headers: new Headers({ 'Content-Type': 'application/json', ...(ip && { 'CF-Connecting-IP': ip }) }), body: '{}' });
  const token = res.headers.get('set-auth-token');
  if (!token) throw new Error(`anonymous sign-in failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { user: { id: string } };
  const headers = new Headers({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(ip && { 'CF-Connecting-IP': ip }) });
  return { headers, user: body.user, token };
}

/** app.request with JSON body + auth headers */
export function req(path: string, init: { method?: string; headers?: Headers; body?: unknown } = {}) {
  return app.request(path, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: init.headers ?? new Headers({ 'Content-Type': 'application/json' }),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

export async function seedPrompt(p: Partial<typeof prompts.$inferInsert> = {}) {
  const [row] = await db
    .insert(prompts)
    .values({
      slug: p.slug ?? `p-${Math.random().toString(36).slice(2)}`,
      skill: 'speaking',
      part: 1,
      type: 'p1-topic',
      topic: 'hometown',
      title: 'Your hometown',
      body: 'Where is your hometown?',
      followUps: ['Where is your hometown?', 'What do you like about it?'],
      ...p,
    })
    .returning();
  return row!;
}

type Route = (url: string, init: RequestInit) => Response | Promise<Response>;
/** Builds a fetch stub routing by URL substring. Records calls. */
export function fakeFetch(routes: Record<string, Route>) {
  const calls: { url: string; body: any; headers: Record<string, string> }[] = [];
  const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    let body: any = init.body;
    try {
      body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    } catch {}
    const headers = Object.fromEntries(new Headers(init.headers).entries()); // lower-cased names
    calls.push({ url, body, headers });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response(JSON.stringify({ error: `no fake route for ${url}` }), { status: 599 });
    return routes[key]!(url, init);
  }) as typeof fetch;
  return Object.assign(f, { calls });
}

export const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
export const chatReply = (content: unknown) => json({ choices: [{ message: { role: 'assistant', content: typeof content === 'string' ? content : JSON.stringify(content) } }] });
