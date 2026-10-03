import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../../server/src/settings';
import { DEFAULT_MODELS, modelOptions, perUseCost, pickVoice } from './ModelPicker';

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

describe('perUseCost', () => {
  const essay = { in: 8000, out: 3000 };
  it('estimates one use from per-token prices', () => {
    expect(perUseCost({ prompt: '0.0000001', completion: '0.0000005' }, essay)).toBe('<1¢'); // $0.0023
    expect(perUseCost({ prompt: '0.000002', completion: '0.00001' }, essay)).toBe('~5¢'); // $0.046
    expect(perUseCost({ prompt: '0.00003', completion: '0.00018' }, essay)).toBe('~78¢');
    expect(perUseCost({ prompt: '0.0001', completion: '0.0002' }, essay)).toBe('~$1.40');
    expect(perUseCost({ prompt: '0', completion: '0' }, essay)).toBe('free');
    expect(perUseCost({ prompt: '-1', completion: '-1' }, essay)).toBeUndefined();
  });
});

describe('modelOptions', () => {
  const m = (id: string, prompt = '0.0000001') => ({ id, name: id, input: ['text'], output: ['text'], pricing: { prompt, completion: prompt } });
  it('puts the default and recommended models first, drops :batch variants, and prices text models per essay', () => {
    const opts = modelOptions([m('zz/other'), m('google/gemini-3.8-flash'), m('openai/gpt-6-luna:batch'), m('openai/gpt-6-luna'), m('my/default')], 'text', 'my/default');
    expect(opts.map((o) => [o.value, o.group])).toEqual([
      ['my/default', 'Recommended'],
      ['openai/gpt-6-luna', 'Recommended'],
      ['google/gemini-3.8-flash', 'Recommended'],
      ['zz/other', 'All models'],
    ]);
    expect(opts[0]!.description).toBe('my/default · <1¢ per essay');
  });
  it('lists a saved non-recommended model first, under Current', () => {
    const opts = modelOptions([m('zz/other'), m('openai/gpt-6-luna')], 'text', 'openai/gpt-6-luna', 'zz/other');
    expect(opts.map((o) => [o.value, o.group])).toEqual([
      ['zz/other', 'Current'],
      ['openai/gpt-6-luna', 'Recommended'],
    ]);
  });
  it('shows no per-use cost for speech models (they price per second/character)', () => {
    expect(modelOptions([m('some/stt-model')], 'stt', 'some/stt-model')[0]!.description).toBe('some/stt-model');
  });
  it('explains the known speech models in a line (um/uh handling, timing)', () => {
    expect(modelOptions([m('elevenlabs/scribe_v2')], 'stt', 'elevenlabs/scribe_v2')[0]!.description).toMatch(/^elevenlabs\/scribe_v2 · keeps um\/uh/);
  });
});
