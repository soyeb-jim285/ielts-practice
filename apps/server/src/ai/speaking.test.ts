import { expect, it } from 'vitest';
import { chatReply, fakeFetch, json } from '../test/helpers';
import { setFetch } from './openrouter';
import { analyzeSpeaking, anchorSpan, dropHallucinations, questionBoundaries } from './speaking';
import { settings, speakingLlm, sttWords } from './fixtures';

/** Speaking fixture split the way the pipeline calls: feedback (no bands) and one criterion score per call. */
const score = (band: number) => ({ checks: [{ band: Math.min(9, band + 1), feature: 'Error-free sentences are frequent', verdict: 'not_met', quote: 'I goes' }], evidence: ['I goes'], descriptor: 'A range of structures flexibly used.', summary: 'More complex sentences.', injection: false, band });
const bands: Record<string, number> = { fc: 7, lr: 6, gra: 6, p: 6 };
/** Routes chat calls by schema name (and criterion id for scores); `other` answers the rest (pronunciation). */
const chat = (o: { feedback?: unknown; bands?: Record<string, number>; other?: () => unknown; tags?: unknown } = {}) => (_: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body));
  const name = body.response_format?.json_schema?.name;
  if (name === 'speaking_feedback') return chatReply(o.feedback ?? speakingLlm);
  if (name === 'disfluency_tags') return chatReply(o.tags ?? { tags: [] });
  if (name === 'criterion_score') return chatReply(score({ ...bands, ...o.bands }[body.messages[1].content.match(/<criterion id="(\w+)"/)[1] as string]!));
  return chatReply(o.other?.() ?? speakingLlm);
};
const run = (s = settings({ audioPronEnabled: false })) =>
  analyzeSpeaking({ audio: new Uint8Array([1, 2]), format: 'webm', durationMs: 3000, questions: ['What did you do yesterday?'], part: 1, settings: s });

it('scores, rounds and locates errors in time', async () => {
  const f = fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': chat() });
  setFetch(f);
  const r = await run();
  expect(r.overall).toBe(6.5);
  expect(r.overallRaw).toBe(6.25);
  expect(r.range).toEqual([5.5, 7.5]); // uncalibrated: overall ±1
  expect(r.criteria.fc).toMatchObject({ band: 7, range: [6, 8] });
  expect(r).toMatchObject({ calibrated: false, q: 1 });
  expect(r.topFixes).toHaveLength(3);
  expect(r.errors[0]).toMatchObject({ id: 'e0', start: 1, time: r.words![1]!.start });
  expect(r.metrics!.wordCount).toBe(6);
  expect(r.questions).toEqual([{ text: 'What did you do yesterday?', startWord: 0 }]);
  expect(r.pronunciation?.llm).toBeUndefined();
  const user = JSON.parse(f.calls.find((c) => c.body?.response_format?.json_schema?.name === 'speaking_feedback')!.body.messages[1].content);
  expect(user.transcript).toContain('Q1: What did you do yesterday?');
  expect(user.transcript).toContain('[1]goes');
});

it('scores each criterion K times on the right transcript kind, with a neutral prompt', async () => {
  const words = ['um', 'I', 'goes', 'goes', 'to', 'the', 'park', 'yesterday'];
  const stt = { text: words.join(' '), duration: 4, words: words.map((word, i) => ({ word, start: i * 0.5, end: i * 0.5 + 0.4 })) };
  const f = fakeFetch({ '/audio/transcriptions': () => json(stt), '/chat/completions': chat({ bands: { p: 9 } }) });
  setFetch(f);
  const r = await run();
  const scores = f.calls.filter((c) => c.body?.response_format?.json_schema?.name === 'criterion_score');
  const user = (k: string) => scores.filter((c) => c.body.messages[1].content.includes(`<criterion id="${k}"`)).map((c) => c.body.messages[1].content as string);
  expect(['fc', 'lr', 'gra', 'p'].map((k) => user(k).length)).toEqual([3, 3, 3, 3]); // no audio report: P is scored from ASR evidence
  expect(user('fc')[0]).toContain('<candidate_transcript kind="verbatim">\nQ1: What did you do yesterday?\num I goes goes');
  expect(user('fc')[0]).toMatch(/<measured_fluency[^>]*>\n.*1 filled pauses/);
  for (const k of ['lr', 'gra']) expect(user(k)[0]).toContain('<candidate_transcript kind="cleaned">\nQ1: What did you do yesterday?\nI goes to the park yesterday');
  const system = scores[0]!.body.messages[0].content as string;
  expect(system).not.toMatch(/heuristic|wpm|band 7 script/i);
  expect(scores.every((c) => c.body.messages[0].content === system)).toBe(true); // shared, cacheable prefix
  expect(r.criteria.p!.band).toBe(7); // no audio: P never above 7
  expect(r.metrics).toMatchObject({ fluency: { filledPausesPerMin: 20, repetitionsPer100w: expect.any(Number), band: expect.any(Number), verbatimStt: true } });
});

