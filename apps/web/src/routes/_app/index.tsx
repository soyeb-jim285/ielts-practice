import { queryOptions, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Flame } from 'lucide-react';
import { FixNext } from '@/components/dashboard/FixNext';
import { GuestHome } from '@/components/dashboard/GuestHome';
import { MockPanel } from '@/components/dashboard/MockPanel';
import { NextUp } from '@/components/dashboard/NextUp';
import { Onboarding } from '@/components/dashboard/Onboarding';
import { PractiseList } from '@/components/dashboard/PractiseList';
import { ProgressTabs } from '@/components/dashboard/ProgressTabs';
import { YourPicture } from '@/components/dashboard/YourPicture';
import { Alert, buttonStyles, PageContainer, PageHeader } from '@/components/ui';
import { call, client } from '@/lib/api';
import { formatMinutes, plural } from '@/lib/format';
import { lrProgressQuery } from '@/lib/lr';
import { isAccount, meQuery, useAccount, useMe } from '@/lib/query';
import { cn } from '@/lib/utils';

const progressQuery = queryOptions({ queryKey: ['progress'], queryFn: () => call(client.GET('/api/progress')), staleTime: 0 });
const dueCountQuery = queryOptions({ queryKey: ['cards', 'due'], queryFn: () => call(client.GET('/api/cards/due')), staleTime: 0 });

export const Route = createFileRoute('/_app/')({
  // Guests (no session) get a static intro and load nothing personal.
  loader: async ({ context }) => {
    if (isAccount(await context.queryClient.ensureQueryData(meQuery))) await Promise.all([context.queryClient.ensureQueryData(progressQuery), context.queryClient.ensureQueryData(dueCountQuery), context.queryClient.ensureQueryData(lrProgressQuery)]);
  },
  component: Home,
});

function Home() {
  return useAccount() ? <Dashboard /> : <GuestHome />;
}

/** Midnight to 5am is "Hello": nobody wants "Good evening" at 3am. */
export const greeting = (h = new Date().getHours()) => (h < 5 ? 'Hello' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening');

function Dashboard() {
  const me = useMe().data!;
  const { data: p } = useSuspenseQuery(progressQuery);
  const { data: due } = useSuspenseQuery(dueCountQuery);
  const { data: lr } = useQuery(lrProgressQuery);
  const first = me.user.name.split(' ')[0];
  const target = me.settings.targetBand;
  const hasProgress = p.trend.length > 0 || !!lr?.trend.length;

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

      <div className="space-y-8 md:space-y-12">
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
        <YourPicture p={p} target={target} />
        {p.attempts === 0 ? <Onboarding /> : <NextUp p={p} target={target} due={due.total} lr={lr} />}
        <MockPanel continuedAbove={p.attempts > 0} />
        <PractiseList liveReady={me.liveProviders.length > 0} />
        {hasProgress && <ProgressTabs p={p} lr={lr} target={target} />}
        <FixNext mistakes={p.topMistakes} />
      </div>
    </PageContainer>
  );
}
