// Shared result contract (spec §6). Server produces it; web + iOS render it.
// Keep in sync with zod schemas in ai/schemas.ts (those validate LLM output; this is the stored shape).
import type { SpeechMetrics, TextMetrics, Word } from '@ielts/core';

export type CriterionKey = 'fc' | 'lr' | 'gra' | 'p' | 'ta' | 'cc';

export type Criterion = {
  band: number; // whole band 0-9
  range: [number, number];
  descriptor: string; // verbatim-ish official descriptor phrase that matched
  evidence: string[]; // short quotes from the answer
  summary: string;
};

export type Fix = { title: string; why: string; before: string; after: string };

export type AnalysisError = {
  id: string; // e0, e1 …
  category: string; // MISTAKE_CATEGORIES
  severity: 'minor' | 'major';
  // speaking: word indices (inclusive); writing: char offsets [start, end). -1 when not locatable
  start: number;
  end: number;
  original: string;
  correction: string;
  explanation: string;
  time?: number; // seconds (speaking)
};

export type VocabUpgrade = { original: string; better: string[]; note: string };

export type PronunciationLlm = {
  // heard/expected/disfluencies are absent on analyses stored before they existed
  words: { word: string; time: number; issue: 'sound' | 'stress' | 'intonation' | 'unclear'; heard?: string; expected?: string; tip: string }[];
  disfluencies?: { filledPauses: number[]; repetitions: number[]; falseStarts: number[] };
  prosody: string;
  band: number;
};

export type WritingStructure = {
  paragraphs: { role: 'intro' | 'overview' | 'body' | 'conclusion' | 'greeting' | 'closing' | 'other'; topicSentence: string; ok: boolean; note: string }[];
  overview: { present: boolean; mainTrends: boolean; noData: boolean; note: string } | null;
  position: { clear: boolean; consistent: boolean; note: string } | null;
  planFollowed: { followed: boolean; note: string } | null;
};

export type AnalysisResult = {
  v: 1;
  skill: 'speaking' | 'writing';
  part: number;
  overall: number; // rounded band
  overallRaw: number;
  range: [number, number];
  /** Writing: bands added to the criterion mean to correct the analysis model's measured bias (overallRaw includes it). Absent when none applied. */
  calibration?: number;
  criteria: Partial<Record<CriterionKey, Criterion>>;
  topFixes: Fix[]; // exactly 3 (0 when noSpeech / too short)
  errors: AnalysisError[];
  vocabUpgrades: VocabUpgrade[];
  rewrite: { text: string; note: string };
  // speaking
  words?: Word[];
  metrics?: SpeechMetrics;
  questions?: { text: string; startWord: number }[]; // question boundaries in transcript
  pronunciation?: { unclear: SpeechMetrics['unclear']; llm?: PronunciationLlm };
  relevance?: { questionIdx: number; onTopic: boolean; note: string }[];
  noSpeech?: boolean;
  // writing
  text?: string;
  structure?: WritingStructure;
  textMetrics?: TextMetrics;
  tooShort?: boolean;
  // retry comparison
  comparison?: { parentAttemptId: string; parentOverall: number; deltas: Partial<Record<CriterionKey, number>> };
};

export type ChartSpec =
  | { kind: 'line' | 'bar'; title: string; xLabel: string; yLabel: string; unit: string; categories: string[]; series: { name: string; values: number[] }[] }
  | { kind: 'pie'; title: string; unit: string; pies: { name: string; slices: { label: string; value: number }[] }[] }
  | { kind: 'table'; title: string; columns: string[]; rows: (string | number)[][] }
  | { kind: 'process'; title: string; steps: string[] }
  | { kind: 'map'; title: string; before: { label: string; features: string[] }; after: { label: string; features: string[] } };
