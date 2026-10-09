import { createFileRoute } from '@tanstack/react-router';
import { Mic, Play, Plus, Square, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { audioFormat, geminiUsd, gptLiveUsd, isFiller, realtimeUsd, transcriptStats, type Word } from '@/components/admin/playground';
import { Badge, Button, Card, Chip, Input, PageContainer, Segmented, Select, Spinner, Textarea } from '@/components/ui';
import { useRecorder } from '@/hooks/useRecorder';
import { useAdmin } from '@/lib/admin';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useDuplexExaminer, type Duplex, type Handlers } from '@/live/duplex';
import { GeminiDuplex } from '@/live/gemini';
import { GptLiveDuplex } from '@/live/gptLive';
import { RealtimeDuplex, type RealtimeModel } from '@/live/realtime';

type Tab = 'stt' | 'live';
export const Route = createFileRoute('/_app/admin/playground')({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => ({ tab: s.tab === 'live' ? 'live' : undefined }),
  component: Playground,
});

function Playground() {
  const { tab = 'stt' } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PageContainer>
      <AdminHeader
        title="Playground"
        description="Try transcription models on your own recordings, and talk to each live examiner engine. Runs on the house keys and shows up in Costs."
        actions={<Segmented label="Mode" value={tab} onChange={(v) => void navigate({ search: { tab: v === 'live' ? 'live' : undefined } })} options={[{ value: 'stt', label: 'Transcription' }, { value: 'live', label: 'Live examiners' }]} />}
      />
      {tab === 'stt' ? <TranscriptionLab /> : <ExaminerLab />}
    </PageContainer>
  );
}

// ---------------------------------------------------------------- transcription

type SttModel = { id: string; name: string; description: string; usdPerSecond: number | null; usdPerMTokIn: number | null; usdPerMTokOut: number | null };
type SttRun = { model: string; text: string; words: Word[]; duration: number; latencyMs: number; costUsd: number | null; costExact: boolean; raw: unknown };
type RunState = { status: 'running' } | { status: 'done'; r: SttRun } | { status: 'error'; error: string };
type Clip = { blob: Blob; url: string; format: NonNullable<ReturnType<typeof audioFormat>>; label: string };

/** The production priming prompt (server ai/openrouter.ts VERBATIM_PROMPT): disfluent text makes Whisper keep um/uh and the speaker's own word forms. */
const VERBATIM_PROMPT = 'Umm, let me think, uh... he go... he go there. Uh, she have, um, two book. Hmm, I mean, like, you know.';
const SAVED = 'admin-stt-models';
const DEFAULT_MODELS = ['openai/whisper-large-v3'];
const load = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED) ?? 'null');
    return Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : DEFAULT_MODELS;
  } catch {
    return DEFAULT_MODELS;
  }
};
const perHour = (m?: SttModel) => (m?.usdPerSecond != null ? `$${(m.usdPerSecond * 3600).toFixed(3)}/h` : m?.usdPerMTokIn != null ? `$${m.usdPerMTokIn}/$${m.usdPerMTokOut} per 1M tok` : 'price ?');
const money = (x: number | null | undefined) => (x == null ? '—' : x < 0.01 ? `$${x.toFixed(5)}` : `$${x.toFixed(3)}`);
const toBase64 = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });

