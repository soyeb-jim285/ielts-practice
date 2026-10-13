import { beforeEach, expect, it, vi } from 'vitest';
import { CascadeDuplex } from './cascade';
import type { Handlers } from './duplex';

const post = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: { post } }));

let h: Handlers;
let x: CascadeDuplex;
const ev = (type: string, extra: object = {}) => (x as unknown as { onEvent(e: object): void }).onEvent({ type, ...extra });
const said = (text: string) => (ev('input_audio_buffer.speech_started'), ev('input_audio_buffer.speech_stopped'), ev('conversation.item.input_audio_transcription.completed', { transcript: text, usage: { type: 'duration', seconds: 2 } }));
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  post.mockReset().mockResolvedValue({ text: 'Why is that?', audio: null, contentType: null, ms: { llm: 1, tts: 0 }, costUsd: 0.001 });
  h = { speaking: vi.fn(), caption: vi.fn(), answered: vi.fn(), pending: vi.fn(), heard: vi.fn(), lost: vi.fn() };
  x = new CascadeDuplex('deepseek/deepseek-v4.1-flash');
  Object.assign(x, { h, sessionId: 's1' });
});

it('a finished, transcribed answer asks for one reply with the whole conversation and the transcribed seconds', async () => {
  x.cue('Begin the test.');
  await flush();
  said('My name is Sam.');
  await flush();
  expect(post).toHaveBeenCalledTimes(2);
  expect(post.mock.calls[1]![1]).toMatchObject({ llm: 'deepseek/deepseek-v4.1-flash', sttSeconds: 2, turns: [{ role: 'app', text: 'Begin the test.' }, { role: 'examiner', text: 'Why is that?' }, { role: 'candidate', text: 'My name is Sam.' }] });
  expect(h.answered).toHaveBeenCalledTimes(1);
  expect(h.caption).toHaveBeenLastCalledWith('Why is that?', true);
  expect(x.stats.costUsd).toBeCloseTo(0.002);
});

it('no reply while speech is untranscribed or the candidate goes on talking; a reply overtaken by new speech is dropped', async () => {
  ev('input_audio_buffer.speech_started');
  ev('input_audio_buffer.speech_stopped');
  ev('input_audio_buffer.speech_started'); // a second stretch before the first transcript lands
  ev('conversation.item.input_audio_transcription.completed', { transcript: 'I think' });
  expect(post).not.toHaveBeenCalled();
  ev('input_audio_buffer.speech_stopped');
  ev('conversation.item.input_audio_transcription.completed', { transcript: 'it is cheap.' });
  expect(post.mock.calls[0]![1].turns).toEqual([{ role: 'candidate', text: 'I think it is cheap.' }]);
  ev('input_audio_buffer.speech_started'); // they carry on before the reply arrives
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
