import { Link } from '@tanstack/react-router';
import { COMPANY, TRADEMARK } from '@/components/legal/Legal';

const LINKS = [
  { to: '/terms', label: 'Terms' },
  { to: '/privacy', label: 'Privacy' },
  { to: '/refunds', label: 'Refunds' },
  { to: '/contact', label: 'Contact' },
] as const;

/** Who runs the site, the legal pages, and the IELTS trademark notice: what payment gateways look for on every page. */
export function SiteFooter() {
  return (
    <footer className="mt-16 space-y-3 border-t border-line pt-6 text-caption text-muted">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <p>
          {COMPANY.product} is a product of {COMPANY.name}.
        </p>
        <nav aria-label="Legal">
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {LINKS.map((l) => (
              <li key={l.to}>
                <Link to={l.to} className="underline-offset-2 hover:text-ink hover:underline">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <p className="max-w-[80ch]">{TRADEMARK}</p>
    </footer>
  );
}
