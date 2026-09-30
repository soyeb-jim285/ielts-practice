import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { Ellipsis, History, House, Layers, LibraryBig, LogOut, Mic, PenLine, Settings, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Sheet } from '@/components/ui';
import { signOut } from '@/lib/auth';
import { useMe } from '@/lib/query';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';

type NavItem = { to: '/' | '/speaking' | '/writing' | '/bank' | '/mistakes' | '/review' | '/history' | '/settings'; label: string; short?: string; icon: LucideIcon };

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', short: 'Home', icon: House },
  { to: '/speaking', label: 'Speaking', short: 'Speak', icon: Mic },
  { to: '/writing', label: 'Writing', short: 'Write', icon: PenLine },
  { to: '/bank', label: 'Prompt bank', icon: LibraryBig },
  { to: '/mistakes', label: 'Mistakes', icon: TriangleAlert },
  { to: '/review', label: 'Review', icon: Layers },
  { to: '/history', label: 'History', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings },
];
const TABS = NAV.filter((n) => ['/', '/speaking', '/writing', '/review'].includes(n.to));
const MORE = NAV.filter((n) => !TABS.includes(n));

function useSignOut() {
  const navigate = useNavigate();
  return async () => {
    await signOut();
    await navigate({ to: '/login' });
  };
}

function SideLink({ item, onClick }: { item: NavItem; onClick?: () => void }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      onClick={onClick}
      activeOptions={{ exact: item.to === '/' }}
      className="group flex h-10 items-center gap-3 rounded-control px-3 text-[0.9375rem] font-medium text-muted transition-colors duration-150 hover:bg-ink/5 hover:text-ink data-[status=active]:bg-surface data-[status=active]:text-ink data-[status=active]:shadow-card data-[status=active]:ring-1 data-[status=active]:ring-line"
    >
      <Icon className="size-[18px] shrink-0 group-data-[status=active]:text-accent" aria-hidden />
      {item.label}
    </Link>
  );
}

/** Authed app frame: left sidebar ≥md, bottom tab bar below. Pages render their own PageHeader inside. */
export function AppShell({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const [more, setMore] = useState(false);
  const doSignOut = useSignOut();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const moreActive = MORE.some((n) => pathname.startsWith(n.to));

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only z-[80] rounded-control bg-surface px-3 py-2 shadow-pop focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-surface-2 md:flex">
        <div className="px-5 pt-6 pb-5">
          <Link to="/" aria-label="IELTS Practice, dashboard">
            <Logo />
          </Link>
        </div>
        <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {NAV.map((n) => (
            <SideLink key={n.to} item={n} />
          ))}
        </nav>
        <div className="space-y-3 border-t border-line p-3">
          <ThemeToggle className="w-full" />
          <div className="flex items-center gap-2 rounded-control px-2 py-1.5">
            <div aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent-text">
              {(me?.user.name || me?.user.email || '?').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1 text-sm leading-tight">
              <div className="truncate font-medium">{me?.user.name}</div>
              <div className="truncate text-xs text-muted">{me?.user.email}</div>
            </div>
            <button type="button" onClick={doSignOut} aria-label="Sign out" title="Sign out" className="grid size-8 place-items-center rounded-control text-muted hover:bg-ink/5 hover:text-ink">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      <main id="main" className="md:pl-60">
        <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 md:px-10 md:pt-10 md:pb-16">{children}</div>
      </main>

      {/* Mobile tab bar */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {TABS.map(({ to, short, label, icon: Icon }) => (
            <li key={to}>
              <Link
                to={to}
                activeOptions={{ exact: to === '/' }}
                className="flex h-16 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium text-muted transition-colors data-[status=active]:text-accent-text"
              >
                <Icon className="size-[22px]" aria-hidden />
                {short ?? label}
              </Link>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setMore(true)}
              aria-haspopup="dialog"
              aria-current={moreActive ? 'page' : undefined}
              className={clsx('flex h-16 w-full flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium', moreActive ? 'text-accent-text' : 'text-muted')}
            >
              <Ellipsis className="size-[22px]" aria-hidden />
              More
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={more} onClose={() => setMore(false)} title="More" description={me?.user.email}>
        <nav aria-label="More" className="-mx-2 space-y-0.5">
          {MORE.map((n) => (
            <SideLink key={n.to} item={n} onClick={() => setMore(false)} />
          ))}
        </nav>
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4">
          <ThemeToggle />
          <button type="button" onClick={doSignOut} className="inline-flex h-9 items-center gap-2 rounded-control px-3 text-sm font-medium text-muted hover:bg-ink/5 hover:text-ink">
            <LogOut className="size-4" aria-hidden />
            Sign out
          </button>
        </div>
      </Sheet>
    </div>
  );
}
