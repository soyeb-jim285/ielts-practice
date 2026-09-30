// zod schemas for LLM outputs. The stored result shape is AnalysisResult in ./types.ts.
import { z } from 'zod';

export const MISTAKE_CATEGORIES = [
  'grammar.article', 'grammar.tense', 'grammar.agreement', 'grammar.preposition', 'grammar.word-order', 'grammar.plural',
  'grammar.sentence-structure', 'grammar.other', 'lexis.collocation', 'lexis.word-choice', 'lexis.word-form', 'lexis.spelling',
  'lexis.repetition', 'cohesion.overuse', 'cohesion.missing', 'cohesion.reference', 'task.relevance', 'task.overview',
  'task.position', 'pronunciation.word', 'fluency.hesitation',
] as const;

const Band = z.number().int().min(0).max(9);

export const CriterionSchema = z.object({
  band: Band,
  range: z.tuple([Band, Band]).describe('[lo, hi] whole bands, lo <= band <= hi'),
  descriptor: z.string().describe('Verbatim descriptor phrase(s) of the awarded band that this performance matches'),
  evidence: z.array(z.string()).max(4).describe('Short verbatim quotes or metric facts that justify the band'),
  summary: z.string().describe('1-2 sentences: what holds this criterion back from the next band'),
});

export const ErrorSchema = z.object({
  category: z.enum(MISTAKE_CATEGORIES),
  severity: z.enum(['minor', 'major']),
  start: z.number().int().describe('First word index (inclusive)'),
  end: z.number().int().describe('Last word index (inclusive)'),
  original: z.string(),
  correction: z.string(),
  explanation: z.string(),
});

export const FixSchema = z.object({
  title: z.string(),
  why: z.string().describe('Which descriptor feature this fix unlocks'),
  before: z.string().describe('Verbatim from the answer'),
  after: z.string(),
});

const VocabUpgradesSchema = z.array(z.object({ original: z.string(), better: z.array(z.string()).max(3), note: z.string() })).max(8);

export const SpeakingLlmSchema = z.object({
  criteria: z.object({ fc: CriterionSchema, lr: CriterionSchema, gra: CriterionSchema, p: CriterionSchema }),
  topFixes: z.array(FixSchema).length(3),
  errors: z.array(ErrorSchema).max(40),
  relevance: z.array(z.object({ questionIdx: z.number().int(), onTopic: z.boolean(), note: z.string() })),
  vocabUpgrades: VocabUpgradesSchema,
  rewrite: z.string(),
});

export const PronLlmSchema = z.object({
  words: z
    .array(z.object({ word: z.string(), time: z.number(), issue: z.enum(['sound', 'stress', 'intonation', 'unclear']), tip: z.string() }))
    .max(20),
  prosody: z.string(),
  band: Band,
});

export const WritingLlmSchema = z.object({
  criteria: z.object({ ta: CriterionSchema, cc: CriterionSchema, lr: CriterionSchema, gra: CriterionSchema }),
  topFixes: z.array(FixSchema).length(3),
  errors: z
    .array(ErrorSchema.omit({ start: true, end: true }).extend({ quote: z.string().describe('Exact substring of the essay containing the error') }))
    .max(40),
  structure: z.object({
    paragraphs: z.array(
      z.object({
        role: z.enum(['intro', 'overview', 'body', 'conclusion', 'greeting', 'closing', 'other']),
        topicSentence: z.string(),
        ok: z.boolean(),
        note: z.string(),
      }),
    ),
    overview: z.object({ present: z.boolean(), mainTrends: z.boolean(), noData: z.boolean(), note: z.string() }).nullable(),
    position: z.object({ clear: z.boolean(), consistent: z.boolean(), note: z.string() }).nullable(),
    planFollowed: z.object({ followed: z.boolean(), note: z.string() }).nullable(),
  }),
  vocabUpgrades: VocabUpgradesSchema,
  rewrite: z.string(),
});

export type LlmCriterion = z.infer<typeof CriterionSchema>;

/** Keeps each range around its band and returns the overall [lo, hi] (IELTS-rounded means). */
export function settleRanges<K extends string>(criteria: Record<K, LlmCriterion>, overall: (bands: Record<K, number>) => number) {
  const pick = (f: (c: LlmCriterion) => number) => Object.fromEntries(Object.entries<LlmCriterion>(criteria).map(([k, c]) => [k, f(c)])) as Record<K, number>;
  for (const c of Object.values<LlmCriterion>(criteria)) c.range = [Math.min(c.range[0], c.band), Math.max(c.range[1], c.band)];
  return [overall(pick((c) => c.range[0])), overall(pick((c) => c.range[1]))] as [number, number];
}
