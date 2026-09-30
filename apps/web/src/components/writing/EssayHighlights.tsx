import type { AnalysisError } from '@server/ai/types';
import { clsx } from 'clsx';
import { ArrowRight } from 'lucide-react';
import { Fragment, useMemo, useState, type ReactNode, type RefObject } from 'react';
import { ErrorDetails } from '@/components/results';
import { Badge, Chip, Popover, Sheet } from '@/components/ui';
import { categoryLabel } from '@/lib/result';
import { countWords } from './WritingEditor';

/** Filter by top-level category ('grammar.tense' → 'grammar'). */
const group = (e: AnalysisError) => e.category.split('.')[0]!;

type Segment = { text: string; error?: AnalysisError };

const TASK_TITLE: Record<string, string> = { 'task.relevance': 'Off-topic phrase', 'task.overview': 'Missing overview', 'task.position': 'Unclear position' };
/** Plain-language sheet title: 'grammar.agreement' → 'Grammar: agreement'. */
export const errorTitle = (c: string) => TASK_TITLE[c] ?? categoryLabel(c).replace(' · ', ': ');

type TriggerProps = { ref: RefObject<HTMLElement | null>; open: () => void; expanded: boolean };
/** md+: popover anchored to the phrase; phones: the bottom sheet (`onSheet`). */
function Mistake({ error, onSheet, children }: { error: AnalysisError; onSheet: (e: AnalysisError) => void; children: (p: TriggerProps) => ReactNode }) {
  return (
    <Popover
      // The popover sits inside the serif essay in the DOM; reset what it would inherit.
      className="w-[22rem] font-sans whitespace-normal"
      trigger={(p) =>
        children({
          ref: p.ref as RefObject<HTMLElement | null>,
          expanded: p['aria-expanded'],
          // Radix light-dismisses on pointerdown, then this click toggles: re-clicking an open phrase reopens it.
          open: () => (matchMedia('(min-width: 48rem)').matches ? p.onClick() : onSheet(error)),
        })
      }
    >
      <ErrorDetails error={error} />
    </Popover>
  );
}

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

  return (
    <div className="mx-auto max-w-[68ch] space-y-6">
      {categories.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter mistakes">
          <Chip selected={!filter} onClick={() => setFilter(null)}>
            All <span className="tabular-nums opacity-70">{errors.length}</span>
          </Chip>
          {categories.map((c) => (
            <Chip key={c} selected={filter === c} onClick={() => setFilter(filter === c ? null : c)}>
              {categoryLabel(c)} <span className="tabular-nums opacity-70">{errors.filter((e) => group(e) === c).length}</span>
            </Chip>
          ))}
        </div>
      )}

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-bad" aria-hidden /> Major
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0 w-4 border-t-2 border-dotted border-warn" aria-hidden /> Minor
        </span>
        <span>Select an underlined phrase for the fix.</span>
      </p>

      <div className="prose-serif whitespace-pre-wrap text-ink">
        {segments.map(({ text: t, error: err }, i) =>
          err && shown(err) ? (
            <Mistake key={i} error={err} onSheet={setOpen}>
              {(p) => (
                // ponytail: <mark role=button> rather than <button> so long spans wrap across lines like the surrounding text.
                <mark
                  ref={p.ref}
                  role="button"
                  tabIndex={0}
                  aria-haspopup="dialog"
                  aria-expanded={p.expanded}
                  aria-label={`${err.severity} ${categoryLabel(err.category)} mistake: ${t}`}
                  onClick={p.open}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), p.open())}
                  className={clsx(
                    'cursor-pointer rounded-[3px] text-ink underline underline-offset-[5px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring',
                    err.severity === 'minor'
                      ? 'bg-warn-soft decoration-1 decoration-warn decoration-dotted hover:bg-warn/20'
                      : // Whole-sentence errors: a pink block over a full line is too heavy, so underline only.
                        clsx('decoration-2 decoration-bad hover:bg-bad/10', countWords(t) <= 8 ? 'bg-bad-soft' : 'bg-transparent'),
                    (p.expanded || open?.id === err.id) && 'ring-2 ring-brand',
                  )}
                >
                  {t}
                </mark>
              )}
            </Mistake>
          ) : (
            <Fragment key={i}>{t}</Fragment>
          ),
        )}
      </div>


      {unplaced.filter(shown).length > 0 && (
        <section>
          <h3 className="mb-2 text-base font-semibold">Also noted</h3>
          <ul className="divide-y divide-line rounded-lg bg-surface-2 px-1">
            {unplaced.filter(shown).map((e) => (
              <li key={e.id}>
                <Mistake error={e} onSheet={setOpen}>
                  {(p) => (
                    <button
                      ref={p.ref as RefObject<HTMLButtonElement | null>}
                      type="button"
                      aria-haspopup="dialog"
                      aria-expanded={p.expanded}
                      onClick={p.open}
                      className="flex min-h-11 w-full items-start gap-3 rounded-lg px-3 py-3 text-left text-sm outline-none transition-colors duration-150 hover:bg-hover focus-visible:ring-[3px] focus-visible:ring-ring/40"
                    >
                      <Badge tone={e.severity === 'major' ? 'bad' : 'warn'}>{categoryLabel(e.category)}</Badge>
                      <span className="min-w-0 flex-1">
                        <span className="text-muted line-through">{e.original}</span> <ArrowRight className="inline size-3.5 text-muted" aria-hidden /> {e.correction}
                      </span>
                    </button>
                  )}
                </Mistake>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Sheet open={!!open} onClose={() => setOpen(null)} title={open ? errorTitle(open.category) : ''}>
        {open && <ErrorDetails key={open.id} error={open} hideCategory />}
      </Sheet>
    </div>
  );
}
