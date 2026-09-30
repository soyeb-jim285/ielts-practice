import type { ReactNode } from 'react';

/** Top of every app page: one h1, optional one-line description, actions right (wrap under on mobile). */
export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="mb-6 md:mb-8">
      {back && <div className="mb-3">{back}</div>}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight md:text-[1.75rem]">{title}</h1>
          {description && <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
