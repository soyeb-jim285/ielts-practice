// @ts-nocheck -- one-off generator over untyped LLM JSON
// Generates original IELTS Listening tests in the Cambridge pattern (docs/question-audit/listening.md) into data/lr-generated/ (gitignored).
// Usage: pnpm tsx scripts/gen-lr-listening.ts [slug ...]     (resumable: every LLM step is cached in data/lr-generated/.cache-l)
// Pipeline per part: writer -> script (+ map from scripts/lr-maps.ts) -> question groups -> gates (verbatim, word limit, structure)
// -> independent solver (different model) -> arbiter -> assemble + validate -> TTS script for scripts/gen-lr-elevenlabs.py.
// Add a test = add an entry to PLANS below (and a map to scripts/lr-maps.ts if a part uses one). Budget log: data/lr-generated/cost-listening.log.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expandAnswer, isCorrect, validateLrTest, type LrGroup, type LrSection, type LrTest } from '../packages/core/src/lr';
import { MAPS } from './lr-maps';

try { process.loadEnvFile(join(import.meta.dirname, '../.env')); } catch { /* env may already be set */ }
const OUT = join(import.meta.dirname, '../data/lr-generated');
const CACHE = join(OUT, '.cache-l');
for (const d of [CACHE, join(OUT, 'scripts'), join(OUT, 'assets/lr/gen/img')]) mkdirSync(d, { recursive: true });
const WRITER = 'openai/gpt-6-luna';
const SOLVER = 'deepseek/deepseek-v4.1-flash';
const ARBITER = 'qwen/qwen3.8-flash';
const BUDGET = +(process.env.LR_BUDGET ?? 0.6);
const COST_LOG = join(OUT, 'cost-listening.log');
let spent = existsSync(COST_LOG) ? +(readFileSync(COST_LOG, 'utf8').trim().split('\n').at(-1)?.match(/cum=([\d.]+)/)?.[1] ?? 0) : 0;
const log: string[] = [];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
type Kind = 'notes' | 'lnotes' | 'form' | 'table' | 'sentences' | 'mcq' | 'multi' | 'matchbox' | 'map';
type Plan = [Kind, number][];
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
    let j: any; try { j = await res.json(); } catch { continue; }
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

