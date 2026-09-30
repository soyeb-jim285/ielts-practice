import type { AnalysisResult } from '@server/ai/types';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui';
import { formatBand, formatRange } from '@/lib/format';
import { bandColor } from '@/lib/result';

const TONE_TEXT = { good: 'text-good-text', warn: 'text-warn-text', bad: 'text-bad-text' };

/**
 * Top of a results page: meta line, prompt title, and a score panel with the overall band (coloured), its "likely" range (capped at ±1 band) and the gap to the target.
 * Props: result, title (prompt title), meta (e.g. "Speaking · Part 2 · 3 Oct"), target band, actions (inside the score panel), children (under the title, e.g. session switcher).
 */
export function ResultHeader({ result, title, meta, target, actions, children }: { result: AnalysisResult; title: ReactNode; meta?: ReactNode; target: number; actions?: ReactNode; children?: ReactNode }) {
  const tone = bandColor(result.overall, target);
  const gap = target - result.overall;
  return (
    <header className="mb-6 flex flex-col gap-5 md:mb-8 md:flex-row md:items-center md:justify-between md:gap-10">
      <div className="min-w-0 max-w-2xl space-y-2">
        {meta && <p className="text-sm text-muted-foreground">{meta}</p>}
        <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-[1.75rem]">{title}</h1>
        {children}
      </div>
      <div className="flex shrink-0 items-center gap-5 rounded-card border border-border bg-card px-5 py-4 shadow-card">
        <div>
          <p className="text-sm text-muted-foreground">Overall band</p>
          <p className={`text-5xl leading-none font-semibold tracking-tight tabular-nums ${TONE_TEXT[tone]}`}>{formatBand(result.overall)}</p>
        </div>
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            {result.overall > 0 && <Badge>likely {formatRange([Math.max(result.range[0], result.overall - 1), Math.min(result.range[1], result.overall + 1)])}</Badge>}
            {result.overall > 0 && result.calibrated === false && (
              <Badge tone="warn" title="Estimated with an unvalidated model: scores may be off by about a band.">uncalibrated</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground tabular-nums" title={`Average of the four criteria before IELTS rounding: ${result.overallRaw.toFixed(2)}`}>
            {gap <= 0 ? `At or above your ${formatBand(target)} target` : `${formatBand(gap)} below your ${formatBand(target)} target`}
          </p>
        </div>
        {actions}
      </div>
    </header>
  );
}
