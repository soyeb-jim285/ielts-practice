import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { addHighlight, lsGet, lsSet, type Highlight, type LrSection } from '@/lib/lr';
import { cn } from '@/lib/utils';

/** Highlights of one section's passage, remembered in localStorage per attempt. */
export function useHighlights(key: string) {
  const [all, setAll] = useState<Highlight[]>(() => lsGet(key, []));
  useEffect(() => setAll(lsGet(key, [])), [key]);
  const update = (next: Highlight[]) => {
    setAll(next);
    lsSet(key, next);
  };
  return { highlights: all, add: (h: Highlight) => update(addHighlight(all, h)), remove: (h: Highlight) => update(all.filter((x) => x !== h)) };
}

/** Passage text convention: a paragraph starting "### " is a text heading; "• " lines are bullets (newline separated, shown with pre-line). */
export const headingOf = (text: string) => (text.startsWith('### ') ? text.slice(4).trim() : null);

/** A question's answer sits in this sentence: a small tappable "Q7" pill (right / wrong by shape and word, not colour alone). */
export interface QPin { s: number; n: number; correct: boolean }

function Paragraph({ index, text, marks, pins = [], onPin, picked, onRemove }: { index: number; text: string; marks: (Highlight & { evidence?: boolean })[]; pins?: QPin[]; onPin?: (n: number) => void; picked?: number | null; onRemove?: (h: Highlight) => void }) {
  const parts: ReactNode[] = [];
  let at = 0;
  const plain = (from: number, to: number, last = false) => {
    let x = from;
    for (const p of pins.filter((q) => q.s >= from && (last ? q.s <= to : q.s < to)).sort((a, b) => a.s - b.s)) {
      if (p.s > x) parts.push(text.slice(x, p.s));
      x = p.s;
      parts.push(
        <button
          key={`q${p.n}`}
          type="button"
          onClick={() => onPin?.(p.n)}
          aria-label={`Question ${p.n}, ${p.correct ? 'right' : 'wrong'}: show details`}
          aria-current={picked === p.n || undefined}
          className={cn('type-num mr-1 inline-flex h-6 min-w-6 cursor-pointer items-center justify-center border px-1.5 align-baseline text-xs font-semibold no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', p.correct ? 'rounded-full border-good bg-good-soft text-good-text' : 'rounded-[4px] border-bad bg-bad-soft text-bad-text', picked === p.n && 'ring-2 ring-ink')}
        >
          Q{p.n}
        </button>,
      );
    }
    if (to > x) parts.push(text.slice(x, to));
  };
  [...marks].sort((a, b) => a.s - b.s).forEach((m) => {
    if (m.s > at || pins.some((q) => q.s === m.s)) plain(at, m.s, true);
    parts.push(
      <mark
        key={m.s}
        data-evidence={m.evidence ? '' : undefined}
        onClick={() => !m.evidence && onRemove?.(m)}
        title={m.evidence ? 'Where the answer is' : onRemove ? 'Click to remove highlight' : undefined}
        className={cn('rounded-[3px] px-0.5 text-ink [box-decoration-break:clone]', m.evidence ? 'bg-accent-soft underline decoration-accent decoration-2 underline-offset-4' : 'bg-warn-soft', !m.evidence && onRemove && 'cursor-pointer hover:bg-warn/30')}
      >
        {text.slice(m.s, m.e)}
      </mark>,
    );
    at = m.e;
  });
  if (at < text.length || pins.some((q) => q.s >= at)) plain(at, text.length, true);
  return <span data-p={index} className="whitespace-pre-line">{parts}</span>;
}

/**
 * The reading passage in the book serif. Select text to highlight it (kept per attempt in localStorage), click a highlight to remove it.
 * Paragraph labels sit in a gutter outside the highlightable text so offsets stay plain character offsets.
 */
