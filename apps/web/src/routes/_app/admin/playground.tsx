import { createFileRoute } from '@tanstack/react-router';
import { DEFAULT_LIVEKIT, type LiveKitConfig } from '@ielts/core';
import { LiveKitSettings } from '@/components/admin/LiveKitSettings';
import { LIVEKIT_KEY, LiveKitDuplex, liveKitLabel, loadLiveKitConfig, type ReplyTiming } from '@/live/livekit';
import { Mic, Play, Plus, Square, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { PronunciationLab } from '@/components/admin/PronunciationLab';
import { CascadeSteps, CascadeTimeline } from '@/components/admin/CascadeTimeline';
import { audioFormat, blobToBase64, isFiller, recordingLabel, runWords, toWav16k, transcriptDiff, transcriptStats, type Recording, type Word } from '@/components/admin/playground';
import { Pager } from '@/components/admin/Pager';
import { Alert, Badge, Button, Card, Chip, Input, PageContainer, Segmented, Select, Spinner, Textarea } from '@/components/ui';
import { useRecorder } from '@/hooks/useRecorder';
import { useAdmin, type Page } from '@/lib/admin';
import { formatDate } from '@/lib/format';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useDuplexExaminer, type Duplex, type Handlers } from '@/live/duplex';

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
        description="Try transcription models and our pronunciation scorer on your own recordings, and talk to the live examiner. Runs on the house keys and shows up in Costs."
        actions={<Segmented label="Mode" value={tab} onChange={(v) => void navigate({ search: { tab: v === 'stt' ? undefined : v } })} options={[{ value: 'stt', label: 'Transcription' }, { value: 'pron', label: 'Pronunciation' }, { value: 'live', label: 'Live examiner' }]} />}
      />
      {tab === 'stt' ? <TranscriptionLab /> : tab === 'pron' ? <PronunciationLab /> : <ExaminerLab />}
    </PageContainer>
  );
}

// ---------------------------------------------------------------- transcription

