import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type SlideBox = { x: number; y: number; w: number; h: number };

/**
 * Tracks the active child of a `position: relative` container so a single indicator element can slide between items
 * (Tabs underline, Segmented thumb). The active child is the one with data-state="active" | "checked" (Radix).
 * `ready` flips after first paint so the initial placement doesn't animate.
 */
export function useSlide<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T>(null);
  const [box, setBox] = useState<SlideBox | null>(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => {
      const a = root.querySelector<HTMLElement>('[data-state="active"], [data-state="checked"]');
      setBox(a ? { x: a.offsetLeft, y: a.offsetTop, w: a.offsetWidth, h: a.offsetHeight } : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [dep]);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return { ref, box, ready };
}
