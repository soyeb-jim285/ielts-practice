import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * The one icon slot for rows, empty states and cards: a bare 20px lucide icon in muted ink, no box. `tone="brand"` for the primary one.
 * Inherits `group-hover` teal when its row is a `group`.
 */
export function IconTile({ tone = 'muted', className, ...rest }: ComponentProps<'span'> & { tone?: 'muted' | 'brand' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-5 shrink-0 place-items-center transition-colors duration-[120ms] [&_svg]:size-5',
        tone === 'brand' ? 'text-accent-text' : 'text-muted group-hover:text-accent-text',
        className,
      )}
      {...rest}
    />
  );
}
