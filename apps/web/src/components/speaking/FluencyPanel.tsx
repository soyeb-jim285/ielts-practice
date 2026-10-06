import { WPM_WINDOW_S, type SpeechMetrics } from '@ielts/core';
import type { Criterion } from '@server/ai/types';
import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Disclosure, InfoNote, Section, StatList, type StatItem } from '@/components/result';
import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import { Alert, Chip } from '@/components/ui';
import { formatClock, plural } from '@/lib/format';
import { DISFLUENCY, disfluencyEvents, disfluencyTypes, isLongPause, pauseSec, speechStats, tooShortToMeasure, type Stat } from '@/lib/result';
import { MARKER_TYPES, wpmAt, type Marker, type MarkerType, type Timeline } from '@/lib/timeline';
import type { AudioControls } from './AudioBar';
import { markerLabel, MarkerDetail, MarkerShape, ShapeEl, TYPE_STYLE } from './timeline';

const TICK = { fill: 'var(--muted)', fontSize: 13 };

/** Pace over time (10 s windows, plotted at their midpoint on the same 0–duration axis as the pause strip) with the typical band-7 zone shaded. Mistakes sit on the line (shape and colour per type), questions are bands, long pauses are shaded, and the teal line follows the audio. */
export function WpmChart({ series, durationS, timeline, audio }: { series: SpeechMetrics['wpmSeries']; durationS: number; timeline: Timeline; audio: AudioControls }) {
  const [off, setOff] = useState<Set<MarkerType>>(new Set());
  const [tip, setTip] = useState<{ m: Marker; x: number; y: number } | null>(null);
  if (series.length < 2) return <p className="type-body">This answer is too short for a pace chart (it needs at least 15 seconds).</p>;
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
            <ReferenceArea y1={120} y2={160} fill="var(--good)" fillOpacity={0.1} stroke="none" label={{ value: 'Typical band 7', position: 'insideTopRight', fill: 'var(--muted)', fontSize: 13 }} />
            {multi && timeline.questions.map((q) => q.idx % 2 === 1 && <ReferenceArea key={`b${q.idx}`} x1={q.start} x2={q.end} fill="var(--ink)" fillOpacity={0.04} stroke="none" />)}
            {timeline.pauses.map((p) => <ReferenceArea key={`p${p.start}`} x1={p.start} x2={p.end} fill="var(--chart-3)" fillOpacity={0.25} stroke="none" />)}
            {multi && timeline.questions.map((q) => <ReferenceLine key={`l${q.idx}`} x={q.start} stroke="var(--line-strong)" strokeDasharray="3 3" label={{ value: `Q${q.idx + 1}`, position: 'insideTopLeft', fill: 'var(--muted)', fontSize: 13 }} />)}
            <XAxis dataKey="x" type="number" domain={[0, Math.max(durationS, 1)]} tickFormatter={(t: number) => formatClock(t)} tick={TICK} tickLine={false} axisLine={{ stroke: 'var(--line)' }} />
            <YAxis domain={[0, top]} tick={TICK} tickLine={false} axisLine={false} width={48} />
            <Tooltip
              cursor={{ stroke: 'var(--line-strong, var(--muted))' }}
              content={({ active, payload }) =>
                active && payload?.[0] ? (
                  <div className="rounded-md border border-line bg-surface px-3 py-2 shadow-pop">
                    <p className="type-caption type-num">
                      {formatClock(payload[0].payload.t)}–{formatClock(Math.min(payload[0].payload.t + WPM_WINDOW_S, durationS))}
                    </p>
                    <p className="type-body type-num">{Math.round(payload[0].payload.wpm)} wpm</p>
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
          <div role="tooltip" className="pointer-events-none absolute z-10 max-w-60 -translate-x-1/2 -translate-y-full rounded-md border border-line bg-surface px-3 py-2 shadow-pop" style={{ left: Math.min(Math.max(tip.x, 100), 9999), top: tip.y - 14 }}>
            <p className="type-caption type-num">{TYPE_STYLE[tip.m.type].label}, {formatClock(Math.floor(tip.m.t))}</p>
            <p className="type-body">{tip.m.label}</p>
          </div>
        )}
      </div>
      <ul className="mt-4 flex flex-wrap items-center gap-2" aria-label="Show mistake types">
        {MARKER_TYPES.filter((t) => counts[t] > 0).map((t) => (
          <li key={t}>
            <Chip selected={!off.has(t)} onClick={() => toggle(t)}>
              <MarkerShape type={t} />
              {TYPE_STYLE[t].label}
              <span className="type-num opacity-70">{counts[t]}</span>
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
      <div className="type-caption type-num mt-2 flex items-center justify-between gap-3">
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
      <div className="type-caption type-num mt-2 flex items-center justify-between gap-3">
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

const INDICATOR = {
  good: { text: 'On target', tone: 'good' },
  warn: { text: 'Watch', tone: 'warn' },
  bad: { text: 'Work on this', tone: 'bad' },
} as const;

const TONE_TEXT = { good: 'text-good-text', warn: 'text-warn-text', bad: 'text-bad-text' } as const;
const TONE_ICON = { good: CircleCheck, warn: TriangleAlert, bad: CircleX } as const;

/** One row per disfluency type: name and what it is, the count, and (flat toggle) when it is normal versus when it hurts. */
function DisfluencyList({ metrics }: { metrics: SpeechMetrics }) {
  const short = tooShortToMeasure(metrics);
  return (
    <ul className="max-w-[68ch] divide-y divide-line">
      {disfluencyTypes(metrics).map((t) => {
        const ind = t.tone === 'na' ? null : INDICATOR[t.tone];
        const Icon = ind && TONE_ICON[ind.tone];
        return (
          <li key={t.kind} className="py-4 first:pt-0">
            <div className="flex items-baseline justify-between gap-4">
              <div className="min-w-0">
                <h3 className="type-subheading">{t.label}</h3>
                <p className="type-caption mt-0.5">{t.what}</p>
              </div>
              <p className="type-body type-num shrink-0 text-right">
                {t.count}
                {!short && <span className="type-caption block">{t.perMin.toFixed(1)}/min</span>}
              </p>
            </div>
            {ind && Icon && (
              <p className={`type-caption mt-1 flex items-center gap-1 ${TONE_TEXT[ind.tone]}`}>
                <Icon className="size-3.5" aria-hidden />
                {ind.text}
              </p>
            )}
            <details className="group mt-1">
              <summary className="type-body hit cursor-pointer list-none text-accent-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">When is this a problem?</span>
                <span className="hidden group-open:inline">Hide</span>
              </summary>
              <dl className="type-body mt-2 space-y-2">
                <div>
                  <dt className="type-subheading inline">Normal </dt>
                  <dd className="inline">{t.normal}</dd>
                </div>
                <div>
                  <dt className="type-subheading inline">Hurts when </dt>
                  <dd className="inline">{t.harmful}</dd>
                </div>
              </dl>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

// Fillers, repetitions and self-corrections are counted in the fillers list below, so the measures list leaves them out.
const IN_FILLERS = new Set(['fillers', 'reps', 'self']);
const HEADLINE = new Set(['rate', 'artic', 'pauseRatio', 'long']);

/** A measure as a StatList row: label, value, status in words with an icon, and the info note. */
export const toStatItem = (s: Stat): StatItem => ({
  label: s.label,
  value: s.value,
  status: s.tone === 'na' ? undefined : INDICATOR[s.tone],
  info: <InfoNote label={`About ${s.label}`}>{s.info}</InfoNote>,
});

/** Fluency tab: pace and pauses, the key measures, then the fillers and restarts. `fc`/`target` explain a low band when the measures look fine. */
export function FluencyPanel({ metrics, timeline, audio, fc, target }: { metrics: SpeechMetrics; timeline: Timeline; audio: AudioControls; fc?: Criterion; target: number }) {
  const stats = speechStats(metrics).filter((s) => !IN_FILLERS.has(s.key));
  const heldBack = fc && fc.band < target && !tooShortToMeasure(metrics) && speechStats(metrics).every((s) => s.tone !== 'bad');
  const more = stats.filter((s) => !HEADLINE.has(s.key));
  return (
    <div className="space-y-8 md:space-y-12">
      {heldBack && (
        <Alert title={`Your delivery measures look fine, but Fluency & Coherence is ${fc.band.toFixed(1)}`}>
          The band is limited by something these numbers don't capture, such as answer length, relevance or how ideas connect. {fc.summary}
        </Alert>
      )}
      <Section title="Pace" caption="Words per minute in 10-second windows, every 5 seconds. Shaded green: roughly where band-7 speakers sit.">
        <WpmChart series={metrics.wpmSeries} durationS={metrics.durationS} timeline={timeline} audio={audio} />
        <Section level={3} title="Pauses" caption={`${plural(metrics.pauses.length, 'pause')}, ${metrics.pauses.filter(isLongPause).length} long, ${metrics.midClausePauses} mid-clause. Tap one to hear it.`}>
          <PauseTimeline metrics={metrics} audio={audio} />
        </Section>
      </Section>
      <Section title="Key measures" caption={tooShortToMeasure(metrics) ? 'Not enough speech to measure. Answer for at least 20 seconds to see these.' : 'Compared with typical band-7 speech, not the score. Each measure says whether it is on target, worth watching, or needs work.'}>
        <StatList cols={2} items={stats.filter((s) => HEADLINE.has(s.key)).map(toStatItem)} />
        {more.length > 0 && (
          <Disclosure title="More measures" meta={String(more.length)}>
            <StatList items={more.map(toStatItem)} />
          </Disclosure>
        )}
      </Section>
      <Section title="Fillers, repeats and restarts" caption="Each kind is colour-coded the same way in the Transcript tab. Tap a mark to hear it.">
        <DisfluencyStrip metrics={metrics} audio={audio} />
        <DisfluencyList metrics={metrics} />
      </Section>
    </div>
  );
}
