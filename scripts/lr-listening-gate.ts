// @ts-nocheck -- ponytail: offline tool over loosely-typed JSON (like lr-structure-check.ts).
// Deterministic (no network, no AI) gate for Listening tests: "is it too easy / same-format?"
// Usage: pnpm tsx scripts/lr-listening-gate.ts [slug|path ...]            (default: data/lr-generated/gen-l-01..10; exit 1 on any FAIL)
//        pnpm tsx scripts/lr-listening-gate.ts --cambridge [C15-T1 ...]  (calibration: numbers only, default all C11-19, exit 0)
//        pnpm tsx scripts/lr-listening-gate.ts --calib [slug ...]        (same numbers table for generated tests)
//        pnpm tsx scripts/lr-listening-gate.ts --cambridge --gate [..]   (run the full gate on Cambridge: how many would pass)
//        pnpm tsx scripts/lr-listening-gate.ts --selftest
// Rules live in brag-output/work/listening-analysis/WRITING-SPEC.md; thresholds are the constants below.
//
// Definitions (all computed on the test JSON `sections[].transcript`, lines "SPEAKER: text", no narrator):
//  words      whitespace tokens of the transcript field (speaker labels included).
//  label      for a gap question: the content line/row holding {{n}} (placeholders removed), else q.text.
//  overlap    per gap question: share of the label's content-word stems that occur within +-WIN tokens of the answer's
//             first spoken occurrence (at/after the previous answer). Part value = mean over its gap questions, in %.
//  qa         gap answer that is the reply (<=SHORT words) right after a question turn of another speaker (any wording).
//  direct echo  a turn that ends in a question ("?") and holds >=50% of the label's content stems, IMMEDIATELY followed by a
//             turn of another speaker with <=SHORT words that contains the answer and no correction marker. Counted per question.
//  volunteered  the answer is spoken inside a turn of more than SHORT words (given inside a longer turn, not as a reply).
//  correction   a correction marker ("sorry", "I mean", "no, it's", "actually", ...) in the answer's turn or the turn before.
//  lookalike    numeric answer with another, different number within +-40 tokens (nearby decoy value).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { canonAnswerText, expandAnswer, validateLrTest } from '../packages/core/src/lr';
import { checkPart, qinfos } from './lr-structure-check';

const ROOT = join(import.meta.dirname, '../data');
const WIN = +(process.env.WIN ?? 15), SHORT = +(process.env.SHORT ?? 40), EFRAC = +(process.env.EFRAC ?? 0.34), VOL = 25;
const WORDS: Record<number, [number, number]> = { 1: [600, 740], 2: [680, 800], 3: [760, 900], 4: [650, 780] };
// Cambridge 11-19 measured with this script (see WRITING-SPEC.md "Calibration"): ceilings = Cambridge mean + ~6 points.
const OVERLAP_MAX: Record<number, number> = { 1: 50, 4: 45 }; // C11-19 means: P1 40.4 (max 65), P4 33.3 (max 49); v1 means: P1 42.2, P4 56.1
const QA_MAX = 5; // P1: gap answers given as the reply right after a question; C11-19 mean 2.8, v1 mean 5.2
const ECHO_MAX: Record<number, number> = { 1: 3, 2: 2, 3: 2, 4: 2 };

