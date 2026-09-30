// zod schemas for LLM outputs. The stored result shape is AnalysisResult in ./types.ts.
import { z } from 'zod';
import { AiError } from './openrouter';

export const MISTAKE_CATEGORIES = [
  'grammar.article', 'grammar.tense', 'grammar.agreement', 'grammar.preposition', 'grammar.word-order', 'grammar.plural',
  'grammar.sentence-structure', 'grammar.punctuation', 'grammar.other', 'lexis.collocation', 'lexis.word-choice', 'lexis.word-form', 'lexis.spelling',
  'lexis.repetition', 'cohesion.overuse', 'cohesion.missing', 'cohesion.reference', 'task.relevance', 'task.overview',
  'task.position', 'pronunciation.word', 'fluency.hesitation',
] as const;

const Band = z.number().int().min(0).max(9);

export const CriterionSchema = z.object({
  band: Band,
  range: z.tuple([Band, Band]).describe('[lo, hi] whole bands, lo <= band <= hi'),
  descriptor: z.string().describe('Verbatim descriptor phrase(s) of the awarded band that this performance matches'),
  evidence: z.array(z.string()).max(4).describe('Short quotes copied verbatim from the response that justify the band (never metric names or numbers)'),
  summary: z.string().describe('1-2 sentences: what holds this criterion back from the next band'),
});

export const ErrorSchema = z.object({
  category: z.enum(MISTAKE_CATEGORIES).describe('Most specific category that fits; punctuation (commas, run-ons, apostrophes) is grammar.punctuation; grammar.other only when none fits'),
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
    .array(
      z.object({
        word: z.string(),
        time: z.number(),
        issue: z.enum(['sound', 'stress', 'intonation', 'unclear']),
        heard: z.string().describe('What the candidate actually said'),
        expected: z.string().describe('The dictionary pronunciation'),
        tip: z.string(),
      }),
    )
    .max(20),
  disfluencies: z.object({
    filledPauses: z.array(z.number()).describe('Start times (s) of each um/uh/er heard'),
    repetitions: z.array(z.number()).describe('Start times (s) of each repeated word or phrase'),
    falseStarts: z.array(z.number()).describe('Start times (s) of each abandoned or restarted sentence'),
  }),
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

/** Writing schema when a plan was submitted: planFollowed is required, so the model cannot skip it. */
export const WritingPlanLlmSchema = WritingLlmSchema.extend({
  structure: WritingLlmSchema.shape.structure.extend({ planFollowed: z.object({ followed: z.boolean(), note: z.string() }) }),
});
/** Scoring-only samples (see withScoringSamples). */
export const WritingScoreSchema = WritingLlmSchema.pick({ criteria: true });
export const SpeakingScoreSchema = SpeakingLlmSchema.pick({ criteria: true });

export type LlmCriterion = z.infer<typeof CriterionSchema>;

/** Keeps each range within band ±1 (a single-band range widens to band ±1: one run is never that certain) and returns the overall [lo, hi] (IELTS-rounded means), never narrower than overall ±0.5. */
export function settleRanges<K extends string>(criteria: Record<K, LlmCriterion>, overall: (bands: Record<K, number>) => number) {
  const pick = (f: (c: LlmCriterion) => number) => Object.fromEntries(Object.entries<LlmCriterion>(criteria).map(([k, c]) => [k, f(c)])) as Record<K, number>;
  for (const c of Object.values<LlmCriterion>(criteria)) {
    c.range = [Math.max(c.band - 1, Math.min(c.range[0], c.band)), Math.min(c.band + 1, Math.max(c.range[1], c.band))];
    if (c.range[0] === c.range[1]) c.range = [Math.max(0, c.band - 1), Math.min(9, c.band + 1)];
  }
  // Held-out Cambridge error is ~0.5 band, so the overall range always covers it.
  const mid = overall(pick((c) => c.band));
  return [Math.max(0, Math.min(mid - 0.5, overall(pick((c) => c.range[0])))), Math.min(9, Math.max(mid + 0.5, overall(pick((c) => c.range[1]))))] as [number, number];
}

/** Per criterion: the median-band sample (with its descriptor/evidence), its range grown to cover every sample's band. */
export function medianCriteria<K extends string>(samples: Record<K, LlmCriterion>[]): Record<K, LlmCriterion> {
  return Object.fromEntries(
    Object.keys(samples[0]!).map((k) => {
      const cs = samples.map((s) => s[k as K]).sort((a, b) => a.band - b.band);
      const m = cs[(cs.length - 1) >> 1]!;
      return [k, { ...m, range: [Math.min(m.range[0], cs[0]!.band), Math.max(m.range[1], cs.at(-1)!.band)] }];
    }),
  ) as Record<K, LlmCriterion>;
}

/** Scoring-only calls run alongside each full analysis: one LLM sample flips the overall band on about half of essays. */
export const EXTRA_SAMPLES = 2;

/** Runs the full analysis and EXTRA_SAMPLES scoring-only calls in parallel; criteria become the per-criterion median. Failed extras are ignored.
 *  A retryable failure of the full analysis (timeout, network, 429/5xx, unreadable JSON) is retried once before giving up. */
export async function withScoringSamples<K extends string, T extends { criteria: Record<K, LlmCriterion> }>(
  full: () => Promise<T>,
  score: () => Promise<{ criteria: Record<K, LlmCriterion> }>,
): Promise<T> {
  const fullOnce = () =>
    full().catch((e: unknown) => {
      if (!(e instanceof AiError && e.retryable)) throw e;
      console.error('full analysis failed, retrying once', e.code, e.status ?? '');
      return full();
    });
  const [main, ...extra] = await Promise.allSettled([fullOnce(), ...Array.from({ length: EXTRA_SAMPLES }, score)]);
  if (main.status === 'rejected') throw main.reason;
  const ok = extra.flatMap((r) => (r.status === 'fulfilled' ? [r.value.criteria] : []));
  return { ...main.value, criteria: medianCriteria([main.value.criteria, ...ok]) };
}

const norm = (s: string) => ` ${s.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}']+/gu, ' ').trim()} `;
/** Drops evidence that is not a verbatim quote of the response (metric keys, paraphrases). An ellipsis splits a quote into parts that must each appear. */
export function keepVerbatimEvidence(criteria: Record<string, LlmCriterion>, source: string) {
  const src = norm(source);
  for (const c of Object.values(criteria))
    c.evidence = c.evidence.filter((e) => {
      const parts = e.split(/\.{3}|…/).map(norm).filter((p) => p.trim());
      return parts.length > 0 && parts.every((p) => src.includes(p));
    });
}
