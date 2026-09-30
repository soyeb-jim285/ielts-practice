import { useEffect, useRef } from 'react';

// Level is the recorder's 0..1 live level; 60/255 matches useRecorder's "speaking" byte threshold.
// ponytail: fixed threshold; add a calibration step from the mic check if noisy rooms end turns late.
export const VAD = { threshold: 60 / 255, startMs: 150, endMs: 1200 };

/**
 * Pure voice-activity detector. Speech starts when the level stays above the threshold for `startMs`;
 * the turn ends after `endMs` below it following speech. `push` returns true exactly once per turn.
 */
export function createVad(opts = VAD) {
  let aboveSince: number | null = null;
  let belowSince: number | null = null;
  let speaking = false;
  return {
    push(level: number, now: number): boolean {
      if (level > opts.threshold) {
        belowSince = null;
        aboveSince ??= now;
        if (now - aboveSince >= opts.startMs) speaking = true;
        return false;
      }
      aboveSince = null;
      if (!speaking) return false;
      belowSince ??= now;
      if (now - belowSince < opts.endMs) return false;
      speaking = false;
      belowSince = null;
      return true;
    },
    get speaking() {
      return speaking;
    },
  };
}

/** Samples `level` every 50 ms while `active` and calls `onTurnEnd` after speech followed by 1.2 s of silence. */
export function useVad(level: number, { active, onTurnEnd }: { active: boolean; onTurnEnd: () => void }) {
  const latest = useRef({ level, onTurnEnd });
  latest.current = { level, onTurnEnd };
  useEffect(() => {
    if (!active) return;
    const vad = createVad();
    const t = setInterval(() => {
      if (vad.push(latest.current.level, Date.now())) latest.current.onTurnEnd();
    }, 50);
    return () => clearInterval(t);
  }, [active]);
}
