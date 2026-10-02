import type { CriterionKey } from '@server/ai/types';
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, Flame, History, Layers, LibraryBig, MessagesSquare, Mic, PenLine } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import CriteriaTrend from '@/components/dashboard/Charts';
import { listStyles, panelFooterStyles, PanelHeader, RowChevron, RowIcon, rowStyles, RowText } from '@/components/bank/ListRow';
import { speakingSession, StartWritingButton, useStartWriting } from '@/components/bank/PracticeLink';
import { CRITERION_SHORT, PRACTICE, practiceTarget, type Progress } from '@/components/dashboard/criteria';
import { GuestHome } from '@/components/dashboard/GuestHome';
import { Onboarding } from '@/components/dashboard/Onboarding';
import { QuotaStrip } from '@/components/community/QuotaNote';
import { Alert, Badge, buttonStyles, Card, CountUp, PageContainer, PageHeader, ProgressBar, Segmented } from '@/components/ui';
import { call, client } from '@/lib/api';
import { formatBand, formatMinutes, plural } from '@/lib/format';
import { isAccount, meQuery, useAccount, useMe } from '@/lib/query';
import { cn } from '@/lib/utils';
import { categoryLabel, criterionLabel, SPEAKING_CRITERIA, WRITING_CRITERIA } from '@/lib/result';

type Skill = 'speaking' | 'writing';
const progressQuery = queryOptions({ queryKey: ['progress'], queryFn: () => call(client.GET('/api/progress')), staleTime: 0 });
const dueCountQuery = queryOptions({ queryKey: ['cards', 'due'], queryFn: () => call(client.GET('/api/cards/due')), staleTime: 0 });

export const Route = createFileRoute('/_app/')({
  // Guests (no session) get a static intro and load nothing personal.
  loader: async ({ context }) => {
    if (isAccount(await context.queryClient.ensureQueryData(meQuery))) await Promise.all([context.queryClient.ensureQueryData(progressQuery), context.queryClient.ensureQueryData(dueCountQuery)]);
  },
  component: Home,
});

