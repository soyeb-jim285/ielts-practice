import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Tabs as ShTabs, TabsList, TabsTrigger } from './shadcn/tabs';

export type TabItem<T extends string> = { value: T; label: ReactNode; count?: number };

/**
 * Underlined tab bar (results pages) on Radix Tabs (roving focus, Home/End, arrows). Controlled; render the active panel yourself:
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
  return (
    <ShTabs value={value} onValueChange={(v) => onChange(v as T)}>
      <TabsList
        ref={ref}
        variant="line"
        onScroll={measure}
        className={cn('h-auto group-data-[orientation=horizontal]/tabs:h-auto w-full justify-start gap-0 overflow-x-auto rounded-none border-b border-border p-0 [scrollbar-width:none] sm:gap-1', more && '[mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)]', className)}
      >
        {items.map((t) => (
          <TabsTrigger
            key={t.value}
            value={t.value}
            // The consumer renders the panel, so point the ARIA pair at its ids instead of Radix's generated ones.
            id={`${id}-${t.value}`}
            aria-controls={`${id}-panel`}
            data-value={t.value}
            className="h-11 flex-none shrink-0 gap-1 rounded-none border-0 border-b-2 border-transparent bg-transparent px-1 text-[0.8125rem] text-muted shadow-none after:hidden hover:text-ink data-[state=active]:border-brand data-[state=active]:bg-transparent data-[state=active]:text-ink max-sm:grow sm:gap-1.5 sm:px-3 sm:text-sm"
          >
            {t.label}
            {t.count != null && <span className="rounded-full bg-ink/6 px-1 text-xs text-muted tabular-nums sm:px-1.5 dark:bg-ink/10">{t.count}</span>}
          </TabsTrigger>
        ))}
      </TabsList>
    </ShTabs>
  );
}
