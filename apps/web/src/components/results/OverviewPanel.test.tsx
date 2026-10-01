import { cleanup, render, screen } from '@testing-library/react';
import type { AnalysisResult } from '@server/ai/types';
import { afterEach, describe, expect, it } from 'vitest';
import { OverviewPanel } from './OverviewPanel';

afterEach(cleanup);

const cr = (band: number) => ({ band, range: [band, band], descriptor: '', evidence: [], summary: 's' });
const r = { overall: 2, criteria: { ta: cr(1), cc: cr(6), lr: cr(6), gra: cr(6) }, topFixes: [] } as unknown as AnalysisResult;
const show = (capNote?: string) => render(<OverviewPanel result={r} order={['ta', 'cc', 'lr', 'gra']} target={7} capNote={capNote} />);

describe('OverviewPanel summary', () => {
  it('explains a cap instead of calling the overall an average', () => {
    show('the essay is off topic');
    expect(screen.getByText(/would be/).textContent).toBe('Average of these 4 bands would be 5.0, capped at 2.0 because the essay is off topic.');
    expect(screen.queryByText(/without capping/)).toBeNull();
  });
  it('keeps the average wording when nothing was capped', () => {
    show();
    expect(screen.getByText(/is the average of these 4 bands/).textContent).toMatch(/without capping it/);
  });
});
