import { describe, expect, it } from 'vitest';
import { modelOption, perMillion } from './ModelPicker';

describe('perMillion', () => {
  it('formats per-token prices per 1M tokens', () => {
    expect(perMillion('0.00000025')).toBe('$0.25');
    expect(perMillion('0.000015')).toBe('$15');
    expect(perMillion('0')).toBe('free');
    expect(perMillion('-1')).toBe('variable');
  });
  it('builds a combobox option with id and price', () => {
    const o = modelOption({ id: 'openai/gpt-5-mini', name: 'GPT-5 mini', input: ['text'], output: ['text'], pricing: { prompt: '0.00000025', completion: '0.000002' } });
    expect(o).toEqual({ value: 'openai/gpt-5-mini', label: 'GPT-5 mini', description: 'openai/gpt-5-mini · $0.25 in · $2.00 out per 1M' });
  });
});
