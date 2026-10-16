import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings } from './settings';

it('drops removed settings (models, liveProvider) from stored preferences and keeps the rest', () => {
  expect(mergeSettings({ models: { analysis: 'openai/gpt-5-mini' }, liveProvider: 'gpt-live', targetBand: 8 })).toEqual({ ...DEFAULT_SETTINGS, targetBand: 8 });
});
