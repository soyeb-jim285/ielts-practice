// Result helpers shared by the speaking and writing results pages.
import { queryOptions } from '@tanstack/react-query';
import { LONG_PAUSE_MS, speakingOverall, type Pause, type SpeechMetrics } from '@ielts/core';
import type { AnalysisError, AnalysisResult, CriterionKey, Fix } from '@server/ai/types';
import { api } from './api';

export type AttemptStatus = 'recording' | 'analyzing' | 'done' | 'failed';

/** GET /api/attempts/:id */
export type Attempt = {
  id: string;
  promptId: string;
  skill: 'speaking' | 'writing';
  part: number;
  mode: 'practice' | 'live' | 'exam';
  sessionId: string | null;
  parentAttemptId: string | null;
  audioMime: string | null;
  audioUrl: string | null;
  text: string | null;
  plan: string | null;
  energy: number[] | null;
  marks: number[] | null;
  durationMs: number | null;
  overtime: boolean;
  status: AttemptStatus;
  error: string | null;
  /** status failed: false when an immediate retry cannot help (AI credit/key problem). */
  retryable?: boolean;
  createdAt: string;
  analysis: AnalysisResult | null;
  prompt: {
    id: string;
    skill: 'speaking' | 'writing';
    part: number;
    variant: 'academic' | 'general' | null;
    type: string;
    topic: string;
    title: string;
    body: string;
    bullets: string[] | null;
    followUps: string[] | null;
    chart: unknown;
    imageUrl: string | null;
    groupId: string | null;
  };
};

/** GET /api/attempts list row */
export type AttemptListItem = {
  id: string;
  promptId: string;
  promptTitle: string;
  skill: 'speaking' | 'writing';
  part: number;
  mode: 'practice' | 'live' | 'exam';
  sessionId: string | null;
  status: AttemptStatus;
  durationMs: number | null;
  overall: number | null;
  createdAt: string;
};

const pending = (s?: AttemptStatus) => s === 'analyzing';

/** Attempt query that polls every 2 s while the analysis runs. */
export const attemptQuery = (id: string) =>
  queryOptions({
    queryKey: ['attempt', id],
    queryFn: () => api.get<Attempt>(`/attempts/${id}`),
    refetchInterval: (q) => (pending(q.state.data?.status) ? 2000 : false),
    staleTime: (q) => (pending(q.state.data?.status) ? 0 : 5 * 60_000), // presigned audio URL lives longer than this
  });

/** Re-run a failed analysis (or submit a never-submitted one with its stored data). */
export const retryAnalysis = (id: string) => api.post<{ status: 'analyzing' }>(`/attempts/${id}/submit`, {});

// ---- labels & colours ----

export const SPEAKING_CRITERIA: CriterionKey[] = ['fc', 'lr', 'gra', 'p'];
export const WRITING_CRITERIA: CriterionKey[] = ['ta', 'cc', 'lr', 'gra'];

const LABELS: Record<string, string> = {
  fc: 'Fluency & Coherence',
  lr: 'Lexical Resource',
  gra: 'Grammar',
  p: 'Pronunciation',
  ta: 'Task Achievement/Response',
  cc: 'Coherence & Cohesion',
};
export const criterionLabel = (k: string) => LABELS[k] ?? k;

/** good when band ≥ target, warn when within 0.5 below, bad otherwise. */
export function bandColor(b: number, target: number): 'good' | 'warn' | 'bad' {
  return b >= target ? 'good' : b > target - 1.5 ? 'warn' : 'bad'; // red only when 1.5+ bands short: 0.5–1 below target is "close", not failure
}

const CATEGORY_GROUP: Record<string, string> = {
  grammar: 'Grammar',
  lexis: 'Vocabulary',
  cohesion: 'Cohesion',
  task: 'Task',
  pronunciation: 'Pronunciation',
  fluency: 'Fluency',
};
/** "grammar.article" → "Grammar · article" */
export function categoryLabel(c: string) {
  const [g = '', sub] = c.split('.');
  return sub ? `${CATEGORY_GROUP[g] ?? g} · ${sub.replace(/-/g, ' ')}` : (CATEGORY_GROUP[g] ?? g);
}

