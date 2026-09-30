import { computeTextMetrics, MIN_WORDS, roundBand, taskBand } from '@ielts/core';
import type { Settings } from '../settings';
import { bandDescriptor, EXAMINER_RULES, fmt, WRITING_DESCRIPTORS } from './descriptors';
import { acceptsImages, chatJson, type ContentPart } from './openrouter';
import { keepVerbatimEvidence, poolCriteria, settleRanges, withScoringSamples, WritingLlmSchema, WritingPlanLlmSchema, WritingScoreSchema } from './schemas';
import type { AnalysisResult, Criterion } from './types';

export const WRITING_REWRITE_NOTE = "Study the upgrades, don't memorise — examiners spot and penalise memorised language.";
const TOO_SHORT = 'Responses of 20 words or fewer are rated at Band 1';

/** Per-model correction of the analysis model's measured bias: the overall moves from the criterion mean m to
 *  f(m) = m + (b + s·(m − 6))·clamp(m − 3.5, 0, 1), continuous and monotonic, leaving genuine band 3-4 scripts alone; poolCriteria spreads
 *  the shift over whole criterion bands so the shown criteria still average to the overall.
 *  gpt-6-luna: fitted on the 24 Cambridge sample answers of books 15-18 (x2 runs; pooling in books 12, 13 and 19 gives the same b and s).
 *  Held out, books 12/13/19 (43 analyses, .eval/3/fix-server/final_B_all.json): MAE 0.38, bias −0.13, max 1.0, 95% within ±0.5, no run-to-run
 *  band changes (iteration 3 on the same scripts: MAE 0.53, bias −0.32, max 1.5). Still compressed: official band 5 ~0.4 high, 6.5+ ~0.3 low.
 *  ponytail: one linear map per model; re-fit with .eval/3/fix-server (run.ts, fit.py) when the model or rubric prompt changes. */
export const WRITING_CALIBRATION: Record<string, { b: number; s: number }> = { 'openai/gpt-6-luna': { b: 0.55, s: 0.1 } };

export const calibrate = (mean: number, b: number, s: number) => Math.min(9, mean + (b + s * (mean - 6)) * Math.min(1, Math.max(0, mean - 3.5)));

/** Writing: 1 full analysis + 4 scoring samples; the mean of 5 steadies single-criterion flips. */
const WRITING_EXTRA_SAMPLES = 4;

/** How the Academic Task 1 figure reaches the model. */
type Figure = 'data' | 'image' | 'none';

