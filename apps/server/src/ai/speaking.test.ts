import { expect, it } from 'vitest';
import { chatReply, fakeFetch, json } from '../test/helpers';
import { setFetch } from './openrouter';
import { analyzeSpeaking, anchorSpan, questionBoundaries } from './speaking';
import { settings, speakingLlm, sttWords } from './fixtures';

const run = (s = settings({ audioPronEnabled: false })) =>
  analyzeSpeaking({ audio: new Uint8Array([1, 2]), format: 'webm', durationMs: 3000, questions: ['What did you do yesterday?'], part: 1, settings: s });

it('scores, rounds and locates errors in time', async () => {
  const f = fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': () => chatReply(speakingLlm) });
  setFetch(f);
  const r = await run();
  expect(r.overall).toBe(6.5);
  expect(r.overallRaw).toBe(6.25);
  expect(r.range).toEqual([6.5, 7.5]);
  expect(r.topFixes).toHaveLength(3);
  expect(r.errors[0]).toMatchObject({ id: 'e0', start: 1, time: r.words![1]!.start });
  expect(r.metrics!.wordCount).toBe(6);
  expect(r.questions).toEqual([{ text: 'What did you do yesterday?', startWord: 0 }]);
  expect(r.pronunciation?.llm).toBeUndefined();
  const user = JSON.parse(f.calls.find((c) => c.url.includes('/chat'))!.body.messages[1].content);
  expect(user.transcript).toContain('Q1: What did you do yesterday?');
  expect(user.transcript).toContain('[1]goes');
});

it('no speech: returns noSpeech and never calls chat', async () => {
  const f = fakeFetch({ '/audio/transcriptions': () => json({ text: '', words: [], duration: 2 }), '/chat/completions': () => chatReply(speakingLlm) });
  setFetch(f);
  const r = await run();
  expect(r).toMatchObject({ noSpeech: true, overall: 0, topFixes: [], errors: [] });
  expect(r.rewrite.note).toContain('No speech detected');
  expect(f.calls.some((c) => c.url.includes('/chat'))).toBe(false);
});

it('audio pronunciation pass runs first with input_audio', async () => {
  const pron = { words: [{ word: 'park', time: 2, issue: 'sound', tip: 'open the vowel' }], prosody: 'Flat.', band: 6 };
  const replies = [pron];
  const f = fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': () => chatReply(replies.shift() ?? speakingLlm) });
  setFetch(f);
  const r = await run(settings({ audioPronEnabled: true }));
  const chats = f.calls.filter((c) => c.url.includes('/chat'));
  expect(chats).toHaveLength(4); // pronunciation, full analysis, 2 scoring samples
  expect(JSON.stringify(chats[0]!.body)).toContain('input_audio');
  expect(r.pronunciation?.llm).toEqual(pron);
});

it('pronunciation failure does not fail the analysis', async () => {
  let n = 0;
  setFetch(fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': () => (n++ < 2 ? json({}, 500) : chatReply(speakingLlm)) }));
  const r = await run(settings({ audioPronEnabled: true }));
  expect(r.overall).toBe(6.5);
  expect(r.pronunciation?.llm).toBeUndefined();
});

it('maps question marks to word boundaries', () => {
  const words = sttWords.words.map((w) => ({ w: w.word, start: w.start, end: w.end }));
  expect(questionBoundaries(['a', 'b', 'c'], words, [0, 1200])).toEqual([
    { text: 'a', startWord: 0 },
    { text: 'b', startWord: 2 },
    { text: 'c', startWord: -1 },
  ]);
});

it('re-anchors an off-by-one LLM error span on its words', async () => {
  const words = ['Also,', 'my', 'father,', 'he,', 'he', "don't", 'use', 'the', 'computer.'].map((w, i) => ({ w, start: i, end: i + 0.5 }));
  expect(anchorSpan(words, { start: 4, original: "he he don't" })).toEqual({ start: 3, end: 5 });
  expect(anchorSpan(words, { start: 4, original: 'he he' })).toEqual({ start: 3, end: 4 });
  expect(anchorSpan(words, { start: 4, original: 'not there' })).toBeNull();
  const llm = { ...speakingLlm, errors: [{ ...speakingLlm.errors[0], start: 2, end: 2, original: 'goes' }] };
  setFetch(fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': () => chatReply(llm) }));
  const r = await run();
  expect(r.errors[0]).toMatchObject({ start: 1, end: 1, time: r.words![1]!.start });
});

it('default settings enable the audio pronunciation pass', () => expect(settings().audioPronEnabled).toBe(true));
