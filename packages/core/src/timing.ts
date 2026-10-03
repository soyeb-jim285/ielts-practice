import type { Word } from './types';

/** Whisper-style word times run a word's start back to the previous word's end, so a pause or a "um" it dropped sits inside the next word
 *  (a 0.07 s "I" shown as 0.7 s). Same rule the metrics use: a word longer than max(STRETCH_MIN_S, 2x expected) gets its start moved up to end - expected. */
const S_PER_LETTER = 0.07, STRETCH_MIN_S = 0.7;
/** A quiet run at a word's edge shorter than this is a soft consonant or a dip, not a pause hidden in the word. */
const MIN_QUIET_FRAMES = 4, EDGE_KEEP_S = 0.05, MIN_WORD_S = 0.04;

/**
 * Words whose [start, end] holds only what is spoken, so replay and highlight line up with what is heard.
 * 1. Stretched words are trimmed (see above).
 * 2. With the recorder's 50 ms energy frames, a quiet run of 200+ ms at the head or tail of a word is cut off (keeping 50 ms),
 *    as long as the word still holds a voiced frame. The threshold follows the recording (40% of its loud level, at most `threshold`), so a quiet mic does not trim speech.
 * Only ever shrinks a word inside its own window: order, count and text are unchanged, and running it twice changes nothing.
 */
export function alignWords(words: Word[], energy?: number[], frameMs = 50, threshold = 60): Word[] {
  let out = words.map((w, i) => {
    const expected = S_PER_LETTER * w.w.replace(/[^a-z]/gi, '').length;
    return i === 0 || w.end - w.start <= Math.max(STRETCH_MIN_S, 2 * expected) ? w : { ...w, start: w.end - expected };
  });
  if (!energy || energy.length < 20) return out;
  const sorted = [...energy].sort((a, b) => a - b);
  const thr = Math.min(threshold, 0.4 * sorted[Math.floor(sorted.length * 0.9)]!);
  if (thr < 8) return out; // near-silent recording: no usable signal
  const fs = frameMs / 1000;
  const loud = (k: number) => (energy[k] ?? 0) >= thr;
  out = out.map((w) => {
    const a = Math.max(0, Math.floor(w.start / fs + 1e-6)), b = Math.min(energy.length, Math.ceil(w.end / fs - 1e-6));
    let f = a, l = b - 1;
    while (f <= l && !loud(f)) f++;
    if (f > l) return w; // no voiced frame in the window: the signal says nothing, keep the STT times
    while (!loud(l)) l--;
    const head = f - a, tail = b - 1 - l;
    const start = head >= MIN_QUIET_FRAMES ? Math.max(w.start, f * fs - EDGE_KEEP_S) : w.start;
    const end = tail >= MIN_QUIET_FRAMES ? Math.min(w.end, (l + 1) * fs + EDGE_KEEP_S) : w.end;
    return end - start >= MIN_WORD_S ? { ...w, start, end } : w;
  });
  return out;
}

/** What the replay clock is on at time t: the word being spoken, or the pause after a word (`pause`).
 *  Gaps shorter than `holdS` between words keep the previous word lit (no flicker); a longer gap is a pause, so the word goes off and the pause marker is on.
 *  Before the first word: word -1. Binary search, so it is cheap at 60 Hz. */
export function activeAt(words: { start: number; end: number }[], t: number, holdS = 0.25): { word: number; pause: boolean } {
  let lo = 0, hi = words.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid]!.start <= t) lo = mid + 1;
    else hi = mid;
  }
  const i = lo - 1;
  if (i < 0) return { word: -1, pause: false };
  const w = words[i]!, next = words[i + 1];
  if (t < w.end + 0.05) return { word: i, pause: false };
  if (next && next.start - w.end < holdS) return { word: i, pause: false };
  return { word: i, pause: true };
}

/** Energy frame length (ms): the recorder samples with a setInterval, which a busy or background tab stretches, so frames are spread over the real recording length. 50 ms when that is not plausible. */
export function frameMsOf(energy: number[] | null | undefined, durationMs: number): number {
  const ms = energy?.length && durationMs > 0 ? durationMs / energy.length : 50;
  return ms >= 40 && ms <= 75 ? ms : 50;
}
