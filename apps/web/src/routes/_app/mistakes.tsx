import { infiniteQueryOptions, useMutation, useSuspenseInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, Check, Plus, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { LoadMore, nextPage } from '@/components/bank/LoadMore';
import { Badge, Button, buttonStyles, Card, Chip, EmptyState, PageHeader, toast } from '@/components/ui';
import { api } from '@/lib/api';
import { formatClock, formatRelative } from '@/lib/format';
import { categoryLabel } from '@/lib/result';

type Mistake = {
  id: string;
  attemptId: string;
  skill: 'speaking' | 'writing';
  part: number;
  promptTitle: string;
  category: string;
  original: string;
  correction: string;
  explanation: string;
  time: number | null;
  createdAt: string;
};
type MistakeLog = { groups: { category: string; count: number }[]; items: Mistake[]; total: number; page: number; pageSize: number };

const mistakesQuery = (category?: string) =>
  infiniteQueryOptions({
    queryKey: ['mistakes', { category }],
    queryFn: ({ pageParam }) => api.get<MistakeLog>(`/mistakes?page=${pageParam}${category ? `&category=${encodeURIComponent(category)}` : ''}`),
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
      <ul className="space-y-3">
        {items.map((m) => (
          <li key={m.id}>
            <MistakeItem m={m} showCategory={!category} />
          </li>
        ))}
      </ul>
      <LoadMore hasMore={!!hasNextPage} loading={isFetchingNextPage} onLoad={() => void fetchNextPage()} />
    </>
  );
}

function MistakeItem({ m, showCategory }: { m: Mistake; showCategory: boolean }) {
  const [added, setAdded] = useState(false);
  const add = useMutation({
    mutationFn: () => api.post(`/mistakes/${m.id}/card`),
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
    <Card>
      {showCategory && (
        <Badge tone="neutral" className="mb-3">
          {categoryLabel(m.category)}
        </Badge>
      )}
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-serif text-[1.0625rem] leading-relaxed">
        <del className="text-bad-text decoration-bad/60">{m.original}</del>
        <ArrowRight className="size-4 shrink-0 translate-y-0.5 self-center text-muted" aria-label="corrected to" />
        <ins className="font-medium text-good-text no-underline">{m.correction}</ins>
      </p>
      <p className="mt-2 text-sm text-muted text-pretty">{m.explanation}</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <Link {...link} className="min-w-0 text-sm text-muted hover:text-ink">
          <span className="block truncate">
            <span className="font-medium text-accent-text">{m.promptTitle}</span> · {where} · {formatRelative(m.createdAt)}
          </span>
        </Link>
        <Button size="sm" variant="ghost" icon={added ? <Check /> : <Plus />} loading={add.isPending} disabled={added} onClick={() => add.mutate()}>
          {added ? 'In deck' : 'Add to deck'}
        </Button>
      </div>
    </Card>
  );
}
