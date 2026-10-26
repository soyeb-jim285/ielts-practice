import { fakeFetch, chatReply } from '../test/helpers'; // first: loads the app before the modules that import it back
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { db } from '../db/client';
import { coachReports, lrAttempts, lrTests, userSettings } from '../db/schema';
import { setFetch } from '../ai/openrouter';
import { testUser } from '../test/helpers';
import { coachSweep, generateReport, isStale, localDay } from './report';

let n = 0;
let calls = 0;
const fake = () => { calls = 0; setFetch(fakeFetch({ '/chat/completions': () => { calls++; return chatReply('{}'); } })); }; // invalid words -> templates, still one call per model tried
async function test(userId: string, at: Date) {
  const [t] = await db.insert(lrTests).values({ slug: `rep-${++n}-${Math.random().toString(36).slice(2, 6)}`, skill: 'listening', variant: 'academic', source: 'generated', ref: 'X', title: 'x', data: { sections: [] } as never, restricted: false }).returning();
  await db.insert(lrAttempts).values({ userId, testId: t!.id, mode: 'practice', status: 'submitted', band: 6.5, elapsedS: 600, submittedAt: at, startedAt: at });
}
const rows = (userId: string) => db.select().from(coachReports).where(eq(coachReports.userId, userId)).orderBy(coachReports.day);
const modelCalls = () => calls;

it('skips a student with no tests', async () => {
  fake();
  const { user } = await testUser();
  expect(await generateReport(user.id)).toBe('skipped');
  expect(await rows(user.id)).toHaveLength(0);
});

it('creates once per local day', async () => {
  fake();
  const { user } = await testUser();
  await test(user.id, new Date());
  expect(await generateReport(user.id)).toBe('created');
  expect(await generateReport(user.id)).toBe('skipped');
  expect(await rows(user.id)).toHaveLength(1);
  const first = calls;
  expect(first).toBeGreaterThan(0);
  await generateReport(user.id);
  expect(modelCalls()).toBe(first);
});

it('uses the student local day: 23:30 and 00:30 Los Angeles are two reports', async () => {
  fake();
  const { user } = await testUser();
  await db.insert(userSettings).values({ userId: user.id, data: { timeZone: 'America/Los_Angeles' } });
  await test(user.id, new Date('2026-10-27T06:30:00Z'));
  expect(await generateReport(user.id, new Date('2026-10-27T06:31:00Z'))).toBe('created');
  await test(user.id, new Date('2026-10-27T07:30:00Z'));
  expect(await isStale(user.id, new Date('2026-10-27T07:31:00Z'))).toBe(true);
  expect(await generateReport(user.id, new Date('2026-10-27T07:31:00Z'))).toBe('created');
  expect((await rows(user.id)).map((r) => r.day)).toEqual(['2026-10-26', '2026-10-27']);
});

it('localDay falls back to UTC on an invalid zone', () => {
  const d = new Date('2026-10-27T06:30:00Z');
  expect(localDay(d, 'Mars/Base')).toBe('2026-10-27');
  expect(localDay(d, 'America/Los_Angeles')).toBe('2026-10-26');
});

it('two concurrent calls make one report and one model run', async () => {
  fake();
  const { user } = await testUser();
  await test(user.id, new Date());
  const r = await Promise.all([generateReport(user.id), generateReport(user.id)]);
  expect(r.sort()).toEqual(['created', 'skipped']);
  expect(await rows(user.id)).toHaveLength(1);
  const first = calls;
  await generateReport(user.id);
  expect(modelCalls()).toBe(first);
});

it('the sweep reports stale students and skips fresh ones', async () => {
  fake();
  const a = (await testUser()).user, b = (await testUser()).user, c = (await testUser()).user;
  for (const u of [a, b, c]) await test(u.id, new Date());
  await generateReport(c.id);
  const made = await coachSweep();
  expect(made).toBeGreaterThanOrEqual(2);
  expect(await rows(a.id)).toHaveLength(1);
  expect(await rows(b.id)).toHaveLength(1);
  expect(await rows(c.id)).toHaveLength(1);
});
