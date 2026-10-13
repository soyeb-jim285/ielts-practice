// Pronunciation playground: our wav2vec2 phoneme scorer on Modal (modal/pronunciation) on your own recording or a speechocean762 sample with
// its human scores. Scores are 0-100 per word (phone posteriors force-aligned to the expected phones) and are not yet calibrated to IELTS bands.
import { Mic, Play, Square, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, Card, Select, Spinner, Textarea } from '@/components/ui';
import { useRecorder } from '@/hooks/useRecorder';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { audioFormat, blobToBase64, pronTone } from './playground';

type Phone = { expected: string; heard: string; score: number; ok: boolean };
type PronWord = { word: string; score: number | null; accent: 'us' | 'gb' | null; start: number | null; end: number | null; phones: Phone[] };
type PronRun = {
  mode: 'scripted' | 'spontaneous';
  text: string;
  audioSeconds: number;
  accuracy: number | null;
  mispronouncedWords: number;
  words: PronWord[];
  fluency: { wordsPerMinute: number | null; phonesPerSecond: number | null; pauses: number; longPauses: number; speakingSeconds: number };
  confusions: { expected: string; heard: string; count: number }[];
  timing: Record<string, number>;
  latencyMs: number;
  costUsd: number;
};
type Human = { accuracy: number; completeness: number; fluency: number; prosodic: number; total: number };
type Sample = { file: string; text: string; human: Human; ours: number | null };
type Samples = { source: string; eval: { n: number; sentencePearson: number; wordPearson: number; wordN: number }; samples: Sample[] };
type Clip = { blob: Blob; url: string; format: NonNullable<ReturnType<typeof audioFormat>>; label: string; human?: Human };

const TONE = { good: 'bg-good-soft text-good-text', warn: 'bg-warn-soft text-warn-text', bad: 'bg-bad-soft text-bad-text', none: 'text-muted' };
const phones = (w: PronWord, k: 'expected' | 'heard') => w.phones.map((p) => p[k]).join('');

