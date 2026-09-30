import { useEffect, useState, type ReactNode } from 'react';
import type { Tone } from './Badge';

const STROKE: Record<Tone, string> = { neutral: 'var(--muted)', accent: 'var(--accent)', info: 'var(--sky)', good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)' };

/** Circular progress (timers, streak goals, scores). `value` 0..1; put the readout in children. */
export function ProgressRing({
  value,
  size = 64,
  stroke = 6,
  tone = 'accent',
  label,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  tone?: Tone;
  /** Accessible name, e.g. "Time used". */
  label: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const target = Math.min(1, Math.max(0, value));
  const [v, setV] = useState(0); // mount empty, fill on the next frame
  useEffect(() => {
    const id = requestAnimationFrame(() => setV(target));
    return () => cancelAnimationFrame(id);
  }, [target]);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(target * 100)}
      className="relative inline-grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={STROKE[tone]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ transition: 'stroke-dashoffset 600ms var(--ease-out-expo), stroke 200ms' }}
        />
      </svg>
      {children && <div className="absolute inset-0 grid place-items-center text-center tabular-nums">{children}</div>}
    </div>
  );
}
