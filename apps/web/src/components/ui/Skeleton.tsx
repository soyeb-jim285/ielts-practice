import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton as ShSkeleton } from './shadcn/skeleton';

/** Loading placeholder shaped like the content it replaces. Prefer over spinners for page content. */
export const Skeleton = ({ className }: { className?: string }) => <ShSkeleton aria-hidden className={cn('rounded-md', className)} />;

/** Inline busy indicator (buttons use `loading` instead). */
export function Spinner({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-sm text-muted', className)}>
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Full-area loading state for a route: PageHeader + one panel. */
export function PageSkeleton() {
  return (
    <div className="space-y-6" aria-busy>
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-36 rounded-lg" />
        <Skeleton className="h-36 rounded-lg" />
      </div>
      <Skeleton className="h-64 rounded-lg" />
    </div>
  );
}
