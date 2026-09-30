import { useCallback, useEffect, useRef, useState } from 'react';

/** Wall-clock countdown (immune to throttled timers). `left` is whole seconds remaining. */
export function useCountdown(seconds: number, opts?: { onEnd?: () => void }) {
  const [left, setLeft] = useState(seconds);
  const [running, setRunning] = useState(false);
  const endAt = useRef(0);
  const onEnd = useRef(opts?.onEnd);
  onEnd.current = opts?.onEnd;

  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const l = Math.max(0, Math.ceil((endAt.current - Date.now()) / 1000));
      setLeft(l);
      if (l === 0) {
        setRunning(false);
        onEnd.current?.();
      }
    };
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [running]);

  const start = useCallback(() => {
    setLeft((l) => {
      endAt.current = Date.now() + l * 1000;
      return l;
    });
    setRunning(true);
  }, []);
  const stop = useCallback(() => setRunning(false), []);
  const reset = useCallback(() => {
    setRunning(false);
    setLeft(seconds);
  }, [seconds]);

  return { left, running, start, stop, reset };
}
