import type { CambridgeInfo, LimitsInfo, UserDetail } from '@server/admin/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { ActivityTable } from '@/components/admin/ActivityTable';
import { band, dhakaDay, dhakaTime, userLabel } from '@/components/admin/format';
import { Load, Section } from '@/components/admin/Load';
import { LineChart } from '@/components/admin/MiniChart';
import { Badge, Button, buttonStyles, Input, PageContainer, Switch, toast } from '@/components/ui';
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

/** Test limits for this person: none at all, or the paid plan by hand until payments exist. Takes effect on their next test. */
function LimitsEditor({ userId, info }: { userId: string; info: LimitsInfo }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (b: { unlimited: boolean; subscribedUntil?: string | null; notify?: boolean }) => api.post<LimitsInfo>(`/admin/users/${userId}/limits`, b),
    onSuccess: () => (toast('Saved.'), qc.invalidateQueries({ queryKey: ['admin'] })),
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not save the limits.', { tone: 'bad' }),
  });
  const save = (unlimited = info.unlimited, subscribedUntil?: string | null, notify?: boolean) => m.mutate({ unlimited, subscribedUntil, notify });
  const subscribed = !!info.subscribedUntil && new Date(info.subscribedUntil) > new Date();
  // Dates are Dhaka calendar days (UTC+6, no DST); the plan runs to the end of the chosen day.
  const ymd = (t: number) => new Date(t + 6 * 3_600_000).toISOString().slice(0, 10);
  const [notify, setNotify] = useState(true);
  const [until, setUntil] = useState(subscribed ? ymd(new Date(info.subscribedUntil!).getTime()) : ymd(Date.now() + 30 * 86_400_000));
  return (
    <div className="space-y-4">
      <Switch label="No test limits" description="Unlimited speaking and writing tests, including the live examiner, paid by the house." checked={info.unlimited} disabled={m.isPending} onChange={(v) => save(v)} />
      <form className="space-y-2" onSubmit={(e) => (e.preventDefault(), save(info.unlimited, new Date(`${until}T23:59:59+06:00`).toISOString(), notify))}>
        <p className="text-sm font-medium">
          Subscriber {subscribed ? <Badge tone="good">Until {dhakaDay(ymd(new Date(info.subscribedUntil!).getTime()))}</Badge> : <Badge>None</Badge>}
        </p>
        <p className="type-caption">Paid plan to the end of the chosen day (Dhaka): unlimited writing and practice, 5 live sessions a day (40 a month), every test.</p>
        <div className="flex flex-wrap items-end gap-3">
          <Input label="Paid until" type="date" required min={ymd(Date.now())} value={until} onChange={(e) => setUntil(e.target.value)} className="w-44" />
          <Button type="submit" variant="outline" loading={m.isPending} disabled={!until}>
            {subscribed ? 'Change date' : 'Grant plan'}
          </Button>
          <label className="flex h-10 items-center gap-2 text-sm">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="size-4 accent-brand" />
            Email them
          </label>
          {subscribed && (
            <Button type="button" variant="ghost" disabled={m.isPending} onClick={() => save(info.unlimited, null)}>
              End subscription
            </Button>
          )}
        </div>
      </form>
    </div>
  );
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
              <div className="mb-10 max-w-xl space-y-6">
                <CambridgeToggle userId={d.user.id} info={d.cambridge} />
                {d.limits.canEdit && <LimitsEditor userId={d.user.id} info={d.limits} />}
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
