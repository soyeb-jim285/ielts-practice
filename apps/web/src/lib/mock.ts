import { queryOptions } from '@tanstack/react-query';
import { call, client, type Schemas } from './api';

export type Mock = NonNullable<Schemas['Mock']>;
export type MockSection = Mock['sections'][number];
export type MockSkill = MockSection['skill'];
export type MockOptions = Schemas['MockOptions'];

export const SKILLS: MockSkill[] = ['listening', 'reading', 'writing', 'speaking'];
export const SKILL_LABEL: Record<MockSkill, string> = { listening: 'Listening', reading: 'Reading', writing: 'Writing', speaking: 'Speaking' };

export const mockQuery = (id: string) =>
  queryOptions({
    queryKey: ['mock', id],
    queryFn: () => call(client.GET('/api/mock/{id}', { params: { path: { id } } })) as Promise<Mock>,
    // Marking runs in the background: keep looking while any section is still being marked.
    refetchInterval: (q) => (q.state.data?.sections.some((s) => s.state === 'marking') ? 5000 : false),
    staleTime: 0,
  });
export const currentMockQuery = queryOptions({ queryKey: ['mock', 'current'], queryFn: async () => (await call(client.GET('/api/mock/current'))).mock as Mock | null, staleTime: 0 });
export const mockListQuery = queryOptions({ queryKey: ['mock', 'list'], queryFn: () => call(client.GET('/api/mock')).then((r) => r.items as Mock[]), staleTime: 0 });
export const mockOptionsQuery = (variant: 'academic' | 'general') =>
  queryOptions({ queryKey: ['mock', 'options', variant], queryFn: () => call(client.GET('/api/mock/options', { params: { query: { variant } } })), staleTime: 0 });

/** "30 minutes plus a 2-minute check", "60 minutes": how long a section runs, for the transition copy. */
export const SECTION_TIME: Record<MockSkill, string> = {
  listening: 'about 30 minutes plus a 2-minute check',
  reading: '60 minutes',
  writing: '60 minutes for both tasks',
  speaking: '11 to 14 minutes',
};

/** The line on the transition screen: what just finished and what comes next. */
export function transitionCopy(mock: Pick<Mock, 'next' | 'sections'>): { title: string; body: string } | null {
  const next = mock.next;
  if (!next) return null;
  const prev = SKILLS[SKILLS.indexOf(next) - 1];
  const nextTime = `${SKILL_LABEL[next]}, ${SECTION_TIME[next]}`;
  if (!prev) return { title: 'Ready for Listening?', body: `Next: ${nextTime}. Nothing is running yet. The clock starts when you press Start.` };
  if (next === 'speaking') return { title: 'Writing finished. Choose how to do Speaking.', body: 'Speaking has no countdown, so you can take it now or later this week.' };
  return { title: `${SKILL_LABEL[prev]} finished.`, body: `Next: ${nextTime}. Nothing is running. The clock starts when you press Start.` };
}

type RowState = MockSection['state'];
/** Row status text per state; `speaking` has its own "not taken yet" wording. */
export function stateLabel(s: Pick<MockSection, 'skill' | 'state'>): { text: string; tone: 'neutral' | 'accent' | 'good' | 'warn' | 'bad' } {
  const t: Record<RowState, { text: string; tone: 'neutral' | 'accent' | 'good' | 'warn' | 'bad' }> = {
    todo: { text: s.skill === 'speaking' ? 'Not taken yet' : 'Not started', tone: 'neutral' },
    in_progress: { text: 'In progress', tone: 'accent' },
    submitted: { text: 'Submitted', tone: 'accent' },
    marking: { text: 'Being marked', tone: 'accent' },
    done: { text: 'Marked', tone: 'good' },
    failed: { text: 'Marking failed, retry', tone: 'bad' },
    skipped: { text: 'Skipped', tone: 'neutral' },
  };
  return t[s.state];
}

export const isFinished = (s: Pick<MockSection, 'state'>) => ['submitted', 'marking', 'done', 'failed'].includes(s.state);