type SttModel = { id: string; name: string; description: string; usdPerSecond: number | null; usdPerMTokIn: number | null; usdPerMTokOut: number | null };
type SttRun = { model: string; text: string; words: Word[]; duration: number; latencyMs: number; costUsd: number | null; costExact: boolean; promptDropped?: boolean; raw: unknown; cached: { at: string; costUsd: number | null } | null };
type RunState = { status: 'running' } | { status: 'done'; r: SttRun } | { status: 'error'; error: string };
type Format = NonNullable<ReturnType<typeof audioFormat>>;
/** A clip from this browser (recorded or uploaded), or a student's recording the server already has (sent by id, not uploaded). */
type Clip = { url: string; format: Format; label: string } & ({ blob: Blob; recordingId?: undefined } | { recordingId: string; blob?: undefined });

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
  useEffect(() => () => void (clip?.blob && URL.revokeObjectURL(clip.url)), [clip]);

  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const setAudio = (blob: Blob, label: string, name = '') => {
    const format = audioFormat(blob.type, name);
    if (!format) return setRuns({ _: { status: 'error', error: `Unsupported audio type ${blob.type || name}. Use webm, ogg, m4a, wav or mp3.` } });
    setClip({ blob, url: URL.createObjectURL(blob), format, label });
    setRuns({});
  };
  const pick = (r: Recording) => {
    setClip({ recordingId: r.id, url: r.audioUrl, format: audioFormat('', `x.${r.format}`) ?? 'webm', label: recordingLabel(r) });
    setRuns({});
  };
  const record = async () => {
    if (rec.state === 'recording') {
      const r = await rec.stop();
      setAudio(r.blob, `Recording, ${Math.round(r.durationMs / 1000)} s`);
    } else await rec.start();
  };

  /** fresh: skip the server's stored run for this audio, model and settings. */
  const run = async (ids: string[], fresh = false) => {
    if (!clip) return;
    const p = prompt === 'verbatim' ? VERBATIM_PROMPT : prompt === 'custom' ? customPrompt.trim() || undefined : undefined;
    setRuns((r) => ({ ...r, ...Object.fromEntries(ids.map((id) => [id, { status: 'running' } as RunState])) }));
    const src = clip.blob ? { audio: await toBase64(clip.blob), format: clip.format } : { recordingId: clip.recordingId };
    // the CrisperWhisper Space takes WAV only: convert here, a stored recording too
    const wav = clip.format !== 'wav' && ids.some((id) => id.startsWith('hf/')) ? (clip.blob ? Promise.resolve(clip.blob) : fetch(clip.url).then((r) => r.blob())).then(toWav16k).then(toBase64) : undefined;
    await Promise.all(
      ids.map(async (id) => {
        try {
          const audio = id.startsWith('hf/') && wav ? { audio: await wav, format: 'wav' as const } : src;
          const r = await api.post<SttRun>('/admin/stt/transcribe', { model: id, ...audio, prompt: p, language: language === 'auto' ? null : 'en', fresh });
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
      {/* sticky: the player stays in reach while reading long results (clicking a word plays it) */}
      <div className="min-w-0 space-y-6 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
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
          <RecordingPicker selected={clip?.recordingId} onPick={pick} />
          {clip && (
            <div className="mt-4 space-y-1">
              <p className="type-caption">{clip.label} · {clip.format}{clip.blob && ` · ${(clip.blob.size / 1024).toFixed(0)} KB`}</p>
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

      <Results runs={runs} byId={byId} hasClip={!!clip} onSeek={seek} onRerun={(id) => void run([id], true)} />
    </div>
  );
}

type Done = { id: string; r: SttRun };
/** Results: a comparison table, then one card per model, each as its transcript or as a word diff against a baseline run. */
function Results({ runs, byId, hasClip, onSeek, onRerun }: { runs: Record<string, RunState>; byId: Map<string, SttModel>; hasClip: boolean; onSeek: (t: number) => void; onRerun: (id: string) => void }) {
  const entries = Object.entries(runs).filter(([id]) => id !== '_');
  const done: Done[] = entries.flatMap(([id, s]) => (s.status === 'done' ? [{ id, r: s.r }] : []));
  const [view, setView] = useState<'text' | 'diff'>('text');
  const [baseId, setBaseId] = useState<string>();
  const base = done.find((d) => d.id === baseId) ?? done[0];
  const canDiff = done.length > 1;
  const diffs = new Map(base ? done.map((d) => [d.id, transcriptDiff(runWords(base.r), runWords(d.r))]) : []);
  const name = (id: string) => byId.get(id)?.name ?? id;

  if (runs._?.status === 'error') return <Alert tone="bad">{runs._.error}</Alert>;
  if (!hasClip || !entries.length)
    return (
      <section aria-label="Results">
        <Card className="text-sm text-muted">
          <p>Record, upload or pick a student's recording, pick models, then transcribe.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>A model already run on the same audio and options shows its saved result; Run again pays for a new one.</li>
            <li>Click a word to hear it. Highlighted words are filled pauses; dotted ones have low confidence.</li>
            <li>With two or more results, Diff shows each transcript against the one you pick as baseline.</li>
          </ul>
        </Card>
      </section>
    );

  return (
    <section aria-label="Results" className="min-w-0 space-y-4">
      {done.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <caption className="sr-only">Results compared</caption>
            <thead className="text-left text-muted">
              <tr className="border-b border-line">
                {['Model', 'Latency', 'Cost', 'Words', 'Fillers / repeats', 'Rate', ...(canDiff ? ['Diff'] : [])].map((h, i) => (
                  <th key={h} scope="col" className={cn('px-2.5 py-2 font-medium whitespace-nowrap', i > 0 && 'text-right')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="type-num">
              {done.map(({ id, r }) => {
                const st = transcriptStats(runWords(r)), d = diffs.get(id);
                return (
                  <tr key={id} className="border-b border-line last:border-0">
                    <th scope="row" className="max-w-52 truncate px-2.5 py-2 text-left font-medium" title={id}>{name(id)}</th>
                    <td className="px-2.5 py-2 text-right">{r.cached ? <Badge tone="info">saved</Badge> : `${(r.latencyMs / 1000).toFixed(1)} s`}</td>
                    <td className="px-2.5 py-2 text-right whitespace-nowrap">{money(r.cached ? r.cached.costUsd : r.costUsd)}{!r.costExact && r.costUsd != null ? ' est.' : ''}</td>
                    <td className="px-2.5 py-2 text-right">{st.words}</td>
                    <td className="px-2.5 py-2 text-right">{st.fillers} / {st.repeats}</td>
                    <td className="px-2.5 py-2 text-right whitespace-nowrap">{r.words.length ? `${st.wpm} wpm` : '—'}</td>
                    {canDiff && <td className="px-2.5 py-2 text-right whitespace-nowrap">{id === base!.id ? 'baseline' : d ? `+${d.added} / −${d.removed}` : ''}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      {canDiff && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <Segmented label="Result view" size="sm" value={view} onChange={setView} options={[{ value: 'text', label: 'Transcripts' }, { value: 'diff', label: 'Diff' }]} />
          {view === 'diff' && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-sm whitespace-nowrap text-muted" aria-hidden>Compared with</span>
                <Select label="Compared with" hideLabel value={base!.id} onChange={(e) => setBaseId(e.target.value)} className="w-64">
                  {done.map((d) => <option key={d.id} value={d.id}>{name(d.id)}</option>)}
                </Select>
              </div>
              <p className="type-caption flex items-center gap-2">
                <ins className="rounded-sm bg-good-soft px-1.5 text-good-text no-underline">only in this one</ins>
                <del className="rounded-sm bg-bad-soft px-1.5 text-bad-text">only in baseline</del>
              </p>
            </>
          )}
        </div>
      )}
      {entries.map(([id, s]) => (
        <SttResult key={id} id={id} s={s} model={byId.get(id)} onSeek={onSeek} onRerun={() => onRerun(id)} diff={view === 'diff' && canDiff && id !== base!.id ? diffs.get(id) : undefined} baseName={base && name(base.id)} isBase={view === 'diff' && canDiff && id === base!.id} />
      ))}
    </section>
  );
}

function DiffText({ toks, onSeek }: { toks: ReturnType<typeof transcriptDiff>['toks']; onSeek: (t: number) => void }) {
  return (
    <p className="mt-3 flex flex-wrap gap-x-1 gap-y-1.5 leading-relaxed">
      {toks.map((t, i) => {
        const Tag = t.kind === 'add' ? 'ins' : t.kind === 'del' ? 'del' : 'span';
        const cls = cn('rounded px-0.5', t.kind === 'add' && 'bg-good-soft text-good-text no-underline', t.kind === 'del' && 'bg-bad-soft text-bad-text decoration-bad/60');
        return Number.isFinite(t.start) ? (
          <button key={i} type="button" onClick={() => onSeek(t.start!)} className="rounded hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand" title={`${t.start!.toFixed(2)} s`}>
            <Tag className={cls}>{t.w}</Tag>
          </button>
        ) : (
          <Tag key={i} className={cls}>{t.w}</Tag>
        );
      })}
    </p>
  );
}

function SttResult({ id, s, model, onSeek, onRerun, diff, baseName, isBase }: { id: string; s: RunState; model?: SttModel; onSeek: (t: number) => void; onRerun: () => void; diff?: ReturnType<typeof transcriptDiff>; baseName?: string; isBase?: boolean }) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 font-semibold">
            <span className="truncate">{model?.name ?? id}</span>
            {isBase && <Badge tone="neutral">Baseline</Badge>}
            {s.status === 'done' && s.r.cached && <Badge tone="info">Saved {formatDate(s.r.cached.at, true)}</Badge>}
          </h3>
          <p className="type-caption truncate">{id}{s.status === 'done' && !s.r.words.length && ' · no word times'}</p>
        </div>
        <Button size="sm" variant="outline" onClick={onRerun} disabled={s.status === 'running'}>Run again</Button>
      </div>
      {s.status === 'running' && <div className="mt-3 flex items-center gap-2 text-sm text-muted"><Spinner /> Transcribing…</div>}
      {s.status === 'error' && <Alert tone="bad" title="This model failed" className="mt-3">{s.error}</Alert>}
      {s.status === 'done' && s.r.promptDropped && <Alert tone="warn" className="mt-3">This model's host rejects a priming prompt, so it ran without one.</Alert>}
      {s.status === 'done' &&
        (diff ? (
          <>
            <p className="type-caption mt-3">Against {baseName}: {diff.added} words only here, {diff.removed} only in the baseline, {diff.same} shared.</p>
            <DiffText toks={diff.toks} onSeek={onSeek} />
          </>
        ) : s.r.words.length ? (
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
        ))}
      {s.status === 'done' && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-muted">Raw response</summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-surface-2 p-3 text-xs">{JSON.stringify(s.r.raw, null, 2)}</pre>
        </details>
      )}
    </Card>
  );
}

/** Students' stored speaking recordings, newest first: searchable by email, name or prompt. */
function RecordingPicker({ selected, onPick }: { selected?: string; onPick: (r: Recording) => void }) {
  const [page, setPage] = useState(1);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const list = useAdmin<Page<Recording>>('/stt/recordings', { page, pageSize: 8, q });
  const search = () => (setQ(text.trim()), setPage(1));
  return (
    <details className="mt-4 rounded-md border border-line">
      <summary className="cursor-pointer p-3 text-sm font-medium">Student recordings</summary>
      <div className="space-y-2 p-3 pt-0">
        <form role="search" onSubmit={(e) => (e.preventDefault(), search())}>
          <Input label="Search recordings" hideLabel type="search" placeholder="Email, name or prompt" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text.trim() !== q && search()} />
        </form>
        {list.isLoading && <Spinner />}
        {list.error && <p className="text-sm text-bad-text">{(list.error as Error).message}</p>}
        {list.data && !list.data.items.length && <p className="type-caption">No recordings match.</p>}
        <ul className="space-y-1" aria-label="Student recordings">
          {list.data?.items.map((r) => (
            <li key={r.id}>
              <button type="button" aria-pressed={selected === r.id} onClick={() => onPick(r)} className={cn('w-full rounded-md p-2 text-left hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand', selected === r.id && 'bg-surface-2 ring-1 ring-brand')}>
                <span className="block truncate text-sm font-medium">{r.prompt ?? 'Untitled prompt'}</span>
                <span className="type-caption block truncate">{recordingLabel(r)}</span>
              </button>
            </li>
          ))}
        </ul>
        {list.data && <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------- live examiner

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
type RunSnapshot = { id: number; label: string; lines: Line[]; timeline: ReplyTiming[]; costUsd: number; secs: number; median: number | null };

function ExaminerLab() {
  const [lk, setLk] = useState<LiveKitConfig>(loadLiveKitConfig);
  const setL = (c: LiveKitConfig) => { saveJson(LIVEKIT_KEY, c); setLk(c); };
  const [run, setRun] = useState(0);
  const [past, setPast] = useState<RunSnapshot[]>(() => loadJson<RunSnapshot[]>(RUNS_KEY, []));
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
          {run > 0 ? (
            <Button variant="destructive" icon={<Square />} onClick={() => setRun(0)}>Stop</Button>
          ) : (
            <Button icon={<Mic />} onClick={() => setRun(Date.now())}>Start a test</Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setL({ ...DEFAULT_LIVEKIT })} disabled={run > 0}>Reset settings</Button>
        </div>
        <LiveKitSettings cfg={lk} set={setL} disabled={run > 0} />
        <p className="type-caption mt-4">The full examiner script and timers, as in a real live test, but nothing is recorded or scored. Stopped sessions stay below for comparison.</p>
      </Card>
      {run > 0 && <ExaminerRun key={run} id={run} lk={lk} label={liveKitLabel(lk)} onEnd={keep} />}
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

function ExaminerRun({ id, lk, label, onEnd }: { id: number; lk: LiveKitConfig; label: string; onEnd: (s: RunSnapshot) => void }) {
  const duplex = useRef<LiveKitDuplex>(undefined);
  const [lines, setLines] = useState<Line[]>([]);
  const [now, setNow] = useState(Date.now());
  const t0 = useRef(Date.now());
  const make = (): Duplex => (duplex.current = new LiveKitDuplex(lk));

  const push = (who: Line['who'], text: string, append: boolean, latencyMs?: number) =>
    setLines((ls) => {
      const last = ls.at(-1);
      if (append && last?.who === who) return [...ls.slice(0, -1), { ...last, text: who === 'you' ? `${last.text} ${text}`.replace(/\s+/g, ' ') : last.text + text }];
      return [...ls, { who, text, at: Date.now() - t0.current, latencyMs }];
    });
  const pendingLatency = useRef<number>(undefined);
  const captionReset = useRef(false);
  const debug: Partial<Handlers> = {
    heard: (text) => push('you', text.trim(), true),
    speaking: (on) => {
      // LiveKit measures last sound → voice on its own published mic track (a second capture can mute it on iOS)
      const d = duplex.current;
      if (!on || !d) return;
      pendingLatency.current = d.replyMs;
      d.replyMs = undefined;
    },
    caption: (text, append) => {
      if (!append) { captionReset.current = true; return; }
      const newLine = captionReset.current;
      captionReset.current = false;
      setLines((ls) => {
        const last = ls.at(-1);
        if (last?.who === 'examiner' && !pendingLatency.current && !newLine) return [...ls.slice(0, -1), { ...last, text: last.text + text }];
        const l: Line = { who: 'examiner', text, at: Date.now() - t0.current, latencyMs: pendingLatency.current };
        pendingLatency.current = undefined;
        return [...ls, l];
      });
    },
  };
  const ex = useDuplexExaminer(make, () => {}, undefined, undefined, { record: false, debug });

  useEffect(() => {
    void ex.start();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(tick); onEnd(snap.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per run
  }, []);

  const secs = (now - t0.current) / 1000;
  const d = duplex.current;
  const cost = d?.stats.costUsd ?? 0;
  const lat = lines.flatMap((l) => (l.latencyMs != null ? [l.latencyMs] : []));
  const median = lat.length ? [...lat].sort((a, b) => a - b)[Math.floor(lat.length / 2)]! : null;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => void end.current?.scrollIntoView({ block: 'nearest' }), [lines.length]); // void: newer Chromium returns a Promise, which React would take for a clean-up
  const snap = useRef<RunSnapshot>({ id, label, lines: [], timeline: [], costUsd: 0, secs: 0, median: null });
  snap.current = { id, label, lines, timeline: d ? [...d.stats.timeline] : [], costUsd: cost, secs, median };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="min-w-0 space-y-6">
      <Card>
        <h2 className="type-h4 mb-1">Conversation</h2>
        <p className="type-caption mb-3">{label}</p>
        {ex.error && <p className="mb-3 text-sm text-bad-text">{ex.error}</p>}
        <Conversation lines={lines} end={end} />
        {!lines.length && (d ? <CascadeSteps steps={d.stats.steps} /> : <p className="text-sm text-muted">Connecting… the examiner opens the test.</p>)}
      </Card>
       {d && <CascadeTimeline timeline={d.stats.timeline} />}
       {d && lines.length > 0 && (
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
              ['Turn model', `${lk.turnDetection === 'audio' ? 'LiveKit v1-mini (server)' : 'VAD only (server)'}${d?.stats.lastEot ? ` · ended ${Math.round(d.stats.lastEot)} ms after speech` : ''}`],
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
