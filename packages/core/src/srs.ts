import type { CardState } from './types';

/** SM-2 scheduling. Grade < 3 resets the card to a 1-day interval. */
export function review(s: CardState, g: 0 | 1 | 2 | 3 | 4 | 5, now = new Date()): CardState {
  const ease = Math.max(1.3, s.ease + (0.1 - (5 - g) * (0.08 + (5 - g) * 0.02)));
  if (g < 3) return { ease, reps: 0, interval: 1, due: new Date(now.getTime() + 864e5) };
  const reps = s.reps + 1;
  const interval = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(s.interval * ease);
  return { ease, reps, interval, due: new Date(now.getTime() + interval * 864e5) };
}
