import type { RepeatedWord } from '@ielts/core';
import type { AnalysisError } from '@server/ai/types';
import { clsx } from 'clsx';
import { ArrowRight, MapPinOff } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { highlightWords, LeanPill } from '@/components/LeanPill';
import { ErrorDetails } from '@/components/results';
import { Disclosure, Section } from '@/components/result';
import { Chip, Popover, Sheet } from '@/components/ui';
import { categoryLabel } from '@/lib/result';
import { countWords } from './WritingEditor';

/** Filter by top-level category ('grammar.tense' → 'grammar'). */
const group = (e: AnalysisError) => e.category.split('.')[0]!;

type Segment = { text: string; error?: AnalysisError };

const TASK_TITLE: Record<string, string> = { 'task.relevance': 'Off-topic phrase', 'task.overview': 'Missing overview', 'task.position': 'Unclear position' };
/** Plain-language sheet title: 'grammar.agreement' → 'Grammar: agreement'. */
export const errorTitle = (c: string) => TASK_TITLE[c] ?? categoryLabel(c);

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

/** Scroll a located mistake to the middle of the screen, then open its explanation (popover on desktop, sheet on phones). */
function revealMistake(id: string) {
  const el = document.getElementById(`err-${id}`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  el.focus({ preventScroll: true });
  setTimeout(() => el.click(), 250);
}

const LG = '(min-width: 64rem)';
/** True from `lg` up, where the mistakes list sits beside the essay instead of under it. */
function useWide() {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia(LG);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => matchMedia(LG).matches,
    () => true,
  );
}

/** One row of the mistakes list: the fix first, why in one line, then category and severity. Full detail opens on select. */
function MistakeRow({ e, placed, onSelect, onHover }: { e: AnalysisError; placed: boolean; onSelect: () => void; onHover: (on: boolean) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        onFocus={() => onHover(true)}
        onBlur={() => onHover(false)}
        className="flex min-h-11 w-full flex-col items-start gap-1 px-1 py-3 text-left transition-colors duration-150 hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:ring-inset"
      >
        {e.original && <span className="type-caption line-clamp-2 text-muted line-through decoration-bad/50">{e.original}</span>}
        <span className="type-body line-clamp-3 text-ink">{e.correction || e.explanation}</span>
        {e.correction && e.explanation && <span className="type-caption line-clamp-1">{e.explanation}</span>}
        <span className="type-caption flex items-center gap-1.5">
          <span className={e.severity === 'major' ? 'text-bad-text' : 'text-warn-text'}>{e.severity === 'major' ? 'Major' : 'Minor'}</span>
          <span aria-hidden>·</span>
          <span>{errorTitle(e.category)}</span>
          {!placed && <MapPinOff role="img" className="size-4 shrink-0" aria-label="Not located in the text" />}
        </span>
      </button>
    </li>
  );
}

/**
 * The submitted essay with every located mistake underlined; tap one for the correction.
 * From `lg` a sticky margin list sits beside the essay (every mistake with its fix, click to jump to it); below that it is a disclosure under the essay.
 */
export function EssayHighlights({ text, errors, lean, onClear }: { text: string; errors: AnalysisError[]; lean?: RepeatedWord | null; onClear?: () => void }) {
  const [filter, setFilter] = useState<string | null>(null);
  const [open, setOpen] = useState<AnalysisError | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const essay = useRef<HTMLDivElement>(null);
  const wide = useWide();
  useEffect(() => {
    if (lean) essay.current?.querySelector('[data-lean]')?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [lean]);
  const { segments, unplaced } = useMemo(() => segmentEssay(text, errors), [text, errors]);
  const categories = useMemo(() => [...new Set(errors.map(group))], [errors]);
  const shown = (e: AnalysisError) => !filter || group(e) === filter;
  const unplacedIds = useMemo(() => new Set(unplaced.map((e) => e.id)), [unplaced]);
  const list = useMemo(() => [...errors].sort((a, b) => Number(unplacedIds.has(a.id)) - Number(unplacedIds.has(b.id)) || a.start - b.start).filter(shown), [errors, unplacedIds, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows =
    list.length === 0 ? (
      <p className="type-caption">No mistakes in this category.</p>
    ) : (
      <ul className="divide-y divide-line">
        {list.map((e) => {
          const placed = !unplacedIds.has(e.id);
          return <MistakeRow key={e.id} e={e} placed={placed} onSelect={() => (placed ? revealMistake(e.id) : setOpen(e))} onHover={(on) => setHover(on ? e.id : null)} />;
        })}
      </ul>
    );

  return (
    <div className="grid items-start gap-8 md:gap-12 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-8 md:space-y-12">
        <Section title="Your essay" caption="Select an underlined phrase for the fix.">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            {categories.length > 1 ? (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filter mistakes">
                <Chip selected={!filter} onClick={() => setFilter(null)}>
                  All <span className="type-num opacity-70">{errors.length}</span>
                </Chip>
                {categories.map((c) => (
                  <Chip key={c} selected={filter === c} onClick={() => setFilter(filter === c ? null : c)}>
                    {categoryLabel(c)} <span className="type-num opacity-70">{errors.filter((e) => group(e) === c).length}</span>
                  </Chip>
                ))}
              </div>
            ) : (
              <span />
            )}
            <p className="type-caption flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-4 rounded bg-bad" aria-hidden /> Major
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0 w-4 border-t-2 border-dotted border-warn" aria-hidden /> Minor
              </span>
            </p>
          </div>

          {lean && onClear && <LeanPill lean={lean} onClear={onClear} />}

          <div ref={essay} className="type-reading max-w-[68ch] whitespace-pre-wrap text-ink">
            {segments.map(({ text: t, error: err }, i) =>
              err && shown(err) ? (
                <Mistake key={i} error={err} onSheet={setOpen}>
                  {(p) => (
                    // ponytail: <mark role=button> rather than <button> so long spans wrap across lines like the surrounding text.
                    <mark
                      ref={p.ref}
                      id={`err-${err.id}`}
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
                        (p.expanded || open?.id === err.id || hover === err.id) && 'ring-2 ring-brand',
                      )}
                    >
                      {highlightWords(t, lean)}
                    </mark>
                  )}
                </Mistake>
              ) : (
                <Fragment key={i}>{highlightWords(t, lean)}</Fragment>
              ),
            )}
          </div>
        </Section>

        {!wide && (
          <section aria-label="All mistakes">
            <Disclosure level={2} title="Mistakes" meta={list.length}>
              {rows}
            </Disclosure>
          </section>
        )}
      </div>

      {wide && (
        <aside aria-label="All mistakes" className="lg:sticky lg:top-16 lg:max-h-[calc(100dvh-5rem)] lg:overflow-y-auto">
          <Section title="Mistakes" caption={`${list.length} ${list.length === 1 ? 'mistake' : 'mistakes'}${filter ? ` in ${categoryLabel(filter)}` : ''}`}>
            {rows}
          </Section>
        </aside>
      )}

      <Sheet open={!!open} onClose={() => setOpen(null)} title={open ? errorTitle(open.category) : ''}>
        {open && <ErrorDetails key={open.id} error={open} hideCategory />}
      </Sheet>
    </div>
  );
}