export function PronunciationLab() {
  const [samples, setSamples] = useState<Samples>();
  const [clip, setClip] = useState<Clip>();
  const [text, setText] = useState('');
  const [state, setState] = useState<{ status: 'idle' } | { status: 'running' } | { status: 'done'; r: PronRun } | { status: 'error'; error: string }>({ status: 'idle' });
  const audio = useRef<HTMLAudioElement>(null);
  const stopAt = useRef<number | null>(null);
  const rec = useRecorder();

  useEffect(() => {
    fetch('/pron-samples/samples.json').then((r) => (r.ok ? r.json() : undefined)).then(setSamples).catch(() => {});
  }, []);
  useEffect(() => () => void (clip && URL.revokeObjectURL(clip.url)), [clip]);

  const setAudio = (blob: Blob, label: string, name = '', human?: Human) => {
    const format = audioFormat(blob.type, name);
    if (!format) return setState({ status: 'error', error: `Unsupported audio type ${blob.type || name}. Use webm, ogg, m4a, wav or mp3.` });
    setClip({ blob, url: URL.createObjectURL(blob), format, label, human });
    setState({ status: 'idle' });
  };
  const record = async () => {
    if (rec.state !== 'recording') return void (await rec.start());
    const r = await rec.stop();
    setAudio(r.blob, `Recording, ${Math.round(r.durationMs / 1000)} s`);
  };
  const pickSample = async (i: number) => {
    const s = samples?.samples[i];
    if (!s) return;
    const blob = await fetch(`/pron-samples/${s.file}`).then((r) => r.blob());
    setAudio(new Blob([blob], { type: 'audio/wav' }), `Sample ${i + 1} (speechocean762)`, s.file, s.human);
    setText(s.text);
  };
  const assess = async () => {
    if (!clip) return;
    setState({ status: 'running' });
    try {
      const r = await api.post<PronRun>('/admin/pronunciation/assess', { audio: await blobToBase64(clip.blob), format: clip.format, text: text.trim() || undefined });
      setState({ status: 'done', r });
    } catch (e) {
      setState({ status: 'error', error: e instanceof ApiError ? e.message : (e as Error).message });
    }
  };
  /** Plays one word: from its start to its end. */
  const play = (w: PronWord) => {
    const a = audio.current;
    if (!a || w.start == null || w.end == null) return;
    a.currentTime = Math.max(0, w.start - 0.05);
    stopAt.current = w.end + 0.1;
    void a.play();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="space-y-6">
        <Card>
          <h2 className="type-h4 mb-3">1. Audio</h2>
          <div className="flex flex-wrap gap-2">
            <Button variant={rec.state === 'recording' ? 'destructive' : 'primary'} icon={rec.state === 'recording' ? <Square /> : <Mic />} onClick={() => void record()}>
              {rec.state === 'recording' ? `Stop (${Math.round(rec.elapsedMs / 1000)} s)` : 'Record'}
            </Button>
            <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-md border border-line px-4 text-sm font-medium hover:bg-surface-2 focus-within:ring-2 focus-within:ring-brand">
              <Upload className="size-4" aria-hidden />
              Upload file
              <input type="file" accept="audio/*,.webm,.m4a,.mp3,.wav,.ogg" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) setAudio(f, f.name, f.name); e.target.value = ''; }} />
            </label>
          </div>
          {samples && (
            <Select className="mt-3" label="Or a sample with human scores" value="" onChange={(e) => void pickSample(Number(e.target.value))}>
              <option value="" disabled>Choose a sample…</option>
              {samples.samples.map((s, i) => (
                <option key={s.file} value={i}>{`${i + 1}. human ${s.human.accuracy}/10 · "${s.text.slice(0, 40)}${s.text.length > 40 ? '…' : ''}"`}</option>
              ))}
            </Select>
          )}
          {rec.error && <p className="mt-2 text-sm text-bad-text">{rec.error}</p>}
          {clip && (
            <div className="mt-4 space-y-1">
              <p className="type-caption">{clip.label} · {clip.format} · {(clip.blob.size / 1024).toFixed(0)} KB</p>
              <audio ref={audio} src={clip.url} controls className="w-full" onTimeUpdate={(e) => { if (stopAt.current != null && e.currentTarget.currentTime >= stopAt.current) { e.currentTarget.pause(); stopAt.current = null; } }} />
            </div>
          )}
        </Card>

        <Card>
          <h2 className="type-h4 mb-3">2. What was said</h2>
          <Textarea label="Text read aloud (optional)" rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} hint="With text, each word is scored against it. Leave it empty for free speech: the clip is transcribed first, so a misheard word is scored as what Whisper wrote." />
          <Button className="mt-4 w-full" icon={<Play />} loading={state.status === 'running'} disabled={!clip || state.status === 'running'} onClick={() => void assess()}>
            Assess pronunciation
          </Button>
          <p className="type-caption mt-2">Our wav2vec2 scorer on a Modal T4. The first run after ~2 idle minutes cold-starts (~20-40 s).</p>
        </Card>

        {samples && (
          <Card>
            <h2 className="type-h4 mb-1">Agreement with human raters</h2>
            <p className="text-sm">
              On {samples.eval.n} speechocean762 test clips (L2 speakers, 5 expert raters): sentence accuracy r = <span className="type-num font-medium">{samples.eval.sentencePearson}</span>, word accuracy r = <span className="type-num font-medium">{samples.eval.wordPearson}</span> ({samples.eval.wordN} words).
            </p>
            <p className="type-caption mt-1">Published systems reach about 0.7-0.8 at sentence level. Samples: {samples.source}.</p>
          </Card>
        )}
      </div>

      <section aria-label="Results" className="space-y-4">
        {state.status === 'idle' && <p className="type-caption">Record yourself (read a passage aloud, or just talk), upload a file, or pick a sample, then assess. Click a word to hear it; hover for expected and heard sounds.</p>}
        {state.status === 'running' && <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> Scoring…</div>}
        {state.status === 'error' && <p className="text-sm text-bad-text">{state.error}</p>}
        {state.status === 'done' && <PronResult r={state.r} human={clip?.human} onPlay={play} />}
      </section>
    </div>
  );
}

