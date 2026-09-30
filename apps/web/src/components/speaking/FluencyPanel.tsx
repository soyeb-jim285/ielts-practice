import type { SpeechMetrics } from '@ielts/core';
import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, InfoTip } from '@/components/ui';
import { formatClock } from '@/lib/format';
import { speechStats, type Stat } from '@/lib/result';
import type { AudioControls } from './AudioBar';

const TICK = { fill: 'var(--muted)', fontSize: 12 };

/** Pace over time (10 s windows) with the heuristic band-7 zone shaded. */
export function WpmChart({ series }: { series: SpeechMetrics['wpmSeries'] }) {
  if (series.length < 2) return <p className="text-sm text-muted">This answer is too short for a pace chart (it needs at least 15 seconds).</p>;
  const max = Math.max(200, ...series.map((p) => p.wpm));
  return (
    <figure>
      <div className="h-56 w-full" role="img" aria-label={`Words per minute over time, from ${Math.round(Math.min(...series.map((p) => p.wpm)))} to ${Math.round(Math.max(...series.map((p) => p.wpm)))}`}>
        <ResponsiveContainer>
          <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <ReferenceArea y1={120} y2={160} fill="var(--good)" fillOpacity={0.1} stroke="none" label={{ value: 'band-7 zone (heuristic)', position: 'insideTopLeft', fill: 'var(--muted)', fontSize: 12 }} />
            <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(t: number) => formatClock(t)} tick={TICK} tickLine={false} axisLine={{ stroke: 'var(--line)' }} />
            <YAxis domain={[0, Math.ceil(max / 40) * 40]} tick={TICK} tickLine={false} axisLine={false} width={48} />
            <Tooltip
              cursor={{ stroke: 'var(--line-strong, var(--muted))' }}
              content={({ active, payload }) =>
                active && payload?.[0] ? (
                  <div className="rounded-card border border-line bg-surface px-3 py-2 text-sm shadow-pop">
                    <p className="text-muted tabular-nums">from {formatClock(payload[0].payload.t)}</p>
                    <p className="font-medium tabular-nums">{Math.round(payload[0].payload.wpm)} wpm</p>
                  </div>
                ) : null
              }
            />
            <Area type="monotone" dataKey="wpm" stroke="var(--accent)" strokeWidth={2} fill="var(--accent)" fillOpacity={0.12} activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 text-xs text-muted">Words per minute in 10-second windows, every 5 seconds. Shaded: roughly where band-7 speakers sit.</figcaption>
    </figure>
  );
}

/** Whole-recording bar with every pause placed on it; tap one to hear the moment before it. */
export function PauseTimeline({ metrics, audio }: { metrics: SpeechMetrics; audio: AudioControls }) {
  const d = Math.max(metrics.durationS, 1);
  return (
    <div>
      <div className="relative h-10 rounded-control bg-surface-2">
        <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-accent" style={{ left: `${Math.min(100, (audio.time / d) * 100)}%` }} />
        {metrics.pauses.map((p) => (
          <button
            key={p.start}
            type="button"
            onClick={() => audio.seek(p.start)}
            aria-label={`${p.kind === 'long' ? 'Long pause' : 'Pause'} of ${p.dur.toFixed(1)} seconds at ${formatClock(Math.floor(p.start))}${p.midClause ? ', mid-clause' : ''}`}
            className={`absolute inset-y-1.5 min-w-1.5 rounded-sm transition-transform hover:scale-y-110 ${p.kind === 'long' ? 'bg-bad' : 'bg-warn/60'}`}
            style={{ left: `${(p.start / d) * 100}%`, width: `${(p.dur / d) * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span className="tabular-nums">0:00</span>
        <span className="flex items-center gap-4">
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-warn/60" />0.25–1 s</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-bad" />1 s or longer</span>
        </span>
        <span className="tabular-nums">{formatClock(Math.round(d))}</span>
      </div>
    </div>
  );
}

const INDICATOR = {
  good: { Icon: CircleCheck, text: 'On target', cls: 'text-good-text' },
  warn: { Icon: TriangleAlert, text: 'Watch', cls: 'text-warn-text' },
  bad: { Icon: CircleX, text: 'Work on this', cls: 'text-bad-text' },
};

export function StatGrid({ stats }: { stats: Stat[] }) {
  return (
    <Card padded={false} className="overflow-hidden">
      <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => {
          const ind = INDICATOR[s.tone];
          return (
            <div key={s.key} className="bg-surface p-4">
              <dt className="flex items-center gap-1 text-sm text-muted">
                {s.label}
                <InfoTip label={`About ${s.label}`}>{s.info}</InfoTip>
              </dt>
              <dd className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{s.value}</dd>
              <dd className={`mt-1 flex items-center gap-1 text-xs font-medium ${ind.cls}`}>
                <ind.Icon className="size-3.5" aria-hidden />
                {ind.text}
              </dd>
            </div>
          );
        })}
      </dl>
    </Card>
  );
}

/** Fluency tab: pace chart, pause timeline, stat grid. */
export function FluencyPanel({ metrics, audio }: { metrics: SpeechMetrics; audio: AudioControls }) {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-lg font-semibold">Pace</h2>
        <WpmChart series={metrics.wpmSeries} />
      </section>
      <section>
        <h2 className="mb-1 text-lg font-semibold">Pauses</h2>
        <p className="mb-3 text-sm text-muted">
          {metrics.pauses.length} pauses · {metrics.longPauses} long · {metrics.midClausePauses} mid-clause. Tap one to hear it.
        </p>
        <PauseTimeline metrics={metrics} audio={audio} />
      </section>
      <section>
        <h2 className="mb-1 text-lg font-semibold">Fluency measures</h2>
        <p className="mb-3 text-sm text-muted">Compared with typical band-7 speech. These are guides, not the score.</p>
        <StatGrid stats={speechStats(metrics)} />
      </section>
    </div>
  );
}
