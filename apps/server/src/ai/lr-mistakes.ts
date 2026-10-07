// Model reasons for wrong Listening / Reading gap answers that no rule in core classifyGap explains (core residualGaps):
// same meaning in other words, a mishearing, or a different detail. One Jev call per answer, in parallel, at submit.
import type { AiGapKind, ResidualGap } from '@ielts/core';
import { keyCtx } from './keyctx';
import { decideChoice } from './openrouter';

const CRITERIA: Record<AiGapKind, string> = {
  synonym: 'Means the same thing as the correct answer, but in different words',
  misheard: 'Sounds like the correct answer (or part of it) but is a different word: a mishearing',
  other: 'A different piece of information: it neither means the same as the correct answer nor sounds like it',
};
/** Below this confidence the reason stays the neutral "Different detail" (probe: wrong labels came back at 0.04–0.63). */
const MIN_CONFIDENCE = 0.65;
const MAX_ITEMS = 15;

/** Never throws and never takes longer than `budgetMs`: a reason it cannot get in time is simply left out (shown as "Different detail"). */
export async function aiGapReasons(items: ResidualGap[], userId: string, budgetMs = 4000): Promise<Map<number, AiGapKind>> {
  const out = new Map<number, AiGapKind>();
  if (!items.length) return out;
  const ask = (x: ResidualGap) => {
    const criteria = x.skill === 'listening' ? CRITERIA : { synonym: CRITERIA.synonym, other: CRITERIA.other };
    return decideChoice({
      state: { test: `IELTS ${x.skill}`, candidate_answer: x.given, correct_answer: x.answer.join(' / '), ...(x.evidence && { source_sentence: x.evidence }) },
      instructions: 'The candidate answer to an IELTS gap-fill question was marked wrong. Compare it with the correct answer.',
      criteria,
      timeoutMs: budgetMs,
      cost: { stage: 'lr_mistake', meta: { n: x.n } },
    }).then((r) => void (r.confidence >= MIN_CONFIDENCE && out.set(x.n, r.choice as AiGapKind)));
  };
  const all = keyCtx.run({ cost: { userId, skill: items[0]!.skill } }, () => Promise.allSettled(items.slice(0, MAX_ITEMS).map(ask)));
  await Promise.race([all, new Promise((r) => setTimeout(r, budgetMs))]);
  return new Map(out); // a copy: calls that finish after the budget must not change the result
}
