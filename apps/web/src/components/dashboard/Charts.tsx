import type { CriterionKey } from '@server/ai/types';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatBand, formatDate } from '@/lib/format';
import { criterionLabel } from '@/lib/result';
import { SERIES_COLOR, type Progress } from './criteria';

const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const dayTimeFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const axis = { stroke: 'var(--muted)', fontSize: 12, tickLine: false, axisLine: false } as const;

/** Per-criterion band lines for one skill, oldest → newest, with the target as a dashed reference. Default export: lazy-loaded so recharts stays out of the dashboard's first load. */
export default function CriteriaTrend({ trend, keys, target }: { trend: Progress['trend']; keys: CriterionKey[]; target: number }) {
  const data = trend.map((t) => ({ date: t.date, ...t.criteria }));
  // Several attempts on one day would all read "30 Sept": add the time when days collide.
  const fmt = new Set(trend.map((t) => dayFmt.format(new Date(t.date)))).size < trend.length ? dayTimeFmt : dayFmt;
  const latest = trend.at(-1)?.criteria ?? {};
  const lo = Math.max(0, Math.min(Math.floor(Math.min(...trend.flatMap((t) => Object.values(t.criteria)))), target) - 0.5);
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
        <li className="flex items-center gap-2 text-sm text-muted">
          <svg width="16" height="2" aria-hidden>
            <line x1="0" y1="1" x2="16" y2="1" stroke="var(--muted)" strokeWidth="2" strokeDasharray="3 3" />
          </svg>
          Target {formatBand(target)}
        </li>
      </ul>
      <div className="-ml-2 h-56 md:h-72" role="img" aria-label={`Band trend over your last ${trend.length} attempts`}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="date" {...axis} tickFormatter={(d: string) => fmt.format(new Date(d))} minTickGap={24} />
            <YAxis {...axis} width={32} domain={[lo, 9]} ticks={[3, 4, 5, 6, 7, 8, 9].filter((t) => t >= lo)} allowDataOverflow />
            <ReferenceLine y={target} stroke="var(--muted)" strokeDasharray="4 4" />
            <Tooltip
              cursor={{ stroke: 'var(--line-strong)' }}
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: 'var(--shadow-pop)', fontSize: 13 }}
              labelStyle={{ color: 'var(--muted)', marginBottom: 4 }}
              labelFormatter={(d) => formatDate(String(d))}
              formatter={(v, k) => [formatBand(Number(v)), criterionLabel(String(k))]}
            />
            {keys.map((k) => (
              <Line key={k} type="linear" dataKey={k} stroke={SERIES_COLOR[k]} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: SERIES_COLOR[k] }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
