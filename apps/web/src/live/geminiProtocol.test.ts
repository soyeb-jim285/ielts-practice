import { expect, it } from 'vitest';
import { audioEndMessage, audioMessage, cueMessage, frameText, geminiUrl, parseGeminiMessage, setupMessage } from './geminiProtocol';

it('builds the messages the Live API expects', () => {
  expect(geminiUrl('auth_tokens/abc')).toBe(
    'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=auth_tokens/abc',
  );
  expect(setupMessage('gemini-3.8-live')).toEqual({ setup: { model: 'models/gemini-3.8-live', sessionResumption: {} } });
  expect(setupMessage('gemini-3.8-live', 'h1').setup.sessionResumption).toEqual({ handle: 'h1' });
  expect(audioMessage(new Uint8Array([104, 105]))).toEqual({ realtimeInput: { audio: { data: 'aGk=', mimeType: 'audio/pcm;rate=16000' } } });
  expect(audioEndMessage()).toEqual({ realtimeInput: { audioStreamEnd: true } });
  expect(cueMessage('Begin the test.')).toEqual({ clientContent: { turns: [{ role: 'user', parts: [{ text: '[APP CUE] Begin the test.' }] }], turnComplete: true } });
});

it('parses a content message into events, interruption first', () => {
  const ev = parseGeminiMessage({
    serverContent: {
      interrupted: true,
      modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AAAA' } }, { inlineData: { mimeType: 'image/png', data: 'x' } }] },
      outputTranscription: { text: 'Hello' },
      inputTranscription: { text: 'my name' },
      generationComplete: true,
      turnComplete: true,
    },
  });
  expect(ev.map((e) => e.type)).toEqual(['interrupted', 'inText', 'audio', 'outText', 'generationComplete', 'turnComplete']);
  expect(ev.find((e) => e.type === 'audio')).toEqual({ type: 'audio', data: 'AAAA' });
});

it('parses setup, goAway and resumption updates', () => {
  expect(parseGeminiMessage({ setupComplete: {} })).toEqual([{ type: 'setupComplete' }]);
  expect(parseGeminiMessage({ goAway: { timeLeft: '50s' } })).toEqual([{ type: 'goAway', timeLeftMs: 50_000 }]);
  expect(parseGeminiMessage({ goAway: { timeLeft: '1.5s' } })).toEqual([{ type: 'goAway', timeLeftMs: 1500 }]);
  expect(parseGeminiMessage({ sessionResumptionUpdate: { newHandle: 'h2', resumable: true } })).toEqual([{ type: 'resume', handle: 'h2' }]);
  expect(parseGeminiMessage({ sessionResumptionUpdate: { newHandle: '', resumable: false } })).toEqual([]);
  expect(parseGeminiMessage({ serverContent: {} })).toEqual([]);
});

it('reads text, Blob and ArrayBuffer frames', async () => {
  expect(await frameText('{"a":1}')).toBe('{"a":1}');
  expect(await frameText(new Blob(['{"b":2}']))).toBe('{"b":2}');
  expect(await frameText(new TextEncoder().encode('{"c":3}').buffer)).toBe('{"c":3}');
});
