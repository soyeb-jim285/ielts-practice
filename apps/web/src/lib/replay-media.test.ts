import { expect, it } from 'vitest';
import { mediaAt, mediaFix, mediaTimeline } from './replay-media';

const audio = (id: number, attrs: object = {}) => ({ type: 2, tagName: 'audio', id, attributes: attrs, childNodes: [] });
const media = (t: number, id: number, type: number, currentTime: number, extra: object = {}) => ({ type: 3, timestamp: t, data: { source: 7, id, type, currentTime, ...extra } });

it('mediaTimeline + mediaAt: snapshot state, play/pause/seek, nodes added later, playback moves on at its rate', () => {
  const events = [
    { type: 4, timestamp: 1000, data: {} },
    { type: 2, timestamp: 1000, data: { node: { type: 0, childNodes: [audio(5, { rr_mediaState: 'paused', rr_mediaCurrentTime: 0 })] } } },
    media(3000, 5, 0, 0), // play at 2 s (times are from the first event)
    media(13000, 5, 1, 10), // pause at 12 s, 10 s in
    media(15000, 5, 2, 40), // seek while paused
    media(16000, 5, 0, 40, { playbackRate: 1.5 }), // play at 1.5x
    { type: 3, timestamp: 20000, data: { source: 0, adds: [{ parentId: 1, node: audio(9, { rr_mediaState: 'played', rr_mediaCurrentTime: 7 }) }] } },
  ];
  const m = mediaTimeline(events);
  expect([...m.keys()]).toEqual([5, 9]);
  expect(mediaAt(m.get(5), 500)).toMatchObject({ playing: false, time: 0 });
  expect(mediaAt(m.get(5), 7000)).toMatchObject({ playing: true, time: 5 });
  expect(mediaAt(m.get(5), 13500)).toMatchObject({ playing: false, time: 10 });
  expect(mediaAt(m.get(5), 14500)).toMatchObject({ playing: false, time: 40 });
  expect(mediaAt(m.get(5), 17000)).toMatchObject({ playing: true, time: 43, rate: 1.5 });
  expect(mediaAt(m.get(9), 18500)).toBeNull(); // not in the page yet
  expect(mediaAt(m.get(9), 21000)).toMatchObject({ playing: true, time: 9 });
});

it('mediaFix: rate = recorded x player speed, capped at 16x and muted beyond; seeks only past a speed-scaled drift; paused player pauses media', () => {
  const want = { at: 0, playing: true, time: 30, rate: 1, volume: 0.8, muted: false };
  const el = { currentTime: 30.2, paused: false, duration: 600 };
  expect(mediaFix(el, want, 2, true)).toEqual({ play: true, rate: 2, muted: false, volume: 0.8, seekTo: null });
  expect(mediaFix({ ...el, currentTime: 25 }, want, 1, true).seekTo).toBe(30);
  expect(mediaFix({ ...el, currentTime: 28.5 }, want, 8, true).seekTo).toBeNull(); // 1.5 s is within 8x tolerance
  expect(mediaFix(el, want, 24, true)).toMatchObject({ rate: 16, muted: true });
  expect(mediaFix(el, want, 1, false).play).toBe(false);
  expect(mediaFix(el, { ...want, time: 700 }, 1, true)).toMatchObject({ play: false, seekTo: 600 }); // past the end
});