// ---- transcript tokens ----

export type Token = { i: number; w: string; start: number; end: number; conf?: number; errorIds: string[]; filler?: boolean; pauseAfter?: Pause; unclearTier?: 1 | 2 | 3 };

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** Merges words, error spans (word indices, inclusive), pauses (attached to the preceding word), fillers and unclear tiers. */
export function buildTokens(r: AnalysisResult): Token[] {
  const words = r.words ?? [];
  const tokens: Token[] = words.map((w, i) => ({ i, w: w.w, start: w.start, end: w.end, conf: w.conf, errorIds: [] }));
  for (const e of r.errors) {
    if (e.start < 0) continue;
    for (let i = e.start; i <= Math.min(e.end, tokens.length - 1); i++) tokens[i]!.errorIds.push(e.id);
  }
  const m = r.metrics;
  if (!m) return tokens;
  for (const p of m.pauses) {
    const t = tokens.find((t) => near(t.end, p.start));
    if (t) t.pauseAfter = p;
  }
  for (const f of m.fillers) {
    if (f.kind !== 'lexical') continue;
    const i = tokens.findIndex((t) => near(t.start, f.time));
    if (i < 0) continue;
    tokens[i]!.filler = true;
    if (f.word.includes(' ') && tokens[i + 1]) tokens[i + 1]!.filler = true;
  }
  for (const u of m.unclear) if (tokens[u.wordIdx]) tokens[u.wordIdx]!.unclearTier = u.tier;
  return tokens;
}

export type TranscriptFilter = 'all' | 'grammar' | 'vocab' | 'other' | 'pauses' | 'fillers' | 'unclear';
export type ErrorGroup = 'grammar' | 'vocab' | 'other';

/** Transcript filter for an error: task, cohesion, fluency and pronunciation notes all go under "other". */
export function errorGroup(e: AnalysisError): ErrorGroup {
  return e.category.startsWith('grammar') ? 'grammar' : e.category.startsWith('lexis') ? 'vocab' : 'other';
}

/** `s` without a leading `lead` it repeats (cue-card bodies restate the title: "Describe X.\nand explain…"). */
export const stripLead = (lead: string, s: string) => (lead && s.startsWith(lead) ? s.slice(lead.length).trim() : s);

/** Transcript heading for a question: its first line, plus the rest (cue card) without a repeat of that line. */
export function questionHead(text: string) {
  const [head = '', ...rest] = text.split('\n');
  return { head, rest: stripLead(head, rest.join('\n')).replace(/\s*\n\s*/g, ' ') };
}

/** Pause length as shown ("1.0"), and long = what that shows ≥ 1 s, so a pause labelled "1.0s" is never drawn as short. */
export const pauseSec = (p: Pause) => (Math.round(p.dur * 10) / 10).toFixed(1);
export const isLongPause = (p: Pause) => Math.round(p.dur * 10) >= LONG_PAUSE_MS / 100;

// ---- fluency stats (heuristic band-7 targets) ----

export type Stat = { key: string; label: string; value: string; tone: 'good' | 'warn' | 'bad'; info: string };

// lo-is-good thresholds: value ≤ good → good, ≤ warn → warn, else bad. hi-is-good flips it.
const upTo = (v: number, good: number, warn: number) => (v <= good ? 'good' : v <= warn ? 'warn' : 'bad') as Stat['tone'];
const atLeast = (v: number, good: number, warn: number) => (v >= good ? 'good' : v >= warn ? 'warn' : 'bad') as Stat['tone'];

