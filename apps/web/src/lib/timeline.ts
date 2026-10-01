// One timeline for a speaking result: where (seconds) and what (type) went wrong, shared by the pace chart, the audio bar and the transcript.
import type { SpeechMetrics } from '@ielts/core';
import type { AnalysisError, AnalysisResult } from '@server/ai/types';
import { DISFLUENCY, disfluencyEvents, errorType, isLongPause } from './result';

export type MarkerType = NonNullable<ReturnType<typeof errorType>>;
export const MARKER_TYPES: MarkerType[] = ['grammar', 'vocabulary', 'pronunciation', 'fluency'];

export type Marker = { id: string; t: number; end?: number; type: MarkerType; label: string; error?: AnalysisError };
export type QuestionSegment = { idx: number; start: number; end: number; text: string };
export type Timeline = { markers: Marker[]; questions: QuestionSegment[]; pauses: { start: number; end: number }[]; durationS: number };

export function timelineMarkers(r: AnalysisResult): Timeline {
  const words = r.words ?? [];
  const m = r.metrics;
  const durationS = m?.durationS ?? words.at(-1)?.end ?? 0;
  const markers: Marker[] = [];
  for (const e of r.errors) {
    const type = errorType(e.category);
    const t = e.time ?? words[e.start]?.start;
    if (!type || t == null) continue;
    markers.push({ id: e.id, t, end: words[e.end]?.end, type, label: e.original ? `${e.original} → ${e.correction}` : e.explanation, error: e });
  }
  if (m) {
    disfluencyEvents(m).forEach((d, i) => markers.push({ id: `d${i}`, t: d.start, end: d.end, type: 'fluency', label: DISFLUENCY[d.kind].short }));
    for (const u of m.unclear) {
      const w = words[u.wordIdx];
      if (w) markers.push({ id: `u${u.wordIdx}`, t: w.start, end: w.end, type: 'pronunciation', label: `Unclear: “${u.w}”` });
    }
  }
  markers.sort((a, b) => a.t - b.t);

  const starts = (r.questions ?? []).flatMap((q, idx) => (words[q.startWord] ? [{ idx, start: words[q.startWord]!.start, text: q.text }] : []));
  const questions = starts.map((q, i) => ({ ...q, end: starts[i + 1]?.start ?? durationS }));
  const pauses = (m?.pauses ?? []).filter(isLongPause).map((p) => ({ start: p.start, end: p.end }));
  return { markers, questions, pauses, durationS };
}

/** Pace at time t, interpolated along the chart line (windows are plotted at their midpoint). */
export function wpmAt(series: SpeechMetrics['wpmSeries'], windowS: number, t: number): number {
  const pts = series.map((p) => ({ x: p.t + windowS / 2, y: p.wpm }));
  if (!pts.length) return 0;
  const i = pts.findIndex((p) => p.x >= t);
  if (i < 0) return pts.at(-1)!.y;
  if (i === 0) return pts[0]!.y;
  const [a, b] = [pts[i - 1]!, pts[i]!];
  return a.y + ((b.y - a.y) * (t - a.x)) / (b.x - a.x || 1);
}

/** Index of the word playing at time t (the last word that started), or -1 before the first. */
export function wordAt(words: { start: number }[], t: number): number {
  let lo = 0;
  let hi = words.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid]!.start <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}
