import { infiniteQueryOptions, useSuspenseInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronRight, History, Mic, PenLine } from 'lucide-react';
import { LoadMore, nextPage } from '@/components/bank/LoadMore';
import { Badge, buttonStyles, Card, EmptyState, PageHeader, Segmented, type Tone } from '@/components/ui';
import { call, client } from '@/lib/api';
import { formatBand, formatDate, formatDuration } from '@/lib/format';
import { useMe } from '@/lib/query';
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
  recording: { label: 'Not submitted', tone: 'neutral' },
  analyzing: { label: 'Scoring…', tone: 'accent' },
  failed: { label: 'Failed', tone: 'bad' },
};
const partLabel = (a: AttemptItem) => (a.skill === 'speaking' ? `Part ${a.part}` : `Task ${a.part}`);

function HistoryPage() {
  const { skill } = Route.useSearch();
  const navigate = Route.useNavigate();
  const target = useMe().data?.settings.targetBand ?? 7;
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage } = useSuspenseInfiniteQuery(historyQuery(skill));
  const items = data.pages.flatMap((p) => p.items);
  const total = data.pages[0]?.total ?? 0;

  return (
    <>
      <PageHeader
        title="History"
        description={total ? `${total} ${total === 1 ? 'attempt' : 'attempts'}` : undefined}
        actions={
          <Segmented
            label="Skill"
            size="sm"
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
          title="No attempts yet"
          action={
            <Link to={skill === 'writing' ? '/writing' : '/speaking'} className={buttonStyles()}>
              Start practising
            </Link>
          }
        >
          Every answer you record and essay you submit shows up here with its band.
        </EmptyState>
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-line">
            {items.map((a) => {
              const Icon = a.skill === 'speaking' ? Mic : PenLine;
              const status = a.status === 'done' ? null : STATUS[a.status];
              return (
                <li key={a.id}>
                  <Link
                    to={a.skill === 'speaking' ? '/speaking/result/$attemptId' : '/writing/result/$attemptId'}
                    params={{ attemptId: a.id }}
                    className="flex items-center gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-ink/5 sm:px-5"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-muted ring-1 ring-line">
                      <Icon className="size-4" aria-label={a.skill} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.9375rem] font-medium">{a.promptTitle}</span>
                      <span className="block truncate text-sm text-muted">
                        {partLabel(a)} · {formatDate(a.createdAt, true)}
                        {a.durationMs ? ` · ${formatDuration(a.durationMs)}` : ''}
                      </span>
                    </span>
                    {status ? (
                      <Badge tone={status.tone}>{status.label}</Badge>
                    ) : (
                      a.overall != null && (
                        <Badge tone={bandColor(a.overall, target)} className="tabular-nums" aria-label={`Band ${formatBand(a.overall)}`}>
                          {formatBand(a.overall)}
                        </Badge>
                      )
                    )}
                    <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <LoadMore hasMore={!!hasNextPage} loading={isFetchingNextPage} onLoad={() => void fetchNextPage()} />
    </>
  );
}
