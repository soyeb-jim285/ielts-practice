import type { ActivityItem } from '@server/admin/schemas';
import { Link } from '@tanstack/react-router';
import { Badge, type Tone } from '@/components/ui';
import { appPath } from '@/lib/admin';
import { band, dhakaTime, userLabel } from './format';
import { CostLink } from './AttemptDrawer';
import { DataTable, type Col } from './Table';

const TONE: Record<ActivityItem['status'], Tone> = { done: 'good', submitted: 'good', failed: 'bad', analyzing: 'warn', recording: 'neutral', in_progress: 'neutral' };

/** Feed of tests people took. `withUser` is off on a user's own page. */
export function ActivityTable({ items, withUser = true }: { items: ActivityItem[]; withUser?: boolean }) {
  const cols: Col<ActivityItem>[] = [
    { head: 'When (Dhaka)', cell: (r) => <span className="type-num whitespace-nowrap">{dhakaTime(r.startedAt)}</span> },
    ...(withUser
      ? [
          {
            head: 'User',
            cell: (r: ActivityItem) => (
              <Link to="/admin/users/$userId" params={{ userId: r.userId }} className="block max-w-56 truncate underline-offset-4 hover:underline" title={userLabel(r)}>
                {userLabel(r)}
              </Link>
            ),
          },
        ]
      : []),
    {
      head: 'Test',
      cell: (r) => (
        <>
          <span className="capitalize">{r.skill}</span> · {r.parts}
          <span className="type-caption block">
            {r.title} · {r.mode}
          </span>
        </>
      ),
    },
    {
      head: 'Score',
      cell: (r) => (
        <span className="type-num">
          {band(r.score)}
          {r.raw && <span className="type-caption"> ({r.raw.raw}/{r.raw.total})</span>}
        </span>
      ),
    },
    { head: 'Cost', cell: (r) => (r.skill === 'speaking' || r.skill === 'writing' ? <CostLink id={r.id} /> : <span className="text-muted" aria-label="none">&ndash;</span>) },
    { head: 'Status', cell: (r) => <Badge tone={TONE[r.status]}>{r.status.replace('_', ' ')}</Badge> },
    {
      head: 'Open',
      cell: (r) => (
        <span className="flex flex-wrap gap-x-3">
          <Link to={appPath(r.resultPath)} className="text-accent-text underline-offset-4 hover:underline">
            Result
          </Link>
          {r.replays.map((p, i) => (
            <Link key={p.id} to="/admin/replays/$sessionId" params={{ sessionId: p.id }} className="text-accent-text underline-offset-4 hover:underline">
              Recording{r.replays.length > 1 ? ` ${i + 1}` : ''}
            </Link>
          ))}
        </span>
      ),
    },
  ];
  return <DataTable dense rows={items} cols={cols} rowKey={(r) => `${r.kind}:${r.id}`} label="Tests taken" />;
}
