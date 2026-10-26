import { req, testUser, guestUser } from '../test/helpers'; // first: loads the app before the modules that import it back
import { expect, it, vi } from 'vitest';
import { db } from '../db/client';
import { coachReports, lrAttempts, lrTests, userSettings } from '../db/schema';
import { sendBatch } from '../email';
import { OWNER_EMAILS } from '../auth';
import type { EmailDoc } from '../emails/blocks';
import { TEMPLATES } from '../email-templates';
import type { CoachFacts, CoachWords } from './types';
import { weeklyDoc, weeklySweep } from './weekly';

vi.mock('../email', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'e1', attempts: 1 })), sendBatch: vi.fn(async () => ({ ok: true })) }));
const batch = vi.mocked(sendBatch);
const MON_0915 = new Date('2026-10-26T03:15:00Z'); // Monday 09:15 in Asia/Dhaka
const MON_1400 = new Date('2026-10-26T08:00:00Z');
const MON_0859 = new Date('2026-10-26T02:59:00Z');
let n = 0;
const sentTo = () => batch.mock.calls.flatMap(([items]) => items);

const facts = (over: Partial<CoachFacts> = {}) => ({ skills: [{ skill: 'listening', band: 7, trend: 'improving', trendDelta: 0.5 }], weekStats: { tests: 0, minutes: 0, days: 0, prev: { tests: 0, minutes: 0, days: 0 } }, ...over }) as unknown as CoachFacts;
const words = (over: Partial<CoachWords> = {}): CoachWords => ({ summary: 'You are steady. Keep going.', focus: [{ candidateId: 'c', title: 'Fix article errors', why: '', action: 'write-task2', label: '' }], win: 'Listening is at your target.', cheat: [], plan: [], ...over });

async function student(opts: { email?: string; tz?: string; tested?: boolean; report?: boolean; productEmails?: boolean } = {}) {
  const u = await testUser(opts.email);
  await db.insert(userSettings).values({ userId: u.user.id, data: { timeZone: opts.tz ?? 'Asia/Dhaka', ...(opts.productEmails === false && { productEmails: false }) } });
  if (opts.tested !== false) {
    const [t] = await db.insert(lrTests).values({ slug: `wk-${++n}-${Math.random().toString(36).slice(2, 6)}`, skill: 'listening', variant: 'academic', source: 'generated', ref: 'X', title: 'x', data: { sections: [] } as never, restricted: false }).returning();
    const at = new Date(MON_0915.getTime() - 86_400_000);
    await db.insert(lrAttempts).values({ userId: u.user.id, testId: t!.id, mode: 'practice', status: 'submitted', band: 6.5, elapsedS: 1800, submittedAt: at, startedAt: at });
  }
  if (opts.report !== false) await db.insert(coachReports).values({ userId: u.user.id, day: '2026-10-25', lastTestAt: new Date(), facts: facts(), words: words(), model: null });
  return u.user;
}

it('sends the weekly email once to an eligible student', async () => {
  await student({ email: 'wk-ok@test.dev' });
  batch.mockClear();
  await weeklySweep(MON_0915);
  const mine = sentTo().filter((m) => m.to === 'wk-ok@test.dev');
  expect(mine).toHaveLength(1);
  expect(mine[0]).toMatchObject({ subject: 'Listening is at your target.' });
  expect(mine[0]!.html).toContain('Open your coach');
  expect(mine[0]!.html).toContain('Tests');
  expect(mine[0]!.html).toContain('30'); // minutes
  expect(mine[0]!.headers).toMatchObject({ 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
  expect(mine[0]!.headers!['List-Unsubscribe']).toMatch(/^<.*\/api\/email\/unsubscribe\?t=/);
  batch.mockClear();
  await weeklySweep(MON_0915);
  expect(sentTo().filter((m) => m.to === 'wk-ok@test.dev')).toHaveLength(0);
});

it('skips opted-out, guests, idle students, no report and the wrong local time', async () => {
  await student({ email: 'wk-off@test.dev', productEmails: false });
  await student({ email: 'wk-idle@test.dev', tested: false });
  await student({ email: 'wk-norep@test.dev', report: false });
  const g = await guestUser();
  await db.insert(userSettings).values({ userId: g.user.id, data: { timeZone: 'Asia/Dhaka' } });
  batch.mockClear();
  await weeklySweep(MON_0915);
  expect(sentTo().map((m) => m.to).filter((t) => /^wk-(off|idle|norep)/.test(t))).toEqual([]);
  expect(sentTo()).toEqual([]); // the guest included
  batch.mockClear();
  await student({ email: 'wk-early@test.dev', tz: 'Asia/Dhaka' });
  await student({ email: 'wk-late@test.dev', tz: 'America/Los_Angeles' }); // Sunday evening there
  await weeklySweep(MON_0859); // 08:59 in Dhaka
  expect(sentTo().map((m) => m.to).filter((t) => /^wk-(early|late)/.test(t))).toEqual([]);
});

it('sends any time Monday morning onward, once', async () => {
  await student({ email: 'wk-2pm@test.dev' });
  batch.mockClear();
  await weeklySweep(MON_1400); // 14:00 in Dhaka
  expect(sentTo().filter((m) => m.to === 'wk-2pm@test.dev')).toHaveLength(1);
});

it('weeklyDoc omits zero stats and a missing win', () => {
  const base: EmailDoc = TEMPLATES['weekly-report'].defaults;
  const stats = { tests: 3, minutes: 0, days: 2, prev: { tests: 1, minutes: 0, days: 2 } };
  const d = weeklyDoc(base, { facts: facts(), words: words({ win: null }) }, stats);
  const s = d.blocks.find((b) => b.type === 'stats') as Extract<EmailDoc['blocks'][number], { type: 'stats' }>;
  expect(s.items.map((i) => i.label)).not.toContain('Minutes');
  expect(s.items[0]).toMatchObject({ value: '3', trend: 'up' });
  expect(s.items.find((i) => i.label === 'Days practised')).toMatchObject({ trend: 'none' });
  expect(JSON.stringify(d.blocks)).not.toContain('Win:');
  expect(JSON.stringify(d.blocks)).toContain('**This week:** Fix article errors');
  expect(d.subject).toBe('You are steady.');
});

it('the weekly template is listed for editing', async () => {
  const o = await testUser(OWNER_EMAILS[0]!);
  const list = (await (await req('/api/admin/emails', { headers: o.headers })).json()) as { key: string }[];
  expect(list.map((t) => t.key)).toContain('weekly-report');
});
