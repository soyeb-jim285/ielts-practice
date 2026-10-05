import { describe, expect, it } from 'vitest';
import { capBuffer, isExcluded, splitChunk } from './replay';

const ev = (type: number, pad = 0) => ({ type, pad: 'x'.repeat(pad) });

describe('replay helpers', () => {
  it('excludes the auth pages and anything under them', () => {
    for (const p of ['/login', '/signup', '/forgot-password', '/reset-password', '/login/verify']) expect(isExcluded(p)).toBe(true);
    for (const p of ['/', '/settings', '/speaking']) expect(isExcluded(p)).toBe(false);
  });

  it('splits a chunk under the limit, never returning an empty head', () => {
    const events = [ev(3, 400), ev(3, 400), ev(3, 400)];
    const [head, rest] = splitChunk(events, 1000);
    expect(head).toHaveLength(2);
    expect(rest).toHaveLength(1);
    expect(splitChunk([ev(2, 5000)], 1000)[0]).toHaveLength(1);
    expect(splitChunk([], 1000)).toEqual([[], []]);
  });

  it('caps the buffer but keeps the first Meta and FullSnapshot', () => {
    const events = [ev(4), ev(2, 600), ev(3, 300), ev(3, 300), ev(2, 600)];
    const out = capBuffer(events, 700);
    expect(out.map((e) => e.type)).toEqual([4, 2]);
  });
});
