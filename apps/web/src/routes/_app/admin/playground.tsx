import { createFileRoute } from '@tanstack/react-router';
import { Mic, Play, Plus, Square, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { PronunciationLab } from '@/components/admin/PronunciationLab';
import { CascadeSteps, CascadeTimeline } from '@/components/admin/CascadeTimeline';
import { audioFormat, blobToBase64, geminiUsd, gptLiveUsd, isFiller, realtimeUsd, toWav16k, transcriptStats, type Word } from '@/components/admin/playground';
import { Badge, Button, Card, Chip, Input, PageContainer, Segmented, Select, Spinner, Switch, Textarea } from '@/components/ui';
import { useRecorder } from '@/hooks/useRecorder';
import { useAdmin } from '@/lib/admin';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useDuplexExaminer, type Duplex, type Handlers } from '@/live/duplex';
import { GeminiDuplex, type GeminiModel } from '@/live/gemini';
import { GptLiveDuplex } from '@/live/gptLive';
import { RealtimeDuplex, type RealtimeModel } from '@/live/realtime';
import { DEFAULT_PIPECAT, PipecatDuplex, type PipecatConfig } from '@/live/pipecat';
import { CascadeDuplex, DEFAULT_CASCADE, type CascadeConfig, type CascadeLlm, type CascadeStt, type CascadeTts, type ReplyTiming } from '@/live/cascade';

type Tab = 'stt' | 'pron' | 'live';
export const Route = createFileRoute('/_app/admin/playground')({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => ({ tab: s.tab === 'live' || s.tab === 'pron' ? s.tab : undefined }),
  component: Playground,
});

