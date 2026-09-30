import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Zero-data state that teaches the next step: say what will appear here and offer the action that creates it.
 * It is a panel by default; pass `bare` when it already sits inside a Card (never nest panels).
 */
export function EmptyState({ icon, title, children, action, className, bare }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string; bare?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-10 text-center', !bare && 'rounded-card border border-border bg-card shadow-card', className)}>
      {icon && <div className="mb-4 grid size-10 place-items-center rounded-full bg-surface-2 text-muted [&_svg]:size-5">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {children && <div className="mt-1.5 max-w-sm text-sm text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
