/**
 * Listening & Reading tests: shared shape, answer matching and band conversion.
 * Scoring is objective (answer keys), so no AI call is involved.
 */
import { roundBand } from './band';

export type LrSkill = 'listening' | 'reading';
/**
 * gap       completion of any kind (form, notes, table, flow-chart, sentence, summary, short answer, diagram/map label with words)
 * mcq       one answer per question from its own options
 * mcq-multi "Choose TWO letters": one stem + shared options spanning several question numbers, answers in any order
 * tfng/ynng TRUE/FALSE/NOT GIVEN, YES/NO/NOT GIVEN statements
 * match     items matched to a shared option list (headings, paragraphs, people, sentence endings, map letters …)
 */
export type LrType = 'gap' | 'mcq' | 'mcq-multi' | 'tfng' | 'ynng' | 'match';

export interface LrOption { key: string; text: string }
export interface LrQuestion {
  n: number;
  /** stem / statement / item; for gap questions may contain the placeholder {{n}} */
  text?: string;
  /** mcq only */
  options?: LrOption[];
  /**
   * Accepted answers. Words in parentheses are optional: "(the) museum". Letters/roman numerals for option types,
   * TRUE/FALSE/NOT GIVEN or YES/NO/NOT GIVEN for tfng/ynng. mcq-multi: every question lists the full correct set.
   * Absent in the client copy (stripAnswers).
   */
  answer?: string[];
  /** Review-only enrichment, precomputed once per test (scripts/lr-enrich.ts); stripped before submission like `answer`. */
  review?: LrQuestionReview;
}
/** Where and why: generated offline by a model once per question, shown on the results page only. */
export interface LrQuestionReview {
  /** verbatim sentence(s) from the passage / transcript that give the answer */
  evidence?: string;
  /** listening: seconds into the part's audio where the evidence starts (from word timings) */
  at?: number;
  /** 1–2 sentences: why the key is right (the paraphrase, the trap, NOT GIVEN vs FALSE logic) */
  why?: string;
  /** option key → why that option is wrong (mcq, match, tfng/ynng values, word-box letters) */
  wrong?: Record<string, string>;
  /** question wording ↔ passage/transcript wording, e.g. ["decline", "fell sharply"] */
  paraphrase?: [string, string][];
}
export interface LrVocab { word: string; meaning: string; example?: string }
/** listening word timings for one part: [word, start s, end s] */
export type LrTimings = [string, number, number][];
export interface LrGroup {
  from: number;
  to: number;
  type: LrType;
  /** "Questions 1–10. Complete the form below." plus the rubric line */
  instructions: string;
  /** e.g. "ONE WORD AND/OR A NUMBER" */
  wordLimit?: string;
  title?: string;
  /** gap groups: markdown (tables allowed) with {{n}} placeholders; questions then need no text */
  content?: string;
  /** match / mcq-multi shared list (also summary-with-word-box gaps answered by letter) */
  options?: LrOption[];
  /** "You may use any letter more than once" */
  reusable?: boolean;
  /** asset key of a map/plan/diagram image */
  image?: string;
  questions: LrQuestion[];
}
export interface LrPassage { title: string; subtitle?: string; paragraphs: { label?: string; text: string }[] }
export interface LrSection {
  /** listening 1–4, reading 1–3 (GT reading: 1–3 sections, a section may hold several short texts in `passage.paragraphs`) */
  part: number;
  title?: string;
  /** listening: asset key of the recording */
  audio?: string;
  /** listening: tapescript, shown only after submission */
  transcript?: string;
  /** reading */
  passage?: LrPassage;
  /** listening: word timings of the recording (ElevenLabs scribe), review-only — stripped before submission */
  timings?: LrTimings;
  /** key vocabulary of the passage / recording, review-only — stripped before submission */
  vocab?: LrVocab[];
  groups: LrGroup[];
}
export interface LrTest {
  slug: string;
  skill: LrSkill;
  variant: 'academic' | 'general';
  source: 'cambridge' | 'generated';
  /** "C17 T1" */
  ref: string;
  title: string;
  sections: LrSection[];
}

