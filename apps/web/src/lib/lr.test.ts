import { describe, expect, it } from 'vitest';
import { addHighlight, parseContent, parseRef, setMultiPicks, multiPicks, type LrGroup } from './lr';

describe('parseContent', () => {
  it('parses tables with gaps, lists and paragraphs', () => {
    const b = parseContent('Intro **bold** {{1}}\n\n| A | B |\n|---|---|\n| x | {{2}} |\n\n- one {{3}}\n- two');
    expect(b.map((x) => x.kind)).toEqual(['p', 'table', 'list']);
    const t = b[1] as Extract<(typeof b)[number], { kind: 'table' }>;
    expect(t.head).toHaveLength(2);
    expect(t.rows[0]![1]).toEqual([{ kind: 'gap', n: 2 }]);
    expect((b[2] as { items: unknown[] }).items).toHaveLength(2);
  });
});

describe('highlights', () => {
  it('merges overlapping ranges in a paragraph only', () => {
    let h = addHighlight([], { p: 0, s: 2, e: 6 });
    h = addHighlight(h, { p: 0, s: 5, e: 9 });
    h = addHighlight(h, { p: 1, s: 5, e: 9 });
    expect(h).toHaveLength(2);
    expect(h.find((x) => x.p === 0)).toEqual({ p: 0, s: 2, e: 9 });
  });
});

describe('choose-N slots', () => {
  const g = { questions: [{ n: 11 }, { n: 12 }] } as unknown as LrGroup;
  it('stores picks in order and clears unused slots', () => {
    expect(setMultiPicks(g, { '11': 'A', '12': 'C' }, ['C'])).toEqual({ '11': 'C' });
    expect(multiPicks(g, { '11': 'C' })).toEqual(['C']);
  });
});

it('parseRef', () => expect(parseRef('C17 T2')).toEqual({ book: 17, test: 2 }));

describe('multi-blank questions', () => {
  it('gives each blank of one question its own slot', async () => {
    const { numberGapParts, gapPart, setGapPart } = await import('./lr');
    expect(numberGapParts('from {{7}} to {{7}}, {{8}}')).toBe('from {{7:0:2}} to {{7:1:2}}, {{8}}');
    const b = parseContent('from {{7}} to {{7}}');
    expect(b[0]).toMatchObject({ inline: [{ text: 'from ' }, { n: 7, part: 0, of: 2 }, { text: ' to ' }, { n: 7, part: 1, of: 2 }] });
    let v = setGapPart('', 1, 2, '4.30');
    expect(v).toBe(' / 4.30');
    v = setGapPart(v, 0, 2, '10 ');
    expect([gapPart(v, 0), gapPart(v, 1)]).toEqual(['10 ', '4.30']);
    expect(setGapPart(' / x', 1, 2, '')).toBe('');
  });
});
