import { infiniteQueryOptions, useSuspenseInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { AccountGate } from '@/components/community/AccountGate';
import { BookOpen, Headphones, History, Mic, PenLine } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { LoadMore, nextPage } from '@/components/bank/LoadMore';
import { GroupHeading, listStyles, RowChevron, RowIcon, rowStyles } from '@/components/bank/ListRow';
import { dayBucket, runs } from '@/components/bank/group';
import { Badge, buttonStyles, EmptyState, PageContainer, PageHeader, Segmented, type Tone } from '@/components/ui';
import { call, client } from '@/lib/api';
import { formatBand, formatDate, formatDuration } from '@/lib/format';
import { loadForAccount, useAccount, useMe } from '@/lib/query';
import { cn } from '@/lib/utils';
import { lrAttemptsQuery } from '@/lib/lr';
import { bandColor, type AttemptListItem as AttemptItem } from '@/lib/result';

type Skill = 'speaking' | 'writing';
type Filter = Skill | 'listening' | 'reading';
const isLr = (f?: Filter): f is 'listening' | 'reading' => f === 'listening' || f === 'reading';

const historyQuery = (skill?: Skill) =>
  infiniteQueryOptions({
    queryKey: ['attempts', { skill }],
    queryFn: ({ pageParam }) => call(client.GET('/api/attempts', { params: { query: { page: pageParam, skill } } })),
    initialPageParam: 1,
    getNextPageParam: nextPage,
  });

export const Route = createFileRoute('/_app/history')({
  validateSearch: (s: Record<string, unknown>): { skill?: Filter } => ({ skill: s.skill === 'speaking' || s.skill === 'writing' || s.skill === 'listening' || s.skill === 'reading' ? s.skill : undefined }),
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => loadForAccount(context.queryClient, () => context.queryClient.ensureInfiniteQueryData(historyQuery(isLr(deps.skill) ? undefined : deps.skill))),
  component: GatedHistoryPage,
});

const STATUS: Record<Exclude<AttemptItem['status'], 'done'>, { label: string; tone: Tone }> = {
  recording: { label: 'Not submitted', tone: 'warn' },
  analyzing: { label: 'Scoring', tone: 'accent' },
  failed: { label: 'Scoring failed', tone: 'bad' },
};
const partLabel = (a: AttemptItem) => (a.skill === 'speaking' ? `Part ${a.part}` : `Task ${a.part}`);
const BAND_TEXT = { good: 'text-good-text', warn: 'text-warn-text', bad: 'text-bad-text' };
// Editor time under a minute is a pasted or abandoned essay, not a meaningful duration; speaking recordings are short by design.
const showDuration = (a: AttemptItem) => !!a.durationMs && (a.skill === 'speaking' || a.durationMs >= 60_000);
// ponytail: `flag` isn't in the list contract yet (server request); rendered when present.
const FLAG: Record<string, string> = { offTopic: 'Off topic', tooShort: 'Under length' };

/** A guest gets the sign-up gate instead of a page that would answer 403. */
function GatedHistoryPage() {
  return useAccount() ? <HistoryPage /> : <AccountGate what="history" />;
}

function HistoryPage() {
  const { skill } = Route.useSearch();
  const navigate = Route.useNavigate();
  const target = useMe().data?.settings.targetBand ?? 7;
  const lrOn = !!useAccount();
  const lr = useQuery({ ...lrAttemptsQuery, enabled: lrOn }).data?.items.filter((a) => !isLr(skill) || a.skill === skill) ?? [];
  const showLr = lrOn && (!skill || isLr(skill));
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage } = useSuspenseInfiniteQuery(historyQuery(isLr(skill) ? undefined : skill));
  const items = isLr(skill) ? [] : data.pages.flatMap((p) => p.items);
  const total = data.pages[0]?.total ?? 0;

  return (
    <PageContainer>
      <PageHeader
        title="History"
        description={total ? `${total} ${total === 1 ? 'attempt' : 'attempts'}, newest first` : 'Every answer you record and essay you submit.'}
        actions={
          <Segmented
            label="Skill"
            className="max-sm:w-full"
            value={skill ?? 'all'}
            onChange={(v) => navigate({ search: v === 'all' ? {} : { skill: v }, replace: true })}
            options={[
              { value: 'all', label: 'All' },
              { value: 'speaking', label: 'Speaking' },
              { value: 'writing', label: 'Writing' },
              ...(lrOn ? [{ value: 'listening' as const, label: 'Listening' }, { value: 'reading' as const, label: 'Reading' }] : []),
            ]}
          />
        }
      />
      {showLr && lr.length > 0 && (
        <section aria-label="Listening and Reading" className="mb-8">
          <GroupHeading>Listening and Reading</GroupHeading>
          <ul className={listStyles}>
            {lr.slice(0, isLr(skill) ? undefined : 5).map((a) => {
              const Icon = a.skill === 'listening' ? Headphones : BookOpen;
              const done = a.status === 'submitted';
              return (
                <li key={a.id}>
                  <Link to={done ? '/lr/result/$attemptId' : '/lr/run/$attemptId'} params={{ attemptId: a.id }} className={cn(rowStyles, 'md:grid md:grid-cols-[1.25rem_minmax(0,1fr)_7rem_5.5rem_4.5rem_1rem] md:gap-x-4')}>
                    <RowIcon>
                      <Icon />
                    </RowIcon>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="type-subheading line-clamp-2 min-w-0 font-medium">{a.title}</span>
                        {!done && <Badge tone="warn" className="shrink-0">In progress</Badge>}
                      </span>
                      <span className="type-caption mt-0.5 block md:hidden">{a.mode === 'exam' ? 'Exam' : 'Practice'}, {formatDate(a.startedAt)}{done ? `, ${a.raw}/${a.total}` : ''}</span>
                    </span>
                    <span className="type-caption hidden capitalize md:block">{a.skill}, {a.mode}</span>
                    <span className="type-caption hidden md:block">{formatDate(a.startedAt)}</span>
                    <span className={cn('type-band justify-self-end text-lg', done && a.band != null ? BAND_TEXT[bandColor(a.band, target)] : 'text-muted')}>
                      <span className="sr-only">Band </span>
                      {done ? formatBand(a.band) : <span aria-hidden>-</span>}
                    </span>
                    <RowChevron />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {isLr(skill) ? (
        lr.length === 0 && (
          <EmptyState icon={<History />} title={`No ${skill} attempts yet`} action={<Link to={skill === 'listening' ? '/listening' : '/reading'} className={buttonStyles()}>Start a test</Link>}>
            Every {skill} test you take is listed here with its band.
          </EmptyState>
        )
      ) : items.length === 0 && showLr && lr.length > 0 ? null : items.length === 0 ? (
        <EmptyState
          icon={<History />}
          title={skill ? `No ${skill} attempts yet` : 'Nothing practised yet'}
          action={
            <Link to={skill === 'writing' ? '/writing' : '/speaking'} className={buttonStyles()}>
              Start practising
            </Link>
          }
        >
          Each answer you record and essay you submit is listed here with its band, newest first, so you can see the trend.
        </EmptyState>
      ) : (
        <div>
          {runs(items, (a) => dayBucket(a.createdAt)).map((g) => (
            <section key={g.key} aria-label={g.key}>
              <GroupHeading>{g.key}</GroupHeading>
              <ul className={listStyles}>
                {g.items.map((a) => {
                  const Icon = a.skill === 'speaking' ? Mic : PenLine;
                  const status = a.status === 'done' ? null : STATUS[a.status];
                  const flag = FLAG[(a as { flag?: string | null }).flag ?? ''];
                  const duration = showDuration(a) ? formatDuration(a.durationMs!) : null;
                  return (
                    <li key={a.id}>
                      {/* Phones: icon, title + one meta line, band. From md: icon, title, part, date, duration, band as aligned columns. */}
                      <Link
                        to={a.skill === 'speaking' ? '/speaking/result/$attemptId' : '/writing/result/$attemptId'}
                        params={{ attemptId: a.id }}
                        className={cn(rowStyles, 'md:grid md:grid-cols-[1.25rem_minmax(0,1fr)_4.5rem_5.5rem_4.5rem_3rem_1rem] md:gap-x-4')}
                      >
                        <RowIcon>
                          <Icon />
                        </RowIcon>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="type-subheading line-clamp-2 min-w-0 font-medium text-pretty">
                              <span className="sr-only">{a.skill}: </span>
                              {a.promptTitle}
                            </span>
                            {status && <Badge tone={status.tone} className="shrink-0">{status.label}</Badge>}
                            {flag && !status && <Badge tone="warn" className="shrink-0">{flag}</Badge>}
                          </span>
                          <span className="type-caption mt-0.5 block md:hidden">
                            {partLabel(a)}, {formatDate(a.createdAt)}
                            {duration ? `, ${duration}` : ''}
                          </span>
                        </span>
                        <span className="type-caption hidden md:block">{partLabel(a)}</span>
                        <span className="type-caption hidden md:block">{formatDate(a.createdAt)}</span>
                        <span className="type-caption type-num hidden md:block">{duration}</span>
                        <span className={cn('type-band justify-self-end text-lg', a.overall != null && !status ? BAND_TEXT[bandColor(a.overall, target)] : 'text-muted')}>
                          <span className="sr-only">Band </span>
                          {status || a.overall == null ? <span aria-hidden>-</span> : a.overall === 0 ? <span className="type-caption">No speech</span> : formatBand(a.overall)}
                        </span>
                        <RowChevron />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      <LoadMore hasMore={!!hasNextPage} loading={isFetchingNextPage} onLoad={() => void fetchNextPage()} />
    </PageContainer>
  );
}
