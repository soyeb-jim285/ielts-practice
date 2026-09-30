import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { ChevronsUpDown, Ellipsis, History, House, Layers, LibraryBig, LogOut, Mic, Monitor, Moon, PenLine, Settings, Sun, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Separator, Sheet } from '@/components/ui';
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/shadcn/dropdown-menu';
import { signOut } from '@/lib/auth';
import { useMe } from '@/lib/query';
import { cn } from '@/lib/utils';
import { Logo } from './Logo';
import { ThemeToggle, useTheme, type Theme } from './ThemeToggle';

type NavItem = { to: '/' | '/speaking' | '/writing' | '/bank' | '/mistakes' | '/review' | '/history' | '/settings'; label: string; short?: string; icon: LucideIcon };

const DASHBOARD: NavItem = { to: '/', label: 'Dashboard', short: 'Home', icon: House };
const SPEAKING: NavItem = { to: '/speaking', label: 'Speaking', short: 'Speak', icon: Mic };
const WRITING: NavItem = { to: '/writing', label: 'Writing', short: 'Write', icon: PenLine };
const BANK: NavItem = { to: '/bank', label: 'Prompt bank', icon: LibraryBig };
const MISTAKES: NavItem = { to: '/mistakes', label: 'Mistakes', icon: TriangleAlert };
const REVIEW: NavItem = { to: '/review', label: 'Review', icon: Layers };
const HISTORY: NavItem = { to: '/history', label: 'History', icon: History };
const SETTINGS: NavItem = { to: '/settings', label: 'Settings', icon: Settings };

/** Sidebar groups: practise, then look back. Settings sits with the account at the bottom. */
const GROUPS: NavItem[][] = [
  [DASHBOARD, SPEAKING, WRITING],
  [BANK, MISTAKES, REVIEW, HISTORY],
];
const TABS = [DASHBOARD, SPEAKING, WRITING, REVIEW];
const MORE = [BANK, MISTAKES, HISTORY, SETTINGS];

const THEMES: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'dark', label: 'Dark', icon: Moon },
];

function useSignOut() {
  const navigate = useNavigate();
  return async () => {
    await signOut();
    await navigate({ to: '/login' });
  };
}

/** One row for the sidebar and the More sheet: 44 px, 20 px icon, brand-soft when current. */
function NavLink({ item, onClick }: { item: NavItem; onClick?: () => void }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      onClick={onClick}
      activeOptions={{ exact: item.to === '/' }}
      className="flex h-11 items-center gap-3 rounded-lg px-3 text-[0.9375rem] font-medium text-muted outline-none transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[status=active]:bg-brand-soft data-[status=active]:text-brand-text"
    >
      <Icon className="size-5 shrink-0" aria-hidden />
      {item.label}
    </Link>
  );
}

/** Desktop account control: name + email, opens a menu with theme and sign out. */
function UserMenu() {
  const { data: me } = useMe();
  const [theme, setTheme] = useTheme();
  const doSignOut = useSignOut();
  const name = me?.user.name || me?.user.email || '';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-14 w-full items-center gap-3 rounded-lg px-2 text-left outline-none transition-colors hover:bg-hover focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[state=open]:bg-hover"
        >
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand-text">
            {name.charAt(0).toUpperCase() || '?'}
          </span>
          <span className="min-w-0 flex-1 text-sm leading-tight">
            <span className="block truncate font-medium">{me?.user.name}</span>
            <span className="block truncate text-xs text-muted">{me?.user.email}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted" aria-hidden />
          <span className="sr-only">Account menu</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-52">
        <DropdownMenuLabel className="text-xs font-normal text-muted">Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          {THEMES.map(({ value, label, icon: Icon }) => (
            <DropdownMenuRadioItem key={value} value={value} className="h-10 gap-2">
              <Icon className="size-4 text-muted" aria-hidden />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={doSignOut} className="h-10 gap-2">
          <LogOut className="size-4 text-muted" aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const tabClass = 'group flex h-16 w-full flex-col items-center justify-center gap-0.5 text-xs font-medium text-muted outline-none transition-colors data-[status=active]:text-ink';
const pill = 'grid h-8 w-14 place-items-center rounded-full transition-colors duration-150 group-focus-visible:ring-[3px] group-focus-visible:ring-ring/40 group-data-[status=active]:bg-brand-soft group-data-[status=active]:text-brand-text';

/** Authed app frame: left sidebar from md, bottom tab bar below. Pages render their own PageHeader inside. */
export function AppShell({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const [more, setMore] = useState(false);
  const doSignOut = useSignOut();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const moreActive = MORE.some((n) => pathname.startsWith(n.to));

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only z-[80] rounded-lg bg-surface px-3 py-2 shadow-pop focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-sidebar md:flex">
        <div className="flex h-16 shrink-0 items-center px-5">
          <Link to="/" aria-label="IELTS Practice, dashboard" className="rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40">
            <Logo />
          </Link>
        </div>
        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pt-2">
          {GROUPS.map((g, i) => (
            <div key={i} className={cn('space-y-0.5', i > 0 && 'mt-3 border-t border-line pt-3')}>
              {g.map((n) => (
                <NavLink key={n.to} item={n} />
              ))}
            </div>
          ))}
        </nav>
        <div className="space-y-1 border-t border-line p-3">
          <NavLink item={SETTINGS} />
          <UserMenu />
        </div>
      </aside>

      <main id="main" className="md:pl-60">
        <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 md:px-8 md:pt-10 md:pb-16">{children}</div>
      </main>

      {/* Mobile tab bar */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {TABS.map(({ to, short, label, icon: Icon }) => (
            <li key={to}>
              <Link to={to} activeOptions={{ exact: to === '/' }} className={tabClass}>
                <span className={pill}>
                  <Icon className="size-5" aria-hidden />
                </span>
                {short ?? label}
              </Link>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => setMore(true)} aria-haspopup="dialog" aria-current={moreActive ? 'page' : undefined} data-status={moreActive ? 'active' : undefined} className={tabClass}>
              <span className={pill}>
                <Ellipsis className="size-5" aria-hidden />
              </span>
              More
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={more} onClose={() => setMore(false)} title="More" description={me?.user.email}>
        <nav aria-label="More" className="-mx-2 space-y-0.5">
          {MORE.map((n) => (
            <NavLink key={n.to} item={n} onClick={() => setMore(false)} />
          ))}
        </nav>
        <Separator className="my-4" />
        <div className="flex items-center justify-between gap-3">
          <ThemeToggle />
          <Button variant="ghost" icon={<LogOut />} onClick={doSignOut}>
            Sign out
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
