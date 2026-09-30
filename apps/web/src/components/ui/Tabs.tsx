import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from './Badge';
import { useSlide } from './slide';
import { Tabs as ShTabs, TabsList, TabsTrigger } from './shadcn/tabs';

export type TabItem<T extends string> = { value: T; label: ReactNode; count?: number };

/**
 * Underlined tab bar (results pages) on Radix Tabs (roving focus, Home/End, arrows). Controlled; render the active panel yourself:
 * <Tabs id="res" .../> then <div role="tabpanel" id={`res-panel`} aria-labelledby={`res-${value}`}>...</div>
 * The underline slides to the active tab; changing tab on a phone scrolls the bar to the top of the screen. Tabs share the width on phones; if they still don't fit, the bar scrolls sideways,
 * the right edge fades while more is hidden, and the active tab is kept in view.
 */
export function Tabs<T extends string>({ id, items, value, onChange, className }: { id: string; items: TabItem<T>[]; value: T; onChange: (v: T) => void; className?: string }) {
  const { ref: slideRef, box, ready } = useSlide<HTMLDivElement>(value);
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
  // On phones the hero above the tabs can fill the screen: bring the bar to the top so the new panel is what you see, not a sliver under the tab bar.
  const change = (v: string) => {
    onChange(v as T);
    const el = ref.current;
    if (el && matchMedia('(max-width: 47.99rem)').matches && el.getBoundingClientRect().top > 1) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
  };
  return (
    <ShTabs value={value} onValueChange={change}>
      <TabsList
        ref={(el) => {
          ref.current = el;
          slideRef.current = el;
        }}
        variant="line"
        onScroll={measure}
        className={cn('relative h-auto group-data-[orientation=horizontal]/tabs:h-auto w-full justify-start gap-0 overflow-x-auto rounded-none border-b border-border p-0 [scrollbar-width:none] sm:gap-1', more && '[mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)]', className)}
      >
        {items.map((t) => (
          <TabsTrigger
            key={t.value}
            value={t.value}
            // The consumer renders the panel, so point the ARIA pair at its ids instead of Radix's generated ones.
            id={`${id}-${t.value}`}
            aria-controls={`${id}-panel`}
            data-value={t.value}
            className="h-11 flex-none shrink-0 gap-1.5 rounded-none border-0 bg-transparent px-3 text-sm text-muted shadow-none after:hidden hover:text-ink data-[state=active]:bg-transparent data-[state=active]:text-ink max-sm:grow md:h-10"
          >
            {t.label}
            {t.count != null && <Badge className="type-num h-5 px-1.5">{t.count}</Badge>}
          </TabsTrigger>
        ))}
        {box && (
          <span
            aria-hidden
            className={cn('pointer-events-none absolute bottom-0 left-0 h-0.5 w-px origin-left bg-brand', ready && 'transition-transform duration-[320ms] ease-(--ease-out-expo)')}
            style={{ transform: `translateX(${box.x}px) scaleX(${box.w})` }}
          />
        )}
      </TabsList>
    </ShTabs>
  );
}
