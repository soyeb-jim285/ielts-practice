import { useQuery } from '@tanstack/react-query';
import { gapLine, ScoreHero, Section, SkillBandStrip, type SkillBandItem } from '@/components/result';
import { BalanceMeter } from '@/components/community/BalanceMeter';
import { useQuota } from '@/lib/community';
import { lrProgressQuery } from '@/lib/lr';
import { formatBand } from '@/lib/format';
import { averageBand, overallEstimate } from './overall';
import type { Progress } from './criteria';

/** Per-skill average (last up to 5 results) from the two progress feeds; speaking and writing come from the trend rows (`overall`), listening and reading from the LR trend. */
export function useSkillBands(p: Progress) {
  const { data: lr } = useQuery(lrProgressQuery);
  const rows = (skill: 'speaking' | 'writing') => p.trend.filter((t) => t.skill === skill && t.overall != null).map((t) => t.overall as number);
  const lrRows = (skill: 'listening' | 'reading') => (lr?.trend ?? []).filter((t) => t.skill === skill).map((t) => t.band);
  return {
    lr,
    bands: {
      listening: averageBand(lrRows('listening')),
      reading: averageBand(lrRows('reading')),
      writing: { ...averageBand(rows('writing')), band: p.predicted.writing ?? averageBand(rows('writing')).band },
      speaking: { ...averageBand(rows('speaking')), band: p.predicted.speaking ?? averageBand(rows('speaking')).band },
    },
  };
}

/** The focal block: the overall band estimate, then the four skills as equal peers, then what you can still start today. */
export function YourPicture({ p, target }: { p: Progress; target: number }) {
  const { bands } = useSkillBands(p);
  const { data: quota } = useQuota();
  const items: SkillBandItem[] = [
    { skill: 'listening', ...bands.listening, to: { to: '/listening' }, target, state: 'Not tried', offer: bands.listening.band == null ? 'Take a free test' : undefined },
    { skill: 'reading', ...bands.reading, to: { to: '/reading' }, target, offer: bands.reading.band == null ? 'Take a free test' : undefined },
    { skill: 'writing', ...bands.writing, to: { to: '/writing' }, target, offer: bands.writing.band == null ? 'Take a test' : undefined },
    { skill: 'speaking', ...bands.speaking, to: { to: '/speaking' }, target, offer: bands.speaking.band == null ? 'Take a test' : undefined },
  ];
  const { value, count } = overallEstimate(items.map((i) => i.band));
  return (
    <Section title="Your IELTS picture" id="picture">
      <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center">
        <ScoreHero
          label="Overall band estimate"
          value={value}
          lede={value != null ? <Lede value={value} target={target} count={count} /> : undefined}
          emptyText={`Take two skills to see an overall estimate. Your target is ${formatBand(target)}.`}
        />
        <SkillBandStrip items={items} />
      </div>
      {quota?.tier !== 'own-key' && <BalanceMeter className="w-full sm:w-64 md:hidden" />}
    </Section>
  );
}

const TONE = { good: 'text-good-text', warn: 'text-warn-text', bad: 'text-bad-text' } as const;
function Lede({ value, target, count }: { value: number; target: number; count: number }) {
  const g = gapLine(value, target);
  return (
    <>
      <span className={`font-medium ${TONE[g.tone]}`}>{g.lead}</span> {g.rest}
      <span className="type-caption mt-1 block">From {count} of 4 skills, average of your last results</span>
    </>
  );
}
