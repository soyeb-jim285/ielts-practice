// zod schemas for LLM outputs. The stored result shape is AnalysisResult in ./types.ts.
import { z } from 'zod';
import { asRetry } from './cost';
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
/** Writing feedback call output: the analysis without bands (bands come from the scoring calls, so feedback cannot pull them into a halo). */
const offTopic = { offTopicParagraphs: z.array(z.number().int()).describe('1-based numbers of the paragraphs whose content has nothing to do with the prompt (not merely weak or badly placed); [] when every paragraph addresses it') };
export const WritingFeedbackSchema = WritingLlmSchema.omit({ criteria: true }).extend(offTopic);
export const WritingPlanFeedbackSchema = WritingPlanLlmSchema.omit({ criteria: true }).extend(offTopic);

/** Rationale-first scoring output (scoring-research §2.3): placement and checks come before "band" (strict json_schema keeps the order). */
export const CriterionScoreSchema = z.object({
  placement: z.object({ closest: z.string().describe('benchmark id, "" if there are none'), relation: z.enum(['weaker', 'similar', 'stronger']) }),
  checks: z
    .array(z.object({ band: Band, feature: z.string().describe('descriptor phrase being checked'), verdict: z.enum(['met', 'partly', 'not_met']), quote: z.string().describe('verbatim from the response, "" if none') }))
    .max(8),
  evidence: z.array(z.string()).max(4).describe('verbatim quotes that justify the awarded band'),
  descriptor: z.string().describe('verbatim descriptor phrase(s) of the awarded band'),
  summary: z.string().describe('1-2 sentences: the feature of the next band up that is missing'),
  injection: z.boolean(),
  band: Band,
});
export type CriterionScore = z.infer<typeof CriterionScoreSchema>;

export type LlmCriterion = z.infer<typeof CriterionSchema>;

/** Conformal ranges (§2.1 step 7): the overall ± q (the calibration record's q90, 1 when uncalibrated, widened by the caller),
 *  each criterion ± ⌈q⌉ whole bands; clamped to 0..9. Returns the overall [lo, hi]. */
export function settleRanges(criteria: Record<string, LlmCriterion>, overall: number, q: number): [number, number] {
  for (const c of Object.values(criteria)) c.range = [Math.max(0, c.band - Math.ceil(q)), Math.min(9, c.band + Math.ceil(q))];
  return [Math.max(0, overall - q), Math.min(9, overall + q)];
}

/** Pools the samples into whole criterion bands: each criterion's mean band (steadier than the median sample, which flips whenever one
 *  criterion flips), shifted so the overall becomes `target(mean of means)` (writing calibration), then rounded by largest remainder so
 *  the shown bands always average to that overall. Text comes from the sample nearest each band (the full analysis on ties); when no
 *  sample gave exactly that band, `describe` supplies the official descriptor so the text never contradicts the band. */
export function poolCriteria<K extends string>(
  samples: Record<K, LlmCriterion>[],
  target: (mean: number) => number = (m) => m,
  describe?: (key: K, band: number) => string | undefined,
  /** Share of each criterion's distance from the criteria mean that is kept (1 = all; below 1 flattens the profile, see settleWriting). */
  keep = 1,
): Record<K, LlmCriterion> {
  const keys = Object.keys(samples[0]!) as K[];
  const mean = (f: (x: Record<K, LlmCriterion>) => number) => samples.reduce((s, x) => s + f(x), 0) / samples.length;
  const means = keys.map((k) => mean((x) => x[k].band));
  const avg = means.reduce((a, b) => a + b) / keys.length;
  const goal = target(avg), x = means.map((m) => avg + keep * (m - avg) + goal - avg);
  const bands = x.map(Math.floor);
  let left = Math.round(goal * keys.length + 1e-9) - bands.reduce((a, b) => a + b);
  // Largest remainder first; on a tie the later criterion (writing LR/GRA, which the model under-scores most) goes up, or the weakest one when the profile is flattened.
  const frac = (i: number) => Math.round((x[i]! - bands[i]!) * 1e6);
  for (const i of keys.map((_, i) => i).sort((a, b) => frac(b) - frac(a) || (keep < 1 ? means[a]! - means[b]! : b - a))) if (left-- > 0) bands[i]!++; // a flattened profile lifts its weakest criterion first
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

/** Retries a call once on a retryable failure (timeout, network, 429/5xx, unreadable JSON). */
export const retryOnce = <T>(f: () => Promise<T>): Promise<T> =>
  f().catch((e: unknown) => {
    if (!(e instanceof AiError && e.retryable)) throw e;
    console.error('AI call failed, retrying once', e.code, e.status ?? '');
    return asRetry(f);
  });

/** Runs the scoring calls in parallel and returns every successful sample; failed calls are dropped, all failing throws the first error.
 *  `early`: once 2+ samples are in and it accepts them (they agree), returns at once without waiting for the slowest call (the calls still finish in the background). */
export function scoringSamples<S>(calls: (() => Promise<S>)[], early?: (ok: S[]) => boolean): Promise<S[]> {
  return new Promise((resolve, reject) => {
    const ok: S[] = [];
    let left = calls.length, first: unknown;
    if (!left) return resolve(ok);
    for (const f of calls)
      f().then(
        (v) => void (ok.push(v), ok.length >= 2 && early?.(ok) && resolve([...ok])),
        (e) => void (first ??= e),
      ).finally(() => (--left === 0 ? (ok.length ? resolve(ok) : reject(first)) : undefined));
  });
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
