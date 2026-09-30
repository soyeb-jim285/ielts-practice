import { FILLERS, LONG_PAUSE_MS, PAUSE_MS, UNCLEAR_CONF, VOICED_GAP_MS, WPM_HOP_S, WPM_WINDOW_S } from './constants';
import { COMMON_WORDS } from './common-words';
import { lexicalProfile, tokenize } from './text';
import type { Pause, SpeechMetrics, Word } from './types';

export type { Pause, SpeechMetrics, Word } from './types';

const CLAUSE_STARTERS = new Set(['and', 'but', 'so', 'because', 'which', 'that', 'when', 'if', 'or']);
const SINGLE_FILLERS = new Set(FILLERS.filter(f => !f.includes(' ')));
const BIGRAM_FILLERS = new Set(FILLERS.filter(f => f.includes(' ')));
/** Articles, prepositions, conjunctions: "the X and the Y" / "of A, of B" restart on these in ordinary parallel structures, not repairs. */
const FUNCTION_WORDS = new Set('a an the of in on at to for with by from about into onto over under after before through between and or but nor so as than that if because while when'.split(' '));
/** Whisper stretches word timestamps over the "um"s and silences it drops, hiding the pause: a word longer than max(STRETCH_MIN_S, 2x expected) holds one. */
const S_PER_LETTER = 0.07, STRETCH_MIN_S = 0.7;

