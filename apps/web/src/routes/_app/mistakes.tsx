import { infiniteQueryOptions, useMutation, useSuspenseInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { ArrowRight, Check, Plus, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { LoadMore, nextPage } from '@/components/bank/LoadMore';
import { Button, buttonStyles, Card, Chip, EmptyState, PageHeader, toast } from '@/components/ui';
import { call, client, type Schemas } from '@/lib/api';
import { formatClock, formatRelative } from '@/lib/format';
import { categoryLabel } from '@/lib/result';

type Mistake = Schemas['Mistake'];

const mistakesQuery = (category?: string) =>
  infiniteQueryOptions({
    queryKey: ['mistakes', { category }],
    queryFn: ({ pageParam }) => call(client.GET('/api/mistakes', { params: { query: { page: pageParam, category } } })),
    initialPageParam: 1,
    getNextPageParam: nextPage,
  });

export const Route = createFileRoute('/_app/mistakes')({
  validateSearch: (s: Record<string, unknown>): { category?: string } => ({ category: typeof s.category === 'string' && s.category ? s.category : undefined }),
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => context.queryClient.ensureInfiniteQueryData(mistakesQuery(deps.category)),
  component: MistakesPage,
});

function MistakesPage() {
  const { category } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage } = useSuspenseInfiniteQuery(mistakesQuery(category));
  const groups = data.pages[0]?.groups ?? [];
  const all = groups.reduce((n, g) => n + g.count, 0);
  const items = data.pages.flatMap((p) => p.items);
  const pick = (c?: string) => navigate({ search: c ? { category: c } : {}, replace: true });

  if (all === 0)
    return (
      <>
        <PageHeader title="Mistakes" />
        <EmptyState
          icon={<TriangleAlert />}
          title="Your error log is empty"
          action={
            <Link to="/writing" className={buttonStyles()}>
              Write an essay
            </Link>
          }
        >
          Grammar slips, word choices and cohesion issues from your results collect here, so you can spot the ones that keep coming back.
        </EmptyState>
      </>
    );

  return (
    <>
      <PageHeader title="Mistakes" description="Every correction from your results, grouped so patterns stand out." />
      <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0" role="group" aria-label="Filter by category">
        <Chip selected={!category} onClick={() => pick()}>
          All <span className="tabular-nums opacity-70">{all}</span>
        </Chip>
        {groups.map((g) => (
          <Chip key={g.category} selected={category === g.category} onClick={() => pick(g.category)}>
            {categoryLabel(g.category)} <span className="tabular-nums opacity-70">{g.count}</span>
          </Chip>
        ))}
      </div>
      <Card padded={false}>
        <ul className="divide-y divide-line">
          {items.map((m) => (
            <MistakeItem key={m.id} m={m} showCategory={!category} />
          ))}
        </ul>
      </Card>
      <LoadMore hasMore={!!hasNextPage} loading={isFetchingNextPage} onLoad={() => void fetchNextPage()} />
    </>
  );
}

function MistakeItem({ m, showCategory }: { m: Mistake; showCategory: boolean }) {
  const [added, setAdded] = useState(m.inDeck);
  // Off-topic (task.relevance) spans quote whole answers: clamp them to two lines each. ponytail: length heuristic, not measured overflow.
  const long = m.original.length + m.correction.length > 200;
  const [expanded, setExpanded] = useState(false);
  const clamp = long && !expanded;
  const add = useMutation({
    mutationFn: () => call(client.POST('/api/mistakes/{id}/card', { params: { path: { id: m.id } } })),
    onSuccess: () => {
      setAdded(true);
      toast('Added to your review deck', { tone: 'good' });
    },
    onError: (e) => toast(e.message, { tone: 'bad' }),
  });
  const where = `${m.skill === 'speaking' ? `Speaking Part ${m.part}` : `Writing Task ${m.part}`}${m.time != null ? ` at ${formatClock(m.time)}` : ''}`;
  const link =
    m.skill === 'speaking'
      ? ({ to: '/speaking/result/$attemptId', params: { attemptId: m.attemptId }, search: { tab: 'transcript' } } as const)
      : ({ to: '/writing/result/$attemptId', params: { attemptId: m.attemptId }, search: { tab: 'essay' } } as const);

  return (
    <li className="grid grid-cols-[1fr_auto] gap-x-3 px-5 py-4 transition-colors duration-150 hover:bg-ink/[0.03]">
      <div className="min-w-0">
        {showCategory && <p className="mb-1.5 text-xs font-medium text-muted">{categoryLabel(m.category)}</p>}
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-serif text-[1.0625rem] leading-relaxed">
          <del className={clsx('text-bad-text decoration-bad/60', clamp && 'line-clamp-2')}>{m.original}</del>
          <ArrowRight className="size-4 shrink-0 translate-y-0.5 self-center text-muted" aria-label="corrected to" />
          <ins className={clsx('font-medium text-good-text no-underline', clamp && 'line-clamp-2')}>{m.correction}</ins>
        </p>
        {long && (
          <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className="hit mt-1 text-sm font-medium text-accent-text hover:underline">
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
        <p className="mt-2 text-sm text-muted text-pretty">{m.explanation}</p>
        <Link {...link} className="mt-2 flex flex-wrap gap-x-1 text-sm text-muted hover:text-ink">
          <span className="max-w-full truncate font-medium text-accent-text sm:max-w-[40ch]">{m.promptTitle}</span>
          <span>
            · {where} · {formatRelative(m.createdAt)}
          </span>
        </Link>
      </div>
      <Button size="sm" variant="ghost" className="-mr-2 max-sm:-mt-1.5 max-sm:px-2" icon={added ? <Check /> : <Plus />} loading={add.isPending} disabled={added} onClick={() => add.mutate()}>
        <span className="max-sm:sr-only">{added ? 'In deck' : 'Add to deck'}</span>
      </Button>
    </li>
  );
}
