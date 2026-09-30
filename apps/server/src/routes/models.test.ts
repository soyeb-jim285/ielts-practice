import { expect, it } from 'vitest';
import { setFetch } from '../ai/openrouter';
import { fakeFetch, json, req, testUser } from '../test/helpers';

const arch = (input: string[], output: string[]) => ({ input_modalities: input, output_modalities: output });
const data = [
  { id: 'openai/gpt-5-mini', name: 'GPT-5 Mini', architecture: arch(['text', 'image'], ['text']), pricing: { prompt: '0.1', completion: '0.4' } },
  { id: 'google/gemini-2.5-flash', name: 'Gemini Flash', architecture: arch(['text', 'audio'], ['text']), pricing: { prompt: '0.3', completion: '2' } },
  { id: 'openai/whisper-large-v3', name: 'Whisper', architecture: arch(['audio'], ['text']), pricing: { prompt: '0', completion: '0' } },
  { id: 'google/gemini-3.8-flash-tts', name: 'TTS', architecture: arch(['text'], ['speech']), pricing: { prompt: '0', completion: '0' }, supported_voices: ['Charon', 'Kore'] },
  { id: 'typesafe/jev-router', name: 'Router', architecture: arch(['text', 'audio'], ['text']), pricing: { prompt: '-1', completion: '-1' } },
];

it('lists and filters models by capability, cached', async () => {
  const f = fakeFetch({ '/models': () => json({ data }) });
  setFetch(f);
  const { headers } = await testUser();
  const ids = async (cap?: string) => ((await (await req(`/api/models${cap ? `?capability=${cap}` : ''}`, { headers })).json()) as any).models.map((m: any) => m.id);
  expect(await ids()).toHaveLength(4);
  expect(await ids('text')).toEqual(['openai/gpt-5-mini', 'google/gemini-2.5-flash', 'openai/whisper-large-v3']);
  expect(await ids('audio-in')).toEqual(['google/gemini-2.5-flash', 'openai/whisper-large-v3']);
  expect(await ids('stt')).toEqual(['openai/whisper-large-v3']);
  expect(await ids('tts')).toEqual(['google/gemini-3.8-flash-tts']);
  const tts = ((await (await req('/api/models?capability=tts', { headers })).json()) as any).models;
  expect(tts[0].voices).toEqual(['Charon', 'Kore']);
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]!.url).toContain('output_modalities=all');
});

it('requires auth and validates capability', async () => {
  expect((await req('/api/models')).status).toBe(401);
  const { headers } = await testUser();
  expect((await req('/api/models?capability=video', { headers })).status).toBe(400);
});
