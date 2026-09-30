import { computeTextMetrics, MIN_WORDS, roundBand, taskBand } from '@ielts/core';
import type { Settings } from '../settings';
import { EXAMINER_RULES, WRITING_DESCRIPTORS } from './descriptors';
import { acceptsImages, chatJson, type ContentPart } from './openrouter';
import { settleRanges, WritingLlmSchema } from './schemas';
import type { AnalysisResult, Criterion } from './types';

export const WRITING_REWRITE_NOTE = "Study the upgrades, don't memorise — examiners spot and penalise memorised language.";
const TOO_SHORT = 'Responses of 20 words or fewer are rated at Band 1';

/** How the Academic Task 1 figure reaches the model. */
type Figure = 'data' | 'image' | 'none';

function system(task: 1 | 2, variant: 'academic' | 'general', figure: Figure) {
  const taskRules =
    task === 2
      ? `TASK 2 (essay, min 250 words). Criterion "ta" = Task Response.
- Identify the question type (opinion, discussion + opinion, problem/cause-solution, advantages/disadvantages, two-part question) and check EVERY part of the prompt is answered. Answering only part of it = "main parts incompletely addressed" (band 5 feature).
- The position must be clear from the introduction and consistent through the conclusion; an unclear or contradictory position caps TR at 5. Ideas must be extended and supported with explanation/examples, not listed. Over-generalised support stops at 7.
- Tangential or misunderstood prompts: TR 4 or below. Memorised, generic "template" paragraphs that could fit any topic are not credited.`
      : variant === 'academic'
        ? `TASK 1 ACADEMIC (report on visual information, min 150 words). Criterion "ta" = Task Achievement. Use the (Academic) lines of the descriptor.
- A clear overview of the main trends/differences/stages is required for band 7; an attempted overview allows at most 6; no overview caps TA at 5. The overview must summarise, not repeat numbers.
- Key features must be selected and supported with accurate data. When chart data is provided, check every figure, unit, date and comparison against it; misreported data is "inaccurate information". Mechanical listing of every number without grouping = band 5 feature.
- Opinions, causes or speculation not in the visual are irrelevant content.${
            figure === 'image'
              ? '\n- The figure is attached as an image; read the data from it.'
              : figure === 'none'
                ? '\n- No figure data is available: you cannot verify data accuracy, so cap TA at 6 and give TA a range of at least 2 bands.'
                : ''
          }`
        : `TASK 1 GENERAL TRAINING (letter, min 150 words). Criterion "ta" = Task Achievement. Use the (GT) lines of the descriptor.
- All three bullet points must be covered and extended; a missing bullet caps TA at 4, a thinly covered one at 5.
- The purpose must be clear from the opening, and tone/register (formal, semi-formal, informal) must match the recipient and stay consistent, including greeting and sign-off.`;
  return `You are a senior IELTS Writing examiner and trainer of examiners. You rate strictly and conservatively against the official public band descriptors, exactly as a certified examiner would. Your ratings are used for self-study: inflated scores harm the candidate, so accuracy beats encouragement.

${taskRules}

GENERAL RULES:
- Word count: responses under the minimum are penalised under TA/TR (the prompt tells you the count). Words copied from the prompt are not counted as the candidate's language and earn no LR credit.
- Coherence & Cohesion: judge progression, paragraphing and referencing, not the number of linkers. Mechanical or overused linkers (e.g. Moreover/Furthermore/In addition opening every sentence; the metrics list overused linkers) are the band 5-6 CC feature. No paragraphing caps CC at 5.
- Lexical Resource: precision and collocation beat rarity. Count spelling and word-formation errors. Repetition of the same words (see metrics) limits range.
- Grammar: estimate the share of error-free sentences and the accuracy of complex structures; punctuation counts.
- errors: "quote" MUST be copied character-for-character from the essay (same spelling, punctuation, capitalisation, spacing) — the minimal span of 1-8 words containing the error, long enough to be unique. "original" is the erroneous text, "correction" the fixed text. Categories task.overview / task.position / task.relevance are for task-level problems, quoting the relevant sentence.
- structure.paragraphs: one entry per paragraph of the essay in order; topicSentence is the paragraph's first sentence copied verbatim; ok = the paragraph does its job for its role; note = what to change (or why it works).
- structure.overview: ${task === 1 && variant === 'academic' ? 'required (present = an overview exists; mainTrends = it states the main trends/differences; noData = it contains no specific figures).' : 'null.'}
- structure.position: ${task === 2 ? 'required (clear = position obvious in intro and conclusion; consistent = never contradicted).' : 'null.'}
- structure.planFollowed: null unless a plan is given; then whether the essay follows the plan's ideas and order.
- rewrite: the whole response rewritten one band higher, keeping the same paragraphs, ideas${task === 1 ? ' and data' : ', examples'} and register, at least the minimum word count, paragraphs separated by blank lines.

${EXAMINER_RULES}

OFFICIAL WRITING BAND DESCRIPTORS (condensed, May 2023):
${task === 1 ? 'Task Achievement' : 'Task Response'} (ta):
${task === 1 ? WRITING_DESCRIPTORS.ta1 : WRITING_DESCRIPTORS.tr2}
Coherence and Cohesion (cc):
${WRITING_DESCRIPTORS.cc}
Lexical Resource (lr):
${WRITING_DESCRIPTORS.lr}
Grammatical Range and Accuracy (gra):
${WRITING_DESCRIPTORS.gra}`;
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
  const llm = await chatJson({
    model,
    system: system(i.task, i.variant, figure),
    schema: WritingLlmSchema,
    schemaName: 'writing_analysis',
    temperature: 0.2,
    user: withImage(figure === 'image' ? i.prompt.image : null, JSON.stringify({
      task: i.task,
      variant: i.task === 1 ? i.variant : undefined,
      prompt: { title: i.prompt.title, body: i.prompt.body, bullets: i.prompt.bullets ?? undefined, chartData: i.prompt.chart ?? undefined },
      wordCount: textMetrics.words,
      minimumWords: min,
      underLength: textMetrics.words < min ? `UNDER LENGTH: ${textMetrics.words}/${min} words — penalise under Task ${i.task === 1 ? 'Achievement' : 'Response'}.` : undefined,
      metrics: {
        paragraphs: textMetrics.paragraphs,
        sentences: textMetrics.sentences,
        avgSentenceLen: Math.round(textMetrics.avgSentenceLen),
        mtld: Math.round(textMetrics.mtld),
        overusedLinkers: textMetrics.linkers.filter((l) => l.overused).map((l) => `${l.word} ×${l.count}`),
        repeatedWords: textMetrics.repeated.map((r) => `${r.word} ×${r.count}`),
      },
      plan: i.plan || undefined,
      essay: i.text,
    })),
  });

  const c = llm.criteria;
  const raw = taskBand({ ta: c.ta.band, cc: c.cc.band, lr: c.lr.band, gra: c.gra.band });
  const range = settleRanges(c, (b) => roundBand(taskBand(b)));
  return {
    v: 1, skill: 'writing', part: i.task, overall: roundBand(raw), overallRaw: raw, range, criteria: c, topFixes: llm.topFixes,
    errors: locateQuotes(i.text, llm.errors), vocabUpgrades: llm.vocabUpgrades, rewrite: { text: llm.rewrite, note: WRITING_REWRITE_NOTE },
    text: i.text, structure: llm.structure, textMetrics,
  };
}
