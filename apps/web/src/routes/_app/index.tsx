import type { CriterionKey } from '@server/ai/types';
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, ChevronRight, Flame, Layers, MessagesSquare, Mic, PenLine } from 'lucide-react';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { speakingSession, StartWritingButton } from '@/components/bank/PracticeLink';
import { PRACTICE, type Progress } from '@/components/dashboard/criteria';
import { Onboarding } from '@/components/dashboard/Onboarding';
import { Alert, Badge, buttonStyles, Card, PageHeader, Skeleton, Tabs } from '@/components/ui';
import { call, client } from '@/lib/api';
import { formatBand, plural } from '@/lib/format';
import { useMe } from '@/lib/query';
import { bandColor, categoryLabel, criterionLabel, SPEAKING_CRITERIA, WRITING_CRITERIA } from '@/lib/result';

type Skill = 'speaking' | 'writing';
// recharts (~100 KB gz) loads only when a criteria chart actually renders.
const CriteriaTrend = lazy(() => import('@/components/dashboard/Charts'));
const progressQuery = queryOptions({ queryKey: ['progress'], queryFn: () => call(client.GET('/api/progress')), staleTime: 0 });
const dueCountQuery = queryOptions({ queryKey: ['cards', 'due'], queryFn: () => call(client.GET('/api/cards/due')), staleTime: 0 });

export const Route = createFileRoute('/_app/')({
  loader: ({ context }) => Promise.all([context.queryClient.ensureQueryData(progressQuery), context.queryClient.ensureQueryData(dueCountQuery)]),
  component: Dashboard,
});

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