/** Stat grid with tone vs a band-7 heuristic. ponytail: fixed thresholds from docs/research.md norms; tune when self-eval data says so. */
export function speechStats(m: SpeechMetrics): Stat[] {
  const perMin = (n: number) => n / Math.max(m.durationS / 60, 0.25);
  const rate = m.speechRate;
  const long = m.pauses.filter(isLongPause).length;
  return [
    { key: 'rate', label: 'Speech rate', value: `${Math.round(rate)} wpm`, tone: rate >= 120 && rate <= 170 ? 'good' : rate >= 100 && rate <= 190 ? 'warn' : 'bad', info: 'Words per minute over the whole answer, pauses included. Band 7+ speakers usually sit around 120–170.' },
    { key: 'artic', label: 'Articulation rate', value: `${Math.round(m.articulationRate)} wpm`, tone: atLeast(m.articulationRate, 150, 130), info: 'Words per minute while you are actually speaking (pauses removed). Low values mean slow, effortful delivery.' },
    { key: 'mlr', label: 'Mean length of run', value: `${m.mlr.toFixed(1)} words`, tone: atLeast(m.mlr, 8, 5), info: 'Average number of words between pauses. Longer runs sound more fluent.' },
    { key: 'pauseRatio', label: 'Pause ratio', value: `${Math.round(m.pauseRatio * 100)}%`, tone: upTo(m.pauseRatio, 0.2, 0.3), info: 'Share of the answer spent in silence.' },
    { key: 'long', label: 'Long pauses', value: String(long), tone: upTo(perMin(long), 1, 2), info: 'Silences of 1 second or more. Examiners hear these as searching for words.' },
    { key: 'mid', label: 'Mid-clause pauses', value: String(m.midClausePauses), tone: upTo(perMin(m.midClausePauses), 1, 2.5), info: 'Pauses inside a clause rather than at a natural boundary. These hurt fluency more than pauses between ideas.' },
    { key: 'fillers', label: 'Fillers', value: `${m.fillersPerMin.toFixed(1)}/min`, tone: upTo(m.fillersPerMin, 2, 4), info: 'um, uh, er, "you know", "sort of" and voiced hesitations per minute.' },
    { key: 'reps', label: 'Repetitions', value: String(m.repetitions.length), tone: upTo(perMin(m.repetitions.length), 1, 2), info: 'Words or phrases repeated back-to-back while you search for the next idea.' },
    { key: 'self', label: 'Self-corrections', value: String(m.selfCorrections.length), tone: upTo(perMin(m.selfCorrections.length), 1, 2), info: 'Restarts like "I go— I went". A few are natural; many suggest hesitation.' },
    { key: 'var', label: 'Pace variability', value: `±${Math.round(m.wpmStdDev)} wpm`, tone: upTo(m.wpmStdDev, 20, 35), info: 'Standard deviation of your pace across 10-second windows. Big swings = uneven pace.' },
  ];
}

// ---- session (full test) ----

/** Session-level criteria and overall, weighted by speaking time (spec §5). Parts without a scored analysis are skipped. */
export function sessionOverall(parts: { result: AnalysisResult | null | undefined; durationMs: number | null }[]) {
  const scored = parts.filter((p): p is { result: AnalysisResult; durationMs: number | null } => !!p.result && !p.result.noSpeech && SPEAKING_CRITERIA.every((k) => p.result!.criteria[k]));
  if (!scored.length) return null;
  const weight = (p: (typeof scored)[number]) => Math.max(p.durationMs ?? 0, 1);
  const total = scored.reduce((s, p) => s + weight(p), 0);
  const avg = (k: CriterionKey) => scored.reduce((s, p) => s + p.result.criteria[k]!.band * weight(p), 0) / total;
  // Whole-band criteria as the examiner would award them, then the usual overall rounding.
  const criteria = { fc: Math.round(avg('fc')), lr: Math.round(avg('lr')), gra: Math.round(avg('gra')), p: Math.round(avg('p')) };
  return { criteria, ...speakingOverall(criteria), scored: scored.length };
}

// ---- review deck ----

export const errorCard = (e: AnalysisError) => ({ front: `Fix: "${e.original}"`, back: `${e.correction}\n\n${e.explanation}`, source: 'mistake' as const });
export const fixCard = (f: Fix) => ({ front: `${f.title}\n\n${f.before}`, back: `${f.after}\n\n${f.why}`, source: 'fix' as const });

export const addErrorToDeck = (e: AnalysisError) => api.post('/cards', errorCard(e));
export const addFixesToDeck = (fixes: Fix[]) => api.post('/cards/bulk', { cards: fixes.map(fixCard) });
