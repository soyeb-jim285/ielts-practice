import { clsx } from 'clsx';
import type { ReactNode } from 'react';

/** Zero-data state that teaches the next step: say what will appear here and offer the action that creates it. */
export function EmptyState({ icon, title, children, action, className }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex flex-col items-center rounded-card border border-dashed border-line-strong px-6 py-12 text-center', className)}>
      {icon && <div className="mb-4 grid size-12 place-items-center rounded-full bg-surface-2 text-muted ring-1 ring-line [&_svg]:size-6">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {children && <div className="mt-1.5 max-w-sm text-sm text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
