import type { AnalysisResult } from '@server/ai/types';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LanguagePanel } from './LanguagePanel';

afterEach(cleanup);

const result = (over: object) =>
  ({
    errors: [],
    vocabUpgrades: [
      { original: 'more efficient', better: ['more efficient'], note: '' },
      { original: 'big', better: ['Big', 'substantial'], note: '' },
    ],
    textMetrics: {
      words: 200, sentences: 13, paragraphs: 4, avgSentenceLen: 15, mtld: 80, ttr: 0.5, repeated: [],
      linkers: [
        { word: 'however', count: 1, overused: true },
        { word: 'moreover', count: 3, overused: true },
      ],
      ...over,
    },
  }) as unknown as AnalysisResult;

describe('LanguagePanel', () => {
  it('flags overuse only for repeated linkers, reports templated openings once, drops echo suggestions', () => {
    render(<LanguagePanel r={result({ linkerOpeningRatio: 6 / 13 })} />);
    expect(screen.getAllByText('Overused')).toHaveLength(1);
    expect(screen.getByText(/6 of 13 sentences start with a linking word/)).toBeTruthy();
    expect(screen.queryByText('more efficient')).toBeNull();
    expect(screen.getByText('substantial')).toBeTruthy();
    expect(screen.queryByText('Big')).toBeNull();
    expect(screen.getByText('MTLD 80', { exact: false })).toBeTruthy();
  });
  it('stays quiet about openings below 40%', () => {
    render(<LanguagePanel r={result({ linkerOpeningRatio: 0.2 })} />);
    expect(screen.queryByText(/sentences start with a linking word/)).toBeNull();
  });
});
