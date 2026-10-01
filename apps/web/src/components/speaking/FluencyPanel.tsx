import { WPM_WINDOW_S, type SpeechMetrics } from '@ielts/core';
import type { Criterion } from '@server/ai/types';
import { ChevronDown, CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Alert, buttonStyles, Card, Chip, Collapsible, CollapsibleContent, CollapsibleTrigger, InfoTip } from '@/components/ui';
import { formatClock, plural } from '@/lib/format';
import { DISFLUENCY, disfluencyEvents, disfluencyTypes, isLongPause, pauseSec, speechStats, tooShortToMeasure, type Stat } from '@/lib/result';
import { MARKER_TYPES, wpmAt, type Marker, type MarkerType, type Timeline } from '@/lib/timeline';
import type { AudioControls } from './AudioBar';
import { markerLabel, MarkerDetail, MarkerShape, ShapeEl, TYPE_STYLE } from './timeline';

const TICK = { fill: 'var(--muted)', fontSize: 12 };

/** Pace over time (10 s windows, plotted at their midpoint on the same 0–duration axis as the pause strip) with the typical band-7 zone shaded. Mistakes sit on the line (shape and colour per type), questions are bands, long pauses are shaded, and the teal line follows the audio. */
export function WpmChart({ series, durationS, timeline, audio }: { series: SpeechMetrics['wpmSeries']; durationS: number; timeline: Timeline; audio: AudioControls }) {
  const [off, setOff] = useState<Set<MarkerType>>(new Set());
  const [tip, setTip] = useState<{ m: Marker; x: number; y: number } | null>(null);
  if (series.length < 2) return <p className="text-sm text-muted">This answer is too short for a pace chart (it needs at least 15 seconds).</p>;
  const max = Math.max(200, ...series.map((p) => p.wpm));
  const top = Math.ceil(max / 40) * 40;
  const counts = Object.fromEntries(MARKER_TYPES.map((t) => [t, timeline.markers.filter((m) => m.type === t).length])) as Record<MarkerType, number>;
  const multi = timeline.questions.length > 1;
  const marker = timeline.markers.find((m) => m.id === audio.focus);
  const toggle = (t: MarkerType) => setOff((o) => { const n = new Set(o); if (!n.delete(t)) n.add(t); return n; });
  return (
    <figure>
      <div className="relative h-56 w-full sm:h-64" role="img" aria-label={`Words per minute over time, from ${Math.round(Math.min(...series.map((p) => p.wpm)))} to ${Math.round(Math.max(...series.map((p) => p.wpm)))}`}>
        <ResponsiveContainer>
          <AreaChart data={series.map((p) => ({ ...p, x: p.t + WPM_WINDOW_S / 2 }))} margin={{ top: 16, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <ReferenceArea y1={120} y2={160} fill="var(--good)" fillOpacity={0.1} stroke="none" label={{ value: 'Typical band 7', position: 'insideTopRight', fill: 'var(--muted)', fontSize: 12 }} />
            {multi && timeline.questions.map((q) => q.idx % 2 === 1 && <ReferenceArea key={`b${q.idx}`} x1={q.start} x2={q.end} fill="var(--ink)" fillOpacity={0.04} stroke="none" />)}
            {timeline.pauses.map((p) => <ReferenceArea key={`p${p.start}`} x1={p.start} x2={p.end} fill="var(--chart-3)" fillOpacity={0.25} stroke="none" />)}
            {multi && timeline.questions.map((q) => <ReferenceLine key={`l${q.idx}`} x={q.start} stroke="var(--line-strong)" strokeDasharray="3 3" label={{ value: `Q${q.idx + 1}`, position: 'insideTopLeft', fill: 'var(--muted)', fontSize: 12 }} />)}
            <XAxis dataKey="x" type="number" domain={[0, Math.max(durationS, 1)]} tickFormatter={(t: number) => formatClock(t)} tick={TICK} tickLine={false} axisLine={{ stroke: 'var(--line)' }} />
            <YAxis domain={[0, top]} tick={TICK} tickLine={false} axisLine={false} width={48} />
            <Tooltip
              cursor={{ stroke: 'var(--line-strong, var(--muted))' }}
              content={({ active, payload }) =>
                active && payload?.[0] ? (
                  <div className="rounded-md border border-line bg-surface px-3 py-2 text-sm shadow-pop">
                    <p className="text-muted tabular-nums">
                      {formatClock(payload[0].payload.t)}–{formatClock(Math.min(payload[0].payload.t + WPM_WINDOW_S, durationS))}
                    </p>
                    <p className="font-medium tabular-nums">{Math.round(payload[0].payload.wpm)} wpm</p>
                  </div>
                ) : null
              }
            />
            <Area type="linear" dataKey="wpm" stroke="var(--ink)" strokeOpacity={0.55} strokeWidth={2} fill="none" activeDot={false} isAnimationActive={false} />
            {timeline.markers.filter((m) => !off.has(m.type) && m.t <= durationS).map((m) => (
              <ReferenceDot
                key={m.id}
                x={m.t}
                y={wpmAt(series, WPM_WINDOW_S, m.t)}
                ifOverflow="visible"
                shape={({ cx = 0, cy = 0 }) => (
                  <g
                    role="button"
                    tabIndex={0}
                    aria-label={markerLabel(m)}
                    aria-pressed={audio.focus === m.id}
                    className="cursor-pointer outline-none [&:focus-visible>circle]:stroke-brand"
                    onClick={() => audio.pick(m)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), audio.pick(m))}
                    onMouseEnter={() => setTip({ m, x: cx, y: cy })}
                    onMouseLeave={() => setTip(null)}
                    onFocus={() => setTip({ m, x: cx, y: cy })}
                    onBlur={() => setTip(null)}
                  >
                    <circle cx={cx} cy={cy} r={16} fill="transparent" stroke={audio.focus === m.id ? 'var(--ink)' : 'none'} strokeWidth={1.5} /> {/* 32 px hit area; ring when picked or focused */}
                    <g fill={TYPE_STYLE[m.type].color} stroke="var(--surface)" strokeWidth={1.5}>
                      <ShapeEl type={m.type} x={cx} y={cy} r={5} />
                    </g>
                  </g>
                )}
              />
            ))}
            <ReferenceLine x={Math.min(audio.time, durationS)} stroke="var(--accent)" strokeWidth={2} ifOverflow="visible" />
          </AreaChart>
        </ResponsiveContainer>
        {tip && (
          <div role="tooltip" className="pointer-events-none absolute z-10 max-w-60 -translate-x-1/2 -translate-y-full rounded-md border border-line bg-surface px-3 py-2 text-sm shadow-pop" style={{ left: Math.min(Math.max(tip.x, 100), 9999), top: tip.y - 14 }}>
            <p className="type-caption type-num">{TYPE_STYLE[tip.m.type].label}, {formatClock(Math.floor(tip.m.t))}</p>
            <p>{tip.m.label}</p>
          </div>
        )}
      </div>
      <figcaption className="type-caption mt-2 text-xs">
        Words per minute in 10-second windows, every 5 seconds. Shaded green: roughly where band-7 speakers sit.
      </figcaption>
      <ul className="mt-3 flex flex-wrap items-center gap-2" aria-label="Show mistake types">
        {MARKER_TYPES.filter((t) => counts[t] > 0).map((t) => (
          <li key={t}>
            <Chip selected={!off.has(t)} onClick={() => toggle(t)}>
              <MarkerShape type={t} />
              {TYPE_STYLE[t].label}
              <span className="tabular-nums opacity-70">{counts[t]}</span>
            </Chip>
          </li>
        ))}
        {timeline.pauses.length > 0 && <li className="type-caption flex items-center gap-1.5 px-1"><span className="h-3 w-4 rounded-xs bg-chart-3/25" />Long pause</li>}
        <li className="type-caption flex items-center gap-1.5 px-1"><span className="h-3 w-0.5 bg-brand" />Playing now</li>
      </ul>
      {marker && <div className="mt-4"><MarkerDetail marker={marker} audio={audio} /></div>}
    </figure>
  );
}

