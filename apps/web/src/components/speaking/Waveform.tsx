import { useEffect, useState } from 'react';

const BARS = 48;

/** Scrolling level bars fed by the recorder's live level (one sample per 50 ms tick). */
export function Waveform({ level, tick, active }: { level: number; tick: number; active: boolean }) {
  const [hist, setHist] = useState<number[]>(() => new Array(BARS).fill(0));
  useEffect(() => {
    if (active) setHist((h) => [...h.slice(1), level]);
  }, [tick, level, active]);
  return (
    <svg viewBox={`0 0 ${BARS * 6} 48`} className="h-12 w-full max-w-xs" aria-hidden preserveAspectRatio="none">
      {hist.map((v, i) => {
        const h = Math.max(2, Math.min(48, v * 90));
        return <rect key={i} x={i * 6 + 1} y={(48 - h) / 2} width={4} height={h} rx={2} fill={active ? 'var(--accent)' : 'var(--line)'} opacity={0.35 + (i / BARS) * 0.65} />;
      })}
    </svg>
  );
}
