import { Card, CountUp } from '@/components/ui';
import { formatDate } from '@/lib/format';
import type { Mock } from '@/lib/mock';
import { bandColor } from '@/lib/result';
import { cn } from '@/lib/utils';

const BAND_TEXT = { good: 'text-good-text', warn: 'text-warn-text', bad: 'text-bad-text' };

/** The headline of a mock: the overall band, or why there is none yet. The four-row list under it is SectionList. */
export function MockResult({ mock, target }: { mock: Mock; target: number }) {
  const pending = mock.sections.some((s) => s.state === 'marking');
  const closed = mock.status === 'closed';
  const note = mock.overall != null ? `Mean of your four section bands, to the nearest half band. Target ${target.toFixed(1)}.` : closed ? 'This mock was finished without Speaking, so it has no overall band.' : pending ? 'Overall appears when all four sections are marked. Marking takes about a minute.' : 'Overall appears when all four sections are marked.';
  return (
    <Card tone="hero" className="flex items-center justify-between gap-6 sm:p-7">
      <div className="min-w-0">
        <p className="type-caption font-medium text-accent-text">Overall band</p>
        <p className="type-lede mt-2 max-w-[44ch]">{note}</p>
        <p className="type-caption mt-2">{mock.ref ? `${mock.ref}, ` : ''}{mock.variant === 'academic' ? 'Academic' : 'General Training'}, started {formatDate(mock.startedAt)}</p>
      </div>
      <p className={cn('type-band shrink-0 text-6xl', mock.overall != null ? BAND_TEXT[bandColor(mock.overall, target)] : 'text-muted')} aria-label={mock.overall != null ? `Overall band ${mock.overall.toFixed(1)}` : 'No overall band yet'}>
        {mock.overall != null ? <CountUp value={mock.overall} decimals={1} /> : <span aria-hidden>-</span>}
      </p>
    </Card>
  );
}
