import { and, desc, eq, gt, lte, max, sql } from 'drizzle-orm';
import type { AnalysisResult } from '../ai/types.js';
import { db } from '../db/client';
import { analyses, attempts, cards, lrAttempts, lrTests, mistakes } from '../db/schema';
import { getSettings, storedSettings } from '../settings';
import { findWin, isPattern, overallFacts, pickCandidates, priority, skillFacts, spellRule, windowed } from './rules.js';
import type { ActionType, Candidate, CoachFacts, Evidence, Skill, SkillFacts, Swap, SpellGroup } from './types.js';

const SKILLS: Skill[] = ['listening', 'reading', 'writing', 'speaking'];
const DAY = 86_400_000;
const MIN_WORDS = 250; // Writing Task 2
const MANY_PAUSES = 3; // mid-clause pauses in one speaking test
const MANY_FILLERS = 4; // fillers per minute
const LATE_P3_S = 40 * 60; // Reading: passage 3 should start by minute 40 of 60
const ROWS = 300; // newest finished tests read per source (the window is 60 days / 15 tests per skill)

/** One test (kind '') or one thing that happened in a test. */
type Occ = {
  at: Date; skill: Skill; attemptId: string; kind: string;
  mistakeId?: string; n?: number; example?: string; amount?: number;
  from?: string; to?: string[]; source?: Swap['source']; typed?: string; correct?: string;
};
type Test = { at: Date; skill: Skill; attemptId: string; band: number | null; minutes: number; part?: number };

const dayOf = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);

// ---------- sources ----------

type WsRow = { id: string; skill: 'writing' | 'speaking'; part: number; at: Date; ms: number | null; overall: number; r: AnalysisResult };

async function loadWs(userId: string): Promise<WsRow[]> {
  // drop the big arrays (words, text) in SQL: the coach never reads them
  const rows = await db
    .select({ id: attempts.id, skill: attempts.skill, part: attempts.part, at: attempts.createdAt, ms: attempts.durationMs, overall: analyses.overall, r: sql<AnalysisResult>`${analyses.result} - 'words' - 'text' - 'rewrite'` })
    .from(attempts).innerJoin(analyses, eq(analyses.attemptId, attempts.id))
    .where(and(eq(attempts.userId, userId), eq(attempts.status, 'done'), gt(analyses.overall, 0)))
    .orderBy(desc(attempts.createdAt)).limit(ROWS);
  return rows as WsRow[];
}

async function loadLr(userId: string) {
  return db
    .select({ id: lrAttempts.id, skill: lrTests.skill, band: lrAttempts.band, at: lrAttempts.submittedAt, started: lrAttempts.startedAt, elapsedS: lrAttempts.elapsedS, parts: lrAttempts.parts, stats: lrAttempts.stats, analysis: lrAttempts.analysis })
    .from(lrAttempts).innerJoin(lrTests, eq(lrTests.id, lrAttempts.testId))
    .where(and(eq(lrAttempts.userId, userId), eq(lrAttempts.status, 'submitted')))
    .orderBy(desc(lrAttempts.submittedAt)).limit(ROWS);
}

async function loadMistakes(userId: string) {
  return db
    .select({ id: mistakes.id, attemptId: mistakes.attemptId, category: mistakes.category, original: mistakes.original, correction: mistakes.correction, skill: attempts.skill, at: attempts.createdAt })
    .from(mistakes).innerJoin(attempts, eq(attempts.id, mistakes.attemptId)).innerJoin(analyses, eq(analyses.attemptId, attempts.id))
    .where(and(eq(mistakes.userId, userId), eq(attempts.status, 'done'), gt(analyses.overall, 0)))
    .orderBy(desc(attempts.createdAt)).limit(1000);
}

export async function lastTestAt(userId: string): Promise<Date | null> {
  const [ws] = await db.select({ t: max(analyses.createdAt) }).from(analyses).innerJoin(attempts, eq(attempts.id, analyses.attemptId))
    .where(and(eq(attempts.userId, userId), eq(attempts.status, 'done'), gt(analyses.overall, 0)));
  const [l] = await db.select({ t: max(lrAttempts.submittedAt) }).from(lrAttempts).where(and(eq(lrAttempts.userId, userId), eq(lrAttempts.status, 'submitted')));
  const all = [ws?.t, l?.t].filter((x): x is Date => !!x);
  return all.length ? new Date(Math.max(...all.map((d) => d.getTime()))) : null;
}

// ---------- rows -> occurrences ----------