// ---------- Cambridge-pattern question kinds ----------
const GROUP_SHAPE = `Each group is a JSON object: {"from":int,"to":int,"type":"gap|mcq|mcq-multi|match","title"?:string,"content"?:string,"options"?:[{"key","text"}],"questions":[{"n":int,"text"?:string,"options"?:[{"key","text"}],"answer":[string]}]}. Do not write "instructions" or "wordLimit" (added by code). Optional words in an answer go in parentheses "(the) harbour"; genuinely acceptable alternatives are extra array entries.`;
const GAPRULES = 'Answers are copied VERBATIM from the transcript (exact word, digits as written there), ONE common word or a number in the vast majority (93% of real answers); never a Latin name, never a long technical phrase. Each answer is a different fact (no repeats), in the same order as the transcript, each fact said once (some after a correction by the speaker). The sentence around each gap must not contain the answer word and should paraphrase, not copy, the transcript where natural.';
const KIND: Record<Kind, string> = {
  notes: `type "gap" (note completion in the style of a real Cambridge exam). "title" = a short heading (e.g. "Advice on surfing holidays"). "content" = markdown: bold subheadings (**Heading**) and "- " bullet lines (or short label lines such as "Cost: £{{n}}"), each line carrying at most one {{n}} placeholder, gaps in transcript order, telegraphic note style (no full sentences, articles dropped). The FIRST line under the title is a pre-filled example, written "Example: <label> <value stated in the opening example exchange of the transcript>" (not a gap, not numbered). ${GAPRULES}`,
  lnotes: `type "gap" (lecture note completion in the style of a real Cambridge exam). "title" = the lecture topic as a short heading. "content" = markdown: 3-4 bold subheadings (**Heading**), under each 2-4 "- " bullets. Each bullet is a short note FRAGMENT that restates a point of the lecture with the gap placed inside the sentence (e.g. "Stoicism is still relevant today because of its {{n}} appeal.", "- ... despite not being intended for {{n}}"), NOT a "Label: {{n}}" pattern and NOT a definition. Some bullets carry no gap and give context. Gaps in lecture order. ${GAPRULES}`,
  form: `type "gap" (form completion). "title" = the form title in capitals (e.g. "LOST PROPERTY REPORT"). "content" = markdown: a bold section heading, then label lines "Name: {{n}}" / "Date of birth: ..." one per line, the first line "Example: <label> <pre-filled value stated in the transcript's opening exchange>", other lines may be pre-filled with already-known details (not tested). ${GAPRULES}`,
  table: `type "gap" (table completion). "title" = table title. "content" = a markdown table (header row, separator row, 3-5 body rows, 3 columns) with {{n}} placeholders inside cells and short text cells (notes style). If this is Part 1 add one pre-filled "Example" cell. ${GAPRULES}`,
  sentences: `type "gap" (note completion for a discussion). "title" = a short heading. "content" = markdown bullet notes, one {{n}} per bullet, gaps in transcript order. ${GAPRULES}`,
  mcq: 'type "mcq". Each question {n,text:stem (about 10 words),options:[{key:"A",text},{key:"B",text},{key:"C",text}],answer:["B"]}. EXACTLY THREE options, each about 5 words. The options are paraphrases/restatements, never lifted from the transcript; the right answer is only recognisable by understanding the speech (a reason, an opinion, a decision, a purpose), and each wrong option is mentioned or alluded to in the transcript but wrong (rejected, changed, or about something else). Never ask for a time/date/number look-up. Every stem is a complete, natural English question or sentence beginning (never telegraphic like "Why favour the reef?"); in Part 3 name who says it ("What does Tom say about...", "Priya and Tom agree that"). Vary the stem wording: some are incomplete sentences to be finished by the option (e.g. "The new exhibition focuses on"), others "What/How/Which ..." questions; at most TWO stems may begin with "Why". Vary the correct letters. Questions follow the transcript order.',
  multi: 'type "mcq-multi". "title" = the stem question beginning "Which TWO ... ?" (e.g. "Which TWO facilities have recently been improved?"). group.options = FIVE options A-E (about 6 words each, paraphrased). Exactly TWO questions (consecutive n) each with answer = the FULL set of the two correct letters (e.g. ["B","D"] on both). The three wrong options are discussed but rejected, or true of something else; the two right ones may be in either order in the transcript.',
  matchbox: 'type "match". "title" = a question about what the speakers say/decide about each item (e.g. "What opinion is expressed about each of the following food trends?"). group.options = a box of statements keyed from A, about 7 words each, count = number of questions + 2 (two never used); question text = a short item name (2-5 words) in the order discussed; answer = one letter; each letter used at most once; statements paraphrase the speakers\' view and cannot be matched by shared words.',
  map: '',
};
const NUMW: Record<number, string> = { 4: 'FOUR', 5: 'FIVE', 6: 'SIX', 7: 'SEVEN' };
const NOUN: Partial<Record<Kind, string>> = { notes: 'notes', lnotes: 'notes', form: 'form', table: 'table', sentences: 'notes' };
const LIMITS: Record<number, string> = {}; // from -> word limit of the gap group starting there
function finish(g: LrGroup, kind: Kind, from: number, to: number): LrGroup {
  fixShape(g, from, to);
  const q = `Questions ${from}–${to}.`;
  if (NOUN[kind]) {
    g.type = 'gap'; g.wordLimit = LIMITS[from];
    g.instructions = `${q} Complete the ${NOUN[kind]} below. Write ${g.wordLimit} for each answer.`;
  } else if (kind === 'mcq') {
    g.type = 'mcq'; g.instructions = `${q} Choose the correct letter, A, B or C.`;
  } else if (kind === 'multi') {
    g.type = 'mcq-multi'; g.instructions = `Questions ${from} and ${to}. Choose TWO letters, A–E. ${g.title ?? ''}`.trim(); delete g.title;
  } else if (kind === 'matchbox') {
    g.type = 'match'; g.reusable = false; const last = String.fromCharCode(64 + (g.options?.length ?? 8));
    g.instructions = `${q} ${g.title ?? ''} Choose ${NUMW[to - from + 1]} answers from the box and write the correct letter, A–${last}, next to Questions ${from}–${to}.`.replace(/\s+/g, ' '); delete g.title;
  }
  return g;
}
/** extra Cambridge-pattern gates, called from gates() */
function LGATES(sec: LrSection, add: (gi: number, m: string) => void) {
  sec.groups.forEach((g, gi) => {
    if (g.type === 'gap' && !g.options) {
      const seen = new Set<string>();
      for (const q of g.questions) {
        const a = (q.answer?.[0] ?? '').toLowerCase().replace(/\(.*?\)/g, '').trim();
        if (seen.has(a)) add(gi, `Q${q.n}: answer "${a}" duplicates another answer in the group`);
        seen.add(a);
      }
      for (const q of g.questions) { // the gap's own line must not give the answer away
        const line = (g.content ?? '').split('\n').find((l) => l.includes(`{{${q.n}}}`)) ?? q.text ?? '';
        const a = nrm((q.answer?.[0] ?? '').replace(/\(.*?\)/g, '')).trim();
        if (a && nrm(line.replace(/\{\{\d+\}\}/g, ' ')).includes(` ${a} `)) add(gi, `Q${q.n}: the answer word "${a}" already appears in its own note line`);
      }
      const multi = g.questions.filter((q) => (q.answer?.[0] ?? '').replace(/[£$€\d.,]/g, ' ').trim().split(/\s+/).filter(Boolean).length > 1).length;
      if (multi > 2) add(gi, `${multi} answers have more than one word; real tests use at most 1-2 per group, make the rest single words`);
      if (/Latin|[A-Z][a-z]+ [a-z]+ae\b/.test(g.questions.map((q) => q.answer?.[0]).join(' '))) add(gi, 'no Latin names');
    }
    if (g.type === 'gap' && g.from === 1 && !/example/i.test(g.content ?? '')) add(gi, 'Part 1 needs a pre-filled "Example:" line');
    if (g.type === 'mcq' && g.questions.filter((q) => /^why\b/i.test(q.text ?? '')).length > 2) add(gi, 'at most two stems may start with Why; vary the stems');
    if (g.type === 'mcq') for (const q of g.questions) if ((q.options?.length ?? 0) !== 3) add(gi, `Q${q.n}: mcq needs exactly three options A-C`);
    if (g.type === 'mcq-multi' && (g.options?.length ?? 0) !== 5) add(gi, 'Choose TWO needs exactly five options A-E');
    if (g.type === 'match' && !g.image) {
      const n = g.questions.length;
      if (!g.options || g.options.length < n + 1 || g.options.length > n + 3) add(gi, `matching box needs ${n + 2} options`);
      const used = g.questions.map((q) => q.answer?.[0]);
      if (new Set(used).size !== used.length) add(gi, 'each box option may be used once only');
    }
  });
}
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
  LGATES(sec, add);
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
  return finish(r.groups[0], kind, from, to);
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


