import { useNavigate, useRouterState } from '@tanstack/react-router';
import { Tabs } from '@/components/ui';
import { useAdmin } from '@/lib/admin';

const TABS = [
  { value: '/admin', label: 'Overview' },
  { value: '/admin/growth', label: 'Growth' },
  { value: '/admin/activity', label: 'Activity' },
  { value: '/admin/users', label: 'Users' },
  { value: '/admin/tests', label: 'Tests' },
  { value: '/admin/funnel', label: 'Funnel' },
  { value: '/admin/content', label: 'Content' },
  { value: '/admin/costs', label: 'Costs' },
  { value: '/admin/health', label: 'Health' },
  { value: '/admin/feedback', label: 'Feedback' },
  { value: '/admin/replays', label: 'Recordings' },
] as const;
type Path = (typeof TABS)[number]['value'];

/** Tab strip over every admin page. Feedback shows the number of new reports; Costs shows a dot while a balance is low. */
export function AdminNav() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const overview = useAdmin<{ feedbackNew: number }>('/overview');
  const costs = useAdmin<{ warnings: string[] }>('/costs');
  const value = TABS.slice(1).find((t) => pathname.startsWith(t.value))?.value ?? '/admin';
  const warn = !!costs.data?.warnings.length;
  return (
    <Tabs
      id="admin"
      value={value}
      onChange={(v: Path) => void navigate({ to: v })}
      items={TABS.map((t) => ({
        value: t.value,
        count: t.value === '/admin/feedback' && overview.data?.feedbackNew ? overview.data.feedbackNew : undefined,
        label:
          t.value === '/admin/costs' && warn ? (
            <>
              {t.label}
              <span className="size-2 rounded-full bg-warn" role="img" aria-label="low balance" />
            </>
          ) : (
            t.label
          ),
      }))}
    />
  );
}
