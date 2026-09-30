import type { ReactNode } from 'react';
import { RadioGroup } from 'radix-ui';
import { cn } from '@/lib/utils';

export type SegmentOption<T extends string> = { value: T; label: ReactNode; 'aria-label'?: string };

/** Pill segmented control (Radix RadioGroup: radiogroup semantics, arrow-key roving focus) for 2–5 mutually exclusive options. */
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
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(v) => onChange(v as T)}
      aria-label={label}
      orientation="horizontal"
      loop
      className={cn('inline-flex rounded-lg bg-surface-2 p-1 ring-1 ring-border ring-inset', className)}
    >
      {options.map((o) => (
        <RadioGroup.Item
          key={o.value}
          value={o.value}
          aria-label={o['aria-label']}
          className={cn(
            // Phones: every option is 36 px (a 44 px group) plus the `hit` overhang; sm only shrinks from md up.
            'hit inline-flex flex-1 items-center justify-center gap-1.5 rounded-[7px] font-medium whitespace-nowrap text-muted outline-none transition-[background-color,color,box-shadow] duration-150 hover:text-ink focus-visible:ring-[3px] focus-visible:ring-ring/40 [&_svg]:size-4',
            size === 'sm' ? 'h-9 px-3 text-sm md:h-7 md:px-2.5 md:text-xs' : 'h-9 px-3 text-sm md:h-8',
            'data-[state=checked]:bg-card data-[state=checked]:text-ink data-[state=checked]:shadow-card data-[state=checked]:ring-1 data-[state=checked]:ring-border',
          )}
        >
          {o.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
