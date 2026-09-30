import type { AnalysisError } from '@server/ai/types';
import { clsx } from 'clsx';
import { ArrowRight } from 'lucide-react';
import { Fragment, useMemo, useState, type KeyboardEvent } from 'react';
import { ErrorDetails } from '@/components/results';
import { Badge, Chip, Sheet } from '@/components/ui';
import { categoryLabel } from '@/lib/result';

/** Filter by top-level category ('grammar.tense' → 'grammar'). */
const group = (e: AnalysisError) => e.category.split('.')[0]!;

type Segment = { text: string; error?: AnalysisError };

/** Splits the essay at error char spans; overlapping or out-of-range spans are dropped (they still show in the list). */
export function segmentEssay(text: string, errors: AnalysisError[]): { segments: Segment[]; unplaced: AnalysisError[] } {
  const located = errors.filter((e) => e.start >= 0 && e.end > e.start && e.end <= text.length).sort((a, b) => a.start - b.start);
  const segments: Segment[] = [];
  const placed = new Set<string>();
  let cursor = 0;
  for (const e of located) {
    if (e.start < cursor) continue;
    if (e.start > cursor) segments.push({ text: text.slice(cursor, e.start) });
    segments.push({ text: text.slice(e.start, e.end), error: e });
    placed.add(e.id);
    cursor = e.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return { segments, unplaced: errors.filter((e) => !placed.has(e.id)) };
}

/** The submitted essay with every located mistake underlined; tap one for the correction. */
export function EssayHighlights({ text, errors }: { text: string; errors: AnalysisError[] }) {
  const [filter, setFilter] = useState<string | null>(null);
  const [open, setOpen] = useState<AnalysisError | null>(null);
  const { segments, unplaced } = useMemo(() => segmentEssay(text, errors), [text, errors]);
  const categories = useMemo(() => [...new Set(errors.map(group))], [errors]);
  const shown = (e: AnalysisError) => !filter || group(e) === filter;
  const onKey = (e: KeyboardEvent, err: AnalysisError) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(err);
    }
  };

  return (
    <div className="space-y-5">
      {categories.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter mistakes">
          <Chip selected={!filter} onClick={() => setFilter(null)}>
            All · {errors.length}
          </Chip>
          {categories.map((c) => (
            <Chip key={c} selected={filter === c} onClick={() => setFilter(filter === c ? null : c)}>
              {categoryLabel(c)} · {errors.filter((e) => group(e) === c).length}
            </Chip>
          ))}
        </div>
      )}

      <div className="prose-serif max-w-none whitespace-pre-wrap text-ink">
        {segments.map((s, i) =>
          s.error && shown(s.error) ? (
            // ponytail: <mark role=button> rather than <button> so long spans wrap across lines like the surrounding text.
            <mark
              key={i}
              role="button"
              tabIndex={0}
              aria-label={`${s.error.severity} ${categoryLabel(s.error.category)} mistake: ${s.text}`}
              onClick={() => setOpen(s.error!)}
              onKeyDown={(e) => onKey(e, s.error!)}
              className={clsx(
                'cursor-pointer rounded-[3px] text-ink underline decoration-2 underline-offset-[5px] transition-colors duration-150',
                s.error.severity === 'major' ? 'bg-bad-soft decoration-bad hover:bg-bad/20' : 'bg-warn-soft decoration-warn decoration-dotted hover:bg-warn/20',
                open?.id === s.error.id && 'ring-2 ring-accent',
              )}
            >
              {s.text}
            </mark>
          ) : (
            <Fragment key={i}>{s.text}</Fragment>
          ),
        )}
      </div>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-bad" aria-hidden /> Major
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0 w-4 border-t-2 border-dotted border-warn" aria-hidden /> Minor
        </span>
        <span>Tap an underlined phrase for the fix.</span>
      </p>

      {unplaced.filter(shown).length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Also noted</h3>
          <ul className="divide-y divide-line rounded-card border border-line">
            {unplaced.filter(shown).map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => setOpen(e)} className="flex w-full items-start gap-3 px-4 py-3 text-left text-sm hover:bg-ink/[0.03]">
                  <Badge tone={e.severity === 'major' ? 'bad' : 'warn'}>{categoryLabel(e.category)}</Badge>
                  <span className="min-w-0 flex-1">
                    <span className="text-muted line-through">{e.original}</span> <ArrowRight className="inline size-3.5 text-muted" aria-hidden /> {e.correction}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Sheet open={!!open} onClose={() => setOpen(null)} title={open ? `${categoryLabel(open.category)} · ${open.severity}` : ''}>
        {open && <ErrorDetails key={open.id} error={open} />}
      </Sheet>
    </div>
  );
}
