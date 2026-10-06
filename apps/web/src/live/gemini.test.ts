import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GeminiDuplex } from './gemini';
import { toBase64 } from './pcm';

const handlers = () => {
  const log: string[] = [];
  return {
    log,
    h: {
      speaking: (on: boolean) => log.push(`speaking:${on}`),
      caption: (t: string, append?: boolean) => log.push(`caption:${append ? '+' : '='}${t}`),
      answered: () => log.push('answered'),
      lost: () => log.push('lost'),
    },
  };
};

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

function setup() {
  const { log, h } = handlers();
  const d = new GeminiDuplex() as any;
  const player = { pushed: 0, flushed: 0, queued: 0.5, push() { this.pushed++; }, flush() { this.flushed++; } };
  Object.assign(d, { h, player });
  return { d, log, player };
}
const audio = { type: 'audio' as const, data: toBase64(new Uint8Array(4800)) };

it('an examiner turn: caption resets, audio plays, "speaking" ends once the queue has drained', () => {
  const { d, log, player } = setup();
  d.onEvent(audio);
  d.onEvent({ type: 'outText', text: 'Hello. ' });
  d.onEvent({ type: 'outText', text: 'My name is Alex.' });
  d.onEvent({ type: 'generationComplete' });
  d.onEvent({ type: 'turnComplete' });
  expect(log).toEqual(['caption:=', 'speaking:true', 'caption:+Hello. ', 'caption:+My name is Alex.']);
  expect(player.pushed).toBe(1);
  const speaking = () => log.filter((l) => l.startsWith('speaking')).at(-1);
  vi.advanceTimersByTime(400);
  expect(speaking()).toBe('speaking:true'); // 0.5 s still queued
  vi.advanceTimersByTime(300);
  expect(speaking()).toBe('speaking:false');
});

it('reports the candidate\'s answer when the next examiner turn starts after they spoke', () => {
  const { d, log } = setup();
  d.onEvent(audio); // intro
  d.onEvent({ type: 'turnComplete' });
  vi.advanceTimersByTime(1000); // the intro finished playing
  d.onEvent({ type: 'inText', text: 'My name is Sam' });
  d.onEvent(audio); // examiner's reply
  expect(log.filter((l) => l === 'answered')).toHaveLength(1);
  expect(log.slice(-3)).toEqual(['caption:=', 'answered', 'speaking:true']);
  d.onEvent(audio); // same turn continues: no second report
  expect(log.filter((l) => l === 'answered')).toHaveLength(1);
});

it('a turn without a spoken answer in between (the examiner continues) is not an answer', () => {
  const { d, log } = setup();
  d.onEvent(audio);
  d.onEvent({ type: 'turnComplete' });
  d.onEvent(audio);
  expect(log).not.toContain('answered');
});

it('interruption flushes playback at once and the next output is a new turn', () => {
  const { d, log, player } = setup();
  d.onEvent(audio);
  d.onEvent({ type: 'interrupted' });
  expect(player.flushed).toBe(1);
  expect(log.at(-1)).toBe('speaking:false');
  d.onEvent({ type: 'outText', text: 'Sorry, go on.' });
  expect(log).toContain('caption:+Sorry, go on.');
  expect(log.at(-1)).toBe('speaking:true');
  expect(log.filter((l) => l === 'caption:=')).toHaveLength(2);
});

it('a cue cuts the examiner off and is queued while the socket is down', () => {
  const { d, player } = setup();
  d.cue('Move to Part 2.');
  expect(player.flushed).toBe(1);
  expect(d.queued).toBe('Move to Part 2.');
});

it('caption-only output completes the speaking lifecycle', () => {
  const { d, log } = setup();
  d.onEvent({ type: 'outText', text: 'Please begin.' });
  d.onEvent({ type: 'turnComplete' });
  vi.advanceTimersByTime(1000);
  expect(log.filter((l) => l.startsWith('speaking'))).toEqual(['speaking:true', 'speaking:false']);
});

it('missing turnComplete still ends output after the audio queue drains', () => {
  const { d, log } = setup();
  d.onEvent(audio);
  vi.advanceTimersByTime(6000);
  expect(log.at(-1)).toBe('speaking:false');
});
