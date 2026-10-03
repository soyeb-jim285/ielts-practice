// @ts-nocheck -- one-off generator over untyped LLM JSON; strict indexed-access checks add noise, not safety
// Generates original IELTS Listening/Reading tests (LrTest JSON) into data/lr-generated/ (gitignored).
// Usage: pnpm tsx scripts/gen-lr.ts [slug ...]   (default: all; resumable, every LLM step is cached in data/lr-generated/.cache)
// Pipeline per section: write passage/script -> write questions -> gates (structure, verbatim answers, word limits)
// -> independent solver (different model) -> arbiter on disagreements -> fix/regenerate -> assemble + validate.
// TTS for the scripts is a separate step: scripts/gen-lr-tts.py. Budget is hard-capped via data/lr-generated/cost.log.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expandAnswer, isCorrect, validateLrTest, type LrGroup, type LrSection, type LrTest } from '../packages/core/src/lr';

try { process.loadEnvFile(join(import.meta.dirname, '../.env')); } catch { /* env may already be set */ }
const OUT = join(import.meta.dirname, '../data/lr-generated');
const CACHE = join(OUT, '.cache');
for (const d of [CACHE, join(OUT, 'scripts'), join(OUT, 'assets/lr/gen/img')]) mkdirSync(d, { recursive: true });
const WRITER = 'openai/gpt-6-luna';
const SOLVER = 'deepseek/deepseek-v4.1-flash';
const ARBITER = 'qwen/qwen3.8-flash';
const BUDGET = 1.4; // hard stop (limit is 1.50; a call in flight can overshoot slightly)

// ---------- LLM client (OpenRouter, cost-logged) ----------
const COST_LOG = join(OUT, 'cost.log');
let spent = existsSync(COST_LOG) ? +(readFileSync(COST_LOG, 'utf8').trim().split('\n').at(-1)?.match(/cum=([\d.]+)/)?.[1] ?? 0) : 0;