function system(task: 1 | 2, variant: 'academic' | 'general', figure: Figure) {
  const taskRules =
    task === 2
      ? `TASK 2 (essay, min 250 words). Criterion "ta" = Task Response.
- Identify the question type (opinion, discussion + opinion, problem/cause-solution, advantages/disadvantages, two-part question) and check EVERY part of the prompt is answered. Leaving a required part out entirely (e.g. problems discussed but no solutions at all) = "main parts incompletely addressed" (band 5 feature).
- Underdeveloped, repetitive, thinly explained or over-generalised support is a band 6 feature ("some may be insufficiently developed"), never band 5 on its own. A clear position plus extended, relevant main ideas meets band 7 even if some support is over-generalised or not fully explained.
- A clear position anywhere in the response meets band 7 ("clear and developed position"); a position that emerges only in the conclusion or is slightly inconsistent is a band 6 feature ("conclusions drawn may be unclear"), not band 5. Cap TR at 5 only when no position can be identified or the main parts of the prompt are not addressed. Ideas must be extended and supported with explanation/examples, not listed. Over-generalised support stops at 7.
- Tangential or misunderstood prompts: TR 4 or below. Memorised, generic "template" paragraphs that could fit any topic are not credited.`
      : variant === 'academic'
        ? `TASK 1 ACADEMIC (report on visual information, min 150 words). Criterion "ta" = Task Achievement. Use the (Academic) lines of the descriptor.
- A clear overview of the main trends/differences/stages is required for band 7; an attempted overview allows at most 6; no overview caps TA at 5. The overview must summarise, not repeat numbers.
- Key features must be selected and supported with accurate data. When chart data is provided, check every figure, unit, date and comparison against it; misreported data is "inaccurate information". Mechanical listing of every number without grouping = band 5 feature.
- Opinions, causes or speculation not in the visual are irrelevant content.${
            figure === 'image'
              ? '\n- The figure is attached as an image; read the data from it. Your reading of the image can be wrong: only treat a detail as inaccurate when the image clearly contradicts it. One or two doubtful details are compatible with TA 7 ("there may be a few omissions or lapses"). Do not go below TA 6 for data accuracy unless several key features are clearly wrong.'
              : figure === 'none'
                ? '\n- No figure data is available: you cannot verify data accuracy, so cap TA at 6 and give TA a range of at least 2 bands.'
                : ''
          }`
        : `TASK 1 GENERAL TRAINING (letter, min 150 words). Criterion "ta" = Task Achievement. Use the (GT) lines of the descriptor.
- All three bullet points must be covered and extended; a missing bullet caps TA at 4, a thinly covered one at 5.
- The purpose must be clear from the opening, and tone/register (formal, semi-formal, informal) must match the recipient and stay consistent, including greeting and sign-off.`;
  return `You are a senior IELTS Writing examiner and trainer of examiners. You rate against the official public band descriptors with best-fit marking, exactly as a certified examiner would. Your ratings are used for self-study: inflated or deflated scores both mislead the candidate, so accuracy beats encouragement.

${taskRules}

GENERAL RULES:
- Word count: when wordCount < minimumWords, penalise under TA/TR (the app shows the count to the candidate; never log it as an error). Numbers count as words. Words copied from the prompt are not counted as the candidate's language and earn no LR credit.
- Coherence & Cohesion: judge progression, paragraphing and referencing, not the number of linkers. Mechanical or overused linkers (e.g. Moreover/Furthermore/In addition opening every sentence; the metrics list overused linkers) are the band 5-6 CC feature. No paragraphing caps CC at 5.
- Lexical Resource: precision and collocation beat rarity. Count spelling and word-formation errors. Repetition of the same words (see metrics) limits range.
- Grammar: estimate the share of error-free sentences and the accuracy of complex structures; punctuation counts.
- BAND 5 / 6 / 7 CONTRASTS (most scripts sit here; decide each criterion with these, from the whole response, before listing errors):
  ${task === 2 ? 'TR: 5 = no identifiable position, a main part of the prompt missing, or ideas limited and listed without development / 6 = all main parts addressed and a relevant position, but some ideas under-developed, unclear or over-generalised / 7 = clear position throughout, main ideas extended and supported (some over-generalising allowed).' : variant === 'academic' ? 'TA: 5 = no clear overview, key features missed, or mechanical listing of details, or clearly wrong data in key areas / 6 = overview attempted, key features covered and supported with data, some details missing, irrelevant or inaccurate / 7 = clear overview of the main trends, key features selected, grouped and highlighted with data (could be illustrated more fully).' : 'TA: 5 = a bullet point thinly covered, purpose unclear at times, or tone inconsistent / 6 = all bullets covered adequately, purpose generally clear, minor tone slips / 7 = all bullets covered and clearly extended, clear purpose, consistent appropriate tone.'}
  CC: 5 = organisation not wholly logical, sentences not fluently linked, repetitive or faulty linking, inadequate paragraphing / 6 = clear overall progression, but linking mechanical or faulty at times, referencing unclear in places / 7 = logical organisation and clear progression throughout, a range of linkers plus reference and substitution used flexibly (some over/under use), effective paragraphing.
  LR: 5 = limited range with frequent simplification or repetition, or word errors that cause some difficulty for the reader / 6 = adequate range, meaning clear despite imprecise word choice and some spelling or word-formation slips / 7 = some less common items and collocations used with awareness of style, only occasional slips.
  GRA: 5 = limited, repetitive structures, complex sentences mostly faulty, or errors that cause some difficulty for the reader / 6 = a mix of simple and complex forms, complex ones less accurate, errors rarely impede / 7 = a variety of complex structures, error-free sentences frequent (a typical band 7 script still has 10-15 minor slips).
  Judge LR and GRA by the share of error-free sentences and the range attempted, NEVER by the raw error count. Before awarding any criterion below 7, name in its summary the band-7 feature that is missing. Before awarding 5 or below, name the band-5 feature that is present and quote it in evidence; if you cannot, the band is at least 6. Scripts do reach 7 and 8: do not settle on 5 or 6 by default.
- errors: "quote" MUST be copied character-for-character from the essay (same spelling, punctuation, capitalisation, spacing) — the minimal span of 1-8 words containing the error, long enough to be unique. "original" is the erroneous text, "correction" the fixed text. Categories task.overview / task.position / task.relevance are for task-level problems, quoting the relevant sentence.
- structure.paragraphs: one entry per paragraph of the essay in order; topicSentence is the paragraph's first sentence copied verbatim; ok = the paragraph does its job for its role; note = what to change (or why it works).
- structure.overview: ${task === 1 && variant === 'academic' ? 'required (present = an overview exists; mainTrends = it states the main trends/differences; noData = it contains no specific figures).' : 'null.'}
- structure.position: ${task === 2 ? 'required (clear = a position can be identified anywhere in the essay; consistent = never contradicted; note says where it is stated and whether stating it in the introduction would help).' : 'null.'}
- structure.planFollowed: null when no plan is given; when a plan is given it is required: whether the essay follows the plan's ideas and order.
- rewrite: the whole response rewritten one band higher, keeping the same paragraphs, ideas${task === 1 ? ' and data' : ', examples'} and register, at least the minimum word count, paragraphs separated by blank lines. If the response is off-topic or misreads the prompt (you log task.relevance), the rewrite must answer the prompt as set: keep the candidate's structure and usable language, but replace the off-topic argument with one that addresses the question asked.

${EXAMINER_RULES}

OFFICIAL WRITING BAND DESCRIPTORS (condensed, May 2023):
${task === 1 ? 'Task Achievement' : 'Task Response'} (ta):
${fmt(task === 1 ? WRITING_DESCRIPTORS.ta1 : WRITING_DESCRIPTORS.tr2)}
Coherence and Cohesion (cc):
${fmt(WRITING_DESCRIPTORS.cc)}
Lexical Resource (lr):
${fmt(WRITING_DESCRIPTORS.lr)}
Grammatical Range and Accuracy (gra):
${fmt(WRITING_DESCRIPTORS.gra)}`;
}

