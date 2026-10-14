import { beforeEach, expect, it, vi } from 'vitest';
import { CascadeDuplex, type CascadeConfig } from './cascade';
import type { Handlers } from './duplex';

const post = vi.hoisted(() => vi.fn());
const smart = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: { post } }));
vi.mock('./smartTurn', () => ({ smartTurnProbability: smart, loadSmartTurn: async () => ({}) }));

let h: Handlers;
let x: CascadeDuplex;
type Inner = { speechStart(): void; speechEnd(commit?: boolean): void; onEvent(m: object): void; onOpenAi(e: object): void; onBlock(loud: boolean, ms: number, f16: Float32Array, chunks: Uint8Array[]): void };
const inner = () => x as unknown as Inner;
const start = () => inner().speechStart();
const stop = () => inner().speechEnd();
const text = (t: string) => inner().onEvent({ message_type: 'committed_transcript', text: t });
const said = (t: string) => (start(), stop(), text(t));
const flush = () => new Promise((r) => setTimeout(r, 0));
/** n blocks of 40 ms mic audio (16 kHz samples), loud or quiet. */
const blocks = (n: number, loud: boolean) => { for (let i = 0; i < n; i++) inner().onBlock(loud, 40, new Float32Array(640).fill(loud ? 0.1 : 0), []); };
const make = (cfg: Partial<CascadeConfig> = {}) => {
  x = new CascadeDuplex({ llm: 'deepseek/deepseek-v4.1-flash', stream: false, ...cfg });
  Object.assign(x, { h, sessionId: 's1', send: vi.fn(), smartOk: cfg.turn !== 'silence' }); // no Scribe socket; the turn model "loaded"
};

beforeEach(() => {
  post.mockReset().mockResolvedValue({ text: 'Why is that?', audio: null, contentType: null, ms: { llm: 1, tts: 0 }, costUsd: 0.001 });
  smart.mockReset();
  h = { speaking: vi.fn(), caption: vi.fn(), answered: vi.fn(), pending: vi.fn(), heard: vi.fn(), lost: vi.fn() };
  make();
});

it('a finished, transcribed answer asks for one reply with the whole conversation and the transcribed seconds', async () => {
  x.cue('Begin the test.');
  await flush();
  Object.assign(x, { sttSeconds: 2 });
  said('My name is Sam.');
  await flush();
  expect(post).toHaveBeenCalledTimes(2);
  expect(post.mock.calls[1]![1]).toMatchObject({ llm: 'deepseek/deepseek-v4.1-flash', sttSeconds: 2, turns: [{ role: 'app', text: 'Begin the test.' }, { role: 'examiner', text: 'Why is that?' }, { role: 'candidate', text: 'My name is Sam.' }] });
  expect(h.answered).toHaveBeenCalledTimes(1);
  expect(h.caption).toHaveBeenLastCalledWith('Why is that?', true);
  expect(x.stats.costUsd).toBeCloseTo(0.002);
});

it('no reply while speech is untranscribed or the candidate goes on talking; a reply overtaken by new speech is dropped', async () => {
  start();
  stop();
  start(); // a second stretch before the first transcript lands
  text('I think');
  expect(post).not.toHaveBeenCalled();
  stop();
  text('it is cheap.');
  expect(post.mock.calls[0]![1].turns).toEqual([{ role: 'candidate', text: 'I think it is cheap.' }]);
  start(); // they carry on before the reply arrives
  await flush();
  expect(h.caption).not.toHaveBeenCalled();
});

it('the long turn is transcribed without replies; the follow cue sends it before the cue', async () => {
  x.listen(false, true);
  said('My favourite book is Dune.');
  await flush();
  expect(post).not.toHaveBeenCalled();
  x.cue('The candidate has finished their talk.');
  x.listen(true);
  expect(post.mock.calls[0]![1].turns).toEqual([{ role: 'candidate', text: 'My favourite book is Dune.' }, { role: 'app', text: 'The candidate has finished their talk.' }]);
});

it('a commit whose transcript never comes stops blocking the reply', async () => {
  vi.useFakeTimers();
  try {
    start();
    stop();
    start();
    stop(); // this one's transcript is lost
    text('I like tea.');
    expect(post).not.toHaveBeenCalled();
    vi.advanceTimersByTime(8000);
    expect(post.mock.calls[0]![1].turns).toEqual([{ role: 'candidate', text: 'I like tea.' }]);
  } finally {
    vi.useRealTimers();
  }
});