export function Passage({ section, highlights, evidence, onAdd, onRemove }: { section: LrSection; highlights?: Highlight[]; /** review: the span holding the answer, scrolled into view */ evidence?: Highlight | null; onAdd?: (h: Highlight) => void; onRemove?: (h: Highlight) => void }) {
  const p = section.passage;
  const root = useRef<HTMLDivElement>(null);
  if (!p) return null;
  const labelled = p.paragraphs.some((x) => x.label);

  const capture = () => {
    const sel = window.getSelection();
    if (!onAdd || !sel || sel.isCollapsed || !sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    const el = (n: Node) => (n instanceof Element ? n : n.parentElement)?.closest<HTMLElement>('[data-p]') ?? null;
    const a = el(r.startContainer);
    const b = el(r.endContainer);
    if (!a || a !== b || !root.current?.contains(a)) return;
    const pre = document.createRange();
    pre.selectNodeContents(a);
    pre.setEnd(r.startContainer, r.startOffset);
    const s = pre.toString().length;
    const e = s + r.toString().length;
    if (e > s && r.toString().trim()) onAdd({ p: Number(a.dataset.p), s, e });
    sel.removeAllRanges();
  };

  return (
    <article ref={root} onMouseUp={capture} onTouchEnd={() => setTimeout(capture, 50)} className="space-y-4">
      <header>
        <h2 className="type-heading text-balance">{p.title}</h2>
        {p.subtitle && <p className="type-reading-sm mt-1 italic text-muted">{p.subtitle}</p>}
      </header>
      <div className="space-y-4">
        {p.paragraphs.map((para, i) => {
          const heading = headingOf(para.text);
          if (heading !== null) return <h3 key={i} className="type-reading mt-2 font-semibold text-balance">{heading}</h3>;
          return (
          <div key={i} className={labelled ? 'grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3' : undefined}>
            {labelled && (
              <span aria-hidden className={para.label ? 'type-num mt-1.5 grid size-7 place-items-center self-start rounded-md bg-surface-2 text-sm font-semibold text-muted' : undefined}>
                {para.label}
              </span>
            )}
            <p className="type-reading max-w-[68ch] text-pretty selection:bg-warn-soft">
              {para.label && <span className="sr-only">Paragraph {para.label}. </span>}
              <Paragraph index={i} text={para.text} marks={[...(highlights ?? []).filter((h) => h.p === i), ...(evidence?.p === i ? [{ ...evidence, evidence: true }] : [])]} onRemove={onRemove} />
            </p>
          </div>
          );
        })}
      </div>
    </article>
  );
}

/** Two panes with a draggable divider (arrow keys too). Ratio of the left pane persists. Desktop only: phones use tabs instead. */
export function Split({ left, right }: { left: ReactNode; right: ReactNode }) {
  const [pct, setPct] = useState(() => lsGet('lr:split', 50));
  const box = useRef<HTMLDivElement>(null);
  const clamp = (v: number) => Math.min(75, Math.max(25, v));
  const commit = (v: number) => {
    setPct(v);
    lsSet('lr:split', v);
  };
  const drag = (e: PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1 || !box.current) return;
    const r = box.current.getBoundingClientRect();
    setPct(clamp(((e.clientX - r.left) / r.width) * 100));
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') commit(clamp(pct - 3));
    if (e.key === 'ArrowRight') commit(clamp(pct + 3));
  };
  return (
    <div ref={box} className="grid h-full min-h-0" style={{ gridTemplateColumns: `minmax(0,${pct}fr) 12px minmax(0,${100 - pct}fr)` }}>
      <div className="min-h-0 overflow-y-auto px-6 py-6 lg:px-10">{left}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize passage and questions"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={25}
        aria-valuemax={75}
        tabIndex={0}
        onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
        onPointerMove={drag}
        onPointerUp={() => commit(pct)}
        onKeyDown={key}
        className="group relative cursor-col-resize touch-none border-x border-line bg-surface-2 outline-none hover:bg-accent-soft focus-visible:bg-accent-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <span aria-hidden className="absolute top-1/2 left-1/2 h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-line-strong group-hover:bg-brand" />
      </div>
      <div className="min-h-0 overflow-y-auto px-6 py-6 lg:px-8">{right}</div>
    </div>
  );
}

/** Listening transcript, one paragraph per line, with the evidence span marked (results page). */
export function Transcript({ text, evidence, pins, onPin, picked }: { text: string; evidence?: Highlight | null; pins?: (QPin & { p: number })[]; onPin?: (n: number) => void; picked?: number | null }) {
  return (
    <div className="space-y-3">
      {text.split('\n').map((line, i) =>
        line.trim() ? (
          <p key={i}>
            <Paragraph index={i} text={line} marks={evidence?.p === i ? [{ ...evidence, evidence: true }] : []} pins={pins?.filter((q) => q.p === i)} onPin={onPin} picked={picked} />
          </p>
        ) : null,
      )}
    </div>
  );
}
