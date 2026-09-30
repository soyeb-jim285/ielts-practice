import { expect, it } from 'vitest';
import { chatReply, fakeFetch, json } from '../test/helpers';
import { setFetch } from './openrouter';
import { analyzeSpeaking, anchorSpan, dropHallucinations, questionBoundaries } from './speaking';
import { settings, speakingLlm, sttWords } from './fixtures';

const run = (s = settings({ audioPronEnabled: false })) =>
  analyzeSpeaking({ audio: new Uint8Array([1, 2]), format: 'webm', durationMs: 3000, questions: ['What did you do yesterday?'], part: 1, settings: s });

it('scores, rounds and locates errors in time', async () => {
  const f = fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': () => chatReply(speakingLlm) });
  setFetch(f);
  const r = await run();
  expect(r.overall).toBe(6.5);
  expect(r.overallRaw).toBe(6.25);
  expect(r.range).toEqual([6, 7.5]); // never narrower than overall ±0.5
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
  const pron = { words: [{ word: 'park', time: 2, issue: 'sound', heard: 'pak', expected: 'pɑːk', tip: 'open the vowel' }], misheard: [], disfluencies: { filledPauses: [0.2], repetitions: [], falseStarts: [] }, prosody: 'Flat.', band: 6 };
  const replies = [pron];
  const f = fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': () => chatReply(replies.shift() ?? speakingLlm) });
  setFetch(f);
  const r = await run(settings({ audioPronEnabled: true }));
  const chats = f.calls.filter((c) => c.url.includes('/chat'));
  expect(chats).toHaveLength(4); // pronunciation, full analysis, 2 scoring samples
  expect(JSON.stringify(chats[0]!.body)).toContain('input_audio');
  expect(r.pronunciation?.llm).toEqual(pron);
  const user = JSON.parse(chats[1]!.body.messages[1].content);
  expect(user.metrics.audioDisfluencies).toMatchObject({ filledPauses: 1, repetitions: 0, falseStarts: 0 });
  expect(user.metrics.lexical).toMatchObject({ mtld: expect.any(Number), lessCommonPct: expect.any(Number) });
});

it('pronunciation: drops words whose "heard" is the dictionary form; pronunciation errors anchor on the reported time', async () => {
  const words = ['park', 'is', 'a', 'nice', 'park', 'really'];
  const stt = { text: words.join(' '), duration: 3, words: words.map((word, i) => ({ word, start: i * 0.5, end: i * 0.5 + 0.4 })) };
  const pron = {
    words: [
      { word: 'park', time: 2, issue: 'sound', heard: 'pak', expected: 'park', tip: 'open the vowel' },
      { word: 'really', time: 2.5, issue: 'stress', heard: 'REAL-ly', expected: 'REAL-ly', tip: 'stress the first syllable' },
      { word: 'nice', time: 1.5, issue: 'sound', heard: 'nice', expected: 'NICE', tip: 'say it clearly' },
      { word: 'is', time: 0.5, issue: 'stress', heard: 'IS', expected: 'is', tip: 'unstressed' },
      { word: 'a', time: 1, issue: 'sound', heard: 'a', expected: 'the', tip: 'grammar, not pronunciation' },
    ],
    misheard: [],
    disfluencies: { filledPauses: [], repetitions: [], falseStarts: [] },
    prosody: 'Clear.',
    band: 8,
  };
  const llm = { ...speakingLlm, errors: [{ category: 'pronunciation.word', severity: 'minor', start: 0, end: 0, original: 'park', correction: 'pɑːk', explanation: 'vowel' }, { category: 'pronunciation.word', severity: 'minor', start: 0, end: 0, original: 'Nice', correction: 'nice', explanation: 'says nothing' }, { ...speakingLlm.errors[0], original: 'not said' }] };
  const replies: unknown[] = [pron];
  setFetch(fakeFetch({ '/audio/transcriptions': () => json(stt), '/chat/completions': () => chatReply(replies.shift() ?? llm) }));
  const r = await run(settings({ audioPronEnabled: true }));
  expect(r.pronunciation!.llm!.words.map((w) => w.word)).toEqual(['park', 'is']);
  expect(r.errors).toEqual([expect.objectContaining({ id: 'e0', start: 4, end: 4, time: 2 })]); // second "park" at 2 s; the unfindable error is dropped
});

