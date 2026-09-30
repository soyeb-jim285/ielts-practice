import type { CriterionKey } from '@server/ai/types';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatBand, formatDate } from '@/lib/format';
import { criterionLabel } from '@/lib/result';
import { SERIES_COLOR, type Progress } from './criteria';

/** Tiny decorative trend line; the numbers it summarises are shown as text next to it. */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  return (
    <div className="h-12 w-full" aria-hidden>
      <ResponsiveContainer>
        <LineChart data={values.map((v, i) => ({ i, v }))} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <YAxis hide domain={['dataMin - 0.5', 'dataMax + 0.5']} />
          <Line type="monotone" dataKey="v" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const axis = { stroke: 'var(--muted)', fontSize: 12, tickLine: false, axisLine: false } as const;

/** Per-criterion band lines for one skill, oldest → newest, with the target as a dashed reference. */
export function CriteriaTrend({ trend, keys, target }: { trend: Progress['trend']; keys: CriterionKey[]; target: number }) {
  const data = trend.map((t) => ({ date: t.date, ...t.criteria }));
  const latest = trend.at(-1)?.criteria ?? {};
  return (
    <div>
      <ul className="mb-4 flex flex-wrap gap-x-5 gap-y-2" aria-label="Latest band per criterion">
        {keys.map((k) => (
          <li key={k} className="flex items-center gap-2 text-sm">
            <span className="size-2.5 rounded-full" style={{ background: SERIES_COLOR[k] }} aria-hidden />
            <span className="text-muted">{criterionLabel(k)}</span>
            <span className="font-semibold tabular-nums">{formatBand(latest[k])}</span>
          </li>
        ))}
      </ul>
      <div className="-ml-2 h-56" role="img" aria-label={`Band trend over your last ${trend.length} attempts`}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="date" {...axis} tickFormatter={(d: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(d))} minTickGap={24} />
            <YAxis {...axis} width={32} domain={[(min: number) => Math.max(0, Math.min(Math.floor(min), target) - 0.5), 9]} ticks={[3, 4, 5, 6, 7, 8, 9]} allowDataOverflow />
            <ReferenceLine y={target} stroke="var(--muted)" strokeDasharray="4 4" label={{ value: `Target ${formatBand(target)}`, position: 'insideTopRight', fill: 'var(--muted)', fontSize: 11 }} />
            <Tooltip
              cursor={{ stroke: 'var(--line-strong)' }}
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: 'var(--shadow-pop)', fontSize: 13 }}
              labelStyle={{ color: 'var(--muted)', marginBottom: 4 }}
              labelFormatter={(d) => formatDate(String(d))}
              formatter={(v, k) => [formatBand(Number(v)), criterionLabel(String(k))]}
            />
            {keys.map((k) => (
              <Line key={k} type="monotone" dataKey={k} stroke={SERIES_COLOR[k]} strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: SERIES_COLOR[k] }} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
