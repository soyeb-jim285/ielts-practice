// @ts-nocheck -- ponytail: offline tool over loosely-typed JSON (like gen-lr.ts); strict index checks add noise, not safety. Behaviour is covered by running it on all tests.
// Deterministic (no AI) structure gate for Listening: answers must be SPOKEN IN QUESTION ORDER and each inside the
// segment the narrator announces for it ("look at questions X to Y" ... "Now listen and answer questions X to Y").
// Usage: pnpm tsx scripts/lr-structure-check.ts [slug ...]            (default gen-l-*; also checks word timings if present)
//        pnpm tsx scripts/lr-structure-check.ts --cambridge C10-T1 ...  (transcript only: answer ORDER)
// Also checks LAYOUT: narrator ranges vs on-screen blocks (see checkLayout).
// Exported: checkPart() is used as a generation gate by scripts/gen-lr-listening.ts.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { canonAnswerText, expandAnswer, type LrSection } from '../packages/core/src/lr';

export interface Turn { speaker: string; text: string; marks?: number[] } // marks: this turn gives the FINAL answer to these question numbers (for questions without enrich evidence)
const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
// Same folding as marking (numbers spoken as words → digits: "six fifteen" = 6.15, "fourteenth" = 14th, "thirty-five pounds" = £35), so time/date/price answers can be located.
const nrm = (s: string) => ` ${canonAnswerText(s.replace(/\[[^\]]*\]/g, ' ')).replace(/[^a-z0-9']+/g, ' ').replace(/\s+/g, ' ').trim()} `;
/** spoken variants of an answer: as written, digits as words */
function variants(a: string): string[] {
  const out = new Set<string>();
  for (const v of expandAnswer(a)) {
    const x = nrm(v);
    out.add(x);
    out.add(x.replace(/ (\d{1,2}) /g, (_, d) => ` ${NUM[+d] ?? d} `).replace(/^ (\d{1,2}) /, (_, d) => ` ${NUM[+d] ?? d} `));
  }
  return [...out].filter((v) => v.trim());
}

export interface Seg { from: number; to: number; start: number; end: number }
/** narrator announcements -> for each question set the turn range [start, end] in which its answers may be spoken */
export function segments(turns: Turn[]): Seg[] {
  const segs: Seg[] = [];
  const bound = (k: number) => { for (let j = k + 1; j < turns.length; j++) if (turns[j].speaker === 'NARRATOR' && /questions? \d+|end of (part|the test)/i.test(turns[j].text)) return j - 1; return turns.length - 1; };
  turns.forEach((t, k) => {
    if (t.speaker !== 'NARRATOR') return;
    for (const m of t.text.matchAll(/answer questions? (\d+)(?:\s*(?:to|and|-|–)\s*(\d+))?/gi)) segs.push({ from: +m[1], to: +(m[2] ?? m[1]), start: k + 1, end: bound(k) });
  });
  return segs;
}

interface Tk { toks: string[]; sent: number[] }
const tokenise = (raw: string): Tk => {
  const toks: string[] = [], sent: number[] = [];
  raw.replace(/\[[^\]]*\]/g, ' ').split(/(?<=[.!?])\s+/).forEach((s, i) => nrm(s).trim().split(' ').filter(Boolean).forEach((w) => { toks.push(w); sent.push(i); }));
  return { toks, sent };
};
const seq = (hay: string[], needle: string[], from = 0) => { for (let i = from; i + needle.length <= hay.length; i++) if (needle.every((w, j) => hay[i + j] === w)) return i; return -1; };
type Pos = [number, number]; // [turn, sentence]
const before = (a: Pos, b: Pos) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

