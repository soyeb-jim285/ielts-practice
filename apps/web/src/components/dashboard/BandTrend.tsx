import { useEffect, useRef, useState } from 'react';
import { formatBand, formatDate } from '@/lib/format';

export type BandPoint = { id: string; date: string; band: number };

const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

/**
 * One band over time, plain SVG: a 2 px line with an 8 px end marker on a surface ring, whole-band gridlines, the target as a dashed reference
 * labelled at its end, first and last dates on the axis, and a crosshair with a tooltip on hover or focus. One series, so the title outside names it
 * and there is no legend. `domain` is shared by small multiples so their heights compare; `compact` drops the axes for a sparkline in a card.
 */
export function BandTrend({ points, target, label, domain, height = 140, compact = false }: { points: BandPoint[]; target: number; label: string; domain?: [number, number]; height?: number; compact?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const values = points.map((p) => p.band);
  const [lo, hi] = domain ?? [Math.max(0, Math.floor(Math.min(...values, target)) - 1), 9];
  const M = compact ? { top: 6, right: 6, bottom: 6, left: 6 } : { top: 10, right: 56, bottom: 24, left: 26 };
  const iw = Math.max(0, w - M.left - M.right), ih = height - M.top - M.bottom, n = points.length;
  const x = (i: number) => M.left + (n > 1 ? (i / (n - 1)) * iw : iw / 2);
  const y = (v: number) => M.top + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo || 1)) * ih;
  const ticks = Array.from({ length: Math.floor(hi) - Math.ceil(lo) + 1 }, (_, k) => Math.ceil(lo) + k);
  const nearest = (px: number) => (n < 2 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px - M.left) / (iw || 1)) * (n - 1)))));
  const h = hover == null ? null : points[hover];

  return (
    <div ref={box} className="relative w-full" style={{ height }}>
      {w > 0 && (
        <svg
          width={w}
          height={height}
          role="img"
          aria-label={label}
          className="block overflow-visible outline-none"
          tabIndex={compact ? -1 : 0}
          onPointerMove={(e) => setHover(nearest(e.clientX - e.currentTarget.getBoundingClientRect().left))}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(n - 1)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setHover((v) => Math.max(0, (v ?? n - 1) - 1));
            if (e.key === 'ArrowRight') setHover((v) => Math.min(n - 1, (v ?? 0) + 1));
          }}
        >
          {!compact &&
            ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={M.left + iw} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
                <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-[var(--muted)] text-[11px] tabular-nums">
                  {t}
                </text>
              </g>
            ))}
          <line x1={M.left} x2={M.left + iw} y1={y(target)} y2={y(target)} stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="4 4" />
          {!compact && (
            <text x={M.left + iw + 6} y={y(target)} dy="0.32em" className="fill-[var(--muted)] text-[11px] tabular-nums">
              Target {formatBand(target)}
            </text>
          )}
          {h && <line x1={x(hover!)} x2={x(hover!)} y1={M.top} y2={M.top + ih} stroke="var(--line-strong)" strokeWidth={1} />}
          {n > 1 && <polyline fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={points.map((p, i) => `${x(i)},${y(p.band)}`).join(' ')} />}
          {points.map((p, i) => {
            const end = i === n - 1, on = i === hover;
            return (end || on || (!compact && n <= 12)) && <circle key={p.id} cx={x(i)} cy={y(p.band)} r={end || on ? 4 : 2.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={end || on ? 2 : 0} />;
          })}
          {!compact && n > 0 && (
            <g className="fill-[var(--muted)] text-[11px]">
              <text x={x(0)} y={height - 4} textAnchor={n > 1 ? 'start' : 'middle'}>{SHORT.format(new Date(points[0]!.date))}</text>
              {n > 1 && <text x={x(n - 1)} y={height - 4} textAnchor="end">{SHORT.format(new Date(points[n - 1]!.date))}</text>}
            </g>
          )}
        </svg>
      )}
      {h && (
        <div
          role="status"
          className="type-caption pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-[var(--surface)] px-2 py-1 text-ink shadow-sm"
          style={{ left: Math.min(Math.max(x(hover!), 60), w - 60), top: Math.max(0, y(h.band) - 40) }}
        >
          <span className="type-num font-semibold">{formatBand(h.band)}</span> · {formatDate(h.date)}
        </div>
      )}
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.id}>
              <th scope="row">{formatDate(p.date)}</th>
              <td>{formatBand(p.band)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
