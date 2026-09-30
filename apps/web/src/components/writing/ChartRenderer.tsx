import type { ChartSpec } from '@server/ai/types';
import { ArrowDown, ArrowRight } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// Distinct series colours from the theme tokens, plus dash patterns so lines stay tellable apart in greyscale / colour-blind viewing.
const COLORS = ['var(--accent)', 'var(--warn)', 'var(--good)', 'var(--bad)', 'var(--ink)', 'var(--muted)'];
const DASHES = [undefined, '6 3', '2 3', '10 4 2 4', '1 2', '8 2'];
const color = (i: number) => COLORS[i % COLORS.length];
const tick = { fill: 'var(--muted)', fontSize: 12 };
const tooltip = {
  contentStyle: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 8px 24px rgb(0 0 0 / 0.12)', fontSize: 13 },
  labelStyle: { color: 'var(--ink)', fontWeight: 600 },
  itemStyle: { color: 'var(--ink)' },
};
const legend = { wrapperStyle: { fontSize: 13, color: 'var(--ink)', paddingTop: 8 } };

/** Accepts the untyped `prompt.chart` JSON; anything that isn't a known ChartSpec renders nothing. */
export const asChart = (c: unknown): ChartSpec | null =>
  c && typeof c === 'object' && ['line', 'bar', 'pie', 'table', 'process', 'map'].includes((c as { kind?: string }).kind ?? '') ? (c as ChartSpec) : null;

/** An exam-paper style figure for Academic Task 1: bold centred title, plain axes, legend underneath. */
export function ChartRenderer({ spec }: { spec: ChartSpec }) {
  return (
    <figure className="rounded-card border border-line bg-surface px-3 py-5 sm:px-5" aria-label={spec.title}>
      <figcaption className="mx-auto mb-4 max-w-[52ch] text-center text-[0.9375rem] font-semibold text-balance">{spec.title}</figcaption>
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

function Cartesian({ spec }: { spec: Extract<ChartSpec, { kind: 'line' | 'bar' }> }) {
  const data = spec.categories.map((c, i) => Object.fromEntries([['x', c], ...spec.series.map((s) => [s.name, s.values[i] ?? null])]));
  const fmt = (v: unknown) => `${v}${spec.unit && spec.unit !== spec.yLabel ? ` ${spec.unit}` : ''}`;
  const axes: ReactNode[] = [
    <CartesianGrid key="g" stroke="var(--line)" vertical={false} />,
    <XAxis key="x" dataKey="x" tick={tick} tickLine={false} axisLine={{ stroke: 'var(--line-strong)' }} interval="preserveStartEnd"
      label={spec.xLabel ? { value: spec.xLabel, position: 'insideBottom', offset: -4, fill: 'var(--muted)', fontSize: 12 } : undefined} height={spec.xLabel ? 44 : 30} />,
    <YAxis key="y" tick={tick} tickLine={false} axisLine={{ stroke: 'var(--line-strong)' }} width={52}
      label={{ value: spec.yLabel || spec.unit, angle: -90, position: 'insideLeft', offset: 8, fill: 'var(--muted)', fontSize: 12, style: { textAnchor: 'middle' } }} />,
    <Tooltip key="t" {...tooltip} formatter={fmt} cursor={{ fill: 'var(--line)', fillOpacity: 0.4 }} />,
    spec.series.length > 1 && <Legend key="l" {...legend} />,
  ];
  return (
    <div className="h-72 w-full sm:h-80" role="img" aria-label={describe(spec)}>
      <ResponsiveContainer>
        {spec.kind === 'line' ? (
          <LineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
            {axes}
            {spec.series.map((s, i) => (
              <Line key={s.name} dataKey={s.name} stroke={color(i)} strokeWidth={2} strokeDasharray={DASHES[i % DASHES.length]} dot={{ r: 3, fill: color(i) }} isAnimationActive={false} />
            ))}
          </LineChart>
        ) : (
          <BarChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 4 }} barCategoryGap="20%">
            {axes}
            {spec.series.map((s, i) => (
              <Bar key={s.name} dataKey={s.name} fill={color(i)} radius={[2, 2, 0, 0]} isAnimationActive={false} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/** Screen-reader summary: the underlying numbers, since the chart itself is visual. */
const describe = (s: Extract<ChartSpec, { kind: 'line' | 'bar' }>) =>
  `${s.kind} chart. ${s.series.map((x) => `${x.name}: ${s.categories.map((c, i) => `${c} ${x.values[i]}`).join(', ')}`).join('. ')}${s.unit ? ` (${s.unit})` : ''}`;

function Pies({ spec }: { spec: Extract<ChartSpec, { kind: 'pie' }> }) {
  // One shared colour per label across every pie, so "Coal" is the same slice colour in 1990 and 2020.
  const labels = [...new Set(spec.pies.flatMap((p) => p.slices.map((s) => s.label)))];
  const unit = spec.unit || '%';
  return (
    <div>
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${spec.pies.length > 2 ? 160 : 200}px, 1fr))` }}>
        {spec.pies.map((p) => (
          <div key={p.name} className="text-center">
            <div className="h-52" role="img" aria-label={`${p.name}: ${p.slices.map((s) => `${s.label} ${s.value}${unit}`).join(', ')}`}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={p.slices} dataKey="value" nameKey="label" outerRadius="78%" stroke="var(--surface)" strokeWidth={2} isAnimationActive={false}
                    label={({ value }) => `${value}${unit === '%' ? '%' : ''}`} labelLine={false} fontSize={11}>
                    {p.slices.map((s) => (
                      <Cell key={s.label} fill={color(labels.indexOf(s.label))} />
                    ))}
                  </Pie>
                  <Tooltip {...tooltip} formatter={(v) => `${v}${unit === '%' ? '%' : ` ${unit}`}`} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="text-sm font-semibold">{p.name}</div>
          </div>
        ))}
      </div>
      <ul className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[0.8125rem]">
        {labels.map((l, i) => (
          <li key={l} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: color(i) }} aria-hidden />
            {l}
          </li>
        ))}
      </ul>
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
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink text-xs font-semibold text-bg tabular-nums">{i + 1}</span>
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
