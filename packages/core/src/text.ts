import { LINKERS } from './constants';
import type { TextMetrics } from './types';

// ponytail: fixed stoplist of common function words (length > 3) for the "repeated words" check
const STOP = new Set(
  ('that this with have from they their there them then than these those were been being will would could should what when where ' +
    'which while about after before because also some such more most many much very only just into over other each both same does ' +
    'doing done your yours make made like well even here itself ours whom upon among within without again further once').split(' '),
);

export const tokenize = (text: string): string[] => text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];

/** IELTS word count: whitespace tokens holding a letter or digit, so numbers, "75%" and "$20" count (tokenize() drops them). */
export const countWords = (text: string): number => text.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;

function mtldPass(tokens: string[], threshold: number): number {
  let factors = 0, types = new Set<string>(), count = 0, ttr = 1;
  for (const t of tokens) {
    types.add(t);
    count++;
    ttr = types.size / count;
    if (ttr <= threshold) { factors++; types = new Set(); count = 0; ttr = 1; }
  }
  if (count > 0) factors += (1 - ttr) / (1 - threshold);
  return factors === 0 ? tokens.length : tokens.length / factors; // never dropped below threshold → whole text is one factor-length
}

/** MTLD (McCarthy & Jarvis 2010): mean of forward and backward passes. */
export function mtld(tokens: string[], threshold = 0.72): number {
  if (!tokens.length) return 0;
  return (mtldPass(tokens, threshold) + mtldPass([...tokens].reverse(), threshold)) / 2;
}

export function computeTextMetrics(text: string): TextMetrics {
  const tokens = tokenize(text), words = countWords(text);
  const sentenceList = (text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? []).map(s => s.trim().toLowerCase()).filter(Boolean);
  const sentences = sentenceList.length;
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim()).length;
  const lower = text.toLowerCase();
  // "in addition to" is a preposition, not a linker.
  const re = (word: string) => `\\b${word}\\b${word === 'in addition' ? '(?!\\s+to\\b)' : ''}`;
  const counted = LINKERS.map(word => ({
    word,
    count: lower.match(new RegExp(re(word), 'g'))?.length ?? 0,
    opens: sentenceList.filter(s => new RegExp(`^${re(word)}`).test(s)).length,
  })).filter(l => l.count > 0);
  // Overuse = one linker opening 3+ sentences (the band 5-6 CC feature). Many different linkers each opening once is
  // reported separately as linkerOpeningRatio, not as per-word overuse. Mid-sentence "however"/"for example" is normal cohesion.
  const linkers = counted.map(({ word, count, opens }) => ({ word, count, overused: opens >= 3 }));
  const linkerOpeningRatio = sentences ? counted.reduce((n, l) => n + l.opens, 0) / sentences : 0;
  const freq = new Map<string, number>();
  for (const t of tokens) if (t.length > 3 && !STOP.has(t)) freq.set(t, (freq.get(t) ?? 0) + 1);
  const repeated = [...freq]
    .filter(([, c]) => c >= 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word, count]) => ({ word, count }));
  return {
    words, sentences, paragraphs,
    avgSentenceLen: sentences ? words / sentences : 0,
    mtld: mtld(tokens),
    ttr: tokens.length ? new Set(tokens).size / tokens.length : 0,
    linkers, linkerOpeningRatio, repeated,
  };
}
