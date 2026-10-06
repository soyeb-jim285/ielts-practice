import { cleanup, render, screen } from '@testing-library/react';
import type { AnalysisResult } from '@server/ai/types';
import { afterEach, expect, it, vi } from 'vitest';
import type { AudioControls } from './AudioBar';
import { LanguagePanel } from './LanguagePanel';

afterEach(cleanup);
const show = (conf?: number) => {
  const result = { errors: [], vocabUpgrades: [], words: [{ w: 'hello', start: 0, end: 1, conf }], pronunciation: { unclear: conf != null && conf < 0.6 ? [{ wordIdx: 0, w: 'hello', conf, tier: 3 }] : [] } } as unknown as AnalysisResult;
  render(<LanguagePanel result={result} audio={{ seek: vi.fn() } as unknown as AudioControls} />);
};

it('does not claim correct pronunciation from confident recognition', () => {
  show(0.95);
  expect(screen.getByText(/does not confirm correct pronunciation/)).toBeTruthy();
  expect(screen.queryByText('Speech recognition understood every word clearly.')).toBeNull();
});

it('distinguishes missing recognition confidence from clear speech', () => {
  show();
  expect(screen.getByText(/did not return confidence scores/)).toBeTruthy();
});

it('presents uncertain words as replay hints rather than confirmed mistakes', () => {
  show(0.3);
  expect(screen.getByText('Possibly unclear words: listen again')).toBeTruthy();
  expect(screen.getByText(/not pronunciation accuracy/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Play "hello"' })).toBeTruthy();
});
