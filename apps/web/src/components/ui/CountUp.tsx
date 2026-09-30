import { useLayoutEffect, useRef } from 'react';

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Number that counts up from 0 on mount (600ms ease-out). Renders the final value first, so it is correct without JS timing; writes text directly, no re-renders. */
export function CountUp({ value, decimals = 0, duration = 600, className }: { value: number; decimals?: number; duration?: number; className?: string }) {
  const el = useRef<HTMLSpanElement>(null);
  const fmt = (n: number) => n.toFixed(decimals);
  useLayoutEffect(() => {
    const node = el.current;
    if (!node || reduced()) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      node.textContent = fmt(value * (1 - (1 - p) ** 4));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    node.textContent = fmt(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, decimals, duration]);
  return (
    <span ref={el} className={className}>
      {fmt(value)}
    </span>
  );
}