it('no speech: returns noSpeech and never calls chat', async () => {
  const f = fakeFetch({ '/audio/transcriptions': () => json({ text: '', words: [], duration: 2 }), '/chat/completions': chat() });
  setFetch(f);
  const r = await run();
  expect(r).toMatchObject({ noSpeech: true, overall: 0, topFixes: [], errors: [] });
  expect(r.rewrite.note).toContain('No speech detected');
  expect(f.calls.some((c) => c.url.includes('/chat'))).toBe(false);
});

it('audio pronunciation pass runs first with input_audio', async () => {
  const pron = { words: [{ word: 'park', time: 2, issue: 'sound', heard: 'pak', expected: 'pɑːk', tip: 'open the vowel' }], misheard: [], disfluencies: { filledPauses: [0.2], repetitions: [], falseStarts: [] }, prosody: 'Flat.', band: 6 };
  const f = fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': chat({ other: () => pron }) });
  setFetch(f);
  const r = await run(settings({ audioPronEnabled: true }));
  const chats = f.calls.filter((c) => c.url.includes('/chat'));
  expect(chats).toHaveLength(12); // pronunciation, disfluency tagger, feedback, 3 criteria × 3 samples (P comes from the audio pass)
  expect(JSON.stringify(chats[0]!.body)).toContain('input_audio');
  expect(r.pronunciation?.llm).toEqual({ ...pron, words: [] }); // "park" has no acoustic evidence (confident ASR word, audio model agrees with the transcript): dropped
  expect(r.criteria.p).toMatchObject({ band: 6, summary: 'Flat.' });
  const user = JSON.parse(chats.find((c) => c.body?.response_format?.json_schema?.name === 'speaking_feedback')!.body.messages[1].content);
  expect(user.metrics.disfluencies).toMatchObject({ filledPauses: 1, repetitions: 0, repairs: 0 });
  expect(user.metrics.lexical).toMatchObject({ mtld: expect.any(Number), lessCommonPct: expect.any(Number) });
});

it('pronunciation: drops words whose "heard" is the dictionary form; pronunciation errors anchor on the reported time', async () => {
  const words = ['park', 'is', 'a', 'nice', 'park', 'really'];
  // "park" (2 s) and "is" are words the recogniser was unsure of: the only ones with acoustic evidence.
  const stt = { text: words.join(' '), duration: 3, words: words.map((word, i) => ({ word, start: i * 0.5, end: i * 0.5 + 0.4, confidence: i === 1 || i === 4 ? 0.3 : 0.95 })) };
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
  setFetch(fakeFetch({ '/audio/transcriptions': () => json(stt), '/chat/completions': chat({ feedback: llm, other: () => pron }) }));
  const r = await run(settings({ audioPronEnabled: true }));
  expect(r.pronunciation!.llm!.words.map((w) => w.word)).toEqual(['park', 'is']);
  expect(r.errors).toEqual([expect.objectContaining({ id: 'e0', start: 4, end: 4, time: 2 })]); // second "park" at 2 s; the unfindable error is dropped
});