it('fixed silence: the turn ends after the configured quiet, not before', () => {
  make({ turn: 'silence', silenceMs: 600 });
  blocks(5, true);
  blocks(14, false); // 560 ms
  expect(h.pending).toHaveBeenLastCalledWith(true);
  blocks(1, false); // 600 ms
  expect(h.pending).toHaveBeenLastCalledWith(false);
  expect(smart).not.toHaveBeenCalled();
});

it('Smart Turn: a "not finished" pause is checked again as it grows, a "finished" one ends the turn at once, and the cap ends it anyway', async () => {
  make({ turn: 'smart', smartPauseMs: 240, smartThreshold: 0.5, smartMaxMs: 2000 });
  smart.mockResolvedValueOnce({ p: 0.2, ms: 30 }).mockResolvedValueOnce({ p: 0.3, ms: 30 }).mockResolvedValueOnce({ p: 0.9, ms: 25 });
  blocks(10, true);
  blocks(6, false); // 240 ms pause → check: not finished
  await flush();
  expect(smart).toHaveBeenCalledTimes(1);
  expect(h.pending).toHaveBeenLastCalledWith(true);
  blocks(5, false); // 440 ms: too soon for the next look
  expect(smart).toHaveBeenCalledTimes(1);
  blocks(5, true); // they go on
  blocks(6, false); // new pause → check: still not finished
  await flush();
  blocks(8, false); // 560 ms: look again → finished
  await flush();
  expect(smart).toHaveBeenCalledTimes(3);
  expect(h.pending).toHaveBeenLastCalledWith(false);
  // the cap: the model never answers "finished", the turn still ends after smartMaxMs of quiet
  smart.mockResolvedValue({ p: 0.1, ms: 20 });
  blocks(5, true);
  blocks(50, false); // 2000 ms
  await flush();
  expect(h.pending).toHaveBeenLastCalledWith(false);
});

it('batch ears transcribe a finished piece at a "not finished" pause, then only the tail, and reply with the joined text', async () => {
  make({ stt: 'batch:nvidia/parakeet-tdt-0.6b-v3', turn: 'smart', smartPauseMs: 240, chunkedStt: true });
  post.mockImplementation(async (path: string) =>
    path === '/live/cascade/transcribe' ? { text: post.mock.calls.filter((c) => c[0] === path).length === 1 ? 'I think' : 'it is cheap.', costUsd: 0.0001 } : { text: 'Why?', audio: null, contentType: null, ms: { llm: 1, tts: 0 }, costUsd: 0 },
  );
  smart.mockResolvedValueOnce({ p: 0.1, ms: 20 }).mockResolvedValueOnce({ p: 0.95, ms: 20 });
  blocks(25, true); // 1 s of speech
  blocks(6, false);
  await vi.waitFor(() => expect(post.mock.calls.filter((c) => c[0] === '/live/cascade/transcribe')).toHaveLength(1)); // the first piece went while they paused
  blocks(20, true);
  blocks(6, false);
  await vi.waitFor(() => expect(post.mock.calls.some((c) => c[0] === '/live/cascade/reply')).toBe(true));
  const tx = post.mock.calls.filter((c) => c[0] === '/live/cascade/transcribe');
  expect(tx).toHaveLength(2);
  expect(tx[0]![1]).toMatchObject({ model: 'nvidia/parakeet-tdt-0.6b-v3' });
  const reply = post.mock.calls.find((c) => c[0] === '/live/cascade/reply')!;
  expect(reply[1]).toMatchObject({ stt: 'nvidia/parakeet-tdt-0.6b-v3', turns: [{ role: 'candidate', text: 'I think it is cheap.' }] });
  expect(reply[1].sttSeconds).toBeUndefined(); // priced by /transcribe
});

it('OpenAI transcription: server VAD and transcript events drive the same reply, priced on the session-reported seconds', async () => {
  make({ llm: 'inception/mercury-2.5', stt: 'gpt-4o-mini-transcribe' });
  const ev = (type: string, extra: object = {}) => inner().onOpenAi({ type, ...extra });
  ev('input_audio_buffer.speech_started');
  ev('input_audio_buffer.speech_stopped');
  expect(post).not.toHaveBeenCalled(); // waiting for the transcript
  ev('conversation.item.input_audio_transcription.completed', { transcript: 'I live in Dhaka.', usage: { type: 'duration', seconds: 3 } });
  expect(post.mock.calls[0]![1]).toMatchObject({ llm: 'inception/mercury-2.5', stt: 'gpt-4o-mini-transcribe', sttSeconds: 3, turns: [{ role: 'candidate', text: 'I live in Dhaka.' }] });
});

