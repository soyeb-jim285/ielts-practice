import { WPM_WINDOW_S, type SpeechMetrics } from '@ielts/core';
import type { Criterion } from '@server/ai/types';
import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Alert, Card, InfoTip } from '@/components/ui';
import { formatClock } from '@/lib/format';
import { isLongPause, pauseSec, speechStats, tooShortToMeasure, type Stat } from '@/lib/result';
import type { AudioControls } from './AudioBar';

const TICK = { fill: 'var(--muted)', fontSize: 12 };

/** Pace over time (10 s windows, plotted at their midpoint on the same 0–duration axis as the pause strip) with the heuristic band-7 zone shaded. */
export function WpmChart({ series, durationS }: { series: SpeechMetrics['wpmSeries']; durationS: number }) {
  if (series.length < 2) return <p className="text-sm text-muted">This answer is too short for a pace chart (it needs at least 15 seconds).</p>;
  const max = Math.max(200, ...series.map((p) => p.wpm));
  return (
    <figure>
      <div className="h-56 w-full" role="img" aria-label={`Words per minute over time, from ${Math.round(Math.min(...series.map((p) => p.wpm)))} to ${Math.round(Math.max(...series.map((p) => p.wpm)))}`}>
        <ResponsiveContainer>
          <AreaChart data={series.map((p) => ({ ...p, x: p.t + WPM_WINDOW_S / 2 }))} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <ReferenceArea y1={120} y2={160} fill="var(--good)" fillOpacity={0.1} stroke="none" label={{ value: 'band-7 zone (heuristic)', position: 'insideTopLeft', fill: 'var(--muted)', fontSize: 12 }} />
            <XAxis dataKey="x" type="number" domain={[0, Math.max(durationS, 1)]} tickFormatter={(t: number) => formatClock(t)} tick={TICK} tickLine={false} axisLine={{ stroke: 'var(--line)' }} />
            <YAxis domain={[0, Math.ceil(max / 40) * 40]} tick={TICK} tickLine={false} axisLine={false} width={48} />
            <Tooltip
              cursor={{ stroke: 'var(--line-strong, var(--muted))' }}
              content={({ active, payload }) =>
                active && payload?.[0] ? (
                  <div className="rounded-card border border-line bg-surface px-3 py-2 text-sm shadow-pop">
                    <p className="text-muted tabular-nums">
                      {formatClock(payload[0].payload.t)}–{formatClock(Math.min(payload[0].payload.t + WPM_WINDOW_S, durationS))}
                    </p>
                    <p className="font-medium tabular-nums">{Math.round(payload[0].payload.wpm)} wpm</p>
                  </div>
                ) : null
              }
            />
            <Area type="monotone" dataKey="wpm" stroke="var(--accent)" strokeWidth={2} fill="none" activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
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
      <div className="relative h-11 rounded-control bg-surface-2">
        <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-accent" style={{ left: `${Math.min(100, (audio.time / d) * 100)}%` }} />
        {metrics.pauses.map((p) => (
          <button
            key={p.start}
            type="button"
            onClick={() => audio.seek(p.start)}
            aria-label={`${isLongPause(p) ? 'Long pause' : 'Pause'} of ${pauseSec(p)} seconds at ${formatClock(Math.floor(p.start))}${p.midClause ? ', mid-clause' : ''}`}
            className="group absolute inset-y-0 min-w-3 after:absolute after:inset-y-0 after:left-1/2 after:w-[max(100%,2.75rem)] after:-translate-x-1/2"
            style={{ left: `${(p.start / d) * 100}%`, width: `${(p.dur / d) * 100}%` }}
          >
            {/* 44 × 44 px hit area (::after); the visible mark sits inside it. */}
            <span className={`absolute inset-x-0 inset-y-1.5 rounded-sm transition-transform group-hover:scale-y-110 ${isLongPause(p) ? 'bg-bad' : 'bg-warn/60'}`} />
          </button>
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
          const ind = s.tone === 'na' ? null : INDICATOR[s.tone];
          return (
            <div key={s.key} className="bg-surface p-4">
              {/* The icon is glued to the last word, so a wrapped label keeps it attached. */}
              <dt className="text-sm text-muted">
                {s.label.split(' ').slice(0, -1).join(' ')}{' '}
                <span className="whitespace-nowrap">
                  {s.label.split(' ').at(-1)}
                  <span className="ml-1 inline-flex align-middle [&_button]:hit">
                    <InfoTip label={`About ${s.label}`}>{s.info}</InfoTip>
                  </span>
                </span>
              </dt>
              <dd className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{s.value}</dd>
              {ind && (
                <dd className={`mt-1 flex items-center gap-1 text-xs font-medium ${ind.cls}`}>
                  <ind.Icon className="size-3.5" aria-hidden />
                  {ind.text}
                </dd>
              )}
            </div>
          );
        })}
      </dl>
    </Card>
  );
}

/** Fluency tab: pace chart, pause timeline, stat grid. `fc`/`target` explain a low band when the measures look fine. */
export function FluencyPanel({ metrics, audio, fc, target }: { metrics: SpeechMetrics; audio: AudioControls; fc?: Criterion; target: number }) {
  const stats = speechStats(metrics);
  const heldBack = fc && fc.band < target && !tooShortToMeasure(metrics) && stats.every((s) => s.tone !== 'bad');
  return (
    <div className="space-y-8">
      {heldBack && (
        <Alert title={`Your delivery measures look fine, but Fluency & Coherence is ${fc.band.toFixed(1)}`}>
          The band is limited by something these numbers don't capture, such as answer length, relevance or how ideas connect. {fc.summary}
        </Alert>
      )}
      <section>
        <h2 className="mb-3 text-lg font-semibold">Pace</h2>
        <WpmChart series={metrics.wpmSeries} durationS={metrics.durationS} />
      </section>
      <section>
        <h2 className="mb-1 text-lg font-semibold">Pauses</h2>
        <p className="mb-3 text-sm text-muted">
          {metrics.pauses.length} pauses · {metrics.pauses.filter(isLongPause).length} long · {metrics.midClausePauses} mid-clause. Tap one to hear it.
        </p>
        <PauseTimeline metrics={metrics} audio={audio} />
      </section>
      <section>
        <h2 className="mb-1 text-lg font-semibold">Fluency measures</h2>
        <p className="mb-3 text-sm text-muted">{tooShortToMeasure(metrics) ? 'Not enough speech to measure. Answer for at least 20 seconds to see these.' : 'Compared with typical band-7 speech. These are guides, not the score.'}</p>
        <StatGrid stats={stats} />
      </section>
    </div>
  );
}
