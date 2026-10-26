import { z } from 'zod';
import { chatJson } from '../ai/openrouter.js';
import { ACTIONS } from './actions.js';
import type { ActionType, Candidate, CoachFacts, CoachWords } from './types.js';

const PRIMARY = 'openai/gpt-6-luna';
const FALLBACK = 'deepseek/deepseek-v4.1-flash';
const ACTION_TYPES = Object.keys(ACTIONS) as [ActionType, ...ActionType[]];

const WordsSchema = z.object({
  summary: z.string(),
  focus: z.array(z.object({ candidateId: z.string(), title: z.string(), why: z.string(), action: z.enum(ACTION_TYPES), label: z.string() })),
  win: z.string().nullable(),
  cheat: z.array(z.object({ candidateId: z.string(), text: z.string() })),
  plan: z.array(z.object({ day: z.string(), text: z.string(), action: z.enum(ACTION_TYPES) })),
});

const SYSTEM = `You write the coach page of NextBand, a practice app for English exam students. You are given FACTS as JSON, computed from the student's own tests. Your job is wording only.
Voice: plain, friendly, specific. Talk about the work and the next step, never about the person. No guilt, no praise inflation, no brand talk.
Rules:
- focus: pick up to 3 items from facts.candidates, by candidateId (the candidate "id"), at most 2 per skill. For each write a short title, a one-line why, an action chosen from that candidate's "actions", and a short label with no digits.
- summary: 2 or 3 sentences. The only numbers allowed are those in facts.overall, facts.skills[].band, facts.daysToExam and facts.target.
- win: one sentence only if facts.win is not null (candidateId = facts.win.id), else null. Use only numbers from facts.win and its skill in facts.skills.
- cheat: up to 5 short one-line checks, each with the candidateId it comes from.
- plan: 3 or 4 lines, each {day, text, action}. If facts.daysToExam is a number 14 or less, plan lines are full timed tests and reading the cheat sheet.
- Any number in a focus item or cheat line must appear in that candidate's facts, count or tests. Never invent numbers, examples, or advice that is not grounded in a candidate. Do not write minutes; they are added by the app.`;

const NUM = /\d+(?:\.\d+)?/g;
const nums = (s: string) => (s.match(NUM) ?? []).map(Number);
const okNums = (text: string, allowed: Set<number>) => nums(text).every((n) => allowed.has(n));
const candNums = (c: Candidate) => new Set([c.count, c.tests, ...Object.values(c.facts).flatMap((v) => nums(String(v)))]);
const skillBand = (f: CoachFacts, skill: string) => f.skills.find((s) => s.skill === skill);
const winNums = (f: CoachFacts) => {
  const w = f.win!;
  const s = skillBand(f, w.skill);
  return new Set([...candNums(w), ...(s?.band != null ? [s.band] : []), ...(s?.trendDelta != null ? [s.trendDelta, Math.abs(s.trendDelta)] : [])]);
};
const summaryNums = (f: CoachFacts) =>
  new Set([...(f.overall ? [f.overall.band, ...f.overall.range] : []), ...f.skills.flatMap((s) => (s.band != null ? [s.band] : [])), ...(f.daysToExam != null ? [f.daysToExam] : []), ...(f.target != null ? [f.target] : [])]);

const pretty = (kind: string) => kind.replace(/[-:]/g, ' ');
const lookup = (f: CoachFacts, id: string) => f.candidates.find((c) => c.id === id) ?? (f.win?.id === id ? f.win : undefined);
const allowedFor = (f: CoachFacts, c: Candidate) => (f.win && c.id === f.win.id ? winNums(f) : candNums(c));

// ---------- templates (no model) ----------

function templateFocus(c: Candidate): CoachWords['focus'][number] {
  const action = c.actions[0] ?? 'see-evidence';
  return { candidateId: c.id, title: `${c.skill[0]!.toUpperCase()}${c.skill.slice(1)}: ${pretty(c.kind)}`, why: `Came up ${c.count} times across ${c.tests} tests.`, action, label: ACTIONS[action].label };
}
const templateCheat = (c: Candidate) => ({ candidateId: c.id, text: `Before you finish, check for ${pretty(c.kind)}.` });

function templateWin(f: CoachFacts): string | null {
  if (!f.win) return null;
  const s = skillBand(f, f.win.skill);
  return s?.band != null ? `${f.win.skill[0]!.toUpperCase()}${f.win.skill.slice(1)} is moving the right way, now around band ${s.band}.` : `${pretty(f.win.kind)} has stopped showing up in your ${f.win.skill} tests.`;
}

