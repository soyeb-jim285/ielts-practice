import { Link, type LinkProps } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { PageContainer } from '@/components/ui';

/**
 * Page frame for every result: identity row (back, h1, meta, actions), hero, strip, one action row, tabs, then panels.
 * 60rem column, `pb-24` so the floating report button never covers content. Tabs and panels are direct flex-flow children so sticky tabs stay stuck.
 * Props: back ({to, label}, desktop only), title (h1, 2-line clamp; with `promptFull` a "Show prompt" toggle reveals the whole prompt), meta (StatusLine), actions (kebab menu), hero, strip, action, tabs, children.
 */
export function ResultScaffold({ back, title, promptFull, meta, actions, hero, strip, action, tabs, children }: {
  back?: { to: LinkProps['to']; label: string };
  title: ReactNode;
  promptFull?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  hero: ReactNode;
  strip?: ReactNode;
  action?: ReactNode;
  tabs?: ReactNode;
  children?: ReactNode;
}) {
  const [full, setFull] = useState(false);
  return (
    <PageContainer className="max-w-[60rem] space-y-8 pb-24 md:space-y-12">
      <div className="space-y-6 md:space-y-8">
        <header className="space-y-2">
          {back && (
            <Link to={back.to} className="type-body hit -ml-1 inline-flex items-center gap-1 rounded-sm px-1 text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-md:hidden">
              <ArrowLeft className="size-4" aria-hidden />
              {back.label}
            </Link>
          )}
          <div className="flex items-start justify-between gap-4">
            <h1 className="type-title-sm line-clamp-3 min-w-0 max-w-[40ch]">{title}</h1>
            {actions}
          </div>
          {meta}
          {promptFull && (
            <div>
              <button type="button" aria-expanded={full} onClick={() => setFull((v) => !v)} className="type-body hit text-accent-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                {full ? 'Hide prompt' : 'Show prompt'}
              </button>
              {full && <div className="type-reading mt-2">{promptFull}</div>}
            </div>
          )}
        </header>
        <h2 className="sr-only">Your result</h2>
        {hero}
        {strip}
        {action}
      </div>
      {tabs}
      {children}
    </PageContainer>
  );
}
