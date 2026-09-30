import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../../server/src/settings';
import { DEFAULT_MODELS, modelOption, perMillion, pickVoice } from './ModelPicker';

vi.mock('../../../../server/src/db/client', () => ({ db: {} })); // settings.ts only needs the db for reads we don't call

describe('DEFAULT_MODELS', () => {
  it('matches the server defaults (else a new user sees "Reset to default")', () => expect(DEFAULT_MODELS).toEqual(DEFAULT_SETTINGS.models));
});

describe('pickVoice', () => {
  it('keeps a supported voice, else falls back to the model\'s first, and keeps it when the list is unknown', () => {
    expect(pickVoice(['Zephyr', 'Charon'], 'Charon')).toBe('Charon');
    expect(pickVoice(['eve', 'ara'], 'Charon')).toBe('eve');
    expect(pickVoice([], 'Charon')).toBe('Charon');
    expect(pickVoice(undefined, 'Charon')).toBe('Charon');
  });
});

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
