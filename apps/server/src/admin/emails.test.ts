import { req, testUser } from '../test/helpers'; // first: loads the app before the modules that import it back
import { describe, expect, it, vi } from 'vitest';
import { OWNER_EMAILS } from '../auth';
import { sendBatch, sendEmail } from '../email';
import { renderEmail, TEMPLATES } from '../email-templates';
import type { EmailDoc } from '../emails/blocks';
import { pause, unsubscribeToken } from '../emails/campaigns';
import { getSettings } from '../settings';
import { db } from '../db/client';
import { coachReports } from '../db/schema';

vi.mock('../email', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'e1', attempts: 1 })), sendBatch: vi.fn(async () => ({ ok: true })) }));
const send = vi.mocked(sendEmail);
const batch = vi.mocked(sendBatch);
const OWNER = OWNER_EMAILS[0]!;
const body = async (r: Response) => (await r.json()) as any;
pause.ms = 0;

describe('account emails', () => {
  it('renders blocks, escapes values and fills placeholders', async () => {
    const doc: EmailDoc = { ...TEMPLATES['verification-code'].defaults };
    doc.blocks = [...doc.blocks, { type: 'details', title: 'Who', rows: [{ label: 'Name', value: '{{code}}' }] }];
    const m = await renderEmail('verification-code', { code: '<b>1</b>', minutes: '10' }, doc);
    expect(m.html).toContain('&lt;b&gt;1&lt;/b&gt;');
    expect(m.html).not.toContain('<b>1</b>');
    const ok = await renderEmail('verification-code', { code: '123456', minutes: '10' });
    expect(ok.subject).toBe('Your NextBand code: 123456');
    expect(ok.html).toContain('this email was used to sign up');
    expect(ok.html).toMatch(/>123456<\/p>/);
    expect(ok.html).not.toContain('Unsubscribe'); // account emails cannot be unsubscribed from
    expect(ok.text).toContain('123456');
  });

  it('owner edits, previews, tests and resets; others get 404', async () => {
    const o = await testUser(OWNER);
    const u = await testUser();
    for (const p of ['/api/admin/emails', '/api/admin/campaigns', '/api/admin/email-settings']) expect((await req(p, { headers: u.headers })).status).toBe(404);

    const doc = { subject: 'Hello again', preheader: '', blocks: [{ type: 'text', text: 'See **you** [here](https://nextband.app).' }] };
    const saved = await body(await req('/api/admin/emails/account-exists', { method: 'PUT', headers: o.headers, body: doc }));
    expect(saved).toMatchObject({ custom: true, doc: { subject: 'Hello again' } });
    expect((await renderEmail('account-exists', {})).html).toContain('href="https://nextband.app"');
    expect((await body(await req('/api/admin/emails/account-exists/preview', { headers: o.headers, body: { ...doc, subject: 'Draft' } }))).subject).toBe('Draft');
    expect((await req('/api/admin/emails/account-exists/test', { headers: o.headers, body: doc })).status).toBe(200);
    expect(send.mock.calls.at(-1)![0]).toMatchObject({ to: OWNER, subject: '[Test] Hello again' });
    expect(await body(await req('/api/admin/emails/account-exists', { method: 'DELETE', headers: o.headers }))).toMatchObject({ custom: false, doc: { subject: 'You already have a NextBand account' } });
    expect((await req('/api/admin/emails/account-exists', { method: 'PUT', headers: o.headers, body: { ...doc, blocks: [{ type: 'nope' }] } })).status).toBe(400);
  });

  it('the weekly test send uses your own coach report when you have one', async () => {
    const o = await testUser(OWNER);
    const doc = TEMPLATES['weekly-report'].defaults;
    await req('/api/admin/emails/weekly-report/test', { headers: o.headers, body: doc });
    expect(send.mock.calls.at(-1)![0]).toMatchObject({ subject: '[Test] Ayesha, your week on NextBand', html: expect.stringContaining('Listening is at your target') }); // no report: the sample
    const words = { summary: 'You are close. Keep going.', win: 'Reading moved up to 7.', focus: [], cheat: [], plan: [] };
    await db.insert(coachReports).values({ userId: o.user.id, day: '2026-10-27', lastTestAt: new Date(), facts: { skills: [] } as never, words, model: null });
    expect((await req('/api/admin/emails/weekly-report/test', { headers: o.headers, body: doc })).status).toBe(200);
    const m = send.mock.calls.at(-1)![0];
    expect(m).toMatchObject({ to: OWNER, subject: expect.stringMatching(/^\[Test\] .+, your week on NextBand$/), html: expect.stringContaining('Reading moved up to 7.') });
    expect(m.html).toContain('/api/email/unsubscribe?t=');
  });

  it('footer settings show up in emails', async () => {
    const o = await testUser(OWNER);
    const s = { company: 'NextBand', note: 'Practice that moves your band.', supportEmail: 'help@nextband.app', social: { facebook: 'https://facebook.com/nextband', instagram: '', youtube: '', x: '', tiktok: '' } };
    expect((await req('/api/admin/email-settings', { method: 'PUT', headers: o.headers, body: s })).status).toBe(200);
    const m = await renderEmail('reset-code', { code: '111111', minutes: '10' });
    expect(m.html).toContain('Practice that moves your band.');
    expect(m.html).toContain('/email/facebook.png');
    expect(m.html).not.toContain('/email/youtube.png');
  });

  it('granting the plan with notify emails the user', async () => {
    const o = await testUser(OWNER);
    const u = await testUser('granted@test.dev');
    send.mockClear();
    const until = new Date(Date.now() + 30 * 86_400_000).toISOString();
    expect((await req(`/api/admin/users/${u.user.id}/limits`, { headers: o.headers, body: { speaking: null, writing: null, unlimited: false, subscribedUntil: until, notify: true } })).status).toBe(200);
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'granted@test.dev', subject: 'Your NextBand paid plan is on' })));
  });
});

