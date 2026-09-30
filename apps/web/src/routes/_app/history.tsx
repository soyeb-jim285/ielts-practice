import { infiniteQueryOptions, useSuspenseInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { History, Mic, PenLine } from 'lucide-react';
import { LoadMore, nextPage } from '@/components/bank/LoadMore';
import { GroupHeading, listStyles, RowChevron, RowIcon, rowStyles } from '@/components/bank/ListRow';
import { dayBucket, runs } from '@/components/bank/group';
import { Badge, buttonStyles, EmptyState, GhostList, PageContainer, PageHeader, Segmented, type Tone } from '@/components/ui';
import { call, client } from '@/lib/api';
import { formatBand, formatDate, formatDuration } from '@/lib/format';
import { useMe } from '@/lib/query';
import { cn } from '@/lib/utils';
import { bandColor, type AttemptListItem as AttemptItem } from '@/lib/result';

type Skill = 'speaking' | 'writing';

const historyQuery = (skill?: Skill) =>
  infiniteQueryOptions({
    queryKey: ['attempts', { skill }],
    queryFn: ({ pageParam }) => call(client.GET('/api/attempts', { params: { query: { page: pageParam, skill } } })),
    initialPageParam: 1,
    getNextPageParam: nextPage,
  });

export const Route = createFileRoute('/_app/history')({
  validateSearch: (s: Record<string, unknown>): { skill?: Skill } => ({ skill: s.skill === 'speaking' || s.skill === 'writing' ? s.skill : undefined }),
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => context.queryClient.ensureInfiniteQueryData(historyQuery(deps.skill)),
  component: HistoryPage,
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

function HistoryPage() {
  const { skill } = Route.useSearch();
  const navigate = Route.useNavigate();
  const target = useMe().data?.settings.targetBand ?? 7;
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage } = useSuspenseInfiniteQuery(historyQuery(skill));
  const items = data.pages.flatMap((p) => p.items);
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
            ]}
          />
        }
      />
      {items.length === 0 ? (
        <EmptyState
          icon={<History />}
          preview={<GhostList rows={4} />}
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
