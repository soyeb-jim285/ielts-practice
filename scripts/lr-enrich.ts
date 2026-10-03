// @ts-nocheck -- one-off offline job over untyped LLM JSON
// Precomputes review enrichment (evidence/why/wrong/paraphrase per question, vocab per section) for every L/R test.
// Usage: pnpm -F @ielts/server exec tsx ../../scripts/lr-enrich.ts [slug ...]   (default: all; resumable via enrich/.cache)
// Output (sidecars, data/ is gitignored): data/{cambridge-lr,lr-generated}/enrich/{slug}.json
//   { slug, questions: { "<n>": LrQuestionReview }, sections: { "<part>": { vocab } } }
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expandAnswer } from '../packages/core/src/lr';

try { process.loadEnvFile(join(import.meta.dirname, '../.env')); } catch { /* env may already be set */ }
const DATA = join(import.meta.dirname, '../data');
const MODEL = process.env.ENRICH_MODEL ?? 'openai/gpt-6-luna';
const BUDGET = 3.0;
const CONC = 3;
const COST_LOG = join(DATA, 'lr-enrich-cost.log');
let spent = existsSync(COST_LOG) ? +(readFileSync(COST_LOG, 'utf8').trim().split('\n').at(-1)?.match(/cum=([\d.]+)/)?.[1] ?? 0) : 0;

const ws = (s: string) => s.replace(/\s+/g, ' ').trim();
const lc = (s: string) => ws(s).toLowerCase();
const words = (s: string) => ws(s).split(' ').filter(Boolean).length;

async function llm(system: string, user: string): Promise<any> {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (spent >= BUDGET) throw new Error(`budget cap reached ($${spent.toFixed(4)})`);
    let res: Response;
    try {
      res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'X-Title': 'IELTS Practice lr-enrich' },
        body: JSON.stringify({ model: MODEL, temperature: 0.3, max_tokens: 12000, reasoning: { effort: 'low' }, usage: { include: true }, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
        signal: AbortSignal.timeout(300_000),
      });
    } catch (e) { console.warn('network error', (e as Error).message); continue; }
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 4000 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j: any = await res.json();
    const cost = +(j.usage?.cost ?? 0);
    spent += cost;
    appendFileSync(COST_LOG, `${new Date().toISOString()} ${MODEL} cost=${cost.toFixed(6)} cum=${spent.toFixed(6)}\n`);
    const text: string = j.choices?.[0]?.message?.content ?? '';
    try { return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { console.warn('unparseable JSON, retrying'); }
  }
  throw new Error('llm failed');
}

const SYSTEM = `You are an experienced IELTS Listening/Reading coach writing post-test review notes for learners. British spelling, plain, encouraging, exam-coach tone. Use ONLY the supplied test material; never mention anything beyond it.
Return ONE JSON object: {"questions":{"<n>":{"evidence":"...","why":"...","wrong":{"<optionKey>":"..."},"paraphrase":[["question wording","text wording"]]}},"vocab":[{"word":"...","meaning":"...","example":"..."}]}
Rules:
- One entry per question number given. "evidence": the exact sentence(s) copied VERBATIM, character for character, from the TEXT that give the answer (minimal, usually 1-2 sentences; for gap questions it must contain the answer). Omit it if no text is supplied or nothing in the text supports it (e.g. NOT GIVEN: quote the nearest related sentence or omit).
- "why": at most 45 words, 1-2 plain sentences: why the key is right - name the paraphrase, the distractor/trap, or the NOT GIVEN vs FALSE logic.
- "wrong": only for mcq / mcq-multi / match / tfng / ynng / word-box questions: one line (at most 30 words) for each WRONG option key (never the correct key). tfng keys: TRUE, FALSE, NOT GIVEN; ynng keys: YES, NO, NOT GIVEN. Omit "wrong" for ordinary gap-fill. For "Choose TWO" groups give each wrong option once under the first question of the group.
- "paraphrase": 1-3 pairs [question wording, text wording]; omit if not applicable.
- "vocab": 6-10 useful words/phrases from the text with a short learner-friendly meaning, and "example": the full sentence it appears in, copied VERBATIM from the text.
No markdown, no extra keys.`;

function qContext(sec: any): { text: string; hasText: boolean; qs: any[] } {
  let text = '';
  if (sec.transcript) text = sec.transcript;
  else if (sec.passage) text = sec.passage.paragraphs.map((p: any) => (p.label ? `[Paragraph ${p.label}]\n` : '') + p.text).join('\n\n');
  const qs: any[] = [];
  const lines = sec.groups.map((g: any) => {
    const head = [`### Questions ${g.from}-${g.to} (${g.type})`, g.instructions, g.title, g.content, g.options && `Shared options: ${g.options.map((o: any) => `${o.key}=${o.text}`).join(' | ')}`].filter(Boolean).join('\n');
    const body = g.questions.map((q: any) => {
      qs.push({ q, g });
      return `Q${q.n}${q.text ? ': ' + q.text : ''}${q.options ? ' OPTIONS: ' + q.options.map((o: any) => `${o.key}=${o.text}`).join(' | ') : ''} => KEY: ${q.answer.join(' / ')}`;
    });
    return head + '\n' + body.join('\n');
  });
  return { text, hasText: !!text, qs, ...{ lines } } as any;
}

