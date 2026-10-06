import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CriteriaStrip, Disclosure, FixList, formatRangeCapped, gapLine, RankedList, rankRows, ResultScaffold, ScoreHero, Section, SkillBandStrip, StatList, weakestSkill } from '.';

afterEach(cleanup);

describe('pure helpers', () => {
  it('gap line and tone', () => {
    expect(gapLine(6, 7)).toMatchObject({ lead: '1.0 below', tone: 'warn' });
    expect(gapLine(7.5, 7).lead).toBe('At or above');
    expect(gapLine(5, 7).tone).toBe('bad');
  });
  it('caps range at +-1 band', () => {
    expect(formatRangeCapped([4, 9], 6)).toBe('5–7');
    expect(formatRangeCapped([6.5, 6.5], 6.5)).toBe('6.5');
  });
  it('weakest skill needs two bands, first wins ties', () => {
    expect(weakestSkill([{ band: 6 }, { band: null }])).toBeNull();
    expect(weakestSkill([{ band: 7 }, { band: 6 }, { band: 6 }])).toBe(1);
  });
  it('ranks accuracy worst first and collapses perfect rows', () => {
    const r = rankRows([{ label: 'A', right: 5, total: 5 }, { label: 'B', right: 2, total: 5 }, { label: 'C', right: 3, total: 3 }, { label: 'D', right: 4, total: 5 }], 'accuracy');
    expect(r.shown.map((x) => x.label)).toEqual(['B', 'D']);
    expect(r.perfect).toHaveLength(2);
    expect(rankRows([{ label: 'A', right: 5, total: 5 }], 'accuracy', true).shown).toHaveLength(1);
  });
  it('count mode: no bars when all counts equal', () => {
    expect(rankRows([{ label: 'a', right: 1, total: 0 }, { label: 'b', right: 1, total: 0 }], 'count').bars).toBe(false);
  });
});

describe('components', () => {
  it('ScoreHero shows gap, likely range, estimate note; null shows emptyText', () => {
    render(<ScoreHero value={6} target={7} range={[4, 9]} estimate rawAverage={6.25} />);
    expect(screen.getByText(/1.0 below/)).toBeTruthy();
    expect(screen.getByText('likely 5–7, AI estimate')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'About this score' })).toBeTruthy();
    cleanup();
    render(<ScoreHero value={null} emptyText="Appears when marked" />);
    expect(screen.getByText('Appears when marked')).toBeTruthy();
  });
  it('RankedList collapses perfect rows into one line', () => {
    render(<RankedList mode="accuracy" rows={[{ label: 'Matching', right: 2, total: 4 }, { label: 'MCQ', right: 3, total: 3 }, { label: 'Gap fill', right: 2, total: 2 }]} />);
    expect(screen.getByText('MCQ and 1 other: all right')).toBeTruthy();
    expect(screen.getByText('2 of 4')).toBeTruthy();
  });
  it('FixList numbers items and offers one add-all action', () => {
    render(<FixList items={[{ title: 'Articles', why: 'w', before: 'a', after: 'b' }]} onAddAll={() => {}} />);
    expect(screen.getByRole('button', { name: 'Add all to review deck' })).toBeTruthy();
  });
  it('heading outline is h1 > h2 > h3 without skips', () => {
    render(
      <ResultScaffold
        title="Prompt"
        hero={<ScoreHero value={6.5} />}
        strip={<CriteriaStrip items={[{ key: 'a', label: 'Grammar', band: 6 }]} />}
        tabs={null}
      >
        <Section title="Summary">
          <CriteriaStrip layout="rows" items={[{ key: 'a', label: 'Grammar', band: 6, detail: 'x', weakest: true }]} />
        </Section>
        <Section title="Things to fix next">
          <FixList items={[{ title: 'Fix', why: 'w' }]} />
        </Section>
        <Section title="Time">
          <Disclosure title="How you used your time">
            <StatList items={[{ label: 'Part 1', value: '8 min' }]} />
          </Disclosure>
        </Section>
        <SkillBandStrip items={[{ skill: 'listening', band: 7 }, { skill: 'reading', band: 6 }, { skill: 'writing', band: null }]} />
      </ResultScaffold>,
    );
    const levels = [...document.querySelectorAll('h1,h2,h3,h4')].map((h) => +h.tagName[1]!);
    expect(levels[0]).toBe(1);
    levels.slice(1).forEach((l, i) => expect(l - levels[i]!).toBeLessThanOrEqual(1));
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    expect(screen.getByText('Weakest skill')).toBeTruthy();
    expect(screen.getByText('Not tried')).toBeTruthy();
  });
});
