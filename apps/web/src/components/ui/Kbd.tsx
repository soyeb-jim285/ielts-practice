import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** Keyboard shortcut hint. `onBrand` for use inside a primary button. Hidden on touch-width screens by the caller (`hidden sm:inline-flex`). */
export function Kbd({ onBrand, className, ...rest }: ComponentProps<'kbd'> & { onBrand?: boolean }) {
  return (
    <kbd
      className={cn(
        'type-num inline-flex h-5 min-w-5 items-center justify-center rounded-sm px-1.5 font-sans text-xs font-medium',
        onBrand ? 'bg-black/15 text-brand-ink' : 'bg-surface-2 text-muted ring-1 ring-line ring-inset',
        className,
      )}
      {...rest}
    />
  );
}
