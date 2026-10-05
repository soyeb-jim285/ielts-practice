import { useState } from 'react';

export type Series = { label: string; color: string; values: number[]; dash?: string };

const W = 100;
const H = 40;

/**
 * Small multi-line chart. Plain SVG stretched to its box (strokes stay 2px via non-scaling-stroke), labels are HTML so they never distort.
 * Hover or touch a point to read that day's values; the same numbers are in a screen-reader list. `min`/`max` fix the y range (bands).
 */
export function LineChart({ labels, series, min = 0, max, height = 'h-48' }: { labels: string[]; series: Series[]; min?: number; max?: number; height?: string }) {
  const [at, setAt] = useState<number | null>(null);
  const n = labels.length;
  const top = max ?? Math.max(1, ...series.flatMap((s) => s.values));
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : W / 2);
  const y = (v: number) => H - ((v - min) / (top - min || 1)) * H;
  const i = at ?? n - 1;
  return (
    <figure className="m-0">
      <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-label="Series">
        {series.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <svg width="18" height="8" aria-hidden>
              <line x1="0" y1="4" x2="18" y2="4" stroke={s.color} strokeWidth="2.5" strokeDasharray={s.dash} strokeLinecap="round" />
            </svg>
            <span className="text-muted">{s.label}</span>
            <span className="type-num font-semibold">{s.values[i] ?? '-'}</span>
          </li>
        ))}
        <li className="type-caption ml-auto">{labels[i]}</li>
      </ul>
      <div className={`relative ${height} pl-8`}>
        <span className="type-caption type-num absolute top-0 left-0">{top}</span>
        <span className="type-caption type-num absolute bottom-0 left-0">{min}</span>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="size-full touch-pan-y overflow-visible"
          role="img"
          aria-label={`Line chart, ${n} points from ${labels[0]} to ${labels[n - 1]}. ${series.map((s) => `${s.label}: latest ${s.values.at(-1)}`).join('; ')}`}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setAt(Math.min(n - 1, Math.max(0, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))));
          }}
          onPointerLeave={() => setAt(null)}
        >
          {[0, 0.5, 1].map((t) => (
            <line key={t} x1="0" x2={W} y1={H * t} y2={H * t} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          {at != null && <line x1={x(at)} x2={x(at)} y1="0" y2={H} stroke="var(--line-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
          {series.map((s) => (
            <polyline key={s.label} points={s.values.map((v, k) => `${x(k)},${y(v)}`).join(' ')} fill="none" stroke={s.color} strokeWidth="2.5" strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
      </div>
      <div className="type-caption mt-1 flex justify-between pl-8">
        <span>{labels[0]}</span>
        <span>{labels[n - 1]}</span>
      </div>
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
                <td key={s.label}>{s.values[k]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Horizontal bars, one per row: label, bar scaled to `max`, value text. Bars carry the number too, so colour is never the only signal. */
export function BarList({ rows, max }: { rows: { label: string; value: number; text: string; hint?: string }[]; max?: number }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="type-num shrink-0 font-semibold">{r.text}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-surface-2" role="presentation">
            <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(1, (r.value / top) * 100)}%` }} />
          </div>
          {r.hint && <p className="type-caption mt-0.5">{r.hint}</p>}
        </li>
      ))}
    </ul>
  );
}
