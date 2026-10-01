import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { ChevronsUpDown, Ellipsis, History, House, Layers, LibraryBig, LogIn, LogOut, Mic, Palette, PanelLeft, PenLine, Settings, TriangleAlert, UserPlus, type LucideIcon } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Button, buttonStyles, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Separator, Sheet } from '@/components/ui';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/shadcn/sidebar';
import { signOut } from '@/lib/auth';
import { useMe } from '@/lib/query';
import { cn } from '@/lib/utils';
import { Logo, LogoMark } from './Logo';

type NavItem = { to: '/' | '/speaking' | '/writing' | '/bank' | '/mistakes' | '/review' | '/history' | '/settings'; label: string; short?: string; icon: LucideIcon };

const DASHBOARD: NavItem = { to: '/', label: 'Dashboard', short: 'Home', icon: House };
const SPEAKING: NavItem = { to: '/speaking', label: 'Speaking', short: 'Speak', icon: Mic };
const WRITING: NavItem = { to: '/writing', label: 'Writing', short: 'Write', icon: PenLine };
const BANK: NavItem = { to: '/bank', label: 'Prompt bank', short: 'Bank', icon: LibraryBig };
const MISTAKES: NavItem = { to: '/mistakes', label: 'Mistakes', icon: TriangleAlert };
const REVIEW: NavItem = { to: '/review', label: 'Review', icon: Layers };
const HISTORY: NavItem = { to: '/history', label: 'History', icon: History };
const SETTINGS: NavItem = { to: '/settings', label: 'Settings', icon: Settings };

/** Sidebar groups: the dashboard on its own, then practise, then look back. Settings sits with the account at the bottom. */
const GROUPS: { label?: string; items: NavItem[] }[] = [
  { items: [DASHBOARD] },
  { label: 'Practise', items: [SPEAKING, WRITING, BANK] },
  { label: 'Improve', items: [MISTAKES, REVIEW, HISTORY] },
];
const TABS = [DASHBOARD, SPEAKING, WRITING, REVIEW];
const MORE = [BANK, MISTAKES, HISTORY, SETTINGS];

function useSignOut() {
  const navigate = useNavigate();
  return async () => {
    await signOut();
    await navigate({ to: '/' }); // back to the guest dashboard
  };
}