/** Maps a Writing/Speaking mistake category to a candidate kind (controller ruling R5). */
function mistakeKind(category: string): string {
  if (category === 'lexis.spelling') return 'spelling';
  if (category === 'lexis.collocation') return 'collocation';
  if (category === 'lexis.word-choice') return 'word-choice';
  if (category.startsWith('grammar.')) return category;
  if (category === 'pronunciation.word') return 'pronunciation';
  if (category === 'fluency.hesitation') return 'fluency-hesitation';
  return category;
}
const SWAP_CATEGORIES = ['lexis.collocation', 'lexis.word-choice', 'lexis.repetition'];

function wsOccs(rows: WsRow[]): Occ[] {
  return rows.flatMap((w): Occ[] => {
    const base = { at: w.at, skill: w.skill, attemptId: w.id };
    const r = w.r ?? ({} as AnalysisResult);
    const out: Occ[] = [];
    const bad = (r.structure?.paragraphs ?? []).filter((p) => !p.ok).length;
    for (let i = 0; i < bad; i++) out.push({ ...base, kind: 'ideas-undeveloped' });
    const words = r.textMetrics?.words;
    if (w.skill === 'writing' && w.part === 2 && words !== undefined && words < MIN_WORDS) out.push({ ...base, kind: 'under-length', amount: words });
    if (r.metrics && r.metrics.midClausePauses >= MANY_PAUSES) out.push({ ...base, kind: 'fluency-pauses', amount: r.metrics.midClausePauses });
    if (r.metrics && r.metrics.fillersPerMin >= MANY_FILLERS) out.push({ ...base, kind: 'fluency-fillers', amount: Math.round(r.metrics.fillersPerMin * 10) / 10 });
    for (const c of r.pronunciation?.audio?.confusions ?? []) out.push({ ...base, kind: `pronunciation-${c.expected}`, amount: c.count, example: `${c.expected} heard as ${c.heard}` });
    for (const q of r.relevance ?? []) if (q.development === 'none') out.push({ ...base, kind: 'answers-undeveloped' });
    for (const u of r.vocabUpgrades ?? []) out.push({ ...base, kind: '', from: u.original.toLowerCase(), to: u.better, source: 'upgrade' });
    for (const o of r.metrics?.lexical?.overused ?? []) out.push({ ...base, kind: '', from: o.word.toLowerCase(), to: [], source: 'overused', amount: o.count });
    return out;
  });
}

function mistakeOccs(rows: Awaited<ReturnType<typeof loadMistakes>>): Occ[] {
  return rows.flatMap((m): Occ[] => {
    const base = { at: m.at, skill: m.skill as Skill, attemptId: m.attemptId, mistakeId: m.id };
    const out: Occ[] = [{ ...base, kind: mistakeKind(m.category), example: `${m.original} -> ${m.correction}` }];
    if (SWAP_CATEGORIES.includes(m.category)) out.push({ ...base, kind: '', from: m.original.toLowerCase(), to: [m.correction], source: 'mistake' });
    if (m.category === 'lexis.spelling') out.push({ ...base, kind: '', typed: m.original, correct: m.correction });
    return out;
  });
}

function lrOccs(rows: Awaited<ReturnType<typeof loadLr>>): Occ[] {
  return rows.flatMap((l): Occ[] => {
    const base = { at: l.at ?? l.started, skill: l.skill as Skill, attemptId: l.id };
    const a = l.analysis;
    const out: Occ[] = [];
    for (const g of a?.gaps ?? []) {
      out.push({ ...base, kind: g.kind, n: g.n, ...(g.typed && g.word && { example: `${g.typed} -> ${g.word}` }) });
      if (g.kind === 'spelling' && g.typed && g.word) out.push({ ...base, kind: '', n: g.n, typed: g.typed, correct: g.word });
    }
    for (const t of a?.tfng ?? []) if (t.chose === 'FALSE' && t.answer === 'NOT GIVEN') out.push({ ...base, kind: 'tfng-false-for-ng', n: t.n });
    for (const t of a?.byType ?? []) if (t.total >= 5 && t.right / t.total < 0.6) out.push({ ...base, kind: `question-type:${t.label}`, amount: t.total - t.right });
    const p = l.stats?.partS;
    const start = p ? (p['1'] ?? 0) + (p['2'] ?? 0) : 0;
    if (l.skill === 'reading' && !l.parts && start > LATE_P3_S) out.push({ ...base, kind: 'passage-timing', amount: Math.round(start / 60) });
    return out;
  });
}

// ---------- occurrences -> facts ----------

const ACTIONS_BY_SKILL: Record<Skill, ActionType> = { writing: 'write-task2', speaking: 'speak-part', listening: 'listening-test', reading: 'reading-test' };
const needsDeck = (kind: string) => ['spelling', 'plural', 'collocation', 'word-choice'].includes(kind);
const uniq = <T,>(a: T[]) => [...new Set(a)];

