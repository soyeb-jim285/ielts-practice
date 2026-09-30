import type { ReactNode } from 'react';
import type { Tone } from './Badge';

const STROKE: Record<Tone, string> = { neutral: 'var(--muted)', accent: 'var(--accent)', good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)' };

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
  const v = Math.min(1, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
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
          style={{ transition: 'stroke-dashoffset 300ms var(--ease-out-quart), stroke 300ms' }}
        />
      </svg>
      {children && <div className="absolute inset-0 grid place-items-center text-center tabular-nums">{children}</div>}
    </div>
  );
}
