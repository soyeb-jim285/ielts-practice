import { useState } from 'react';
import { cn } from '@/lib/utils';

/** Series colours in fixed order (docs/admin/COSTS-AND-UI.md section E): teal first, sky second. Series are told apart by colour, legend and position, never by dash. */
export const SERIES = ['var(--accent)', 'var(--sky)'] as const;

export type Series = { label: string; color: string; values: number[] };

const W = 100;
const H = 40;
const pointer = (e: React.PointerEvent<SVGSVGElement>, n: number) => {
  const r = e.currentTarget.getBoundingClientRect();
  return Math.min(n - 1, Math.max(0, Math.round(((e.clientX - r.left) / r.width) * (n - 1))));
};

/** Hidden data table behind every chart, for screen readers. */
function DataTableSr({ labels, series, fmt = String }: { labels: string[]; series: Series[]; fmt?: (n: number) => string }) {
  return (
    <table className="sr-only">
      <caption>Chart data</caption>
      <thead>
        <tr>
          <th scope="col">Date</th>
          {series.map((s) => (
            <th key={s.label} scope="col">
              {s.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {labels.map((l, k) => (
          <tr key={l + k}>
            <th scope="row">{l}</th>
            {series.map((s) => (
              <td key={s.label}>{fmt(s.values[k] ?? 0)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** `i` null = nothing hovered: the readout then shows each series' period total. A series that is zero everywhere is left out. */
const Legend = ({ series, i, labels, fmt }: { series: Series[]; i: number | null; labels: string[]; fmt: (n: number) => string }) => (
  <ul className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm" aria-label="Series">
    {series.filter((s) => s.values.some((v) => v > 0)).map((s) => (
      <li key={s.label} className="flex items-center gap-2">
        <span aria-hidden className="size-2.5 rounded-full" style={{ background: s.color }} />
        <span className="text-muted">{s.label}</span>
        <span className="type-num font-semibold">{i == null ? fmt(s.values.reduce((a, b) => a + b, 0)) : s.values[i] == null ? '-' : fmt(s.values[i]!)}</span>
      </li>
    ))}
    <li className="type-caption ml-auto">{i == null ? `Total, ${labels.length} days` : labels[i]}</li>
  </ul>
);

/**
 * Multi-line chart on ONE y scale. Plain SVG stretched to its box (strokes stay 2px via non-scaling-stroke), labels are HTML so they never distort.
 * Hover or touch to read a day; the same numbers are in a screen-reader table. `min`/`max` fix the y range (bands).
 */
export function LineChart({ labels, series, min = 0, max, height = 'h-48', fmt = String }: { labels: string[]; series: Series[]; min?: number; max?: number; height?: string; fmt?: (n: number) => string }) {
  const [at, setAt] = useState<number | null>(null);
  const n = labels.length;
  const top = max ?? Math.max(1, ...series.flatMap((s) => s.values));
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : W / 2);
  const y = (v: number) => H - ((v - min) / (top - min || 1)) * H;
  const i = at ?? n - 1;
  const mid = (top + min) / 2;
  return (
    <figure className="m-0">
      <Legend series={series} i={at} labels={labels} fmt={fmt} />
      <div className={cn('relative pl-9', height)}>
        <span className="type-caption type-num absolute top-0 left-0 -translate-y-1/2">{fmt(top)}</span>
        <span className="type-caption type-num absolute top-1/2 left-0 -translate-y-1/2">{fmt(Number.isInteger(mid) ? mid : +mid.toFixed(1))}</span>
        <span className="type-caption type-num absolute bottom-0 left-0 translate-y-1/2">{fmt(min)}</span>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="size-full touch-pan-y overflow-visible"
          role="img"
          aria-label={`Line chart, ${n} points from ${labels[0]} to ${labels[n - 1]}. ${series.map((s) => `${s.label}: latest ${s.values.at(-1)}`).join('; ')}`}
          onPointerMove={(e) => setAt(pointer(e, n))}
          onPointerLeave={() => setAt(null)}
        >
          {[0, 0.5, 1].map((t) => (
            <line key={t} x1="0" x2={W} y1={H * t} y2={H * t} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          {at != null && <line x1={x(at)} x2={x(at)} y1="0" y2={H} stroke="var(--line-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
          {series.map((s) => (
            <polyline key={s.label} points={s.values.map((v, k) => `${x(k)},${y(v)}`).join(' ')} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {/* markers are HTML so they stay round while the SVG stretches */}
        {series.map((s) =>
          s.values[i] == null ? null : <span key={s.label} aria-hidden className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface" style={{ background: s.color, left: `calc(2.25rem + (100% - 2.25rem) * ${x(i) / W})`, top: `${(y(s.values[i]!) / H) * 100}%` }} />,
        )}
      </div>
      <div className="type-caption mt-2 flex justify-between pl-9">
        <span>{labels[0]}</span>
        <span>{labels[n - 1]}</span>
      </div>
      <DataTableSr labels={labels} series={series} fmt={fmt} />
    </figure>
  );
}

/**
 * One measure on its own scale: a filled line with a hover read-out, today (last point) dotted. Stack three of these instead of sharing a y axis,
 * so a spike in one series cannot flatten the others.
 */
export function TrendChart({ title, labels, values, color = SERIES[0], height = 'h-24', fmt = String, summary }: { title: string; labels: string[]; values: number[]; color?: string; height?: string; fmt?: (n: number) => string; summary?: string }) {
  const [at, setAt] = useState<number | null>(null);
  const n = values.length;
  const top = Math.max(1, ...values);
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : W / 2);
  const y = (v: number) => H - (v / top) * (H - 2) - 1;
  const i = at ?? n - 1;
  const pts = values.map((v, k) => `${x(k)},${y(v)}`).join(' ');
  return (
    <figure className="m-0">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <figcaption className="text-sm font-medium">
          {title}
          {summary && <span className="type-num ml-2 font-semibold text-ink">{summary}</span>}
        </figcaption>
        <span className="type-caption">
          {labels[i]} · <span className="type-num font-semibold text-ink">{fmt(values[i] ?? 0)}</span>
        </span>
      </div>
      <div className={cn('relative mt-5 pl-9', height)}>
        <span className="type-caption type-num absolute top-0 left-0 -translate-y-1/2">{fmt(top)}</span>
        <span className="type-caption type-num absolute bottom-0 left-0">0</span>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="size-full touch-pan-y overflow-visible" role="img" aria-label={`${title}, ${n} days, latest ${values.at(-1)}, highest ${top}`} onPointerMove={(e) => setAt(pointer(e, n))} onPointerLeave={() => setAt(null)}>
          <line x1="0" x2={W} y1={H} y2={H} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1="0" x2={W} y1="0" y2="0" stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <polygon points={`0,${H} ${pts} ${W},${H}`} fill={color} opacity="0.12" />
          <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {at != null && <line x1={x(at)} x2={x(at)} y1="0" y2={H} stroke="var(--line-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
        </svg>
        <span aria-hidden className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface" style={{ background: color, left: `calc(2.25rem + (100% - 2.25rem) * ${x(i) / W})`, top: `${(y(values[i] ?? 0) / H) * 100}%` }} />
      </div>
      <div className="type-caption mt-2 flex justify-between pl-9">
        <span>{labels[0]}</span>
        <span>{labels[n - 1]}</span>
      </div>
      <DataTableSr labels={labels} series={[{ label: title, color, values }]} fmt={fmt} />
    </figure>
  );
}

/** Full-width trend line for a KPI: no axes, last point marked (an HTML dot so it stays round). The number and delta beside it carry the meaning, so it is aria-hidden. */
export function Sparkline({ values, color = SERIES[0], className }: { values: number[]; color?: string; className?: string }) {
  const n = values.length;
  if (n < 2) return null;
  const top = Math.max(...values);
  const lo = Math.min(...values);
  const y = (v: number) => 22 - ((v - lo) / (top - lo || 1)) * 20;
  return (
    <div aria-hidden className={cn('relative h-6 w-full', className)}>
      <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="size-full overflow-visible">
        <polyline points={values.map((v, k) => `${(k / (n - 1)) * 100},${y(v)}`).join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: color, left: '100%', top: `${(y(values[n - 1]!) / 24) * 100}%` }} />
    </div>
  );
}

/** Stacked columns (one stack per day, two series), a 2px surface gap between segments, a tooltip-style read-out above. `partialLast` hatches today. */
export function ColumnChart({ labels, series, height = 'h-48', fmt, partialLast }: { labels: string[]; series: Series[]; height?: string; fmt: (n: number) => string; partialLast?: boolean }) {
  const [at, setAt] = useState<number | null>(null);
  const n = labels.length;
  const totals = labels.map((_, k) => series.reduce((a, s) => a + (s.values[k] ?? 0), 0));
  const top = Math.max(0.01, ...totals);
  return (
    <figure className="m-0">
      <Legend series={series} i={at} labels={labels} fmt={fmt} />
      <div className={cn('relative pl-12', height)}>
        <span className="type-caption type-num absolute top-0 left-0 -translate-y-1/2">{fmt(top)}</span>
        <span className="type-caption type-num absolute top-1/2 left-0 -translate-y-1/2">{fmt(top / 2)}</span>
        <span className="type-caption type-num absolute bottom-0 left-0 translate-y-1/2">{fmt(0)}</span>
        <div className="relative size-full border-b border-line">
          {[0, 0.5].map((t) => (
            <span key={t} aria-hidden className="absolute inset-x-0 border-t border-line" style={{ top: `${t * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]" role="img" aria-label={`Stacked column chart, ${n} days. Total ${fmt(totals.reduce((a, b) => a + b, 0))}.`}>
            {labels.map((l, k) => (
              <div key={l + k} className={cn('flex h-full min-w-0 flex-1 flex-col-reverse justify-start gap-[2px]', at === k && 'bg-surface-2')} onPointerEnter={() => setAt(k)} onPointerLeave={() => setAt(null)}>
                {series.map((s, si) => {
                  const v = s.values[k] ?? 0;
                  return v > 0 ? (
                    <span
                      key={s.label}
                      className={cn('w-full', si === series.length - 1 || !series.slice(si + 1).some((o) => (o.values[k] ?? 0) > 0) ? 'rounded-t-[3px]' : '')}
                      style={{ height: `${(v / top) * 100}%`, minHeight: 2, background: partialLast && k === n - 1 ? `repeating-linear-gradient(135deg, ${s.color} 0 3px, transparent 3px 6px)` : s.color }}
                    />
                  ) : null;
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="type-caption mt-2 flex justify-between pl-12">
        <span>{labels[0]}</span>
        <span>{labels[n - 1]}</span>
      </div>
      {partialLast && <p className="type-caption mt-1 pl-12">Hatched bar: today so far.</p>}
      <DataTableSr labels={labels} series={series} fmt={fmt} />
    </figure>
  );
}

export type BarRow = { label: React.ReactNode; value: number; text: string; hint?: React.ReactNode; key?: string; tone?: 'bad' | 'warn' };

/** Ranked horizontal bars: the bar length IS the share (no track behind it). Value text is always printed, so colour is never the only signal. `onSelect` makes a row a button. */
export function BarList({ rows, max, onSelect, track }: { rows: BarRow[]; max?: number; onSelect?: (key: string) => void; track?: boolean }) {
  const top = max ?? Math.max(1e-9, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3">
      {rows.map((r, k) => {
        const body = (
          <>
            <span className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate" title={typeof r.label === 'string' ? r.label : undefined}>
                {r.label}
              </span>
              <span className="type-num shrink-0 font-semibold">{r.text}</span>
            </span>
            <span className={cn('mt-1 block h-2', track && 'rounded-full bg-surface-2')} aria-hidden>
              <span className={cn('block h-full', track ? 'rounded-full' : 'rounded-r-[4px]', r.tone === 'bad' ? 'bg-bad' : r.tone === 'warn' ? 'bg-warn' : 'bg-brand')} style={{ width: `${Math.max(r.value > 0 ? 1 : 0, (r.value / top) * 100)}%` }} />
            </span>
            {r.hint && <span className="type-caption mt-0.5 block">{r.hint}</span>}
          </>
        );
        const key = r.key ?? String(k);
        return (
          <li key={key}>
            {onSelect ? (
              <button type="button" onClick={() => onSelect(key)} className="-mx-2 block min-h-11 w-[calc(100%+1rem)] rounded-md px-2 py-1 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring">
                {body}
              </button>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}