function Home() {
  return useAccount() ? <Dashboard /> : <GuestHome />;
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

function Dashboard() {
  const me = useMe().data!;
  const { data: p } = useSuspenseQuery(progressQuery);
  const { data: due } = useSuspenseQuery(dueCountQuery);
  const deck = due.deck;
  const first = me.user.name.split(' ')[0];
  const target = me.settings.targetBand;
  const weakest = p.weakest && PRACTICE[p.weakest.key as CriterionKey] ? (p.weakest as { key: CriterionKey; avg: number }) : null;
  const maxMistakes = Math.max(1, ...p.topMistakes.map((m) => m.count));
  const showTrend = p.trend.length > 0;

  return (
    <PageContainer>
      <PageHeader
        title={`${greeting()}${first ? `, ${first}` : ''}`}
        description={
          p.attempts ? (
            <span className="inline-flex flex-wrap items-center gap-x-5 gap-y-1">
              <span className="inline-flex items-center gap-1.5">
                <Flame className={cn('size-4', p.streak ? 'text-warn-text' : 'text-muted')} aria-hidden />
                {p.streak ? `${plural(p.streak, 'day')} in a row` : 'Practise today to start a streak'}
              </span>
              <span>{formatMinutes(p.minutesThisWeek)} practised this week</span>
            </span>
          ) : (
            'Welcome. Here is how to get your first score.'
          )
        }
      />

      <div className="space-y-6 md:space-y-8">
        <QuotaStrip />
        {p.lastFailed && (
          <Alert
            tone="warn"
            title="Your last attempt couldn't be scored"
            action={
              <Link
                to={p.lastFailed.skill === 'speaking' ? '/speaking/result/$attemptId' : '/writing/result/$attemptId'}
                params={{ attemptId: p.lastFailed.id }}
                search={{}}
                className={buttonStyles({ variant: 'outline', size: 'sm' })}
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
            <section aria-label="Where you stand" className="stagger grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
              <NextUp weakest={weakest} trend={p.trend} target={target} />
              <Card padded={false} className="flex flex-col divide-y divide-line px-5">
                <Predicted skill="speaking" band={p.predicted.speaking} n={p.trend.filter((t) => t.skill === 'speaking').length} target={target} />
                <Predicted skill="writing" band={p.predicted.writing} n={p.trend.filter((t) => t.skill === 'writing').length} target={target} />
              </Card>
            </section>
            {showTrend && <Trend trend={p.trend} target={target} />}
          </>
        )}

        <div className={cn('stagger grid gap-x-12 gap-y-12', p.topMistakes.length > 0 && 'lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]')}>
          <section aria-labelledby="practise-h" className="min-w-0">
            <PanelHeader id="practise-h" title="Practise" />
            <ul className={cn(listStyles, 'stagger')}>
              <li>
                <Link {...speakingSession('full')} className={rowStyles}>
                  <RowIcon>
                    <Mic />
                  </RowIcon>
                  <RowText title="Full speaking test" meta="11-14 min, all three parts" />
                  <RowChevron />
                </Link>
              </li>
              <li>
                <Link to="/speaking/live" className={rowStyles}>
                  <RowIcon>
                    <MessagesSquare />
                  </RowIcon>
                  <RowText title="Live examiner" meta={me.liveProviders.length ? 'A spoken conversation with an AI examiner' : 'Needs your own API key, added in Settings'} />
                  <RowChevron />
                </Link>
              </li>
              <li>
                <WritingRow />
              </li>
              <li>
                <Link to="/review" className={rowStyles}>
                  <RowIcon>
                    <Layers />
                  </RowIcon>
                  <RowText title="Review deck" meta={due.total ? 'A few minutes keeps corrections from slipping' : deck === 0 ? 'Add corrections from Mistakes to start your deck' : deck ? 'All caught up for today' : 'Nothing due today'} />
                  {due.total > 0 && <Badge tone="accent">{due.total} due</Badge>}
                  <RowChevron />
                </Link>
              </li>
            </ul>
            <div className="mt-1 flex flex-wrap gap-x-6">
              <Link to="/bank" className={panelFooterStyles}>
                <LibraryBig className="size-4" aria-hidden /> Choose from the prompt bank
              </Link>
              <Link to="/history" className={panelFooterStyles}>
                <History className="size-4" aria-hidden /> Past attempts
              </Link>
            </div>
          </section>

          {p.topMistakes.length > 0 && (
            <section aria-labelledby="mistakes-h" className="min-w-0">
              <PanelHeader id="mistakes-h" title="Recurring mistakes" meta="Last 30 days" />
              <ul className={cn(listStyles, 'stagger')}>
                {p.topMistakes.map((m) => (
                  <li key={m.category}>
                    <Link to="/mistakes" search={{ category: m.category }} className={cn(rowStyles, 'flex-col items-stretch justify-center gap-2')}>
                      <span className="flex items-baseline justify-between gap-3 type-body">
                        <span className="truncate">{categoryLabel(m.category)}</span>
                        <span className="type-num shrink-0 text-sm text-muted">{m.count}</span>
                      </span>
                      <ProgressBar value={m.count / maxMistakes} tone="neutral" label={`${categoryLabel(m.category)}: ${m.count}`} className="h-1" />
                    </Link>
                  </li>
                ))}
              </ul>
              <Link to="/mistakes" className={panelFooterStyles}>
                Open error log <ArrowRight className="size-4 transition-transform duration-[120ms] group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </section>
          )}
        </div>
      </div>
    </PageContainer>
  );
}

/** Task 2 essay row: behaves like the other rows (a link look) but picks a random prompt first, so it is a button. */
function WritingRow() {
  const { start, busy } = useStartWriting(2);
  return (
    <button type="button" onClick={start} disabled={busy} aria-busy={busy} className={cn(rowStyles, 'disabled:opacity-50')}>
      <RowIcon>
        <PenLine />
      </RowIcon>
      <RowText title="Task 2 essay" meta="40 min, at least 250 words" />
      <RowChevron />
    </button>
  );
}

/** The one hero: what to practise next. Weakest criterion when known (at the part where the user scores lowest on it), otherwise a full test. */
function NextUp({ weakest, trend, target }: { weakest: { key: CriterionKey; avg: number } | null; trend: Progress['trend']; target: number }) {
  const practice = weakest ? practiceTarget(weakest.key, trend) : null;
  const avg = weakest ? Math.round(weakest.avg * 2) / 2 : 0;
  const cta = weakest && practice ? `Practise ${practice.label} (${CRITERION_SHORT[weakest.key]})` : 'Start a full speaking test';
  return (
    <Card tone="hero" className="flex flex-col justify-between gap-8 sm:p-7">
      <div className="min-w-0">
        <p className="type-caption font-medium text-accent-text">Next up</p>
        <h2 className="type-title-sm mt-2">{weakest ? `${criterionLabel(weakest.key)} is holding your band back` : 'Ready for another round?'}</h2>
        <p className="type-lede mt-3 max-w-[52ch]">
          {weakest && practice
            ? `You average ${formatBand(avg)} here${avg < target ? `, ${formatBand(target - avg)} below your ${formatBand(target)} target` : ''}, and your lowest scores came in ${practice.label}. Focused practice there moves it fastest.`
            : 'A full test gives the most complete picture of your band.'}
        </p>
      </div>
      <div>
        {practice?.skill === 'writing' ? (
          <StartWritingButton task={practice.part === 1 ? 1 : 2} size="lg" icon={<ArrowRight />} className="max-sm:w-full">
            {cta}
          </StartWritingButton>
        ) : (
          <Link {...speakingSession(practice ? (`p${practice.part}` as const) : 'full')} className={buttonStyles({ size: 'lg', className: 'max-sm:w-full' })}>
            {cta} <ArrowRight aria-hidden />
          </Link>
        )}
      </div>
    </Card>
  );
}

/** One predicted band as a row: label + bar + target on the left, the number on the right. With no scores the row holds the invitation and its action. */
function Predicted({ skill, band, n, target }: { skill: Skill; band: number | null; n: number; target: number }) {
  const label = skill === 'speaking' ? 'Speaking' : 'Writing';
  return (
    <section className="flex flex-1 flex-col justify-center py-5" aria-label={`Predicted ${label.toLowerCase()} band`}>
      {band == null ? (
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="type-caption">Predicted {label.toLowerCase()} band</h2>
            <p className="type-lede mt-1">No {label.toLowerCase()} scores yet.</p>
          </div>
          {skill === 'speaking' ? (
            <Link {...speakingSession('p1')} className={buttonStyles({ variant: 'outline', className: 'shrink-0' })}>
              Try Part 1
            </Link>
          ) : (
            <StartWritingButton variant="outline" className="shrink-0">
              Try Task 2
            </StartWritingButton>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-5">
          <div className="min-w-0 flex-1">
            <h2 className="type-caption">Predicted {label.toLowerCase()} band</h2>
            <div className="relative mt-3">
              <ProgressBar value={band / 9} label={`${label} band ${formatBand(band)} of 9`} className="h-1.5" />
              <span aria-hidden className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-ink" style={{ left: `${(target / 9) * 100}%` }} />
            </div>
            <p className="type-caption mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>Target {formatBand(target)}</span>
              <Badge tone={band >= target ? 'good' : 'neutral'}>{band >= target ? 'On target' : `${formatBand(target - band)} to go`}</Badge>
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="type-band text-5xl">
              <CountUp value={band} decimals={1} />
            </p>
            <p className="type-caption mt-1">{n > 1 ? `Avg of last ${Math.min(n, 5)}` : 'Latest score'}</p>
          </div>
        </div>
      )}
    </section>
  );
}

function Trend({ trend, target }: { trend: Progress['trend']; target: number }): ReactNode {
  const has = (s: Skill) => trend.filter((t) => t.skill === s).length >= 3;
  const [skill, setSkill] = useState<Skill>(has('speaking') || !has('writing') ? 'speaking' : 'writing');
  const rows = trend.filter((t) => t.skill === skill);
  const keys = skill === 'speaking' ? SPEAKING_CRITERIA : WRITING_CRITERIA;
  const latest = rows.at(-1)?.criteria ?? {};
  return (
    <section aria-labelledby="trend-h" className="border-t border-line pt-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h2 id="trend-h" className="type-heading">
          Band by criterion
        </h2>
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
      {rows.length < 3 ? (
        // A line needs three points to say anything: until then show the latest attempt's bands side by side.
        rows.length === 0 ? (
          <p className="type-lede py-6">Your {skill} criteria appear after your first scored attempt.</p>
        ) : (
          <div>
            <ul className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
              {keys.map((k) => (
                <li key={k}>
                  <p className="flex items-baseline justify-between gap-3 text-sm">
                    <span>{criterionLabel(k)}</span>
                    <span className="type-band text-lg">{formatBand(latest[k])}</span>
                  </p>
                  <div className="relative mt-2">
                    <ProgressBar value={(latest[k] ?? 0) / 9} label={`${criterionLabel(k)} band ${formatBand(latest[k])} of 9`} className="h-1.5" />
                    <span aria-hidden className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-ink" style={{ left: `${(target / 9) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
            <p className="type-caption mt-5">From your latest {skill} attempt; the marker is your {formatBand(target)} target. The trend line appears after three scored attempts.</p>
          </div>
        )
      ) : (
        <CriteriaTrend trend={rows} keys={keys} target={target} />
      )}
    </section>
  );
}
