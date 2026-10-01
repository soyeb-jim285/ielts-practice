import type { CriterionKey } from '@server/ai/types';
import { useEffect, useRef, useState } from 'react';
import { formatBand, formatDate } from '@/lib/format';
import { criterionLabel } from '@/lib/result';
import { CRITERION_SHORT, SERIES_COLOR, SERIES_DASH, type Progress } from './criteria';

const swatch = (k: CriterionKey) => (
  <svg width="18" height="8" aria-hidden className="shrink-0">
    <line x1="0" y1="4" x2="18" y2="4" stroke={SERIES_COLOR[k]} strokeWidth="2.5" strokeDasharray={SERIES_DASH[k]} strokeLinecap="round" />
  </svg>
);

const M = { top: 8, right: 96, bottom: 22, left: 30 }; // right: room for the direct series labels

/**
 * Per-criterion band lines for one skill, oldest to newest (x axis: attempt number, dates in the hover card), with the target as a dashed reference and each line labelled at its end. Plain SVG (a 30-point, 4-series
 * line chart does not need recharts' ~100 KB): fixed height so nothing shifts, width follows the container.
 */
export default function CriteriaTrend({ trend, keys, target }: { trend: Progress['trend']; keys: CriterionKey[]; target: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [{ w, h }, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e!.contentRect.width), h: Math.round(e!.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const latest = trend.at(-1)?.criteria ?? {};
  const lo = Math.max(0, Math.min(Math.floor(Math.min(...trend.flatMap((t) => Object.values(t.criteria)))), target) - 0.5);
  const ticks = [3, 4, 5, 6, 7, 8, 9].filter((t) => t >= lo);
  const n = trend.length;
  const iw = Math.max(0, w - M.left - M.right);
  const ih = h - M.top - M.bottom;
  const x = (i: number) => M.left + (n > 1 ? (i / (n - 1)) * iw : iw / 2);
  const y = (v: number) => M.top + (1 - (v - lo) / (9 - lo)) * ih;
  const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 80))));
  const labelIdx = Array.from({ length: n }, (_, i) => i).filter((i) => (n - 1 - i) % step === 0);
  const row = hover == null ? null : trend[hover];
  // Direct labels at each line's end, pushed apart so equal latest scores (Fluency / Pronunciation) stay readable.
  const ends = keys
    .flatMap((k) => (latest[k] == null ? [] : [{ k, y: y(latest[k]!) }]))
    .sort((a, b) => a.y - b.y)
    .reduce<{ k: CriterionKey; y: number }[]>((acc, e) => [...acc, { ...e, y: Math.max(e.y, (acc.at(-1)?.y ?? -Infinity) + 13) }], []);

  return (
    <div>
      <ul className="mb-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:flex sm:flex-wrap" aria-label="Latest band per criterion">
        {keys.map((k) => (
          <li key={k} className="flex min-w-0 items-center gap-2 text-sm">
            {swatch(k)}
            <span className="truncate text-muted">{criterionLabel(k)}</span>
            <span className="type-num font-semibold">{formatBand(latest[k])}</span>
          </li>
        ))}
        <li className="flex items-center gap-2 text-sm text-muted">
          <svg width="18" height="8" aria-hidden className="shrink-0">
            <line x1="0" y1="4" x2="18" y2="4" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="2 3" />
          </svg>
          Target {formatBand(target)}
        </li>
      </ul>
      <div ref={box} className="relative h-56 md:h-72" role="img" aria-label={`Band trend over your last ${n} attempts, oldest first`}>
        {w > 0 && h > 0 && (
          <svg
            width={w}
            height={h}
            className="block touch-pan-y text-xs"
            onPointerMove={(e) => {
              const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
              setHover(Math.min(n - 1, Math.max(0, Math.round(n > 1 ? ((px - M.left) / iw) * (n - 1) : 0))));
            }}
            onPointerLeave={() => setHover(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={w - M.right} y1={y(t)} y2={y(t)} stroke="var(--line)" />
                <text x={M.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" fill="var(--muted)">
                  {t}
                </text>
              </g>
            ))}
            {labelIdx.map((i) => (
              <text key={i} x={x(i)} y={h - 4} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fill="var(--muted)">
                #{i + 1}
              </text>
            ))}
            <line x1={M.left} x2={w - M.right} y1={y(target)} y2={y(target)} stroke="var(--muted)" strokeDasharray="2 4" />
            {hover != null && <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + ih} stroke="var(--line-strong)" />}
            {keys.map((k) => {
              const pts = trend.flatMap((t, i) => (t.criteria[k] == null ? [] : [[x(i), y(t.criteria[k]!)] as const]));
              return (
                <g key={k} stroke={SERIES_COLOR[k]} fill={SERIES_COLOR[k]}>
                  <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" strokeWidth={2.5} strokeDasharray={SERIES_DASH[k]} strokeLinejoin="round" />
                  {pts.map(([px, py], i) => (
                    // Dashed series get hollow dots, so a solid and a dashed line on the same scores still differ.
                    <circle key={i} cx={px} cy={py} r={3} strokeWidth={SERIES_DASH[k] ? 1.5 : 0} fill={SERIES_DASH[k] ? 'var(--bg)' : SERIES_COLOR[k]} />
                  ))}
                </g>
              );
            })}
            {ends.map((e) => (
              <text key={e.k} x={x(n - 1) + 9} y={e.y} dominantBaseline="middle" fill="var(--ink)" className="font-medium">
                {CRITERION_SHORT[e.k]}
              </text>
            ))}
          </svg>
        )}
        {row && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-lg border border-line bg-surface p-2.5 text-[13px] shadow-pop"
            style={{ left: Math.min(Math.max(x(hover!) + 12, 0), Math.max(0, w - 160)) }}
          >
            <p className="mb-1 text-muted">#{hover! + 1}, {formatDate(row.date, true)}</p>
            {keys.map((k) => (
              <p key={k} className="flex items-center gap-2">
                {swatch(k)}
                <span className="flex-1 text-muted">{criterionLabel(k)}</span>
                <span className="type-num font-semibold">{formatBand(row.criteria[k])}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