/** evidence (may hold "SPEAKER: line" pieces) -> first/last turn and token index of its start */
function locateEvidence(ev: string, turns: Turn[], tk: Tk[]): { t0: number; i0: number; t1: number } | null {
  const pieces = ev.split(/(?:^|\s)[A-Z][A-Z' ]{1,25}:\s+/).map((p) => nrm(p).trim().split(' ').filter(Boolean)).filter((p) => p.length > 1);
  let at = 0, first = -1, i0 = 0;
  for (const p of pieces) {
    let i = -1, k = at;
    for (; k < turns.length; k++) if (turns[k].speaker !== 'NARRATOR' && (i = seq(tk[k].toks, p)) >= 0) break;
    if (k >= turns.length) for (k = 0; k < turns.length; k++) if (turns[k].speaker !== 'NARRATOR' && (i = seq(tk[k].toks, p)) >= 0) break;
    if (k >= turns.length) return null;
    if (first < 0) { first = k; i0 = i; }
    at = k;
  }
  return first < 0 ? null : { t0: first, i0, t1: at };
}

export interface QInfo { n: number; answer: string[]; multi?: boolean; gap?: boolean; evidence?: string }
/** problems for one part. `lenient`: questions that cannot be located are skipped (generation time, no review sidecar yet). */
export function checkPart(turns: Turn[], qs: QInfo[], opts: { lenient?: boolean; checkSegments?: boolean } = {}): string[] {
  const probs: string[] = [];
  const tk = turns.map((t) => tokenise(t.text));
  turns.forEach((t, k) => t.marks?.forEach((n) => { if (t.speaker === 'NARRATOR' || !qs.some((q) => q.n === n)) probs.push(`turn ${k}: marks Q${n} but ${t.speaker === 'NARRATOR' ? 'it is a narrator turn' : 'no such question'}`); }));
  const segs = opts.checkSegments === false ? [] : segments(turns);
  if (opts.checkSegments !== false && !segs.length) probs.push('no narrator "answer questions X to Y" lines found');
  const vsOf = (q: QInfo) => q.answer.flatMap(variants).map((v) => v.trim().split(' '));
  const findAns = (q: QInfo, from: Pos, to: number): { pos: Pos; end: number } | null => {
    const vs = vsOf(q);
    for (let k = from[0]; k <= to; k++) {
      if (turns[k].speaker === 'NARRATOR') continue;
      const hits = vs.map((v) => seq(tk[k].toks, v, k === from[0] ? from[1] : 0)).filter((i) => i >= 0);
      if (hits.length) return { pos: [k, tk[k].sent[Math.min(...hits)]], end: k };
    }
    return null;
  };
  let prev: Pos = [-1, 0], prevQ = 0, prevMulti = false;
  for (const q of qs) {
    let pos: Pos | null = null, end = 0;
    const mk = turns.findIndex((t) => t.marks?.includes(q.n));
    if (mk >= 0 && !q.evidence) { // author hint: this turn holds the answer
      pos = [mk, 0]; end = mk;
      if (q.gap && !/^[A-Z]$/.test(q.answer[0])) { const a = findAns(q, [mk, 0], mk); if (a) pos = a.pos; else probs.push(`Q${q.n}: answer "${q.answer[0]}" not inside the turn marked for it (turn ${mk})`); }
    } else if (q.evidence) {
      const e = locateEvidence(q.evidence, turns, tk);
      if (!e) { probs.push(`Q${q.n}: evidence not found verbatim in the script`); continue; }
      end = e.t1; pos = [e.t0, tk[e.t0].sent[e.i0]];
      if (q.gap && !/^[A-Z]$/.test(q.answer[0])) { const a = findAns(q, [e.t0, e.i0], e.t1); if (a) pos = a.pos; else probs.push(`Q${q.n}: answer "${q.answer[0]}" not inside its own evidence`); }
    } else if (q.gap) {
      // first spoken occurrence at/after the previous answer (a distractor before the answer is only detectable once evidence exists)
      const a = findAns(q, [Math.max(prev[0], 0), 0], turns.length - 1);
      if (!a) {
        const early = findAns(q, [0, 0], turns.length - 1);
        if (early) probs.push(`Q${q.n}: answer "${q.answer[0]}" is spoken only BEFORE Q${prevQ}'s answer (order violation)`);
        else if (!opts.lenient) probs.push(`Q${q.n}: answer "${q.answer[0]}" not found in the script`);
        continue; // lenient: answers spoken in another form (digits, inflection) cannot be located; skipped
      }
      pos = a.pos; end = a.end;
    } else if (!opts.lenient) { probs.push(`Q${q.n}: no review evidence to locate the answer`); continue; }
    if (!pos) continue;
    if (before(pos, prev) && !(q.multi && prevMulti)) probs.push(`Q${q.n}: answer spoken at turn ${pos[0]} sentence ${pos[1]}, BEFORE Q${prevQ}'s (turn ${prev[0]} sentence ${prev[1]}): not in question order`);
    else if (!before(pos, prev)) { prev = pos; prevQ = q.n; }
    prevMulti = !!q.multi;
    if (segs.length) {
      const s = segs.find((x) => q.n >= x.from && q.n <= x.to);
      if (!s) probs.push(`Q${q.n}: no narrator announcement covers this question`);
      else if (pos[0] < s.start || end > s.end) probs.push(`Q${q.n}: answer at turns ${pos[0]}-${end} is outside its announced segment (questions ${s.from}-${s.to}, turns ${s.start}-${s.end}) - ${pos[0] < s.start ? `spoken before the narrator says "answer questions ${s.from} to ${s.to}"` : 'spoken after the next narrator break'}`);
    }
  }
  return probs;
}

/** LAYOUT rule: narrator question ranges must coincide with the visual blocks on screen (question groups, and the bold/markdown
 *  sub-headings inside a gap group's `content`). Every narrator boundary falls on a block start; a sub-sectioned form is never split
 *  mid-section; announced ranges exist, tile the part and "look at" ranges equal "answer" ranges. A gap group with NO sub-headings
 *  (one long table/list) may be split anywhere. */
export function checkLayout(turns: Turn[], sec: LrSection): string[] {
  const probs: string[] = [];
  const segs = segments(turns);
  const have = new Set(sec.groups.flatMap((g) => g.questions.map((q) => q.n)));
  const ns = [...have].sort((a, b) => a - b);
  const look: [number, number][] = [];
  for (const t of turns) if (t.speaker === 'NARRATOR') for (const m of t.text.matchAll(/look at questions? (\d+)(?:\s*(?:to|and|-|–)\s*(\d+))?/gi)) look.push([+m[1], +(m[2] ?? m[1])]);
  for (const s of segs) for (const n of [s.from, s.to]) if (!have.has(n)) probs.push(`layout: narrator announces "questions ${s.from} to ${s.to}" but Q${n} does not exist in this part`);
  for (const [a, b] of look) if (!segs.some((s) => s.from === a && s.to === b)) probs.push(`layout: narrator "look at questions ${a} to ${b}" has no matching "answer questions ${a} to ${b}"`);
  segs.forEach((s, i) => { if (i && s.from !== segs[i - 1].to + 1) probs.push(`layout: narrator ranges ${segs[i - 1].from}-${segs[i - 1].to} and ${s.from}-${s.to} are not contiguous`); });
  if (segs.length && (segs[0].from !== ns[0] || segs[segs.length - 1].to !== ns[ns.length - 1])) probs.push(`layout: narrator ranges cover ${segs[0].from}-${segs[segs.length - 1].to} but the part has Q${ns[0]}-Q${ns[ns.length - 1]}`);
  // visual block starts; `free` = question numbers inside a heading-less gap group (splittable)
  const starts = new Set<number>(), free = new Set<number>(), desc: string[] = [];
  for (const g of sec.groups) {
    const qn = g.questions.map((q) => q.n).sort((a, b) => a - b);
    starts.add(qn[0]);
    const lines = (g.type === 'gap' ? (g.content ?? '') : '').split('\n');
    const isHead = (l: string) => /^\s*(#{1,6}\s+\S|\*\*[^*]+\*\*:?\s*$)/.test(l);
    let fresh = true; // first gap after a heading (or at the start) opens a block
    const parts: number[][] = [[]];
    for (const l of lines) {
      if (isHead(l)) { fresh = true; if (parts[parts.length - 1].length) parts.push([]); continue; }
      for (const m of l.matchAll(/\{\{(\d+)\}\}/g)) { if (fresh) starts.add(+m[1]); fresh = false; parts[parts.length - 1].push(+m[1]); }
    }
    const blocks = parts.filter((x) => x.length);
    if (blocks.length < 2 && g.type === 'gap') qn.slice(1).forEach((n) => free.add(n)); // no (or only a title) heading: one long form/table, splittable
    desc.push(blocks.map((x) => `${x[0]}-${x[x.length - 1]}`).join('|') || `${qn[0]}-${qn[qn.length - 1]}`);
  }
  for (const s of segs.slice(1)) if (!starts.has(s.from) && !free.has(s.from)) probs.push(`layout: narrator break before Q${s.from} (ranges ${segs.map((x) => `${x.from}-${x.to}`).join(', ')}) is not a visual boundary; on-screen blocks are ${desc.join(' , ')}`);
  return probs;
}

/** timing check: answer word must occur between the narrator "answer questions X to Y" time and the next narrator break */
export function checkTimings(tm: [string, number, number][], turns: Turn[], qs: QInfo[]): string[] {
  const w = tm.map((x) => nrm(x[0]).trim());
  const find = (seq: string[], from = 0) => { for (let i = from; i + seq.length <= w.length; i++) if (seq.every((s, j) => w[i + j] === s)) return i; return -1; };
  const nums = (n: number) => [String(n), NUM[n] ?? String(n)];
  const probs: string[] = [];
  const marks: { from: number; to: number; t: number }[] = [];
  let at = 0;
  for (const s of segments(turns)) {
    const i = [0, 1].map((a) => [0, 1].map((b) => find(['answer', 'questions', ...nums(s.from).slice(a, a + 1), 'to', ...nums(s.to).slice(b, b + 1)], at)).find((x) => x >= 0) ?? -1).find((x) => x >= 0) ?? -1;
    const j = i < 0 ? find(['answer', 'questions'], at) : i;
    if (j < 0) { probs.push(`timings: narrator "answer questions ${s.from} to ${s.to}" not found`); continue; }
    marks.push({ from: s.from, to: s.to, t: tm[j][1] }); at = j + 3;
  }
  const brk: number[] = []; // narrator "look at questions" / "end of part" times
  for (let i = 0; i + 3 < w.length; i++) if ((w[i] === 'look' && w[i + 1] === 'at' && w[i + 2].startsWith('question')) || (w[i] === 'that' && w[i + 1] === 'is' && w[i + 2] === 'the' && w[i + 3] === 'end')) brk.push(tm[i][1]);
  for (const q of qs) {
    const m = marks.find((x) => q.n >= x.from && q.n <= x.to);
    if (!m || !q.gap || !q.answer.some((x) => /^[a-z' -]{3,}$/i.test(x))) continue; // digits/letters are transcribed too variably to match
    const end = brk.find((b) => b > m.t) ?? Infinity;
    const toks = q.answer.flatMap(variants).map((v) => v.trim().split(' ')).filter((t) => t.join('').length > 1 || /\d/.test(t.join('')));
    const ok = toks.some((seq) => { for (let i = 0; i + seq.length <= w.length; i++) if (tm[i][1] > m.t && tm[i][1] < end && seq.every((s, j) => w[i + j] === s)) return true; return false; });
    const anywhere = toks.some((s2) => seq(w, s2) >= 0);
    if (!ok && anywhere) probs.push(`Q${q.n}: "${q.answer[0]}" not heard between narrator ${m.t.toFixed(1)}s and next break ${end.toFixed(1)}s`);
  }
  return probs;
}

export function qinfos(sec: LrSection, ev: Record<string, { evidence?: string }> = {}): QInfo[] {
  return sec.groups.flatMap((g) => g.questions.map((q) => ({ n: q.n, answer: q.answer ?? [], multi: g.type === 'mcq-multi', gap: g.type === 'gap', evidence: ev[q.n]?.evidence }))).sort((a, b) => a.n - b.n);
}


// ---------- self-test: pnpm tsx scripts/lr-structure-check.ts --selftest ----------
function selftest() {
  const N = (text: string): Turn => ({ speaker: 'NARRATOR', text }), P = (text: string, marks?: number[]): Turn => ({ speaker: 'A', text, marks });
  const gap = (from: number, to: number, content: string) => ({ type: 'gap', content, questions: Array.from({ length: to - from + 1 }, (_, i) => ({ n: from + i, answer: ['x'] })) });
  const mcq = (from: number, to: number) => ({ type: 'mcq', questions: Array.from({ length: to - from + 1 }, (_, i) => ({ n: from + i, answer: ['A'] })) });
  const sec = (...groups: any[]) => ({ part: 1, groups }) as any;
  const turns = (a: number, b: number, c: number, d: number): Turn[] => [N(`Part 1. First you have some time to look at questions ${a} to ${b}.`), N(`Now listen and answer questions ${a} to ${b}.`), P('hello'), N(`Now look at questions ${c} to ${d}.`), N(`Now listen and answer questions ${c} to ${d}.`), P('bye'), N('That is the end of Part 1.')];
  const form = '**Booking**\n- a: {{1}}\n- b: {{2}}\n- c: {{3}}\n- d: {{4}}\n- e: {{5}}\n- f: {{6}}\n**Costs**\n- g: {{7}}\n- h: {{8}}\n- i: {{9}}\n- j: {{10}}';
  const split = '**Booking**\n- a: {{1}}\n- b: {{2}}\n- c: {{3}}\n- d: {{4}}\n- e: {{5}}\n**Costs**\n- f: {{6}}\n- g: {{7}}\n- h: {{8}}\n- i: {{9}}\n- j: {{10}}';
  const cases: [string, string[], boolean][] = [
    ['gen-l-01 P1: narrator 1-5/6-10 vs on-screen 1-6|7-10', checkLayout(turns(1, 5, 6, 10), sec(gap(1, 10, form))), false],
    ['narrator 1-6/7-10 vs on-screen 1-6|7-10', checkLayout(turns(1, 6, 7, 10), sec(gap(1, 10, form))), true],
    ['narrator 1-5/6-10 vs on-screen 1-5|6-10', checkLayout(turns(1, 5, 6, 10), sec(gap(1, 10, split))), true],
    ['sub-section split mid-way (narrator break at 4)', checkLayout(turns(1, 3, 4, 10), sec(gap(1, 10, split))), false],
    ['single long table (title only) may be split', checkLayout(turns(1, 5, 6, 10), sec(gap(1, 10, '**Title**\n| a | {{1}} |\n| b | {{2}} |\n| c | {{3}} |\n| d | {{4}} |\n| e | {{5}} |\n| f | {{6}} |\n| g | {{7}} |\n| h | {{8}} |\n| i | {{9}} |\n| j | {{10}} |'))), true],
    ['two groups 1-5 / 6-10', checkLayout(turns(1, 5, 6, 10), sec(gap(1, 5, '- a {{1}}'), gap(6, 10, '- b {{6}}'))), true],
    ['announced range does not exist (1 to 11)', checkLayout(turns(1, 5, 6, 11), sec(gap(1, 10, split))), false],
    ['mcq group split across narrator break', checkLayout(turns(1, 3, 4, 5), sec(mcq(1, 5))), false],
    ['look-at range differs from answer range', checkLayout([N('First look at questions 1 to 4.'), N('Now listen and answer questions 1 to 5.'), P('x')], sec(gap(1, 5, '- a {{1}}'))), false],
    ['answers in order inside segments (marks)', checkPart(turns(1, 1, 2, 2), [{ n: 1, answer: ['A'] }, { n: 2, answer: ['B'] }], {}), false], // no evidence/marks -> cannot locate
  ];
  const t2 = turns(1, 1, 2, 2); t2[2].marks = [1]; t2[5].marks = [2];
  cases[cases.length - 1] = ['order+segments via marks', checkPart(t2, [{ n: 1, answer: ['A'] }, { n: 2, answer: ['B'] }]), true];
  const t3 = turns(1, 1, 2, 2); t3[2].marks = [2]; t3[5].marks = [1];
  cases.push(['marks out of order', checkPart(t3, [{ n: 1, answer: ['A'] }, { n: 2, answer: ['B'] }]), false]);
  const t4 = turns(1, 1, 2, 2); t4[2].marks = [1, 2];
  cases.push(['mark outside announced segment (Q2 answered in the Q1 segment)', checkPart(t4, [{ n: 1, answer: ['A'] }, { n: 2, answer: ['B'] }]), false]);
  let bad = 0;
  for (const [name, probs, wantOk] of cases) { const ok = (probs.length === 0) === wantOk; bad += ok ? 0 : 1; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${probs.length ? '  -> ' + probs[0] : ''}`); }
  process.exit(bad ? 1 : 0);
}

// ---------- CLI ----------
function main() {
  if (process.argv.includes('--selftest')) return selftest();
  const root = join(import.meta.dirname, '../data');
  const flags = process.argv.slice(2);
  const pi = flags.indexOf('--parts');
  const onlyParts = pi >= 0 ? flags[pi + 1].split(',').map(Number) : null; // --parts 1,2: only these parts
  const lenient = flags.includes('--lenient'), noTimings = flags.includes('--no-timings'); // pre-render gate: script text only
  const args = flags.filter((a, i) => !a.startsWith('--') && flags[i - 1] !== '--parts');
  let fails = 0;
  if (flags.includes('--cambridge')) {
    for (const ref of args) {
      const t = JSON.parse(readFileSync(join(root, 'cambridge-lr', `${ref}-listening.json`), 'utf8'));
      for (const sec of t.sections as LrSection[]) {
        const turns = (sec.transcript ?? '').split(/\n+/).filter(Boolean).map((l) => ({ speaker: 'X', text: l.replace(/^[^:]{1,30}:\s*/, '') }));
        const qs = qinfos(sec).filter((q) => q.gap);
        const p = checkPart(turns, qs, { lenient: true, checkSegments: false });
        fails += p.length ? 1 : 0;
        console.log(`${ref} P${sec.part}: ${p.length ? 'FAIL' : 'ok'} (${qs.length} gap answers)`);
        p.forEach((x) => console.log('   ' + x));
      }
    }
  } else {
    const slugs = args.length ? args : readdirSync(join(root, 'lr-generated')).filter((f) => /^gen-l-\d+\.json$/.test(f)).map((f) => f.slice(0, -5));
    for (const slug of slugs) {
      const G = join(root, 'lr-generated');
      const test = JSON.parse(readFileSync(join(G, `${slug}.json`), 'utf8'));
      const script = JSON.parse(readFileSync(join(G, 'scripts', `${slug}.json`), 'utf8'));
      const ev = existsSync(join(G, 'enrich', `${slug}.json`)) ? JSON.parse(readFileSync(join(G, 'enrich', `${slug}.json`), 'utf8')).questions : {};
      const tmf = join(G, 'timings', `${slug}.json`);
      const tms = existsSync(tmf) ? JSON.parse(readFileSync(tmf, 'utf8')).sections : {};
      for (const part of script.parts.filter((x: any) => !onlyParts || onlyParts.includes(x.part))) {
        const sec: LrSection = test.sections.find((s: LrSection) => s.part === part.part);
        const turns: Turn[] = part.turns;
        const probs = checkPart(turns, qinfos(sec, ev), { lenient });
        probs.push(...checkLayout(turns, sec));
        if (tms[part.part] && !noTimings) probs.push(...checkTimings(tms[part.part], turns, qinfos(sec, ev)));
        fails += probs.length ? 1 : 0;
        console.log(`${slug} P${part.part}: ${probs.length ? 'FAIL' : 'ok'}${tms[part.part] ? '' : ' (no timings)'}`);
        probs.forEach((x) => console.log('   ' + x));
      }
    }
  }
  process.exit(fails ? 1 : 0);
}
if (process.argv[1]?.endsWith('lr-structure-check.ts')) main();
