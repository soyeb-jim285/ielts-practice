import { expect, it } from 'vitest';
import { OWNER_EMAILS } from '../auth';
import { db } from '../db/client';
import { coachReports } from '../db/schema';
import { guestUser, req, testUser } from '../test/helpers';
import type { CoachFacts, CoachWords } from '../coach/types';

const facts = { version: 1, generatedFor: 'x', target: 7, examDate: null, daysToExam: null, totalTests: 0, skills: [], overall: null, candidates: [], win: null, swaps: [], spelling: [], patterns: { listening: [], reading: [], writing: [], speaking: [] }, timing: {}, reviewDue: 0, weekStats: { tests: 0, minutes: 0, days: 0, prev: { tests: 0, minutes: 0, days: 0 } } } as CoachFacts;
const words: CoachWords = { summary: 'Hi', focus: [], win: null, cheat: [], plan: [] };
const seed = async (userId: string) => (await db.insert(coachReports).values({ userId, day: '2026-10-27', lastTestAt: new Date(), facts, words }).returning({ id: coachReports.id }))[0]!.id;
const get = async (h: Headers) => (await req('/api/coach', { headers: h })).json() as Promise<{ state: string; updating: boolean; report: { id: string; facts: CoachFacts; words: CoachWords; hidden: string[] } | null }>;

it('a guest with no history sees empty', async () => {
  const g = await guestUser();
  expect(await get(g.headers)).toEqual({ state: 'empty', updating: false, report: null });
});

it('shows the report, and feedback hides the item key', async () => {
  const u = await testUser();
  const id = await seed(u.user.id);
  const a = await get(u.headers);
  expect(a).toMatchObject({ state: 'ready', updating: false, report: { id, words: { summary: 'Hi' }, hidden: [] } });
  expect(a.report!.facts.target).toBe(7);
  expect((await req('/api/coach/feedback', { headers: u.headers, body: { reportId: id, itemKey: 'c1', note: 'wrong' } })).status).toBe(200);
  expect((await req('/api/coach/feedback', { headers: u.headers, body: { reportId: id, itemKey: 'c1' } })).status).toBe(200); // repeat is fine
  expect((await get(u.headers)).report!.hidden).toEqual(['c1']);

  const owner = await testUser(OWNER_EMAILS[0]!);
  const list = (await (await req('/api/admin/coach-feedback', { headers: owner.headers })).json()) as { email: string; itemKey: string; note: string; day: string }[];
  expect(list.find((r) => r.email === u.user.email)).toMatchObject({ itemKey: 'c1', note: 'wrong', day: '2026-10-27' });
});

it('another user report is 404 for feedback; admin list is 404 for non-owners', async () => {
  const a = await testUser();
  const b = await testUser();
  const id = await seed(a.user.id);
  expect((await req('/api/coach/feedback', { headers: b.headers, body: { reportId: id, itemKey: 'c1' } })).status).toBe(404);
  expect((await req('/api/admin/coach-feedback', { headers: b.headers })).status).toBe(404);
});
