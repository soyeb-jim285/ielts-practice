import { queryOptions } from '@tanstack/react-query';
import type { LinkProps } from '@tanstack/react-router';
import type { ActionType, Candidate, CoachFacts, CoachWords, Skill } from '@server/coach/types';
import { call, client } from '@/lib/api';

export type { ActionType, Candidate, CoachFacts, CoachWords, Skill };
export type Report = { id: string; day: string; createdAt: string; hidden: string[]; facts: CoachFacts; words: CoachWords };
export type Coach = { state: 'empty' | 'ready'; updating: boolean; report: Report | null };

/** The schema types facts/words loosely; the server's TS types are the contract, so the cast lives here only. */
export const coachQuery = queryOptions({
  queryKey: ['coach'],
  queryFn: async () => (await call(client.GET('/api/coach'))) as Coach,
  staleTime: 0,
});

/** Mirrors ACTIONS in apps/server/src/coach/actions.ts (routes and minutes); the server only sends the action type. */
export const ACTION: Record<ActionType, { minutes: number; to?: LinkProps['to'] }> = {
  'write-task2': { minutes: 40, to: '/writing' },
  'write-task1': { minutes: 20, to: '/writing' },
  'speak-part': { minutes: 5, to: '/speaking' },
  'speak-full': { minutes: 14, to: '/speaking' },
  'listening-test': { minutes: 40, to: '/listening' },
  'reading-test': { minutes: 60, to: '/reading' },
  'see-evidence': { minutes: 5 },
  'review-deck': { minutes: 10, to: '/review' },
};

/** The result page of the newest test behind a pattern; History when it names none. */
export function evidenceLink(c: Pick<Candidate, 'skill' | 'evidence'>): LinkProps {
  const attemptId = c.evidence.attemptIds[0] ?? c.evidence.lr?.[0]?.attemptId;
  if (!attemptId) return { to: '/history' }; // as the server's seeEvidence
  if (c.skill === 'writing') return { to: '/writing/result/$attemptId', params: { attemptId }, search: {} };
  if (c.skill === 'speaking') return { to: '/speaking/result/$attemptId', params: { attemptId }, search: {} };
  return { to: '/lr/result/$attemptId', params: { attemptId } };
}

export const actionLink = (action: ActionType, c?: Candidate): LinkProps | null => (action === 'see-evidence' ? (c ? evidenceLink(c) : null) : { to: ACTION[action].to });

/** Feedback key of one item; the server stores it as-is (max 100 chars), `hidden` returns the same strings. */
export const itemKey = (section: 'focus' | 'pattern' | 'cheat', id: string) => `${section}:${id}`.slice(0, 100);

export type Feedback = { hidden: Set<string>; wrong: (key: string) => void };

const PRETTY: Record<string, string> = {
  plural: 'Missing plural -s',
  spelling: 'Spelling',
  'word-limit': 'Over the word limit',
  'tfng-false-for-ng': 'False chosen for Not Given',
  'ideas-undeveloped': 'Ideas listed, not explained',
  'under-length': 'Under 250 words',
  'passage-timing': 'Started Passage 3 late',
  'fluency-pauses': 'Long pauses mid-sentence',
  'fluency-fillers': 'Fillers like "um" and "like"',
  'fluency-hesitation': 'Hesitation',
  'answers-undeveloped': 'Answers without a reason or example',
  collocation: 'Word pairs (collocations)',
  'word-choice': 'Word choice',
  pronunciation: 'Pronunciation of single words',
};

/** "grammar.articles" -> "Articles", "question-type:Matching headings" -> "Matching headings". */
export function patternLabel(kind: string) {
  if (PRETTY[kind]) return PRETTY[kind];
  if (kind.startsWith('question-type:')) return kind.slice(14);
  if (kind.startsWith('pronunciation-')) return `The sound ${kind.slice(14)}`;
  const s = kind.slice(kind.lastIndexOf('.') + 1).replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const SKILL_LABEL: Record<Skill, string> = { listening: 'Listening', reading: 'Reading', writing: 'Writing', speaking: 'Speaking' };
