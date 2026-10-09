import { expect, it } from 'vitest';
import { chatReply, fakeFetch, json } from '../test/helpers';
import { setFetch } from './openrouter';
import { analyzeSpeaking, anchorSpan, dropHallucinations, MAX_OFF_TOPIC_PENALTY, offTopicPenalty, questionBoundaries, SPEAKING_FLUENCY_NORMS, speakingCurve, spokenQuestions, transitionsOf } from './speaking';
import { fluencyComposite } from '@ielts/core';
import { settings, speakingLlm, sttWords } from './fixtures';

const score = (band: number) => ({ checks: [{ band: Math.min(9, band + 1), feature: 'Error-free sentences are frequent', verdict: 'not_met', quote: 'I goes' }], evidence: ['I goes'], descriptor: 'A range of structures flexibly used.', summary: 'More complex sentences.', injection: false, band });
const bands: Record<string, number> = { fc: 7, lr: 6, gra: 6, p: 6 };
const chat = (o: { feedback?: unknown; bands?: Record<string, number>; tags?: unknown } = {}) => (_: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body));
  const name = body.response_format?.json_schema?.name;
  if (name === 'speaking_feedback') return chatReply(o.feedback ?? speakingLlm);
  if (name === 'disfluency_tags') return chatReply(o.tags ?? { tags: [] });
  if (name === 'criterion_score') return chatReply(score({ ...bands, ...o.bands }[body.messages[1].content.match(/<criterion id="(\w+)"/)[1] as string]!));
  throw new Error(`Unexpected chat schema: ${name}`);
};
const run = () => analyzeSpeaking({ audio: new Uint8Array([1, 2]), format: 'webm', durationMs: 3000, questions: ['What did you do yesterday?'], part: 1, settings: settings() });

