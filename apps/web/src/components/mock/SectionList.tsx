import type { LinkProps } from '@tanstack/react-router';
import { SkillBandStrip, type SkillBandItem } from '@/components/result';
import { isFinished, stateLabel, type Mock, type MockSection } from '@/lib/mock';

/** Where a finished section's normal result page lives. */
export function resultLink(s: MockSection): LinkProps {
  const id = s.attemptId!;
  if (s.skill === 'listening' || s.skill === 'reading') return { to: '/lr/result/$attemptId', params: { attemptId: id } };
  if (s.skill === 'writing') return { to: '/writing/result/$attemptId', params: { attemptId: id }, search: {} };
  return { to: '/speaking/result/$attemptId', params: { attemptId: id }, search: s.sessionId ? { session: s.sessionId } : {} };
}

export function meta(s: MockSection) {
  if (s.state === 'in_progress' && s.elapsedS) return `${Math.floor(s.elapsedS / 60)} min used${s.limitS ? ` of ${Math.round(s.limitS / 60)}` : ''}`;
  if (s.skill === 'speaking' && s.mode && s.state !== 'skipped') return s.mode === 'live' ? 'Live examiner' : 'Recorded test';
  return null;
}

/** The four sections in order as one band strip: a band per section, state text only when there is no band yet, each finished one a link to its normal result. */
export function SectionList({ mock, target }: { mock: Pick<Mock, 'sections'>; target: number }) {
  const items: SkillBandItem[] = mock.sections.map((s) => ({
    skill: s.skill,
    band: s.band,
    target,
    to: s.attemptId && isFinished(s) ? resultLink(s) : undefined,
    offer: meta(s),
    state: stateLabel(s).text,
  }));
  return <SkillBandStrip items={items} />;
}
