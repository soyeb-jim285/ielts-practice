import { expect, it } from 'vitest';
import type { SpeakingTest } from '../routes/prompts';
import { CUE_PREFIX, realtimeInstructions } from './examiner';
import { geminiSetup, geminiTokenRequest, lockMask } from './gemini-live';

const prompt = (id: string, part: number, extra = {}) => ({
  id, slug: id, skill: 'speaking' as const, part, variant: null, type: 't', topic: `topic ${id}`, title: `Describe ${id}`, body: `body ${id}`,
  bullets: null, followUps: null, chart: null, imageUrl: null, source: 'generated' as const, sourceRef: null, groupId: 'g', done: false, ...extra,
});
const test: SpeakingTest = {
  part1: [prompt('a', 1, { followUps: ['a 1?', 'a 2?'] })],
  part2: prompt('a book', 2, { bullets: ['what it is'], followUps: ['Do you read often?'] }),
  part3: prompt('reading', 3, { followUps: ['Why?'] }),
};

it('lockMask: top-level key, or key.child one level down (the SDK format)', () => {
  expect(lockMask({ model: 'm', a: { b: 1, c: 2 }, d: {}, e: [1] })).toBe('model,a.b,a.c,d,e.0');
});

it('setup: locked model, AUDIO, voice, instructions, transcriptions, compression; resumption left to the client', () => {
  const s = geminiSetup('gemini-3.8-live', test) as any;
  expect(s.model).toBe('models/gemini-3.8-live');
  expect(s.generationConfig).toMatchObject({ responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } } });
  expect(s.realtimeInputConfig.automaticActivityDetection).toMatchObject({ endOfSpeechSensitivity: 'END_SENSITIVITY_LOW', silenceDurationMs: 1000 });
  expect(s).toMatchObject({ inputAudioTranscription: {}, outputAudioTranscription: {}, contextWindowCompression: { slidingWindow: {} } });
  expect(s.sessionResumption).toBeUndefined();
  expect(s.systemInstruction.parts[0].text).toBe(realtimeInstructions(test));
});

it('token request: one use, a 20 minute window, mask covers the instructions but not sessionResumption', () => {
  const r = geminiTokenRequest('gemini-3.8-live', test, Date.parse('2030-01-01T00:00:00Z'));
  expect(r).toMatchObject({ uses: 1, expireTime: '2030-01-01T00:20:00.000Z', newSessionExpireTime: '2030-01-01T00:20:00.000Z' });
  const mask = r.fieldMask.split(',');
  expect(mask).toEqual(expect.arrayContaining(['model', 'generationConfig.speechConfig', 'systemInstruction.parts', 'realtimeInputConfig.automaticActivityDetection', 'inputAudioTranscription', 'contextWindowCompression.slidingWindow']));
  expect(mask.some((m) => m.startsWith('sessionResumption'))).toBe(false);
});

it('instructions: no feedback, Part 3 follow-ups, natural pace, cue convention', () => {
  const g = realtimeInstructions(test);
  expect(g).toMatch(/Never give feedback/);
  expect(g).toContain('normal conversational pace');
  expect(g).toContain('"Why do you think that is?"');
  expect(g).toContain('Do you read often?');
  expect(g).toContain("Now, I'm going to give you a topic");
  expect(g).toContain('stay completely silent for the one-minute preparation');
  expect(g).toContain(`"${CUE_PREFIX}Begin the test."`);
});
