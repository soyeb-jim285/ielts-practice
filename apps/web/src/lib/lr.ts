import { queryOptions } from '@tanstack/react-query';
import { lrTypeLabel } from '@ielts/core';
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
export const lrProgressQuery = queryOptions({ queryKey: ['lr-progress'], queryFn: () => call(client.GET('/api/lr/progress')), staleTime: 60_000 });
export const lrAttemptsQuery = queryOptions({ queryKey: ['lr-attempts'], queryFn: () => call(client.GET('/api/lr/attempts')), staleTime: 0 });

/** Reading is 60 minutes; Listening exam: the checking time its recording announces (test.checkEndsAt), else the computer-delivered 2 minutes. */
export const READING_SECONDS = 3600;
export const LISTENING_REVIEW_SECONDS = 120;
/** Exam reading clock: 60 minutes for the whole test, 20 per passage when taking only some. */
export const readingSeconds = (parts?: number[] | null) => (parts?.length ? 1200 * parts.length : READING_SECONDS);

// ponytail: every test has 4 listening parts / 3 reading passages; the server rejects a part a test lacks
export const LR_PARTS: Record<LrSkill, number[]> = { listening: [1, 2, 3, 4], reading: [1, 2, 3] };
/** "Part 2", "Passages 1, 3", or "Full test" when parts is null. */
export const partsLabel = (skill: LrSkill, parts?: number[] | null) =>
  parts?.length ? `${skill === 'listening' ? 'Part' : 'Passage'}${parts.length > 1 ? 's' : ''} ${parts.join(', ')}` : 'Full test';

export type FlatQ = { n: number; part: number; group: LrGroup; q: LrQuestion };
export const flatQuestions = (t: LrTest): FlatQ[] => t.sections.flatMap((s) => s.groups.flatMap((g) => g.questions.map((q) => ({ n: q.n, part: s.part, group: g, q }))));

export const isAnswered = (r: LrResponses, n: number) => !!r[String(n)]?.trim();
export const answeredCount = (r: LrResponses, t: LrTest) => flatQuestions(t).filter((f) => isAnswered(r, f.n)).length;

export const typeLabel = (g: LrGroup): string => lrTypeLabel(g as Parameters<typeof lrTypeLabel>[0]);

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

export type Inline = { kind: 'text'; text: string } | { kind: 'bold'; text: string } | { kind: 'gap'; n: number; part?: number; of?: number };
export type Block =
  | { kind: 'p'; inline: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] };

/** One question with two blanks ("from {{7}} to {{7}}") → "{{7:0:2}} … {{7:1:2}}", so each blank gets its own input. */
export function numberGapParts(md: string): string {
  const total: Record<string, number> = {};
  for (const [, n] of md.matchAll(/\{\{(\d+)\}\}/g)) total[n!] = (total[n!] ?? 0) + 1;
  const seen: Record<string, number> = {};
  return md.replace(/\{\{(\d+)\}\}/g, (m, n: string) => (total[n]! > 1 ? `{{${n}:${(seen[n] = (seen[n] ?? -1) + 1)}:${total[n]}}}` : m));
}

/** The answer to a multi-blank question is stored as "part / part"; marking folds "/" to a space. */
export const gapPart = (v: string, part: number) => v.split(' / ')[part] ?? '';
export function setGapPart(v: string, part: number, of: number, text: string): string {
  const parts = Array.from({ length: of }, (_, i) => (i === part ? text : gapPart(v, i)));
  return parts.some((p) => p.trim()) ? parts.join(' / ') : '';
}