export function computeSpeechMetrics(
  words: Word[],
  opts: { durationS: number; energy?: number[]; frameMs?: number; voiceThreshold?: number },
): SpeechMetrics {
  // Trim stretched words to their expected length and expose the rest as a gap before them.
  // ponytail: the hidden gap may really sit after the word; placing it before only shifts which clause edge it touches.
  const orig = words; // events keep the transcript's start times, which the audio model's disfluency times align to
  words = words.map((w, i) => {
    const expected = S_PER_LETTER * w.w.replace(/[^a-z]/gi, '').length;
    if (i === 0 || w.end - w.start <= Math.max(STRETCH_MIN_S, 2 * expected)) return w;
    return { ...w, start: w.end - expected };
  });
  const durationS = opts.durationS > 0 ? opts.durationS : 1;
  const mins = durationS / 60;
  const n = words.length;
  const norm = words.map(w => w.w.toLowerCase().replace(/[^a-z']/g, ''));
  const gapBefore = (i: number) => (i >= 1 && i < n ? words[i]!.start - words[i - 1]!.end : 0);
  const endsClause = (i: number) => /[.!?,;:]$/.test(words[i]!.w) || CLAUSE_STARTERS.has(norm[i + 1] ?? '');

  // Voiced = >= 40% of energy frames inside the gap are above threshold.
  const isVoiced = (start: number, end: number) => {
    const { energy, frameMs = 50, voiceThreshold = 60 } = opts;
    if (!energy) return false;
    const frames = energy.slice(Math.round((start * 1000) / frameMs), Math.round((end * 1000) / frameMs));
    return frames.length > 0 && frames.filter(e => e >= voiceThreshold).length / frames.length >= 0.4;
  };

  const pauses: Pause[] = [];
  for (let i = 1; i < n; i++) {
    const gap = gapBefore(i);
    if (gap * 1000 < PAUSE_MS) continue;
    const start = words[i - 1]!.end, end = words[i]!.start;
    // Only energy frames can tell a filled pause from silence; without them no gap is called voiced (a stretched word may hide either).
    const voiced = isVoiced(start, end);
    pauses.push({ start, end, dur: gap, kind: Math.round(gap * 1000) >= LONG_PAUSE_MS ? 'long' : 'short', midClause: !endsClause(i - 1), voiced });
  }

  // "like" and "you know" are ordinary words far more often than fillers ("I like football"), so the transcript alone counts them only between two pauses;
  // the text LLM and the audio model can still tag them (fuseDisfluencies).
  const weak = (i: number, len: number) => gapBefore(i) * 1000 < PAUSE_MS || gapBefore(i + len) * 1000 < PAUSE_MS;
  const fillers: SpeechMetrics['fillers'] = [];
  const isFillerAt = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (i + 1 < n && BIGRAM_FILLERS.has(`${norm[i]} ${norm[i + 1]}`)) {
      if (norm[i] === 'you' && weak(i, 2)) continue;
      fillers.push({ word: `${norm[i]} ${norm[i + 1]}`, time: orig[i]!.start, kind: 'lexical' });
      isFillerAt[i] = isFillerAt[i + 1] = true;
      i++;
    } else if (SINGLE_FILLERS.has(norm[i]!)) {
      if (norm[i] === 'like' && weak(i, 1)) continue;
      fillers.push({ word: norm[i]!, time: orig[i]!.start, kind: 'lexical' });
      isFillerAt[i] = true;
    }
  }
  for (const p of pauses) if (p.voiced && p.dur * 1000 >= VOICED_GAP_MS) fillers.push({ word: '(voiced)', time: p.start, kind: 'voiced' });
  fillers.sort((a, b) => a.time - b.time);

  const clean = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (k >= n || isFillerAt[k] || !norm[k]) return false;
    return true;
  };

  const repetitions: SpeechMetrics['repetitions'] = [];
  for (let i = 0; i < n; i++) {
    for (const len of [3, 2, 1]) {
      if (!clean(i, i + 2 * len)) continue;
      const a = norm.slice(i, i + len).join(' ');
      if (a !== norm.slice(i + len, i + 2 * len).join(' ')) continue;
      repetitions.push({ phrase: a, time: orig[i]!.start, wordIdx: i });
      i += len - 1; // loop's i++ completes the skip of n
      break;
    }
  }

  // Repair pattern "A B … (pause|filler) A C": the speaker stops, restarts at content word A and changes what follows.
  const selfCorrections: SpeechMetrics['selfCorrections'] = [];
  for (let i = 0; i < n; i++) {
    if (FUNCTION_WORDS.has(norm[i]!)) continue;
    for (let j = i + 2; j <= i + 4 && j < n; j++) {
      if (norm[i] !== norm[j] || norm[i + 1] === norm[j + 1] || !clean(i, i + 2) || !clean(j, j + 1) || (j + 1 < n && isFillerAt[j + 1])) continue;
      if (gapBefore(j) * 1000 < PAUSE_MS && !isFillerAt[j - 1]) continue;
      selfCorrections.push({ time: orig[j]!.start, wordIdx: j });
      i = j - 1; // loop's i++ lands on j
      break;
    }
  }

  // Fillers are not words for rate/MLR, and end a run like a pause does (research.md §3), so "um"-heavy speech is not read as fluent.
  const spoken = words.filter((_, i) => !isFillerAt[i]);
  let runs = 0;
  for (let i = 0, inRun = false; i < n; i++) {
    if (isFillerAt[i] || gapBefore(i) * 1000 >= PAUSE_MS) inRun = false;
    if (!isFillerAt[i] && !inRun) (runs++, (inRun = true));
  }
  const phonation = spoken.reduce((s, w) => s + (w.end - w.start), 0);
  const wpmSeries: SpeechMetrics['wpmSeries'] = [];
  for (let t = 0; t + WPM_WINDOW_S <= Math.max(durationS, WPM_WINDOW_S); t += WPM_HOP_S)
    wpmSeries.push({ t, wpm: words.filter(w => w.start >= t && w.start < t + WPM_WINDOW_S).length * (60 / WPM_WINDOW_S) });
  const mean = wpmSeries.reduce((s, p) => s + p.wpm, 0) / (wpmSeries.length || 1);
  const wpmStdDev = Math.sqrt(wpmSeries.reduce((s, p) => s + (p.wpm - mean) ** 2, 0) / (wpmSeries.length || 1));

  const unclear: SpeechMetrics['unclear'] = [];
  words.forEach((w, wordIdx) => {
    if (w.conf != null && w.conf < UNCLEAR_CONF) unclear.push({ wordIdx, w: w.w, conf: w.conf, tier: w.conf < 0.4 ? 3 : w.conf < 0.5 ? 2 : 1 });
  });

  return {
    durationS: opts.durationS,
    wordCount: spoken.length,
    speechRate: spoken.length / mins,
    articulationRate: phonation > 0 ? spoken.length / (phonation / 60) : 0,
    phonationRatio: phonation / durationS,
    pauseRatio: pauses.reduce((s, p) => s + p.dur, 0) / durationS,
    mlr: runs ? spoken.length / runs : 0,
    pauses,
    longPauses: pauses.filter(p => p.kind === 'long').length,
    midClausePauses: pauses.filter(p => p.midClause).length,
    fillers,
    fillersPerMin: fillers.length / mins,
    repetitions,
    selfCorrections,
    unclear,
    wpmSeries,
    wpmStdDev,
    lexical: lexicalProfile(tokenize(spoken.map(w => w.w).join(' '))),
  };
}

/** repair = STT-visible self-correction; false_start = abandoned / restarted clause; partial = cut-off word ("th-"); prolongation = held sound ("sooo"). */
export type DisfluencyKind = 'filled' | 'repetition' | 'repair' | 'false_start' | 'partial' | 'prolongation';
/** Timed disfluency event after fusion; `sources` says which detectors saw it (stt = transcript tokens, voiced = energy in a gap, audio = audio model, rule = token rules, llm = text tagger). */
export type Disfluency = { kind: DisfluencyKind; start: number; end: number; sources: ('stt' | 'voiced' | 'audio' | 'rule' | 'llm')[] };
export type AudioDisfluencies = { filledPauses: number[]; repetitions: number[]; falseStarts: number[] };

/** Cut-offs as the transcript shows them. A dash after a whole word ("I went to the—") is an abandoned clause (false_start); after a fragment
 *  ("th-") or a stutter ("b-but") it is a partial word. An ellipsis counts only after a fragment that is not a word ("wh…"): "well…" is ordinary hesitation. */
const CUT = /^(\p{L}+)(?:(?:[-–—]+)|(…|\.{2,}))$/u;
const STUTTER = /^(\p{L}{1,3})[-–](\p{L}{2,})$/u;
const SUBJECTS = new Set('i we he she they you it my our there is was are do'.split(' '));
const commonWords = new Set(COMMON_WORDS.split(' '));
function cutOff(w: string): 'false_start' | 'partial' | undefined {
  const t = w.trim(), m = CUT.exec(t);
  if (m) {
    const stem = m[1]!.toLowerCase();
    if (m[2]) return stem.length <= 5 && !commonWords.has(stem) ? 'partial' : undefined;
    return stem.length >= 4 || FUNCTION_WORDS.has(stem) || SUBJECTS.has(stem) ? 'false_start' : 'partial';
  }
  const s = STUTTER.exec(t);
  return s && s[1]!.length < s[2]!.length && s[1]!.toLowerCase() !== 're' && s[2]!.toLowerCase().startsWith(s[1]!.toLowerCase()) ? 'partial' : undefined;
}
const HELD = /(\p{L})\1{2,}/iu; // "sooo", "weeell": no English word has a letter three times in a row
const STRETCHED_FILLER = /^(h?m{2,}|u+h+|u+m+|e+r+m*|a+h+)[.,!?…]*$/i; // "hmmm", "uhhh" are already fillers
const isProlonged = (w: Word) => !!w.prolonged || (HELD.test(w.w) && !STRETCHED_FILLER.test(w.w));
/** Rule tagger for what the transcript shows directly: cut-offs and held sounds. Each is one event at the word. */
export function tagDisfluencies(words: Word[]): Disfluency[] {
  return words.flatMap((w, i): Disfluency[] => {
    const kind = cutOff(w.w) ?? (isProlonged(w) ? 'prolongation' : undefined);
    if (!kind) return [];
    // An abandoned clause starts after the previous sentence break (at most 8 words back), not at the cut-off word.
    let from = i;
    if (kind === 'false_start') while (from > 0 && i - from < 8 && !/[.!?;:]$/.test(words[from - 1]!.w)) from--;
    return [{ kind, start: words[from]!.start, end: w.end, sources: ['rule'] }];
  });
}

/** Union by time of the disfluency detectors, each of which under-counts (Whisper drops "um"s, the audio model misses some, energy is crude):
 *  same-kind events within `tol` s (the audio model's timing error) are one event. `tags` = events from other taggers (rules, text LLM).
 *  Repairs = STT self-corrections; false starts = audio-model false starts plus tagger false starts. */
export function fuseDisfluencies(m: SpeechMetrics, audio?: AudioDisfluencies, tol = 0.3, tags: Disfluency[] = []): Disfluency[] {
  const gapEnd = (t: number) => m.pauses.find(p => p.start === t)?.end ?? t;
  const ev: Disfluency[] = [
    ...m.fillers.map((f): Disfluency => (f.kind === 'voiced' ? { kind: 'filled', start: f.time, end: gapEnd(f.time), sources: ['voiced'] } : { kind: 'filled', start: f.time, end: f.time, sources: ['stt'] })),
    ...m.repetitions.map((r): Disfluency => ({ kind: 'repetition', start: r.time, end: r.time, sources: ['stt'] })),
    ...m.selfCorrections.map((s): Disfluency => ({ kind: 'repair', start: s.time, end: s.time, sources: ['stt'] })),
    ...([['filled', audio?.filledPauses], ['repetition', audio?.repetitions], ['false_start', audio?.falseStarts]] as const).flatMap(([kind, ts]) =>
      (ts ?? []).map((t): Disfluency => ({ kind, start: t, end: t, sources: ['audio'] })),
    ),
    ...tags,
  ].sort((a, b) => a.start - b.start);
  const out: Disfluency[] = [];
  for (const e of ev) {
    const same = out.findLast(o => o.kind === e.kind);
    if (same && e.start <= same.end + tol) {
      same.end = Math.max(same.end, e.end);
      for (const s of e.sources) if (!same.sources.includes(s)) same.sources.push(s);
    } else out.push({ ...e, sources: [...e.sources] });
  }
  return out;
}

/** Per-type counts (total, per minute of recording, per 100 spoken words), words between disfluencies and the share of events inside a clause (spec §5.1). */
export type DisfluencyProfile = {
  byKind: Partial<Record<DisfluencyKind, { n: number; perMin: number; per100w: number }>>;
  total: { n: number; perMin: number; per100w: number };
  /** Mean spoken words between consecutive disfluency events (all words when there are none). */
  meanRunLength: number;
  /** Share of events that start mid-clause (the previous word does not end a clause); mid-clause disfluency signals lexical/grammatical search, clause-edge ones planning. */
  midClauseShare: number;
};
export function disfluencyProfile(events: Disfluency[], m: SpeechMetrics, words: Word[]): DisfluencyProfile {
  const mins = Math.max(m.durationS, 1) / 60, per100 = 100 / Math.max(m.wordCount, 1);
  const rate = (n: number) => ({ n, perMin: n / mins, per100w: n * per100 });
  const byKind: DisfluencyProfile['byKind'] = {};
  for (const e of events) byKind[e.kind] = rate((byKind[e.kind]?.n ?? 0) + 1);
  const midClause = events.filter(e => {
    const i = words.findIndex(w => w.start >= e.start - 1e-6);
    return i > 0 && !/[.!?,;:]$/.test(words[i - 1]!.w);
  }).length;
  return { byKind, total: rate(events.length), meanRunLength: m.wordCount / (events.length + 1), midClauseShare: events.length ? midClause / events.length : 0 };
}

/** de Jong timing features plus fused disfluency rates (per minute of recording / per 100 spoken words). */
export type FluencyFeatures = {
  speechRate: number; mlr: number; pauseRatio: number; longPausesPerMin: number; midClausePausesPerMin: number;
  filledPausesPerMin: number; repetitionsPer100w: number; repairsPer100w: number;
};
export function fluencyFeatures(m: SpeechMetrics, events: Disfluency[]): FluencyFeatures {
  const mins = Math.max(m.durationS, 1) / 60, per100 = 100 / Math.max(m.wordCount, 1);
  const n = (k: Disfluency['kind']) => events.filter(e => e.kind === k).length;
  return {
    speechRate: m.speechRate, mlr: m.mlr, pauseRatio: m.pauseRatio,
    longPausesPerMin: m.longPauses / mins, midClausePausesPerMin: m.midClausePauses / mins,
    filledPausesPerMin: n('filled') / mins, repetitionsPer100w: n('repetition') * per100, repairsPer100w: (n('repair') + n('false_start')) * per100,
  };
}

/** Fixed signs from the literature (arXiv 2608.26137; de Jong et al. 2021): higher is more fluent. Articulation rate and repetitions are left out. */
const SIGNS = { mlr: 1, pauseRatio: -1, speechRate: 1, longPausesPerMin: -1, midClausePausesPerMin: -1, filledPausesPerMin: -1, repairsPer100w: -1 } as const;
export type FluencyNorms = Record<keyof typeof SIGNS, { mu: number; sd: number }>;
// ponytail: provisional two-point norms from the docs/research.md §3 heuristics (band 5 ≈ 95 wpm, MLR 4.5, 10 fillers/min; band 7 ≈ 140 wpm, MLR 9,
// 4 fillers/min; the pause and repair profiles are our guesses): mu = midpoint, sd = half the gap, so the band-5 profile scores -1 and band 7 +1.
// Not measured data; re-norm on ICNALE / labelled speaking data before letting the composite drive FC (scoring-research §3.1, §7.2 item 7).
const B5 = { mlr: 4.5, pauseRatio: 0.35, speechRate: 95, longPausesPerMin: 6, midClausePausesPerMin: 6, filledPausesPerMin: 10, repairsPer100w: 4 };
const B7 = { mlr: 9, pauseRatio: 0.2, speechRate: 140, longPausesPerMin: 2, midClausePausesPerMin: 2, filledPausesPerMin: 4, repairsPer100w: 1.5 };
export const PROVISIONAL_FLUENCY_NORMS = Object.fromEntries(
  (Object.keys(SIGNS) as (keyof typeof SIGNS)[]).map(k => [k, { mu: (B5[k] + B7[k]) / 2, sd: Math.abs(B7[k] - B5[k]) / 2 }]),
) as FluencyNorms;

/** F = mean of signed z-scores (each clamped to ±3 so one extreme feature cannot dominate). */
export function fluencyComposite(f: FluencyFeatures, norms: FluencyNorms = PROVISIONAL_FLUENCY_NORMS) {
  const ks = Object.keys(SIGNS) as (keyof typeof SIGNS)[];
  return ks.reduce((s, k) => s + SIGNS[k] * Math.max(-3, Math.min(3, (f[k] - norms[k].mu) / norms[k].sd)), 0) / ks.length;
}
/** Provisional map fluencyBand = 6 + F (band 5 and 7 profiles at F = ∓1), IELTS half-band steps within 0-9. Uncalibrated. */
export const fluencyBand = (F: number) => Math.min(9, Math.max(0, Math.round((6 + F) * 2) / 2));

/** Transcript for rating LR and GRA (Speak & Improve style): drops lexical fillers, the first copy of each repetition and the abandoned words
 *  before each self-correction, so a repair counts once, under fluency. Keeps "kind of"/"sort of", which are grammatical in most uses. */
export function cleanTranscript(words: Word[], m: SpeechMetrics): Word[] {
  const drop = new Set<number>();
  const norm = words.map(w => w.w.toLowerCase().replace(/[^a-z']/g, ''));
  for (const f of m.fillers) {
    if (f.kind !== 'lexical' || f.word === 'kind of' || f.word === 'sort of') continue;
    const i = words.findIndex(w => Math.abs(w.start - f.time) < 1e-6);
    for (let k = 0; i >= 0 && k < f.word.split(' ').length; k++) drop.add(i + k);
  }
  for (const t of tagDisfluencies(words)) if (t.kind === 'partial' || t.kind === 'false_start') { const i = words.findIndex(w => w.start === t.start); if (i >= 0) drop.add(i); }
  for (const r of m.repetitions) for (let k = 0; k < r.phrase.split(' ').length; k++) drop.add(r.wordIdx + k);
  for (const { wordIdx: j } of m.selfCorrections) {
    const i = [j - 4, j - 3, j - 2].find(k => k >= 0 && norm[k] === norm[j]); // the restart repeats the abandoned phrase's first word
    for (let k = i ?? j; k < j; k++) drop.add(k);
  }
  return words.filter((_, i) => !drop.has(i));
}
