import { expect, it } from 'vitest';
import { audioFormat, encodeWav, pronTone, transcriptStats } from './playground';

it('counts fillers, immediate repetitions and the speaking rate without fillers', () => {
  const words = ['Um,', 'I', 'I', 'think', 'uh', 'the', 'city', 'is', 'is', 'big.'].map((w, i) => ({ w, start: i * 0.5, end: i * 0.5 + 0.4 }));
  expect(transcriptStats(words)).toEqual({ words: 10, fillers: 2, repeats: 2, wpm: Math.round((8 / 4.9) * 60) });
  expect(transcriptStats([])).toEqual({ words: 0, fillers: 0, repeats: 0, wpm: 0 });
});

it('maps recorder MIME types and file names to the upload format', () => {
  expect(audioFormat('audio/webm;codecs=opus')).toBe('webm');
  expect(audioFormat('audio/mp4')).toBe('m4a');
  expect(audioFormat('', 'clip.MP3')).toBe('mp3');
  expect(audioFormat('application/octet-stream', 'x.bin')).toBeNull();
});

it('encodes 16-bit mono WAV with a valid header and clipped samples', async () => {
  const v = new DataView(await encodeWav(new Float32Array([0, 1, -2]), 16000).arrayBuffer());
  const tag = (o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => v.getUint8(o + i)));
  expect([tag(0), tag(8), tag(36), v.byteLength, v.getUint32(24, true), v.getUint32(40, true)]).toEqual(['RIFF', 'WAVE', 'data', 50, 16000, 6]);
  expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true)]).toEqual([0, 32767, -32767]);
});

it('bands pronunciation word scores for display', () => {
  expect([pronTone(92), pronTone(80), pronTone(79.9), pronTone(60), pronTone(12), pronTone(null)]).toEqual(['good', 'good', 'warn', 'warn', 'bad', 'none']);
});