describe('campaigns', () => {
  it('sends a draft once to opted-in accounts, with unsubscribe links and headers', async () => {
    const o = await testUser(OWNER);
    const a = await testUser('camp-a@test.dev');
    const b = await testUser('camp-b@test.dev');
    await req('/api/settings', { method: 'PUT', headers: b.headers, body: { productEmails: false } });
    const draft = await body(await req('/api/admin/campaigns', { headers: o.headers, body: { subject: 'News for {{firstName}}', preheader: 'Hi', audience: 'all', blocks: [{ type: 'text', text: 'Hello {{name}}' }] } }));
    expect(draft.status).toBe('draft');
    batch.mockClear();
    expect((await req(`/api/admin/campaigns/${draft.id}/send`, { method: 'POST', headers: o.headers })).status).toBe(200);
    expect((await req(`/api/admin/campaigns/${draft.id}/send`, { method: 'POST', headers: o.headers })).status).toBe(409); // a double click sends once
    await vi.waitFor(async () => expect((await body(await req('/api/admin/campaigns', { headers: o.headers }))).campaigns.find((c: { id: string }) => c.id === draft.id).status).toBe('sent'));
    const sent = batch.mock.calls.flatMap(([items]) => items);
    const toA = sent.find((m) => m.to === 'camp-a@test.dev')!;
    expect(sent.some((m) => m.to === 'camp-b@test.dev')).toBe(false);
    expect(toA.html).toContain(encodeURIComponent(unsubscribeToken(a.user.id)));
    expect(toA.headers).toMatchObject({ 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
    expect((await req(`/api/admin/campaigns/${draft.id}`, { method: 'PUT', headers: o.headers, body: { subject: 'x', preheader: '', audience: 'all', blocks: [{ type: 'divider' }] } })).status).toBe(409);
  });

  it('unsubscribe: GET only asks, POST (form or one-click) turns product emails off; a forged token does nothing', async () => {
    const u = await testUser('unsub@test.dev');
    const t = encodeURIComponent(unsubscribeToken(u.user.id));
    const get = await req(`/api/email/unsubscribe?t=${t}`, { method: 'GET' });
    expect(get.status).toBe(200);
    expect((await getSettings(u.user.id)).productEmails).toBe(true);
    expect((await req(`/api/email/unsubscribe?t=${encodeURIComponent(`${u.user.id}.forged`)}`, { method: 'POST' })).status).toBe(400);
    expect((await req(`/api/email/unsubscribe?t=${t}`, { method: 'POST' })).status).toBe(200);
    expect((await getSettings(u.user.id)).productEmails).toBe(false);
  });
});
