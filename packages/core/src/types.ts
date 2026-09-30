/** seconds; prolonged: a sound held noticeably long (STT with character timing) */
export type Word = { w: string; start: number; end: number; conf?: number; prolonged?: boolean };

export type Pause = { start: number; end: number; dur: number; kind: 'short' | 'long'; midClause: boolean; voiced: boolean };

export type SpeechMetrics = {
  durationS: number;
  wordCount: number;
  speechRate: number; // words/min over total time
  articulationRate: number; // words/min over phonation time
  phonationRatio: number;
  pauseRatio: number;
  mlr: number; // mean length of run (words between pauses)
  pauses: Pause[];
  longPauses: number;
  midClausePauses: number;
  fillers: { word: string; time: number; kind: 'lexical' | 'voiced' }[];
  fillersPerMin: number;
  repetitions: { phrase: string; time: number; wordIdx: number }[];
  selfCorrections: { time: number; wordIdx: number }[];
  unclear: { wordIdx: number; w: string; conf: number; tier: 1 | 2 | 3 }[];
  wpmSeries: { t: number; wpm: number }[];
  wpmStdDev: number;
  /** Absent on analyses stored before it existed. lessCommonPct: % of words outside the 5,000 most common spoken forms. */
  lexical?: { mtld: number; ttr: number; lessCommonPct: number; overused: { word: string; count: number }[] };
};

export type TextMetrics = {
  words: number;
  sentences: number;
  paragraphs: number;
  avgSentenceLen: number;
  mtld: number;
  ttr: number;
  linkers: { word: string; count: number; overused: boolean }[];
  /** Share of sentences that open with a linker (>0.4 over 5+ sentences reads as templated). */
  linkerOpeningRatio: number;
  repeated: { word: string; count: number }[];
};

export type CardState = { ease: number; interval: number; reps: number; due: Date };
