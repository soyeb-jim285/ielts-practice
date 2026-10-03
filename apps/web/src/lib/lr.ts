import { queryOptions } from '@tanstack/react-query';
import { call, client, type Schemas } from './api';

export type LrTest = Schemas['LrTest'];
export type LrSection = LrTest['sections'][number];
export type LrGroup = LrSection['groups'][number];
export type LrQuestion = LrGroup['questions'][number];
export type LrAttempt = Schemas['LrAttempt'];
export type LrResponses = Record<string, string>;
export type LrSkill = 'listening' | 'reading';

export const lrTestsQuery = (skill: LrSkill) =>
  queryOptions({ queryKey: ['lr-tests', skill], queryFn: () => call(client.GET('/api/lr/tests', { params: { query: { skill } } })), staleTime: 0 });
export const lrAttemptQuery = (id: string) =>
  queryOptions({ queryKey: ['lr-attempt', id], queryFn: () => call(client.GET('/api/lr/attempts/{id}', { params: { path: { id } } })), staleTime: Infinity });
export const lrAttemptsQuery = queryOptions({ queryKey: ['lr-attempts'], queryFn: () => call(client.GET('/api/lr/attempts')), staleTime: 0 });

/** Reading is 60 minutes; Listening exam has 2 minutes to check answers after the last recording. */
export const READING_SECONDS = 3600;
export const LISTENING_REVIEW_SECONDS = 120;

export type FlatQ = { n: number; part: number; group: LrGroup; q: LrQuestion };
export const flatQuestions = (t: LrTest): FlatQ[] => t.sections.flatMap((s) => s.groups.flatMap((g) => g.questions.map((q) => ({ n: q.n, part: s.part, group: g, q }))));

export const isAnswered = (r: LrResponses, n: number) => !!r[String(n)]?.trim();
export const answeredCount = (r: LrResponses, t: LrTest) => flatQuestions(t).filter((f) => isAnswered(r, f.n)).length;

/** "TRUE/FALSE/NOT GIVEN" etc: the heading a question type is reported under. */
export function typeLabel(g: LrGroup): string {
  switch (g.type) {
    case 'tfng': return 'True / False / Not Given';
    case 'ynng': return 'Yes / No / Not Given';
    case 'mcq': return 'Multiple choice';
    case 'mcq-multi': return 'Multiple choice (more than one)';
    case 'match': {
      if (g.image) return 'Labelling a map or diagram';
      const roman = g.options?.some((o) => /^[ivx]+$/i.test(o.key));
      return roman ? 'Matching headings' : 'Matching';
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

/** Accuracy per question type from the marks of a submitted attempt. */
export function accuracyBy(t: LrTest, marks: { n: number; correct: boolean }[], key: (f: FlatQ) => string) {
  const ok = new Map(marks.map((m) => [m.n, m.correct]));
  const out = new Map<string, { right: number; total: number }>();
  for (const f of flatQuestions(t)) {
    const k = key(f);
    const e = out.get(k) ?? { right: 0, total: 0 };
    e.total++;
    if (ok.get(f.n)) e.right++;
    out.set(k, e);
  }
  return [...out].map(([label, v]) => ({ label, ...v }));
}

/** Slots (question numbers) a choose-N group stores its picks in. */
export const multiSlots = (g: LrGroup) => g.questions.map((q) => q.n);
export const multiPicks = (g: LrGroup, r: LrResponses) => multiSlots(g).map((n) => r[String(n)]).filter((v): v is string => !!v);
/** Writes picks into the group's slots in order (empty slots are removed). */
export function setMultiPicks(g: LrGroup, r: LrResponses, picks: string[]): LrResponses {
  const next = { ...r };
  multiSlots(g).forEach((n, i) => {
    if (picks[i]) next[String(n)] = picks[i]!;
    else delete next[String(n)];
  });
  return next;
}

// ---- gap content markup: a small markdown subset (tables, lists, paragraphs, **bold**) with {{n}} placeholders ----

export type Inline = { kind: 'text'; text: string } | { kind: 'bold'; text: string } | { kind: 'gap'; n: number };
export type Block =
  | { kind: 'p'; inline: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] };

export function parseInline(s: string): Inline[] {
  return s
    .split(/(\{\{\d+\}\}|\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((p): Inline => {
      const g = /^\{\{(\d+)\}\}$/.exec(p);
      if (g) return { kind: 'gap', n: +g[1]! };
      return p.startsWith('**') ? { kind: 'bold', text: p.slice(2, -2) } : { kind: 'text', text: p };
    });
}

export function parseContent(md: string): Block[] {
  const lines = md.split('\n');
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]!.trim();
    if (!line) { i++; continue; }
    if (line.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        const cells = lines[i]!.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head = [], ...body] = rows;
      blocks.push({ kind: 'table', head: head.map(parseInline), rows: body.map((r) => r.map(parseInline)) });
    } else if (/^([-•*]|\d+[.)])\s/.test(line)) {
      const ordered = /^\d/.test(line);
      const items: Inline[][] = [];
      while (i < lines.length && /^([-•*]|\d+[.)])\s/.test(lines[i]!.trim())) items.push(parseInline(lines[i++]!.trim().replace(/^([-•*]|\d+[.)])\s+/, '')));
      blocks.push({ kind: 'list', ordered, items });
    } else {
      blocks.push({ kind: 'p', inline: parseInline(line) });
      i++;
    }
  }
  return blocks;
}

// ---- passage highlights ----
export type Highlight = { p: number; s: number; e: number };
/** Adds [s,e) to a paragraph's highlights, merging overlaps. */
export function addHighlight(all: Highlight[], h: Highlight): Highlight[] {
  const same = all.filter((x) => x.p === h.p && x.s <= h.e && h.s <= x.e);
  const merged = { p: h.p, s: Math.min(h.s, ...same.map((x) => x.s)), e: Math.max(h.e, ...same.map((x) => x.e)) };
  return [...all.filter((x) => !same.includes(x)), merged];
}

export function lsGet<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function lsSet(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // storage may be blocked; the feature just does not persist
  }
}

/** "C17 T2" → { book: 17, test: 2 } */
export const parseRef = (ref: string) => {
  const m = /^C(\d+)\s*T(\d+)/i.exec(ref);
  return m ? { book: +m[1]!, test: +m[2]! } : null;
};
