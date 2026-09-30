import { describe, expect, it } from 'vitest';
import { practiceTarget, type Progress } from './criteria';

const t = (skill: 'speaking' | 'writing', part: number, fc: number): Progress['trend'][number] => ({ attemptId: 'a', date: '2026-01-01', skill, part, overall: fc, criteria: { fc, ta: fc } });

describe('practiceTarget', () => {
  it('picks the part where the criterion is lowest', () => {
    expect(practiceTarget('fc', [t('speaking', 1, 5), t('speaking', 2, 6.5), t('speaking', 3, 6)])).toMatchObject({ skill: 'speaking', part: 1, label: 'Part 1' });
    expect(practiceTarget('fc', [t('speaking', 1, 6.5), t('speaking', 3, 5), t('speaking', 3, 6)])).toMatchObject({ part: 3 });
  });
  it('ignores other skills and falls back to the default part', () => {
    expect(practiceTarget('fc', [t('writing', 1, 4)])).toMatchObject({ skill: 'speaking', part: 2 });
    expect(practiceTarget('ta', [t('writing', 1, 5), t('writing', 2, 6)])).toMatchObject({ skill: 'writing', label: 'Task 1' });
  });
});