function Dashboard() {
  const me = useMe().data!;
  const { data: p } = useSuspenseQuery(progressQuery);
  const { data: due } = useSuspenseQuery(dueCountQuery);
  const first = me.user.name.split(' ')[0];
  const target = me.settings.targetBand;

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title={`${greeting()}${first ? `, ${first}` : ''}`}
        description={
          p.attempts ? (
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1.5">
                <Flame className={p.streak ? 'size-4 text-warn' : 'size-4'} aria-hidden />
                {p.streak ? `${plural(p.streak, 'day')} in a row` : 'Practise today to start a streak'}
              </span>
              <span aria-hidden>·</span>
              <span>{plural(p.minutesThisWeek, 'minute')} this week</span>
            </span>
          ) : (
            'Welcome. Here is how to get your first score.'
          )
        }
      />

      {p.lastFailed && (
        <Alert
          tone="warn"
          title="Your last attempt couldn't be scored"
          action={
            <Link
              to={p.lastFailed.skill === 'speaking' ? '/speaking/result/$attemptId' : '/writing/result/$attemptId'}
              params={{ attemptId: p.lastFailed.id }}
              search={{}}
              className={buttonStyles({ variant: 'secondary', size: 'sm' })}
            >
              Open it
            </Link>
          }
        >
          Your answer is saved. Open it to retry the analysis.
        </Alert>
      )}

      {p.attempts === 0 ? (
        <Onboarding />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Predicted skill="speaking" band={p.predicted.speaking} trend={p.trend} target={target} />
            <Predicted skill="writing" band={p.predicted.writing} trend={p.trend} target={target} />
          </div>
          {p.weakest && <Weakest k={p.weakest.key as CriterionKey} avg={p.weakest.avg} />}
          {(['speaking', 'writing'] as const).some((k) => p.trend.filter((t) => t.skill === k).length >= 2) && <Trend trend={p.trend} target={target} />}
        </>
      )}

      <div className="grid items-start gap-4 md:grid-cols-2">
        <Card padded={false} className="min-w-0">
          <h2 className="px-5 pt-5 text-base font-semibold">Start practising</h2>
          <ul className="mt-2 divide-y divide-line">
            <QuickRow icon={<Mic />} title="Full speaking test" meta="11–14 min · all three parts">
              <Link {...speakingSession('full')} className="absolute inset-0" aria-label="Start a full speaking test" />
            </QuickRow>
            <QuickRow icon={<MessagesSquare />} title="Live examiner" meta="A spoken conversation with an AI examiner">
              <Link to="/speaking/live" className="absolute inset-0" aria-label="Start a live examiner test" />
            </QuickRow>
            {/* Onboarding step 3 already offers Task 2. */}
            {p.attempts > 0 && (
              <QuickRow icon={<PenLine />} title="Task 2 essay" meta="40 min · at least 250 words">
                <StartWritingButton variant="ghost" className="absolute inset-0 h-full w-full justify-end rounded-none pr-12 hover:bg-transparent active:scale-100">
                  <span className="sr-only">Start a Task 2 essay</span>
                </StartWritingButton>
              </QuickRow>
            )}
          </ul>
        </Card>

        <div className="grid min-w-0 gap-4">
          <Link to="/review" className="group block rounded-card">
            <Card interactive className="flex items-center gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-text">
                <Layers className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold">{due.total ? `${plural(due.total, 'card')} to review` : 'Review deck'}</span>
                <span className="block text-sm text-muted">{due.total ? 'A few minutes keeps corrections from slipping.' : 'All caught up for today.'}</span>
              </span>
              <ChevronRight className="size-5 text-muted transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
            </Card>
          </Link>
          {p.topMistakes.length > 0 && (
            <Card padded={false}>
              <div className="flex items-baseline justify-between px-5 pt-5">
                <h2 className="text-base font-semibold">Recurring mistakes</h2>
                <span className="text-xs text-muted">Last 30 days</span>
              </div>
              <ul className="mt-2 px-2 pb-2">
                {p.topMistakes.map((m) => (
                  <li key={m.category}>
                    <Link to="/mistakes" search={{ category: m.category }} className="flex items-center justify-between gap-3 rounded-control px-3 py-3 text-sm hover:bg-ink/5">
                      <span className="truncate">{categoryLabel(m.category)}</span>
                      <span className="shrink-0 tabular-nums text-muted">×{m.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Link to="/mistakes" className="flex items-center gap-1 border-t border-line px-5 py-3 text-sm font-medium text-accent-text hover:underline">
                Open error log <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function QuickRow({ icon, title, meta, children }: { icon: ReactNode; title: string; meta: string; children: ReactNode }) {
  return (
    <li className="relative flex items-center gap-3 px-5 py-3.5 transition-colors duration-150 focus-within:bg-ink/5 hover:bg-ink/5">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-muted ring-1 ring-line [&_svg]:size-4" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem] font-medium">{title}</span>
        <span className="block truncate text-sm text-muted">{meta}</span>
      </span>
      <ChevronRight className="size-4 text-muted" aria-hidden />
      {children}
    </li>
  );
}

function Predicted({ skill, band, trend, target }: { skill: Skill; band: number | null; trend: Progress['trend']; target: number }) {
  const values = trend.filter((t) => t.skill === skill).map((t) => t.overall);
  const label = skill === 'speaking' ? 'Speaking' : 'Writing';
  return (
    <Card className="flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-muted">Predicted {label.toLowerCase()} band</h2>
        {band != null && (
          <Badge tone={bandColor(band, target)}>{band >= target ? 'On target' : `${formatBand(target - band)} to go`}</Badge>
        )}
      </div>
      {band == null ? (
        <div className="mt-3 flex flex-1 flex-col items-start justify-between gap-3">
          <p className="text-sm text-muted">No {label.toLowerCase()} scores yet.</p>
          {skill === 'speaking' ? (
            <Link {...speakingSession('p1')} className={buttonStyles({ variant: 'secondary', size: 'sm' })}>
              Try Part 1
            </Link>
          ) : (
            <StartWritingButton variant="secondary" size="sm">
              Try Task 2
            </StartWritingButton>
          )}
        </div>
      ) : (
        <>
          <p className="mt-2 text-5xl font-semibold tracking-tight tabular-nums">{formatBand(band)}</p>
          <p className="mt-1 text-xs text-muted">
            {values.length > 1 ? `Average of your last ${plural(Math.min(values.length, 5), `${skill} score`)}` : `Your latest ${skill} score`} · target {formatBand(target)}
          </p>
          <div className="mt-3">
            <Sparkline values={values} />
          </div>
        </>
      )}
    </Card>
  );
}

function Weakest({ k, avg }: { k: CriterionKey; avg: number }) {
  const practice = PRACTICE[k];
  if (!practice) return null;
  const cta = <>Practise: {practice.label}</>;
  return (
    <div className="flex flex-col gap-3 rounded-card bg-accent-soft px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[0.9375rem]">
        <span className="text-muted">Your weakest area is </span>
        <span className="font-semibold">
          {criterionLabel(k)} ({formatBand(Math.round(avg * 2) / 2)})
        </span>
        <span className="text-muted">. Focused practice moves it fastest.</span>
      </p>
      {practice.skill === 'writing' ? (
        <StartWritingButton icon={<ArrowRight />}>{cta}</StartWritingButton>
      ) : (
        <Link {...speakingSession(`p${practice.part}`)} className={buttonStyles({ className: 'shrink-0' })}>
          {cta} <ArrowRight aria-hidden />
        </Link>
      )}
    </div>
  );
}

function Trend({ trend, target }: { trend: Progress['trend']; target: number }) {
  const has = (s: Skill) => trend.filter((t) => t.skill === s).length >= 2;
  const [skill, setSkill] = useState<Skill>(has('speaking') || !has('writing') ? 'speaking' : 'writing');
  const rows = trend.filter((t) => t.skill === skill);
  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-end justify-between gap-2 px-5 pt-4">
        <h2 className="pb-3 text-base font-semibold">Band by criterion</h2>
        <Tabs
          id="trend"
          value={skill}
          onChange={setSkill}
          className="border-b-0"
          items={[
            { value: 'speaking', label: 'Speaking' },
            { value: 'writing', label: 'Writing' },
          ]}
        />
      </div>
      <div role="tabpanel" id="trend-panel" aria-labelledby={`trend-${skill}`} className="border-t border-line p-5">
        {rows.length < 2 ? (
          <p className="text-sm text-muted">
            {rows.length ? 'One more scored attempt and your trend appears here.' : `Your ${skill} criteria trend appears after two scored attempts.`}
          </p>
        ) : (
          <Suspense fallback={<Skeleton className="h-68" />}>
            <CriteriaTrend trend={rows} keys={skill === 'speaking' ? SPEAKING_CRITERIA : WRITING_CRITERIA} target={target} />
          </Suspense>
        )}
      </div>
    </Card>
  );
}

/** Tiny decorative trend line (plain SVG, no chart library); the numbers it summarises are shown as text next to it. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const [lo, hi] = [Math.min(...values) - 0.5, Math.max(...values) + 0.5];
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${44 - ((v - lo) / (hi - lo)) * 40}`).join(' ');
  return (
    <svg className="h-12 w-full overflow-visible" viewBox="0 0 100 48" preserveAspectRatio="none" aria-hidden>
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