function evidenceOf(occs: Occ[]): Evidence {
  const lrOcc = occs.filter((o) => o.n !== undefined && (o.skill === 'listening' || o.skill === 'reading'));
  const mistakeIds = uniq(occs.flatMap((o) => (o.mistakeId ? [o.mistakeId] : [])));
  return {
    attemptIds: uniq(occs.map((o) => o.attemptId)).slice(0, 10),
    ...(mistakeIds.length && { mistakeIds: mistakeIds.slice(0, 10) }),
    ...(lrOcc.length && { lr: lrOcc.slice(0, 10).map((o) => ({ attemptId: o.attemptId, n: o.n! })) }),
  };
}

/** Candidates for patterns among `occs`; `testCount[skill]` = how many tests those occurrences are shared out of. */
function candidatesOf(occs: Occ[], testCount: Record<Skill, number>, gapOf: (s: Skill) => number | null): Candidate[] {
  const groups = new Map<string, Occ[]>();
  for (const o of occs) if (o.kind) groups.set(`${o.skill}:${o.kind}`, [...(groups.get(`${o.skill}:${o.kind}`) ?? []), o]);
  return [...groups].filter(([, g]) => isPattern(g)).map(([id, g]) => {
    const { skill, kind } = g[0]!;
    const tests = uniq(g.map((o) => o.attemptId)).length;
    const share = tests / Math.max(testCount[skill], tests);
    const amounts = g.flatMap((o) => (o.amount === undefined ? [] : [o.amount]));
    const total = amounts.reduce((s, x) => s + x, 0);
    const examples = uniq(g.flatMap((o) => (o.example ? [o.example] : []))).slice(0, 2);
    const facts: Candidate['facts'] = {
      count: g.length, tests, outOf: testCount[skill],
      ...(amounts.length && (kind === 'passage-timing'
        ? { minutes: Math.round(total), averageMinutes: Math.round(total / amounts.length) }
        : { total: Math.round(total * 10) / 10, average: Math.round((total / amounts.length) * 10) / 10 })),
      ...Object.fromEntries(examples.map((e, i) => [`example${i + 1}`, e])),
    };
    return {
      id, skill, kind, count: g.length, tests, share, score: priority(gapOf(skill), share, kind), facts, evidence: evidenceOf(g),
      actions: [ACTIONS_BY_SKILL[skill], 'see-evidence', ...(needsDeck(kind) ? ['review-deck' as const] : [])],
    };
  });
}

function swapsOf(occs: Occ[]): Swap[] {
  const groups = new Map<string, Occ[]>();
  for (const o of occs) if (o.from && o.source) groups.set(`${o.skill}|${o.source}|${o.from}`, [...(groups.get(`${o.skill}|${o.source}|${o.from}`) ?? []), o]);
  // the student's own alternatives for a word, from mistakes and upgrades (never invented)
  const own = new Map<string, string[]>();
  for (const o of occs) if (o.from && o.source !== 'overused') own.set(o.from, uniq([...(own.get(o.from) ?? []), ...(o.to ?? [])]));
  return [...groups.values()]
    .filter((g) => uniq(g.map((o) => o.attemptId)).length >= 2)
    .map((g): Swap => {
      const { skill, source, from } = g[0]!;
      const to = (source === 'overused' ? own.get(from!) ?? [] : uniq(g.flatMap((o) => o.to ?? []))).slice(0, 3);
      const count = source === 'overused' ? g.reduce((s, o) => s + (o.amount ?? 0), 0) : g.length;
      return { id: `swap:${skill}:${source}:${from}`, skill: skill as 'writing' | 'speaking', from: from!, to, count, source: source!, evidence: evidenceOf(g) };
    })
    .sort((a, b) => b.count - a.count).slice(0, 8);
}

function spellingOf(occs: Occ[]): SpellGroup[] {
  const groups = new Map<SpellGroup['rule'], Occ[]>();
  for (const o of occs) if (o.typed && o.correct) { const r = spellRule(o.typed, o.correct); groups.set(r, [...(groups.get(r) ?? []), o]); }
  return [...groups].map(([rule, g]): SpellGroup => ({
    id: `spell:${rule}`, rule, count: g.length,
    examples: uniq(g.map((o) => `${o.typed}|${o.correct}`)).slice(0, 2).map((s) => { const [typed, correct] = s.split('|'); return { typed: typed!, correct: correct! }; }),
    evidence: evidenceOf(g),
  })).sort((a, b) => b.count - a.count).slice(0, 5);
}

