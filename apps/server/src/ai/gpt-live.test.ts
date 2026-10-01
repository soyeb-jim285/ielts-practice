import { expect, it } from 'vitest';
import type { SpeakingTest } from '../routes/prompts';
import { CUE_PHASE, GPT_LIVE_CUES, gptLiveCue, gptLiveInstructions } from './examiner';
import { clientMessage, cueEvent, scrub, sessionConfig, sessionStart, Transcript, webrtcBody } from './gpt-live';

const prompt = (id: string, part: number, extra = {}) => ({
  id, slug: id, skill: 'speaking' as const, part, variant: null, type: 't', topic: `topic ${id}`, title: `Describe ${id}`, body: `body ${id}`,
  bullets: null, followUps: null, chart: null, imageUrl: null, source: 'generated' as const, sourceRef: null, groupId: 'g', done: false, ...extra,
});
const test: SpeakingTest = {
  part1: ['a', 'b', 'c'].map((t) => prompt(t, 1, { followUps: [1, 2, 3, 4].map((n) => `${t} question ${n}?`) })),
  part2: prompt('a book', 2, { bullets: ['what it is', 'why you liked it'], followUps: ['Do you read often?'] }),
  part3: prompt('reading', 3, { followUps: ['Do people read less now?', 'Why?'] }),
};

it('WebRTC session body: server-owned model, voice and instructions, the offer as transport, no delegation', () => {
  const b = webrtcBody('v=0 offer') as any;
  expect(b.transport).toEqual({ type: 'webrtc', sdp: 'v=0 offer' });
  expect(b.session).toMatchObject({ model: 'gpt-live-1', audio: { output: { voice: 'vesper' } }, instructions: gptLiveInstructions() });
  expect(b.session.audio.format).toBeUndefined();
  expect('delegation' in b.session).toBe(false);
});

it('WebSocket session.start: pcm16 at 24 kHz', () => {
  expect(sessionStart()).toEqual({ type: 'session.start', session: sessionConfig('websocket') });
  expect((sessionConfig('websocket') as any).audio).toEqual({ output: { voice: 'vesper' }, format: { type: 'audio/pcm', rate: 24000 } });
});

it('instructions: short, British, no feedback, backchannel/interruption policy, never delegates', () => {
  const t = gptLiveInstructions();
  expect(t.length).toBeLessThan(3000);
  for (const needle of ['British English', 'Never give feedback', 'Backchannel policy', 'Interruption policy', 'Never delegate']) expect(t).toContain(needle);
});

it('cues: each carries its part detail and stays under the 500-token append limit', () => {
  for (const c of GPT_LIVE_CUES) {
    const text = gptLiveCue(c, test);
    expect(text.length / 3.5, c).toBeLessThan(500);
    expect(cueEvent(c, test)).toMatchObject({ type: 'session.instructions.append', delegation_id: null, content: text });
  }
  expect(gptLiveCue('begin', test)).toContain('could you tell me your full name'.replace('could', 'Could'));
  expect(gptLiveCue('begin', test)).toContain('c question 4?');
  expect(gptLiveCue('part2', test)).toContain('- why you liked it');
  expect(gptLiveCue('part2', test)).toContain('silent');
  expect(gptLiveCue('talk', test)).toMatch(/no "mm"/);
  expect(gptLiveCue('follow', test)).toContain('Do you read often?');
  expect(gptLiveCue('follow', test)).toContain('Do people read less now?');
  expect(gptLiveCue('follow-timeup', test)).toContain("That's the end of your time.");
  expect(gptLiveCue('follow', test)).not.toContain("end of your time");
  expect(gptLiveCue('closing', test)).toContain('That is the end of the speaking test.');
  expect(CUE_PHASE.talk).toBe('p2-talk');
});

it('relay allowlist: audio, mute, unmute, close and cues pass; everything else is dropped', () => {
  expect(clientMessage('{"type":"session.input_audio.append","audio":"AAA="}')).toEqual({ upstream: { type: 'session.input_audio.append', audio: 'AAA=' } });
  expect(clientMessage('{"type":"session.input_audio.mute","junk":1}')).toEqual({ upstream: { type: 'session.input_audio.mute' } });
  expect(clientMessage('{"type":"session.input_audio.unmute"}')).toEqual({ upstream: { type: 'session.input_audio.unmute' } });
  expect(clientMessage('{"type":"session.close"}')).toEqual({ upstream: { type: 'session.close' } });
  expect(clientMessage('{"type":"app.cue","cue":"part2"}')).toEqual({ cue: 'part2' });
  expect(clientMessage('{"type":"app.cue","cue":"anything"}')).toBeNull();
  for (const bad of ['{"type":"session.start","session":{"model":"x"}}', '{"type":"session.instructions.append","content":"x"}', '{"type":"session.update"}', '{"type":"session.input_audio.append"}', 'not json', '[]']) expect(clientMessage(bad), bad).toBeNull();
  expect(clientMessage(JSON.stringify({ type: 'session.input_audio.append', audio: 'A'.repeat(70_000) }))).toBeNull();
});

it('scrub removes the instructions from session events', () => {
  expect(JSON.parse(scrub('{"type":"session.started","session":{"id":"s","instructions":"secret"}}'))).toEqual({ type: 'session.started', session: { id: 's' } });
  expect(JSON.parse(scrub('{"type":"session.output_audio.delta","delta":"AAA="}'))).toMatchObject({ audio: 'AAA=', delta: 'AAA=' });
  expect(scrub('{"type":"x"}')).toBe('{"type":"x"}');
});

it('transcript: deltas append verbatim, turns alternate, phases follow the script', () => {
  let n = 0;
  const t = new Transcript(() => ++n);
  const out = (delta: string) => t.feed({ type: 'session.output_transcript.delta', delta });
  const inp = (delta: string, s = 0, e = 0) => t.feed({ type: 'session.input_transcript.delta', delta, start_ms: s, end_ms: e });
  expect(t.feed({ type: 'session.usage.updated' })).toBe(false);
  out('Hello. My name is'); out(' Alex.');
  inp(' My name', 1000, 1300); inp(' is Sam.', 1300, 2500);
  out('Thank you.'); // examiner after the candidate's answer: intro → p1
  out(' Where do you live?');
  t.setPhase('p2-prep');
  out('Now Part 2.');
  t.setPhase('p2-talk');
  inp('I want to talk about', 0, 2000);
  t.setPhase('p2-follow');
  out('Thank you. Do you read?');
  inp('Yes.');
  out('Part 3 now.'); // after the rounding-off answer: p2-follow → p3
  expect(t.turns.map((x) => [x.role, x.phase, x.text])).toEqual([
    ['examiner', 'intro', 'Hello. My name is Alex.'],
    ['candidate', 'intro', ' My name is Sam.'],
    ['examiner', 'p1', 'Thank you. Where do you live?'],
    ['examiner', 'p2-prep', 'Now Part 2.'],
    ['candidate', 'p2-talk', 'I want to talk about'],
    ['examiner', 'p2-follow', 'Thank you. Do you read?'],
    ['candidate', 'p2-follow', 'Yes.'],
    ['examiner', 'p3', 'Part 3 now.'],
  ]);
  expect(t.turns[1]!.durationMs).toBe(1500);
});
