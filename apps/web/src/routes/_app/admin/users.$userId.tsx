import type { CambridgeInfo, UserDetail } from '@server/admin/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { ActivityTable } from '@/components/admin/ActivityTable';
import { band, dhakaDay, dhakaTime, userLabel } from '@/components/admin/format';
import { Load, Section } from '@/components/admin/Load';
import { LineChart } from '@/components/admin/MiniChart';
import { Badge, buttonStyles, PageContainer, Switch, toast } from '@/components/ui';
import { useAdmin } from '@/lib/admin';
import { api, ApiError } from '@/lib/api';

export const Route = createFileRoute('/_app/admin/users/$userId')({ component: UserPage });

const SKILLS = ['speaking', 'writing', 'listening', 'reading'] as const;
const link = 'text-accent-text underline-offset-4 hover:underline';

function CambridgeToggle({ userId, info }: { userId: string; info: CambridgeInfo }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (granted: boolean) => api.post<CambridgeInfo>(`/admin/users/${userId}/cambridge`, { granted }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not change access.', { tone: 'bad' }),
  });
  if (!info.canToggle)
    return (
      <p className="text-sm">
        Cambridge access: <Badge tone="good">{info.source === 'owner' ? 'Owner' : 'Server config'}</Badge> <span className="text-muted">Managed in server config.</span>
      </p>
    );
  return <Switch label="Cambridge access" description="Lets this person use the Cambridge books. Takes effect within a minute." checked={info.allowed} disabled={m.isPending} onChange={(v) => m.mutate(v)} />;
}

function UserPage() {
  const { userId } = Route.useParams();
  const q = useAdmin<UserDetail>(`/users/${userId}`);
  return (
    <PageContainer>
      <Load q={q} lines={4}>
        {(d) => (
          <>
            <AdminHeader
              back={
                <Link to="/admin/users" className={buttonStyles({ variant: 'link', className: 'hit' })}>
                  <ArrowLeft className="size-4" aria-hidden /> All users
                </Link>
              }
              title={<span className="break-all">{userLabel(d.user)}</span>}
              description={
                <>
                  Joined {dhakaTime(d.user.createdAt)}
                  {d.user.lastActiveAt && `, last active ${dhakaTime(d.user.lastActiveAt)}`} (Dhaka).{' '}
                  {d.user.isGuest ? <Badge>Guest</Badge> : d.user.emailVerified ? <Badge tone="good">Verified</Badge> : <Badge tone="warn">Email not verified</Badge>}
                </>
              }
            />
            {!d.user.isGuest && (
              <div className="mb-10 max-w-xl">
                <CambridgeToggle userId={d.user.id} info={d.cambridge} />
              </div>
            )}
            {SKILLS.some((s) => d.bandTrend[s]?.length) && (
              <Section title="Band trend" aside="Oldest to newest, last 60 each">
                <div className="grid gap-8 md:grid-cols-2">
                  {SKILLS.filter((s) => d.bandTrend[s]?.length).map((s) => {
                    const pts = d.bandTrend[s]!;
                    return (
                      <div key={s}>
                        <h3 className="type-subheading mb-2 capitalize">{s}</h3>
                        <LineChart labels={pts.map((p) => dhakaDay(p.at.slice(0, 10)))} series={[{ label: `Band (latest ${band(pts.at(-1)?.band)})`, color: 'var(--accent)', values: pts.map((p) => p.band) }]} min={0} max={9} height="h-32" />
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}
            <Section title="Speaking recordings" aside={`${d.recordings.length} newest`}>
              {d.recordings.length ? (
                <ul className="divide-y divide-line border-y border-line">
                  {d.recordings.map((r) => (
                    <li key={`${r.attemptId}-${r.part}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                      <span className="min-w-0 text-sm">
                        Part {r.part} · <span className="type-num">{dhakaTime(r.createdAt)}</span>
                        {r.durationMs != null && <span className="type-caption type-num"> · {Math.round(r.durationMs / 1000)}s</span>}
                      </span>
                      <Link to="/speaking/result/$attemptId" params={{ attemptId: r.attemptId }} className={`text-sm ${link}`}>
                        Result
                      </Link>
                      {r.audioUrl ? <audio controls preload="none" src={r.audioUrl} className="h-10 w-full max-w-sm" aria-label={`Part ${r.part} recording`} /> : <span className="type-caption">No audio</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No speaking recordings.</p>
              )}
            </Section>
            <Section
              title="Session recordings"
              aside={
                <Link to="/admin/replays" search={{ userId: d.user.id }} className={link}>
                  See all
                </Link>
              }
            >
              {d.replays.length ? (
                <ul className="divide-y divide-line border-y border-line">
                  {d.replays.map((r) => (
                    <li key={r.id}>
                      <Link to="/admin/replays/$sessionId" params={{ sessionId: r.id }} className="flex flex-wrap items-baseline justify-between gap-x-4 py-3 text-sm hover:text-accent-text">
                        <span className="type-num">{dhakaTime(r.startedAt)}</span>
                        <span className="type-caption type-num">
                          {Math.round(r.durationS / 60)} min · {r.pages.length} pages
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No session recordings in the last 14 days.</p>
              )}
            </Section>
            <Section title="Tests" aside={`${d.attempts.length} newest`}>
              {d.attempts.length ? <ActivityTable items={d.attempts} withUser={false} /> : <p className="text-sm text-muted">No tests yet.</p>}
            </Section>
          </>
        )}
      </Load>
    </PageContainer>
  );
}