export type LrResponses = Record<number, string>;
export interface LrMark { n: number; given: string; correct: boolean; answer: string[] }
export interface LrScore { raw: number; total: number; band: number; marks: LrMark[] }

const norm = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[‘’`]/g, "'").replace(/[-–—/]/g, ' ').replace(/[.,;:!?"“”]+/g, ' ').replace(/\s+/g, ' ').trim();

/** "(the) old (town) hall" → every variant with/without each optional part. */
export function expandAnswer(a: string): string[] {
  const m = a.match(/\(([^()]*)\)/);
  if (!m) return [norm(a)];
  const [pre, post] = [a.slice(0, m.index), a.slice(m.index! + m[0].length)];
  return [...expandAnswer(pre + m[1] + post), ...expandAnswer(pre + post)];
}

const TFNG: Record<string, string> = { t: 'true', f: 'false', y: 'yes', n: 'no', ng: 'not given' };
export function isCorrect(given: string, accepted: string[]): boolean {
  let g = norm(given ?? '');
  if (!g) return false;
  // short forms (t/f/ng…) only where the key is a TRUE/FALSE/YES/NO/NOT GIVEN word, so option letter F stays F
  if (accepted.some((a) => /^(true|false|yes|no|not given)$/i.test(a.trim()))) g = TFNG[g] ?? g;
  return accepted.some((a) => expandAnswer(a).includes(g));
}

export function scoreLr(test: LrTest, responses: LrResponses): LrScore {
  const marks: LrMark[] = [];
  for (const s of test.sections) for (const g of s.groups) {
    if (g.type === 'mcq-multi') {
      // ponytail: picks are stored one letter per question slot; each correct, distinct letter earns one mark
      const correct = new Set((g.questions[0]?.answer ?? []).map((x) => x.toUpperCase()));
      const seen = new Set<string>();
      for (const q of g.questions) {
        const given = (responses[q.n] ?? '').trim().toUpperCase();
        const ok = !!given && correct.has(given) && !seen.has(given);
        if (given) seen.add(given);
        marks.push({ n: q.n, given, correct: ok, answer: [...correct] });
      }
      continue;
    }
    for (const q of g.questions) {
      const given = responses[q.n] ?? '';
      marks.push({ n: q.n, given, correct: isCorrect(given, q.answer ?? []), answer: q.answer ?? [] });
    }
  }
  marks.sort((a, b) => a.n - b.n);
  const raw = marks.filter((m) => m.correct).length;
  return { raw, total: marks.length, band: lrBand(test.skill, test.variant, raw, marks.length), marks };
}

// Official raw-score conversion (out of 40), lowest raw for each band.
const LISTENING: [number, number][] = [[39, 9], [37, 8.5], [35, 8], [32, 7.5], [30, 7], [26, 6.5], [23, 6], [18, 5.5], [16, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [2, 2], [1, 1]];
const READING_AC: [number, number][] = [[39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5], [23, 6], [19, 5.5], [15, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [2, 2], [1, 1]];
const READING_GT: [number, number][] = [[40, 9], [39, 8.5], [37, 8], [36, 7.5], [34, 7], [32, 6.5], [30, 6], [27, 5.5], [23, 5], [19, 4.5], [15, 4], [12, 3.5], [9, 3], [6, 2.5], [3, 2], [1, 1]];

/** Raw score → band. Tests with ≠40 questions are scaled to 40 first. */
export function lrBand(skill: LrSkill, variant: 'academic' | 'general', raw: number, total = 40): number {
  const r = total === 40 ? raw : Math.round((raw / Math.max(total, 1)) * 40);
  const table = skill === 'listening' ? LISTENING : variant === 'general' ? READING_GT : READING_AC;
  return roundBand(table.find(([min]) => r >= min)?.[1] ?? 0);
}

/** Copy safe to send before submission: no answers, no transcript. */
export function stripAnswers(test: LrTest): LrTest {
  return {
    ...test,
    sections: test.sections.map(({ transcript: _t, timings: _w, vocab: _v, ...s }) => ({
      ...s,
      groups: s.groups.map((g) => ({ ...g, questions: g.questions.map(({ answer: _a, review: _r, ...q }) => q) })),
    })),
  };
}

/** Structural checks used by importers; returns human-readable problems (empty = valid). */
export function validateLrTest(t: LrTest): string[] {
  const errs: string[] = [];
  const nums = t.sections.flatMap((s) => s.groups.flatMap((g) => g.questions.map((q) => q.n)));
  nums.forEach((n, i) => { if (n !== i + 1) errs.push(`question numbers not contiguous at ${n} (expected ${i + 1})`); });
  if (nums.length !== 40) errs.push(`${nums.length} questions (expected 40)`);
  if (t.skill === 'listening' && t.sections.some((s) => !s.audio)) errs.push('listening section without audio');
  if (t.skill === 'reading' && t.sections.some((s) => !s.passage?.paragraphs.length)) errs.push('reading section without passage');
  for (const s of t.sections) for (const g of s.groups) {
    if (g.questions[0]?.n !== g.from || g.questions.at(-1)?.n !== g.to) errs.push(`group ${g.from}-${g.to}: range mismatch`);
    const keys = new Set((g.options ?? []).map((o) => o.key.toUpperCase()));
    for (const q of g.questions) {
      const ans = q.answer ?? [];
      if (!ans.length) { errs.push(`Q${q.n}: no answer`); continue; }
      if (g.type === 'gap' && !g.options && !(g.content ?? '').includes(`{{${q.n}}}`) && !(q.text ?? '').includes(`{{${q.n}}}`) && !g.image)
        errs.push(`Q${q.n}: gap without {{${q.n}}} placeholder`);
      if (g.type === 'mcq' && !q.options?.some((o) => ans.some((a) => a.toUpperCase() === o.key.toUpperCase()))) errs.push(`Q${q.n}: answer not among options`);
      if ((g.type === 'match' || g.type === 'mcq-multi' || (g.type === 'gap' && g.options)) && ans.some((a) => !keys.has(a.toUpperCase()))) errs.push(`Q${q.n}: answer not among group options`);
      if (g.type === 'tfng' && ans.some((a) => !['TRUE', 'FALSE', 'NOT GIVEN'].includes(a.toUpperCase()))) errs.push(`Q${q.n}: bad TFNG answer`);
      if (g.type === 'ynng' && ans.some((a) => !['YES', 'NO', 'NOT GIVEN'].includes(a.toUpperCase()))) errs.push(`Q${q.n}: bad YNNG answer`);
    }
  }
  return errs;
}

/**
 * Reduce group content to the markdown subset every client renders (paragraphs, **bold**, lists, tables, {{n}}):
 * "## Heading" → "**Heading**", <br> → " · ", other tags and *italic* markers dropped.
 */
export function normalizeLrContent(md: string): string {
  return md
    .split('\n')
    .map((l) => l.replace(/^\s*#{1,6}\s+(.*?)\s*#*\s*$/, (_, h: string) => `**${h.replace(/\*\*/g, '')}**`))
    .join('\n')
    .replace(/<br\s*\/?>/gi, ' · ')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/(?<![*\w])\*(?!\*)([^*\n]+?)\*(?![*\w])/g, '$1');
}

/** normalizeLrContent applied to every group of a test (importers call this). */
export function normalizeLrTest(t: LrTest): LrTest {
  return { ...t, sections: t.sections.map((s) => ({ ...s, groups: s.groups.map((g) => (g.content ? { ...g, content: normalizeLrContent(g.content) } : g)) })) };
}
