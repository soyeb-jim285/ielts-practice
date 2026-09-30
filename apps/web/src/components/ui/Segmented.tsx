import { clsx } from 'clsx';
import type { KeyboardEvent, ReactNode } from 'react';

export type SegmentOption<T extends string> = { value: T; label: ReactNode; 'aria-label'?: string };

/** Pill segmented control (radiogroup) for 2–5 mutually exclusive options. */
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
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + d + options.length) % options.length]!;
    onChange(next.value);
    e.currentTarget.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKey} className={clsx('inline-flex rounded-control bg-surface-2 p-1 ring-1 ring-line ring-inset', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            data-value={o.value}
            aria-checked={active}
            aria-label={o['aria-label']}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={clsx(
              'hit inline-flex flex-1 items-center justify-center gap-1.5 rounded-[7px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-150 [&_svg]:size-4',
              // Phones: every option is 36 px (a 44 px group) plus the `hit` overhang; sm only shrinks from md up.
              size === 'sm' ? 'h-9 px-3 text-sm md:h-7 md:px-2.5 md:text-xs' : 'h-9 px-3 text-sm md:h-8',
              active ? 'bg-surface text-ink shadow-card ring-1 ring-line' : 'text-muted hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
