import { describe, it, expect } from 'vitest';
import { overallBand, roundBand, sessionBand, speakingOverall, weightedWritingBand, writingOverall } from './band';
describe('roundBand', () => {
  it.each([[6, 6], [6.1, 6], [6.25, 6.5], [6.4, 6.5], [6.5, 6.5], [6.74, 6.5], [6.75, 7], [6.9, 7], [8.875, 9]])('%f -> %f', (x, y) => expect(roundBand(x)).toBe(y));
});
it('speaking overall', () => expect(speakingOverall({ fc: 7, lr: 6, gra: 6, p: 6 })).toEqual({ raw: 6.25, band: 6.5 }));
it('writing weights task 2 double', () => {
  expect(writingOverall(6, 7)).toEqual({ raw: 20 / 3, band: 6.5 });
  expect(writingOverall(null, 7)).toEqual({ raw: 7, band: 7 });
});
describe('mock overall band', () => {
  it.each([[[6, 6, 6, 7], 6.5], [[6, 7, 7, 7], 7], [[6, 6, 6, 6.5], 6], [[6, 6.5, 6.5, 6.5], 6.5], [[9, 9, 9, 9], 9]])('%j -> %f', (b, y) => expect(overallBand(b)).toBe(y));
  it('writing counts task 2 twice, speaking is the part mean', () => {
    expect(weightedWritingBand(6, 7)).toBe(6.5);
    expect(weightedWritingBand(7, 6)).toBe(6.5);
    expect(sessionBand([6, 6, 7])).toBe(6.5);
  });
});
