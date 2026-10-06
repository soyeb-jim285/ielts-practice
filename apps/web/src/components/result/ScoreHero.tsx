import type { ReactNode } from 'react';
import { formatBand } from '@/lib/format';
import { bandColor } from '@/lib/result';
import { cn } from '@/lib/utils';
import { BandNumeral } from './BandNumeral';
import { InfoNote } from './InfoNote';

const TONE_TEXT = { good: 'text-good-text', warn: 'text-warn-text', bad: 'text-bad-text' } as const;

/** "1.0 below your 7.0 target" / "At or above your 7.0 target". Pure so it can be tested. */
export function gapLine(value: number, target: number) {
  const tone = bandColor(value, target);
  const gap = target - value;
  return { tone, lead: gap <= 0 ? 'At or above' : `${formatBand(gap)} below`, rest: `your ${formatBand(target)} target` };
}

/**
 * The one focal point of a result view: hero numeral, then one lede line (gap to target), one caption line ("likely 5-7, AI estimate" + info note).
 * Phone: numeral left, text stack right, one row. `value=null` shows a dash and `emptyText`. `unit="raw"` shows a whole-number score (part-only Listening/Reading) with `total` as "of 13".
 * Props: value, label (sr-only, default "Overall band"), secondary (body line, e.g. "34 of 40 correct"), target, range ([lo, hi], capped at +-1 band), estimate (adds "AI estimate" + note), rawAverage (shown in the note), exceptions (Badges), emptyText, unit, total, children (extra lede text, e.g. "How this is calculated" copy inside the note).
 */
export function ScoreHero({ value, label = 'Overall band', decimals = 1, secondary, target, range, estimate, rawAverage, exceptions, emptyText, unit = 'band', total, note, lede, className }: {
  value: number | null;
  label?: string;
  decimals?: 1;
  secondary?: ReactNode;
  target?: number;
  range?: [number, number];
  estimate?: boolean;
  rawAverage?: number;
  exceptions?: ReactNode;
  emptyText?: ReactNode;
  unit?: 'band' | 'raw';
  total?: number;
  /** Extra explanation inside the info note, e.g. how the overall is calculated. */
  note?: ReactNode;
  /** Replaces the gap line when you need other lede copy ("Part 2 only. Take the full test for a band score."). */
  lede?: ReactNode;
  className?: string;
}) {
  const empty = value == null;
  const g = !empty && unit === 'band' && target != null ? gapLine(value, target) : null;
  const likely = !empty && unit === 'band' && range && value > 0 ? `likely ${formatRangeCapped(range, value)}` : null;
  const hasNote = estimate || rawAverage != null || note;
  return (
    <div className={cn('flex items-center gap-x-5 sm:items-end sm:gap-x-10', className)}>
      <p>
        <span className="sr-only">{label} </span>
        {unit === 'raw' && !empty ? <BandNumeral value={value} size="hero" decimals={0} /> : <BandNumeral value={value} size="hero" decimals={decimals} />}
        {!empty && (secondary || g) && (
          <span className="sr-only">
            {secondary ? <>, {secondary}</> : null}
            {g ? <>, {g.lead.startsWith('At') ? 'meets' : `${g.lead.split(' ')[0]} under`} target {formatBand(target!)}</> : null}
          </span>
        )}
      </p>
      <div className="min-w-0 flex-1 space-y-1 sm:pb-2">
        {empty ? (
          emptyText && <p className="type-lede max-w-[68ch]">{emptyText}</p>
        ) : (
          <>
            {unit === 'raw' && total != null && <p className="type-body type-num">of {total}</p>}
            {secondary && <p className="type-body type-num">{secondary}</p>}
            {lede ? <p className="type-lede max-w-[68ch]">{lede}</p> : g && <p className="type-lede type-num"><span className={cn('font-medium', TONE_TEXT[g.tone])}>{g.lead}</span> {g.rest}</p>}
            {(likely || hasNote) && (
              <p className="type-caption type-num flex flex-wrap items-center gap-x-1">
                <span>{[likely, estimate && 'AI estimate'].filter(Boolean).join(', ')}</span>
                {hasNote && (
                  <InfoNote label="About this score">
                    {estimate && <p>Estimate from AI scoring, not an official IELTS result. It may be off by about a band.</p>}
                    {rawAverage != null && <p>Average before rounding: {rawAverage.toFixed(2)}</p>}
                    {note}
                  </InfoNote>
                )}
              </p>
            )}
          </>
        )}
        {exceptions && <div className="flex flex-wrap items-center gap-2 pt-1">{exceptions}</div>}
      </div>
    </div>
  );
}

/** "5–7", with the range capped at +-1 band around the value (a wider range says nothing). */
export function formatRangeCapped([lo, hi]: [number, number], value: number) {
  const a = Math.max(lo, value - 1);
  const b = Math.min(hi, value + 1);
  return a === b ? formatBand(a) : `${a}–${b}`;
}
