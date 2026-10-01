import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GptLiveDuplex } from './gptLive';
import { appendEvent, closeEvent, muteEvent, parseLiveEvent } from './gptLiveProtocol';

it('parses the events the examiner needs and ignores the rest', () => {
  expect(parseLiveEvent('{"type":"session.started","session":{"id":"s"}}')).toEqual({ type: 'started' });
  expect(parseLiveEvent('{"type":"session.input_transcript.delta","delta":" What is","start_ms":1,"end_ms":2}')).toEqual({ type: 'inText', text: ' What is' });
  expect(parseLiveEvent('{"type":"session.output_transcript.delta","delta":"Hi."}')).toEqual({ type: 'outText', text: 'Hi.' });
  expect(parseLiveEvent('{"type":"session.closed","reason":"expired"}')).toEqual({ type: 'closed', reason: 'expired' });
  expect(parseLiveEvent('{"type":"error","error":{"message":"bad","client_event_id":"x"}}')).toEqual({ type: 'error', message: 'bad' });
  expect(parseLiveEvent('{"type":"session.usage.updated"}')).toBeNull();
  expect(parseLiveEvent('{"type":"session.output_transcript.delta"}')).toBeNull();
  expect(parseLiveEvent('nope')).toBeNull();
});

it('builds the client events', () => {
  expect(muteEvent(true, 'a')).toEqual({ type: 'session.input_audio.mute', event_id: 'a' });
  expect(muteEvent(false, 'b')).toEqual({ type: 'session.input_audio.unmute', event_id: 'b' });
  expect(closeEvent()).toEqual({ type: 'session.close', event_id: 'close' });
  expect(appendEvent('x', 'c')).toEqual({ type: 'session.instructions.append', event_id: 'c', delegation_id: null, content: 'x' });
});

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

function setup() {
  const log: string[] = [];
  const d = new GptLiveDuplex() as any;
  d.h = {
    speaking: (on: boolean) => log.push(`speaking:${on}`),
    caption: (t: string, append?: boolean) => log.push(`caption:${append ? '+' : '='}${t}`),
    answered: () => log.push('answered'),
    lost: () => log.push('lost'),
  };
  return { d, log };
}
const out = (text: string) => ({ type: 'outText' as const, text });

it('captions append; speaking ends after a quiet gap; an answer is reported when the examiner replies after the candidate spoke', () => {
  const { d, log } = setup();
  d.onEvent(out('Hello.'));
  d.onEvent(out(' Name?'));
  expect(log).toEqual(['caption:=', 'caption:+Hello.', 'speaking:true', 'caption:+ Name?']);
  vi.advanceTimersByTime(2600);
  expect(log.at(-1)).toBe('speaking:false');
  d.onEvent({ type: 'inText', text: ' Sam' });
  d.onEvent(out('Thank you.'));
  expect(log.slice(-4)).toEqual(['caption:=', 'answered', 'caption:+Thank you.', 'speaking:true']);
});

it('a cue resets the turn and the examiner stops being "speaking"', () => {
  const { d, log } = setup();
  d.onEvent(out('Part'));
  d.cue('x', false); // no key: nothing is sent
  expect(log.at(-1)).toBe('speaking:false');
  d.onEvent(out('Now'));
  expect(log.filter((l) => l === 'caption:=')).toHaveLength(2);
});

it('listen mutes only for the preparation minute', () => {
  const { d } = setup();
  const sent: any[] = [];
  d.send = (e: object) => sent.push(e);
  d.listen(false);
  d.listen(false, true);
  d.listen(true);
  expect(sent.map((e) => e.type)).toEqual(['session.input_audio.mute', 'session.input_audio.unmute', 'session.input_audio.unmute']);
});

it('a session.closed the client did not ask for is a lost connection', () => {
  const { d, log } = setup();
  d.onEvent({ type: 'closed', reason: 'connection_lost' });
  expect(log).toEqual(['lost']);
});