it('no speech: silence transcribed as "you" or sound events, or an all-zero examiner result', async () => {
  for (const ws of [['you'], ['*Ding*'], ['Thank', 'you.'], ['[music]', 'you', 'you']]) {
    const f = fakeFetch({ '/audio/transcriptions': () => json({ text: ws.join(' '), duration: 3, words: ws.map((word) => ({ word, start: 0, end: 3 })) }), '/chat/completions': () => chatReply(speakingLlm) });
    setFetch(f);
    expect(await run()).toMatchObject({ noSpeech: true, overall: 0 });
    expect(f.calls.some((c) => c.url.includes('/chat'))).toBe(false);
  }
  const zero = { band: 0, range: [0, 0], descriptor: '', evidence: [], summary: '' };
  setFetch(fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': () => chatReply({ ...speakingLlm, criteria: { fc: zero, lr: zero, gra: zero, p: zero } }) }));
  expect(await run()).toMatchObject({ noSpeech: true, overall: 0, criteria: {} });
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
  expect(anchorSpan(words, { start: 0, original: 'the computer' })).toEqual({ start: 7, end: 8 }); // beyond ±5 words
  expect(anchorSpan([{ w: 'a', start: 0, end: 1 }, { w: 'well-known', start: 1, end: 2 }], { start: 0, original: 'well-known' })).toEqual({ start: 1, end: 1 });
  expect(anchorSpan(words, { start: 0, original: 'he' }, 3.9)).toEqual({ start: 4, end: 4 }); // nearest the given time
  const llm = { ...speakingLlm, errors: [{ ...speakingLlm.errors[0], start: 2, end: 2, original: 'goes' }] };
  setFetch(fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': () => chatReply(llm) }));
  const r = await run();
  expect(r.errors[0]).toMatchObject({ start: 1, end: 1, time: r.words![1]!.start });
});

it('default settings enable the audio pronunciation pass', () => expect(settings().audioPronEnabled).toBe(true));

it('spoken forms the transcript repaired reach the examiner and anchor errors; the larger filled-pause count wins', async () => {
  const pron = { words: [], misheard: [{ time: 0.5, transcript: 'goes', spoken: 'go' }, { time: 1, transcript: 'to', spoken: 'to' }], disfluencies: { filledPauses: [0.1, 0.2, 0.3], repetitions: [], falseStarts: [] }, prosody: 'Clear.', band: 7 };
  const llm = { ...speakingLlm, errors: [{ ...speakingLlm.errors[0], start: 0, end: 1, original: 'I go', correction: 'I went' }, { ...speakingLlm.errors[0], original: 'goes', correction: 'goes' }] };
  const replies: unknown[] = [pron];
  const f = fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': () => chatReply(replies.shift() ?? llm) });
  setFetch(f);
  const r = await run(settings({ audioPronEnabled: true }));
  const user = JSON.parse(f.calls.filter((c) => c.url.includes('/chat'))[1]!.body.messages[1].content);
  expect(user.spokenFormsDifferingFromTranscript).toEqual([{ i: 1, transcript: 'goes', spoken: 'go' }]);
  expect(user.metrics.fillers.total).toBe(3);
  expect(r.errors).toEqual([expect.objectContaining({ original: 'I go', start: 0, end: 1 })]); // the no-op "goes" -> "goes" is dropped
});

it('drops Whisper\'s shaky "you" / "Thank you" next to a pause, keeps confident ones', () => {
  const w = (w: string, start: number, end: number, conf?: number) => ({ w, start, end, conf });
  const words = [w('it', 0, 0.2), w('is', 0.2, 0.4), w('you', 1.0, 1.3, 0.22), w('fine,', 2, 2.3), w('thank', 2.3, 2.5, 0.9), w('you.', 2.5, 2.7, 0.9), w('Thank', 3.5, 3.8, 0.47), w('you.', 3.8, 3.8)];
  expect(dropHallucinations(words).map((x) => x.w)).toEqual(['it', 'is', 'fine,', 'thank', 'you.']);
});
