import { Link } from '@tanstack/react-router';
import { COMPANY, PAGES } from '@/components/legal/Legal';

/** Who runs the site and the legal pages: what payment gateways look for on every page. */
export function SiteFooter() {
  return (
    <footer className="mt-16 space-y-3 border-t border-line pt-6 text-caption text-muted">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <p>
          {COMPANY.product} is a product of {COMPANY.name}.
        </p>
        <nav aria-label="Legal">
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {PAGES.map((l) => (
              <li key={l.to}>
                <Link to={l.to} className="underline-offset-2 hover:text-ink hover:underline">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <p>
        {COMPANY.address} · Trade licence {COMPANY.tradeLicense} · <a href={`mailto:${COMPANY.email}`} className="underline-offset-2 hover:text-ink hover:underline">{COMPANY.email}</a>
      </p>
    </footer>
  );
}
