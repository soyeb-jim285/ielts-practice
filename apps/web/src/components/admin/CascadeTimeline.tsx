// Fast cascade (admin playground): where each reply's time went, from the end of the candidate's speech to the examiner's first audio.
import type { ReplyTiming } from '@/live/cascade';
import { Card } from '@/components/ui';

const STAGES = [
  { key: 'wait', label: 'End-of-turn wait', hint: 'silence after your last sound before the turn counted as finished (Smart Turn time excluded)', color: 'var(--chart-3)' },
  { key: 'turnModel', label: 'Turn model', hint: 'Smart Turn checks on the deciding pause, on this device', color: 'color-mix(in oklab, var(--chart-3) 50%, var(--surface))' },
  { key: 'stt', label: 'Transcription', hint: 'turn end until the final transcript', color: 'var(--sky)' },
  { key: 'llm', label: 'LLM', hint: "server: to the first sentence when streamed, else the whole line", color: 'var(--accent)' },
  { key: 'tts', label: 'Voice (TTS)', hint: 'server: then until the first audio was ready', color: 'var(--warn)' },
  { key: 'net', label: 'Network + server', hint: 'round trip minus LLM and TTS', color: 'var(--bad)' },
  { key: 'decode', label: 'Decode', hint: 'browser audio decode until playback', color: 'var(--ink)' },
] as const;
type Key = (typeof STAGES)[number]['key'];
const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function CascadeTimeline({ timeline }: { timeline: ReplyTiming[] }) {
  if (!timeline.length) return null;
  const avg = Object.fromEntries(STAGES.map((x) => [x.key, timeline.reduce((n, t) => n + t[x.key], 0) / timeline.length])) as Record<Key, number>;
  const total = STAGES.reduce((n, x) => n + avg[x.key], 0);
  const worst = STAGES.reduce((a, b) => (avg[b.key] > avg[a.key] ? b : a));
  const max = Math.max(...timeline.map((t) => t.total));
  return (
    <Card>
      <h2 className="type-h4">Reply timeline</h2>
      <p className="type-caption mt-1">From the end of your speech to the examiner's first audio, per reply. Average {s(total)} over {timeline.length} repl{timeline.length === 1 ? 'y' : 'ies'}; biggest share: <strong>{worst.label}</strong> ({s(avg[worst.key])}, {Math.round((avg[worst.key] / total) * 100)}%).</p>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Average per stage">
        {STAGES.map((x) => (
          <li key={x.key} className="flex items-center gap-1.5" title={x.hint}>
            <span className="size-3 shrink-0 rounded-sm" style={{ background: x.color }} aria-hidden />
            <span className="text-muted">{x.label}</span>
            <span className="type-num font-medium">{s(avg[x.key])}</span>
          </li>
        ))}
      </ul>
      <ol className="mt-4 space-y-2" aria-label="Replies, newest first">
        {[...timeline].reverse().map((t) => (
          <li key={t.at}>
            <div className="flex items-center gap-3">
              <div className="flex h-4 min-w-0 flex-1 overflow-hidden rounded-sm bg-surface-2" role="img" aria-label={STAGES.map((x) => `${x.label} ${s(t[x.key])}`).join(', ')}>
                {STAGES.map((x) => (
                  <span key={x.key} title={`${x.label}: ${s(t[x.key])}`} style={{ width: `${(t[x.key] / max) * 100}%`, background: x.color }} />
                ))}
              </div>
              <span className="type-num w-12 shrink-0 text-right text-sm font-medium">{s(t.total)}</span>
            </div>
            <p className="type-caption mt-0.5 truncate">{t.label}{t.checks.length ? ` · turn checks ${t.checks.join(' → ')}` : ''}{t.text ? ` · ${t.text}` : ''}</p>
          </li>
        ))}
      </ol>
      <p className="type-caption mt-3">Measured from your last sound to the examiner's first sound. Turn checks are Smart Turn's P(finished) at each pause. Hover a segment for its time.</p>
    </Card>
  );
}
