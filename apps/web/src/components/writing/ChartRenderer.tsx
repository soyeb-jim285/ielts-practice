import type { ChartSpec } from '@server/ai/types';
import { ArrowDown, ArrowRight } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';

// Hand-drawn SVG, no recharts: the exam paper is a static figure, so no tooltips or animation are needed (native <title> gives hover values).
// Series colours come from the design tokens (teal, sky, slate, amber, rose, ink) so charts follow the theme in both modes; dash patterns keep lines tellable apart in greyscale / colour-blind viewing.
const COLORS = ['var(--accent)', 'var(--sky)', 'var(--chart-3)', 'var(--warn)', 'var(--bad)', 'var(--ink)'];
const DASHES = [undefined, '6 3', '2 3', '10 4 2 4', '1 2', '8 2'];
// Past six (e.g. a 7-slice pie), repeat the palette as lighter tints so neighbouring slices never share a colour.
const color = (i: number) => (i < COLORS.length ? COLORS[i] : `color-mix(in oklab, ${COLORS[i % COLORS.length]} 45%, var(--surface))`);
const num = (v: number) => v.toLocaleString('en');

/** An exam-paper style figure for Academic Task 1: bold centred title, plain axes, legend underneath. */
export function ChartRenderer({ spec }: { spec: ChartSpec }) {
  return (
    <figure className="rounded-card border border-line bg-surface px-3 py-5 sm:px-5" aria-label={spec.title}>
      <figcaption className="type-subheading mx-auto mb-5 max-w-[52ch] text-center text-balance">{spec.title}</figcaption>
      <Body spec={spec} />
    </figure>
  );
}

function Body({ spec }: { spec: ChartSpec }) {
  switch (spec.kind) {
    case 'line':
    case 'bar':
      return <Cartesian spec={spec} />;
    case 'pie':
      return <Pies spec={spec} />;
    case 'table':
      return <DataTable spec={spec} />;
    case 'process':
      return <Process steps={spec.steps} />;
    case 'map':
      return <MapPair spec={spec} />;
  }
}

/** Round axis ticks from lo..hi: steps of 1, 2, 2.5 or 5 × 10^k, about 5 of them. Exported for tests. */
export function niceTicks(lo: number, hi: number): number[] {
  if (hi === lo) hi = lo + 1;
  const raw = (hi - lo) / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let t = Math.floor(lo / step) * step; t < hi + step - 1e-9; t += step) ticks.push(+t.toPrecision(12));
  return ticks;
}

const H = 300;
const M = { top: 8, right: 12, left: 56 };

