import { infiniteQueryOptions, useMutation, useSuspenseInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { ArrowRight, Check, Plus, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { LoadMore, nextPage } from '@/components/bank/LoadMore';
import { Badge, Button, buttonStyles, Card, Chip, EmptyState, PageHeader, toast } from '@/components/ui';
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
          className="md:py-14"
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
      <div className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0" role="group" aria-label="Filter by category">
        <Chip className="shrink-0" selected={!category} onClick={() => pick()}>
          All <span className="tabular-nums opacity-70">{all}</span>
        </Chip>
        {groups.map((g) => (
          <Chip key={g.category} className="shrink-0" selected={category === g.category} onClick={() => pick(g.category)}>
            {categoryLabel(g.category)} <span className="tabular-nums opacity-70">{g.count}</span>
          </Chip>
        ))}
      </div>
      <Card padded={false} className="overflow-clip">
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
  const same = m.original.trim() === m.correction.trim(); // nothing to diff: the explanation carries it
  // Off-topic (task.relevance) spans quote whole answers: clamp them to two lines each. ponytail: length heuristic, not measured overflow.
  const long = !same && m.original.length + m.correction.length > 200;
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
    <li className="grid grid-cols-[1fr_auto] gap-x-3 px-5 py-4">
      <div className="min-w-0">
        {showCategory && <Badge className="mb-2">{categoryLabel(m.category)}</Badge>}
        {!same && (
          // Phones stack the phrases; the arrow always stays in front of the correction.
          <p className="flex flex-col gap-1 font-serif text-[1.0625rem] leading-relaxed sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-2">
            <del className={clsx('text-bad-text decoration-bad/60', clamp && 'line-clamp-2')}>{m.original}</del>
            <span className="flex min-w-0 items-start gap-2">
              <ArrowRight className="mt-1.5 size-4 shrink-0 text-muted" aria-label="corrected to" />
              <ins className={clsx('min-w-0 font-medium text-good-text no-underline', clamp && 'line-clamp-2')}>{m.correction}</ins>
            </span>
          </p>
        )}
        {long && (
          <Button variant="link" className="mt-1" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
            {expanded ? 'Show less' : 'Show more'}
          </Button>
        )}
        <p className={clsx('max-w-[65ch] text-sm text-pretty', same ? 'text-ink' : 'mt-2 text-muted')}>{m.explanation}</p>
        <Link {...link} className="mt-2 block rounded-sm text-sm text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring">
          <span className="block truncate font-medium text-brand-text">{m.promptTitle}</span>
          {[where, formatRelative(m.createdAt)].join(' · ')}
        </Link>
      </div>
      <Button size="sm" variant="ghost" className="-mr-2 max-sm:-mt-1.5 max-sm:px-2" icon={added ? <Check /> : <Plus />} loading={add.isPending} disabled={added} onClick={() => add.mutate()}>
        <span className="max-sm:sr-only">{added ? 'In deck' : 'Add to deck'}</span>
      </Button>
    </li>
  );
}
