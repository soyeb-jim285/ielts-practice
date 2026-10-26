import type { ActionType, Candidate } from './types.js';

export type { ActionType };

const seeEvidence = (c: Candidate) => {
  const id = c.evidence.attemptIds[0] ?? c.evidence.lr?.[0]?.attemptId ?? '';
  if (!id) return '/history';
  return c.skill === 'writing' ? `/writing/result/${id}` : c.skill === 'speaking' ? `/speaking/result/${id}` : `/lr/result/${id}`;
};

export const ACTIONS: Record<ActionType, { label: string; minutes: number; route: (c: Candidate) => string }> = {
  'write-task2': { label: 'Write a Task 2 essay', minutes: 40, route: () => '/writing' },
  'write-task1': { label: 'Write a Task 1 report', minutes: 20, route: () => '/writing' },
  'speak-part': { label: 'Practise one speaking part', minutes: 5, route: () => '/speaking' },
  'speak-full': { label: 'Do a full speaking test', minutes: 14, route: () => '/speaking' },
  'listening-test': { label: 'Take a Listening test', minutes: 40, route: () => '/listening' },
  'reading-test': { label: 'Take a Reading test', minutes: 60, route: () => '/reading' },
  'see-evidence': { label: 'See where it happened', minutes: 5, route: seeEvidence },
  'review-deck': { label: 'Review your saved items', minutes: 10, route: () => '/review' },
};
