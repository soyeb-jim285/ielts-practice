import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Candidate, CoachFacts, CoachWords, SkillFacts } from '@server/coach/types';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Coach } from './data';
import { CoachView } from './CoachView';

const mocks = vi.hoisted(() => ({ post: vi.fn(), put: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, params, children, search: _s, ...rest }: { to: string; params?: Record<string, string>; search?: unknown; children: ReactNode }) => (
    <a href={Object.entries(params ?? {}).reduce((p, [k, v]) => p.replace(`$${k}`, v), to)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<object>()), client: { POST: mocks.post, PUT: mocks.put, GET: vi.fn() } }));
const me = { user: { isAnonymous: false, name: 'A', email: 'a@x' }, settings: { targetBand: 7, examDate: null, timeZone: 'UTC' } };
vi.mock('@/lib/query', async (orig) => ({ ...(await orig<object>()), useMe: () => ({ data: me }), useAccount: () => me }));

vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
beforeEach(() => {
  mocks.post.mockReset().mockResolvedValue({ data: { ok: true }, response: { ok: true } });
  mocks.put.mockReset().mockResolvedValue({ data: me.settings, response: { ok: true } });
});
afterEach(cleanup);

const skill = (s: SkillFacts['skill'], over: Partial<SkillFacts> = {}): SkillFacts => ({
  skill: s, tests: 5, band: 6.5, range: [6, 7], trend: 'steady', trendDelta: 0, needMore: 0, gap: 0.5, series: [{ at: '2026-10-01', band: 6 }, { at: '2026-10-02', band: 6.5 }], ...over,
});
const cand = (id: string, skillName: Candidate['skill'], attemptId: string): Candidate => ({
  id, skill: skillName, kind: id.split(':')[1]!, count: 6, tests: 3, share: 0.6, score: 1, facts: { count: 6, tests: 3, outOf: 5 }, evidence: { attemptIds: [attemptId] }, actions: ['see-evidence'],
});
const candidates = [cand('writing:ideas-undeveloped', 'writing', 'w1'), cand('listening:plural', 'listening', 'l1'), cand('reading:tfng-false-for-ng', 'reading', 'r1')];
const facts: CoachFacts = {
  version: 1, generatedFor: 'u', target: 7, examDate: null, daysToExam: null, totalTests: 17,
  skills: [skill('listening'), skill('reading'), skill('writing'), skill('speaking', { tests: 2, needMore: 1, trend: 'calibrating' })],
  overall: { band: 6.5, range: [6, 7] }, candidates, win: null,
  swaps: [
    { id: 'swap:writing:mistake:very important', skill: 'writing', from: 'very important', to: ['crucial'], count: 5, source: 'mistake', evidence: { attemptIds: ['w1'] } },
    { id: 'swap:writing:upgrade:a lot of', skill: 'writing', from: 'a lot of', to: ['many', 'a large number of'], count: 3, source: 'upgrade', evidence: { attemptIds: ['w1'] } },
  ],
  spelling: [], patterns: { writing: [candidates[0]!], speaking: [], listening: [candidates[1]!], reading: [candidates[2]!] }, timing: {}, reviewDue: 0,
  weekStats: { tests: 2, minutes: 60, days: 2, prev: { tests: 1, minutes: 20, days: 1 } },
};
const words: CoachWords = {
  summary: 'You are around 6.5 overall.',
  focus: [
    { candidateId: 'writing:ideas-undeveloped', title: 'Explain each idea', why: 'Came up 6 times.', action: 'write-task2', label: 'Write a Task 2 essay' },
    { candidateId: 'listening:plural', title: 'Check plurals', why: 'Came up 6 times.', action: 'listening-test', label: 'Take a Listening test' },
    { candidateId: 'reading:tfng-false-for-ng', title: 'Not Given is not False', why: 'Came up 6 times.', action: 'see-evidence', label: 'See where it happened' },
  ],
  win: null,
  cheat: [{ candidateId: 'listening:plural', text: 'Say the answer with the -s.' }],
  plan: [{ day: 'Today', text: 'Write a Task 2 essay', action: 'write-task2' }, { day: 'Sat', text: 'Take a Listening test', action: 'listening-test' }, { day: 'Sun', text: 'Take a Reading test', action: 'reading-test' }],
};
const ready: Coach = { state: 'ready', updating: false, report: { id: 'rep1', day: '2026-10-27', createdAt: '2026-10-27T08:00:00Z', facts, words, hidden: [] } };

const view = (data: Coach) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CoachView data={data} />
    </QueryClientProvider>,
  );
const focus = () => within(screen.getByRole('region', { name: "This week's focus" }));

it('empty state says what the coach will show and links to a first test', () => {
  view({ state: 'empty', updating: false, report: null });
  expect(screen.getByText(/after your first test/i)).toBeTruthy();
  expect(screen.getByRole('link', { name: /first essay/i }).getAttribute('href')).toBe('/writing');
});

it('empty while updating says the coach is reading, without the first-test link', () => {
  view({ state: 'empty', updating: true, report: null });
  expect(screen.getByText(/reading your tests/i)).toBeTruthy();
  expect(screen.queryByText(/after your first test/i)).toBeNull();
  expect(screen.queryByRole('link', { name: /first essay/i })).toBeNull();
});

it('a calibrating skill says how many more tests it needs', () => {
  view(ready);
  expect(screen.getByText(/1 more test/)).toBeTruthy();
});

it('focus renders 3 items, each with an evidence link to its result page', () => {
  view(ready);
  expect(focus().getAllByRole('article')).toHaveLength(3);
  const hrefs = focus().getAllByRole('link', { name: /see where it happened/i }).map((a) => a.getAttribute('href'));
  expect(hrefs).toEqual(['/writing/result/w1', '/lr/result/l1', '/lr/result/r1']);
});

it('"This is wrong" posts feedback and removes the item', async () => {
  view(ready);
  fireEvent.click(focus().getByRole('button', { name: 'This is wrong: Check plurals' }));
  expect(mocks.post).toHaveBeenCalledWith('/api/coach/feedback', { body: { reportId: 'rep1', itemKey: 'focus:listening:plural' } });
  await waitFor(() => expect(focus().getAllByRole('article')).toHaveLength(2));
  expect(focus().queryByText('Check plurals')).toBeNull();
});

it('items already hidden on the server stay hidden', () => {
  view({ ...ready, report: { ...ready.report!, hidden: ['focus:writing:ideas-undeveloped'] } });
  expect(focus().getAllByRole('article')).toHaveLength(2);
});

it('"Add all to Review" posts one vocab card per swap', async () => {
  view(ready);
  fireEvent.click(screen.getByRole('button', { name: /Add all to Review/ }));
  await waitFor(() => expect(mocks.post).toHaveBeenCalled());
  const [path, { body }] = mocks.post.mock.calls[0]!;
  expect(path).toBe('/api/cards/bulk');
  expect(body.cards).toHaveLength(2);
  expect(body.cards[0]).toMatchObject({ front: 'very important', back: 'crucial', source: 'vocab' });
});