/** Whole-recording bar with every pause placed on it; tap one to hear the moment before it. */
export function PauseTimeline({ metrics, audio }: { metrics: SpeechMetrics; audio: AudioControls }) {
  const d = Math.max(metrics.durationS, 1);
  return (
    <div>
      <div className="relative h-11 rounded-control bg-surface-2">
        <span aria-hidden className="absolute inset-y-0 z-10 w-0.5 rounded-full bg-brand" style={{ left: `${Math.min(100, (audio.time / d) * 100)}%` }} />
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
            <span className={`absolute inset-x-0 inset-y-1.5 rounded-sm transition-transform group-hover:scale-y-110 group-focus-visible:scale-y-110 ${isLongPause(p) ? 'bg-bad' : 'bg-warn/60'}`} />
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[13px] text-muted tabular-nums">
        <span>0:00</span>
        <span className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-xs bg-warn/60" />Short, 0.25–1 s</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-xs bg-bad" />Long, 1 s or more</span>
        </span>
        <span>{formatClock(Math.round(d))}</span>
      </div>
    </div>
  );
}

const TICK_BG = { neutral: 'bg-muted', info: 'bg-sky', accent: 'bg-brand', warn: 'bg-warn' };

/** Every filler, repeat, repair and false start placed on the recording, one colour per type (same as the transcript chips); tap one to hear it. */
export function DisfluencyStrip({ metrics, audio }: { metrics: SpeechMetrics; audio: AudioControls }) {
  const d = Math.max(metrics.durationS, 1);
  const events = disfluencyEvents(metrics);
  const kinds = [...new Set(events.map((e) => e.kind))];
  return (
    <div>
      <div className="relative h-9 rounded-control bg-surface-2">
        <span aria-hidden className="absolute inset-y-0 z-10 w-0.5 rounded-full bg-brand" style={{ left: `${Math.min(100, (audio.time / d) * 100)}%` }} />
        {events.map((e, i) => {
          const detail = DISFLUENCY[e.kind].short;
          return (
            <button
              key={i}
              type="button"
              onClick={() => audio.seek(e.start)}
              aria-label={`${detail} at ${formatClock(Math.floor(e.start))}`}
              title={`${detail}, ${formatClock(Math.floor(e.start))}`}
              className="group absolute inset-y-0 w-3 -translate-x-1/2 after:absolute after:inset-y-0 after:left-1/2 after:w-11 after:-translate-x-1/2"
              style={{ left: `${Math.min(100, (e.start / d) * 100)}%` }}
            >
              <span className={`absolute inset-x-[3px] inset-y-1.5 rounded-sm transition-transform group-hover:scale-y-110 group-focus-visible:scale-y-110 ${TICK_BG[DISFLUENCY[e.kind].tone]}`} />
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[13px] text-muted tabular-nums">
        <span>0:00</span>
        <span className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          {kinds.map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className={`size-2.5 rounded-xs ${TICK_BG[DISFLUENCY[k].tone]}`} />
              {DISFLUENCY[k].label}
            </span>
          ))}
        </span>
        <span>{formatClock(Math.round(d))}</span>
      </div>
    </div>
  );
}

/** One card per disfluency type: how many, how often, and what is normal versus what hurts coherence. */
function DisfluencyBreakdown({ metrics }: { metrics: SpeechMetrics }) {
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {disfluencyTypes(metrics).map((t) => {
        const ind = t.tone === 'na' ? null : INDICATOR[t.tone];
        return (
          <li key={t.kind}>
            <Card className="h-full space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="type-subheading">{t.label}</h3>
                  <p className="type-caption mt-0.5">{t.what}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="type-num text-2xl font-semibold tracking-tight">{t.count}</p>
                  <p className="type-caption type-num">{tooShortToMeasure(metrics) ? '' : `${t.perMin.toFixed(1)}/min`}</p>
                </div>
              </div>
              {ind && (
                <p className={`flex items-center gap-1 text-xs font-medium ${ind.cls}`}>
                  <ind.Icon className="size-3.5" aria-hidden />
                  {ind.text}
                </p>
              )}
              <Collapsible className="group">
                <CollapsibleTrigger className={buttonStyles({ variant: 'link', className: 'hit -ml-0.5 text-sm' })}>
                  <span className="group-data-[state=open]:hidden">When is this a problem?</span>
                  <span className="hidden group-data-[state=open]:inline">Hide</span>
                  <ChevronDown className="size-4 transition-transform duration-200 group-data-[state=open]:rotate-180" aria-hidden />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <dl className="space-y-1.5 pt-2 text-sm">
                    <div>
                      <dt className="inline font-medium">Normal: </dt>
                      <dd className="inline text-muted">{t.normal}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">Hurts when: </dt>
                      <dd className="inline text-muted">{t.harmful}</dd>
                    </div>
                  </dl>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

const INDICATOR = {
  good: { Icon: CircleCheck, text: 'On target', cls: 'text-good-text' },
  warn: { Icon: TriangleAlert, text: 'Watch', cls: 'text-warn-text' },
  bad: { Icon: CircleX, text: 'Work on this', cls: 'text-bad-text' },
};

/** Worst first (bad before warn, then the list's order): the text badge goes on the top few only, so "Work on this" keeps its signal; the rest get a dot with a hidden label. */
const BADGED = 3;
const DOT = { good: 'bg-good', warn: 'bg-warn', bad: 'bg-bad' };
export function StatGrid({ stats }: { stats: Stat[] }) {
  const worst = new Set(
    stats
      .filter((s) => s.tone === 'warn' || s.tone === 'bad')
      .sort((a, b) => Number(b.tone === 'bad') - Number(a.tone === 'bad'))
      .slice(0, BADGED)
      .map((s) => s.key),
  );
  return (
    <Card padded={false} className="overflow-hidden">
      {/* -mr-px/-mb-px push the last cell borders outside the clipped panel, so no grey gaps show in a short last row. */}
      <dl className="-mr-px -mb-px grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 [&>div]:border-r [&>div]:border-b [&>div]:border-line">
        {stats.map((s) => {
          const ind = s.tone === 'na' ? null : INDICATOR[s.tone];
          return (
            <div key={s.key} className="p-4">
              {/* The icon is glued to the last word, so a wrapped label keeps it attached. */}
              <dt className="type-caption">
                {s.label.split(' ').slice(0, -1).join(' ')}{' '}
                <span className="whitespace-nowrap">
                  {s.label.split(' ').at(-1)}
                  <span className="ml-1 inline-flex align-middle [&_button]:hit">
                    <InfoTip label={`About ${s.label}`}>{s.info}</InfoTip>
                  </span>
                </span>
              </dt>
              <dd className="type-num mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
                {s.value}
                {ind && !worst.has(s.key) && s.tone !== 'na' && (
                  <span title={ind.text} className={`size-2 rounded-full ${DOT[s.tone]}`}>
                    <span className="sr-only">{ind.text}</span>
                  </span>
                )}
              </dd>
              {ind && worst.has(s.key) && (
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

/** Fluency tab: pace chart, pause timeline, measures, then the fillers and restarts. `fc`/`target` explain a low band when the measures look fine. */
export function FluencyPanel({ metrics, timeline, audio, fc, target }: { metrics: SpeechMetrics; timeline: Timeline; audio: AudioControls; fc?: Criterion; target: number }) {
  const stats = speechStats(metrics);
  const heldBack = fc && fc.band < target && !tooShortToMeasure(metrics) && stats.every((s) => s.tone !== 'bad');
  return (
    <div className="space-y-10">
      {heldBack && (
        <Alert title={`Your delivery measures look fine, but Fluency & Coherence is ${fc.band.toFixed(1)}`}>
          The band is limited by something these numbers don't capture, such as answer length, relevance or how ideas connect. {fc.summary}
        </Alert>
      )}
      <section>
        <h2 className="type-heading mb-4">Pace</h2>
        <Card>
          <WpmChart series={metrics.wpmSeries} durationS={metrics.durationS} timeline={timeline} audio={audio} />
        </Card>
      </section>
      <section>
        <h2 className="type-heading">Pauses</h2>
        <p className="type-caption mt-1 mb-4 text-sm">
          {plural(metrics.pauses.length, 'pause')}, {metrics.pauses.filter(isLongPause).length} long, {metrics.midClausePauses} mid-clause. Tap one to hear it.
        </p>
        <Card>
          <PauseTimeline metrics={metrics} audio={audio} />
        </Card>
      </section>
      <section>
        <h2 className="type-heading">Fluency measures</h2>
        <p className="type-caption mt-1 mb-4 text-sm">{tooShortToMeasure(metrics) ? 'Not enough speech to measure. Answer for at least 20 seconds to see these.' : 'Compared with typical band-7 speech, not the score. The three furthest from target are labelled; a dot shows the rest (green on target, amber watch, red work on this).'}</p>
        <StatGrid stats={stats} />
      </section>
      <section>
        <h2 className="type-heading">Fillers, repeats and restarts</h2>
        <p className="type-caption mt-1 mb-4 text-sm">Each kind is colour-coded the same way in the Transcript tab. Tap a mark to hear it.</p>
        <Card className="mb-4">
          <DisfluencyStrip metrics={metrics} audio={audio} />
        </Card>
        <DisfluencyBreakdown metrics={metrics} />
      </section>
    </div>
  );
}
