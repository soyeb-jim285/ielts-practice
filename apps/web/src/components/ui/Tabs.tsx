import { clsx } from 'clsx';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

export type TabItem<T extends string> = { value: T; label: ReactNode; count?: number };

/**
 * Underlined tab bar (results pages). Controlled; render the active panel yourself:
 * <Tabs id="res" .../> then <div role="tabpanel" id={`res-panel`} aria-labelledby={`res-${value}`}>…</div>
 * Scrolls sideways when it doesn't fit (phones): the right edge fades as a cue and the active tab is kept in view.
 */
export function Tabs<T extends string>({ id, items, value, onChange, className }: { id: string; items: TabItem<T>[]; value: T; onChange: (v: T) => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
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
    <div ref={ref} role="tablist" onKeyDown={onKey} className={clsx(
        'flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none] max-sm:pr-8 max-sm:[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]',
        className,
      )}>
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
              '-mb-px flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-sm sm:px-3 font-medium transition-colors duration-150',
              active ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {t.label}
            {t.count != null && <span className="rounded-full bg-ink/6 px-1.5 text-xs tabular-nums text-muted dark:bg-ink/10">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
