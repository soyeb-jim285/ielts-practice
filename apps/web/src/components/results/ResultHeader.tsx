import type { AnalysisResult } from '@server/ai/types';
import type { ReactNode } from 'react';
import { Badge, CountUp, PageHeader } from '@/components/ui';
import { formatBand, formatRange } from '@/lib/format';
import { bandColor } from '@/lib/result';

const TONE_TEXT = { good: 'text-good-text', warn: 'text-warn-text', bad: 'text-bad-text' };

/**
 * Top of a results page: the standard PageHeader (prompt title, meta line, back link), then a summary strip with the overall band,
 * the one place the big figure lives: a counted-up Hanken numeral in ink (the band colour is only on the gap-to-target line, so a
 * below-target score does not read as an error), its "likely" range (capped at +-1 band), and the gap to the target.
 * One row on phones (numeral left, chips and gap right) so the tabs stay near the top; `children` (session switcher, word-count badges) sit under it.
 * Props: result, title (prompt title), meta (e.g. "Speaking, Part 2, 3 Oct"), target band, back (link above), actions (next to the score), flags (extra badges beside "AI estimate"), children.
 */
export function ResultHeader({ result, title, meta, target, actions, back, flags, children }: { result: AnalysisResult; title: ReactNode; meta?: ReactNode; target: number; actions?: ReactNode; back?: ReactNode; flags?: ReactNode; children?: ReactNode }) {
  const tone = bandColor(result.overall, target);
  const gap = target - result.overall;
  return (
    <>
      <PageHeader title={title} description={meta} back={back} className="mb-4 sm:mb-6 md:mb-8" />
      <div className="mb-6 border-y border-line py-4 sm:mb-8 sm:py-6 md:mb-10">
        <div className="flex items-center gap-x-4 sm:items-end sm:gap-x-10">
          <div>
            <p className="type-caption hidden sm:block">Overall band</p>
            <p className="type-band text-6xl sm:mt-1 sm:text-7xl">
              <span className="sr-only">Overall band </span>
              <CountUp value={result.overall} decimals={1} />
            </p>
          </div>
          <div className="min-w-0 flex-1 space-y-1.5 sm:space-y-2 sm:pb-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {result.overall > 0 && <Badge className="type-num">likely {formatRange([Math.max(result.range[0], result.overall - 1), Math.min(result.range[1], result.overall + 1)])}</Badge>}
              {result.overall > 0 && result.calibrated === false && (
                <Badge tone="warn" title="Estimate from AI scoring, not an official IELTS result. It may be off by about a band.">
                  AI estimate
                </Badge>
              )}
              {flags}
            </div>
            <p className="type-lede type-num max-sm:text-sm" title={`Average of the four criteria before IELTS rounding: ${result.overallRaw.toFixed(2)}`}>
              <span className={`font-medium ${TONE_TEXT[tone]}`}>{gap <= 0 ? 'At or above' : `${formatBand(gap)} below`}</span> your {formatBand(target)} target
            </p>
          </div>
          {actions}
        </div>
        {children && <div className="pt-3 sm:pt-4">{children}</div>}
      </div>
    </>
  );
}
