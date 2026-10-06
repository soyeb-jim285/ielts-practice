import { roundBand } from '@ielts/core';
import type { AnalysisResult, CriterionKey } from '@server/ai/types';
import type { ReactNode } from 'react';
import { CriteriaStrip, DetailField, FixList, Section, type CriterionItem } from '@/components/result';
import { formatBand, formatRange } from '@/lib/format';
import { criterionLabel } from '@/lib/result';

/** How the headline number relates to the criteria rows (hero info note) and which criterion pulls it down (Summary caption). */
export function bandSummary(result: AnalysisResult, order: CriterionKey[], capNote?: string) {
  const bands = order.flatMap((k) => (result.criteria[k] ? [{ k, band: result.criteria[k]!.band }] : []));
  const low = bands.reduce((m, x) => (x.band < m.band ? x : m), bands[0] ?? { k: order[0]!, band: 0 });
  const spread = bands.length ? Math.max(...bands.map((x) => x.band)) - low.band : 0;
  const avg = bands.length ? roundBand(bands.reduce((t, x) => t + x.band, 0) / bands.length) : 0;
  const capped = !!capNote && avg > result.overall;
  const how = capped
    ? `Average of these ${bands.length} bands would be ${formatBand(avg)}, capped at ${formatBand(result.overall)} because ${capNote}.`
    : `Overall ${formatBand(result.overall)} is the average of these ${bands.length} bands, rounded to the nearest half band.`;
  const pulls = !capped && spread >= 2 ? `${criterionLabel(low.k)} (${formatBand(low.band)}) pulls it down without capping it.` : null;
  return { how, pulls, weakest: spread > 0 ? low.k : null };
}

/** "Up 1 since last try" / "Unchanged since last try". Words, not colour, carry the direction. */
export const sinceLast = (d: number) => (d > 0 ? `Up ${d} since last try` : d < 0 ? `Down ${Math.abs(d)} since last try` : 'Unchanged since last try');

/** Hero line for a retry: "Up 0.5 from your last try (6.5)". */
export function lastTryLine(overall: number, parent: number) {
  const d = Math.round((overall - parent) * 10) / 10;
  return d > 0 ? `Up ${d} from your last try (${formatBand(parent)})` : d < 0 ? `Down ${Math.abs(d)} from your last try (${formatBand(parent)})` : `Same as your last try (${formatBand(parent)})`;
}

const sentences = (s: string) => s.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)?.map((x) => x.trim()) ?? [s];

/** Overview tab: alert, fixes first, then one row per criterion (first sentence of the advice, the rest and the evidence behind "Show details"). */
export function OverviewPanel({ result, order, target, alert, capNote }: { result: AnalysisResult; order: CriterionKey[]; target: number; alert?: ReactNode; capNote?: string }) {
  const { pulls, weakest } = bandSummary(result, order, capNote);
  const items: CriterionItem[] = order.flatMap((k) => {
    const c = result.criteria[k];
    if (!c) return [];
    const [first = '', ...rest] = sentences(c.summary);
    const d = result.comparison?.deltas[k];
    return [
      {
        key: k,
        label: criterionLabel(k),
        band: c.band,
        target,
        weakest: k === weakest,
        gist: (
          <>
            {first}
            {d != null && <span className="type-caption type-num mt-1 block">{sinceLast(d)}</span>}
          </>
        ),
        detail: (
          <>
            {rest.length > 0 && <p className="type-body max-w-[68ch]">{rest.join(' ')}</p>}
            <DetailField label="Likely band"><p className="type-body type-num">{formatRange(c.range)}</p></DetailField>
            {c.evidence.length > 0 && (
              <DetailField label="Evidence from your answer">
                <ul className="space-y-2">
                  {c.evidence.map((q) => (
                    <li key={q} className="type-reading-sm border-l-2 border-line pl-3">
                      {'“'}
                      {q}
                      {'”'}
                    </li>
                  ))}
                </ul>
              </DetailField>
            )}
            {c.descriptor && (
              <DetailField label="Band descriptor"><p className="type-body">{c.descriptor}</p></DetailField>
            )}
          </>
        ),
      },
    ];
  });
  return (
    <>
      {alert}
      <Section title="Summary" caption={pulls}>
        <CriteriaStrip layout="rows" items={items} />
      </Section>
      {result.topFixes.length > 0 && (
        <Section title={result.topFixes.length === 1 ? 'One thing to fix next' : `${result.topFixes.length} things to fix next`}>
          <FixList items={result.topFixes} />
        </Section>
      )}
    </>
  );
}