const STOP = new Set('the and for with from that this than then into onto over under about after before while where when which what who whom whose how are was were been being has have had does did not but can could will would shall should may might must you your our their his her its they them there here very any some each per also only just one two out off all more most other such own new old first last next main type kind number name'.split(' '));
const stem = (w: string) => w.replace(/(ing|ed|es|s|ly)$/, '');
const nrm = (s: string) => canonAnswerText(s.replace(/\[[^\]]*\]/g, ' ')).replace(/[^a-z0-9']+/g, ' ').replace(/\s+/g, ' ').trim();
const toks = (s: string) => nrm(s).split(' ').filter(Boolean);
const contentStems = (s: string) => [...new Set(toks(s.replace(/\{\{\d+\}\}|\*\(example\)\*|\(example\)/g, ' ')).filter((w) => w.length >= 3 && !STOP.has(w) && !/\d/.test(w)).map(stem))];
const CORR = /\b(sorry|i mean|actually|oh,? wait|hang on|make that|no,? (it|that|i|we|sorry)|not .{1,25}\bbut\b|let me correct|i meant|correction|rather than|changed|instead)\b/i;
const HEDGE = /\b(perhaps|maybe|a bit|rather|quite|sort of|kind of|might|probably|i suppose|seems?|i guess|not sure|tend to)\b/i;
const DISAGREE = /\b(i don'?t (think|agree)|i'?m not (sure|convinced)|but i thought|i disagree|on the other hand|that'?s not (what|how|true|quite)|no,? i think|surely|but (isn'?t|aren'?t|don'?t|wouldn'?t))\b/i;
const ANNOUNCE = /\b(now,? (let'?s|shall we|we|i)|let'?s (move|turn|talk about|look at|go on)|moving on|turning to|shall we (move|turn|talk)|next,? (let'?s|we)|(move|turn|go) on to)\b/i;
const SIGNPOST = [/\b(question|answer)s?\s+(number\s+)?\d+\b/i, /(^|[.?!]\s+)number\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(is|was|would be)\b/i];

interface Turn { speaker: string; text: string }
function parse(tr: string): Turn[] {
  return tr.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^([A-Z][A-Za-z' .]{0,24}):\s+(.*)$/);
    return m ? { speaker: m[1].toUpperCase(), text: m[2] } : { speaker: 'X', text: l };
  }).filter((t) => t.speaker !== 'NARRATOR');
}
/** spoken variants of an answer as token arrays (incl. spelled-out letters) */
function variants(ans: string[]): string[][] {
  const out = new Map<string, string[]>();
  for (const a of ans) for (const v of expandAnswer(a)) {
    const t = toks(v);
    if (!t.length) continue;
    out.set(t.join(' '), t);
    if (t.length === 1 && /^[a-z]{4,}$/.test(t[0])) out.set([...t[0]].join(' '), [...t[0]]);
  }
  return [...out.values()];
}
const find = (hay: string[], needle: string[], from = 0) => { for (let i = from; i + needle.length <= hay.length; i++) if (needle.every((w, j) => hay[i + j] === w)) return i; return -1; };

/** question n -> label text (gap questions only) */
function labels(sec: any): Map<number, string> {
  const m = new Map<number, string>();
  for (const g of sec.groups) {
    if (g.type !== 'gap') continue;
    const lines = (g.content ?? '').split('\n');
    for (const q of g.questions) {
      const ln = lines.find((l: string) => l.includes(`{{${q.n}}}`));
      m.set(q.n, (ln ?? q.text ?? '').replace(/\{\{\d+\}\}/g, ' ').replace(/[|*#\-]/g, ' '));
    }
  }
  return m;
}
function layoutOf(g: any): string {
  const c = g.content ?? '', ins = (g.instructions ?? '').toLowerCase();
  if (/flow/.test(ins) || /[→↓]/.test(c)) return 'flow';
  if (/\bsentences?\b/.test(ins)) return 'sent';
  if (/summary/.test(ins)) return 'summ';
  if (/^\s*\|/m.test(c)) return 'table';
  if (/\bform\b/.test(ins) || /\bform\b/i.test(g.title ?? '')) return 'form';
  const heads = (c.match(/^\s*(#{1,6}\s|\*\*[^*]+\*\*:?\s*$)/gm) ?? []).length;
  return /^\s*[-*] .*:\s*\{\{/m.test(c) ? (heads > 1 ? 'labelnotes' : 'label') : heads > 1 ? 'notes' : 'plain';
}
/** format signature of a part: groups as type+size(+layout) */
function signature(sec: any): string {
  return sec.groups.map((g: any) => {
    const n = g.questions.length;
    if (g.type === 'gap') return g.options ? `box${n}/${g.options.length}` : `gap${n}:${layoutOf(g)}`;
    if (g.type === 'mcq') return `mcq${n}/${g.questions[0]?.options?.length ?? 0}`;
    if (g.type === 'mcq-multi') return `multi${n}of${g.options?.length ?? 0}`;
    if (g.type === 'match') return `match${n}/${g.options?.length ?? 0}${g.image ? ':map' : ''}${g.reusable ? ':re' : ''}`;
    return `${g.type}${n}`;
  }).join('+');
}

interface PartRes { part: number; words: number; sig: string; gaps: number; found: number; overlap: number | null; echo: number; qa: number; vol: number; corr: number; look: number; probs: string[]; warns: string[]; echoQ: number[]; }
function analyse(sec: any, probsOut = true): PartRes {
  const probs: string[] = [], warns: string[] = [];
  const part = sec.part, tr = sec.transcript ?? '';
  const turns = parse(tr);
  const words = tr.split(/\s+/).filter(Boolean).length;
  const flat: { t: string; turn: number }[] = [];
  turns.forEach((u, i) => toks(u.text).forEach((t) => flat.push({ t, turn: i })));
  const hay = flat.map((x) => x.t);
  const lab = labels(sec);
  const gapQs = sec.groups.filter((g: any) => g.type === 'gap' && !g.options).flatMap((g: any) => g.questions);
  let prev = 0, found = 0, ovSum = 0, ovN = 0, echo = 0, vol = 0, corr = 0, look = 0, qa = 0;
  const echoQ: number[] = [];
  for (const q of gapQs) {
    const vs = variants(q.answer ?? []);
    let at = -1, len = 0;
    for (const v of vs) { const i = find(hay, v, prev); if (i >= 0 && (at < 0 || i < at)) { at = i; len = v.length; } }
    if (at < 0) {
      const early = vs.some((v) => find(hay, v, 0) >= 0);
      probs.push(early ? `Q${q.n}: answer "${q.answer[0]}" is spoken only before Q${q.n - 1}'s (not in question order)` : `Q${q.n}: answer "${q.answer[0]}" not found in transcript`);
      continue;
    }
    found++; prev = at;
    const turn = flat[at].turn;
    // overlap
    const L = contentStems(lab.get(q.n) ?? '');
    if (L.length) {
      const win = new Set(hay.slice(Math.max(0, at - WIN), at + len + WIN).map(stem));
      ovSum += L.filter((w) => win.has(w)).length / L.length; ovN++;
      // direct echo: previous turn is a question holding >=50% of the label stems, this turn is short & answers
      const pt = turns[turn - 1], ct = turns[turn];
      if (pt && pt.speaker !== ct.speaker && /\?\s*$/.test(pt.text.trim()) && ct.text.split(/\s+/).length <= SHORT && !CORR.test(ct.text)) {
        const ps = new Set(toks(pt.text).map(stem));
        if (L.filter((w) => ps.has(w)).length / L.length   >= EFRAC) { echo++; echoQ.push(q.n); }
      }
    }
    if (turns[turn].text.split(/\s+/).length > VOL) vol++;
    { const pt = turns[turn - 1]; if (pt && pt.speaker !== turns[turn].speaker && /\?\s*$/.test(pt.text.trim()) && turns[turn].text.split(/\s+/).length <= SHORT) qa++; }
    if (CORR.test(turns[turn].text) || (turn > 0 && CORR.test(turns[turn - 1].text))) corr++;
    if ((q.answer ?? []).some((a) => /\d/.test(a))) {
      const nums = new Set(hay.slice(Math.max(0, at - 40), at + len + 40).filter((t) => /^\d+$/.test(t)));
      const own = new Set(hay.slice(at, at + len));
      if ([...nums].some((x) => !own.has(x))) look++;
    }
  }
  // structure: order + same-answer evidence (lenient: unlocated questions are handled above)
  const chk = checkPart(turns.map((t) => ({ speaker: t.speaker, text: t.text })), qinfos(sec), { lenient: true, checkSegments: false });
  chk.filter((p) => !/BEFORE|not in question order/.test(p) || !probs.some((x) => x.startsWith(p.slice(0, 4)))).forEach((p) => probs.push(p));
  // word count + signposting
  const [lo, hi] = WORDS[part] ?? [0, 1e9];
  if (words < lo || words > hi) probs.push(`words ${words} outside ${lo}-${hi}`);
  for (const t of turns) for (const re of SIGNPOST) if (re.test(t.text)) { probs.push(`signposting "${t.text.match(re)![0].trim()}" (names a question number)`); break; }
  // word-limit conformity
  for (const g of sec.groups) if (g.type === 'gap' && !g.options) for (const q of g.questions) {
    const a = (q.answer ?? [])[0] ?? '', w = (g.wordLimit ?? '').toUpperCase();
    const nw = a.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean).length, dig = /\d/.test(a);
    if (/ONE WORD ONLY/.test(w) && (nw !== 1 || dig)) probs.push(`Q${q.n}: "${a}" breaks ONE WORD ONLY`);
    else if (/ONE WORD AND\/OR A NUMBER/.test(w) && !dig && nw !== 1) probs.push(`Q${q.n}: "${a}" breaks ONE WORD AND/OR A NUMBER`);
    else if (/TWO WORDS/.test(w) && nw > 2 && !dig) probs.push(`Q${q.n}: "${a}" breaks the two-word limit`);
  }
  // group layout sanity
  for (const g of sec.groups) {
    if (g.type === 'mcq') for (const q of g.questions) if ((q.options?.length ?? 0) !== 3) probs.push(`Q${q.n}: mcq has ${q.options?.length ?? 0} options (Listening mcq uses 3)`);
    if (g.type === 'mcq-multi') {
      const k = g.questions.length;
      if ((g.options?.length ?? 0) < k + 3) probs.push(`group ${g.from}-${g.to}: choose-${k} needs >= ${k + 3} options`);
      if (g.questions.some((q: any) => new Set(q.answer.map((a: string) => a.toUpperCase())).size !== k)) probs.push(`group ${g.from}-${g.to}: answer set size != ${k}`);
    }
    if (g.type === 'match' && (g.options?.length ?? 0) <= g.questions.length && !g.reusable) probs.push(`group ${g.from}-${g.to}: matching box has no spare option`);
  }
  const overlap = ovN ? Math.round((ovSum / ovN) * 100) : null;
  // P1 overlap barely separates Cambridge from v1 (40 vs 42 mean) so it only warns; P4 separates well (33 vs 56) so it fails
  if (overlap !== null && OVERLAP_MAX[part] && overlap > OVERLAP_MAX[part]) (part === 4 ? probs : warns).push(`label overlap ${overlap}% > ${OVERLAP_MAX[part]}%`);
  if (gapQs.length && echo > ECHO_MAX[part]) probs.push(`direct echo ${echo} > ${ECHO_MAX[part]} (Q${echoQ.join(',Q')})`);
  if (part === 1 && gapQs.length >= 8) {
    if (qa > QA_MAX) probs.push(`${qa} of ${gapQs.length} answers are replies right after a question (field-by-field interview; max ${QA_MAX})`);
    if (vol < 4) probs.push(`only ${vol} answers volunteered inside longer turns (>= 4)`);
    if (corr < 2 || corr > 5) warns.push(`corrections ${corr} (target 2-4)`);
    if (look < 1) warns.push('no nearby lookalike value');
  }
  if (part === 2 && gapQs.length && look < 2 && gapQs.some((q) => /\d/.test(q.answer[0]))) warns.push(`lookalike numeric decoys ${look} (<2)`);
  if (part === 3) {
    const dis = turns.filter((t) => DISAGREE.test(t.text)).length, hed = turns.filter((t) => HEDGE.test(t.text)).length, ann = turns.filter((t) => ANNOUNCE.test(t.text)).length;
    if (dis < 3) warns.push(`disagreement markers ${dis} (< 3)`);
    if (hed < 2) warns.push(`hedging markers ${hed} (< 2)`);
    if (ann > 1) probs.push(`${ann} announced topic changes ("let's move on to...")`);
  }
  if (part === 4) {
    if (look < 2) warns.push(`numeric decoys ${look} (< 2)`);
    const nonNoun = gapQs.filter((q) => /(ing|ed|ly|ive|ous|al|ful|less|ic|ant|ent|able|ible)$/i.test(q.answer[0]) || /^(rapid|slow|early|late|rare|high|low|dry|wet|large|small|heavy|light|wide|thin|rough|smooth|fast|stable|gradual|sudden)/i.test(q.answer[0])).length;
    if (gapQs.length && nonNoun < 3) warns.push(`non-noun answers ~${nonNoun} (suffix heuristic, < 3)`);
  }
  return { part, words, sig: signature(sec), gaps: gapQs.length, found, overlap, echo, qa, vol, corr, look, probs: probsOut ? probs : [], warns, echoQ };
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
function loadTest(arg: string, cam: boolean) {
  const f = cam ? join(ROOT, 'cambridge-lr', `${arg}-listening.json`) : existsSync(arg) ? arg : join(ROOT, 'lr-generated', `${arg}.json`);
  return JSON.parse(readFileSync(f, 'utf8'));
}
const pad = (s: any, n: number) => String(s).padEnd(n);

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) return selftest();
  const cam = argv.includes('--cambridge'), calib = (cam && !argv.includes('--gate')) || argv.includes('--calib');
  const args = argv.filter((a) => !a.startsWith('--'));
  const camAll = readdirSync(join(ROOT, 'cambridge-lr')).map((f) => f.match(/^(C1[1-9]-T\d)-listening\.json$/)?.[1]).filter(Boolean);
  const list = args.length ? args : cam ? camAll : Array.from({ length: 10 }, (_, i) => `gen-l-${String(i + 1).padStart(2, '0')}`);
  const tests = list.map((a) => ({ id: a, t: loadTest(a, cam) }));

  if (calib) { // calibration: numbers only (--cambridge: C11-19 listening; --calib: any tests)
    const agg: Record<number, { ov: number[]; qa: number[]; echo: number[]; vol: number[]; corr: number[]; look: number[]; words: number[] }> = {};
    for (const { id, t } of tests) for (const s of t.sections) {
      const r = analyse(s);
      const a = (agg[r.part] ??= { qa: [], ov: [], echo: [], vol: [], corr: [], look: [], words: [] });
      if (r.overlap !== null) a.ov.push(r.overlap); a.echo.push(r.echo); a.qa.push(r.qa); a.vol.push(r.vol); a.corr.push(r.corr); a.look.push(r.look); a.words.push(r.words);
      console.log(`${pad(id, 8)} P${r.part} words=${r.words} gaps=${r.gaps} overlap=${r.overlap ?? '-'}% echo=${r.echo} qa=${r.qa} vol=${r.vol} corr=${r.corr} look=${r.look} sig=${r.sig}`);
    }
    const mean = (x: number[]) => (x.length ? (x.reduce((a, b) => a + b, 0) / x.length).toFixed(1) : '-');
    const mx = (x: number[]) => (x.length ? Math.max(...x) : '-');
    console.log('--- mean (max) per part');
    for (const p of Object.keys(agg)) { const a = agg[p]; console.log(`P${p}: overlap ${mean(a.ov)}% (${mx(a.ov)}) echo ${mean(a.echo)} (${mx(a.echo)}) qa-replies ${mean(a.qa)} (${mx(a.qa)}) volunteered ${mean(a.vol)} corr ${mean(a.corr)} lookalike ${mean(a.look)} words ${mean(a.words)}`); }
    return;
  }

  let fails = 0;
  const sigs: Record<number, Map<string, string[]>> = { 1: new Map(), 2: new Map(), 3: new Map(), 4: new Map() };
  const mix = { multiP2: 0, mapP2: 0, oneWord: 0, groupsWord: 0, digitAns: 0, gapAns: 0, p1notes: 0, p1: 0, histP4: 0 };
  const rows: string[] = [];
  const detail: string[] = [];
  for (const { id, t } of tests) {
    const slug = t.slug ?? id;
    const errs = validateLrTest(t);
    if (t.sections.length !== 4 || t.sections.some((s: any, i: number) => s.part !== i + 1)) errs.push('needs 4 listening sections, parts 1-4');
    const res = t.sections.map((s: any) => analyse(s));
    let bad = errs.length > 0;
    errs.forEach((e) => detail.push(`${slug}: ${e}`));
    for (const r of res) {
      bad = bad || r.probs.length > 0;
      r.probs.forEach((p) => detail.push(`${slug} P${r.part}: ${p}`));
      r.warns.forEach((p) => detail.push(`${slug} P${r.part}: (warn) ${p}`));
      (sigs[r.part].get(r.sig) ?? sigs[r.part].set(r.sig, []).get(r.sig)!).push(slug);
      rows.push(`${pad(slug, 9)} P${r.part} ${pad(r.words, 5)} ${pad(r.found + '/' + r.gaps, 6)} ${pad(r.overlap === null ? '-' : r.overlap + '%', 5)} ${pad(r.echo, 4)} ${pad(r.vol, 4)} ${pad(r.corr, 4)} ${pad(r.look, 4)} ${pad(r.probs.length ? 'FAIL' : r.warns.length ? 'warn' : 'ok', 5)} ${r.sig}`);
    }
    if (bad) fails++;
    const [s1, s2, s4] = [t.sections[0], t.sections[1], t.sections[3]];
    if (s2.groups.some((g: any) => g.type === 'mcq-multi')) mix.multiP2++;
    if (s2.groups.some((g: any) => g.image)) mix.mapP2++;
    for (const s of t.sections) for (const g of s.groups) if (g.type === 'gap' && !g.options) {
      mix.groupsWord++; if (/ONE WORD ONLY/i.test(g.wordLimit ?? '')) mix.oneWord++;
      for (const q of g.questions) { mix.gapAns++; if (/\d/.test(q.answer?.[0] ?? '')) mix.digitAns++; }
    }
    mix.p1++; if (s1.groups.some((g: any) => !/^(table|form|flow|sent|summ)$/.test(layoutOf(g)))) mix.p1notes++;
    if (/history/i.test((s4.groups[0]?.content ?? '').split('\n')[0] + (s4.groups[0]?.title ?? ''))) mix.histP4++;
    tests.find((x) => x.id === id)!.bad = bad;
  }
  console.log(`${pad('test', 9)} pt ${pad('words', 5)} ${pad('found', 6)} ${pad('ovlp', 5)} ${pad('echo', 4)} ${pad('vol', 4)} ${pad('corr', 4)} ${pad('look', 4)} ${pad('res', 5)} signature`);
  rows.forEach((r) => console.log(r));
  console.log('');
  detail.forEach((d) => console.log(d));

  // ---- set checks ----
  const n = tests.length, setProbs: string[] = [];
  if (n >= 2) {
    for (const p of [2, 3]) for (const [sig, who] of sigs[p]) if (who.length > 1) setProbs.push(`P${p} signature "${sig}" repeated in ${who.join(', ')}`);
  }
  if (n >= 8) {
    if (mix.multiP2 < Math.ceil(n * 0.4)) setProbs.push(`choose-TWO in Part 2 in ${mix.multiP2}/${n} tests (need >= ${Math.ceil(n * 0.4)})`);
    const lo = Math.floor(n * 0.4), hi = Math.ceil(n * 0.6);
    if (mix.mapP2 < lo || mix.mapP2 > hi) setProbs.push(`map/plan in Part 2 in ${mix.mapP2}/${n} tests (need ${lo}-${hi})`);
    const ow = pct(mix.oneWord, mix.groupsWord);
    if (ow < 45 || ow > 65) setProbs.push(`ONE WORD ONLY is ${ow}% of gap groups (need 45-65%)`);
    if (pct(mix.digitAns, mix.gapAns) > 12) setProbs.push(`digit answers ${pct(mix.digitAns, mix.gapAns)}% of gaps (need <= 12%)`);
    if (pct(mix.p1notes, mix.p1) < 50) setProbs.push(`Part 1 notes-style in ${mix.p1notes}/${mix.p1} tests (need >= 50%)`);
    if (mix.histP4 > 2) setProbs.push(`${mix.histP4} "history" lectures (max 2)`);
  }
  console.log(`\nset (${n} tests): P2 distinct signatures ${sigs[2].size}, P3 distinct ${sigs[3].size}, P1 distinct ${sigs[1].size}, P4 distinct ${sigs[4].size}; choose-TWO in P2 ${mix.multiP2}; map/plan in P2 ${mix.mapP2}; ONE WORD ONLY ${pct(mix.oneWord, mix.groupsWord)}% of gap groups; digit answers ${pct(mix.digitAns, mix.gapAns)}%; P1 notes ${mix.p1notes}/${mix.p1}; history P4 ${mix.histP4}`);
  setProbs.forEach((p) => console.log('SET FAIL: ' + p));
  console.log('');
  for (const x of tests) console.log(`${pad(x.t.slug ?? x.id, 9)} ${x.bad ? 'FAIL' : 'PASS'}`);
  const failed = fails + setProbs.length;
  console.log(`\n${failed ? 'FAIL' : 'PASS'}: ${fails}/${n} tests failed, ${setProbs.length} set-level problems`);
  process.exit(failed ? 1 : 0);
}

function selftest() {
  const q = (n: number, a: string) => ({ n, answer: [a] });
  const mk = (tr: string, content: string, qs: any[]) => ({ part: 1, transcript: tr, groups: [{ type: 'gap', wordLimit: 'ONE WORD ONLY', from: qs[0].n, to: qs.at(-1).n, instructions: '', content, questions: qs }] });
  const echoTr = 'A: What is your favourite sport?\nB: Squash.\nA: Which day suits you?\nB: Well I am free on most days of the week because my shifts finish quite late in the evening, so if I had to choose I would say Tuesday really.';
  const r = analyse(mk(echoTr, '- Favourite sport: {{1}}\n- Day: {{2}}', [q(1, 'squash'), q(2, 'Tuesday')]));
  const ok = r.echoQ[0] === 1 && r.vol === 1 && r.found === 2 && r.qa === 2; // Q1 is a short reply to a label question; Q2's reply is a long turn (volunteered)
  console.log(ok ? 'ok   echo/volunteered detection' : `FAIL ${JSON.stringify(r)}`);
  process.exit(ok ? 0 : 1);
}
main();
