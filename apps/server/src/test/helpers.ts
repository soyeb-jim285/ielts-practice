import { createApp } from '../app';
import { auth } from '../auth';
import { db } from '../db/client';
import { prompts, user as userTable } from '../db/schema';
import { eq } from 'drizzle-orm';

export const app = createApp();

let n = 0;
/** Signs up a user and returns bearer auth headers. Verified by default (pass verified:false to test unverified). */
export async function testUser(email = `user${++n}_${Math.random().toString(36).slice(2, 7)}@test.dev`, opts: { verified?: boolean } = {}) {
  const res = await auth.api.signUpEmail({ body: { email, password: 'password1234', name: 'Test User' }, asResponse: true });
  const token = res.headers.get('set-auth-token');
  if (!token) throw new Error(`signup failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { user: { id: string; email: string } };
  if (opts.verified !== false) await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.id, body.user.id));
  const headers = new Headers({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
  return { headers, user: body.user };
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
  const calls: { url: string; body: any }[] = [];
  const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    let body: any = init.body;
    try {
      body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    } catch {}
    calls.push({ url, body });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response(JSON.stringify({ error: `no fake route for ${url}` }), { status: 599 });
    return routes[key]!(url, init);
  }) as typeof fetch;
  return Object.assign(f, { calls });
}

export const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
export const chatReply = (content: unknown) => json({ choices: [{ message: { role: 'assistant', content: typeof content === 'string' ? content : JSON.stringify(content) } }] });
