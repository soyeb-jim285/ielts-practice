import { useQuery } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import { BookOpen, Headphones, Mic, PenLine } from 'lucide-react';
import { RemoveAttempt } from '@/components/history/RemoveAttempt';
import { listStyles, PanelHeader, RowChevron, RowIcon, rowStyles } from '@/components/bank/ListRow';
import { Badge, buttonStyles } from '@/components/ui';
import { call, client } from '@/lib/api';
import { formatBand, formatDate } from '@/lib/format';
import { partsLabel } from '@/lib/lr';
import { useMe } from '@/lib/query';
import { cn } from '@/lib/utils';

type Skill = 'speaking' | 'writing' | 'listening' | 'reading';
type Row = { id: string; skill: Skill; title: string; part: string; mode: string; at: string; band: number | null; state: 'done' | 'open' | 'scoring' | 'failed' };

const ICON = { speaking: Mic, writing: PenLine, listening: Headphones, reading: BookOpen };
const modeLabel = (m: string) => (m === 'practice' ? 'Practice' : m === 'live' ? 'Live' : 'Exam');
const STATE = { open: { tone: 'warn', label: 'In progress, resume' }, scoring: { tone: 'accent', label: 'Scoring' }, failed: { tone: 'bad', label: 'Scoring failed' } } as const;

/**
 * Guests have no History page, but their own few tests are listed here (same two endpoints History uses; the server caps a guest's list).
 * Renders nothing for an account or when there is nothing yet. `skill` narrows it to one hub.
 */
export function GuestRecent({ skill }: { skill?: Skill }) {
  const guest = !!useMe().data?.user.isAnonymous;
  const redirect = useRouterState({ select: (s) => s.location.href });
  const sp = skill === 'speaking' || skill === 'writing' ? skill : undefined;
  const wantSp = !skill || !!sp;
  const wantLr = !skill || skill === 'listening' || skill === 'reading';
  const a = useQuery({ enabled: guest && wantSp, queryKey: ['guest-recent', 'attempts', sp], queryFn: () => call(client.GET('/api/attempts', { params: { query: { skill: sp } } })) });
  const l = useQuery({ enabled: guest && wantLr, queryKey: ['guest-recent', 'lr'], queryFn: () => call(client.GET('/api/lr/attempts')) });

  const rows: Row[] = [
    ...(a.data?.items ?? []).map((x): Row => ({ id: x.id, skill: x.skill, title: x.promptTitle, part: `${x.skill === 'speaking' ? 'Part' : 'Task'} ${x.part}`, mode: x.mode, at: x.createdAt, band: x.overall, state: x.status === 'done' ? 'done' : x.status === 'recording' ? 'open' : x.status === 'failed' ? 'failed' : 'scoring' })),
    ...(l.data?.items ?? []).filter((x) => !skill || x.skill === skill).map((x): Row => ({ id: x.id, skill: x.skill, title: x.title, part: `${x.skill === 'listening' ? 'Listening' : 'Reading'}${x.parts ? `, ${partsLabel(x.skill, x.parts)}` : ''}`, mode: x.mode, at: x.startedAt, band: x.band, state: x.status === 'submitted' ? 'done' : 'open' })),
  ]
    .sort((p, q) => q.at.localeCompare(p.at))
    .slice(0, 5);
  if (!guest || !rows.length) return null;

  return (
    <section aria-labelledby="guest-recent-h" className="mb-10 [.gap-12>&]:mb-0">
      <PanelHeader id="guest-recent-h" title="Your recent tests" />
      <ul className={listStyles}>
        {rows.map((r) => {
          const Icon = ICON[r.skill];
          const to = r.skill === 'listening' || r.skill === 'reading' ? (r.state === 'open' ? '/lr/run/$attemptId' : '/lr/result/$attemptId') : r.skill === 'speaking' ? '/speaking/result/$attemptId' : '/writing/result/$attemptId';
          const st = r.state in STATE ? STATE[r.state as keyof typeof STATE] : null;
          return (
            <li key={r.id} className="flex items-center gap-1">
              <Link to={to} params={{ attemptId: r.id }} className={cn(rowStyles, 'min-w-0 flex-1')}>
                <RowIcon>
                  <Icon />
                </RowIcon>
                <span className="min-w-0 flex-1">
                  <span className="type-subheading line-clamp-2 block font-medium text-pretty">
                    <span className="sr-only">{r.skill}: </span>
                    {r.title}
                  </span>
                  <span className="type-caption mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge tone={r.mode === 'practice' ? 'neutral' : 'accent'}>{modeLabel(r.mode)}</Badge>
                    {r.part}, {formatDate(r.at)}
                  </span>
                </span>
                {st ? (
                  <Badge tone={st.tone} className="shrink-0">
                    {st.label}
                  </Badge>
                ) : r.band != null ? (
                  <span className="type-band text-lg">
                    <span className="sr-only">Band </span>
                    {formatBand(r.band)}
                  </span>
                ) : null}
                <RowChevron />
              </Link>
              <RemoveAttempt kind={r.skill === 'listening' || r.skill === 'reading' ? 'lr' : 'attempt'} id={r.id} title={r.title} />
            </li>
          );
        })}
      </ul>
      <p className="type-caption mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="max-w-[60ch]">These live in this browser only. Create an account to keep them and unlock full History.</span>
        <Link to="/signup" search={{ redirect }} className={buttonStyles({ size: 'sm' })}>
          Create account
        </Link>
      </p>
    </section>
  );
}
