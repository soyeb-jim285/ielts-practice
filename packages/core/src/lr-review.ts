/**
 * Listening & Reading review helpers: mistake classification for gap answers, TRUE/FALSE/NOT GIVEN analysis, answer location
 * in a passage / transcript / word timings, dictation diff and the per-attempt analysis. All deterministic, no AI.
 */
import { expandAnswer, type LrGroup, type LrMark, type LrResponses, type LrTest } from './lr';

const fold = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[‘’`]/g, "'").replace(/[-–—/]/g, ' ').replace(/[.,;:!?"“”]+/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s: string) => fold(s).split(' ').filter(Boolean);

// ---------------------------------------------------------------- gap mistakes

export type GapKind = 'blank' | 'spelling' | 'plural' | 'word-limit' | 'article' | 'extra-word' | 'missing-word' | 'number-format';
export const GAP_COACH: Record<GapKind, { label: string; message: string }> = {
  blank: { label: 'Left blank', message: 'No answer given. There is no penalty for a wrong answer, so always write your best guess.' },
  spelling: { label: 'Spelling slip', message: 'You heard or found the right word but spelt it wrongly, and a misspelt answer scores nothing. Learn the correct spelling.' },
  plural: { label: 'Singular or plural', message: 'The word is right but the ending is not. Listen or look for the final -s, and check the sentence for a plural cue.' },
  'word-limit': { label: 'Over the word limit', message: 'The right words are in your answer, but there are too many of them. Keep to the word limit in the instructions.' },
  article: { label: 'Small word added or missing', message: "A small word such as 'the' or 'a' is added or missing. Copy the wording around the gap and write only what fits." },
  'extra-word': { label: 'Extra word', message: 'Your answer contains the right words plus one that is not in the key. Write only the words that fill the gap.' },
  'missing-word': { label: 'Part of the answer missing', message: 'You gave only part of the answer. Check the words before and after the gap to see how much is needed.' },
  'number-format': { label: 'Number format', message: 'Right figure, wrong format. Write numbers the way the question shows them: digits, without commas or extra symbols.' },
};

export interface GapMistake { kind: GapKind; label: string; message: string; word?: string; typed?: string }

const NUM_WORD: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
/** "NO MORE THAN TWO WORDS AND/OR A NUMBER" → 2; "ONE WORD ONLY" → 1; "ONE NUMBER" → 1; unparseable → null. */
export function wordLimitOf(limit?: string): number | null {
  if (!limit) return null;
  const m = /\b(one|two|three|four|five|[1-5])\s+(?:words?|numbers?)\b/i.exec(limit);
  if (!m) return null;
  const k = m[1]!.toLowerCase();
  return NUM_WORD[k] ?? +k;
}

const ARTICLES = new Set(['a', 'an', 'the']);
const SMALL_NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const sig = (s: string) => s.replace(/[^a-z0-9]/g, '');
const asDigits = (s: string) => (SMALL_NUM.includes(s) ? String(SMALL_NUM.indexOf(s)) : s);

/** Damerau-Levenshtein (adjacent transposition counts 1). */
export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  return d[a.length]![b.length]!;
}

/** Doubled letters collapsed and ei/ie unified: the classic misspelling patterns (accomodation, recieve) compare equal. */
const squash = (w: string) => w.replace(/(.)\1+/g, '$1').replace(/ei/g, 'ie');
/** A near miss: tolerance grows with length (4–7 letters: 1 edit, 8+: 2), or a classic doubling / ie-ei pattern from 6 letters. */
export function isSpellingSlip(typed: string, key: string): boolean {
  if (typed === key || key.length < 4 || /\d/.test(key)) return false;
  const d = editDistance(typed, key);
  if (d <= (key.length >= 8 ? 2 : 1)) return true;
  return key.length >= 6 && d <= 2 && squash(typed) === squash(key);
}

const isPlural = (a: string, b: string) => a === b + 's' || a === b + 'es' || (b.endsWith('y') && a === b.slice(0, -1) + 'ies') || b === a + 's' || b === a + 'es' || (a.endsWith('y') && b === a.slice(0, -1) + 'ies');
const runAt = (hay: string[], needle: string[]) => (needle.length ? hay.findIndex((_, i) => needle.every((w, k) => hay[i + k] === w)) : -1);

/**
 * Why a gap answer was marked wrong, when a deterministic reason exists (else null: simply a different answer).
 * `wordLimit` is the group's instruction ("NO MORE THAN TWO WORDS AND/OR A NUMBER").
 */
export function classifyGap(given: string, accepted: string[], wordLimit?: string): GapMistake | null {
  const mk = (kind: GapKind, extra?: { word?: string; typed?: string }): GapMistake => ({ kind, ...GAP_COACH[kind], ...extra });
  if (!given?.trim()) return mk('blank');
  const g = words(given);
  const variants = [...new Set(accepted.flatMap(expandAnswer))].filter(Boolean).map((v) => v.split(' '));
  if (!g.length || !variants.length) return null;
  const gs = g.join(' ');

  // number format: same digits, different punctuation / words
  for (const v of variants) {
    const vs = v.join(' ');
    if (/\d/.test(vs) && sig(gs) === sig(vs) && gs !== vs) return mk('number-format');
    if (g.length === 1 && v.length === 1 && asDigits(g[0]!) === asDigits(v[0]!) && g[0] !== v[0]) return mk('number-format');
  }

  // right words, too many: over the limit
  const limit = wordLimitOf(wordLimit);
  const raw = given.trim().split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t));
  const counted = /number/i.test(wordLimit ?? '') ? raw.filter((t) => !/^[\d£$€%.,:]+$/.test(t)) : raw;
  if (limit && counted.length > limit && variants.some((v) => runAt(g, v) >= 0)) return mk('word-limit');

  // a key with / without small words or extra words
  for (const v of variants) {
    const at = runAt(g, v);
    if (v.length < g.length && at >= 0) return mk([...g.slice(0, at), ...g.slice(at + v.length)].every((w) => ARTICLES.has(w)) ? 'article' : 'extra-word');
    const bt = runAt(v, g);
    if (g.length < v.length && bt >= 0) return mk([...v.slice(0, bt), ...v.slice(bt + g.length)].every((w) => ARTICLES.has(w)) ? 'article' : 'missing-word');
  }

  // same shape, one word off: plural, then spelling
  for (const v of variants) {
    if (v.length !== g.length) continue;
    const diff = g.map((w, i) => [w, v[i]!] as const).filter(([w, k]) => w !== k);
    if (diff.length === 1) {
      const [typed, word] = diff[0]!;
      if (isPlural(typed, word)) return mk('plural', { word, typed });
    }
  }
  for (const v of variants) {
    if (sig(gs) === sig(v.join(' ')) && !/\d/.test(gs)) return mk('spelling', { word: v.join(' '), typed: gs }); // check-in vs checkin
    if (v.length !== g.length) continue;
    const diff = g.map((w, i) => [w, v[i]!] as const).filter(([w, k]) => w !== k);
    if (diff.length && diff.every(([w, k]) => isSpellingSlip(w, k))) return mk('spelling', { word: diff[0]![1], typed: diff[0]![0] });
  }
  return null;
}

/** "accommodation" → "acco_____tion": keeps a third of the letters (max 4) at each end. */
export function maskWord(w: string): string {
  const k = Math.min(4, Math.floor(w.length / 3));
  return w.length < 4 ? w : w.slice(0, k) + '_'.repeat(w.length - 2 * k) + w.slice(w.length - k);
}

// ---------------------------------------------------------------- TRUE / FALSE / NOT GIVEN

const TF: Record<string, string> = { t: 'TRUE', true: 'TRUE', f: 'FALSE', false: 'FALSE', ng: 'NOT GIVEN', 'not given': 'NOT GIVEN', y: 'YES', yes: 'YES', n: 'NO', no: 'NO' };
export const tfngValue = (given: string) => TF[fold(given ?? '')] ?? '';

export interface TfngRow { n: number; kind: 'tfng' | 'ynng'; chose: string; answer: string }
export const TFNG_RULES: Record<'tfng' | 'ynng', { value: string; rule: string }[]> = {
  tfng: [
    { value: 'TRUE', rule: 'The passage says the same thing, usually in different words. Look for a paraphrase, not matching words.' },
    { value: 'FALSE', rule: 'The passage says the opposite. You can point to a sentence that contradicts the statement.' },
    { value: 'NOT GIVEN', rule: 'The passage never settles it. If no sentence confirms or contradicts the statement, it is NOT GIVEN, whatever you know yourself.' },
  ],
  ynng: [
    { value: 'YES', rule: "The statement agrees with the writer's view or claim. Check it is the writer's opinion, not a fact or someone else's view." },
    { value: 'NO', rule: "The statement contradicts the writer's view or claim. You can point to the sentence that says the opposite." },
    { value: 'NOT GIVEN', rule: "The writer expresses no view on it. If the passage neither agrees nor disagrees, it is NOT GIVEN." },
  ],
};

/** Answered TRUE/FALSE/NOT GIVEN and YES/NO/NOT GIVEN questions of an attempt (blanks are skipped). */
export function tfngRows(test: LrTest, marks: LrMark[]): TfngRow[] {
  const by = new Map(marks.map((m) => [m.n, m]));
  return test.sections.flatMap((s) => s.groups.filter((g) => g.type === 'tfng' || g.type === 'ynng').flatMap((g) =>
    g.questions.flatMap((q) => {
      const m = by.get(q.n);
      const chose = tfngValue(m?.given ?? '');
      const answer = tfngValue(m?.answer[0] ?? '');
      return m && chose && answer ? [{ n: q.n, kind: g.type as 'tfng' | 'ynng', chose, answer }] : [];
    }),
  ));
}

export interface TfngPattern { answer: string; chose: string; count: number; of: number; pct: number; kind: 'tfng' | 'ynng'; text: string }
/** Your most repeated confusion: "You turn NOT GIVEN into FALSE 60% of the time". Needs ≥3 questions with that answer and ≥40% going the same wrong way. */
export function tfngPattern(rows: { kind: 'tfng' | 'ynng'; chose: string; answer: string }[]): TfngPattern | null {
  let best: TfngPattern | null = null;
  const keys = new Set(rows.map((r) => `${r.kind}|${r.answer}`));
  for (const key of keys) {
    const [kind, answer] = key.split('|') as ['tfng' | 'ynng', string];
    const of = rows.filter((r) => r.kind === kind && r.answer === answer);
    if (of.length < 3) continue;
    for (const chose of new Set(of.filter((r) => r.chose !== answer).map((r) => r.chose))) {
      const count = of.filter((r) => r.chose === chose).length;
      const pct = Math.round((count / of.length) * 100);
      if (pct >= 40 && (!best || count / of.length > best.count / best.of)) best = { answer, chose, count, of: of.length, pct, kind, text: `You turn ${answer} into ${chose} ${pct}% of the time (${count} of ${of.length}).` };
    }
  }
  return best;
}

// ---------------------------------------------------------------- answer location

/** The parts of a question the locators read. */
export interface ReviewLike { answer?: string[]; review?: { evidence?: string; at?: number } }
export interface TextSpan { p: number; s: number; e: number }

/** Letters/digits lower-cased, everything else one space, with each kept char's index in the raw text. */
function normMap(text: string) {
  let out = '';
  const idx: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = fold(text[i]!.replace(/\s/, ' ') || ' ');
    for (const c of ch.length ? ch : ' ') {
      if (/[a-z0-9]/.test(c)) { out += c; idx.push(i); } else if (out && !out.endsWith(' ')) { out += ' '; idx.push(i); }
    }
  }
  return { out, idx };
}

function exactSpan(paras: string[], phrase: string): TextSpan | null {
  const needle = fold(phrase).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!needle) return null;
  for (let p = 0; p < paras.length; p++) {
    const { out, idx } = normMap(paras[p]!);
    const at = out.indexOf(needle);
    if (at >= 0) return { p, s: idx[at]!, e: idx[at + needle.length - 1]! + 1 };
  }
  return null;
}

/** Sentence (in the raw paragraph) around [s,e). */
function sentenceAround(text: string, s: number, e: number): [number, number] {
  let a = s;
  while (a > 0 && !(/[.!?]["”’']?\s$/.test(text.slice(Math.max(0, a - 3), a)) || text[a - 1] === '\n')) a--;
  let b = e;
  while (b < text.length && !/[.!?]/.test(text[b - 1] ?? '') ) b++;
  while (b < text.length && /["”’']/.test(text[b]!)) b++;
  return [a, Math.min(b, text.length)];
}

function bestSentence(paras: string[], phrase: string): TextSpan | null {
  const want = new Set(words(phrase));
  if (want.size < 3) return null;
  let best: (TextSpan & { score: number }) | null = null;
  paras.forEach((t, p) => {
    const sents = [...t.matchAll(/[^.!?\n]+[.!?]*["”’']?/g)];
    // runs of 1–3 sentences: evidence often spans two
    for (let i = 0; i < sents.length; i++)
      for (let n = 1; n <= 3 && i + n <= sents.length; n++) {
        const run = sents.slice(i, i + n);
        const have = new Set(words(run.map((m) => m[0]).join(' ')));
        const score = [...want].filter((w) => have.has(w)).length / want.size - (n - 1) * 0.01;
        if (score > (best?.score ?? 0)) best = { p, s: run[0]!.index!, e: run.at(-1)!.index! + run.at(-1)![0].length, score };
      }
  });
  const b = best as (TextSpan & { score: number }) | null;
  return b && b.score >= 0.6 ? { p: b.p, s: b.s, e: b.e } : null;
}

/** Where a gap answer sits: the sentence of the paragraph containing the longest accepted variant as whole words. */
export function answerSentence(paras: string[], accepted: string[]): TextSpan | null {
  const variants = [...new Set(accepted.flatMap(expandAnswer))].filter((v) => v.length >= 3).sort((a, b) => b.length - a.length);
  for (const v of variants) {
    for (let p = 0; p < paras.length; p++) {
      const { out, idx } = normMap(paras[p]!);
      const m = new RegExp(`(^| )${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).exec(out);
      if (!m) continue;
      const s = idx[m.index + m[1]!.length]!, e = idx[m.index + m[1]!.length + v.length - 1]! + 1;
      const [a, b] = sentenceAround(paras[p]!, s, e);
      return { p, s: a, e: b };
    }
  }
  return null;
}

