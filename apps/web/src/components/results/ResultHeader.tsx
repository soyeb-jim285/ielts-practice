import type { AnalysisResult } from '@server/ai/types';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui';
import { formatBand, formatRange } from '@/lib/format';
import { bandColor } from '@/lib/result';

const TONE_TEXT = { good: 'text-good-text', warn: 'text-warn-text', bad: 'text-bad-text' };
const VERDICT = { good: 'At or above your target', warn: 'Just below your target', bad: 'Below your target' };

/**
 * Top of a results page: eyebrow meta, prompt title, big overall band with "likely" range (capped at ±1 band) and target verdict.
 * Props: result, title (prompt title), meta (e.g. "Speaking · Part 2 · 3 Oct"), target band, actions (right side), children (under the title, e.g. session switcher).
 */
export function ResultHeader({ result, title, meta, target, actions, children }: { result: AnalysisResult; title: ReactNode; meta?: ReactNode; target: number; actions?: ReactNode; children?: ReactNode }) {
  const tone = bandColor(result.overall, target);
  return (
    <header className="mb-6 flex flex-col gap-5 md:mb-8 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0 space-y-2">
        {meta && <p className="text-sm text-muted">{meta}</p>}
        <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-[1.75rem]">{title}</h1>
        {children}
      </div>
      <div className="flex shrink-0 items-end gap-4">
        <div>
          <p className="text-sm text-muted">Overall band</p>
          <p className={`text-5xl font-semibold tracking-tight tabular-nums ${TONE_TEXT[tone]}`}>{formatBand(result.overall)}</p>
        </div>
        <div className="space-y-1.5 pb-1.5">
          {result.overall > 0 && <Badge tone="neutral">likely {formatRange([Math.max(result.range[0], result.overall - 1), Math.min(result.range[1], result.overall + 1)])}</Badge>}
          {result.overall > 0 && result.calibrated === false && (
            <Badge tone="warn" title="Estimated with an unvalidated model: scores may be off by about a band.">uncalibrated</Badge>
          )}
          <p className="text-xs text-muted tabular-nums" title={`Average of the four criteria before IELTS rounding: ${result.overallRaw.toFixed(2)}`}>
            {VERDICT[tone]} ({formatBand(target)})
          </p>
        </div>
        {actions}
      </div>
    </header>
  );
}