it('streamed reply: captions per sentence, clips play in sentence order, and the timeline records the answered turn', async () => {
  make({ stream: true, sentenceTts: true, turn: 'silence', silenceMs: 400 });
  const started: number[] = [];
  const node = (id: number) => ({ buffer: null as unknown, connect() {}, start: () => started.push(id), stop() {}, onended: null as null | (() => void) });
  let n = 0;
  Object.assign(x, {
    ctx: { currentTime: 0, decodeAudioData: async (b: ArrayBuffer) => ({ duration: 1, id: new Uint8Array(b)[0] }), createBufferSource: () => node(n++) },
    tap: {},
  });
  const lines = [
    { type: 'text', i: 0, text: 'Thank you.', ms: 300 },
    { type: 'text', i: 1, text: 'Why is that?', ms: 500 },
    { type: 'audio', i: 1, audio: btoa('\x01'), contentType: 'audio/mpeg', ms: 800 }, // the second clip arrives first: it must wait
    { type: 'audio', i: 0, audio: btoa('\x00'), contentType: 'audio/mpeg', ms: 900 },
    { type: 'done', text: 'Thank you. Why is that?', ms: { llmFirst: 300, llm: 600, ttsFirst: 800 }, costUsd: 0.002 },
  ];
  const fetchMock = vi.fn(async () => new Response(lines.map((l) => JSON.stringify(l)).join('\n') + '\n'));
  vi.stubGlobal('fetch', fetchMock);
  try {
    blocks(10, true);
    blocks(10, false); // 400 ms → turn ends
    text('Because it is calm.');
    for (let i = 0; i < 10; i++) await flush();
    expect(fetchMock).toHaveBeenCalledWith('/api/live/cascade/reply-stream', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toMatchObject({ sentenceTts: true, turns: [{ role: 'candidate', text: 'Because it is calm.' }] });
    expect(h.caption).toHaveBeenCalledWith('Thank you.', true);
    expect(h.caption).toHaveBeenCalledWith(' Why is that?', true);
    expect(started).toEqual([0, 1]); // clip 0 (sentence 0) was scheduled first even though clip 1 arrived first
    expect(x.stats.costUsd).toBeCloseTo(0.002);
    expect(x.stats.timeline).toHaveLength(1);
    expect(x.stats.timeline[0]).toMatchObject({ llm: 300, tts: 500, text: 'Thank you. Why is that?' });
  } finally {
    vi.unstubAllGlobals();
  }
});

it('OpenAI with browser turn detection: Smart Turn ends the answer and the browser commits it to the session', async () => {
  make({ stt: 'gpt-4o-mini-transcribe', turn: 'smart', smartPauseMs: 240 });
  const sent: string[] = [];
  Object.assign(x, { dc: { send: (m: string) => sent.push(m) } });
  smart.mockResolvedValueOnce({ p: 0.9, ms: 20 });
  blocks(10, true);
  blocks(6, false);
  await flush();
  expect(sent.map((m) => JSON.parse(m).type)).toEqual(['input_audio_buffer.commit']);
  expect(x.stats.lastCheck).toEqual({ p: 0.9, ms: 20 });
  inner().onOpenAi({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Hello.', usage: { type: 'duration', seconds: 1 } });
  expect(post.mock.calls[0]![1]).toMatchObject({ stt: 'gpt-4o-mini-transcribe', turns: [{ role: 'candidate', text: 'Hello.' }] });
});

it('start-up steps record done/failed with times, and the first line finishes when the examiner starts speaking', async () => {
  const step = (x as unknown as { step(k: string, l: string, run: () => Promise<unknown>): Promise<unknown> }).step.bind(x);
  await step('mic', 'Microphone', async () => 1);
  await expect(step('stt', 'Transcriber', async () => { throw new Error('no token'); })).rejects.toThrow('no token');
  (x as unknown as { firstLine(): void }).firstLine();
  expect(x.stats.steps.map((s) => s.state)).toEqual(['done', 'failed', 'running']);
  expect(x.stats.steps[1]).toMatchObject({ detail: 'no token', ms: expect.any(Number) });
  await flush();
  expect(x.stats.steps[2]).toMatchObject({ key: 'first', state: 'done', ms: expect.any(Number) });
});