function PronResult({ r, human, onPlay }: { r: PronRun; human?: Human; onPlay: (w: PronWord) => void }) {
  const flagged = r.words.filter((w) => w.phones.some((p) => !p.ok));
  return (
    <>
      <Card>
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {[
            ['Accuracy', r.accuracy == null ? '—' : `${r.accuracy}/100`],
            ...(human ? [['Human accuracy', `${human.accuracy * 10}/100`], ['Human total', `${human.total}/10`]] : []),
            ['Words off', `${r.mispronouncedWords}/${r.words.length}`],
            ['Rate', r.fluency.wordsPerMinute == null ? '—' : `${r.fluency.wordsPerMinute} wpm`],
            ['Pauses', `${r.fluency.pauses} (${r.fluency.longPauses} long)`],
            ['Mode', r.mode],
            ['Latency', `${(r.latencyMs / 1000).toFixed(1)} s`],
            ['Cost', `$${r.costUsd.toFixed(5)} est.`],
          ].map(([k, v]) => (
            <div key={k} className="flex gap-1.5"><dt className="text-muted">{k}</dt><dd className="type-num font-medium">{v}</dd></div>
          ))}
        </dl>
        <p className="mt-4 flex flex-wrap gap-x-1 gap-y-1.5 leading-relaxed" aria-label="Words by score">
          {r.words.map((w, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onPlay(w)}
              title={w.score == null ? 'not scored' : `${w.score}/100 · expected /${phones(w, 'expected')}/ (${w.accent === 'gb' ? 'UK' : 'US'}) · heard /${phones(w, 'heard')}/`}
              className={cn('rounded px-1 focus-visible:ring-2 focus-visible:ring-brand', TONE[pronTone(w.score)])}
            >
              {w.word}
            </button>
          ))}
        </p>
        <p className="type-caption mt-3">Green 80+, amber 60-79, red under 60 (display cut-offs, not bands). A word is scored against UK or US pronunciation, whichever fits better.</p>
      </Card>

      {r.confusions.length > 0 && (
        <Card>
          <h3 className="font-semibold">Sounds to work on</h3>
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">
            {r.confusions.map((c) => (
              <li key={`${c.expected}${c.heard}`} className="rounded-md bg-surface-2 px-2 py-1">/{c.expected}/ heard as /{c.heard}/ <span className="type-num text-muted">×{c.count}</span></li>
            ))}
          </ul>
        </Card>
      )}

      {flagged.length > 0 && (
        <Card>
          <h3 className="font-semibold">Words with a mispronounced sound</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted"><tr><th className="py-1 pr-3 font-medium">Word</th><th className="py-1 pr-3 font-medium">Score</th><th className="py-1 pr-3 font-medium">Expected</th><th className="py-1 font-medium">Heard</th></tr></thead>
              <tbody>
                {flagged.map((w, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="py-1 pr-3"><button type="button" className="underline-offset-4 hover:underline" onClick={() => onPlay(w)}>{w.word}</button></td>
                    <td className="type-num py-1 pr-3">{w.score}</td>
                    <td className="py-1 pr-3 font-mono">/{phones(w, 'expected')}/</td>
                    <td className="py-1 font-mono">/{w.phones.map((p, j) => <span key={j} className={cn(!p.ok && 'font-semibold text-bad-text')}>{p.heard}</span>)}/</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <details>
        <summary className="cursor-pointer text-sm text-muted">Raw response</summary>
        <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-surface-2 p-3 text-xs">{JSON.stringify(r, null, 2)}</pre>
      </details>
    </>
  );
}