function Cartesian({ spec }: { spec: Extract<ChartSpec, { kind: 'line' | 'bar' }> }) {
  // Measure the width and draw in real pixels, so 12 px labels stay 12 px on a phone (a scaled viewBox would shrink them).
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(e!.contentRect.width));
    ro.observe(ref.current!);
    return () => ro.disconnect();
  }, []);

  const vals = spec.series.flatMap((s) => s.values).filter(Number.isFinite);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
  const [lo, hi] = [ticks[0]!, ticks.at(-1)!];
  const pw = Math.max(0, w - M.left - M.right);
  const band = pw / spec.categories.length;
  // x labels: wrap onto up to two lines (~7 px per character); only when that still doesn't fit, skip every nth.
  const maxChars = Math.max(1, Math.floor((band - 8) / 7));
  const lines = spec.categories.map((c) => wrapLabel(c, maxChars));
  const fits = lines.every((l) => l.length <= 2 && l.every((t) => t.length <= maxChars));
  const every = fits ? 1 : Math.ceil((Math.max(...spec.categories.map((c) => c.length)) * 7 + 8) / Math.max(band, 1));
  const bottom = (spec.xLabel ? 44 : 28) + (fits && lines.some((l) => l.length > 1) ? 14 : 0);
  const ph = H - M.top - bottom;
  const x = (i: number) => M.left + band * (i + 0.5);
  const y = (v: number) => M.top + ph * (1 - (v - lo) / (hi - lo));
  const unit = spec.unit && spec.unit !== spec.yLabel ? ` ${spec.unit}` : '';
  const bw = (band * 0.8) / spec.series.length;

  return (
    <div>
      <div ref={ref} className="w-full" style={{ height: H }} role="img" aria-label={describe(spec)}>
        {w > 0 && (
          <svg width={w} height={H} className="overflow-visible text-xs" aria-hidden>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={M.left + pw} y1={y(t)} y2={y(t)} stroke={t === lo ? 'var(--line-strong)' : 'var(--line)'} />
                <text x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fill="var(--muted)">{num(t)}</text>
              </g>
            ))}
            <line x1={M.left} x2={M.left} y1={M.top} y2={M.top + ph} stroke="var(--line-strong)" />
            {spec.categories.map((c, i) =>
              i % every && i !== spec.categories.length - 1 ? null : (
                <text key={i} x={x(i)} y={M.top + ph + 18} textAnchor="middle" fill="var(--muted)">
                  {(fits ? lines[i]! : [c]).map((t, k) => (
                    <tspan key={k} x={x(i)} dy={k ? 14 : 0}>
                      {t}
                    </tspan>
                  ))}
                </text>
              ),
            )}
            {spec.xLabel && <text x={M.left + pw / 2} y={H - 4} textAnchor="middle" fill="var(--muted)">{spec.xLabel}</text>}
            <text transform={`translate(12 ${M.top + ph / 2}) rotate(-90)`} textAnchor="middle" fill="var(--muted)">{spec.yLabel || spec.unit}</text>
            {spec.series.map((s, si) =>
              spec.kind === 'bar' ? (
                <g key={s.name} fill={color(si)}>
                  {s.values.map((v, i) =>
                    Number.isFinite(v) ? (
                      <rect key={i} x={x(i) - band * 0.4 + bw * si} y={Math.min(y(v), y(0))} width={Math.max(bw - 1, 1)} height={Math.abs(y(v) - y(0))} rx={2}>
                        <title>{`${s.name}, ${spec.categories[i]}: ${num(v)}${unit}`}</title>
                      </rect>
                    ) : null,
                  )}
                </g>
              ) : (
                <g key={s.name} stroke={color(si)} fill={color(si)}>
                  <path fill="none" strokeWidth={2} strokeDasharray={DASHES[si % DASHES.length]} d={linePath(s.values, x, y)} />
                  {s.values.map((v, i) =>
                    Number.isFinite(v) ? (
                      <circle key={i} cx={x(i)} cy={y(v)} r={3}>
                        <title>{`${s.name}, ${spec.categories[i]}: ${num(v)}${unit}`}</title>
                      </circle>
                    ) : null,
                  )}
                </g>
              ),
            )}
          </svg>
        )}
      </div>
      {spec.series.length > 1 && <Legend items={spec.series.map((s) => s.name)} line={spec.kind === 'line'} />}
    </div>
  );
}

/** Greedy word wrap to `max` characters per line. */
const wrapLabel = (c: string, max: number) => {
  const out: string[] = [];
  let cur = '';
  for (const w of c.split(' ')) {
    if (!cur || `${cur} ${w}`.length <= max) cur = cur ? `${cur} ${w}` : w;
    else (out.push(cur), (cur = w));
  }
  return [...out, cur];
};

/** A polyline that breaks at missing values. */
const linePath = (vs: number[], x: (i: number) => number, y: (v: number) => number) =>
  vs.map((v, i) => (Number.isFinite(v) ? `${Number.isFinite(vs[i - 1]) ? 'L' : 'M'}${x(i)},${y(v)}` : '')).join('');

/** Screen-reader summary: the underlying numbers, since the chart itself is visual. */
const describe = (s: Extract<ChartSpec, { kind: 'line' | 'bar' }>) =>
  `${s.kind} chart. ${s.series.map((x) => `${x.name}: ${s.categories.map((c, i) => `${c} ${x.values[i]}`).join(', ')}`).join('. ')}${s.unit ? ` (${s.unit})` : ''}`;

function Legend({ items, line }: { items: string[]; line?: boolean }) {
  return (
    <ul className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-caption">
      {items.map((l, i) => (
        <li key={l} className="inline-flex items-center gap-1.5">
          {line ? (
            <svg width="20" height="8" aria-hidden>
              <line x1="0" x2="20" y1="4" y2="4" stroke={color(i)} strokeWidth={2} strokeDasharray={DASHES[i % DASHES.length]} />
            </svg>
          ) : (
            <span className="size-2.5 rounded-sm" style={{ background: color(i) }} aria-hidden />
          )}
          {l}
        </li>
      ))}
    </ul>
  );
}

const R = 78; // pie radius in a 200×200 viewBox; labels sit just outside it
const polar = (a: number, r: number) => [100 + r * Math.sin(a), 100 - r * Math.cos(a)] as const;

