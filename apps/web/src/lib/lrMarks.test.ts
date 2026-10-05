import { describe, expect, it } from 'vitest';
import { addMark, clockAlert, markRuns, migrateHighlights, notedAt, parseMarks, parseSettings, readingClock, removeMark, setMarkNote, type LrMark } from './lr';

const m = (id: string, s: number, e: number, note?: string, region = 'passage:1:0'): LrMark => ({ id, region, p: 0, s, e, note });

describe('marks', () => {
  it('merges overlapping plain highlights of the same region only', () => {
    let all = addMark([], m('a', 2, 6));
    all = addMark(all, m('b', 5, 9));
    all = addMark(all, m('c', 5, 9, undefined, 'q:3:text'));
    expect(all.map((x) => [x.region, x.s, x.e])).toEqual([['passage:1:0', 2, 9], ['q:3:text', 5, 9]]);
  });
  it('never merges a noted mark, and does not absorb into one', () => {
    let all = addMark([], m('a', 2, 6, 'why'));
    all = addMark(all, m('b', 4, 9));
    all = addMark(all, m('c', 3, 5, 'second'));
    expect(all).toHaveLength(3);
    expect(all[0]!.note).toBe('why');
  });
  it('finds the noted mark a selection overlaps', () => {
    const all = [m('a', 2, 6, 'n'), m('b', 10, 12)];
    expect(notedAt(all, 'passage:1:0', 5, 8)?.id).toBe('a');
    expect(notedAt(all, 'passage:1:0', 6, 8)).toBeUndefined(); // touching is not overlapping
    expect(notedAt(all, 'passage:1:0', 10, 12)).toBeUndefined(); // plain marks merge instead
  });
  it('trims and caps a note; a blank note clears it', () => {
    const all = [m('a', 0, 3)];
    expect(setMarkNote(all, 'a', '  hi  ')[0]!.note).toBe('hi');
    expect(setMarkNote(all, 'a', 'x'.repeat(600))[0]!.note).toHaveLength(500);
    expect(setMarkNote([m('a', 0, 3, 'old')], 'a', '   ')[0]!.note).toBeUndefined();
    expect(removeMark(all, 'a')).toEqual([]);
  });
  it('splits a region into runs carrying the marks that cover each', () => {
    const a = m('a', 2, 6);
    const b = m('b', 4, 8, 'n');
    const runs = markRuns(10, [a, b]);
    expect(runs.map((r) => [r.s, r.e, r.marks.map((x) => x.id)])).toEqual([[0, 2, []], [2, 4, ['a']], [4, 6, ['a', 'b']], [6, 8, ['b']], [8, 10, []]]);
    expect(markRuns(5, [])).toEqual([{ s: 0, e: 5, marks: [] }]);
  });
  it('reads stored marks defensively', () => {
    expect(parseMarks(null)).toEqual([]);
    expect(parseMarks('x')).toEqual([]);
    expect(parseMarks([m('a', 1, 3), { id: 'bad' }, null, m('z', 5, 5)]).map((x) => x.id)).toEqual(['a']);
  });
  it('migrates old passage highlights to note-less passage marks', () => {
    const out = migrateHighlights(2, [{ p: 3, s: 4, e: 9 }, { p: 0, s: 5, e: 5 }]);
    expect(out).toEqual([{ id: 'hl-2-3-4-9', region: 'passage:2:3', p: 3, s: 4, e: 9 }]);
    expect(out[0]!.note).toBeUndefined();
  });
});

describe('reading clock', () => {
  it('is neutral above 10:00, warns from 10:00, strong from 5:00', () => {
    expect(readingClock(601, 3600)).toEqual({ tone: 'neutral', flash: false });
    expect(readingClock(600, 3600)).toEqual({ tone: 'warn', flash: true });
    expect(readingClock(591, 3600).flash).toBe(true);
    expect(readingClock(590, 3600)).toEqual({ tone: 'warn', flash: false });
    expect(readingClock(301, 3600)).toEqual({ tone: 'warn', flash: false });
    expect(readingClock(300, 3600)).toEqual({ tone: 'bad', flash: true });
    expect(readingClock(290, 3600)).toEqual({ tone: 'bad', flash: false });
    expect(readingClock(5, 3600).tone).toBe('bad');
  });
  it('does nothing when the whole limit is 10 minutes or less', () => {
    expect(readingClock(100, 600)).toEqual({ tone: 'neutral', flash: false });
    expect(clockAlert(700, 590, 600)).toBeNull();
  });
  it('partial attempts use the same absolute marks', () => {
    expect(readingClock(600, 1200).tone).toBe('warn');
  });
  it('announces each crossing once, not on a resumed attempt already past it', () => {
    expect(clockAlert(601, 600, 3600)).toBe('10 minutes remaining');
    expect(clockAlert(600, 599, 3600)).toBeNull();
    expect(clockAlert(301, 300, 3600)).toBe('5 minutes remaining');
    expect(clockAlert(null, 200, 3600)).toBeNull();
    expect(clockAlert(450, 449, 3600)).toBeNull();
  });
});

describe('settings', () => {
  it('falls back to the defaults for anything unknown', () => {
    expect(parseSettings(null)).toEqual({ size: 'std', scheme: 'std' });
    expect(parseSettings({ size: 'huge', scheme: 'neon' })).toEqual({ size: 'std', scheme: 'std' });
    expect(parseSettings({ size: 'xl', scheme: 'yb' })).toEqual({ size: 'xl', scheme: 'yb' });
    expect(parseSettings({ size: 'lg' })).toEqual({ size: 'lg', scheme: 'std' });
  });
});