function TranscriptionLab() {
  const models = useAdmin<{ models: SttModel[] }>('/stt/models');
  const [chosen, setChosen] = useState<string[]>(load);
  const [custom, setCustom] = useState('');
  const [filter, setFilter] = useState('');
  const [prompt, setPrompt] = useState<'none' | 'verbatim' | 'custom'>('none');
  const [customPrompt, setCustomPrompt] = useState('');
  const [language, setLanguage] = useState<'en' | 'auto'>('en');
  const [clip, setClip] = useState<Clip>();
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const audio = useRef<HTMLAudioElement>(null);
  const rec = useRecorder();
  const byId = useMemo(() => new Map((models.data?.models ?? []).map((m) => [m.id, m])), [models.data]);

  useEffect(() => {
    try {
      localStorage.setItem(SAVED, JSON.stringify(chosen));
    } catch {}
  }, [chosen]);
  useEffect(() => () => void (clip && URL.revokeObjectURL(clip.url)), [clip]);

  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const setAudio = (blob: Blob, label: string, name = '') => {
    const format = audioFormat(blob.type, name);
    if (!format) return setRuns({ _: { status: 'error', error: `Unsupported audio type ${blob.type || name}. Use webm, ogg, m4a, wav or mp3.` } });
    setClip({ blob, url: URL.createObjectURL(blob), format, label });
    setRuns({});
  };
  const record = async () => {
    if (rec.state === 'recording') {
      const r = await rec.stop();
      setAudio(r.blob, `Recording, ${Math.round(r.durationMs / 1000)} s`);
    } else await rec.start();
  };

  const run = async (ids: string[]) => {
    if (!clip) return;
    const audioB64 = await toBase64(clip.blob);
    const p = prompt === 'verbatim' ? VERBATIM_PROMPT : prompt === 'custom' ? customPrompt.trim() || undefined : undefined;
    setRuns((r) => ({ ...r, ...Object.fromEntries(ids.map((id) => [id, { status: 'running' } as RunState])) }));
    await Promise.all(
      ids.map(async (id) => {
        try {
          const r = await api.post<SttRun>('/admin/stt/transcribe', { model: id, audio: audioB64, format: clip.format, prompt: p, language: language === 'auto' ? null : 'en' });
          setRuns((s) => ({ ...s, [id]: { status: 'done', r } }));
        } catch (e) {
          setRuns((s) => ({ ...s, [id]: { status: 'error', error: e instanceof ApiError ? e.message : (e as Error).message } }));
        }
      }),
    );
  };
  const seek = (t: number) => {
    const a = audio.current;
    if (!a) return;
    a.currentTime = Math.max(0, t - 0.15);
    void a.play();
  };

  // chosen models first, so what will run is visible without scrolling
  const list = (models.data?.models ?? []).filter((m) => !filter || `${m.id} ${m.name}`.toLowerCase().includes(filter.toLowerCase())).sort((a, b) => Number(chosen.includes(b.id)) - Number(chosen.includes(a.id)));
  const extra = chosen.filter((id) => !byId.has(id));
  const running = Object.values(runs).some((r) => r.status === 'running');

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="space-y-6">
        <Card>
          <h2 className="type-h4 mb-3">1. Audio</h2>
          <div className="flex flex-wrap gap-2">
            <Button variant={rec.state === 'recording' ? 'destructive' : 'primary'} icon={rec.state === 'recording' ? <Square /> : <Mic />} onClick={() => void record()}>
              {rec.state === 'recording' ? `Stop (${Math.round(rec.elapsedMs / 1000)} s)` : 'Record'}
            </Button>
            <label className={cn('inline-flex h-11 cursor-pointer items-center gap-2 rounded-md border border-line px-4 text-sm font-medium hover:bg-surface-2 focus-within:ring-2 focus-within:ring-brand')}>
              <Upload className="size-4" aria-hidden />
              Upload file
              <input type="file" accept="audio/*,.webm,.m4a,.mp3,.wav,.ogg" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) setAudio(f, f.name, f.name); e.target.value = ''; }} />
            </label>
          </div>
          {rec.error && <p className="mt-2 text-sm text-bad-text">{rec.error}</p>}
          {clip && (
            <div className="mt-4 space-y-1">
              <p className="type-caption">{clip.label} · {clip.format} · {(clip.blob.size / 1024).toFixed(0)} KB</p>
              <audio ref={audio} src={clip.url} controls className="w-full" />
            </div>
          )}
        </Card>

        <Card>
          <h2 className="type-h4 mb-3">2. Models</h2>
          <Input label="Filter" hideLabel placeholder="Filter OpenRouter models" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <ul className="mt-3 max-h-80 space-y-1 overflow-y-auto pr-1" aria-label="Transcription models">
            {models.isLoading && <li><Spinner /></li>}
            {list.map((m) => (
              <li key={m.id}>
                <label className="flex cursor-pointer items-start gap-2 rounded-md p-1.5 hover:bg-surface-2">
                  <input type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" checked={chosen.includes(m.id)} onChange={() => toggle(m.id)} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium" title={m.description}>{m.name}</span>
                    <span className="type-caption block truncate">{m.id} · {perHour(m)}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); const id = custom.trim(); if (id && !chosen.includes(id)) setChosen((c) => [...c, id]); setCustom(''); }}>
            <Input label="Add model id" hideLabel placeholder="vendor/model-id" value={custom} onChange={(e) => setCustom(e.target.value)} className="flex-1" />
            <Button type="submit" variant="outline" size="icon" aria-label="Add model"><Plus /></Button>
          </form>
          {extra.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {extra.map((id) => (
                <Chip key={id} selected onClick={() => toggle(id)} aria-label={`Remove ${id}`}>{id} <X className="size-3" aria-hidden /></Chip>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <h2 className="type-h4 mb-3">3. Options</h2>
          <div className="space-y-3">
            <Select label="Priming prompt" value={prompt} onChange={(e) => setPrompt(e.target.value as typeof prompt)} hint="Only Whisper-style hosts read a prompt.">
              <option value="none">None</option>
              <option value="verbatim">Production verbatim prompt</option>
              <option value="custom">Custom</option>
            </Select>
            {prompt === 'custom' && <Textarea label="Custom prompt" rows={3} value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} maxLength={1000} />}
            <Select label="Language" value={language} onChange={(e) => setLanguage(e.target.value as typeof language)}>
              <option value="en">English</option>
              <option value="auto">Detect</option>
            </Select>
          </div>
          <Button className="mt-4 w-full" icon={<Play />} loading={running} disabled={!clip || !chosen.length || running} onClick={() => void run(chosen)}>
            Transcribe with {chosen.length} model{chosen.length === 1 ? '' : 's'}
          </Button>
        </Card>
      </div>

      <section aria-label="Results" className="space-y-4">
        {runs._?.status === 'error' && <p className="text-sm text-bad-text">{runs._.error}</p>}
        {!clip && <p className="type-caption">Record or upload a clip, pick models, then transcribe. Click a word to hear it. Highlighted words are filled pauses; dotted ones have low confidence.</p>}
        {Object.entries(runs).filter(([id]) => id !== '_').map(([id, s]) => (
          <SttResult key={id} id={id} s={s} model={byId.get(id)} onSeek={seek} onRerun={() => void run([id])} />
        ))}
      </section>
    </div>
  );
}

function SttResult({ id, s, model, onSeek, onRerun }: { id: string; s: RunState; model?: SttModel; onSeek: (t: number) => void; onRerun: () => void }) {
  const st = s.status === 'done' ? transcriptStats(s.r.words) : null;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{model?.name ?? id}</h3>
          <p className="type-caption truncate">{id}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={onRerun} disabled={s.status === 'running'}>Run again</Button>
      </div>
      {s.status === 'running' && <div className="mt-3 flex items-center gap-2 text-sm text-muted"><Spinner /> Transcribing…</div>}
      {s.status === 'error' && <p className="mt-3 text-sm text-bad-text">{s.error}</p>}
      {s.status === 'done' && st && (
        <>
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {[
              ['Latency', `${(s.r.latencyMs / 1000).toFixed(1)} s`],
              ['Cost', `${money(s.r.costUsd)}${s.r.costUsd != null && !s.r.costExact ? ' est.' : ''}`],
              ['Words', st.words],
              ['Fillers', st.fillers],
              ['Repeats', st.repeats],
              ['Rate', `${st.wpm} wpm`],
              ['Word times', s.r.words.length ? 'yes' : 'none'],
            ].map(([k, v]) => (
              <div key={k as string} className="flex gap-1.5"><dt className="text-muted">{k}</dt><dd className="type-num font-medium">{v}</dd></div>
            ))}
          </dl>
          {s.r.words.length ? (
            <p className="mt-3 flex flex-wrap gap-x-1 gap-y-1.5 leading-relaxed">
              {s.r.words.map((w, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onSeek(w.start)}
                  title={`${w.start.toFixed(2)}–${w.end.toFixed(2)} s${w.conf != null ? ` · conf ${w.conf}` : ''}`}
                  className={cn('rounded px-0.5 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand', isFiller(w.w) && 'bg-warn-soft text-warn-text', w.conf != null && w.conf < 0.5 && 'underline decoration-dotted underline-offset-4')}
                >
                  {w.w}
                </button>
              ))}
            </p>
          ) : (
            <p className="mt-3 whitespace-pre-wrap">{s.r.text || <span className="text-muted">(empty)</span>}</p>
          )}
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-muted">Raw response</summary>
            <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-surface-2 p-3 text-xs">{JSON.stringify(s.r.raw, null, 2)}</pre>
          </details>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- live examiners

type Engine = 'gemini' | 'gpt-live' | RealtimeModel;
const ENGINES: { value: Engine; label: string; note: string }[] = [
  { value: 'gpt-realtime-2.1-mini', label: 'OpenAI Realtime 2.1 mini', note: 'gpt-realtime-2.1-mini, ~$0.02/min' },
  { value: 'gpt-realtime-2.1', label: 'OpenAI Realtime 2.1', note: 'gpt-realtime-2.1, ~$0.06/min' },
  { value: 'gpt-realtime-mini', label: 'OpenAI Realtime mini', note: 'gpt-realtime-mini, ~$0.02/min' },
  { value: 'gpt-realtime', label: 'OpenAI Realtime', note: 'gpt-realtime, ~$0.06/min' },
  { value: 'gpt-live', label: 'OpenAI Live', note: 'gpt-live-1, $0.05/min' },
  { value: 'gemini', label: 'Gemini Live', note: 'gemini-3.8-live, priced per token' },
];

function ExaminerLab() {
  const [engine, setEngine] = useState<Engine>('gpt-realtime-2.1-mini');
  const [run, setRun] = useState(0);
  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Select label="Engine" value={engine} onChange={(e) => setEngine(e.target.value as Engine)} disabled={run > 0} className="min-w-64">
            {ENGINES.map((e) => <option key={e.value} value={e.value}>{e.label} ({e.note})</option>)}
          </Select>
          {run > 0 ? (
            <Button variant="destructive" icon={<Square />} onClick={() => setRun(0)}>Stop</Button>
          ) : (
            <Button icon={<Mic />} onClick={() => setRun(Date.now())}>Start a test</Button>
          )}
        </div>
        <p className="type-caption mt-3">The full examiner script and timers, as in a real live test, but nothing is recorded or scored. Use headphones: Gemini cannot be interrupted while it speaks. Latency is from the end of your speech (your mic level) to the examiner's first audio.</p>
      </Card>
      {run > 0 && <ExaminerRun key={run} engine={engine} />}
    </div>
  );
}

type Line = { who: 'you' | 'examiner'; text: string; at: number; latencyMs?: number };

function ExaminerRun({ engine }: { engine: Engine }) {
  const duplex = useRef<Duplex>(undefined);
  const [lines, setLines] = useState<Line[]>([]);
  const [now, setNow] = useState(Date.now());
  const t0 = useRef(Date.now());
  const voice = useRef({ last: 0, examinerOn: false, examinerEnd: 0 });
  const make = (): Duplex => (duplex.current = engine === 'gemini' ? new GeminiDuplex() : engine === 'gpt-live' ? new GptLiveDuplex() : new RealtimeDuplex(engine));

  const push = (who: Line['who'], text: string, append: boolean, latencyMs?: number) =>
    setLines((ls) => {
      const last = ls.at(-1);
      if (append && last?.who === who) return [...ls.slice(0, -1), { ...last, text: who === 'you' ? `${last.text} ${text}`.replace(/\s+/g, ' ') : last.text + text }];
      return [...ls, { who, text, at: Date.now() - t0.current, latencyMs }];
    });
  const pendingLatency = useRef<number>(undefined);
  const debug: Partial<Handlers> = {
    heard: (text) => push('you', text.trim(), true),
    speaking: (on) => {
      const v = voice.current;
      v.examinerOn = on;
      if (on) pendingLatency.current = v.last > v.examinerEnd ? Date.now() - v.last : undefined;
      else v.examinerEnd = Date.now();
    },
    caption: (text, append) => {
      if (!append) return; // a reset: the next text starts a new examiner line
      setLines((ls) => {
        const last = ls.at(-1);
        if (last?.who === 'examiner' && !pendingLatency.current) return [...ls.slice(0, -1), { ...last, text: last.text + text }];
        const l: Line = { who: 'examiner', text, at: Date.now() - t0.current, latencyMs: pendingLatency.current };
        pendingLatency.current = undefined;
        return [...ls, l];
      });
    },
  };
  const ex = useDuplexExaminer(make, () => {}, undefined, undefined, undefined, { record: false, debug });

  // The playground's own ear on the mic: when the candidate last spoke (ignored while the examiner is audible, so its echo does not count).
  useEffect(() => {
    let stop = () => {};
    void navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then((s) => {
      const ctx = new AudioContext(), an = ctx.createAnalyser(), buf = new Float32Array(1024);
      an.fftSize = 1024;
      ctx.createMediaStreamSource(s).connect(an);
      const timer = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        const rms = Math.sqrt(buf.reduce((a, x) => a + x * x, 0) / buf.length);
        if (rms > 0.02 && !voice.current.examinerOn) voice.current.last = Date.now();
      }, 50);
      stop = () => (clearInterval(timer), s.getTracks().forEach((t) => t.stop()), void ctx.close().catch(() => {}));
    }).catch(() => {});
    void ex.start();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => (clearInterval(tick), stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per run
  }, []);

  const secs = (now - t0.current) / 1000;
  const d = duplex.current;
  const cost = d instanceof GeminiDuplex ? geminiUsd(d.usage) : d instanceof RealtimeDuplex ? realtimeUsd(engine as RealtimeModel, d.usage) : gptLiveUsd(secs);
  const lat = lines.flatMap((l) => (l.latencyMs != null ? [l.latencyMs] : []));
  const median = lat.length ? [...lat].sort((a, b) => a - b)[Math.floor(lat.length / 2)]! : null;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: 'nearest' }), [lines.length]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <Card>
        <h2 className="type-h4 mb-3">Conversation</h2>
        {ex.error && <p className="mb-3 text-sm text-bad-text">{ex.error}</p>}
        <ol className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {lines.map((l, i) => (
            <li key={i} className={cn('rounded-lg p-3', l.who === 'examiner' ? 'bg-surface-2' : 'border border-line')}>
              <p className="type-caption mb-1">
                {l.who === 'examiner' ? 'Examiner' : 'You (engine transcript)'} · {(l.at / 1000).toFixed(0)} s{l.latencyMs != null && ` · replied after ${(l.latencyMs / 1000).toFixed(1)} s`}
              </p>
              <p>{l.text}</p>
            </li>
          ))}
          <div ref={end} />
        </ol>
        {!lines.length && <p className="text-sm text-muted">Connecting… the examiner opens the test.</p>}
      </Card>
      <aside className="space-y-4">
        <Card>
          <dl className="space-y-2 text-sm">
            {[
              ['Status', ex.status],
              ['Phase', ex.phase],
              ['Time', `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`],
              ['Cost so far', `${money(cost)} est.`],
              ['Per minute', secs > 30 ? `${money((cost / secs) * 60)}` : '—'],
              ['Median reply', median != null ? `${(median / 1000).toFixed(1)} s` : '—'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="type-num font-medium">{v}</dd></div>
            ))}
          </dl>
          {ex.phase === 'p2-prep' && <Badge tone="accent" className="mt-3">Prep {ex.prepLeft} s</Badge>}
          {ex.phase === 'p2-talk' && <Badge tone="accent" className="mt-3">Talk {ex.talkLeft} s</Badge>}
          {ex.endTurn && <Button size="sm" variant="outline" className="mt-3 w-full" onClick={ex.endTurn}>I've finished my talk</Button>}
        </Card>
        {ex.cueCard && (
          <Card>
            <h3 className="font-semibold">{ex.cueCard.title}</h3>
            {ex.cueCard.bullets?.length ? <ul className="mt-2 list-disc pl-5 text-sm">{ex.cueCard.bullets.map((b) => <li key={b}>{b}</li>)}</ul> : null}
          </Card>
        )}
      </aside>
    </div>
  );
}
