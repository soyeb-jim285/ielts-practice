import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Top of every app page, one pattern everywhere: Newsreader title (the only h1), a readable description under it, actions on the
 * right (wrapping below on phones). Space, not a rule, separates it from the content. Optional `back` link sits above.
 * `compact` uses the smaller title for form-like pages (Settings).
 */
export function PageHeader({
  title,
  description,
  actions,
  back,
  compact,
  className,
  as: Heading = 'h1',
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
  compact?: boolean;
  className?: string;
  /** Heading level; only a demo (style guide) uses anything but h1. */
  as?: 'h1' | 'h4';
}) {
  return (
    <header className={cn('mb-8 md:mb-10', className)}>
      {back && <div className="mb-3 *:-my-3 *:py-3">{back}</div>}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <Heading className={compact ? 'type-title-sm' : 'type-title'}>{title}</Heading>
          {description && <p className="type-lede mt-2 max-w-[60ch]">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 max-sm:w-full">{actions}</div>}
      </div>
    </header>
  );
}
