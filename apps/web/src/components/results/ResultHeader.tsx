import type { AnalysisResult } from '@server/ai/types';
import type { ReactNode } from 'react';
import { Badge, CountUp, PageHeader } from '@/components/ui';
import { formatBand, formatRange } from '@/lib/format';
import { bandColor } from '@/lib/result';

const TONE_TEXT = { good: 'text-good-text', warn: 'text-warn-text', bad: 'text-bad-text' };

/**
 * Top of a results page: the standard PageHeader (prompt title, meta line, back link), then a summary strip with the overall band,
 * the one place the big figure lives: a counted-up Hanken numeral coloured against the target, its "likely" range (capped at +-1 band),
 * the gap to the target, and `children` (session switcher, word-count badges).
 * Props: result, title (prompt title), meta (e.g. "Speaking, Part 2, 3 Oct"), target band, back (link above), actions (next to the score), children.
 */
export function ResultHeader({ result, title, meta, target, actions, back, children }: { result: AnalysisResult; title: ReactNode; meta?: ReactNode; target: number; actions?: ReactNode; back?: ReactNode; children?: ReactNode }) {
  const tone = bandColor(result.overall, target);
  const gap = target - result.overall;
  return (
    <>
      <PageHeader title={title} description={meta} back={back} className="mb-6 md:mb-8" />
      <div className="mb-8 flex flex-wrap items-end gap-x-6 gap-y-5 border-y md:gap-x-10 border-line py-6 md:mb-10">
        <div>
          <p className="type-caption">Overall band</p>
          <p className={`type-band mt-1 text-7xl ${TONE_TEXT[tone]}`}>
            <CountUp value={result.overall} decimals={1} />
          </p>
        </div>
        <div className="min-w-0 flex-1 basis-44 space-y-2 pb-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {result.overall > 0 && <Badge className="type-num">likely {formatRange([Math.max(result.range[0], result.overall - 1), Math.min(result.range[1], result.overall + 1)])}</Badge>}
            {result.overall > 0 && result.calibrated === false && (
              <Badge tone="warn" title="Estimated with an unvalidated model: scores may be off by about a band.">
                uncalibrated
              </Badge>
            )}
          </div>
          <p className="type-lede type-num" title={`Average of the four criteria before IELTS rounding: ${result.overallRaw.toFixed(2)}`}>
            {gap <= 0 ? `At or above your ${formatBand(target)} target` : `${formatBand(gap)} below your ${formatBand(target)} target`}
          </p>
          {children && <div className="pt-1">{children}</div>}
        </div>
        {actions}
      </div>
    </>
  );
}