/**
 * The text to highlight for a question: `review.evidence` when it can be found (verbatim, then its fragments split at "…", then the
 * closest sentence), else for gap questions the sentence containing the accepted answer.
 */
export function evidenceSpan(paras: string[], q: ReviewLike, gap: boolean): TextSpan | null {
  const ev = q.review?.evidence?.trim();
  if (ev) {
    const whole = exactSpan(paras, ev);
    if (whole) return whole;
    const parts = ev.split(/\.{3}|…/).map((x) => x.trim()).filter((x) => words(x).length >= 3);
    const found = parts.map((x) => exactSpan(paras, x)).filter((x): x is TextSpan => !!x);
    if (found.length && found.every((f) => f.p === found[0]!.p)) return { p: found[0]!.p, s: Math.min(...found.map((f) => f.s)), e: Math.max(...found.map((f) => f.e)) };
    const near = bestSentence(paras, ev);
    if (near) return near;
  }
  return gap ? answerSentence(paras, q.answer ?? []) : null;
}

/** The paragraphs of a section's reading passage, or the transcript's lines for listening. */
export const sectionParagraphs = (s: { passage?: { paragraphs: { text: string }[] }; transcript?: string }): string[] => (s.passage ? s.passage.paragraphs.map((p) => p.text) : (s.transcript ?? '').split('\n'));

