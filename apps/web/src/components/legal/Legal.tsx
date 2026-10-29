import { Link } from '@tanstack/react-router';
import { Children, isValidElement, useEffect, useState, type ReactNode } from 'react';
import { PageContainer } from '@/components/ui';
import { cn } from '@/lib/utils';

/** The business behind the site, as on its trade licence; shown on the legal pages and in the footer (payment gateways check these). */
export const COMPANY = {
  name: 'Dolphin Commerce',
  product: 'NextBand',
  email: 'support@dolphincommerce.com',
  address: 'Sutia Bazar, Ward 6, Jatia Union, Ishwarganj, Mymensingh 2280, Bangladesh',
  phone: '+880 1718-007639', // Contact page only, not the footer
  country: 'Bangladesh',
  tradeLicense: '46813125039', // Jatia Union Parishad, Ishwarganj
  since: 2025,
};

export const PAGES = [
  { to: '/about', label: 'About' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/privacy', label: 'Privacy' },
  { to: '/terms', label: 'Terms' },
  { to: '/refunds', label: 'Refunds' },
  { to: '/delivery', label: 'Delivery' },
  { to: '/contact', label: 'Contact' },
] as const;

const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const Mail = () => (
  <a href={`mailto:${COMPANY.email}`} className="font-medium text-accent-text underline decoration-accent/40 underline-offset-[3px] hover:decoration-accent">
    {COMPANY.email}
  </a>
);

export const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section id={slug(title)} aria-labelledby={`${slug(title)}-h`} className="scroll-mt-6 border-t border-line pt-8 first:border-t-0 first:pt-0">
    <h2 id={`${slug(title)}-h`} className="type-heading">
      <a href={`#${slug(title)}`} className="hover:text-accent-text">
        {title}
      </a>
    </h2>
    <div className="mt-4 space-y-4 text-[0.9375rem] leading-7 text-ink/90 [&_a]:font-medium">{children}</div>
  </section>
);

export const List = ({ children }: { children: ReactNode }) => (
  <ul className="list-disc space-y-2 pl-5 marker:text-accent">{children}</ul>
);

/** Which section is in view, for the "On this page" list. */
function useActive(ids: string[]) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive(hit.target.id);
      },
      { rootMargin: '0px 0px -70% 0px' },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [ids.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  return active;
}

/** Pathless layout for the legal pages (routes/_app/_legal.tsx): the tab bar stays mounted, only the page below it changes. */
export const LegalLayout = ({ children }: { children: ReactNode }) => (
  <PageContainer className="pb-12">
    <nav aria-label="Legal pages" className="-mx-1 mb-5 flex flex-wrap gap-1">
      {PAGES.map((p) => (
        <Link
          key={p.to}
          to={p.to}
          className="rounded-full px-3 py-1 text-sm text-muted transition-colors duration-200 hover:bg-surface-2 hover:text-ink"
          activeProps={{ className: 'bg-accent-soft font-medium !text-accent-text hover:!bg-accent-soft', 'aria-current': 'page' }}
        >
          {p.label}
        </Link>
      ))}
    </nav>
    {children}
  </PageContainer>
);

export const LegalPage = ({ title, updated, children }: { title: string; updated: string; children: ReactNode }) => {
  const titles = Children.toArray(children).flatMap((c) => (isValidElement<{ title?: string }>(c) && c.props.title ? [c.props.title] : []));
  const ids = titles.map(slug);
  const active = useActive(ids);

  return (
    // a plain crossfade when switching tabs; the tab bar above doesn't move
    <div className="animate-[fade-in_var(--dur)_var(--ease-out-expo)_backwards]">
      <header className="border-b border-line pb-6">
        <h1 className="type-title">{title}</h1>
        <p className="mt-2 type-caption">
          {COMPANY.product} by {COMPANY.name} · <span className="whitespace-nowrap">Last updated <time>{updated}</time></span>
        </p>
      </header>

      <div className="mt-8 lg:grid lg:grid-cols-[minmax(0,68ch)_13rem] lg:justify-between lg:gap-12">
        <div className="space-y-10">{children}</div>
        {titles.length > 2 && (
          <nav aria-label="On this page" className="hidden lg:block">
            <div className="sticky top-6">
              <p className="type-caption font-medium text-ink">On this page</p>
              <ul className="mt-3 space-y-0.5 border-l border-line">
                {titles.map((t, i) => (
                  <li key={t}>
                    <a
                      href={`#${ids[i]}`}
                      aria-current={active === ids[i] ? 'location' : undefined}
                      className={cn(
                        '-ml-px block border-l-2 border-transparent py-1 pl-3 text-sm text-muted transition-colors hover:text-ink',
                        active === ids[i] && 'border-accent font-medium text-accent-text',
                      )}
                    >
                      {t}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        )}
      </div>
    </div>
  );
};