async function llm(model: string, system: string, user: string, effort: 'low' | 'medium' = 'low'): Promise<any> {
  for (let attempt = 0; attempt < 6; attempt++) {
    if (spent >= BUDGET) throw new Error(`budget cap reached ($${spent.toFixed(4)})`);
    let res: Response;
    try {
      res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'X-Title': 'IELTS Practice gen-lr' },
        body: JSON.stringify({ model, temperature: 0.7, max_tokens: 14000, reasoning: { effort }, usage: { include: true }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
        signal: AbortSignal.timeout(300_000),
      });
    } catch (e) { console.warn('llm network error', (e as Error).message); continue; }
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 4000 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j: any = await res.json();
    const cost = +(j.usage?.cost ?? 0);
    spent += cost;
    appendFileSync(COST_LOG, `${new Date().toISOString()} ${model} cost=${cost.toFixed(6)} cum=${spent.toFixed(6)}\n`);
    const text: string = j.choices?.[0]?.message?.content ?? '';
    try { return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { console.warn(`unparseable JSON from ${model}, retrying`); }
  }
  throw new Error(`llm failed (${model})`);
}
/** Resumable step: result cached as JSON by name. */
async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const f = join(CACHE, `${name}.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const v = await fn();
  writeFileSync(f, JSON.stringify(v));
  return v;
}

// ---------- test plans ----------
type Kind = 'tfng' | 'ynng' | 'headings' | 'matchinfo' | 'matchfeat' | 'endings' | 'sentcomp' | 'summary' | 'wordbox' | 'notes' | 'table' | 'flow' | 'mcq' | 'mcqmulti' | 'shortans' | 'form' | 'matchlist' | 'map';
type Plan = [Kind, number][];
interface ReadSec { topic: string; plan: Plan; gt?: string }
const READ: Record<string, ReadSec[]> = {
  'gen-r-01': [
    { topic: 'science: bioluminescence in deep-sea organisms', plan: [['tfng', 6], ['notes', 7]] },
    { topic: 'history: the lighthouse and the invention of the Fresnel lens', plan: [['headings', 6], ['matchinfo', 4], ['sentcomp', 4]] },
    { topic: 'social science: the case for and against a four-day working week (argumentative, writer states views)', plan: [['ynng', 5], ['mcq', 4], ['mcqmulti', 2], ['shortans', 2]] },
  ],
  'gen-r-02': [
    { topic: 'technology/environment: vertical farming and urban food supply', plan: [['headings', 6], ['table', 4], ['mcq', 3]] },
    { topic: 'science: how honeybees navigate and communicate the location of food', plan: [['tfng', 7], ['flow', 5], ['shortans', 2]] },
    { topic: 'social science: does bilingual education improve cognition? (argumentative, writer states views, several named researchers)', plan: [['ynng', 6], ['matchfeat', 4], ['wordbox', 3]] },
  ],
  'gen-r-03': [
    { topic: 'history: how medieval cathedrals were built', plan: [['matchinfo', 5], ['summary', 5], ['mcq', 4]] },
    { topic: 'social science: urban street trees and public wellbeing', plan: [['headings', 5], ['tfng', 5], ['shortans', 3]] },
    { topic: 'technology: machine translation and the future of human translators (argumentative, writer states views)', plan: [['ynng', 5], ['endings', 4], ['wordbox', 4]] },
  ],
  'gen-r-04': [
    { topic: 'science: tardigrades and extreme survival', plan: [['tfng', 5], ['summary', 4], ['mcqmulti', 2], ['shortans', 2]] },
    { topic: 'environment: mangrove restoration and coastal communities', plan: [['headings', 5], ['matchinfo', 4], ['notes', 5]] },
    { topic: 'history/technology: the mechanical clock and the standardisation of time (writer states views)', plan: [['ynng', 6], ['mcq', 3], ['sentcomp', 4]] },
  ],
  'gen-rg-01': [
    { gt: 'three short everyday texts (a library notice, a gym advertisement, a lost-property procedure), about 600 words in total', topic: 'everyday notices and advertisements', plan: [['matchinfo', 5], ['sentcomp', 5], ['tfng', 4]] },
    { gt: 'two work-related texts (a job advertisement and a workplace health-and-safety policy), about 700 words in total', topic: 'work', plan: [['tfng', 4], ['sentcomp', 5], ['mcq', 4]] },
    { gt: 'one longer general-interest magazine article, 750-850 words, the writer states some views', topic: 'why people collect things', plan: [['ynng', 5], ['mcq', 4], ['summary', 4]] },
  ],
  'gen-rg-02': [
    { gt: 'three short everyday texts (community centre classes leaflet, a flat-to-rent advertisement, a bus timetable change notice), about 600 words in total', topic: 'everyday notices and advertisements', plan: [['shortans', 5], ['tfng', 5], ['mcq', 4]] },
    { gt: 'two work-related texts (a staff holiday policy and a training-course description), about 700 words in total', topic: 'work', plan: [['matchinfo', 5], ['notes', 4], ['mcq', 4]] },
    { gt: 'one longer general-interest article, 750-850 words', topic: 'the history of the bicycle', plan: [['headings', 5], ['tfng', 4], ['summary', 4]] },
  ],
};
interface ListenPart { topic: string; brief: string; plan: Plan; chunks: [number, number][] }
const LISTEN: Record<string, ListenPart[]> = {
  'gen-l-01': [
    { topic: 'a person booking a holiday cottage by phone', brief: 'Part 1: everyday conversation between a customer and a booking agent. The agent fills in a booking form.', plan: [['form', 5], ['form', 5]], chunks: [[1, 5], [6, 10]] },
    { topic: 'a welcome talk for visitors to a small local history museum, with a site map', brief: 'Part 2: monologue by a guide in a social context (orientation talk).', plan: [['mcq', 5], ['map', 5]], chunks: [[11, 15], [16, 20]] },
    { topic: 'two students and their tutor discussing a marine biology assignment on coral bleaching', brief: 'Part 3: academic discussion, two students and a tutor.', plan: [['mcq', 3], ['mcqmulti', 2], ['matchlist', 5]], chunks: [[21, 25], [26, 30]] },
    { topic: 'a university lecture on glass-making in ancient Rome', brief: 'Part 4: academic lecture, one speaker, no interruptions.', plan: [['notes', 10]], chunks: [[31, 40]] },
  ],
  'gen-l-02': [
    { topic: 'a person enrolling in an evening language course by phone', brief: 'Part 1: everyday conversation between a caller and a college administrator who fills in an enrolment form.', plan: [['form', 5], ['form', 5]], chunks: [[1, 5], [6, 10]] },
    { topic: 'a guided tour introduction at a working farm park, with a site map', brief: 'Part 2: monologue by a farm-park guide in a social context.', plan: [['mcq', 5], ['map', 5]], chunks: [[11, 15], [16, 20]] },
    { topic: 'two students and a lecturer discussing a psychology experiment on sleep and memory', brief: 'Part 3: academic discussion, two students and a lecturer.', plan: [['mcq', 3], ['mcqmulti', 2], ['matchlist', 5]], chunks: [[21, 25], [26, 30]] },
    { topic: 'a university lecture on urban heat islands', brief: 'Part 4: academic lecture, one speaker.', plan: [['notes', 10]], chunks: [[31, 40]] },
  ],
  'gen-l-03': [
    { topic: 'a person reporting a lost bag to a railway station lost-property clerk', brief: 'Part 1: everyday conversation; the clerk fills in a lost-property report.', plan: [['form', 5], ['form', 5]], chunks: [[1, 5], [6, 10]] },
    { topic: 'an introduction to the facilities of a newly refurbished town library, with a floor map', brief: 'Part 2: monologue by a librarian in a social context.', plan: [['mcq', 5], ['map', 5]], chunks: [[11, 15], [16, 20]] },
    { topic: 'two students and their tutor planning a business report on renewable energy for small companies', brief: 'Part 3: academic discussion, two students and a tutor.', plan: [['mcq', 3], ['mcqmulti', 2], ['matchlist', 5]], chunks: [[21, 25], [26, 30]] },
    { topic: 'a university lecture on the migration of Arctic terns', brief: 'Part 4: academic lecture, one speaker.', plan: [['notes', 10]], chunks: [[31, 40]] },
  ],
};

// ---------- question-kind docs ----------
const GROUP_SHAPE = `Each group is a JSON object: {"from":int,"to":int,"type":"gap|mcq|mcq-multi|tfng|ynng|match","instructions":string,"wordLimit"?:string,"title"?:string,"content"?:string,"options"?:[{"key","text"}],"reusable"?:bool,"questions":[{"n":int,"text"?:string,"options"?:[{"key","text"}],"answer":[string]}]}. "instructions" reads like the real exam, e.g. "Questions 1-6. Complete the notes below. Write NO MORE THAN TWO WORDS from the passage for each answer." Optional words in an answer go in parentheses "(the) harbour"; genuinely acceptable alternatives are extra array entries.`;
const KIND: Record<Kind, string> = {
  tfng: 'type "tfng". One question per statement: {n,text:statement,answer:["TRUE"|"FALSE"|"NOT GIVEN"]}. Instructions end with "In boxes X-Y write TRUE if the statement agrees with the information, FALSE if the statement contradicts the information, NOT GIVEN if there is no information on this." Statements follow passage order, a balanced mix of the three answers; NOT GIVEN statements must be plausible but genuinely absent.',
  ynng: 'type "ynng". Statements about the WRITER\'S views/claims; answer ["YES"|"NO"|"NOT GIVEN"]. Instructions end with "write YES if the statement agrees with the views of the writer, NO if it contradicts the views of the writer, NOT GIVEN if it is impossible to say what the writer thinks about this." Balanced mix.',
  headings: 'type "match", matching headings. options = headings keyed with lowercase roman numerals i, ii, iii... with MORE headings than questions (3 extra, plausible distractors). Each question {n,text:"Paragraph C",answer:["iv"]}; paragraphs in order; reusable false. Instruction: "Choose the correct heading for each paragraph from the list of headings below."',
  matchinfo: 'type "match", "Which paragraph/text contains the following information?" options = the paragraph (or text) letters as {key:"A",text:"Paragraph A"}; reusable true (say "You may use any letter more than once"); questions are information statements ("a description of ...") with answer ["B"] etc.',
  matchfeat: 'type "match", match statements to people/researchers/categories named in the passage. options keyed A.. with the names; reusable true; question text = a statement, answer = one letter.',
  endings: 'type "match", sentence endings. options = endings keyed A.. (MORE endings than questions); question text = sentence beginning, answer = letter of the ending that completes it according to the passage; reusable false.',
  sentcomp: 'type "gap", sentence completion. wordLimit like "NO MORE THAN TWO WORDS". "content" = markdown list of sentences, each containing one {{n}} placeholder, in passage order. Answers are copied VERBATIM (exact words) from the passage.',
  summary: 'type "gap", summary completion (no word box). wordLimit like "ONE WORD ONLY". "content" = a paragraph summarising part of the passage with {{n}} placeholders. Answers copied VERBATIM from the passage.',
  wordbox: 'type "gap", summary completion WITH a word box: group.options = a list of words/phrases keyed A.. (MORE options than gaps); "content" = summary paragraph with {{n}} placeholders; each answer is the option LETTER only (["C"]). No wordLimit.',
  notes: 'type "gap", note completion. wordLimit like "ONE WORD ONLY" or "NO MORE THAN TWO WORDS". "content" = markdown notes with bold headings and bullet lines, with {{n}} placeholders. Answers copied VERBATIM from the passage.',
  table: 'type "gap", table completion. "content" = a markdown table (header row + separator row) with {{n}} placeholders inside cells. wordLimit like "ONE WORD ONLY". Answers copied VERBATIM from the passage.',
  flow: 'type "gap", flow-chart completion. "content" = markdown: a title line, then steps as lines "1. ...text {{n}} ..." joined by lines containing only "↓". wordLimit like "NO MORE THAN TWO WORDS". Answers copied VERBATIM from the passage; the steps follow the process in the passage.',
  mcq: 'type "mcq". Each question {n,text:stem,options:[{key:"A",text},{B},{C},{D}],answer:["B"]}; vary the position of the correct answer; distractors are plausible and mentioned/related in the passage.',
  mcqmulti: 'type "mcq-multi", "Choose TWO letters, A-E." group.options = 5 options A-E shared; exactly TWO questions (consecutive n), each with text = the same stem and answer = the FULL set of two correct letters, e.g. ["B","D"] on both questions.',
  shortans: 'type "gap", short-answer questions. wordLimit like "NO MORE THAN THREE WORDS". Each question {n,text:"question ending with {{n}}",answer:[...]}. No "content". Answers copied VERBATIM from the passage.',
  form: 'type "gap", form completion. wordLimit "ONE WORD AND/OR A NUMBER" (or "NO MORE THAN TWO WORDS AND/OR A NUMBER"). "title" = the form title; "content" = markdown form (lines like "Name: {{n}}" or a table) with {{n}} placeholders, possibly with a few pre-filled example lines. Answers must be words/numbers said in the script, copied EXACTLY as written there (names that are spelled out: the name; numbers as digits exactly as in the script). At least two answers are spelled names, one phone number or postcode, one date, one price, and for at least three answers the speaker first says a wrong/corrected value.',
  matchlist: 'type "match": the listener matches items (e.g. the students\' opinions of each stage/option/book) to a shared list. options = 6 statements keyed A-F (MORE options than questions); questions = 5 items in order of discussion; answer = one letter; reusable false.',
  map: '',
};

// ---------- text helpers ----------
const nrm = (s: string) => ` ${s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[‘’`]/g, "'").replace(/[^a-z0-9']+/g, ' ').trim()} `;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const NUM: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3 };
function limitOk(limit: string, ans: string): boolean {
  const L = limit.toUpperCase();
  const max = NUM[L.match(/\b(ONE|TWO|THREE)\b/)?.[1] ?? ''] ?? +(L.match(/\d/)?.[0] ?? 0);
  if (!max) return true;
  const numOk = L.includes('NUMBER');
  return expandAnswer(ans).some((v) => {
    const toks = v.split(' ').filter(Boolean);
    let w = 0, nums = 0, prevNum = false;
    for (const t of toks) { const isN = /\d/.test(t); if (isN) { if (!prevNum) nums++; } else w++; prevNum = isN; }
    return numOk ? w <= max && nums <= 1 : w + nums <= max;
  });
}

/** Per-group problems: structure (validateLrTest), verbatim answers, word limits. */
function gates(sec: LrSection, text: string): Map<number, string[]> {
  const bad = new Map<number, string[]>();
  const add = (gi: number, m: string) => bad.set(gi, [...(bad.get(gi) ?? []), m]);
  const probe: LrTest = { slug: 'x', skill: 'reading', variant: 'academic', source: 'generated', ref: '', title: '', sections: [{ ...sec, passage: { title: '', paragraphs: [{ text: '' }] } }] };
  const base = sec.groups[0]?.from ?? 1;
  for (const e of validateLrTest(probe)) {
    if (/expected 40|contiguous|audio/.test(e)) continue;
    const n = +(e.match(/^Q(\d+)/)?.[1] ?? e.match(/group (\d+)-/)?.[1] ?? base);
    add(Math.max(0, sec.groups.findIndex((g) => n >= g.from && n <= g.to)), e);
  }
  const hay = nrm(text);
  sec.groups.forEach((g, gi) => {
    if (g.type === 'gap' && !g.options) {
      if (!g.wordLimit) add(gi, 'gap group needs wordLimit');
      for (const q of g.questions) {
        const present = (a: string) => expandAnswer(a).some((v) => hay.includes(` ${v} `));
        // ponytail: derived alternatives (bare number without £ or comma) need not appear verbatim, at least one entry must
        if (!(q.answer ?? []).some((a) => present(a.replace(/[£$€]/g, '')))) add(gi, `Q${q.n}: answer "${q.answer?.[0]}" does not appear verbatim in the text`);
        for (const a of q.answer ?? []) if (g.wordLimit && !limitOk(g.wordLimit, a)) add(gi, `Q${q.n}: answer "${a}" exceeds word limit "${g.wordLimit}"`);
      }
    }
    if (g.type === 'mcq-multi') {
      const sets = g.questions.map((q) => [...(q.answer ?? [])].sort().join());
      if (g.questions.length < 2 || new Set(sets).size > 1 || (g.questions[0].answer ?? []).length !== g.questions.length) add(gi, 'mcq-multi: every question must carry the full correct set (size = number of questions)');
    }
    for (const q of g.questions) if (g.type === 'gap' && !g.options && !g.image && !(g.content ?? '').includes(`{{${q.n}}}`) && !(q.text ?? '').includes(`{{${q.n}}}`)) add(gi, `Q${q.n}: missing placeholder`);
  });
  return bad;
}

// ---------- solver / arbiter ----------
const renderGroups = (groups: LrGroup[]) => groups.map((g) => [
  `### Questions ${g.from}-${g.to} (${g.type})`, g.instructions, g.wordLimit ? `Word limit: ${g.wordLimit}` : '', g.title ?? '',
  g.options ? `Options (shared):\n${g.options.map((o) => `${o.key}  ${o.text}`).join('\n')}` : '', g.content ?? '',
  ...g.questions.map((q) => `${q.n}. ${q.text ?? ''}${q.options ? '\n' + q.options.map((o) => `   ${o.key}  ${o.text}`).join('\n') : ''}`),
].filter(Boolean).join('\n')).join('\n\n');

const sameAnswer = (g: LrGroup, qi: number, given: string): boolean => {
  const q = g.questions[qi];
  if (g.type === 'mcq-multi') return false; // handled by set compare
  if (g.type === 'gap' && !g.options) return isCorrect(given, q.answer ?? []);
  return (q.answer ?? []).some((a) => a.toUpperCase() === given.trim().toUpperCase());
};
function disagreements(groups: LrGroup[], solved: Record<string, string>) {
  const out: { gi: number; n: number; key: string[]; solver: string }[] = [];
  groups.forEach((g, gi) => {
    if (g.type === 'mcq-multi') {
      const key = (g.questions[0].answer ?? []).map((x) => x.toUpperCase()).sort().join();
      const got = g.questions.map((q) => String(solved[q.n] ?? '').toUpperCase().trim()).sort().join();
      if (key !== got) out.push({ gi, n: g.questions[0].n, key: g.questions[0].answer ?? [], solver: got });
      return;
    }
    g.questions.forEach((q, qi) => { if (!sameAnswer(g, qi, String(solved[q.n] ?? ''))) out.push({ gi, n: q.n, key: q.answer ?? [], solver: String(solved[q.n] ?? '') }); });
  });
  return out;
}

interface Ctx { id: string; label: string; text: string; extra?: string; part: string; sectionHint: string }
async function genGroup(c: Ctx, kind: Kind, from: number, to: number, feedback?: string, prev?: LrGroup): Promise<LrGroup> {
  const r = await llm(WRITER, `You write original IELTS ${c.sectionHint} questions. Output ONLY JSON {"groups":[...]}. ${GROUP_SHAPE}`,
    `${c.label}:\n"""\n${c.text}\n"""\n${c.extra ?? ''}\nWrite ONE group of questions numbered ${from} to ${to} of this kind: ${KIND[kind]}\n${feedback ? `Your previous attempt had these problems, fix them:\n${feedback}\nPrevious attempt: ${JSON.stringify(prev)}` : ''}\nEvery answer must be fully supported by the ${c.label.toLowerCase()} and unambiguous.`);
  return fixShape(r.groups[0], from, to);
}
function fixShape(g: LrGroup, from: number, to: number): LrGroup {
  g.from = from; g.to = to;
  g.questions.forEach((q, i) => { q.n = from + i; });
  return g;
}

async function refine(c: Ctx, plan: Plan, preset: LrGroup[] = [], codeGroups: Record<number, LrGroup> = {}): Promise<{ groups: LrGroup[]; agree: string }> {
  // initial groups: one call per group (keeps each output small and independently regenerable)
  let n = 1 + preset.length * 0; let from = +c.part;
  const startN = from;
  const specs = plan.map(([kind, cnt]) => { const s = { kind, from, to: from + cnt - 1 }; from += cnt; return s; });
  void n; void startN;
  let groups: LrGroup[] = await Promise.all(specs.map((s) => codeGroups[s.from] ? Promise.resolve(codeGroups[s.from]) : step(`${c.id}-g${s.from}`, () => genGroup(c, s.kind, s.from, s.to))));
  let first = '', last = '';
  for (let round = 0; round < 3; round++) {
    // currency symbols / thousands separators are not required of candidates: accept the bare number too
    for (const g of groups) if (g.type === 'gap' && !g.options) for (const q of g.questions) for (const a of [...(q.answer ?? [])]) {
      for (const alt of [a.replace(/[£$€]/g, ''), a.replace(/[£$€]/g, '').replace(/(\d),(\d{3})/g, '$1$2')]) if (alt && !q.answer!.includes(alt)) q.answer!.push(alt);
    }
    const bad = gates({ part: 0, groups } as LrSection, c.text);
    const regen = new Map<number, string[]>(bad);
    if (!bad.size) {
      const solved: Record<string, string> = await step(`${c.id}-solve-r${round}`, async () => llm(SOLVER, `You are an IELTS candidate taking a test. Answer every question using ONLY the ${c.label.toLowerCase()}. Output ONLY JSON mapping each question number (string) to your answer: option letter(s), TRUE/FALSE/NOT GIVEN, YES/NO/NOT GIVEN, roman numeral, or the exact words from the text for gaps (respect the word limit). For "choose TWO" groups give each of the two letters as the answer to the two numbers.`, `${c.label}:\n"""\n${c.text}\n"""\n${c.extra ?? ''}\n\n${renderGroups(groups)}`, 'medium'));
      const dis = disagreements(groups, solved);
      const total = groups.reduce((a, g) => a + g.questions.length, 0);
      last = `${total - dis.length}/${total}`;
      if (round === 0) first = last;
      if (!dis.length) return { groups, agree: `${first} -> ${last}` };
      for (const d of dis) {
        const g = groups[d.gi];
        const arbPrompt = (m: string) => llm(m, 'You adjudicate an IELTS answer-key dispute. Output ONLY JSON {"verdict":"key"|"solver"|"both"|"neither","answer":[string],"reason":string}. "key": the official key is right. "solver": the candidate is right and the key is wrong (put the correct answer(s) in "answer"; for gaps, exact words from the text). "both": both are defensible (ambiguous question). "neither": both are wrong.',
          `${c.label}:\n"""\n${c.text}\n"""\n${c.extra ?? ''}\n\n${renderGroups([{ ...g, questions: g.questions.filter((q) => q.n === d.n || g.type === 'mcq-multi') }])}\n\nOfficial key: ${JSON.stringify(d.key)}\nCandidate answer: ${JSON.stringify(d.solver)}`, 'medium');
        const v = await step(`${c.id}-arb-${d.n}-r${round}`, () => arbPrompt(ARBITER).catch(() => arbPrompt(WRITER))); // qwen is sometimes rate-limited upstream
        const why = `Q${d.n}: key ${JSON.stringify(d.key)} vs independent solver "${d.solver}" -> arbiter ${v.verdict}: ${v.reason}`;
        if (v.verdict === 'key') continue;
        if (v.verdict === 'solver' && Array.isArray(v.answer) && v.answer.length) {
          const fixed: string[] = v.answer;
          const target = g.type === 'mcq-multi' ? g.questions : g.questions.filter((q) => q.n === d.n);
          target.forEach((q) => { q.answer = fixed; });
          console.log(`  [${c.id}] fixed key: ${why}`);
          continue;
        }
        if (v.verdict === 'both' && g.type === 'gap' && !g.options && d.solver) { g.questions.find((q) => q.n === d.n)!.answer!.push(d.solver); console.log(`  [${c.id}] added alternative: ${why}`); continue; }
        regen.set(d.gi, [...(regen.get(d.gi) ?? []), why]);
      }
      if (!regen.size) continue; // keys were corrected in place; re-run gates + solver
    }
    if (round === 2) { console.warn(`  [${c.id}] unresolved after 3 rounds:`, [...regen.values()].flat()); break; }
    for (const [gi, probs] of regen) {
      const g = groups[gi];
      if (codeGroups[g.from]) continue;
      console.log(`  [${c.id}] regenerating Q${g.from}-${g.to}: ${probs[0]}`);
      const kind = specs.find((s) => s.from === g.from)!.kind;
      groups[gi] = await step(`${c.id}-g${g.from}-fix${round}`, () => genGroup(c, kind, g.from, g.to, probs.join('\n'), g));
    }
  }
  return { groups, agree: `${first} -> ${last || 'unsolved'}` };
}

// ---------- reading ----------
const NEEDS: Partial<Record<Kind, string>> = {
  ynng: 'It is argumentative: the writer states explicit opinions and weighs counter-views.',
  headings: 'Each paragraph has one clear main idea so headings can be matched.',
  matchfeat: 'It names 3-4 researchers/approaches/categories (invented, plausible) with distinct claims.',
  endings: 'It contains several clear cause/effect or contrast statements.',
  flow: 'It describes one process as a clear sequence of 5+ stages.',
  table: 'It compares several categories on several attributes.',
  matchinfo: 'Paragraphs contain distinct specific details (a reason, an example, a comparison, a definition).',
  tfng: 'It contains many precise facts, figures and claims; leave some natural gaps for NOT GIVEN.',
};
async function readingSection(slug: string, i: number, s: ReadSec): Promise<LrSection> {
  const id = `${slug}-s${i + 1}`;
  const needs = [...new Set(s.plan.map(([k]) => NEEDS[k]).filter(Boolean))].join(' ');
  const gt = !!s.gt;
  let passage: any;
  for (let a = 0; a < 3; a++) {
  passage = await step(a ? `${id}-passage-a${a}` : `${id}-passage`, () => llm(WRITER, `You write original IELTS ${gt ? 'General Training' : 'Academic'} Reading material. Output ONLY JSON {"title":string,"subtitle"?:string,"paragraphs":[{"label":string,"text":string}]}. Never copy existing texts; invented names and figures must be plausible and not attributed to real people.`,
    gt ? `Write ${s.gt}. Topic: ${s.topic}. Each text is one entry in "paragraphs" with label "A","B","C" and text starting with a bold markdown title line (**Title**) then the body. For a single long article use 6-7 paragraphs labelled A-G. Plain everyday/work register with realistic detail (times, prices, rules, dates). ${needs}`
       : `Write an academic reading passage of 780-880 words (never more than 900) on: ${s.topic}. 7-8 paragraphs labelled A, B, C... Formal academic register, concrete facts, dates, figures and terminology. ${needs} Do not include questions.${a ? ' IMPORTANT: your previous draft was too long; keep the body under 880 words.' : ''}`));
  if (gt || words(passage.paragraphs.map((p: any) => p.text).join(' ')) <= 980) break;
  }
  const text = [passage.title, passage.subtitle ?? '', ...passage.paragraphs.map((p: any) => p.text)].join('\n');
  console.log(`  [${id}] passage ${words(text)} words`);
  const c: Ctx = { id, label: 'PASSAGE', text: passage.paragraphs.map((p: any) => `${p.label ? p.label + '. ' : ''}${p.text}`).join('\n\n'), part: String(i === 0 ? 1 : s.plan.length ? 0 : 0), sectionHint: gt ? 'General Training Reading' : 'Academic Reading' };
  const start = READ_START[slug][i];
  c.part = String(start);
  c.text = `${passage.title}\n${c.text}`;
  const { groups, agree } = await refine(c, s.plan);
  log.push(`${slug} reading section ${i + 1}: solver agreement ${agree}`);
  return { part: i + 1, title: `${gt ? 'Section' : 'Passage'} ${i + 1}`, passage, groups };
}
const READ_START: Record<string, number[]> = {};
for (const [slug, secs] of Object.entries(READ)) { let n = 1; READ_START[slug] = secs.map((s) => { const a = n; n += s.plan.reduce((x, [, c]) => x + c, 0); return a; }); }
const log: string[] = [];

// ---------- listening ----------
interface Script { title: string; intro: string; speakers: { label: string; gender: 'female' | 'male' }[]; turns: { speaker: string; text: string }[]; breakAfter?: number; map?: MapSpec }
interface MapSpec { title: string; cells: { letter: string; name: string; row: number; col: number; shown: boolean }[]; askedOrder: string[] }
const LETTERS = 'ABCDEFGHI'.split('');
function mapProblems(m?: MapSpec): string[] {
  if (!m?.cells) return ['map missing'];
  const p: string[] = [];
  if (m.cells.length !== 9 || new Set(m.cells.map((c) => c.letter)).size !== 9 || m.cells.some((c) => !LETTERS.includes(c.letter))) p.push('map needs 9 cells with unique letters A-I');
  if (new Set(m.cells.map((c) => `${c.row}${c.col}`)).size !== 9 || m.cells.some((c) => ![1, 2, 3].includes(c.row) || ![1, 2, 3].includes(c.col))) p.push('map cells need unique row/col in 1..3');
  if (m.cells.filter((c) => c.shown).length !== 4) p.push('exactly 4 cells must have shown=true');
  const hidden = m.cells.filter((c) => !c.shown).map((c) => c.letter).sort().join();
  if ([...(m.askedOrder ?? [])].sort().join() !== hidden) p.push('askedOrder must list exactly the shown=false letters');
  return p;
}
const mapText = (m: MapSpec) => `MAP (the candidate sees this 3x3 plan; the entrance is at the bottom edge, row 3 is nearest the entrance, row 1 furthest; col 1 left, col 3 right):\n${m.cells.sort((a, b) => a.row - b.row || a.col - b.col).map((c) => `row ${c.row} col ${c.col}: letter ${c.letter}${c.shown ? ` (printed name: ${c.name})` : ''}`).join('\n')}`;

function mapSvg(m: MapSpec): string {
  const W = 760, H = 640, cw = 200, ch = 150, gx = 40, gy = 40, x0 = 40, y0 = 30;
  const cell = (c: MapSpec['cells'][0]) => {
    const x = x0 + (c.col - 1) * (cw + gx), y = y0 + (c.row - 1) * (ch + gy);
    return `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="8" fill="#eef3f8" stroke="#33414e" stroke-width="3"/>` +
      `<text x="${x + 16}" y="${y + 40}" font-size="34" font-weight="700" fill="#10202e">${c.letter}</text>` +
      (c.shown ? `<text x="${x + cw / 2}" y="${y + ch / 2 + 22}" font-size="22" text-anchor="middle" fill="#33414e">${esc(c.name)}</text>` : '');
  };
  const ex = x0 + 1 * (cw + gx) + cw / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="DejaVu Sans, Arial, sans-serif"><rect width="${W}" height="${H}" fill="#fff"/>` +
    `<text x="${W / 2}" y="22" font-size="20" text-anchor="middle" fill="#10202e" font-weight="700">${esc(m.title)}</text>` +
    `<g transform="translate(0,12)">${m.cells.map(cell).join('')}</g>` +
    `<path d="M ${ex} ${H - 62} L ${ex} ${y0 + 3 * ch + 2 * gy + 22}" stroke="#33414e" stroke-width="4" stroke-dasharray="10 8"/>` +
    `<path d="M ${ex - 14} ${y0 + 3 * ch + 2 * gy + 38} L ${ex} ${y0 + 3 * ch + 2 * gy + 18} L ${ex + 14} ${y0 + 3 * ch + 2 * gy + 38}" fill="none" stroke="#33414e" stroke-width="4"/>` +
    `<text x="${ex}" y="${H - 20}" font-size="22" text-anchor="middle" font-weight="700" fill="#10202e">ENTRANCE</text></svg>`;
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

async function listeningPart(slug: string, i: number, p: ListenPart, start: number): Promise<{ section: LrSection; script: Script }> {
  const id = `${slug}-p${i + 1}`;
  const hasMap = p.plan.some(([k]) => k === 'map');
  let script!: Script;
  for (let a = 0; a < 3; a++) {
    script = await step(`${id}-script-a${a}`, () => llm(WRITER, 'You write original IELTS Listening recordings as scripts. Output ONLY JSON.',
      `Write the script. ${p.brief} Topic: ${p.topic}. British English, natural spoken register (contractions, fillers like "well", "right", "hmm" sparingly), 650-800 words in total.
Output {"title":string,"intro":"a sentence starting 'You will hear ...' naming who speaks about what","speakers":[{"label":"UPPERCASE role/name label e.g. RECEPTIONIST, MAN, STUDENT 1, TUTOR, GUIDE, LECTURER","gender":"female|male"}],"turns":[{"speaker":label,"text":string}],"breakAfter":int${hasMap ? ',"map":{"title":string,"cells":[{"letter":"A","name":string,"row":1,"col":1,"shown":false}],"askedOrder":["C","F",...]}' : ''}}.
Rules: ${p.chunks.length > 1 ? `"breakAfter" = index of the last turn belonging to the first half (questions ${p.chunks[0][0]}-${p.chunks[0][1]}); the second half (questions ${p.chunks[1][0]}-${p.chunks[1][1]}) follows. Both halves carry roughly equal information.` : 'monologue; split into paragraphs of 80-120 words as separate turns by the same speaker; breakAfter = -1.'}
${i === 0 ? 'Conversation convey, in this order: customer surname SPELLED letter by letter in capitals with hyphens (e.g. "It\'s Hargreaves, H-A-R-G-R-E-A-V-E-S"), a phone number or postcode in digits, dates, prices, a street name, preferences and requirements. At least 4 self-corrections/distractors where a first value is replaced ("Tuesday... no, sorry, Wednesday").' : ''}
${hasMap ? 'The speaker gives 5 spoken facts first (opening times, prices, rules, a booking tip, a safety point) with at least two distractors, then walks round a site plan. The map has 3x3 grid cells A-I (row 1 is furthest from the ENTRANCE at the bottom edge, row 3 nearest; col 1 left, col 3 right). 4 cells have shown=true (their name is printed on the map, e.g. "Car park"); 5 cells have shown=false and are described ONLY by position in the speech relative to printed places/entrance/each other ("opposite the car park", "to the left of the entrance as you walk in") without giving the letter. askedOrder = the 5 hidden letters in the order the speaker describes them. Positions described must be consistent with the grid. The speech must say each hidden place\'s name (e.g. "the gift shop") and its location.' : ''}
${i === 2 ? 'Discussion: speakers disagree, change their minds, mention options then reject them (at least 3 clear distractors), discuss 5 stages/options/sources in turn with distinct opinions, and two things the student is told to do/avoid (for a choose-TWO question). Tutor/lecturer guides.' : ''}
${i === 3 ? 'Lecture: signposted, with 10+ concrete key terms, numbers and technical nouns a student would note down; include one or two self-corrections ("about forty... sorry, fifty years"). Single speaker label LECTURER.' : ''}
Every concrete fact must be stated explicitly in the text.`));
    const probs = [...(hasMap ? mapProblems(script.map) : []), ...(words(script.turns.map((t) => t.text).join(' ')) < 450 ? ['script too short'] : []), ...(script.turns.some((t) => !script.speakers.some((s) => s.label === t.speaker)) ? ['turn with unknown speaker'] : [])];
    if (!probs.length) break;
    console.warn(`  [${id}] script attempt ${a} rejected: ${probs.join('; ')}`);
    if (a === 2) throw new Error(`${id}: script failed gates`);
  }
  const transcript = script.turns.map((t) => `${t.speaker}: ${t.text}`).join('\n\n');
  const c: Ctx = { id, label: 'TRANSCRIPT', text: transcript, extra: script.map ? mapText(script.map) : '', part: String(start), sectionHint: 'Listening' };
  const codeGroups: Record<number, LrGroup> = {};
  let from = start;
  for (const [kind, cnt] of p.plan) {
    if (kind === 'map' && script.map) {
      const byL = new Map(script.map.cells.map((x) => [x.letter, x]));
      codeGroups[from] = {
        from, to: from + cnt - 1, type: 'match', instructions: `Questions ${from}-${from + cnt - 1}. Label the plan below. Write the correct letter, A-I, next to Questions ${from}-${from + cnt - 1}.`,
        reusable: false, image: `lr/gen/img/${slug}-q${from}.png`, options: LETTERS.map((k) => ({ key: k, text: k })),
        questions: script.map.askedOrder.map((l, k) => ({ n: from + k, text: byL.get(l)!.name, answer: [l] })),
      };
      writeFileSync(join(CACHE, `${slug}-q${from}.svg`), mapSvg(script.map));
      execFileSync('rsvg-convert', ['-w', '1000', '-o', join(OUT, `assets/lr/gen/img/${slug}-q${from}.png`), join(CACHE, `${slug}-q${from}.svg`)]);
    }
    from += cnt;
  }
  const { groups, agree } = await refine(c, p.plan, [], codeGroups);
  log.push(`${slug} listening part ${i + 1}: solver agreement ${agree}`);
  return { section: { part: i + 1, title: `Part ${i + 1}`, audio: `lr/gen/${slug}-p${i + 1}.mp3`, transcript, groups }, script };
}

// ---------- TTS script (rubric + turns) ----------
const FEMALE = ['bf_emma', 'bf_isabella', 'bf_alice', 'bf_lily'];
const MALE = ['bm_george', 'bm_lewis', 'bm_fable'];
const NARRATOR = 'bm_daniel';
const pauseFor = (nq: number) => Math.min(30, 4 * nq);
function ttsPart(slug: string, i: number, p: ListenPart, s: Script, voiceShift: number) {
  const pool = { female: FEMALE, male: MALE };
  const used = { female: 0, male: 0 };
  const voices: Record<string, string> = {};
  for (const sp of s.speakers) { const g = sp.gender === 'male' ? 'male' : 'female'; voices[sp.label] = pool[g][(used[g]++ + voiceShift + i) % pool[g].length]; }
  const N = (text: string, pause?: number) => ({ speaker: 'NARRATOR', voice: NARRATOR, text, ...(pause ? { pause } : {}) });
  const q = ([a, b]: [number, number]) => `questions ${a} to ${b}`;
  const out: { speaker: string; voice: string; text: string; pause?: number }[] = [];
  if (i === 0) out.push(N('This is the IELTS Listening practice test. You will hear a number of different recordings and you will have to answer questions on what you hear. There will be time for you to read the instructions and questions, and you will have a chance to check your work. All the recordings will be played once only. The test is in four parts.', 2));
  out.push(N(`Part ${i + 1}. ${s.intro.replace(/\.?$/, '.')} First you have some time to look at ${q(p.chunks[0])}.`, pauseFor(p.chunks[0][1] - p.chunks[0][0] + 1)));
  out.push(N(`Now listen carefully and answer ${q(p.chunks[0])}.`, 1));
  s.turns.forEach((t, k) => {
    out.push({ speaker: t.speaker, voice: voices[t.speaker], text: t.text });
    if (p.chunks[1] && k === s.breakAfter) {
      out.push(N(`Before you hear the rest of the ${i === 0 || i === 2 ? 'conversation' : 'talk'}, you have some time to look at ${q(p.chunks[1])}.`, pauseFor(p.chunks[1][1] - p.chunks[1][0] + 1)));
      out.push(N(`Now listen and answer ${q(p.chunks[1])}.`, 1));
    }
  });
  out.push(i === 3 ? N('That is the end of Part 4. You now have half a minute to check your answers.', 30) : N(`That is the end of Part ${i + 1}.`, 2));
  return { part: i + 1, voices: { NARRATOR: NARRATOR, ...voices }, turns: out };
}

// ---------- main ----------
async function main() {
  const want = process.argv.slice(2);
  const slugs = [...Object.keys(LISTEN), ...Object.keys(READ)].filter((s) => !want.length || want.includes(s));
  for (const slug of slugs) {
    const final = join(OUT, `${slug}.json`);
    if (existsSync(join(OUT, 'unrendered', `${slug}.json`))) continue; // held back: no audio rendered (slow CPU)
    if (existsSync(final)) { console.log(`${slug}: done, skipping`); continue; }
    console.log(`== ${slug} (spent $${spent.toFixed(4)})`);
    const num = +slug.match(/(\d+)$/)![1];
    let test: LrTest;
    if (LISTEN[slug]) {
      let n = 1;
      const starts = LISTEN[slug].map((p) => { const a = n; n += p.plan.reduce((x, [, c]) => x + c, 0); return a; });
      const parts = await Promise.all(LISTEN[slug].map((p, i) => listeningPart(slug, i, p, starts[i])));
      test = { slug, skill: 'listening', variant: 'academic', source: 'generated', ref: `Original L${num}`, title: `Original practice · Listening ${num}`, sections: parts.map((x) => x.section) };
      writeFileSync(join(OUT, 'scripts', `${slug}.json`), JSON.stringify({ slug, parts: parts.map((x, i) => ttsPart(slug, i, LISTEN[slug][i], x.script, num)) }, null, 2));
    } else {
      const gt = slug.startsWith('gen-rg');
      const sections = await Promise.all(READ[slug].map((s, i) => readingSection(slug, i, s)));
      test = { slug, skill: 'reading', variant: gt ? 'general' : 'academic', source: 'generated', ref: `Original ${gt ? 'RG' : 'R'}${num}`, title: `Original practice · ${gt ? 'General Training ' : ''}Reading ${num}`, sections };
    }
    const errs = validateLrTest(test);
    if (errs.length) { console.error(`${slug}: INVALID`, errs); writeFileSync(join(OUT, `${slug}.invalid.json`), JSON.stringify(test, null, 2)); continue; }
    writeFileSync(final, JSON.stringify(test, null, 2));
    appendFileSync(join(OUT, 'solver-agreement.log'), log.filter((l) => l.startsWith(slug)).join('\n') + '\n');
    console.log(`${slug}: OK\n${log.filter((l) => l.startsWith(slug)).join('\n')}`);
  }
  console.log(`total spent $${spent.toFixed(4)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