// ---------------------------------------------------------------- listening: word timings

/** Word timings as the API sends them: [word, start, end] rows (typed loosely because the OpenAPI tuple is). */
export type TimingRows = readonly (readonly (string | number)[])[];
interface Tok { w: string; s: number; e: number }
const tokens = (t: TimingRows): Tok[] => t.flatMap(([w, s, e]) => words(String(w)).map((x) => ({ w: x, s: Number(s), e: Number(e) })));

/** Finds a phrase in the word timings (normalised token alignment): exact run first, else the best window with ≥60% of its words. */
export function locatePhrase(timings: TimingRows | undefined, phrase: string): { start: number; end: number } | null {
  if (!timings?.length) return null;
  const T = tokens(timings);
  const P = words(phrase);
  if (!P.length || P.length > T.length) return null;
  for (let i = 0; i + P.length <= T.length; i++) if (P.every((w, k) => T[i + k]!.w === w)) return { start: T[i]!.s, end: T[i + P.length - 1]!.e };
  if (P.length < 4) return null;
  const want = new Map<string, number>();
  P.forEach((w) => want.set(w, (want.get(w) ?? 0) + 1));
  const score = (from: number) => {
    const left = new Map(want);
    let hit = 0;
    for (let i = from; i < from + P.length; i++) if ((left.get(T[i]!.w) ?? 0) > 0) { left.set(T[i]!.w, left.get(T[i]!.w)! - 1); hit++; }
    return hit;
  };
  // ponytail: O(n·m) window scan (n ≈ 5k words, m ≈ 30); fine per click
  let at = -1, top = 0;
  for (let i = 0; i + P.length <= T.length; i++) {
    const s = score(i);
    if (s > top) { top = s; at = i; }
  }
  if (at < 0 || top / P.length < 0.6) return null;
  const set = new Set(P);
  let a = at, b = at + P.length - 1;
  while (a < b && !set.has(T[a]!.w)) a++;
  while (b > a && !set.has(T[b]!.w)) b--;
  return { start: T[a]!.s, end: T[b]!.e };
}

