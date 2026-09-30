import { Link } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';

/**
 * Distraction-free full-screen frame for timed tasks. Routes using it set `staticData: { exam: true }`
 * so the _app layout renders them without AppShell (no hidden nav in the tab order).
 * Top bar: exit (left) · title (center) · `status` slot for timer / word count / submit (right).
 */
export function ExamShell({
  title,
  status,
  exit,
  children,
  wide,
}: {
  title?: ReactNode;
  status?: ReactNode;
  /** Replace the default "exit to dashboard" link, e.g. with a button that confirms first. */
  exit?: ReactNode;
  children: ReactNode;
  /** Use full width (split prompt/editor). Default is a centered reading column. */
  wide?: boolean;
}) {
  return (
    <div className="flex h-dvh flex-col bg-bg">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-3 pt-[env(safe-area-inset-top)] sm:px-5">
        <div className="flex min-w-0 flex-1 items-center">
          {exit ?? (
            <Link to="/" aria-label="Exit" className="inline-flex h-9 items-center gap-1.5 rounded-control px-2 text-sm font-medium text-muted hover:bg-ink/5 hover:text-ink">
              <X className="size-5" aria-hidden />
              <span className="hidden sm:inline">Exit</span>
            </Link>
          )}
        </div>
        {title && <div className={clsx('min-w-0 truncate text-center text-sm font-semibold', status && 'hidden sm:block')}>{title}</div>}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">{status}</div>
      </header>
      <main id="main" className="min-h-0 flex-1 overflow-y-auto">
        <div className={wide ? 'h-full' : 'mx-auto w-full max-w-3xl px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6 md:py-12'}>{children}</div>
      </main>
    </div>
  );
}
