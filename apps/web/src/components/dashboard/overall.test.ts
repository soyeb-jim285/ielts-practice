import { describe, expect, it } from 'vitest';
import { averageBand, changeSinceFirst, overallEstimate } from './overall';

describe('averageBand', () => {
  it('averages only the last five, rounded to a half band', () => {
    expect(averageBand([9, 6, 6, 7, 7, 7])).toEqual({ band: 6.5, n: 5 });
    expect(averageBand([6.5])).toEqual({ band: 6.5, n: 1 });
    expect(averageBand([])).toEqual({ band: null, n: 0 });
  });
});
describe('overallEstimate', () => {
  it('needs two skills', () => {
    expect(overallEstimate([7, null, null, null])).toEqual({ value: null, count: 1 });
    expect(overallEstimate([null, null, null, null])).toEqual({ value: null, count: 0 });
  });
  it('rounds the mean of the skills that exist', () => {
    expect(overallEstimate([7.5, 7, 6.5, 7])).toEqual({ value: 7, count: 4 });
    expect(overallEstimate([7.5, null, 6.5, null])).toEqual({ value: 7, count: 2 });
    expect(overallEstimate([6, 6.5, null, null]).value).toBe(6.5);
  });
});
describe('changeSinceFirst', () => {
  it('is last minus first', () => {
    expect(changeSinceFirst([5, 6, 6.5])).toBe(1.5);
    expect(changeSinceFirst([6])).toBeNull();
  });
});