export function parseInline(s: string): Inline[] {
  return s
    .split(/(\{\{\d+(?::\d+:\d+)?\}\}|\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((p): Inline => {
      const g = /^\{\{(\d+)(?::(\d+):(\d+))?\}\}$/.exec(p);
      if (g) return g[2] ? { kind: 'gap', n: +g[1]!, part: +g[2], of: +g[3]! } : { kind: 'gap', n: +g[1]! };
      return p.startsWith('**') ? { kind: 'bold', text: p.slice(2, -2) } : { kind: 'text', text: p };
    });
}

export function parseContent(md: string): Block[] {
  const lines = numberGapParts(md).split('\n');
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

// ---- marks: highlights with optional notes, per attempt, on this device only (docs/exam-fidelity.md) ----
/** `region` is `passage:<part>:<paragraph>`, `q:<n>:<field>` or `grp:<groupFrom>:<field>`; s/e are offsets into that region's plain text. `p` is the paragraph (passage), question or group number. `text` is the marked excerpt for the Notes list (optional extension). */
export type LrMark = { id: string; region: string; p: number; s: number; e: number; note?: string; text?: string };
export const NOTE_MAX = 500;

export const newMarkId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const overlaps = (a: { s: number; e: number }, b: { s: number; e: number }) => a.s < b.e && b.s < a.e;

/** A plain highlight merges with overlapping plain highlights of its region; a mark with a note never merges. */
export function addMark(all: LrMark[], m: LrMark): LrMark[] {
  if (m.note) return [...all, m];
  const same = all.filter((x) => !x.note && x.region === m.region && x.s <= m.e && m.s <= x.e);
  const merged = { ...m, s: Math.min(m.s, ...same.map((x) => x.s)), e: Math.max(m.e, ...same.map((x) => x.e)) };
  return [...all.filter((x) => !same.includes(x)), merged];
}
/** The first noted mark a selection overlaps: selecting over it edits it instead of adding a mark. */
export const notedAt = (all: LrMark[], region: string, s: number, e: number) => all.find((x) => x.note && x.region === region && overlaps(x, { s, e }));
/** Sets (or, when blank, clears) a note; trimmed and capped at NOTE_MAX. */
export const setMarkNote = (all: LrMark[], id: string, note: string): LrMark[] =>
  all.map((x) => (x.id === id ? { ...x, note: note.trim().slice(0, NOTE_MAX) || undefined } : x));
export const removeMark = (all: LrMark[], id: string) => all.filter((x) => x.id !== id);

/** Cuts a region of `len` characters into runs, each with the marks that cover it (overlapping marks share runs). */
export function markRuns(len: number, marks: LrMark[]): { s: number; e: number; marks: LrMark[] }[] {
  const cuts = [...new Set([0, len, ...marks.flatMap((m) => [m.s, m.e])])].filter((c) => c >= 0 && c <= len).sort((a, b) => a - b);
  return cuts.slice(0, -1).map((s, i) => ({ s, e: cuts[i + 1]!, marks: marks.filter((m) => m.s <= s && m.e >= cuts[i + 1]!) }));
}

/** Reads stored marks defensively (storage is user-editable). */
export function parseMarks(raw: unknown): LrMark[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((m): m is LrMark => !!m && typeof m.id === 'string' && typeof m.region === 'string' && Number.isFinite(m.s) && Number.isFinite(m.e) && m.e > m.s);
}
/** Old passage highlights {p,s,e} become note-less passage marks, so earlier attempts keep theirs. */
export const migrateHighlights = (part: number, old: Highlight[]): LrMark[] =>
  old.filter((h) => Number.isFinite(h?.p) && h.e > h.s).map((h) => ({ id: `hl-${part}-${h.p}-${h.s}-${h.e}`, region: `passage:${part}:${h.p}`, p: h.p, s: h.s, e: h.e }));

// ---- reading countdown ----
/** Reading exam clock: flashes ~10 s at 10:00 and 5:00 left, warn tone from 10:00, strong from 5:00. Short partial attempts (limit <= 10 min) never warn. */
export function readingClock(left: number, limit: number): { tone: 'neutral' | 'warn' | 'bad'; flash: boolean } {
  if (limit <= 600 || left > 600) return { tone: 'neutral', flash: false };
  if (left > 300) return { tone: 'warn', flash: left > 590 };
  return { tone: 'bad', flash: left > 290 };
}
/** The announcement due when the countdown moves from `prev` to `now` seconds left (once per crossing, never on a resumed attempt that starts below it). */
export function clockAlert(prev: number | null, now: number, limit: number): string | null {
  if (prev === null || limit <= 600) return null;
  for (const m of [5, 10]) if (prev > m * 60 && now <= m * 60) return `${m} minutes remaining`;
  return null;
}

// ---- display settings (per device) ----
export type LrSettings = { size: 'std' | 'lg' | 'xl'; scheme: 'std' | 'bw' | 'cream' | 'yb' };
export const DEFAULT_SETTINGS: LrSettings = { size: 'std', scheme: 'std' };
export const SETTINGS_KEY = 'lr:settings';
export function parseSettings(raw: unknown): LrSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<LrSettings>;
  return {
    size: r.size === 'lg' || r.size === 'xl' ? r.size : 'std',
    scheme: r.scheme === 'bw' || r.scheme === 'cream' || r.scheme === 'yb' ? r.scheme : 'std',
  };
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