// ---------- test plans (Cambridge mixes, see docs/question-audit/listening.md) ----------
interface PartPlan {
  topic: string; brief: string; intro: string; speakers: string;
  groups: { kind: Kind; n: number; limit?: string; map?: string }[];
  chunks: [number, number][]; // question ranges read before each stretch of the recording
}
const L1 = 'ONE WORD AND/OR A NUMBER', L2 = 'ONE WORD ONLY';
const PLANS: Record<string, PartPlan[]> = {
  'gen-l-01': [
    { topic: 'a woman phoning a holiday-cottage agency in North Yorkshire to enquire about and book a cottage', brief: 'Part 1: everyday telephone conversation, agent and customer; the agent notes details down.', intro: 'You will hear a woman telephoning a holiday cottage agency about booking a cottage.', speakers: 'AGENT (female or male) and CUSTOMER', groups: [{ kind: 'notes', n: 10, limit: L1 }], chunks: [[1, 5], [6, 10]] },
    { topic: 'a welcome talk by a volunteer to visitors at Millbrook Heritage Museum (opening arrangements, a school-holiday programme, special events, then a tour of the site)', brief: 'Part 2: monologue, a museum volunteer speaking to a group of visitors.', intro: 'You will hear a volunteer giving a talk to visitors at a heritage museum.', speakers: 'GUIDE', groups: [{ kind: 'mcq', n: 5 }, { kind: 'map', n: 5, map: 'millbrook' }], chunks: [[11, 15], [16, 20]] },
    { topic: 'two students, Priya and Tom, and their tutor discussing a marine biology project on coral bleaching', brief: 'Part 3: academic discussion; the tutor gives feedback on the students\' project plan and they decide how to proceed.', intro: 'You will hear two students, Priya and Tom, talking to their tutor about a marine biology project.', speakers: 'two students (one female, one male) and a TUTOR', groups: [{ kind: 'mcq', n: 4 }, { kind: 'matchbox', n: 6 }], chunks: [[21, 24], [25, 30]] },
    { topic: 'a university lecture on glass-making in the Roman empire', brief: 'Part 4: academic lecture, one speaker, no interruptions.', intro: 'You will hear a lecturer giving a talk about glass-making in the Roman empire.', speakers: 'LECTURER', groups: [{ kind: 'lnotes', n: 10, limit: L2 }], chunks: [[31, 40]] },
  ],
  'gen-l-02': [
    { topic: 'a man enrolling by phone on an evening Spanish course at a community college', brief: 'Part 1: everyday telephone conversation; the college administrator fills in an enrolment form.', intro: 'You will hear a man telephoning a college to enrol on an evening language course.', speakers: 'ADMINISTRATOR and CALLER (one female, one male)', groups: [{ kind: 'form', n: 10, limit: L1 }], chunks: [[1, 5], [6, 10]] },
    { topic: 'a ranger at Home Farm Park welcoming a school-trip group: what the day involves, rules, then the layout of the park', brief: 'Part 2: monologue by a farm-park ranger to a group of adults (teachers and helpers).', intro: 'You will hear a ranger at a farm park talking to a group of visiting teachers.', speakers: 'RANGER', groups: [{ kind: 'multi', n: 2 }, { kind: 'mcq', n: 3 }, { kind: 'map', n: 5, map: 'farm' }], chunks: [[11, 15], [16, 20]] },
    { topic: 'two psychology students, Hannah and Dev, discussing the design of an experiment on sleep and memory and the results they got', brief: 'Part 3: academic discussion between two students (no tutor) about their lab report.', intro: 'You will hear two psychology students, Hannah and Dev, discussing an experiment on sleep and memory.', speakers: 'two students (one female, one male)', groups: [{ kind: 'multi', n: 2 }, { kind: 'multi', n: 2 }, { kind: 'matchbox', n: 6 }], chunks: [[21, 24], [25, 30]] },
    { topic: 'a university lecture on urban heat islands', brief: 'Part 4: academic lecture, one speaker, no interruptions. The first 4 questions are multiple choice about the lecture\'s main points; the notes follow in lecture order.', intro: 'You will hear a lecturer giving a talk about urban heat islands.', speakers: 'LECTURER', groups: [{ kind: 'mcq', n: 4 }, { kind: 'lnotes', n: 6, limit: L2 }], chunks: [[31, 40]] },
  ],
  'gen-l-03': [
    { topic: 'a woman reporting a lost rucksack to the lost-property office at a railway station', brief: 'Part 1: everyday conversation; the clerk fills in a table (item details, journey, contact details, charges).', intro: 'You will hear a woman reporting a lost bag at a railway station.', speakers: 'CLERK and PASSENGER (one female, one male)', groups: [{ kind: 'table', n: 10, limit: L1 }], chunks: [[1, 5], [6, 10]] },
    { topic: 'a librarian introducing the newly refurbished ground floor of Hollin Town Library to new members (membership, borrowing, events, then a tour of the ground floor)', brief: 'Part 2: monologue by a librarian at an open evening for new members.', intro: 'You will hear a librarian talking to new members about the refurbished town library.', speakers: 'LIBRARIAN', groups: [{ kind: 'mcq', n: 4 }, { kind: 'map', n: 6, map: 'library' }], chunks: [[11, 14], [15, 20]] },
    { topic: 'two business students, Maya and Callum, and their tutor planning a report on renewable energy options for small companies', brief: 'Part 3: academic discussion; the tutor reviews the students\' draft plan.', intro: 'You will hear two business students, Maya and Callum, talking to their tutor about a report.', speakers: 'two students (one female, one male) and a TUTOR', groups: [{ kind: 'mcq', n: 5 }, { kind: 'sentences', n: 5, limit: L2 }], chunks: [[21, 25], [26, 30]] },
    { topic: 'a university lecture on the migration of Arctic terns', brief: 'Part 4: academic lecture, one speaker, no interruptions.', intro: 'You will hear a lecturer giving a talk about the migration of Arctic terns.', speakers: 'LECTURER', groups: [{ kind: 'lnotes', n: 10, limit: L2 }], chunks: [[31, 40]] },
  ],
};

