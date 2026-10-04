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
/** Words before "like" that make it the verb or a comparison ("I like it", "would like"), and what follows it as an object. */
const LIKE_VERB_BEFORE = new Set("i we you they he she who people to would do don't dont did does doesn't really".split(' '));
const LIKE_OBJECT_AFTER = new Set('it them him her me us to'.split(' '));
/** "do you know, …" is a question, not the discourse marker. */
const QUESTION_BEFORE = new Set("do did if as that what how when don't dont".split(' '));
/** Doubled words that are emphasis or grammar ("very very", "that that is", "had had"), not repetitions. */
const DOUBLE_OK = new Set('very so no many much really bye that had'.split(' '));
/** The word ends a sentence or clause in the transcript: "I agree, I think" restarts a new clause, not a repair. */
const ENDS_PHRASE = /[.!?,;:]$/;
/** Whisper stretches word timestamps over the "um"s and silences it drops, hiding the pause: a word longer than max(STRETCH_MIN_S, 2x expected) holds one. */
const MAX_ARTICULATION_WPM = 260;
const S_PER_LETTER = 0.07, STRETCH_MIN_S = 0.7;
const HELD_VOICE_MS = 500, VOICED_FILLER_MS = 1000;

export function computeSpeechMetrics(
  words: Word[],
  opts: { durationS: number; energy?: number[]; frameMs?: number; voiceThreshold?: number; /** [from, to] seconds where the app moved between questions (page render, examiner audio, auto-start): a gap touching one is app timing, not a pause. */ transitions?: [number, number][] },
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

  // A filled pause heard only in the audio must look like a held vowel, not a breath, a lip smack or room noise: the gap is voiced for most of its frames,
  // with one unbroken voiced stretch of 0.5 s or more. Breaths and noise bursts are short and broken up.
  const isHeldVoice = (start: number, end: number) => {
    const { energy, frameMs = 50, voiceThreshold = 60 } = opts;
    if (!energy) return false;
    const frames = energy.slice(Math.round((start * 1000) / frameMs), Math.round((end * 1000) / frameMs));
    let run = 0, best = 0, voiced = 0;
    for (const e of frames) {
      if (e >= voiceThreshold) (voiced++, (best = Math.max(best, ++run)));
      else run = 0;
    }
    return frames.length > 0 && voiced / frames.length >= 0.7 && best * frameMs >= HELD_VOICE_MS;
  };
  const heldGaps = new Set<number>(); // pause starts that pass isHeldVoice

  const pauses: Pause[] = [];
  let transitionS = 0; // gap time spent between questions: neither pause nor speech
  for (let i = 1; i < n; i++) {
    const gap = gapBefore(i);
    if (gap * 1000 < PAUSE_MS) continue;
    const start = words[i - 1]!.end, end = words[i]!.start;
    if (opts.transitions?.some(([a, b]) => a <= end && b >= start)) {
      transitionS += gap;
      continue;
    }
    // Only energy frames can tell a filled pause from silence; without them no gap is called voiced (a stretched word may hide either).
    const voiced = isVoiced(start, end);
    if (voiced && isHeldVoice(start, end)) heldGaps.add(start);
    pauses.push({ start, end, dur: gap, kind: Math.round(gap * 1000) >= LONG_PAUSE_MS ? 'long' : 'short', midClause: !endsClause(i - 1), voiced });
  }

  // "like" and "you know" are ordinary words far more often than fillers ("I like football"), so the transcript counts them only when it shows them set off:
  // commas on both sides ("about, like, a boy"), pauses on both sides, or (like only) a pause before it that is not the verb ("I like it", "to like", "would like").
  const weak = (i: number, len: number) => gapBefore(i) * 1000 < PAUSE_MS || gapBefore(i + len) * 1000 < PAUSE_MS;
  const comma = (i: number) => i >= 0 && i < n && /,$/.test(words[i]!.w);
  const fillers: SpeechMetrics['fillers'] = [];
  const isFillerAt = new Array<boolean>(n).fill(false);
  const isLike = (i: number) =>
    (comma(i - 1) && comma(i)) || !weak(i, 1) || (gapBefore(i) * 1000 >= PAUSE_MS && !LIKE_VERB_BEFORE.has(norm[i - 1] ?? '') && !LIKE_OBJECT_AFTER.has(norm[i + 1] ?? ''));
  const isYouKnow = (i: number) => (comma(i - 1) && comma(i + 1) && !QUESTION_BEFORE.has(norm[i - 1] ?? '')) || !weak(i, 2);
  for (let i = 0; i < n; i++) {
    if (i + 1 < n && BIGRAM_FILLERS.has(`${norm[i]} ${norm[i + 1]}`)) {
      // "what kind of music", "I mean it": the bigram is a filler only when set off, by commas or pauses on both sides
      if (norm[i] === 'you' ? !isYouKnow(i) : !((comma(i - 1) && comma(i + 1)) || !weak(i, 2))) continue;
      fillers.push({ word: `${norm[i]} ${norm[i + 1]}`, time: orig[i]!.start, kind: 'lexical' });
      isFillerAt[i] = isFillerAt[i + 1] = true;
      i++;
    } else if (SINGLE_FILLERS.has(norm[i]!)) {
      if (norm[i] === 'like' && !isLike(i)) continue;
      fillers.push({ word: norm[i]!, time: orig[i]!.start, kind: 'lexical' });
      isFillerAt[i] = true;
    }
  }
  // Audio-only filled pauses are rare in practice and breaths in short pauses look like them: counted here only for a gap of 1 s or more that is held voice.
  // A shorter voiced gap becomes a filled pause only when the audio model also heard a filler there (fuseDisfluencies).
  for (const p of pauses) if (heldGaps.has(p.start) && p.dur * 1000 >= VOICED_FILLER_MS) fillers.push({ word: '(voiced)', time: p.start, kind: 'voiced' });
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
      if (/[.!?]$/.test(words[i + len - 1]!.w) || (len === 1 && DOUBLE_OK.has(a))) continue; // "like it. It is", "very very"
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
      if (ENDS_PHRASE.test(words[j - 1]!.w)) continue; // "very good, very cheap", "I agree. I think": parallel clauses
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
  // Speaking time = the span from the first to the last word minus pauses and filler words. Summing ASR word durations instead left out every gap under
  // PAUSE_MS and gave about 2x human articulation rates (260-350 wpm); a clamp at 260 wpm keeps timestamp glitches from printing absurd rates.
  const fillerTime = words.reduce((s, w, i) => s + (isFillerAt[i] ? w.end - w.start : 0), 0);
  const phonation = n ? Math.max(0, words[n - 1]!.end - words[0]!.start - pauses.reduce((s, p) => s + p.dur, 0) - transitionS - fillerTime) : 0;
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
    articulationRate: phonation > 0 ? Math.min(MAX_ARTICULATION_WPM, spoken.length / (phonation / 60)) : 0,
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
  // A filled pause the transcript did not show needs two sources: held voice in a 1 s+ gap (counted by computeSpeechMetrics), or the audio model's filler inside a voiced gap.
  // The audio model alone (nothing in the energy) and short voiced gaps alone are dropped: breaths and noise were being typed as "um".
  // A false start from the audio model or text tagger alone needs evidence where the clause was dropped (its end): a pause, or a filler / restart there.
  // The transcript's own cut-off ("the—") is evidence by itself. Ungated, both models were inventing false starts in fluent speech.
  const near = (t: number) => (a: number, b: number) => t >= a - tol && t <= b + tol;
  const evidenced = (e: Disfluency) =>
    e.sources.includes('rule') ||
    m.pauses.some(p => near(e.end)(p.start, p.end)) ||
    out.some(o => o !== e && o.kind !== 'false_start' && near(e.end)(o.start, o.end));
  return out.filter(e => {
    if (e.kind === 'false_start') return evidenced(e);
    if (e.kind !== 'filled' || e.sources.some(s => s === 'stt' || s === 'rule' || s === 'llm') || e.sources.includes('voiced')) return true;
    const gap = m.pauses.find(p => p.voiced && p.dur * 1000 >= VOICED_GAP_MS && e.start >= p.start - tol && e.start <= p.end + tol);
    if (!gap) return false;
    e.sources.unshift('voiced');
    e.start = Math.min(e.start, gap.start);
    e.end = Math.max(e.end, gap.end);
    return true;
  });
}

/** Makes the stored filler list agree with the fused events, so "fillers per minute", the transcript's "um"s and the fluency features count the same things:
 *  lexical fillers stay, and every filled event the transcript did not show becomes one voiced entry (at the event's start). */
export function reconcileFillers(m: SpeechMetrics, events: Disfluency[]): void {
  const lexical = m.fillers.filter(f => f.kind === 'lexical');
  const heard = events.filter(e => e.kind === 'filled' && !e.sources.includes('stt')).map((e): SpeechMetrics['fillers'][number] => ({ word: '(voiced)', time: e.start, kind: 'voiced' }));
  m.fillers = [...lexical, ...heard].sort((a, b) => a.time - b.time);
  m.fillersPerMin = m.fillers.length / (Math.max(m.durationS, 1) / 60);
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