it('scores, rounds and locates errors in time', async () => {
  const f = fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': chat() });
  setFetch(f);
  const r = await run();
  expect(r.overall).toBe(6.5);
  expect(r.overallRaw).toBe(6.25);
  expect(r.range).toEqual([5.5, 7.5]);
  expect(r.criteria.fc).toMatchObject({ band: 7, range: [6, 8] });
  expect(r.criteria.p).toMatchObject({ band: 6, range: [4, 8], evidence: [] });
  expect(r.criteria.p!.summary).toMatch(/limited recognition-based estimate/i);
  expect(r.criteria.p!.summary).toMatch(/not calibrated/i);
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

/** Jev answer on bands 4-9: `score` is the 0-based step (2 = band 6); probabilities per step. A relevance call (one `answers` noul) gets `answered`. */
const jev = (score: number, high = 0, answered = 0.9) => (_: string, init: RequestInit) =>
  JSON.parse(String(init.body)).questions.answers
    ? json({ model: 'typesafe/jev-1.13-20260917', answers: { answers: { type: 'noul', noul: answered } }, usage: { input_tokens: 200, output_tokens: 5, cost: 0.00001 } })
    : json({ model: 'typesafe/jev-1.13-20260917', answers: Object.fromEntries(['fc', 'lr', 'gra'].map((k) => [k, { type: 'score', score, confidence: 0.8, probabilities: { 0: 0, 1: 0.1, 2: 0.8 - high, 3: 0.1, 4: high, 5: 0 } }])), usage: { input_tokens: 700, output_tokens: 15, cost: 0.00002 } });

it('Jev scores in one call instead of 12 LLM samples: the curve on its mean, P(8+) and measured fluency sets the overall', async () => {
  const f = fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': chat(), '/systemone': jev(2, 0.05) });
  setFetch(f);
  const r = await run();
  const chats = f.calls.filter((c) => c.url.includes('/chat'));
  expect(chats.map((c) => c.body.response_format?.json_schema?.name).sort()).toEqual(['disfluency_tags', 'speaking_feedback']); // no criterion_score calls
  const [j] = f.calls.filter((c) => c.url.endsWith('/systemone'));
  expect(Object.keys(j!.body.questions)).toEqual(['fc', 'lr', 'gra']);
  expect(j!.body.questions.lr.criteria[0]).toMatch(/^Band 4: /);
  expect(j!.body.state.answers[0]).toMatchObject({ examiner_question: 'What did you do yesterday?' });
  const y = speakingCurve(6, 0.05, fluencyComposite((r.metrics as unknown as { fluency: never }).fluency, SPEAKING_FLUENCY_NORMS));
  expect(Math.abs(r.overallRaw! - y)).toBeLessThanOrEqual(0.25); // whole criterion bands apportion the curve's overall
  expect(r.criteria.gra!.summary).toMatch(/^To reach band \d: /);
  expect(r.criteria.p!.summary).toMatch(/limited recognition-based estimate/i);
});

it('relevance: a clear "no" from the per-answer check flags the answer off topic and lowers the band by the off-topic share, at most 1.5', async () => {
  expect(offTopicPenalty(0, 100)).toBe(0);
  expect(offTopicPenalty(50, 100)).toBeCloseTo(0.75);
  expect(offTopicPenalty(500, 100)).toBe(MAX_OFF_TOPIC_PENALTY);
  const run2 = (answered: number) => {
    const f = fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': chat(), '/systemone': jev(2, 0.05, answered) });
    setFetch(f);
    return run().then((r) => ({ r, f }));
  };
  const on = await run2(0.9);
  expect(on.r.relevance).toEqual([expect.objectContaining({ questionIdx: 0, onTopic: true })]);
  expect(on.r.offTopicPenalty).toBeUndefined();
  const rel = on.f.calls.filter((c) => c.url.endsWith('/systemone') && c.body.questions.answers);
  expect(rel).toHaveLength(1);
  expect(rel[0]!.body.state).toMatchObject({ examiner_question: 'What did you do yesterday?' });

  const offRun = await run2(0.1); // the only answer is clearly off topic: all of the speech
  expect(offRun.r.relevance).toEqual([{ questionIdx: 0, onTopic: false, note: expect.any(String) }]);
  expect(offRun.r.offTopicPenalty).toBe(MAX_OFF_TOPIC_PENALTY);
  expect(on.r.overallRaw! - offRun.r.overallRaw!).toBeGreaterThanOrEqual(1);
  expect(offRun.r.criteria.fc!.summary).toMatch(/did not address the question/);

  const unsure = await run2(0.45); // borderline: never penalised
  expect(unsure.r.relevance![0]!.onTopic).toBe(true);
  expect(unsure.r.offTopicPenalty).toBeUndefined();
});

it('the curve stretches the top: a higher Jev mean and more band 8+ probability reach band 8+, and it never leaves 0-9', () => {
  expect(speakingCurve(7, 0.3, 1.5)).toBeGreaterThanOrEqual(8);
  expect(speakingCurve(6.5, 0, 0) - speakingCurve(6, 0, 0)).toBeGreaterThan(3 * (speakingCurve(5.5, 0, 0) - speakingCurve(5, 0, 0))); // much steeper above 6
  expect(speakingCurve(9, 1, 3)).toBeLessThanOrEqual(9);
  expect(speakingCurve(4, 0, -3)).toBeGreaterThanOrEqual(0);
});

it('default analysis never sends input_audio or requests a pronunciation report', async () => {
  const f = fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': chat() });
  setFetch(f);
  const r = await run();
  const chats = f.calls.filter((c) => c.url.includes('/chat'));
  expect(chats).toHaveLength(14); // text tagger, feedback, four criteria with three samples each
  expect(JSON.stringify(chats.map((c) => c.body))).not.toContain('input_audio');
  expect(chats.some((c) => c.body.response_format?.json_schema?.name === 'pronunciation')).toBe(false);
  expect(r.pronunciation?.llm).toBeUndefined();
  const user = JSON.parse(chats.find((c) => c.body.response_format?.json_schema?.name === 'speaking_feedback')!.body.messages[1].content);
  expect(user).not.toHaveProperty('pronunciationReport');
  expect(user).not.toHaveProperty('spokenFormsDifferingFromTranscript');
});

it('low confidence is an uncertain recognition hint, never a proven pronunciation error', async () => {
  const stt = { ...sttWords, words: sttWords.words.map((w) => ({ ...w, confidence: w.word === 'park' ? 0.3 : 0.95 })) };
  const feedback = { ...speakingLlm, errors: [...speakingLlm.errors, { category: 'pronunciation.word', severity: 'minor', start: 4, end: 4, original: 'park', correction: 'pahk', explanation: 'Wrong sound' }] };
  const f = fakeFetch({ '/audio/transcriptions': () => json(stt), '/chat/completions': chat({ feedback }) });
  setFetch(f);
  const r = await run();
  expect(r.pronunciation!.unclear).toEqual([expect.objectContaining({ w: 'park', conf: 0.3 })]);
  expect(r.errors.some((e) => e.category === 'pronunciation.word')).toBe(false);
  const requests = f.calls.filter((c) => c.url.includes('/chat') && c.body.response_format?.json_schema?.name !== 'disfluency_tags');
  for (const c of requests) {
    expect(c.body.messages[0].content).toContain('uncertain recognition hints');
    expect(c.body.messages[0].content).toContain('sounds, stress or prosody');
    expect(c.body.messages[0].content).toContain('calibrated pronunciation probability');
  }
});

it('scores each criterion three times using the right transcript kind', async () => {
  const words = ['um', 'I', 'goes', 'goes', 'to', 'the', 'park', 'yesterday'];
  const stt = { text: words.join(' '), duration: 4, words: words.map((word, i) => ({ word, start: i * 0.5, end: i * 0.5 + 0.4 })) };
  const f = fakeFetch({ '/audio/transcriptions': () => json(stt), '/chat/completions': chat({ bands: { p: 9 } }) });
  setFetch(f);
  const r = await run();
  const scores = f.calls.filter((c) => c.body?.response_format?.json_schema?.name === 'criterion_score');
  const user = (k: string) => scores.filter((c) => c.body.messages[1].content.includes(`<criterion id="${k}"`)).map((c) => c.body.messages[1].content as string);
  expect(['fc', 'lr', 'gra', 'p'].map((k) => user(k).length)).toEqual([3, 3, 3, 3]);
  expect(user('fc')[0]).toContain('<candidate_transcript kind="verbatim">\nQ1: What did you do yesterday?\num I goes goes');
  expect(user('fc')[0]).toMatch(/<measured_fluency[^>]*>\n.*1 filled pauses/);
  for (const k of ['lr', 'gra']) expect(user(k)[0]).toContain('<candidate_transcript kind="cleaned">\nQ1: What did you do yesterday?\nI goes to the park yesterday');
  expect(scores.every((c) => c.body.messages[0].content === scores[0]!.body.messages[0].content)).toBe(true);
  expect(r.criteria.p!.band).toBe(7);
  expect(r.metrics).toMatchObject({ fluency: { filledPausesPerMin: 20, repetitionsPer100w: expect.any(Number), band: expect.any(Number), verbatimStt: true } });
});

it('no speech never calls chat, including silence hallucinations and sound events', async () => {
  for (const ws of [[], ['you'], ['*Ding*'], ['Thank', 'you.'], ['[music]', 'you', 'you']]) {
    const f = fakeFetch({ '/audio/transcriptions': () => json({ text: ws.join(' '), duration: 3, words: ws.map((word) => ({ word, start: 0, end: 3 })) }), '/chat/completions': chat() });
    setFetch(f);
    expect(await run()).toMatchObject({ noSpeech: true, overall: 0, topFixes: [], errors: [] });
    expect(f.calls.some((c) => c.url.includes('/chat'))).toBe(false);
  }
  setFetch(fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': chat({ bands: { fc: 0, lr: 0, gra: 0, p: 0 } }) }));
  expect(await run()).toMatchObject({ noSpeech: true, overall: 0, criteria: {} });
});

it('maps question marks and answer windows to word boundaries', () => {
  const words = sttWords.words.map((w) => ({ w: w.word, start: w.start, end: w.end }));
  expect(questionBoundaries(['a', 'b', 'c'], words, [0, 1200]).map((q) => q.startWord)).toEqual([0, 2, -1]);
  const segments = [{ q: 0, startMs: 0, endMs: 1000 }, { q: 1, startMs: 1000, endMs: 1000 }, { q: 2, startMs: 5000, endMs: 9000 }];
  expect(transitionsOf(segments)).toEqual([[1, 1], [1, 5]]);
  expect(questionBoundaries(['a', 'b', 'c'], words, [0, 1000, 5000], segments).map((q) => q.startWord)).toEqual([0, -1, -1]);
});

it('re-anchors errors on verbatim words and drops missing or no-op corrections', async () => {
  const words = ['Also,', 'my', 'father,', 'he,', 'he', "don't", 'use', 'the', 'computer.'].map((w, i) => ({ w, start: i, end: i + 0.5 }));
  expect(anchorSpan(words, { start: 4, original: "he he don't" })).toEqual({ start: 3, end: 5 });
  expect(anchorSpan(words, { start: 4, original: 'he he' })).toEqual({ start: 3, end: 4 });
  expect(anchorSpan(words, { start: 4, original: 'not there' })).toBeNull();
  expect(anchorSpan(words, { start: 0, original: 'the computer' })).toEqual({ start: 7, end: 8 });
  expect(anchorSpan([{ w: 'a', start: 0, end: 1 }, { w: 'well-known', start: 1, end: 2 }], { start: 0, original: 'well-known' })).toEqual({ start: 1, end: 1 });
  expect(anchorSpan(words, { start: 0, original: 'he' }, 3.9)).toEqual({ start: 4, end: 4 });
  const feedback = { ...speakingLlm, errors: [{ ...speakingLlm.errors[0], start: 2, end: 2, original: 'goes' }, { ...speakingLlm.errors[0], original: 'not said' }, { ...speakingLlm.errors[0], correction: speakingLlm.errors[0]!.original }] };
  setFetch(fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': chat({ feedback }) }));
  const r = await run();
  expect(r.errors).toEqual([expect.objectContaining({ start: 1, end: 1, time: r.words![1]!.start })]);
});

it('drops shaky silence hallucinations and keeps confident words', () => {
  const w = (w: string, start: number, end: number, conf?: number) => ({ w, start, end, conf });
  const words = [w('it', 0, 0.2), w('is', 0.2, 0.4), w('you', 1.0, 1.3, 0.22), w('fine,', 2, 2.3), w('thank', 2.3, 2.5, 0.9), w('you.', 2.5, 2.7, 0.9), w('Thank', 3.5, 3.8, 0.47), w('you.', 3.8, 3.8)];
  expect(dropHallucinations(words).map((x) => x.w)).toEqual(['it', 'is', 'fine,', 'thank', 'you.']);
});

it('text disfluency tags are backed by timing evidence and summarised per type', async () => {
  const tags = { tags: [{ type: 'false_start', start: 1, reparandum: 'goes', interregnum: '', repair: '' }] };
  const paused = { ...sttWords, words: sttWords.words.map((w, i) => (i >= 2 ? { ...w, start: w.start + 0.5, end: w.end + 0.5 } : w)) };
  setFetch(fakeFetch({ '/audio/transcriptions': () => json(paused), '/chat/completions': chat({ tags }) }));
  const r = await run();
  const fl = (r.metrics as any).fluency;
  expect(fl.events).toEqual([{ kind: 'false_start', start: 0.5, end: 0.9, sources: ['llm'] }]);
  expect(fl.profile).toMatchObject({ byKind: { false_start: { n: 1 } }, total: { n: 1 }, midClauseShare: 1 });
  expect(r.timings).toMatchObject({ sttMs: expect.any(Number), totalMs: expect.any(Number) });
  expect(r.sttModel).toBe('openai/whisper-large-v3');
});

it('retains FC timing bounds and the uncalibrated P heuristic cap', async () => {
  for (const fc of [2, 9]) {
    setFetch(fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': chat({ bands: { fc, lr: 9, gra: 9, p: 9 } }) }));
    const r = await run();
    const flu = (r.metrics as any).fluency.band as number;
    expect(r.criteria.fc!.band).toBe(Math.max(Math.ceil(flu - 1), Math.min(Math.floor(flu + 1), fc)));
    expect(r.criteria.p!.band).toBeLessThanOrEqual(Math.min(7, r.criteria.fc!.band + 1));
  }
});

it('spokenQuestions: the examiner lines as said, one per answer window index; null if any window lacks one (the script is used then)', () => {
  const seg = (q: number, question?: string) => ({ q, startMs: q * 1000, endMs: q * 1000 + 900, ...(question !== undefined && { question }) });
  expect(spokenQuestions([seg(0, 'Where is your hometown?'), seg(1, ' What do you like most about it? ')])).toEqual(['Where is your hometown?', 'What do you like most about it?']);
  expect(spokenQuestions([seg(0, 'Where is your hometown?'), seg(1)])).toBeNull();
  expect(spokenQuestions([seg(0, '  ')])).toBeNull();
  expect(spokenQuestions(null)).toBeNull();
});
