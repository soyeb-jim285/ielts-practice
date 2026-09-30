import { useEffect, useState } from 'react';

const BARS = 48;

/** Scrolling level bars fed by the recorder's live level (one sample per 50 ms tick). Newest on the right, older bars fade. */
export function Waveform({ level, tick, active }: { level: number; tick: number; active: boolean }) {
  const [hist, setHist] = useState<number[]>(() => new Array(BARS).fill(0));
  useEffect(() => {
    if (active) setHist((h) => [...h.slice(1), level]);
  }, [tick, level, active]);
  return (
    <svg viewBox={`0 0 ${BARS * 6} 56`} className="h-14 w-full" aria-hidden preserveAspectRatio="none">
      {hist.map((v, i) => {
        const h = Math.max(3, Math.min(56, v * 100));
        return <rect key={i} x={i * 6 + 1} y={(56 - h) / 2} width={3.5} height={h} rx={1.5} fill={active ? 'var(--accent)' : 'var(--line-strong)'} opacity={0.3 + (i / BARS) * 0.7} />;
      })}
    </svg>
  );
}
