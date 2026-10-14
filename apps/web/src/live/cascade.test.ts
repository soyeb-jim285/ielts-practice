import { beforeEach, expect, it, vi } from 'vitest';
import { CascadeDuplex, SpeechGate } from './cascade';
import type { Handlers } from './duplex';

const post = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: { post } }));

let h: Handlers;
let x: CascadeDuplex;
type Inner = { speechStart(): void; speechEnd(): void; onEvent(m: object): void };
const inner = () => x as unknown as Inner;
const start = () => inner().speechStart();
const stop = () => inner().speechEnd();
const text = (t: string) => inner().onEvent({ message_type: 'committed_transcript', text: t });
const said = (t: string) => (start(), stop(), text(t));
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  post.mockReset().mockResolvedValue({ text: 'Why is that?', audio: null, contentType: null, ms: { llm: 1, tts: 0 }, costUsd: 0.001 });
  h = { speaking: vi.fn(), caption: vi.fn(), answered: vi.fn(), pending: vi.fn(), heard: vi.fn(), lost: vi.fn() };
  x = new CascadeDuplex('deepseek/deepseek-v4.1-flash');
  Object.assign(x, { h, sessionId: 's1', send: vi.fn() }); // no Scribe socket
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

it('the speech gate sends speech with its pre-roll and commits after a second of quiet, and nothing in silence', () => {
  const g = new SpeechGate();
  const c = (n: number) => Array.from({ length: n }, (_, i) => new Uint8Array([i]));
  for (let i = 0; i < 20; i++) expect(g.push(false, 40, c(1)).send).toEqual([]);
  const first = g.push(true, 40, c(1));
  expect([first.edge, first.send.length]).toEqual(['start', 9]); // 8 pre-roll chunks (320 ms) + this one
  for (let ms = 40; ms < 1000; ms += 40) expect(g.push(false, 40, c(1))).toEqual({ send: c(1) }); // a pause inside the answer still streams
  expect(g.push(false, 40, c(1)).edge).toBe('end');
  expect(g.push(false, 40, c(1)).send).toEqual([]);
});

it('OpenAI transcription: server VAD and transcript events drive the same reply, priced on the session-reported seconds', async () => {
  const o = new CascadeDuplex('inception/mercury-2.5', undefined, 'gpt-4o-mini-transcribe');
  Object.assign(o, { h, sessionId: 's1' });
  const ev = (type: string, extra: object = {}) => (o as unknown as { onOpenAi(e: object): void }).onOpenAi({ type, ...extra });
  ev('input_audio_buffer.speech_started');
  ev('input_audio_buffer.speech_stopped');
  expect(post).not.toHaveBeenCalled(); // waiting for the transcript
  ev('conversation.item.input_audio_transcription.completed', { transcript: 'I live in Dhaka.', usage: { type: 'duration', seconds: 3 } });
  expect(post.mock.calls[0]![1]).toMatchObject({ llm: 'inception/mercury-2.5', stt: 'gpt-4o-mini-transcribe', sttSeconds: 3, turns: [{ role: 'candidate', text: 'I live in Dhaka.' }] });
});
