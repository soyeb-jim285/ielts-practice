import type { ReactNode } from 'react';
import { RadioGroup } from 'radix-ui';
import { cn } from '@/lib/utils';
import { useSlide } from './slide';

export type SegmentOption<T extends string> = { value: T; label: ReactNode; 'aria-label'?: string };

/** Segmented control (Radix RadioGroup: radiogroup semantics, arrow-key roving focus) for 2-5 mutually exclusive options. The thumb slides between options. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  className,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  /** Accessible name for the group. */
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const { ref, box, ready } = useSlide<HTMLDivElement>(value);
  return (
    <RadioGroup.Root
      ref={ref}
      value={value}
      onValueChange={(v) => onChange(v as T)}
      aria-label={label}
      orientation="horizontal"
      loop
      className={cn('relative inline-flex rounded-md bg-surface-2 p-0.5 ring-1 ring-line ring-inset', className)}
    >
      {box && (
        <span
          aria-hidden
          className={cn('pointer-events-none absolute top-0 left-0 rounded-sm bg-card shadow-card ring-1 ring-line', ready && 'transition-[transform,width] duration-200 ease-(--ease-out-expo)')}
          style={{ width: box.w, height: box.h, transform: `translate(${box.x}px, ${box.y}px)` }}
        />
      )}
      {options.map((o) => (
        <RadioGroup.Item
          key={o.value}
          value={o.value}
          aria-label={o['aria-label']}
          className={cn(
            // One look everywhere: 14px/500, muted -> ink when selected. Options are really 40px tall on phones (no overlapping hit areas); from md the md group is 36px like Input/Select/Button, sm is 32px for in-panel toggles.
            'relative z-[1] inline-flex flex-1 items-center justify-center gap-1.5 rounded-sm px-3 text-sm font-medium whitespace-nowrap text-muted transition-colors duration-[120ms] hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&_svg]:size-4',
            size === 'sm' ? 'h-9 md:h-7 md:px-2.5' : 'h-10 md:h-8',
            'data-[state=checked]:text-ink',
          )}
        >
          {o.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