/** Seconds to play for a question: evidence, else the accepted answer, else `review.at` (6 s). `from` starts 2 s early; start/end are the phrase itself. */
export function audioWindow(section: { timings?: TimingRows }, q: ReviewLike): { from: number; to: number; start: number; end: number; exact: boolean } | null {
  const ev = q.review?.evidence;
  const hit = (ev && locatePhrase(section.timings, ev))
    || [...new Set((q.answer ?? []).flatMap(expandAnswer))].filter((v) => v.length >= 3).sort((a, b) => b.length - a.length).map((v) => locatePhrase(section.timings, v)).find(Boolean);
  if (hit) return { from: Math.max(0, hit.start - 2), to: hit.end + 0.5, start: hit.start, end: hit.end, exact: true };
  const at = q.review?.at;
  return at != null ? { from: Math.max(0, at - 2), to: at + 6, start: at, end: at + 6, exact: false } : null;
}

export interface QuestionMoment { n: number; /** the answer is heard here (s) */ at: number; /** playback start, 2 s of pre-roll */ from: number; to: number; /** false: only `review.at`, a rough position */ exact: boolean }
/** Where each question of a listening part is answered in the recording, in time order. Questions with no locatable moment are left out. */
export function questionMoments(section: { timings?: TimingRows; groups: { questions: (ReviewLike & { n: number })[] }[] }): QuestionMoment[] {
  return section.groups.flatMap((g) => g.questions.flatMap((q) => {
    const w = audioWindow(section, q);
    return w ? [{ n: q.n, at: w.start, from: w.from, to: w.to, exact: w.exact }] : [];
  })).sort((a, b) => a.at - b.at || a.n - b.n);
}