function Pies({ spec }: { spec: Extract<ChartSpec, { kind: 'pie' }> }) {
  // One shared colour per label across every pie, so "Coal" is the same slice colour in 1990 and 2020.
  const labels = [...new Set(spec.pies.flatMap((p) => p.slices.map((s) => s.label)))];
  const unit = spec.unit || '%';
  const fmt = (v: number) => `${num(v)}${unit === '%' ? '%' : ''}`;
  return (
    <div>
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${spec.pies.length > 2 ? 160 : 200}px, 1fr))` }}>
        {spec.pies.map((p) => {
          const total = p.slices.reduce((t, s) => t + s.value, 0) || 1;
          let a0 = 0; // clockwise from 12 o'clock, like the exam paper
          return (
            <div key={p.name} className="text-center">
              <svg viewBox="0 0 200 200" className="mx-auto h-52 overflow-visible" role="img" aria-label={`${p.name}: ${p.slices.map((s) => `${s.label} ${s.value}${unit}`).join(', ')}`}>
                {p.slices.map((s) => {
                  const a1 = a0 + (s.value / total) * 2 * Math.PI;
                  const mid = (a0 + a1) / 2;
                  const [sx, sy] = polar(a0, R);
                  const [ex, ey] = polar(a1, R);
                  const [lx, ly] = polar(mid, R + 13);
                  const d = a1 - a0 >= 2 * Math.PI - 1e-9 ? undefined : `M100,100L${sx},${sy}A${R},${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${ex},${ey}Z`;
                  a0 = a1;
                  const fill = color(labels.indexOf(s.label));
                  const title = <title>{`${s.label}: ${num(s.value)}${unit === '%' ? '%' : ` ${unit}`}`}</title>;
                  return (
                    <g key={s.label}>
                      {d ? <path d={d} fill={fill} stroke="var(--surface)" strokeWidth={2}>{title}</path> : <circle cx={100} cy={100} r={R} fill={fill}>{title}</circle>}
                      {s.value > 0 && (
                        <text x={lx} y={ly} dy="0.32em" textAnchor={Math.abs(lx - 100) < 8 ? 'middle' : lx > 100 ? 'start' : 'end'} fontSize={11} fill="var(--ink)">
                          {fmt(s.value)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
              <div className="text-sm font-semibold">{p.name}</div>
            </div>
          );
        })}
      </div>
      <Legend items={labels} />
    </div>
  );
}

function DataTable({ spec }: { spec: Extract<ChartSpec, { kind: 'table' }> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm tabular-nums">
        <thead>
          <tr>
            {spec.columns.map((c, i) => (
              <th key={c} scope="col" className={`border border-line-strong bg-surface-2 px-3 py-2 font-semibold ${i ? 'text-right' : 'text-left'}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((v, i) =>
                i ? (
                  <td key={i} className="border border-line-strong px-3 py-2 text-right">
                    {typeof v === 'number' ? v.toLocaleString('en') : v}
                  </td>
                ) : (
                  <th key={i} scope="row" className="border border-line-strong px-3 py-2 text-left font-medium">
                    {v}
                  </th>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Process({ steps }: { steps: string[] }) {
  return (
    <ol className="flex flex-col items-stretch gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center sm:gap-y-3">
      {steps.map((s, i) => (
        <Fragment key={i}>
          <li className="flex items-start gap-2.5 rounded-control border border-line-strong bg-surface-2 px-3 py-2.5 text-sm sm:max-w-[13rem]">
            <span className="grid size-6 shrink-0 place-items-center rounded-sm bg-ink text-xs font-semibold text-bg tabular-nums">{i + 1}</span>
            <span className="pt-0.5">{s}</span>
          </li>
          {i < steps.length - 1 && (
            <li aria-hidden className="flex justify-center text-muted">
              <ArrowDown className="size-4 sm:hidden" />
              <ArrowRight className="hidden size-4 sm:block" />
            </li>
          )}
        </Fragment>
      ))}
    </ol>
  );
}

function MapPair({ spec }: { spec: Extract<ChartSpec, { kind: 'map' }> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {[spec.before, spec.after].map((m, i) => (
        <section key={i} aria-label={m.label} className="rounded-control border border-dashed border-line-strong bg-surface-2 p-4">
          <h3 className="mb-2.5 text-center text-sm font-semibold">{m.label}</h3>
          <ul className="space-y-1.5 text-sm">
            {m.features.map((f) => (
              <li key={f} className="flex items-start gap-2">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-ink/50" aria-hidden />
                {f}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
