import type { CardState } from './types';

/** SM-2 scheduling. Grade < 3 resets the card to a 1-day interval. */
export function review(s: CardState, g: 0 | 1 | 2 | 3 | 4 | 5, now = new Date()): CardState {
  const ease = Math.max(1.3, s.ease + (0.1 - (5 - g) * (0.08 + (5 - g) * 0.02)));
  if (g < 3) return { ease, reps: 0, interval: 1, due: new Date(now.getTime() + 864e5) };
  const reps = s.reps + 1;
  // First success depends on the grade (Hard 1, Good 3, Easy 7 days), at least 6 (and never shorter than before) after the second; grades then differ through the ease factor.
  const interval = reps === 1 ? (g === 5 ? 7 : g === 4 ? 3 : 1) : reps === 2 ? Math.max(6, s.interval + 1) : Math.round(s.interval * ease);
  return { ease, reps, interval, due: new Date(now.getTime() + interval * 864e5) };
}
