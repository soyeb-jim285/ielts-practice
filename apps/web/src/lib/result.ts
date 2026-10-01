// Result helpers shared by the speaking and writing results pages.
import { queryOptions } from '@tanstack/react-query';
import { fuseDisfluencies, LONG_PAUSE_MS, speakingOverall, type Disfluency, type DisfluencyKind, type Pause, type SpeechMetrics } from '@ielts/core';
import type { AnalysisError, AnalysisResult, CriterionKey, Fix } from '@server/ai/types';
import { api } from './api';

import type { Attempt, AttemptStatus } from './attempt';
export * from './attempt';

/** No usable speech: flagged by the pipeline, or overall 0 (the server treats that as not assessed too). */
export const notAssessed = (r: AnalysisResult) => !!r.noSpeech || r.overall === 0;

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

/** Pronunciation more than 2 bands above fluency (halting or very short speech) is an audio-only guess: shown with a low-confidence badge and a wider range. ponytail: until the server tempers it. */
export const pronunciationUnsupported = (c: AnalysisResult['criteria'], k: string) => k === 'p' && !!c.p && !!c.fc && c.p.band - c.fc.band > 2;

/** Stored prompt titles can be ALL CAPS: show those in sentence case. */
export const sentenceCase = (t: string) => (/[A-Z]{2}/.test(t) && t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t);

/** good when band ≥ target, warn when 0.5–1.0 below, bad when 1.5+ below. */
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
/** "grammar.article" → "Grammar: article" */
export function categoryLabel(c: string) {
  const [g = '', sub] = c.split('.');
  return sub ? `${CATEGORY_GROUP[g] ?? g}: ${sub.replace(/-/g, ' ')}` : (CATEGORY_GROUP[g] ?? g);
}

// ---- transcript tokens ----

export type Token = { i: number; w: string; start: number; end: number; conf?: number; errorIds: string[]; filler?: boolean; pauseAfter?: Pause; unclearTier?: 1 | 2 | 3; disfluency?: DisfluencyMark[] };

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
  for (const e of disfluencyEvents(m)) {
    if (e.kind === 'filled' && e.sources.includes('stt')) continue; // already struck through on its word
    const i = tokens.findIndex((t) => t.end > e.start - 0.02);
    const t = tokens[i < 0 ? tokens.length - 1 : i];
    if (t) (t.disfluency ??= []).push(describeDisfluency(e, tokens, m));
  }
  return tokens;
}

export type TranscriptFilter = 'all' | 'grammar' | 'vocab' | 'other' | 'pauses' | 'fillers' | 'repeats' | 'unclear';
export type ErrorGroup = 'grammar' | 'vocab' | 'other';

/** Transcript filter for an error: task, cohesion, fluency and pronunciation notes all go under "other". */
export function errorGroup(e: AnalysisError): ErrorGroup {
  return e.category.startsWith('grammar') ? 'grammar' : e.category.startsWith('lexis') ? 'vocab' : 'other';
}

/** A task/relevance-style note on a whole stretch (8+ words): drawn as a sentence tint, only when its filter is on. */
export const isSentenceNote = (e: AnalysisError) => errorGroup(e) === 'other' && e.end - e.start >= 7;

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

/** [first sentence, the rest]; rest is '' for a single sentence. */
export function splitFirstSentence(text: string): [string, string] {
  const m = /^.+?[.!?](?=\s+\S)/s.exec(text);
  return m ? [m[0], text.slice(m[0].length).trim()] : [text, ''];
}

/** Whether question `i` has any speech in the transcript (a question you skipped has no start word, or shares it with the next one). Unknown boundaries count as answered. */
export function wasAnswered(r: AnalysisResult, i: number) {
  const qs = r.questions;
  const q = qs?.[i];
  if (!qs || !q) return true;
  const next = qs.slice(i + 1).find((x) => x.startWord >= 0);
  return q.startWord >= 0 && q.startWord < (r.words?.length ?? 0) && (!next || next.startWord > q.startWord);
}

/** Relevance verdicts for the questions you actually answered: the same unit as the transcript, so a skipped question is never "off topic". */
export const answeredRelevance = (r: AnalysisResult) => (r.relevance ?? []).filter((x) => wasAnswered(r, x.questionIdx));

