import type { CriterionKey } from '@server/ai/types';
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, ChevronRight, Flame, Layers, MessagesSquare, Mic, PenLine } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { PanelHeader, RowIcon, rowStyles, RowText } from '@/components/bank/ListRow';
import { speakingSession, StartWritingButton } from '@/components/bank/PracticeLink';
import { PRACTICE, type Progress } from '@/components/dashboard/criteria';
import { Onboarding } from '@/components/dashboard/Onboarding';
import { Alert, Badge, buttonStyles, Card, PageHeader, ProgressBar, Segmented, Skeleton } from '@/components/ui';
import { call, client } from '@/lib/api';
import { formatBand, plural } from '@/lib/format';
import { useMe } from '@/lib/query';
import { cn } from '@/lib/utils';
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
  const weakest = p.weakest && PRACTICE[p.weakest.key as CriterionKey] ? (p.weakest as { key: CriterionKey; avg: number }) : null;
  const maxMistakes = Math.max(1, ...p.topMistakes.map((m) => m.count));

  return (
    <div className="space-y-8 pb-8 md:space-y-10">
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
          <NextUp weakest={weakest} />
          <Card padded={false} className="grid sm:grid-cols-2 sm:divide-x max-sm:divide-y divide-line">
            <Predicted skill="speaking" band={p.predicted.speaking} trend={p.trend} target={target} />
            <Predicted skill="writing" band={p.predicted.writing} trend={p.trend} target={target} />
          </Card>
          {(['speaking', 'writing'] as const).some((k) => p.trend.filter((t) => t.skill === k).length >= 2) && <Trend trend={p.trend} target={target} />}
        </>
      )}

      <div className={cn('grid items-start gap-6', p.topMistakes.length > 0 && 'md:grid-cols-2')}>
        <Card padded={false} className="min-w-0 overflow-clip">
          <PanelHeader title="Practise" />
          <ul className="divide-y divide-line border-t border-line">
            <li>
              <Link {...speakingSession('full')} className={rowStyles}>
                <RowIcon>
                  <Mic />
                </RowIcon>
                <RowText title="Full speaking test" meta="11–14 min · all three parts" />
                <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
              </Link>
            </li>
            <li>
              <Link to="/speaking/live" className={rowStyles}>
                <RowIcon>
                  <MessagesSquare />
                </RowIcon>
                <RowText title="Live examiner" meta="A spoken conversation with an AI examiner" />
                <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
              </Link>
            </li>
            <li>
              <StartWritingButton variant="ghost" className={cn(rowStyles, 'h-auto rounded-none font-normal whitespace-normal')}>
                <RowIcon>
                  <PenLine />
                </RowIcon>
                <RowText title="Task 2 essay" meta="40 min · at least 250 words" />
                <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
              </StartWritingButton>
            </li>
            <li>
              <Link to="/review" className={rowStyles}>
                <RowIcon>
                  <Layers />
                </RowIcon>
                <RowText title="Review deck" meta={due.total ? 'A few minutes keeps corrections from slipping' : 'All caught up for today'} />
                {due.total > 0 && <Badge tone="accent">{due.total} due</Badge>}
                <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
              </Link>
            </li>
          </ul>
        </Card>

        {p.topMistakes.length > 0 && (
          <Card padded={false} className="min-w-0 overflow-clip">
            <PanelHeader title="Recurring mistakes" meta="Last 30 days" />
            <ul className="divide-y divide-line border-t border-line">
              {p.topMistakes.map((m) => (
                <li key={m.category}>
                  <Link to="/mistakes" search={{ category: m.category }} className={cn(rowStyles, 'flex-col items-stretch gap-2 py-3.5')}>
                    <span className="flex items-baseline justify-between gap-3 text-[0.9375rem]">
                      <span className="truncate">{categoryLabel(m.category)}</span>
                      <span className="shrink-0 text-sm tabular-nums text-muted">×{m.count}</span>
                    </span>
                    <ProgressBar value={m.count / maxMistakes} tone="neutral" label={`${categoryLabel(m.category)}: ${m.count}`} className="h-1" />
                  </Link>
                </li>
              ))}
            </ul>
            <Link to="/mistakes" className="flex h-12 items-center gap-1.5 border-t border-line px-5 text-sm font-medium text-brand-text transition-colors hover:bg-hover">
              Open error log <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Card>
        )}
      </div>
    </div>
  );
}