function Playground() {
  const { tab = 'stt' } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PageContainer>
      <AdminHeader
        title="Playground"
        description="Try transcription models and our pronunciation scorer on your own recordings, and talk to each live examiner engine. Runs on the house keys and shows up in Costs."
        actions={<Segmented label="Mode" value={tab} onChange={(v) => void navigate({ search: { tab: v === 'stt' ? undefined : v } })} options={[{ value: 'stt', label: 'Transcription' }, { value: 'pron', label: 'Pronunciation' }, { value: 'live', label: 'Live examiners' }]} />}
      />
      {tab === 'stt' ? <TranscriptionLab /> : tab === 'pron' ? <PronunciationLab /> : <ExaminerLab />}
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
const toBase64 = blobToBase64;

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
    const wavB64 = clip.format !== 'wav' && ids.some((id) => id.startsWith('hf/')) ? await toWav16k(clip.blob).then(toBase64) : audioB64; // the CrisperWhisper Space takes WAV only
    const p = prompt === 'verbatim' ? VERBATIM_PROMPT : prompt === 'custom' ? customPrompt.trim() || undefined : undefined;
    setRuns((r) => ({ ...r, ...Object.fromEntries(ids.map((id) => [id, { status: 'running' } as RunState])) }));
    await Promise.all(
      ids.map(async (id) => {
        try {
          const r = await api.post<SttRun>('/admin/stt/transcribe', { model: id, ...(id.startsWith('hf/') ? { audio: wavB64, format: 'wav' as const } : { audio: audioB64, format: clip.format }), prompt: p, language: language === 'auto' ? null : 'en' });
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
          <Input label="Filter" hideLabel placeholder="Filter models" value={filter} onChange={(e) => setFilter(e.target.value)} />
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

type Engine = GeminiModel | 'gpt-live' | RealtimeModel | 'cascade' | 'pipecat';
const isGemini = (e: Engine): e is GeminiModel => e.startsWith('gemini');
const ENGINES: { value: Engine; label: string; note: string }[] = [
  { value: 'cascade', label: 'Fast cascade', note: 'configurable ears, turn detection, LLM and voice, ~$0.005-0.01/min' },
  { value: 'pipecat', label: 'Pipecat (server pipeline)', note: 'WebRTC to our server: Silero + Smart Turn + Soniox/Scribe + LLM + streamed voice, ~$0.003/min' },
  { value: 'gpt-realtime-2.1-mini', label: 'OpenAI Realtime 2.1 mini', note: 'gpt-realtime-2.1-mini, ~$0.02/min' },
  { value: 'gpt-realtime-2.1', label: 'OpenAI Realtime 2.1', note: 'gpt-realtime-2.1, ~$0.06/min' },
  { value: 'gpt-realtime-mini', label: 'OpenAI Realtime mini', note: 'gpt-realtime-mini, ~$0.02/min' },
  { value: 'gpt-realtime', label: 'OpenAI Realtime', note: 'gpt-realtime, ~$0.06/min' },
  { value: 'gpt-live', label: 'OpenAI Live', note: 'gpt-live-1, $0.05/min' },
  { value: 'gemini-3.8-live', label: 'Gemini 3.8 Live', note: 'gemini-3.8-live, ~$0.01/min + context' },
  { value: 'gemini-3.1-flash-live-preview', label: 'Gemini 3.1 Flash Live', note: 'legacy preview, no proactive audio, same price' },
  { value: 'gemini-2.5-flash-native-audio-preview-12-2025', label: 'Gemini 2.5 Flash Live', note: 'older accounts only, cheaper text, same audio price' },
];

const STTS: { value: CascadeStt; label: string }[] = [
  { value: 'scribe_v2_realtime', label: 'Streamed: ElevenLabs Scribe v2 Realtime (~$0.0065/min)' },
  { value: 'stt-rt-v5', label: 'Streamed: Soniox stt-rt-v5 ($0.002/min, ~0.26 s to final)' },
  { value: 'gpt-4o-mini-transcribe', label: 'Streamed: OpenAI gpt-4o-mini-transcribe ($0.003/min, server VAD)' },
  { value: 'gpt-4o-transcribe', label: 'Streamed: OpenAI gpt-4o-transcribe ($0.006/min, server VAD)' },
  { value: 'batch:nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b', label: 'OpenRouter batch: NVIDIA Nemotron ASR ($0.012/h)' },
  { value: 'batch:nvidia/parakeet-tdt-0.6b-v3', label: 'OpenRouter batch: NVIDIA Parakeet TDT ($0.09/h)' },
  { value: 'batch:elevenlabs/scribe-v2', label: 'OpenRouter batch: ElevenLabs Scribe v2 ($0.11/h)' },
  { value: 'batch:openai/whisper-large-v3-turbo', label: 'OpenRouter batch: Whisper large-v3 turbo ($0.012/h)' },
  { value: 'batch:deepgram/nova-3', label: 'OpenRouter batch: Deepgram Nova-3 ($0.26/h)' },
  { value: 'batch:openai/gpt-4o-mini-transcribe', label: 'OpenRouter batch: gpt-4o-mini-transcribe' },
];
const LLMS: { value: CascadeLlm; label: string }[] = [
  { value: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash (~0.8-1.6 s)' },
  { value: 'inception/mercury-2.5', label: 'Mercury 2.5 (~1-2 s, cheapest)' },
  { value: 'mistralai/mistral-small-3.2-24b-instruct', label: 'Mistral Small 3.2 (~1.3-2.4 s)' },
  { value: 'openai/gpt-6-luna', label: 'GPT-6 Luna (~1.5-2.6 s)' },
];
const VOICES: { value: CascadeTts; label: string }[] = [
  { value: 'elevenlabs/eleven-v4-turbo', label: 'ElevenLabs v4 Turbo (~1.2 s, ~$0.02/1k chars)' },
  { value: 'elevenlabs/eleven-flash-v2.5', label: 'ElevenLabs Flash v2.5 (~0.7 s, ~$0.02/1k chars)' },
  { value: 'google/gemini-3.8-flash-lite-tts', label: 'Gemini 3.8 Flash-Lite TTS (~2.7 s, cheapest)' },
  { value: 'google/gemini-3.8-flash-tts', label: 'Gemini 3.8 Flash TTS (~3 s, the turn-based voice)' },
];

const CFG_KEY = 'admin-cascade-config';
const PIPECAT_KEY = 'admin-pipecat-config';
const RUNS_KEY = 'admin-examiner-runs';
const loadJson = <T,>(key: string, fallback: T): T => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
};
const saveJson = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
};
/** A finished playground session, kept after Stop (and in this browser's storage) so runs can be compared. */
type RunSnapshot = { id: number; engine: Engine; label: string; lines: Line[]; timeline: ReplyTiming[]; costUsd: number; secs: number; median: number | null };
const engineLabel = (engine: Engine, cfg: CascadeConfig, pc: PipecatConfig) =>
  engine === 'pipecat'
    ? ['Pipecat', pc.stt, `VAD ${pc.vadStopSecs} s / Smart Turn cap ${pc.smartStopSecs} s`, pc.llm.replace(/^.*\//, ''), pc.tts === 'elevenlabs' ? pc.ttsModel : `${pc.tts} tts`, pc.voice].filter(Boolean).join(' · ')
    : engine !== 'cascade'
    ? ENGINES.find((e) => e.value === engine)?.label ?? engine
    : [
        'Fast cascade',
        cfg.stt.replace(/^batch:/, 'batch ').replace(/^.*\//, ''),
        cfg.stt.startsWith('gpt-') && cfg.turn === 'server' ? 'server VAD' : cfg.turn !== 'silence' ? `Smart Turn ${cfg.smartModel} ${cfg.smartPauseMs} ms / p${cfg.smartThreshold} / cap ${cfg.smartMaxMs} ms` : `${cfg.silenceMs} ms silence`,
        cfg.stt.startsWith('batch:') && cfg.chunkedStt ? 'chunked STT' : '',
        cfg.llm.replace(/^.*\//, ''),
        cfg.tts.replace(/^.*\//, ''),
        cfg.stream ? (cfg.sentenceTts ? 'streamed per sentence' : 'streamed whole line') : 'one reply',
      ].filter(Boolean).join(' · ');

function CascadeSettings({ cfg, set, disabled }: { cfg: CascadeConfig; set: (p: Partial<CascadeConfig>) => void; disabled: boolean }) {
  const openai = cfg.stt.startsWith('gpt-'), batch = cfg.stt.startsWith('batch:'), smart = cfg.turn === 'smart' || (cfg.turn === 'server' && !openai);
  const num = (k: 'silenceMs' | 'smartPauseMs' | 'smartMaxMs' | 'smartThreshold', label: string, hint: string, step = 50) => (
    <Input label={label} hint={hint} type="number" step={step} value={cfg[k]} disabled={disabled} onChange={(e) => set({ [k]: Number(e.target.value) })} />
  );
  return (
    <div className="mt-4 grid gap-6 md:grid-cols-3">
      <fieldset className="space-y-3">
        <legend className="type-h4 mb-1">Hearing</legend>
        <Select label="Transcription" value={cfg.stt} onChange={(e) => set({ stt: e.target.value as CascadeStt })} disabled={disabled}>
          {STTS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
        </Select>
        {batch && <Switch label="Transcribe in pieces" description="Send each finished piece at a 'not finished' pause, so only the tail is left at the end" checked={cfg.chunkedStt} onChange={(v) => set({ chunkedStt: v })} disabled={disabled} />}
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="type-h4 mb-1">End of turn</legend>
        <Select label="Detection" value={!openai && cfg.turn === 'server' ? 'smart' : cfg.turn} onChange={(e) => set({ turn: e.target.value as CascadeConfig['turn'] })} disabled={disabled} hint={cfg.turn === 'server' && openai ? "OpenAI's own silence detection (1 s) ends answers" : 'Decided on this device; the model downloads once and is cached'}>
          {openai && <option value="server">OpenAI server VAD (1 s silence)</option>}
          <option value="smart">Smart Turn (audio model)</option>
          <option value="silence">Fixed silence</option>
        </Select>
        {smart && (
          <Select label="Turn model" value={cfg.smartModel} onChange={(e) => set({ smartModel: e.target.value as CascadeConfig['smartModel'] })} disabled={disabled}>
            <option value="fp32">Smart Turn v3.2 fp32 (32 MB, exact)</option>
            <option value="int8">Smart Turn v3.2 int8 (8 MB, faster, drifts)</option>
          </Select>
        )}
        {smart ? (
          <div className="grid grid-cols-3 gap-2">
            {num('smartPauseMs', 'Check after (ms)', 'pause before a check')}
            {num('smartThreshold', 'Threshold', 'P(finished)', 0.05)}
            {num('smartMaxMs', 'Cap (ms)', 'end anyway')}
          </div>
        ) : (
          num('silenceMs', 'Silence (ms)', 'quiet this long ends the turn')
        )}
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="type-h4 mb-1">Reply</legend>
        <Select label="LLM" value={cfg.llm} onChange={(e) => set({ llm: e.target.value as CascadeLlm })} disabled={disabled}>
          {LLMS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
        </Select>
        <Select label="Voice" value={cfg.tts} onChange={(e) => set({ tts: e.target.value as CascadeTts })} disabled={disabled}>
          {VOICES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
        </Select>
        <Switch label="Stream the reply" description="LLM text streams; off: one request returns the whole line and its audio" checked={cfg.stream} onChange={(v) => set({ stream: v })} disabled={disabled} />
        {cfg.stream && <Switch label="Voice each sentence" description="Each sentence is voiced as soon as it is written; off: one voice call for the whole line" checked={cfg.sentenceTts} onChange={(v) => set({ sentenceTts: v })} disabled={disabled} />}
      </fieldset>
    </div>
  );
}

const PC_LLMS: { value: PipecatConfig['llm']; label: string }[] = [
  { value: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' },
  { value: 'inception/mercury-2.5', label: 'Mercury 2.5 (fastest)' },
  { value: 'mistralai/mistral-small-3.2-24b-instruct', label: 'Mistral Small 3.2' },
  { value: 'openai/gpt-6-luna', label: 'Luna' },
];

function PipecatSettings({ cfg, set, disabled }: { cfg: PipecatConfig; set: (p: Partial<PipecatConfig>) => void; disabled: boolean }) {
  return (
    <div className="mt-4 grid gap-6 md:grid-cols-3">
      <fieldset className="space-y-3">
        <legend className="type-caption font-medium">Hearing (on the server)</legend>
        <Select label="Transcription" value={cfg.stt} disabled={disabled} onChange={(e) => set({ stt: e.target.value as PipecatConfig['stt'] })}>
          <option value="soniox">Soniox stt-rt-v5 ($0.12/h)</option>
          <option value="scribe">ElevenLabs Scribe v2 Realtime ($0.39/h)</option>
        </Select>
        <div className="grid grid-cols-2 gap-2">
          <Input label="Pause (s)" hint="Silero VAD quiet before Smart Turn decides" type="number" step={0.05} value={cfg.vadStopSecs} disabled={disabled} onChange={(e) => set({ vadStopSecs: Number(e.target.value) })} />
          <Input label="Cap (s)" hint="'not finished' still ends after this" type="number" step={0.1} value={cfg.smartStopSecs} disabled={disabled} onChange={(e) => set({ smartStopSecs: Number(e.target.value) })} />
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="type-caption font-medium">Reply</legend>
        <Select label="LLM (OpenRouter, streamed)" value={cfg.llm} disabled={disabled} onChange={(e) => set({ llm: e.target.value as PipecatConfig['llm'] })}>
          {PC_LLMS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
        </Select>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="type-caption font-medium">Voice (streamed over a WebSocket)</legend>
        <Select label="Voice" value={cfg.tts} disabled={disabled} onChange={(e) => set({ tts: e.target.value as PipecatConfig['tts'], voice: '' })}>
          <option value="openai">OpenAI gpt-4o-mini-tts (~$0.015/min, British accent by instruction)</option>
          <option value="soniox">Soniox tts-rt-v2 (~$0.014/1k chars)</option>
          <option value="elevenlabs">ElevenLabs (house plan credits)</option>
        </Select>
        {cfg.tts === 'elevenlabs' && (
          <Select label="ElevenLabs model" value={cfg.ttsModel} disabled={disabled} onChange={(e) => set({ ttsModel: e.target.value as PipecatConfig['ttsModel'] })}>
            <option value="eleven_flash_v2_5">Flash v2.5 (fastest)</option>
            <option value="eleven_turbo_v2_5">Turbo v2.5</option>
          </Select>
        )}
        <Input label="Voice name or id" hint={cfg.tts === 'openai' ? 'empty: fable; also ash, ballad, cedar, coral, echo, marin, nova, onyx, sage, verse' : cfg.tts === 'soniox' ? 'empty: Adrian' : 'empty: George (British)'} value={cfg.voice} disabled={disabled} onChange={(e) => set({ voice: e.target.value.trim() })} />
      </fieldset>
    </div>
  );
}

function ExaminerLab() {
  const [engine, setEngine] = useState<Engine>('cascade');
  const [cfg, setCfg] = useState<CascadeConfig>(() => ({ ...DEFAULT_CASCADE, ...loadJson<Partial<CascadeConfig>>(CFG_KEY, {}) }));
  const [run, setRun] = useState(0);
  const [past, setPast] = useState<RunSnapshot[]>(() => loadJson<RunSnapshot[]>(RUNS_KEY, []));
  const set = (p: Partial<CascadeConfig>) => setCfg((c) => (saveJson(CFG_KEY, { ...c, ...p }), { ...c, ...p }));
  const [pc, setPc] = useState<PipecatConfig>(() => ({ ...DEFAULT_PIPECAT, ...loadJson<Partial<PipecatConfig>>(PIPECAT_KEY, {}) }));
  const setP = (p: Partial<PipecatConfig>) => setPc((c) => (saveJson(PIPECAT_KEY, { ...c, ...p }), { ...c, ...p }));
  const keep = (snap: RunSnapshot) =>
    setPast((ps) => {
      if (!snap.lines.length) return ps;
      const next = [snap, ...ps.filter((p) => p.id !== snap.id)].slice(0, 20);
      saveJson(RUNS_KEY, next);
      return next;
    });
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
          {engine === 'cascade' && <Button variant="ghost" size="sm" onClick={() => set(DEFAULT_CASCADE)} disabled={run > 0}>Reset settings</Button>}
          {engine === 'pipecat' && <Button variant="ghost" size="sm" onClick={() => setP(DEFAULT_PIPECAT)} disabled={run > 0}>Reset settings</Button>}
        </div>
        {engine === 'cascade' && <CascadeSettings cfg={cfg} set={set} disabled={run > 0} />}
        {engine === 'pipecat' && <PipecatSettings cfg={pc} set={setP} disabled={run > 0} />}
        <p className="type-caption mt-4">The full examiner script and timers, as in a real live test, but nothing is recorded or scored. Use headphones: Gemini and the cascade cannot be interrupted while they speak. Stopped sessions stay below for comparison.</p>
      </Card>
      {run > 0 && <ExaminerRun key={run} id={run} engine={engine} cfg={cfg} pc={pc} label={engineLabel(engine, cfg, pc)} onEnd={keep} />}
      {past.length > 0 && (
        <section aria-label="Past sessions" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="type-h4">Past sessions</h2>
            <Button variant="ghost" size="sm" onClick={() => (setPast([]), saveJson(RUNS_KEY, []))}>Clear</Button>
          </div>
          {past.filter((p) => p.id !== run).map((p) => <PastRun key={p.id} run={p} />)}
        </section>
      )}
    </div>
  );
}

function Conversation({ lines, end }: { lines: Line[]; end?: React.Ref<HTMLDivElement> }) {
  return (
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
  );
}

function PastRun({ run }: { run: RunSnapshot }) {
  const avg = run.timeline.length ? run.timeline.reduce((a, t) => a + t.total, 0) / run.timeline.length : null;
  return (
    <details className="rounded-xl border border-line bg-surface">
      <summary className="cursor-pointer p-4">
        <span className="font-medium">{run.label}</span>
        <span className="type-caption block">
          {new Date(run.id).toLocaleString()} · {Math.round(run.secs / 60)} min · {money(run.costUsd)} est.{run.median != null && ` · median reply ${(run.median / 1000).toFixed(1)} s`}{avg != null && ` · avg to voice ${(avg / 1000).toFixed(1)} s`}
        </span>
      </summary>
      <div className="grid gap-6 p-4 pt-0 lg:grid-cols-2">
        <Card><h3 className="type-h4 mb-3">Conversation</h3><Conversation lines={run.lines} /></Card>
        {run.timeline.length > 0 && <CascadeTimeline timeline={run.timeline} />}
      </div>
    </details>
  );
}

type Line = { who: 'you' | 'examiner'; text: string; at: number; latencyMs?: number };

function ExaminerRun({ id, engine, cfg, pc, label, onEnd }: { id: number; engine: Engine; cfg: CascadeConfig; pc: PipecatConfig; label: string; onEnd: (s: RunSnapshot) => void }) {
  const duplex = useRef<Duplex>(undefined);
  const [lines, setLines] = useState<Line[]>([]);
  const [now, setNow] = useState(Date.now());
  const t0 = useRef(Date.now());
  const voice = useRef({ last: 0, examinerOn: false, examinerEnd: 0 });
  const make = (): Duplex =>
    (duplex.current = engine === 'pipecat' ? new PipecatDuplex(pc) : engine === 'cascade' ? new CascadeDuplex(cfg) : isGemini(engine) ? new GeminiDuplex(engine) : engine === 'gpt-live' ? new GptLiveDuplex() : new RealtimeDuplex(engine));

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
    return () => (clearInterval(tick), stop(), onEnd(snap.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per run
  }, []);

  const secs = (now - t0.current) / 1000;
  const d = duplex.current;
  const cost = d instanceof CascadeDuplex || d instanceof PipecatDuplex ? d.stats.costUsd : d instanceof GeminiDuplex ? geminiUsd(engine as GeminiModel, d.usage) : d instanceof RealtimeDuplex ? realtimeUsd(engine as RealtimeModel, d.usage) : gptLiveUsd(secs);
  const lat = lines.flatMap((l) => (l.latencyMs != null ? [l.latencyMs] : []));
  const median = lat.length ? [...lat].sort((a, b) => a - b)[Math.floor(lat.length / 2)]! : null;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => void end.current?.scrollIntoView({ block: 'nearest' }), [lines.length]); // void: newer Chromium returns a Promise, which React would take for a clean-up
  const snap = useRef<RunSnapshot>({ id, engine, label, lines: [], timeline: [], costUsd: 0, secs: 0, median: null });
  snap.current = { id, engine, label, lines, timeline: d instanceof CascadeDuplex || d instanceof PipecatDuplex ? [...d.stats.timeline] : [], costUsd: cost, secs, median };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="min-w-0 space-y-6">
      <Card>
        <h2 className="type-h4 mb-1">Conversation</h2>
        <p className="type-caption mb-3">{label}</p>
        {ex.error && <p className="mb-3 text-sm text-bad-text">{ex.error}</p>}
        <Conversation lines={lines} end={end} />
        {!lines.length && (d instanceof CascadeDuplex || d instanceof PipecatDuplex ? <CascadeSteps steps={d.stats.steps} /> : <p className="text-sm text-muted">Connecting… the examiner opens the test.</p>)}
      </Card>
      {(d instanceof CascadeDuplex || d instanceof PipecatDuplex) && <CascadeTimeline timeline={d.stats.timeline} />}
      {(d instanceof CascadeDuplex || d instanceof PipecatDuplex) && lines.length > 0 && (
        <Card>
          <h2 className="type-h4 mb-2">Start-up</h2>
          <CascadeSteps steps={d.stats.steps} />
        </Card>
      )}
      </div>
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
              ...(d instanceof CascadeDuplex && d.stats.last ? [['Last LLM / voice', `${(d.stats.last.llm / 1000).toFixed(1)} / ${(d.stats.last.tts / 1000).toFixed(1)} s`]] : []),
              ...(d instanceof PipecatDuplex && d.stats.lastCheck ? [['Turn model', `Smart Turn (server) · p ${d.stats.lastCheck.p.toFixed(2)} in ${Math.round(d.stats.lastCheck.ms)} ms`]] : []),
              ...(d instanceof CascadeDuplex && d.stats.turnModel !== 'off' ? [['Turn model', `${d.stats.turnModel}${d.stats.lastCheck ? ` · p ${d.stats.lastCheck.p.toFixed(2)} in ${Math.round(d.stats.lastCheck.ms)} ms` : ''}`]] : []),
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