/** Maps each quote to a char span, searching forward from the previous match; -1 when not found. */
export function locateQuotes<T extends { quote: string }>(text: string, errors: T[]) {
  let cursor = 0;
  return errors.map(({ quote, ...e }, k) => {
    let at = quote ? text.indexOf(quote, cursor) : -1;
    if (at < 0 && quote) at = text.indexOf(quote);
    if (at >= 0) cursor = at + quote.length;
    return { ...e, id: `e${k}`, start: at, end: at < 0 ? -1 : at + quote.length };
  });
}

const withImage = (image: string | null | undefined, text: string): string | ContentPart[] =>
  image ? [{ type: 'text', text }, { type: 'image_url', image_url: { url: image } }] : text;

export async function analyzeWriting(i: {
  text: string;
  task: 1 | 2;
  variant: 'academic' | 'general';
  /** image: the figure as a URL (data: or https) when there is no chart data. */
  prompt: { title: string; body: string; bullets?: string[] | null; chart?: unknown; image?: string | null };
  plan?: string | null;
  settings: Settings;
}): Promise<AnalysisResult> {
  const textMetrics = computeTextMetrics(i.text);
  const min = i.task === 1 ? MIN_WORDS.t1 : MIN_WORDS.t2;

  if (textMetrics.words <= 20) {
    const one: Criterion = { band: 1, range: [1, 1], descriptor: TOO_SHORT, evidence: [`${textMetrics.words} words written`], summary: `Write a complete response of at least ${min} words.` };
    return {
      v: 1, skill: 'writing', part: i.task, overall: 1, overallRaw: 1, range: [1, 1],
      criteria: { ta: one, cc: one, lr: one, gra: one }, topFixes: [], errors: [], vocabUpgrades: [],
      rewrite: { text: '', note: `${TOO_SHORT}. Write at least ${min} words to be assessed.` },
      text: i.text, textMetrics, tooShort: true,
    };
  }

  const model = i.settings.models.analysis;
  const figure: Figure = i.prompt.chart ? 'data' : i.prompt.image && (await acceptsImages(model)) ? 'image' : 'none';
  const plan = i.plan?.trim() || undefined;
  const base = {
    model,
    system: system(i.task, i.variant, figure),
    temperature: 0.2,
    // ponytail: low effort cuts wall time (~37 s at default medium); the median of 3 samples buys back stability. Re-measure band agreement if the model changes.
    effort: 'low' as const,
    user: withImage(figure === 'image' ? i.prompt.image : null, JSON.stringify({
      task: i.task,
      variant: i.task === 1 ? i.variant : undefined,
      prompt: { title: i.prompt.title, body: i.prompt.body, bullets: i.prompt.bullets ?? undefined, chartData: i.prompt.chart ?? undefined },
      wordCount: textMetrics.words,
      minimumWords: min,
      metrics: {
        paragraphs: textMetrics.paragraphs,
        sentences: textMetrics.sentences,
        avgSentenceLen: Math.round(textMetrics.avgSentenceLen),
        mtld: Math.round(textMetrics.mtld),
        overusedLinkers: textMetrics.linkers.filter((l) => l.overused).map((l) => `${l.word} ×${l.count}`),
        repeatedWords: textMetrics.repeated.map((r) => `${r.word} ×${r.count}`),
      },
      plan,
      essay: i.text,
    })),
  };
  const llm = await withScoringSamples(
    () => chatJson({ ...base, schema: plan ? WritingPlanLlmSchema : WritingLlmSchema, schemaName: 'writing_analysis' }),
    () => chatJson({ ...base, schema: WritingScoreSchema, schemaName: 'writing_scores' }),
    WRITING_EXTRA_SAMPLES,
  );

  // Tangential or off-topic (TA below 4.5): no upward correction, so the "caps your score" message holds.
  const k = llm.samples.reduce((sum, x) => sum + x.ta.band, 0) / llm.samples.length < 4.5 ? undefined : WRITING_CALIBRATION[model];
  const bands = { ta: i.task === 1 ? WRITING_DESCRIPTORS.ta1 : WRITING_DESCRIPTORS.tr2, cc: WRITING_DESCRIPTORS.cc, lr: WRITING_DESCRIPTORS.lr, gra: WRITING_DESCRIPTORS.gra };
  const c = poolCriteria(llm.samples, (m) => (k ? calibrate(m, k.b, k.s) : m), (key, band) => bandDescriptor(bands[key], band));
  keepVerbatimEvidence(c, i.text);
  const raw = taskBand({ ta: c.ta.band, cc: c.cc.band, lr: c.lr.band, gra: c.gra.band });
  const range = settleRanges(c, (b) => roundBand(taskBand(b)));
  const errors = locateQuotes(i.text, llm.errors);
  // Off topic (TA ≤ 4 or a major task.relevance error): the overall is capped at TA + 1, same rule as the web's capOffTopic.
  const cap = c.ta.band <= 4 || errors.some((e) => e.category === 'task.relevance' && e.severity === 'major') ? c.ta.band + 1 : 9;
  return {
    v: 1, skill: 'writing', part: i.task, overall: Math.min(roundBand(raw), cap), overallRaw: Math.min(raw, cap),
    range: [Math.min(range[0], cap), Math.min(range[1], cap)], criteria: c, topFixes: llm.topFixes,
    errors, vocabUpgrades: llm.vocabUpgrades, rewrite: { text: llm.rewrite, note: WRITING_REWRITE_NOTE },
    text: i.text, structure: llm.structure, textMetrics,
  };
}
