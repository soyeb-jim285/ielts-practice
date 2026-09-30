import { clsx } from 'clsx';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export type TabItem<T extends string> = { value: T; label: ReactNode; count?: number };

/**
 * Underlined tab bar (results pages). Controlled; render the active panel yourself:
 * <Tabs id="res" .../> then <div role="tabpanel" id={`res-panel`} aria-labelledby={`res-${value}`}>…</div>
 * Tabs share the width on phones; if they still don't fit, the bar scrolls sideways, the right edge fades while more is hidden, and the active tab is kept in view.
 */
export function Tabs<T extends string>({ id, items, value, onChange, className }: { id: string; items: TabItem<T>[]; value: T; onChange: (v: T) => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false); // tabs hidden past the right edge
  const measure = () => {
    const c = ref.current;
    if (c) setMore(c.scrollWidth - c.scrollLeft - c.clientWidth > 1);
  };
  useEffect(() => {
    const ro = new ResizeObserver(measure);
    ro.observe(ref.current!);
    return () => ro.disconnect();
  }, []);
  // Keep the active tab in view horizontally only (scrollIntoView would also scroll the page).
  useEffect(() => {
    const c = ref.current;
    const b = c?.querySelector(`[data-value="${value}"]`);
    if (!c || !b) return;
    const cr = c.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    if (br.left < cr.left || br.right > cr.right - 32) c.scrollLeft += br.left - cr.left - 16;
  }, [value]);
  const onKey = (e: KeyboardEvent) => {
    const i = items.findIndex((t) => t.value === value);
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const next = e.key === 'Home' ? items[0] : e.key === 'End' ? items.at(-1) : d ? items[(i + d + items.length) % items.length] : undefined;
    if (!next) return;
    e.preventDefault();
    onChange(next.value);
    ref.current?.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus();
  };
  return (
    <div
      ref={ref}
      role="tablist"
      onKeyDown={onKey}
      onScroll={measure}
      className={clsx('flex overflow-x-auto border-b border-line [scrollbar-width:none] sm:gap-1', more && '[mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)]', className)}
    >
      {items.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            id={`${id}-${t.value}`}
            data-value={t.value}
            role="tab"
            type="button"
            aria-selected={active}
            aria-controls={`${id}-panel`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.value)}
            className={clsx(
              '-mb-px flex h-11 shrink-0 items-center justify-center gap-1 sm:gap-1.5 border-b-2 px-1 text-[0.8125rem] font-medium whitespace-nowrap transition-colors duration-150 max-sm:grow sm:px-3 sm:text-sm',
              active ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {t.label}
            {t.count != null && <span className="rounded-full bg-ink/6 px-1 text-xs sm:px-1.5 tabular-nums text-muted dark:bg-ink/10">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
