import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings, SettingsPatchSchema } from './settings';

it('has no audio pronunciation model or opt-in setting', () => {
  expect(DEFAULT_SETTINGS).not.toHaveProperty('audioPronEnabled');
  expect(DEFAULT_SETTINGS.models).not.toHaveProperty('audioPron');
  expect(SettingsPatchSchema.parse({ audioPronEnabled: true, models: { audioPron: 'google/gemini-2.5-flash' } })).toEqual({ models: {} });
});

it('ignores removed settings in persisted preferences while preserving other overrides', () => {
  const s = mergeSettings({ audioPronEnabled: true, models: { audioPron: 'google/gemini-2.5-flash', analysis: 'openai/gpt-5-mini' }, targetBand: 8 });
  expect(s).not.toHaveProperty('audioPronEnabled');
  expect(s.models).not.toHaveProperty('audioPron');
  expect(s.models.analysis).toBe('openai/gpt-5-mini');
  expect(s.targetBand).toBe(8);
});