function pickFocus(items: CoachWords['focus']): CoachWords['focus'] {
  const per: Record<string, number> = {};
  return items.filter((x) => {
    const sk = x.candidateId.split(':')[0]!;
    per[sk] = (per[sk] ?? 0) + 1;
    return per[sk] <= 2;
  }).slice(0, 3);
}

function templateSummary(f: CoachFacts): string {
  if (!f.overall) return 'Take a few more tests and NextBand will show where you stand.';
  const parts = [`Your recent tests put you around band ${f.overall.band}.`];
  if (f.target != null) parts.push(`Your target is ${f.target}.`);
  if (f.daysToExam != null) parts.push(`${f.daysToExam} days to your exam.`);
  return parts.join(' ');
}

export function templateWords(f: CoachFacts): CoachWords {
  const focus = pickFocus(f.candidates.map(templateFocus));
  const timed = f.daysToExam !== null && f.daysToExam <= 14;
  const skillTests: [string, ActionType][] = [['listening', 'listening-test'], ['reading', 'reading-test'], ['writing', 'write-task2'], ['speaking', 'speak-full']];
  const plan: CoachWords['plan'] = timed
    ? [...skillTests.filter(([s]) => skillBand(f, s)?.tests).slice(0, 3).map(([s, a], i) => ({ day: `Day ${i + 1}`, text: `Do a full timed ${s} test.`, action: a })), { day: 'Last day', text: 'Read your cheat sheet.', action: 'see-evidence' as const }]
    : focus.slice(0, 3).map((x, i) => ({ day: `Day ${i + 1}`, text: x.label, action: x.action }));
  if (!timed && f.reviewDue > 0) plan.push({ day: 'Any day', text: 'Review the items waiting in your saved deck.', action: 'review-deck' });
  return { summary: templateSummary(f), focus, win: templateWin(f), cheat: focus.slice(0, 5).map((x) => templateCheat(lookup(f, x.candidateId)!)), plan: plan.slice(0, 4) };
}

// ---------- validation ----------

export function validateWords(raw: CoachWords, f: CoachFacts): CoachWords {
  const tpl = templateWords(f);
  const focus = pickFocus(raw.focus.flatMap((x) => {
    const c = f.candidates.find((k) => k.id === x.candidateId);
    if (!c) return [];
    if (!okNums(`${x.title} ${x.why}`, candNums(c))) return [templateFocus(c)];
    const action = c.actions.includes(x.action) ? x.action : c.actions[0]!;
    const label = x.label.trim() && !/\d/.test(x.label) ? x.label : ACTIONS[action].label;
    return [{ ...x, action, label }];
  }));
  const cheat = raw.cheat.flatMap((x) => {
    const c = lookup(f, x.candidateId);
    return c ? [okNums(x.text, allowedFor(f, c)) ? x : templateCheat(c)] : [];
  }).slice(0, 5);
  const winOk = raw.win && f.win && okNums(raw.win, winNums(f));
  const plan = raw.plan.filter((p) => okNums(p.text, new Set([ACTIONS[p.action].minutes, ...summaryNums(f)]))).slice(0, 4);
  return {
    summary: okNums(raw.summary, summaryNums(f)) ? raw.summary : tpl.summary,
    focus: focus.length || !f.candidates.length ? focus : tpl.focus,
    win: !f.win ? null : winOk ? raw.win : tpl.win,
    cheat,
    plan: plan.length >= 3 ? plan : tpl.plan,
  };
}

// ---------- the model call ----------

export async function writeWords(f: CoachFacts): Promise<{ words: CoachWords; model: string | null }> {
  for (const model of [PRIMARY, FALLBACK]) {
    try {
      const raw = await chatJson({ model, system: SYSTEM, user: JSON.stringify({ facts: modelView(f) }), schema: WordsSchema, schemaName: 'coach_words', temperature: 0.3, effort: 'low', timeoutMs: 60_000, cost: { stage: 'coach' } });
      return { words: validateWords(raw, f), model };
    } catch (e) {
      console.error(`coach words failed on ${model}`, (e as Error).message);
    }
  }
  return { words: templateWords(f), model: null };
}

/** Only what the wording needs: ids, counts and numbers, not evidence ids or series. */
function modelView(f: CoachFacts) {
  const c = ({ id, kind, count, tests, facts, actions }: Candidate) => ({ id, kind, count, tests, facts, actions });
  return { target: f.target, daysToExam: f.daysToExam, overall: f.overall, skills: f.skills.map(({ skill, tests, band, trend, trendDelta, gap }) => ({ skill, tests, band, trend, trendDelta, gap })), reviewDue: f.reviewDue, candidates: f.candidates.map(c), win: f.win && c(f.win) };
}
