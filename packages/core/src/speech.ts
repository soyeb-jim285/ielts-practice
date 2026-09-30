import { FILLERS, LONG_PAUSE_MS, PAUSE_MS, UNCLEAR_CONF, VOICED_GAP_MS, WPM_HOP_S, WPM_WINDOW_S } from './constants';
import type { Pause, SpeechMetrics, Word } from './types';

export type { Pause, SpeechMetrics, Word } from './types';

const CLAUSE_STARTERS = new Set(['and', 'but', 'so', 'because', 'which', 'that', 'when', 'if', 'or']);
const SINGLE_FILLERS = new Set(FILLERS.filter(f => !f.includes(' ')));
const BIGRAM_FILLERS = new Set(FILLERS.filter(f => f.includes(' ')));

export function computeSpeechMetrics(
  words: Word[],
  opts: { durationS: number; energy?: number[]; frameMs?: number; voiceThreshold?: number },
): SpeechMetrics {
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
    pauses.push({ start, end, dur: gap, kind: Math.round(gap * 1000) >= LONG_PAUSE_MS ? 'long' : 'short', midClause: !endsClause(i - 1), voiced: isVoiced(start, end) });
  }

  const fillers: SpeechMetrics['fillers'] = [];
  const isFillerAt = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (i + 1 < n && BIGRAM_FILLERS.has(`${norm[i]} ${norm[i + 1]}`)) {
      fillers.push({ word: `${norm[i]} ${norm[i + 1]}`, time: words[i]!.start, kind: 'lexical' });
      isFillerAt[i] = isFillerAt[i + 1] = true;
      i++;
    } else if (SINGLE_FILLERS.has(norm[i]!)) {
      // "like" is only a filler when a pause sits next to it; otherwise it's a verb/preposition.
      if (norm[i] === 'like' && gapBefore(i) * 1000 < PAUSE_MS && gapBefore(i + 1) * 1000 < PAUSE_MS) continue;
      fillers.push({ word: norm[i]!, time: words[i]!.start, kind: 'lexical' });
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
      repetitions.push({ phrase: a, time: words[i]!.start, wordIdx: i });
      i += len - 1; // loop's i++ completes the skip of n
      break;
    }
  }

  // Repair pattern "A B … A C": the speaker restarts at A and changes what follows.
  const selfCorrections: SpeechMetrics['selfCorrections'] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j <= i + 4 && j < n; j++) {
      if (norm[i] !== norm[j] || norm[i + 1] === norm[j + 1] || !clean(i, i + 2) || !clean(j, j + 1) || (j + 1 < n && isFillerAt[j + 1])) continue;
      selfCorrections.push({ time: words[j]!.start, wordIdx: j });
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
  };
}