/** The recording's words between two instants, as spoken (for the dictation drill). */
export const wordsBetween = (t: TimingRows | undefined, from: number, to: number): string => (t ?? []).filter(([, s, e]) => Number(s) >= from - 0.01 && Number(e) <= to + 0.01).map(([w]) => w).join(' ');

// ---------------------------------------------------------------- dictation

export interface DictOp { word: string; typed?: string; status: 'correct' | 'missing' | 'wrong' | 'extra' }
/** Word-by-word comparison (LCS on normalised words). Unmatched stretches pair up as "wrong", leftovers are missing / extra. */
export function dictationDiff(typed: string, expected: string): DictOp[] {
  const E = expected.split(/\s+/).filter(Boolean);
  const T = typed.split(/\s+/).filter(Boolean);
  const en = E.map(fold), tn = T.map(fold);
  const L = Array.from({ length: E.length + 1 }, () => Array<number>(T.length + 1).fill(0));
  for (let i = E.length - 1; i >= 0; i--) for (let j = T.length - 1; j >= 0; j--) L[i]![j] = en[i] === tn[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const out: DictOp[] = [];
  let i = 0, j = 0;
  const gap = (ei: number, tj: number) => {
    const es = E.slice(i, ei), ts = T.slice(j, tj);
    es.forEach((w, k) => out.push(ts[k] != null ? { word: w, typed: ts[k], status: 'wrong' } : { word: w, status: 'missing' }));
    ts.slice(es.length).forEach((w) => out.push({ word: '', typed: w, status: 'extra' }));
  };
  while (i < E.length && j < T.length) {
    if (en[i] === tn[j]) { out.push({ word: E[i]!, typed: T[j]!, status: 'correct' }); i++; j++; continue; }
    // next matched pair along the LCS
    let ni = i, nj = j;
    while (ni < E.length && nj < T.length && en[ni] !== tn[nj]) {
      if (L[ni + 1]![nj]! >= L[ni]![nj + 1]!) ni++; else nj++;
    }
    if (ni >= E.length || nj >= T.length) break;
    gap(ni, nj);
    i = ni; j = nj;
  }
  gap(E.length, T.length);
  return out;
}

export const dictationScore = (ops: DictOp[]) => {
  const total = ops.filter((o) => o.status !== 'extra').length;
  return { right: ops.filter((o) => o.status === 'correct').length, total };
};

// ---------------------------------------------------------------- per-attempt analysis

/** The label a question type is reported under (results, progress). */
export function lrTypeLabel(g: Pick<LrGroup, 'type' | 'title' | 'instructions'> & { image?: unknown; options?: unknown }): string {
  switch (g.type) {
    case 'tfng': return 'True / False / Not Given';
    case 'ynng': return 'Yes / No / Not Given';
    case 'mcq': return 'Multiple choice';
    case 'mcq-multi': return 'Multiple choice (more than one)';
    case 'match': {
      if (g.image) return 'Labelling a map or diagram';
      return Array.isArray(g.options) && g.options.some((o: { key?: string }) => /^[ivx]+$/i.test(o.key ?? '')) ? 'Matching headings' : 'Matching';
    }
    case 'gap': {
      if (g.image) return 'Labelling a map or diagram';
      if (g.options) return 'Summary with a word box';
      const t = `${g.title ?? ''} ${g.instructions}`.toLowerCase();
      if (/table/.test(t)) return 'Table completion';
      if (/flow/.test(t)) return 'Flow-chart completion';
      if (/summary/.test(t)) return 'Summary completion';
      if (/form/.test(t)) return 'Form completion';
      if (/notes/.test(t)) return 'Note completion';
      if (/sentence/.test(t)) return 'Sentence completion';
      return 'Completion';
    }
  }
}

export interface GapEntry extends GapMistake { n: number; before?: number }
export interface LrAnalysis {
  /** wrong gap answers with a deterministic reason */
  gaps: GapEntry[];
  tfng: TfngRow[];
  byType: { label: string; right: number; total: number }[];
}

/** Classifies a submitted attempt. `before(word)` = how often the user misspelt that word in earlier attempts. */
export function analyseAttempt(test: LrTest, marks: LrMark[], responses: LrResponses, before: (word: string) => number = () => 0): LrAnalysis {
  const by = new Map(marks.map((m) => [m.n, m]));
  const gaps: GapEntry[] = [];
  const types = new Map<string, { right: number; total: number }>();
  for (const s of test.sections) for (const g of s.groups) {
    const label = lrTypeLabel(g);
    for (const q of g.questions) {
      const m = by.get(q.n);
      const t = types.get(label) ?? { right: 0, total: 0 };
      t.total++;
      if (m?.correct) t.right++;
      types.set(label, t);
      if (g.type !== 'gap' || g.options || !m || m.correct) continue;
      const c = classifyGap(responses[q.n] ?? m.given, q.answer ?? [], g.wordLimit);
      if (!c) continue;
      // keep the key's own capitalisation (proper nouns) for the word shown and put on a card
      const cased = c.word ? (q.answer ?? []).flatMap((a) => a.replace(/[()]/g, ' ').split(/\s+/)).map((t) => t.replace(/[^\p{L}\p{N}'-]/gu, '')).find((t) => fold(t) === c.word) : undefined;
      const word = cased ?? c.word;
      gaps.push({ n: q.n, ...c, ...(word ? { word } : {}), ...(c.kind === 'spelling' || c.kind === 'plural' ? { before: before(word!) } : {}) });
    }
  }
  return { gaps, tfng: tfngRows(test, marks), byType: [...types].map(([label, v]) => ({ label, ...v })) };
}

/** What the runner measured (stored with the attempt): seconds per part, answer changes per question, questions answered in the last 5 minutes. */
export interface LrStats { partS: Record<string, number>; changes: Record<string, number>; late: number[] }
