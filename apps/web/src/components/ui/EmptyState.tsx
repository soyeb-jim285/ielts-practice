import type { ElementType, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { IconTile } from './IconTile';

/**
 * Zero-data state that teaches the next step. No frame: a hairline rule, a small icon, a serif title, one or two lines saying what will
 * appear here, and the action that creates it, all left-aligned to the page grid. Pass `preview` (a <GhostList />) to sketch the populated
 * layout underneath. `bare` drops the rule when it already sits inside a Card. `as` sets the heading level (default h2).
 */
export function EmptyState({
  icon,
  title,
  children,
  action,
  preview,
  className,
  bare,
  as: Heading = 'h2',
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  preview?: ReactNode;
  className?: string;
  bare?: boolean;
  as?: ElementType;
}) {
  return (
    <div className={cn(!bare && 'border-t border-line pt-6 md:pt-8', className)}>
      {icon && <IconTile tone="brand" className="mb-4">{icon}</IconTile>}
      <Heading className="type-heading">{title}</Heading>
      {children && <div className="type-lede mt-1.5 max-w-[52ch]">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
      {preview && <div className="mt-8 md:mt-10">{preview}</div>}
    </div>
  );
}

const WIDTHS = [62, 48, 70, 55, 66];

/** Faded skeleton of a populated list, shown under an EmptyState so the screen previews what it will look like. Decorative (aria-hidden). */
export function GhostList({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div aria-hidden className={cn('pointer-events-none divide-y divide-line border-y border-line [mask-image:linear-gradient(to_bottom,black_15%,transparent)] select-none', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 py-4">
          <span className="size-5 shrink-0 rounded-sm bg-surface-2" />
          <span className="flex-1 space-y-2">
            <span className="block h-3.5 rounded-sm bg-surface-2" style={{ width: `${WIDTHS[i % WIDTHS.length]}%` }} />
            <span className="block h-3 w-1/4 rounded-sm bg-surface-2/70" />
          </span>
          <span className="h-5 w-8 rounded-sm bg-surface-2" />
        </div>
      ))}
    </div>
  );
}
