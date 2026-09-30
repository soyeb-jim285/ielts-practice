import { infiniteQueryOptions, useMutation, useSuspenseInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { ArrowRight, Check, Plus, TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { runs } from '@/components/bank/group';
import { LoadMore, nextPage } from '@/components/bank/LoadMore';
import { listStyles } from '@/components/bank/ListRow';
import { Badge, Button, buttonStyles, Chip, EmptyState, GhostList, PageContainer, PageHeader, toast } from '@/components/ui';
import { call, client, type Schemas } from '@/lib/api';
import { formatClock, formatRelative, plural } from '@/lib/format';
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
      <PageContainer>
        <PageHeader title="Mistakes" description="Every correction from your results, grouped so patterns stand out." />
        <EmptyState
          icon={<TriangleAlert />}
          title="Your error log is empty"
          preview={<GhostList rows={3} />}
          action={
            <Link to="/writing" className={buttonStyles()}>
              Write an essay
            </Link>
          }
        >
          Grammar slips, word choices and cohesion issues from your results collect here, so you can spot the ones that keep coming back.
        </EmptyState>
      </PageContainer>
    );

  return (
    <PageContainer>
      <PageHeader title="Mistakes" description={`${plural(all, 'correction')} from your results, grouped so patterns stand out.`} />
      <div
        className="-mx-4 mb-8 flex snap-x snap-proximity scroll-px-4 gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] sm:-mx-6 sm:scroll-px-6 sm:px-6 md:mx-0 md:flex-wrap md:[mask-image:none] md:px-0"
        role="group"
        aria-label="Filter by category"
      >
        <Chip className="shrink-0 snap-start" selected={!category} onClick={() => pick()}>
          All <span className="type-num opacity-70">{all}</span>
        </Chip>
        {groups.map((g) => (
          <Chip key={g.category} className="shrink-0 snap-start" selected={category === g.category} onClick={() => pick(g.category)}>
            {categoryLabel(g.category)} <span className="type-num opacity-70">{g.count}</span>
          </Chip>
        ))}
      </div>
      {/* One block per attempt: its prompt is named once, the corrections from it follow. */}
      {runs(items, (m) => m.attemptId).map((g) => (
        <AttemptGroup key={`${g.key}-${g.items[0]!.id}`} first={g.items[0]!}>
          <ul className={listStyles}>
            {g.items.map((m) => (
              <MistakeItem key={m.id} m={m} showCategory={!category} />
            ))}
          </ul>
        </AttemptGroup>
      ))}
      <LoadMore hasMore={!!hasNextPage} loading={isFetchingNextPage} onLoad={() => void fetchNextPage()} />
    </PageContainer>
  );
}

const resultLink = (m: Mistake) =>
  m.skill === 'speaking'
    ? ({ to: '/speaking/result/$attemptId', params: { attemptId: m.attemptId }, search: { tab: 'transcript' } } as const)
    : ({ to: '/writing/result/$attemptId', params: { attemptId: m.attemptId }, search: { tab: 'essay' } } as const);

/** Heading of one attempt's corrections: the prompt title (links to the result), then where and when. */
function AttemptGroup({ first: m, children }: { first: Mistake; children: ReactNode }) {
  return (
    <section aria-label={m.promptTitle} className="[&:not(:first-of-type)]:mt-12">
      <div className="mb-2 flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
        <h2 className="min-w-0">
          <Link {...resultLink(m)} className="type-reading-sm block truncate rounded-sm underline decoration-line decoration-1 underline-offset-4 hover:text-accent-text hover:decoration-accent-text">
            {m.promptTitle}
          </Link>
        </h2>
        <span className="type-caption shrink-0">
          {m.skill === 'speaking' ? `Speaking Part ${m.part}` : `Writing Task ${m.part}`}, {formatRelative(m.createdAt)}
        </span>
      </div>
      {children}
    </section>
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

  return (
    <li className="grid gap-x-8 gap-y-2 py-5 md:grid-cols-[9rem_minmax(0,1fr)_auto]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 md:flex-col md:items-start md:gap-y-1.5">
        {showCategory && <Badge>{categoryLabel(m.category)}</Badge>}
        {m.time != null && <span className="type-caption type-num">at {formatClock(m.time)}</span>}
      </div>
      <div className="min-w-0 max-w-[68ch]">
        {!same && (
          <p className="type-reading-sm flex flex-col gap-1">
            <del className={clsx('text-bad-text decoration-bad/60', clamp && 'line-clamp-2')}>{m.original}</del>
            <span className="flex min-w-0 items-start gap-2">
              <ArrowRight role="img" className="mt-1.5 size-4 shrink-0 text-muted" aria-label="corrected to" />
              <ins className={clsx('min-w-0 font-medium text-good-text no-underline', clamp && 'line-clamp-2')}>{m.correction}</ins>
            </span>
          </p>
        )}
        {long && (
          <Button variant="link" className="-ml-1 px-1 max-md:min-h-11" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
            {expanded ? 'Show less' : 'Show more'}
          </Button>
        )}
        <p className={clsx('type-body text-pretty', same ? 'text-ink' : 'mt-2 text-muted')}>{m.explanation}</p>
      </div>
      <div className="md:justify-self-end">
        <Button size="sm" variant="ghost" className="-ml-3 px-3 max-md:min-h-11 md:ml-0 md:-mr-3" icon={added ? <Check /> : <Plus />} loading={add.isPending} disabled={added} onClick={() => add.mutate()}>
          {added ? 'In deck' : 'Add to deck'}
        </Button>
      </div>
    </li>
  );
}