it('no speech: silence transcribed as "you" or sound events, or an all-zero examiner result', async () => {
  for (const ws of [['you'], ['*Ding*'], ['Thank', 'you.'], ['[music]', 'you', 'you']]) {
    const f = fakeFetch({ '/audio/transcriptions': () => json({ text: ws.join(' '), duration: 3, words: ws.map((word) => ({ word, start: 0, end: 3 })) }), '/chat/completions': chat() });
    setFetch(f);
    expect(await run()).toMatchObject({ noSpeech: true, overall: 0 });
    expect(f.calls.some((c) => c.url.includes('/chat'))).toBe(false);
  }
  setFetch(fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': chat({ bands: { fc: 0, lr: 0, gra: 0, p: 0 } }) }));
  expect(await run()).toMatchObject({ noSpeech: true, overall: 0, criteria: {} });
});

it('pronunciation failure does not fail the analysis', async () => {
  let n = 0;
  const ok = chat();
  setFetch(fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': (u, init) => (n++ < 2 ? json({}, 500) : ok(u, init)) }));
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
  setFetch(fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': chat({ feedback: llm }) }));
  const r = await run();
  expect(r.errors[0]).toMatchObject({ start: 1, end: 1, time: r.words![1]!.start });
});

it('default settings enable the audio pronunciation pass', () => expect(settings().audioPronEnabled).toBe(true));

it('spoken forms the transcript repaired reach the examiner and anchor errors; disfluencies are fused by time', async () => {
  const pron = { words: [], misheard: [{ time: 0.5, transcript: 'goes', spoken: 'go' }, { time: 1, transcript: 'to', spoken: 'to' }], disfluencies: { filledPauses: [0.1, 0.2, 1.3, 2.4], repetitions: [], falseStarts: [] }, prosody: 'Clear.', band: 7 };
  const llm = { ...speakingLlm, errors: [{ ...speakingLlm.errors[0], start: 0, end: 1, original: 'I go', correction: 'I went' }, { ...speakingLlm.errors[0], original: 'goes', correction: 'goes' }] };
  const f = fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': chat({ feedback: llm, other: () => pron }) });
  setFetch(f);
  const r = await run(settings({ audioPronEnabled: true }));
  const user = JSON.parse(f.calls.find((c) => c.body?.response_format?.json_schema?.name === 'speaking_feedback')!.body.messages[1].content);
  expect(user.spokenFormsDifferingFromTranscript).toEqual([{ i: 1, transcript: 'goes', spoken: 'go' }]);
  expect(user.metrics.disfluencies.filledPauses).toBe(3); // 0.1 and 0.2 s are one event
  const gra = f.calls.find((c) => c.body?.messages?.[1]?.content?.includes?.('<criterion id="gra"'))!.body.messages[1].content;
  expect(gra).toContain('<spokenForms>[{"transcript":"goes","spoken":"go"}]</spokenForms>');
  expect(r.errors).toEqual([expect.objectContaining({ original: 'I go', start: 0, end: 1 })]); // the no-op "goes" -> "goes" is dropped
});

it('drops Whisper\'s shaky "you" / "Thank you" next to a pause, keeps confident ones', () => {
  const w = (w: string, start: number, end: number, conf?: number) => ({ w, start, end, conf });
  const words = [w('it', 0, 0.2), w('is', 0.2, 0.4), w('you', 1.0, 1.3, 0.22), w('fine,', 2, 2.3), w('thank', 2.3, 2.5, 0.9), w('you.', 2.5, 2.7, 0.9), w('Thank', 3.5, 3.8, 0.47), w('you.', 3.8, 3.8)];
  expect(dropHallucinations(words).map((x) => x.w)).toEqual(['it', 'is', 'fine,', 'thank', 'you.']);
});

it('P without acoustic evidence stays within one band of the other criteria; with confirmed word issues the audio band stands', async () => {
  const pron = (words: unknown[]) => ({ words, misheard: [], disfluencies: { filledPauses: [], repetitions: [], falseStarts: [] }, prosody: 'Clear.', band: 4 });
  const strong = { fc: 8, lr: 8, gra: 8 };
  setFetch(fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': chat({ bands: strong, other: () => pron([{ word: 'park', time: 2, issue: 'stress', heard: 'PARK', expected: 'park', tip: 'x' }]) }) }));
  expect((await run(settings({ audioPronEnabled: true }))).criteria.p!.band).toBe(7); // invented word claim dropped, P lifted to mean 8 - 1
  const unsure = { text: sttWords.text, duration: 3, words: sttWords.words.map((w) => ({ ...w, confidence: w.word === 'goes' || w.word === 'park' ? 0.3 : 0.95 })) };
  const two = [{ word: 'goes', time: 0.5, issue: 'sound', heard: 'gose', expected: 'goes', tip: 'x' }, { word: 'park', time: 2, issue: 'sound', heard: 'pak', expected: 'park', tip: 'x' }];
  setFetch(fakeFetch({ '/audio/transcriptions': () => json(unsure), '/chat/completions': chat({ bands: strong, other: () => pron(two) }) }));
  const r = await run(settings({ audioPronEnabled: true }));
  expect(r.criteria.p!.band).toBe(4);
  expect(r.pronunciation!.llm!.words).toHaveLength(2);
});

it('disfluency tagger spans are fused with the other detectors and summarised per type', async () => {
  const tags = { tags: [{ type: 'false_start', start: 1, reparandum: 'goes', interregnum: '', repair: '' }] };
  setFetch(fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': chat({ tags }) }));
  const r = await run();
  const fl = (r.metrics as any).fluency;
  expect(fl.events).toEqual([{ kind: 'false_start', start: 0.5, end: 0.9, sources: ['llm'] }]);
  expect(fl.profile).toMatchObject({ byKind: { false_start: { n: 1 } }, total: { n: 1 }, midClauseShare: 1 });
  expect(r.timings).toMatchObject({ sttMs: expect.any(Number), totalMs: expect.any(Number) });
  expect(r.sttModel).toBe('openai/whisper-large-v3');
});

it('FC stays within one band of the measured fluency band, and P within reach of FC (+1 from ASR evidence, +2 with an audio report)', async () => {
  setFetch(fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': chat({ bands: { fc: 2, lr: 9, gra: 9, p: 9 } }) }));
  const low = await run();
  const flu = (low.metrics as any).fluency.band as number;
  expect(low.criteria.fc!.band).toBe(Math.max(Math.ceil(flu - 1), 2));
  expect(low.criteria.p!.band).toBeLessThanOrEqual(low.criteria.fc!.band + 1);
  setFetch(fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': chat({ bands: { fc: 9, lr: 9, gra: 9, p: 9 } }) }));
  const high = await run();
  expect(high.criteria.fc!.band).toBe(Math.min(Math.floor(flu + 1), 9));
  // audio report with no word-level evidence: P = the model's band, capped at 7 and at FC + 2
  const pron = { words: [], misheard: [], disfluencies: { filledPauses: [], repetitions: [], falseStarts: [] }, prosody: 'Clear.', band: 9 };
  setFetch(fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': chat({ bands: { fc: 9, lr: 9, gra: 9 }, other: () => pron }) }));
  const r = await run(settings({ audioPronEnabled: true }));
  expect(r.criteria.p!.band).toBeLessThanOrEqual(Math.min(7, r.criteria.fc!.band + 2));
});