/** Speaking answers that missed their question, when that is most of them (the speaking twin of writing's off-topic alert); else null. Counts answered questions only. */
export function offTopicAnswers(r: AnalysisResult): { off: number; total: number } | null {
  const rel = answeredRelevance(r);
  const off = rel.filter((x) => !x.onTopic).length;
  return off * 2 > rel.length ? { off, total: rel.length } : null;
}

// ---- fluency stats (heuristic band-7 targets) ----

export type Stat = { key: string; label: string; value: string; tone: 'good' | 'warn' | 'bad' | 'na'; info: string };

/** Under ~20 words or 15 s, rates and per-minute counts are noise: show no verdicts. */
export const tooShortToMeasure = (m: SpeechMetrics) => m.wordCount < 20 || m.durationS < 15;

// lo-is-good thresholds: value ≤ good → good, ≤ warn → warn, else bad. hi-is-good flips it.
const upTo = (v: number, good: number, warn: number) => (v <= good ? 'good' : v <= warn ? 'warn' : 'bad') as Stat['tone'];
const atLeast = (v: number, good: number, warn: number) => (v >= good ? 'good' : v >= warn ? 'warn' : 'bad') as Stat['tone'];

/** Speech-rate verdict shared by the Fluency tab and the live pace pill, so both teach the same pace. */
export const paceTone = (wpm: number): Exclude<Stat['tone'], 'na'> => (wpm >= 120 && wpm <= 170 ? 'good' : wpm >= 100 && wpm <= 190 ? 'warn' : 'bad');

