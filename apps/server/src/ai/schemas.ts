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

type Category = (typeof MISTAKE_CATEGORIES)[number];
const only = (keep: (c: Category) => boolean) => MISTAKE_CATEGORIES.filter(keep) as [Category, ...Category[]];
/** Speaking has no spelling, overview or position; writing has no pronunciation or hesitation. */
const SPEAKING_CATEGORIES = only((c) => c !== 'lexis.spelling' && c !== 'task.overview' && c !== 'task.position');
const WRITING_CATEGORIES = only((c) => c !== 'pronunciation.word' && c !== 'fluency.hesitation');

const errorSchema = (categories: [Category, ...Category[]]) =>
  z.object({
    category: z.enum(categories).describe('Most specific category that fits; punctuation (commas, run-ons, apostrophes) is grammar.punctuation; grammar.other only when none fits'),
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
  errors: z.array(errorSchema(SPEAKING_CATEGORIES)).max(40),
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
  misheard: z
    .array(
      z.object({
        time: z.number(),
        transcript: z.string().describe('The transcript word ("" when the transcript left out a spoken word)'),
        spoken: z.string().describe('What was actually said ("" when the transcript added a word that was not said)'),
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
    .array(errorSchema(WRITING_CATEGORIES).omit({ start: true, end: true }).extend({ quote: z.string().describe('Exact substring of the essay containing the error') }))
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

/** Pools the samples into whole criterion bands: each criterion's mean band (steadier than the median sample, which flips whenever one
 *  criterion flips), shifted so the overall becomes `target(mean of means)` (writing calibration), then rounded by largest remainder so
 *  the shown bands always average to that overall. Text comes from the sample nearest each band (the full analysis on ties); when no
 *  sample gave exactly that band, `describe` supplies the official descriptor so the text never contradicts the band. */
export function poolCriteria<K extends string>(
  samples: Record<K, LlmCriterion>[],
  target: (mean: number) => number = (m) => m,
  describe?: (key: K, band: number) => string | undefined,
): Record<K, LlmCriterion> {
  const keys = Object.keys(samples[0]!) as K[];
  const mean = (f: (x: Record<K, LlmCriterion>) => number) => samples.reduce((s, x) => s + f(x), 0) / samples.length;
  const means = keys.map((k) => mean((x) => x[k].band));
  const avg = means.reduce((a, b) => a + b) / keys.length;
  const goal = target(avg), x = means.map((m) => m + goal - avg);
  const bands = x.map(Math.floor);
  let left = Math.round(goal * keys.length + 1e-9) - bands.reduce((a, b) => a + b);
  // Largest remainder first; on a tie the later criterion (writing LR/GRA, which the model under-scores most) goes up.
  const frac = (i: number) => Math.round((x[i]! - bands[i]!) * 1e6);
  for (const i of keys.map((_, i) => i).sort((a, b) => frac(b) - frac(a) || b - a)) if (left-- > 0) bands[i]!++;
  const whole = (v: number) => Math.min(9, Math.max(0, Math.round(v + goal - avg)));
  return Object.fromEntries(
    keys.map((k, i) => {
      const cs = samples.map((s) => s[k]), band = Math.min(9, Math.max(0, bands[i]!));
      const rep = cs.reduce((a, c) => (Math.abs(c.band - band) < Math.abs(a.band - band) ? c : a));
      const range: [number, number] = [whole(Math.min(...cs.map((c) => Math.min(c.band, c.range[0])))), whole(Math.max(...cs.map((c) => Math.max(c.band, c.range[1]))))];
      const descriptor = rep.band === band ? undefined : describe?.(k, band);
      const next = describe?.(k, band + 1);
      return [k, { ...rep, band, range, ...(descriptor && { descriptor, summary: next ? `To reach band ${band + 1}: ${next}` : rep.summary }) }];
    }),
  ) as Record<K, LlmCriterion>;
}

/** Scoring-only calls run alongside each full analysis: one LLM sample flips the overall band on about half of essays. */
export const EXTRA_SAMPLES = 2;

/** Runs the full analysis and `extra` scoring-only calls in parallel and returns the full analysis plus every sample's criteria (for poolCriteria). Failed extras are ignored.
 *  A retryable failure of the full analysis (timeout, network, 429/5xx, unreadable JSON) is retried once before giving up. */
export async function withScoringSamples<K extends string, T extends { criteria: Record<K, LlmCriterion> }>(
  full: () => Promise<T>,
  score: () => Promise<{ criteria: Record<K, LlmCriterion> }>,
  extra = EXTRA_SAMPLES,
): Promise<T & { samples: Record<K, LlmCriterion>[] }> {
  const fullOnce = () =>
    full().catch((e: unknown) => {
      if (!(e instanceof AiError && e.retryable)) throw e;
      console.error('full analysis failed, retrying once', e.code, e.status ?? '');
      return full();
    });
  const [main, ...rest] = await Promise.allSettled([fullOnce(), ...Array.from({ length: extra }, score)]);
  if (main.status === 'rejected') throw main.reason;
  const ok = rest.flatMap((r) => (r.status === 'fulfilled' ? [r.value.criteria] : []));
  return { ...main.value, samples: [main.value.criteria, ...ok] };
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
