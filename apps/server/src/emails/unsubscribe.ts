import type { Context } from 'hono';
import type { App } from '../types';
import { origin } from '../email-templates';
import { readUnsubscribeToken, unsubscribe } from './campaigns';

/** A small standalone page (no app bundle): the link opens from an email, often signed out. */
const page = (title: string, body: string, status: 200 | 400, c: Context) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Robots-Tag', 'noindex');
  return c.html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | NextBand</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f9fb;color:#0f172a;font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:16px;box-sizing:border-box}
main{max-width:420px;width:100%;background:#fff;border:1px solid #e3e8ef;border-radius:12px;padding:32px}h1{font:600 26px/1.25 Georgia,serif;margin:16px 0 8px}p{margin:0 0 16px;color:#5b6b80}
button,a.b{display:inline-block;background:#0f766e;color:#fff;border:0;border-radius:8px;padding:12px 22px;font:600 16px/1.2 inherit;cursor:pointer;text-decoration:none}a{color:#0f766e}
button:focus-visible,a:focus-visible{outline:2px solid #0f766e;outline-offset:2px}</style></head>
<body><main><img src="${origin()}/nextband/logo.svg" width="128" height="26" alt="NextBand"><h1>${title}</h1>${body}</main></body></html>`,
    status,
  );
};

const bad = (c: Context) => page('This link does not work', `<p>It may be incomplete. You can turn product emails off in <a href="${origin()}/settings">Settings</a> instead.</p>`, 400, c);

export function register(app: App) {
  // GET only asks (link scanners open links); POST does it: the form below, or a mail client's one-click unsubscribe (RFC 8058).
  app.get('/api/email/unsubscribe', (c) => {
    const t = c.req.query('t');
    if (!readUnsubscribeToken(t)) return bad(c);
    return page(
      'Unsubscribe from product emails?',
      `<p>You will stop getting news and practice tips. Account emails, like sign-in codes, still arrive.</p><form method="post"><button type="submit">Unsubscribe</button></form>`,
      200,
      c,
    );
  });
  app.post('/api/email/unsubscribe', async (c) => {
    const id = readUnsubscribeToken(c.req.query('t'));
    if (!id) return bad(c);
    await unsubscribe(id).catch(() => undefined); // a deleted account: nothing left to send to
    return page('You are unsubscribed', `<p>No more product emails. Changed your mind? Turn them back on in <a href="${origin()}/settings">Settings</a>.</p>`, 200, c);
  });
}
