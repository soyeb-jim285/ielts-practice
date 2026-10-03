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

function Paragraph({ index, text, marks, onRemove }: { index: number; text: string; marks: Highlight[]; onRemove?: (h: Highlight) => void }) {
  const parts: ReactNode[] = [];
  let at = 0;
  [...marks].sort((a, b) => a.s - b.s).forEach((m) => {
    if (m.s > at) parts.push(text.slice(at, m.s));
    parts.push(
      <mark
        key={m.s}
        onClick={() => onRemove?.(m)}
        title={onRemove ? 'Click to remove highlight' : undefined}
        className={cn('rounded-[3px] bg-warn-soft px-0.5 text-ink [box-decoration-break:clone]', onRemove && 'cursor-pointer hover:bg-warn/30')}
      >
        {text.slice(m.s, m.e)}
      </mark>,
    );
    at = m.e;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <span data-p={index}>{parts}</span>;
}

/**
 * The reading passage in the book serif. Select text to highlight it (kept per attempt in localStorage), click a highlight to remove it.
 * Paragraph labels sit in a gutter outside the highlightable text so offsets stay plain character offsets.
 */
export function Passage({ section, highlights, onAdd, onRemove }: { section: LrSection; highlights?: Highlight[]; onAdd?: (h: Highlight) => void; onRemove?: (h: Highlight) => void }) {
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
        {p.paragraphs.map((para, i) => (
          <div key={i} className={labelled ? 'grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3' : undefined}>
            {labelled && (
              <span aria-hidden className={para.label ? 'type-num mt-1.5 grid size-7 place-items-center self-start rounded-md bg-surface-2 text-sm font-semibold text-muted' : undefined}>
                {para.label}
              </span>
            )}
            <p className="type-reading max-w-[68ch] text-pretty selection:bg-warn-soft">
              {para.label && <span className="sr-only">Paragraph {para.label}. </span>}
              <Paragraph index={i} text={para.text} marks={(highlights ?? []).filter((h) => h.p === i)} onRemove={onRemove} />
            </p>
          </div>
        ))}
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
