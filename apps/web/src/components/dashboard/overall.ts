import { roundBand } from '@ielts/core';

/** Bands of the last up-to-5 results (oldest first in, as the server sends them) rounded to the nearest 0.5; null with no results. */
export function averageBand(bands: number[]): { band: number | null; n: number } {
  const last = bands.slice(-5);
  return { band: last.length ? roundBand(last.reduce((s, b) => s + b, 0) / last.length) : null, n: last.length };
}

/** Overall estimate from the skill bands that exist. Needs at least two skills, so one lucky test never poses as an overall band. */
export function overallEstimate(bands: (number | null)[]): { value: number | null; count: number } {
  const have = bands.filter((b): b is number => b != null);
  return { value: have.length >= 2 ? roundBand(have.reduce((s, b) => s + b, 0) / have.length) : null, count: have.length };
}

/** "Up 0.5 from your first" style change between the first and last result; null with fewer than two. */
export function changeSinceFirst(bands: number[]): number | null {
  return bands.length > 1 ? bands.at(-1)! - bands[0]! : null;
}
