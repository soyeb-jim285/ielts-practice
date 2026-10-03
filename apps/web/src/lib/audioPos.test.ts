import { beforeEach, describe, expect, it } from 'vitest';
import { cleanAudio, loadAudio, resumePosition, saveAudioLocal } from './audioPos';

describe('audio position store', () => {
  beforeEach(() => localStorage.clear());
  it('resumes mid-part, restarts when finished or unset', () => {
    expect(resumePosition(205.5, 600)).toBe(205.5);
    expect(resumePosition(598, 600)).toBe(0);
    expect(resumePosition(0.5, 600)).toBe(0);
    expect(resumePosition(50, NaN)).toBe(0);
  });
  it('cleans values the server would reject', () => {
    expect(cleanAudio({ pos: { '1': 12.34, '2': NaN, '3': -4, '4': 9999, x: 1 }, rate: 2 })).toEqual({ pos: { '1': 12.3, '3': 0, '4': 3600 } });
    expect(cleanAudio({ pos: {}, rate: 1.25 }).rate).toBe(1.25);
  });
  it('prefers the local copy, falls back to the server, keeps parts separate', () => {
    expect(loadAudio('a', { pos: { '1': 30 }, rate: 0.75 })).toEqual({ pos: { '1': 30 }, rate: 0.75 });
    saveAudioLocal('a', { pos: { '1': 40, '3': 7 }, rate: 1 });
    expect(loadAudio('a', { pos: { '1': 30 } })).toEqual({ pos: { '1': 40, '3': 7 }, rate: 1 });
    expect(loadAudio('b')).toBeUndefined();
  });
});