const isCurrent = (pathname: string, to: NavItem['to']) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`));

/** Sidebar row: 32 px, 16 px icon, muted until hovered; current = filled row + teal icon. */
const rowClass = 'h-8 gap-2.5 px-2 text-sm text-muted hover:text-ink data-[active=true]:font-medium data-[active=true]:text-ink data-[active=true]:[&>svg]:text-accent-text';

function SideLink({ item }: { item: NavItem }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const Icon = item.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isCurrent(pathname, item.to)} tooltip={item.label} className={rowClass}>
        <Link to={item.to} activeOptions={{ exact: item.to === '/' }}>
          <Icon />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** Where sign-in / sign-up send the visitor back to: the page they are on (nothing to carry from the dashboard). */
function useBackTo() {
  const href = useRouterState({ select: (s) => s.location.href });
  return href === '/' ? undefined : href;
}

/** Sidebar footer for a guest: sign in or create an account. */
function GuestMenu() {
  const redirect = useBackTo();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton asChild tooltip="Sign in" className={rowClass}>
          <Link to="/login" search={{ redirect }}>
            <LogIn />
            <span>Sign in</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <SidebarMenuButton asChild tooltip="Create account" className={rowClass}>
          <Link to="/signup" search={{ redirect }}>
            <UserPlus />
            <span>Create account</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** Account control in the sidebar footer: square initial and the name (the email lives in the menu, so nothing truncates). */
function UserMenu() {
  const { data: me } = useMe();
  const doSignOut = useSignOut();
  if (!me) return <GuestMenu />;
  const name = me.user.name || me.user.email;
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="h-11 gap-2.5 px-1.5 data-[state=open]:bg-sidebar-accent">
              <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-md bg-accent-soft font-serif text-base font-medium text-accent-text ring-1 ring-brand/15 ring-inset">
                {name.charAt(0).toUpperCase() || '?'}
              </span>
              <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">{name}</span>
              <ChevronsUpDown className="ml-auto size-4 text-muted" aria-hidden />
              <span className="sr-only">Account menu</span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" sideOffset={8} className="min-w-56">
            <DropdownMenuLabel className="space-y-0.5 font-normal">
              <span className="block truncate text-sm font-medium text-ink">{me.user.name}</span>
              <span className="block truncate text-xs text-muted">{me.user.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {import.meta.env.DEV && (
              <DropdownMenuItem asChild className="h-9 gap-2">
                <Link to="/styleguide">
                  <Palette className="size-4 text-muted" aria-hidden />
                  Style guide
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={doSignOut} className="h-9 gap-2">
              <LogOut className="size-4 text-muted" aria-hidden />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** Logo + collapse button; collapsed to the icon rail it becomes a single expand button. Ctrl/Cmd+B toggles from anywhere. */
function SidebarTop() {
  const { state, toggleSidebar } = useSidebar();
  return state === 'collapsed' ? (
    <button type="button" onClick={toggleSidebar} aria-label="Expand sidebar" className="group/logo relative mx-auto grid size-9 place-items-center rounded-md  focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      <LogoMark className="transition-opacity duration-150 group-hover/logo:opacity-0" />
      <PanelLeft className="absolute size-4 text-muted opacity-0 transition-opacity duration-150 group-hover/logo:opacity-100" aria-hidden />
    </button>
  ) : (
    <div className="flex h-9 items-center justify-between gap-2 pl-1.5">
      <Link to="/" aria-label="IELTS Practice, dashboard" className="rounded-md  focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <Logo />
      </Link>
      <SidebarTrigger role="img" className="size-8 text-muted hover:text-ink" aria-label="Collapse sidebar" />
    </div>
  );
}

function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-2 pt-3 pb-1">
        <SidebarTop />
      </SidebarHeader>
      <SidebarContent className="gap-0 px-2">
        <nav aria-label="Main">
          {GROUPS.map((g, i) => (
            <SidebarGroup key={i} className="px-0 py-1.5">
              {g.label && <SidebarGroupLabel className="h-7 px-2 text-caption font-medium">{g.label}</SidebarGroupLabel>}
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {g.items.map((n) => (
                    <SideLink key={n.to} item={n} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </nav>
      </SidebarContent>
      <SidebarFooter className="gap-1 border-t border-sidebar-border px-2 py-2">
        <SidebarMenu>
          <SideLink item={SETTINGS} />
        </SidebarMenu>
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/** Remembered across visits by the sidebar's own cookie. */
const initiallyOpen = () => {
  try {
    return !/(?:^|;\s*)sidebar_state=false/.test(document.cookie);
  } catch {
    return true;
  }
};

const tabClass = 'group relative flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[12px] leading-4 font-medium text-muted transition-colors duration-150 focus-visible:bg-hover data-[status=active]:text-accent-text';
// Active tab: the icon sits on a brand-soft pill (colour, not just a hairline, carries the state); labels are 12px.
const pill = 'grid h-7 w-14 place-items-center rounded-full transition-colors duration-150 group-data-[status=active]:bg-brand-soft';

/** Authed app frame: shadcn Sidebar (collapsible to icons, 240px) from md, bottom tab bar + "More" sheet below. Pages render their own PageHeader inside. */
export function AppShell({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const [more, setMore] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const doSignOut = useSignOut();
  const backTo = useBackTo();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // On a page that lives under More, the tab takes that page's icon and name so the bar still says where you are.
  const here = MORE.find((n) => isCurrent(pathname, n.to));
  const MoreIcon = here?.icon ?? Ellipsis;

  return (
    <SidebarProvider defaultOpen={initiallyOpen()}>
      <a href="#main" className="sr-only z-[80] rounded-md bg-surface px-3 py-2 shadow-pop focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>

      <AppSidebar />

      <SidebarInset id="main" className="min-w-0">
        <div className="mx-auto w-full max-w-[1080px] [--gutter:1rem] px-(--gutter) pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:[--gutter:1.5rem] md:[--gutter:2.5rem] md:pt-10 md:pb-16">{children}</div>
      </SidebarInset>

      {/* Mobile tab bar */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {TABS.map(({ to, short, label, icon: Icon }) => (
            <li key={to}>
              <Link to={to} activeOptions={{ exact: to === '/' }} className={tabClass}>
                <span aria-hidden className={pill}>
                  <Icon className="size-5" />
                </span>
                {short ?? label}
              </Link>
            </li>
          ))}
          <li>
            <button ref={moreButton} type="button" onClick={() => setMore(true)} aria-haspopup="dialog" aria-current={here ? 'page' : undefined} aria-label={here ? `${here.short ?? here.label}, open more pages` : undefined} data-status={here ? 'active' : undefined} className={tabClass}>
              <span aria-hidden className={pill}>
                <MoreIcon className="size-5" />
              </span>
              {here ? (here.short ?? here.label) : 'More'}
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={more} onClose={() => setMore(false)} returnFocusRef={moreButton} title="More" description={me?.user.email ?? 'Browsing as a guest'}>
        <nav aria-label="More" className="-mx-2 space-y-0.5">
          {MORE.map((n) => {
            const Icon = n.icon;
            return (
              <Link
                key={n.to}
                to={n.to}
                onClick={() => setMore(false)}
                className={cn('flex h-11 items-center gap-3 rounded-md px-3 text-body font-medium text-muted transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[status=active]:bg-accent-soft data-[status=active]:text-accent-text')}
              >
                <Icon className="size-5 shrink-0" aria-hidden />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <Separator className="my-4" />
        {me ? (
          <Button variant="ghost" icon={<LogOut />} onClick={doSignOut}>
            Sign out
          </Button>
        ) : (
          <div className="flex flex-wrap gap-3">
            <Link to="/login" search={{ redirect: backTo }} onClick={() => setMore(false)} className={buttonStyles()}>
              Sign in
            </Link>
            <Link to="/signup" search={{ redirect: backTo }} onClick={() => setMore(false)} className={buttonStyles({ variant: 'outline' })}>
              Create account
            </Link>
          </div>
        )}
      </Sheet>
    </SidebarProvider>
  );
}
