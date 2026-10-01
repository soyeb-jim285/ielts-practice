import { expect, it } from 'vitest';
import { bytesToPcm16, floatToPcm16, fromBase64, MicEncoder, pcm16ToBytes, pcm16ToFloat, Resampler, toBase64 } from './pcm';

const sine = (n: number, rate: number, hz = 440) => Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / rate));

it('resamples 48 kHz → 16 kHz to a third of the samples, whatever the chunking', () => {
  const x = sine(4800, 48_000);
  const whole = new Resampler(48_000, 16_000).push(x);
  expect(whole.length).toBe(1600);
  const r = new Resampler(48_000, 16_000);
  const parts = [r.push(x.subarray(0, 1)), r.push(x.subarray(1, 1000)), r.push(x.subarray(1000))];
  const joined = Float32Array.from(parts.flatMap((p) => [...p]));
  expect(joined.length).toBe(1600);
  joined.forEach((v, i) => expect(v).toBeCloseTo(whole[i]!, 5));
});

it('keeps a 440 Hz tone at its amplitude and handles non-integer ratios (44.1 kHz)', () => {
  const y = new Resampler(44_100, 16_000).push(sine(44_100, 44_100));
  expect(y.length).toBe(16_000);
  expect(Math.max(...y.slice(100))).toBeGreaterThan(0.45);
  expect(Math.max(...y)).toBeLessThanOrEqual(0.5);
});

it('PCM16 conversion clips, is little-endian and round-trips', () => {
  const p = floatToPcm16(Float32Array.from([0, 1, -1, 2, -2, 0.5]));
  expect([...p]).toEqual([0, 32767, -32768, 32767, -32768, 16383]);
  const bytes = pcm16ToBytes(Int16Array.from([1, -2, 0x1234]));
  expect([...bytes]).toEqual([1, 0, 0xfe, 0xff, 0x34, 0x12]);
  expect([...bytesToPcm16(bytes)]).toEqual([1, -2, 0x1234]);
  expect([...bytesToPcm16(new Uint8Array([1, 0, 9]))]).toEqual([1]); // odd trailing byte dropped
  expect(pcm16ToFloat(Int16Array.from([-32768, 16384]))[0]).toBe(-1);
});

it('base64 round-trips large buffers', () => {
  const b = Uint8Array.from({ length: 100_000 }, (_, i) => i % 256);
  expect(fromBase64(toBase64(b))).toEqual(b);
  expect(toBase64(new Uint8Array([104, 105]))).toBe('aGk=');
});

it('MicEncoder emits 40 ms (1280 byte) chunks and carries the remainder', () => {
  const enc = new MicEncoder(48_000);
  const sizes: number[] = [];
  let total = 0;
  for (let i = 0; i < 20; i++) for (const c of enc.push(sine(512, 48_000))) (sizes.push(c.length), (total += c.length));
  expect(sizes.length).toBeGreaterThan(0);
  expect(new Set(sizes)).toEqual(new Set([1280]));
  expect(total).toBeLessThanOrEqual((20 * 512 * 2) / 3);
  expect(total).toBeGreaterThan((20 * 512 * 2) / 3 - 1280);
});