// ---------- script writer ----------
const STYLE = `Write natural spoken British English exactly like a Cambridge IELTS recording: contractions everywhere, short turns of 1-3 sentences (monologues: paragraphs of 70-110 words as separate turns), backchannels between speakers ("Right.", "OK.", "I see.", "Mmm.", "Sure.", "Yes, that's right."), the odd false start, "actually", "sorry". Nobody mentions forms, notes, questions or answers; nobody repeats the other person's last sentence unless it is a genuine check. Each tested fact is said ONCE, in the natural flow, by the character who would know it. Plain, friendly register; no purple prose; no lists of three adjectives.`;
const DISTRACT = `Distractor techniques (use several): a speaker corrects a value ("on the fourteenth... no, sorry, the fifteenth"); an option is proposed then rejected; two similar numbers/times are mentioned and only one answers; a plan is changed. Answers occur in question order.`;
const CUES = '[hesitates] [thoughtfully] [laughs] [sighs] [excited] [curious] [chuckles]';
function partPrompt(p: PartPlan, i: number, minW: number, maxW: number, qinfo: string, mapFacts?: string): string {
  const mono = /^(GUIDE|RANGER|LIBRARIAN|LECTURER)$/.test(p.speakers);
  return `Write the script of an original IELTS Listening ${p.brief} Topic: ${p.topic}. Speakers: ${p.speakers}.
${STYLE}
${DISTRACT}
Length: ${minW}-${maxW} words in total (count carefully; this is a hard requirement; aim for the middle of the range, about ${Math.round((minW + maxW) / 2)}).
${i === 0 ? `Part 1 specifics: the conversation OPENS with a short example exchange (3-4 turns) that establishes one detail (this is the pre-filled Example line); the caller/customer's surname or the key name is SPELLED letter by letter, in capitals with hyphens ("It's Hargreaves, H-A-R-G-R-E-A-V-E-S") exactly once; include one phone number or postcode in digits as it is said; at least 4 values are first given wrongly and then corrected. Ten tested details, all different, in the order they would be noted: ${qinfo}.` : ''}
${i === 1 ? `Part 2 specifics: speaker is addressing a live audience ("Welcome", "Before I hand over...", "OK, so that's..."), practical information first (arrangements, prices, rules, a change of plan), then the site walk-through. ${qinfo}` : ''}
${i === 2 ? `Part 3 specifics: the speakers disagree, hesitate, change their minds, refer to what was said in feedback or lectures; the tutor suggests rather than instructs. ${qinfo}` : ''}
${i === 3 ? `Part 4 specifics: a lecture with a clear opening ("Today I'd like to talk about..."), signposting ("There are three main factors..."), concrete nouns a listener can note down; ten key words (single common words, not technical jargon or Latin names) each said once with natural emphasis; at most one self-correction. ${qinfo}` : ''}
${mapFacts ? `MAP FACTS (the candidates see only the plan, never the facts below):\n${mapFacts}\nIn the walk-through the speaker names each ASKED place and says where it is using only relative position and printed landmarks, never the letters, and in the stated order. Do not mention places marked "not asked". Positions must follow the facts exactly.` : ''}
Output ONLY JSON: {"title":string,"speakers":[{"label":"UPPERCASE name or role",${mono ? '' : '"gender":"female|male"'}${mono ? '"gender":"female|male"' : ''}}],"turns":[{"speaker":label,"text":string,"cue"?:string}],"breakAfter":int,"exampleEnd":int}.
"cue" is an OPTIONAL performance direction from this list only: ${CUES}; use it on 4-7 turns in conversations and at most 3 in a monologue, only where a person would really hesitate, think, laugh or sigh; most turns have none. Never put a cue inside "text".
"breakAfter" = index of the last turn that belongs to the first question set (${p.chunks[0][0]}-${p.chunks[0][1]})${p.chunks[1] ? `; the facts for questions ${p.chunks[1][0]}-${p.chunks[1][1]} begin only after it; both halves are about equally long.` : ' (no break: single stretch, use -1).'}${i === 0 ? '\n"exampleEnd" = index of the last turn of the opening example exchange.' : '\nUse "exampleEnd": -1.'}`;
}

const NUM1 = (n: number) => n;
async function listeningPart(slug: string, i: number, p: PartPlan, start: number): Promise<{ section: LrSection; script: any }> {
  const id = `${slug}-p${i + 1}`;
  const total = p.groups.reduce((a, g) => a + g.n, 0);
  const mapG = p.groups.find((g) => g.kind === 'map');
  const map = mapG ? MAPS[mapG.map!] : undefined;
  const [minW, maxW] = [[620, 760], [680, 800], [760, 900], [650, 780]][i];
  let qinfo = '';
  if (i === 0) qinfo = p.groups[0].kind === 'form' ? 'details a college/office form asks for (name spelled, phone, date of birth or start date, address element, fee, course/level/time, a preference)' : p.groups[0].kind === 'table' ? 'details a lost-property table asks for (item, colour/contents, journey, date, station, contact, charge)' : 'details a booking enquiry notes (name spelled, phone, dates, number of people, price, facilities, extras)';
  if (i === 1) qinfo = `Part 2 questions: ${p.groups.filter((g) => g.kind !== 'map').map((g) => `${g.n} ${g.kind === 'multi' ? 'choose-TWO' : 'three-option multiple-choice'}`).join(' + ')} about the practical talk (reasons, changes, rules, recommendations), in order, before the site walk-through of ${map ? map.asked.length : 5} places.`;
  if (i === 2) qinfo = `Part 3 questions: ${p.groups.map((g) => `${g.n} ${g.kind}`).join(' + ')}; the matching/notes items come in the order the speakers discuss them.`;
  if (i === 3) qinfo = p.groups[0].kind === 'mcq' ? 'Questions 31-34 are multiple choice about main points in the first half; notes (6 gaps) follow in the second half.' : 'Notes for ten gaps, in lecture order.';
  let script!: any, fb = '';
  for (let a = 0; a < 5; a++) {
    script = await step(`${id}-script-v2-a${a}`, () => llm(WRITER, 'You write original IELTS Listening recordings as scripts. Output ONLY JSON.', fb + partPrompt(p, i, minW, maxW, qinfo, map ? map.facts + `\nASKED, in speaking order: ${map.asked.map(([l, n]) => n).join(', ')}.` : undefined)));
    for (const t of script.turns) { // tags belong in "cue" only: lift any bracket tag out of the text
      const m = String(t.text).match(/\[[^\]]+\]/g);
      if (m) { t.text = t.text.replace(/\s*\[[^\]]+\]\s*/g, ' ').trim(); t.cue ||= m[0]; }
      if (t.cue) { t.cue = `[${String(t.cue).replace(/[\[\]]/g, '').trim()}]`; if (!CUES.includes(t.cue)) delete t.cue; }
    }
    const w = words(script.turns.map((t: any) => t.text).join(' '));
    const probs: string[] = [];
    if (w < minW - 25 || w > maxW + 60) { probs.push(`${w} words (need ${minW}-${maxW})`); fb = `YOUR PREVIOUS ATTEMPT HAD ${w} WORDS. The target is ${Math.round((minW + maxW) / 2)} words: ${w > maxW ? 'cut it down, shorter turns, fewer asides' : 'lengthen it'}.\n`; }
    if (script.turns.some((t: any) => !script.speakers.some((s: any) => s.label === t.speaker))) probs.push('unknown speaker');
        if (i !== 1 && i !== 3 && script.turns.length < 36) probs.push('too few turns, make turns short');
    if (map) { const tx = script.turns.map((t: any) => t.text).join(' ').toLowerCase(); for (const [, n] of map.asked) if (!tx.includes(n.toLowerCase().replace(/[’']/g, '’').split(' ')[0])) probs.push(`asked place "${n}" not named`); if (/\bletter\b|\b(?:place|point|location|marked) [A-I]\b/.test(tx)) probs.push('must not give letters'); }
    if (p.chunks[1] && !(script.breakAfter > 3 && script.breakAfter < script.turns.length - 3)) probs.push('breakAfter out of range');
    if (probs.some((x) => /words/.test(x)) && a >= 1 && w > maxW) {
      const short = await step(`${id}-condense-a${a}`, () => llm(WRITER, 'You edit IELTS Listening scripts. Output ONLY JSON.', `Shorten this script to about ${Math.round((minW + maxW) / 2)} words (now ${w}) by cutting repetition, asides, over-long turns and filler. Keep the same speakers, the same facts, corrections, rejected options and the closing structure, keep the natural spoken tone and the cue fields. Return the same JSON shape (title, speakers, turns, breakAfter = index of the last turn before the second question set, exampleEnd). Script: ${JSON.stringify(script)}`));
      if (short?.turns?.length && words(short.turns.map((t: any) => t.text).join(' ')) <= maxW + 60) { script = short; probs.length = 0; }
    }
    if (!probs.length) break;
    console.warn(`  [${id}] script attempt ${a} rejected: ${probs.join('; ')}`);
    if (a === 4) throw new Error(`${id}: script failed gates`);
  }
  const transcript = script.turns.map((t: any) => `${t.speaker}: ${t.text}`).join('\n\n');
  const c: Ctx = { id, label: 'TRANSCRIPT', text: transcript, extra: map ? `PLAN FACTS: ${map.facts}` : '', part: String(start), sectionHint: 'Listening' };
  const codeGroups: Record<number, LrGroup> = {};
  let from = start;
  for (const g of p.groups) {
    if (g.limit) LIMITS[from] = g.limit;
    if (g.kind === 'map' && map) {
      const to = from + g.n - 1, kindWord = map.kind === 'plan' ? 'plan' : 'map';
      codeGroups[from] = {
        from, to, type: 'match', title: map.title.split(':')[0], instructions: `Questions ${from}–${to}. Label the ${kindWord} below. Write the correct letter, A–${map.letters.at(-1)}, next to Questions ${from}–${to}.`,
        reusable: false, image: `lr/gen/img/${slug}-q${from}.png`, options: map.letters.map((k) => ({ key: k, text: k })),
        questions: map.asked.map(([l, n], k) => ({ n: from + k, text: n, answer: [l] })),
      };
      const svg = join(CACHE, `${slug}-q${from}.svg`);
      writeFileSync(svg, map.svg);
      execFileSync('rsvg-convert', ['-w', '1000', '-o', join(OUT, `assets/lr/gen/img/${slug}-q${from}.png`), svg]);
    }
    from += g.n;
  }
  const plan: Plan = p.groups.map((g) => [g.kind, g.n]);
  const { groups, agree } = await refine(c, plan, [], codeGroups);
  // move the break so that the gap answers of each question set fall on the right side of it
  if (p.chunks[1]) {
    const hits = (a: string) => script.turns.map((t: any, k: number) => (nrm(t.text).includes(` ${nrm(a).trim()} `) ? k : -1)).filter((k: number) => k >= 0);
    const idx = (a: string) => (hits(a).length === 1 ? hits(a)[0] : -1); // only unambiguous answers locate the break
    const ids = (lo: number, hi: number) => groups.flatMap((g) => g.type === 'gap' && !g.image ? g.questions.filter((q) => q.n >= lo && q.n <= hi).map((q) => Math.min(...(q.answer ?? []).map(idx).filter((x) => x >= 0), 1e9)) : []).filter((x) => x < 1e9);
    const a = ids(...p.chunks[0]), b = ids(...p.chunks[1]);
    if (a.length && b.length) { const lo = Math.max(...a), hi = Math.min(...b); if (lo < hi) script.breakAfter = Math.max(lo, Math.min(script.breakAfter, hi - 1)); else console.warn(`  [${id}] answers straddle the break (${lo} >= ${hi})`); }
  }
  log.push(`${slug} listening part ${i + 1}: solver agreement ${agree}, ${words(transcript)} words`);
  return { section: { part: i + 1, title: `Part ${i + 1}`, audio: `lr/gen/${slug}-p${i + 1}.mp3`, transcript, groups }, script };
}

// ---------- ElevenLabs script (rubric + turns) for scripts/gen-lr-elevenlabs.py ----------
const NARRATOR = 'onwK4e9ZLuTAKqWW03F9'; // Daniel
const FEMALE = ['Xb7hH8MSUJpSbSDYk0k2' /* Alice */, 'pFZP5JQG7iQjIQuC4Bku' /* Lily */, 'MzqUf1HbJ8UmQ0wUsx2p' /* Katie */, '6fZce9LFNG3iEITDfqZZ' /* Charlotte */];
const MALE = ['JBFqnCBsd6RMkjVDRZzb' /* George */, '2UMI2FME0FFUFMlUoRER' /* Hugh */, 'jRAAK67SEFE9m7ci5DhD' /* Ollie */, 'IKne3meq5aSn9XLyUdCD' /* Charlie, Australian */];
const preRead = (nq: number) => (nq >= 10 ? 50 : nq >= 7 ? 30 : 20);
function ttsPart(slug: string, i: number, p: PartPlan, s: any, num: number) {
  const used = { female: 0, male: 0 };
  const voices: Record<string, string> = { NARRATOR };
  for (const sp of s.speakers) { const g = sp.gender === 'male' ? 'male' : 'female'; voices[sp.label] = (g === 'male' ? MALE : FEMALE)[(used[g]++ + num * 2 + i) % 4]; }
  const N = (text: string, pause?: number) => ({ speaker: 'NARRATOR', text, ...(pause ? { pause } : {}) });
  const q = ([a, b]: [number, number]) => `question${a === b ? '' : 's'} ${a}${b > a ? ` to ${b}` : ''}`;
  const kindWord = ['conversation', 'talk', 'discussion', 'lecture'][i];
  const out: any[] = [];
  if (i === 0) out.push(N('This is the IELTS Listening practice test. You will hear a number of different recordings and you will have to answer questions on what you hear. There will be time for you to read the instructions and questions, and you will have a chance to check your work. All the recordings will be played once only. The test is in four parts. Now turn to Part 1.', 3));
  out.push(N(`Part ${i + 1}. ${s.intro ?? p.intro} First you have some time to look at ${q(p.chunks[0])}.`, preRead(p.chunks[0][1] - p.chunks[0][0] + 1)));
  const ex = i === 0 ? s.exampleEnd : -1;
  if (ex >= 0) out.push(N('You will see that there is an example. On this occasion only, the conversation relating to this will be played first.', 1));
  s.turns.forEach((t: any, k: number) => {
    if (k === ex + 1 || (ex < 0 && k === 0)) { if (ex >= 0) out.push(N(`Now we shall begin. You should answer the questions as you listen, because you will not hear the recording a second time. Listen carefully and answer ${q(p.chunks[0])}.`, 1)); else out.push(N(`Now listen carefully and answer ${q(p.chunks[0])}.`, 1)); }
    out.push({ speaker: t.speaker, text: t.cue ? `${t.cue} ${t.text}` : t.text });
    if (p.chunks[1] && k === s.breakAfter) {
      out.push(N(`Before you hear the rest of the ${kindWord}, you have some time to look at ${q(p.chunks[1])}.`, p.chunks[1][1] - p.chunks[1][0] >= 5 ? 35 : 30));
      out.push(N(`Now listen and answer ${q(p.chunks[1])}.`, 1));
    }
  });
  out.push(i === 3 ? N('That is the end of the test. You now have one minute to check your answers.', 60) : N(`That is the end of Part ${i + 1}. You now have half a minute to check your answers.`, 30));
  return { part: i + 1, voices, turns: out };
}

// ---------- main ----------
async function main() {
  const want = process.argv.slice(2);
  for (const slug of Object.keys(PLANS).filter((s) => !want.length || want.includes(s))) {
    const final = join(OUT, `${slug}.json`);
    if (existsSync(final) && !process.env.REGEN) { console.log(`${slug}: done (REGEN=1 to rebuild)`); continue; }
    console.log(`== ${slug} (spent $${spent.toFixed(4)})`);
    const num = +slug.match(/(\d+)$/)![1];
    let n = 1;
    const starts = PLANS[slug].map((p) => { const a = n; n += p.groups.reduce((x, g) => x + g.n, 0); return a; });
    const parts = await Promise.all(PLANS[slug].map((p, i) => listeningPart(slug, i, p, starts[i])));
    const test: LrTest = { slug, skill: 'listening', variant: 'academic', source: 'generated', ref: `Original L${num}`, title: `Original practice · Listening ${num}`, sections: parts.map((x) => x.section) };
    for (const [i, x] of parts.entries()) x.script.intro = PLANS[slug][i].intro;
    const errs = validateLrTest(test);
    if (errs.length) { console.error(`${slug}: INVALID`, errs); writeFileSync(join(OUT, `${slug}.invalid.json`), JSON.stringify(test, null, 2)); continue; }
    writeFileSync(join(OUT, 'scripts', `${slug}.json`), JSON.stringify({ slug, parts: parts.map((x, i) => ttsPart(slug, i, PLANS[slug][i], x.script, num)) }, null, 2));
    writeFileSync(final, JSON.stringify(test, null, 2));
    appendFileSync(join(OUT, 'solver-agreement.log'), log.filter((l) => l.startsWith(slug)).join('\n') + '\n');
    console.log(`${slug}: OK\n${log.filter((l) => l.startsWith(slug)).join('\n')}`);
  }
  console.log(`total spent $${spent.toFixed(4)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
