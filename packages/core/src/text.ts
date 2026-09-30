import { LINKERS } from './constants';
import type { TextMetrics } from './types';

// ponytail: fixed stoplist of common function words (length > 3) for the "repeated words" check
const STOP = new Set(
  ('that this with have from they their there them then than these those were been being will would could should what when where ' +
    'which while about after before because also some such more most many much very only just into over other each both same does ' +
    'doing done your yours make made like well even here itself ours whom upon among within without again further once').split(' '),
);

export const tokenize = (text: string): string[] => text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];

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
  const tokens = tokenize(text), words = tokens.length;
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
  // Overuse = mechanical sentence-initial linking (the band 5-6 CC feature): one linker opening 3+ sentences,
  // or linkers opening over 40% of sentences. Mid-sentence "however"/"for example" is normal cohesion.
  const templated = sentences >= 5 && counted.reduce((n, l) => n + l.opens, 0) / sentences > 0.4;
  const linkers = counted.map(({ word, count, opens }) => ({ word, count, overused: opens >= 3 || (templated && opens > 0) }));
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
    ttr: words ? new Set(tokens).size / words : 0,
    linkers, repeated,
  };
}