function weekStatsOf(tests: Test[], now: Date, tz: string): CoachFacts['weekStats'] {
  const span = (from: number, to: number) => {
    const t = tests.filter((x) => x.at.getTime() > now.getTime() - to * DAY && x.at.getTime() <= now.getTime() - from * DAY);
    return { tests: t.length, minutes: Math.round(t.reduce((s, x) => s + x.minutes, 0)), days: new Set(t.map((x) => dayOf(x.at, tz))).size };
  };
  return { ...span(0, 7), prev: span(7, 14) };
}

function daysUntil(examDate: string | null, now: Date, tz: string): number | null {
  if (!examDate) return null;
  const d = Math.round((Date.parse(examDate) - Date.parse(dayOf(now, tz))) / DAY);
  return d < 0 ? null : d;
}

export async function buildFacts(userId: string, now: Date): Promise<CoachFacts> {
  const [settings, stored, wsRows, lrRows, mRows, [due]] = await Promise.all([
    getSettings(userId), storedSettings(userId), loadWs(userId), loadLr(userId), loadMistakes(userId),
    db.select({ n: sql<number>`count(*)::int` }).from(cards).where(and(eq(cards.userId, userId), lte(cards.due, now))),
  ]);
  const target = 'targetBand' in stored ? settings.targetBand : null;

  const tests: Test[] = [
    ...wsRows.map((w) => ({ at: w.at, skill: w.skill, attemptId: w.id, band: w.overall, minutes: (w.ms ?? 0) / 60000, part: w.part })),
    ...lrRows.map((l) => ({ at: l.at ?? l.started, skill: l.skill as Skill, attemptId: l.id, band: l.band, minutes: l.elapsedS / 60 })),
  ];
  const skills: SkillFacts[] = SKILLS.map((s) => {
    const scored = tests.filter((t) => t.skill === s && t.band !== null);
    const at = (a: Test[]) => a.map((t) => ({ at: t.at, band: t.band! }));
    // Writing: the band shows Task 1 and Task 2 combined; the trend (and so the win and the weekly band stat) uses Task 2 only (spec 7.2)
    const f = skillFacts(s, at(scored), target, s === 'writing' ? at(scored.filter((t) => t.part === 2)) : undefined);
    return { ...f, series: f.series.slice(-10) };
  });
  const gapOf = (s: Skill) => skills.find((x) => x.skill === s)!.gap;

  // one window over occurrences and tests together, so "newest 15 tests per skill" counts tests with no findings too
  const markers: Occ[] = tests.map((t) => ({ at: t.at, skill: t.skill, attemptId: t.attemptId, kind: '' }));
  const all = windowed([...markers, ...wsOccs(wsRows), ...mistakeOccs(mRows), ...lrOccs(lrRows)], now);
  const inWindow = all.filter((o) => o.kind === '' && !o.source && !o.typed);
  const occs = all.filter((o) => o.kind !== '' || o.source || o.typed);
  const recentTests = Object.fromEntries(SKILLS.map((s) => [s, inWindow.filter((o) => o.skill === s).sort((a, b) => b.at.getTime() - a.at.getTime()).map((o) => o.attemptId)])) as Record<Skill, string[]>;
  const countOf = (ids: (s: Skill) => string[]) => Object.fromEntries(SKILLS.map((s) => [s, ids(s).length])) as Record<Skill, number>;

  const candidates = candidatesOf(occs, countOf((s) => recentTests[s]), gapOf);
  const lastThree = new Set(SKILLS.flatMap((s) => recentTests[s].slice(0, 3).map((id) => `${s}:${id}`)));
  const older = candidatesOf(occs.filter((o) => !lastThree.has(`${o.skill}:${o.attemptId}`)), countOf((s) => recentTests[s].slice(3)), gapOf);

  const patterns = Object.fromEntries(SKILLS.map((s) => [s, candidates.filter((c) => c.skill === s).sort((a, b) => b.score - a.score).slice(0, 5)])) as Record<Skill, Candidate[]>;
  const p3 = lrRows.flatMap((l) => (l.skill === 'reading' && !l.parts && l.stats?.partS ? [(l.stats.partS['1'] ?? 0) + (l.stats.partS['2'] ?? 0)] : []));

  return {
    version: 1,
    generatedFor: userId,
    target,
    examDate: settings.examDate,
    daysToExam: daysUntil(settings.examDate, now, settings.timeZone),
    totalTests: tests.length,
    skills,
    overall: overallFacts(skills),
    candidates: pickCandidates(candidates),
    win: findWin(older, recentTests, skills),
    swaps: swapsOf(occs),
    spelling: spellingOf(occs),
    patterns,
    timing: p3.length ? { readingPassage3StartMin: Math.round(p3.reduce((s, x) => s + x, 0) / p3.length / 60) } : {},
    reviewDue: due?.n ?? 0,
    weekStats: weekStatsOf(tests, now, settings.timeZone),
  };
}
