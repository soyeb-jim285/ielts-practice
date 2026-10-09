import { Link, useRouterState } from '@tanstack/react-router';
import { Activity, AudioLines, FlaskConical, LayoutDashboard, MessageSquare, ServerCog, Video, Users, Wallet } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useAdmin } from '@/lib/admin';
import { cn } from '@/lib/utils';

export const ADMIN_ITEMS = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/activity', label: 'Activity', icon: Activity },
  { to: '/admin/tests', label: 'Tests', icon: FlaskConical },
  { to: '/admin/costs', label: 'Costs', icon: Wallet },
  { to: '/admin/replays', label: 'Recordings', icon: Video },
  { to: '/admin/feedback', label: 'Feedback', icon: MessageSquare },
  { to: '/admin/playground', label: 'Playground', icon: AudioLines },
  { to: '/admin/health', label: 'System', icon: ServerCog },
] as const;

type Mark = { count?: number; dot?: 'warn' | 'bad'; text?: string };

/**
 * Phones only: a scrolling pill row; from md the app sidebar lists the same destinations (AppShell) (the current pill is kept in view and the right edge fades while more is hidden).
 * Badges: Feedback = new reports; System = failed or stuck analyses; Costs = dot while the OpenRouter runway is short. Dots always carry an aria-label.
 */
/** Badges for the admin destinations, and which one is current. Shared by the phone pill row and the app sidebar (md+). */
export function useAdminNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const overview = useAdmin<{ feedbackNew: number }>('/overview');
  const health = useAdmin<{ counts: { failed24h: number; stuckAnalyzing: number } }>('/health');
  const forecast = useAdmin<{ status: 'ok' | 'low' | 'critical' | 'unknown' }>('/spend/forecast');
  const broken = (health.data?.counts.failed24h ?? 0) + (health.data?.counts.stuckAnalyzing ?? 0);
  const fs = forecast.data?.status;
  const marks: Record<string, Mark> = {
    '/admin/feedback': { count: overview.data?.feedbackNew || undefined },
    '/admin/health': broken ? { dot: 'bad', text: `${broken} failed or stuck` } : {},
    '/admin/costs': fs === 'critical' ? { dot: 'bad', text: 'runway critical' } : fs === 'low' ? { dot: 'warn', text: 'runway low' } : {},
  };
  const current = ADMIN_ITEMS.find((t) => (t.to === '/admin' ? pathname.replace(/\/$/, '') === t.to : pathname.startsWith(t.to)))?.to ?? '/admin';
  return { marks, current };
}

export function AdminNav() {
  const { marks, current } = useAdminNav();
  const row = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState(false);
  const measure = () => {
    const c = row.current;
    if (c) setMore(c.scrollWidth - c.scrollLeft - c.clientWidth > 1);
  };
  useEffect(() => {
    const c = row.current;
    if (!c) return;
    const ro = new ResizeObserver(measure);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const c = row.current;
    const b = c?.querySelector('[aria-current="page"]');
    if (!c || !b) return;
    const cr = c.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    if (br.left < cr.left || br.right > cr.right - 32) c.scrollLeft += br.left - cr.left - 16;
  }, [current]);
  return (
    <nav aria-label="Admin" className="mb-6 md:hidden">
      <ul
        ref={row}
        onScroll={measure}
        className={cn('-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] ', more && '[mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)]')}
      >
        {ADMIN_ITEMS.map((t) => {
          const m = marks[t.to] ?? {};
          const active = current === t.to;
          const Icon = t.icon;
          return (
            <li key={t.to} className="shrink-0">
              <Link
                to={t.to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors',
                  active ? 'border-brand/40 bg-accent-soft text-accent-text' : 'border-line text-muted hover:bg-surface-2 hover:text-ink',
                )}
              >
                                {t.label}
                <Marker m={m} />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Marker({ m }: { m: Mark }): ReactNode {
  if (m.count) return <span className="type-num ml-auto rounded-full bg-brand px-1.5 text-xs font-semibold text-accent-ink" aria-label={`${m.count} new`}>{m.count}</span>;
  if (m.dot) return <span className={cn('ml-auto size-2 rounded-full', m.dot === 'bad' ? 'bg-bad' : 'bg-warn')} role="img" aria-label={m.text} />;
  return null;
}