/** Stat grid with tone vs a band-7 heuristic. ponytail: fixed thresholds from docs/research.md norms; tune when self-eval data says so. */
export function speechStats(m: SpeechMetrics): Stat[] {
  const perMin = (n: number) => n / Math.max(m.durationS / 60, 0.25);
  const rate = m.speechRate;
  const long = m.pauses.filter(isLongPause).length;
  const stats: Stat[] = [
    { key: 'rate', label: 'Speech rate', value: `${Math.round(rate)} wpm`, tone: paceTone(rate), info: 'Words per minute over the whole answer, pauses included. Band 7+ speakers usually sit around 120–170.' },
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
  return tooShortToMeasure(m) ? stats.map((s) => ({ ...s, value: '—', tone: 'na' })) : stats;
}

// ---- disfluencies (spec §5.1): fused events from the pipeline, typed for the transcript chips, timeline and per-type breakdown ----

type WithFluency = SpeechMetrics & { fluency?: { events?: Disfluency[] } };
/** Fused filler/repetition/repair events (stored with the analysis); rebuilt from the transcript-level metrics for older analyses. */
export const disfluencyEvents = (m: SpeechMetrics): Disfluency[] => (m as WithFluency).fluency?.events ?? fuseDisfluencies(m);

export type DisfluencyMark = { kind: DisfluencyKind; time: number; short: string; detail: string };

/** Tone per type (chips, timeline ticks, breakdown) and the chip text. Colour is never the only cue: every chip carries its label. */
export const DISFLUENCY: Record<DisfluencyKind, { label: string; tone: 'neutral' | 'info' | 'accent' | 'warn'; short: string }> = {
  filled: { label: 'Filled pauses', tone: 'neutral', short: 'filler' },
  repetition: { label: 'Repetitions', tone: 'info', short: 'repeat' },
  repair: { label: 'Self-corrections', tone: 'accent', short: 'repair' },
  false_start: { label: 'False starts', tone: 'warn', short: 'false start' },
  partial: { label: 'Cut-off words', tone: 'neutral', short: 'cut-off' },
  prolongation: { label: 'Held sounds', tone: 'neutral', short: 'held sound' },
};

const norm = (w: string) => w.toLowerCase().replace(/[^a-z']/g, '');
const span = (ts: Token[]) => ts.map((t) => t.w).join(' ');

/** Chip text plus the hover/tap explanation: "self-correction: he go → he goes", "repetition: the the". Needs the transcript words to quote; falls back to the type alone for audio-only events. */
export function describeDisfluency(e: Disfluency, tokens: Token[], m: SpeechMetrics): DisfluencyMark {
  const kind = e.kind;
  const { short } = DISFLUENCY[kind];
  const mark = (detail: string): DisfluencyMark => ({ kind, time: e.start, short, detail });
  if (kind === 'repetition') {
    const r = m.repetitions.find((x) => near(x.time, e.start));
    return mark(r ? `Repetition: “${r.phrase}” said twice` : 'Repetition: a word or phrase said twice in a row');
  }
  if (kind === 'repair') {
    const j = m.selfCorrections.find((x) => near(x.time, e.start))?.wordIdx ?? -1;
    // Pattern "A B … A C": the word before the restart that matches it starts the abandoned wording.
    const k = tokens[j] ? [j - 4, j - 3, j - 2].find((x) => x >= 0 && norm(tokens[x]!.w) === norm(tokens[j]!.w)) : undefined;
    if (k != null) return mark(`Self-correction: “${span(tokens.slice(k, k + 2))}” → “${span(tokens.slice(j, j + 2))}”`);
    return mark('Self-correction: you restarted and changed the wording');
  }
  if (kind === 'false_start') return mark('False start: a sentence abandoned or restarted');
  if (kind === 'partial') return mark('Cut-off word: you stopped mid-word and started again');
  if (kind === 'prolongation') return mark('Held sound: a word stretched while you thought');
  return mark('Filled pause (heard in the audio, not shown in the transcript)');
}

const PER_MIN = { filled: [2, 4], repetition: [1, 2], repair: [1, 2], false_start: [1, 2], partial: [1, 2], prolongation: [2, 4] } as const;
const GUIDE: Record<DisfluencyKind, { what: string; normal: string; harmful: string }> = {
  filled: {
    what: '"um", "uh", "er" and similar sounds you make while searching for a word.',
    normal: 'A couple a minute is natural, even for native speakers.',
    harmful: 'More than about 4 a minute, or several in a row, makes you sound unsure. Pause silently or use "let me think" instead.',
  },
  repetition: {
    what: 'A word or phrase said twice in a row, like "I I think" or "the the city".',
    normal: 'An occasional repeat while you plan the next word is fine.',
    harmful: 'Frequent repeats signal word-searching and break the flow of an idea. Plan the first few words before you start.',
  },
  repair: {
    what: 'You restart and change the wording, like "he go… he goes".',
    normal: 'Fixing a real mistake shows self-monitoring. Band 7 allows some self-correction.',
    harmful: 'Many restarts in a row make the listener lose the idea. Correct only what matters, then keep going.',
  },
  false_start: {
    what: 'A sentence you abandon and begin again, like "I went to the… actually my hometown is…".',
    normal: 'One now and then is normal in unplanned speech.',
    harmful: 'Often abandoning sentences hurts coherence. Start with a short, safe clause and build on it.',
  },
  partial: {
    what: 'A word you cut off and restart, like "sh- she" or "beau- beautiful".',
    normal: 'Occasional cut-offs happen when you change your mind about a word.',
    harmful: 'Many cut-offs suggest you are reaching for words you are not sure of. Choose a simpler word you can say cleanly.',
  },
  prolongation: {
    what: 'A sound held while you think, like "sooo" or "theee".',
    normal: 'An occasional stretched word is an ordinary way to buy thinking time.',
    harmful: 'Frequent stretching slows the answer and can sound hesitant. Try a short pause instead.',
  },
};

/** Per-type counts and rates with a verdict, for the Fluency tab. Always the four types, so a zero is visible as good news. */
export function disfluencyTypes(m: SpeechMetrics) {
  const events = disfluencyEvents(m);
  const mins = Math.max(m.durationS, 1) / 60;
  const short = tooShortToMeasure(m);
  // The four main types always show (a zero is good news); cut-offs and held sounds only when there are some.
  const kinds = (Object.keys(DISFLUENCY) as DisfluencyKind[]).filter((k) => ['filled', 'repetition', 'repair', 'false_start'].includes(k) || events.some((e) => e.kind === k));
  return kinds.map((kind) => {
    const count = events.filter((e) => e.kind === kind).length;
    const perMin = count / Math.max(mins, 0.25);
    const [good, warn] = PER_MIN[kind];
    return { kind, label: DISFLUENCY[kind].label, count, perMin, tone: (short ? 'na' : upTo(perMin, good, warn)) as Stat['tone'], ...GUIDE[kind] };
  });
}

// ---- session (full test) ----

/** Session-level criteria and overall, weighted by speaking time (spec §5). Parts without a scored analysis are skipped. */
export function sessionOverall(parts: { result: AnalysisResult | null | undefined; durationMs: number | null }[]) {
  const scored = parts.filter((p): p is { result: AnalysisResult; durationMs: number | null } => !!p.result && !notAssessed(p.result) && SPEAKING_CRITERIA.every((k) => p.result!.criteria[k]));
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