/** Clean one question's review; returns undefined fields where checks fail. `strictEvidence` false => drop bad evidence. */
function check(raw: any, q: any, g: any, plain: string, hasText: boolean) {
  if (!raw || typeof raw !== 'object') return { out: {}, evidenceOk: !hasText };
  const out: any = {};
  let evidenceOk = !hasText;
  if (hasText && typeof raw.evidence === 'string' && raw.evidence.trim()) {
    const ev = ws(raw.evidence);
    const inText = plain.includes(ev);
    const ans = q.answer.flatMap(expandAnswer);
    const ansOk = g.type !== 'gap' || g.options || ans.some((a) => lc(ev).includes(a));
    if (inText && ansOk) { out.evidence = ev; evidenceOk = true; }
  }
  if (typeof raw.why === 'string' && raw.why.trim()) out.why = words(raw.why) > 45 ? raw.why.split(/\s+/).slice(0, 45).join(' ') : ws(raw.why);
  const keys = g.type === 'tfng' ? ['TRUE', 'FALSE', 'NOT GIVEN'] : g.type === 'ynng' ? ['YES', 'NO', 'NOT GIVEN']
    : q.options ? q.options.map((o: any) => o.key) : g.options ? g.options.map((o: any) => o.key) : [];
  const correct = new Set(q.answer.map((a: string) => a.toUpperCase()));
  if (raw.wrong && typeof raw.wrong === 'object' && keys.length) {
    const w: any = {};
    for (const [k, v] of Object.entries(raw.wrong)) {
      const key = keys.find((x: string) => x.toUpperCase() === k.toUpperCase());
      if (key && !correct.has(key.toUpperCase()) && typeof v === 'string' && v.trim() && words(v) <= 30) w[key] = ws(v);
    }
    if (Object.keys(w).length) out.wrong = w;
  }
  if (hasText && Array.isArray(raw.paraphrase)) {
    const p = raw.paraphrase.filter((x: any) => Array.isArray(x) && x.length === 2 && x.every((s) => typeof s === 'string' && s.trim())).slice(0, 3).map((x: any) => [ws(x[0]), ws(x[1])]);
    if (p.length) out.paraphrase = p;
  }
  return { out, evidenceOk };
}

async function enrichSection(slug: string, sec: any, cacheDir: string) {
  const f = join(cacheDir, `${slug}-p${sec.part}.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const ctx: any = qContext(sec);
  const plain = ws(ctx.text.replace(/\[Paragraph [^\]]+\]/g, ''));
  const user = `${ctx.hasText ? `TEXT (${sec.transcript ? 'recording transcript' : 'passage'}):\n${ctx.text}` : 'No text is available for this section: omit "evidence", "paraphrase" and "vocab"; base "why"/"wrong" on the questions and keys only.'}\n\nQUESTIONS:\n${ctx.lines.join('\n\n')}`;
  const questions: any = {};
  let vocab: any[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await llm(SYSTEM, user + (attempt ? '\n\nReminder: evidence MUST be copied exactly from the text, and for gap questions must contain the key.' : ''));
    for (const { q, g } of ctx.qs) {
      if (questions[q.n]?.evidenceOk) continue;
      const c = check(r.questions?.[q.n], q, g, plain, ctx.hasText);
      if (!questions[q.n] || c.evidenceOk || Object.keys(c.out).length > Object.keys(questions[q.n].out).length) questions[q.n] = c;
    }
    if (!vocab.length && ctx.hasText && Array.isArray(r.vocab)) {
      vocab = r.vocab.filter((v: any) => v?.word && v?.meaning).map((v: any) => {
        const ex = typeof v.example === 'string' ? ws(v.example) : '';
        return { word: ws(v.word), meaning: ws(v.meaning), ...(ex && plain.includes(ex) ? { example: ex } : {}) };
      }).slice(0, 10);
    }
    if (ctx.qs.every(({ q }) => questions[q.n]?.evidenceOk)) break;
  }
  const res = {
    questions: Object.fromEntries(Object.entries(questions).map(([n, c]: any) => [n, c.out]).filter(([, o]) => Object.keys(o).length)),
    vocab, ev: ctx.qs.filter(({ q }) => questions[q.n]?.out.evidence).length, total: ctx.qs.length, hasText: ctx.hasText,
  };
  writeFileSync(f, JSON.stringify(res));
  return res;
}

async function main() {
  const only = process.argv.slice(2);
  const jobs: any[] = [];
  for (const dir of ['cambridge-lr', 'lr-generated']) {
    for (const file of readdirSync(join(DATA, dir)).filter((x) => x.endsWith('.json')).sort()) {
      const t = JSON.parse(readFileSync(join(DATA, dir, file), 'utf8'));
      if (!t.sections || (only.length && !only.includes(t.slug))) continue;
      mkdirSync(join(DATA, dir, 'enrich/.cache'), { recursive: true });
      jobs.push({ dir, t });
    }
  }
  const stats = { tests: 0, questions: 0, evidence: 0, textQs: 0, noText: [] as string[] };
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const { dir, t } = jobs[next++];
      const cacheDir = join(DATA, dir, 'enrich/.cache');
      const out: any = { slug: t.slug, questions: {}, sections: {} };
      try {
        for (const sec of t.sections) {
          const r = await enrichSection(t.slug, sec, cacheDir);
          Object.assign(out.questions, r.questions);
          if (r.vocab.length) out.sections[sec.part] = { vocab: r.vocab };
          stats.questions += r.total; stats.evidence += r.ev;
          if (r.hasText) stats.textQs += r.total; else stats.noText.push(`${t.slug} p${sec.part}`);
        }
      } catch (e) { console.error(t.slug, (e as Error).message); if (/budget/.test((e as Error).message)) { next = jobs.length; } continue; }
      writeFileSync(join(DATA, dir, 'enrich', `${t.slug}.json`), JSON.stringify(out));
      stats.tests++;
      console.log(`${t.slug} ok  spent=$${spent.toFixed(3)}`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log(JSON.stringify(stats), `spent=$${spent.toFixed(4)}`);
}
main();
