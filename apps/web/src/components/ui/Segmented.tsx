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
              'inline-flex flex-1 items-center justify-center gap-1.5 rounded-[7px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-150 [&_svg]:size-4',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
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
