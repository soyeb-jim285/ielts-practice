import { clsx } from 'clsx';
import { LoaderCircle } from 'lucide-react';

/** Loading placeholder shaped like the content it replaces. Prefer over spinners for page content. */
export const Skeleton = ({ className }: { className?: string }) => <div aria-hidden className={clsx('animate-pulse rounded-control bg-ink/6 dark:bg-ink/10', className)} />;

/** Inline busy indicator (buttons use `loading` instead). */
export function Spinner({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <span role="status" className={clsx('inline-flex items-center gap-2 text-sm text-muted', className)}>
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Full-area loading state for a route. */
export function PageSkeleton() {
  return (
    <div className="space-y-6" aria-busy>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-36 rounded-card" />
        <Skeleton className="h-36 rounded-card" />
      </div>
      <Skeleton className="h-64 rounded-card" />
    </div>
  );
}
