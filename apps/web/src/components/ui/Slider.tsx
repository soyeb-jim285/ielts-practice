import { useId, type ReactNode } from 'react';
import { Slider as ShSlider } from './shadcn/slider';

/** Labelled slider (Radix) with the current value shown on the right. Focus the thumb and use the arrow keys, Home or End. */
export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  format = String,
  hint,
}: {
  label: ReactNode;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => ReactNode;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <span id={id} className="text-sm font-medium text-ink">
          {label}
        </span>
        <output htmlFor={id} className="text-sm tabular-nums text-muted">
          {format(value)}
        </output>
      </div>
      <ShSlider min={min} max={max} step={step} value={[value]} onValueChange={([v]) => v !== undefined && onChange(v)} aria-labelledby={id} className="h-6" />
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}
