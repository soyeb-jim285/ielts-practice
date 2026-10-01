import { COMMON_WORDS } from './common-words';
import { LINKERS } from './constants';
import type { RepeatedWord, TextMetrics } from './types';

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

// Small irregular map (key = the stem its forms group under).
const IRREGULAR: Record<string, string> = { better: 'good', best: 'good', children: 'child', people: 'person', women: 'woman', went: 'go', gone: 'go' };
const VOWEL = /[aeiouy]/;

/**
 * Conservative English stemmer used only to GROUP word forms (the key is not always a real word: use/uses/used/using all
 * key to "us"). Rules: possessive 's; plural -ies→y, -es after s/x/z/ch/sh, -s (5+ letters, never -ss/-us/-is);
 * -ied→y, -ed, -ing (5+ letters, stem must keep a vowel; doubled final consonant undone except l/s/z/f/d: running→run,
 * but falling→fall); then a trailing -e is dropped so e-words meet their suffixed forms (change/changing/changed).
 * Words of 1-2 letters are untouched, so "is"/"as" never merge; "news" stays apart from "new".
 * ponytail: heuristic, no irregular verbs beyond IRREGULAR; "hope"/"hopping" can false-merge. Swap in a real lemmatiser if that bites.
 */
export function stem(word: string): string {
  let w = word.replace(/'s$/, '');
  const irr = IRREGULAR[w];
  if (irr) return irr;
  if (w.length < 3) return w;
  if (/(ies|ied)$/.test(w) && w.length >= 5) w = w.slice(0, -3) + 'y';
  else if (/(s|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length >= 5 && /s$/.test(w) && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  const strip = (n: number) => {
    const base = w.slice(0, -n);
    if (!VOWEL.test(base)) return;
    w = /([^aeiouyldszf])\1$/.test(base) ? base.slice(0, -1) : base;
  };
  if (w.length >= 5 && w.endsWith('ing')) strip(3);
  else if (w.endsWith('ed') && (w.length >= 5 || (w.length === 4 && !w.endsWith('eed')))) strip(2);
  return w.length >= 3 && w.endsWith('e') ? w.slice(0, -1) : w;
}

/**
 * Content words (length > 3, not stoplisted; 3-letter forms join an existing group) whose forms together are used at least
 * max(3, ceil(2% of all words)) times: 3 for answers up to 150 words, 7 for a 350-word essay. Forms are grouped by stem
 * (work/works/working/worked); `word` is the most frequent surface form. Most frequent first, max 10.
 */
export function repeatedWords(tokens: string[]): { word: string; count: number; forms: string[] }[] {
  const groups = new Map<string, Map<string, number>>();
  const add = (t: string, join: boolean) => {
    const surface = t.replace(/'s$/, ''), key = stem(t);
    let g = groups.get(key);
    if (!g && join) return;
    if (!g) groups.set(key, (g = new Map()));
    g.set(surface, (g.get(surface) ?? 0) + 1);
  };
  for (const t of tokens) if (t.length > 3 && !STOP.has(t)) add(t, false);
  for (const t of tokens) if (t.length === 3) add(t, true);
  const min = Math.max(3, Math.ceil(tokens.length * 0.02));
  return [...groups.values()]
    .map((g) => {
      const forms = [...g].sort((a, b) => b[1] - a[1]);
      return { word: forms[0]![0], count: forms.reduce((n, f) => n + f[1], 0), forms: forms.map((f) => f[0]) };
    })
    .filter((r) => r.count >= min)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

/** Grader-prompt label: "work ×6 (work, works, working)"; the forms are listed only when there are several. */
export const repeatedLabel = (r: RepeatedWord) => `${r.word} ×${r.count}${r.forms && r.forms.length > 1 ? ` (${r.forms.join(', ')})` : ''}`;

/** Does this transcript/essay word (any case, punctuation, possessive) belong to the repeated word? Used to highlight every use. */
export const formMatcher = (r: { word: string; forms?: string[] }) => {
  const forms = new Set(r.forms ?? [r.word]);
  return (w: string) => forms.has((tokenize(w)[0] ?? '').replace(/'s$/, ''));
};

let common: Set<string> | undefined;
/** Spec §5.2 `lexical`: MTLD, type-token ratio, % of words outside the 5,000 most common forms (contractions excluded), overused words. */
export function lexicalProfile(tokens: string[]) {
  common ??= new Set(COMMON_WORDS.split(' '));
  const plain = tokens.filter(t => !t.includes("'"));
  return {
    mtld: Math.round(mtld(tokens) * 10) / 10,
    ttr: tokens.length ? Math.round((new Set(tokens).size / tokens.length) * 100) / 100 : 0,
    lessCommonPct: plain.length ? Math.round((plain.filter(t => !common!.has(t)).length / plain.length) * 1000) / 10 : 0,
    overused: repeatedWords(tokens),
  };
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
  const repeated = repeatedWords(tokens);
  return {
    words, sentences, paragraphs,
    avgSentenceLen: sentences ? words / sentences : 0,
    mtld: mtld(tokens),
    ttr: tokens.length ? new Set(tokens).size / tokens.length : 0,
    linkers, linkerOpeningRatio, repeated,
  };
}

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const wordTokens = (text: string) => text.split(/\s+/).map(norm).filter(Boolean);

/** Shortest shared run that counts as copied rubric: ordinary topic vocabulary ("the use of mobile phones in schools") repeats the prompt in runs of 4-7 words. */
export const COPY_RUN = 8;
/** Words of `text` inside a word COPY_RUN-gram that also occurs in `prompt` ("any copied rubric must be discounted", IELTS band descriptors). */
export function promptOverlap(text: string, prompt: string): number {
  const p = wordTokens(prompt), t = wordTokens(text), gram = (a: string[], i: number) => a.slice(i, i + COPY_RUN).join(' ');
  const grams = new Set(p.slice(0, Math.max(0, p.length - COPY_RUN + 1)).map((_, i) => gram(p, i)));
  const copied = new Set<number>();
  for (let i = 0; i + COPY_RUN <= t.length; i++) if (grams.has(gram(t, i))) for (let k = i; k < i + COPY_RUN; k++) copied.add(k);
  return copied.size;
}

// ponytail: fixed regex and function-word list (scoring-research §2.1 step 0); a template/memorised-text detector needs a corpus (out of scope).
const INJECTION = /\b(ignore (all|any|the|previous|prior|above)\b|as an ai\b|(dear|to the) (grader|examiner|marker|ai)\b|award (me |this )?(a )?band|give (this|me|it) (a )?(band|score)|system prompt|you are (an?|the) (ai|examiner|grader))/i;
const FUNCTION_WORDS = new Set(('the a an and or but of to in on at for with by from as is are was were be been it this that these those there their they ' +
  'i you he she we my our your his her its not no do does did have has had can will would should could which who what so if than then more').split(' '));

export type TextFlag = 'injection' | 'language' | 'copied';
/** Deterministic pre-check flags (lower confidence, wider range): text addressed to the grader, little English, or 10%+ of words copied from the prompt. */
export function textFlags(text: string, prompt = ''): TextFlag[] {
  const t = wordTokens(text), flags: TextFlag[] = [];
  if (INJECTION.test(text)) flags.push('injection');
  if (t.length && t.filter((w) => FUNCTION_WORDS.has(w)).length / t.length < 0.2) flags.push('language');
  if (prompt && promptOverlap(text, prompt) * 10 >= t.length) flags.push('copied');
  return flags;
}