/** The one hero: what to practise next. Weakest criterion when known, otherwise a full test. */
function NextUp({ weakest }: { weakest: { key: CriterionKey; avg: number } | null }) {
  const practice = weakest ? PRACTICE[weakest.key] : null;
  const cta = <>{practice ? `Practise ${practice.label.toLowerCase()}` : 'Start a full speaking test'}</>;
  return (
    <Card tone="hero" className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-balance">{weakest ? `${criterionLabel(weakest.key)} is your weakest area` : 'Ready for another round?'}</h2>
        <p className="mt-1 max-w-[60ch] text-[0.9375rem] text-ink/75">
          {weakest ? `You average ${formatBand(Math.round(weakest.avg * 2) / 2)} here. Focused practice moves it fastest.` : 'A full test gives the most complete picture of your band.'}
        </p>
      </div>
      {practice?.skill === 'writing' ? (
        <StartWritingButton size="lg" icon={<ArrowRight />} className="shrink-0 max-sm:w-full">
          {cta}
        </StartWritingButton>
      ) : (
        <Link {...speakingSession(practice ? (`p${practice.part}` as const) : 'full')} className={buttonStyles({ size: 'lg', className: 'shrink-0 max-sm:w-full' })}>
          {cta} <ArrowRight aria-hidden />
        </Link>
      )}
    </Card>
  );
}

function Predicted({ skill, band, trend, target }: { skill: Skill; band: number | null; trend: Progress['trend']; target: number }) {
  const values = trend.filter((t) => t.skill === skill).map((t) => t.overall);
  const label = skill === 'speaking' ? 'Speaking' : 'Writing';
  return (
    <section className="flex flex-col p-5" aria-label={`Predicted ${label.toLowerCase()} band`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-muted">Predicted {label.toLowerCase()} band</h2>
        {band != null && <Badge tone={bandColor(band, target)}>{band >= target ? 'On target' : `${formatBand(target - band)} to go`}</Badge>}
      </div>
      {band == null ? (
        <div className="mt-3 flex flex-1 flex-col items-start justify-between gap-4">
          <p className="text-sm text-muted">No {label.toLowerCase()} scores yet.</p>
          {skill === 'speaking' ? (
            <Link {...speakingSession('p1')} className={buttonStyles({ variant: 'secondary' })}>
              Try Part 1
            </Link>
          ) : (
            <StartWritingButton variant="secondary">Try Task 2</StartWritingButton>
          )}
        </div>
      ) : (
        <>
          <p className="mt-3 text-5xl font-semibold tracking-tight tabular-nums">{formatBand(band)}</p>
          <p className="mt-1.5 text-sm text-muted">
            {values.length > 1 ? `Average of your last ${plural(Math.min(values.length, 5), 'score')}` : 'Your latest score'} · target {formatBand(target)}
          </p>
          <div className="mt-4">
            <Sparkline values={values} />
          </div>
        </>
      )}
    </section>
  );
}

function Trend({ trend, target }: { trend: Progress['trend']; target: number }) {
  const has = (s: Skill) => trend.filter((t) => t.skill === s).length >= 2;
  const [skill, setSkill] = useState<Skill>(has('speaking') || !has('writing') ? 'speaking' : 'writing');
  const rows = trend.filter((t) => t.skill === skill);
  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 pt-5 pb-3">
        <h2 className="text-base font-semibold">Band by criterion</h2>
        <Segmented
          label="Skill"
          size="sm"
          value={skill}
          onChange={setSkill}
          options={[
            { value: 'speaking', label: 'Speaking' },
            { value: 'writing', label: 'Writing' },
          ]}
        />
      </div>
      <div className="px-5 pb-5">
        {rows.length < 2 ? (
          <p className="py-6 text-sm text-muted">{rows.length ? 'One more scored attempt and your trend appears here.' : `Your ${skill} criteria trend appears after two scored attempts.`}</p>
        ) : (
          <Suspense fallback={<Skeleton className="h-72" />}>
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
