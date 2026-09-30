import { infiniteQueryOptions, queryOptions, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Check, LibraryBig, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LoadMore, nextPage } from '@/components/bank/LoadMore';
import { PracticeLink } from '@/components/bank/PracticeLink';
import { Badge, Button, Card, Chip, EmptyState, Input, PageHeader, Select, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { useMe } from '@/lib/query';

type Skill = 'speaking' | 'writing';
export type BankPrompt = {
  id: string;
  skill: Skill;
  part: number;
  variant: 'academic' | 'general' | null;
  type: string;
  topic: string;
  title: string;
  source: 'generated' | 'cambridge';
  sourceRef: string | null;
  done: boolean;
};
type Filters = { skill?: Skill; part?: number; type?: string; topic?: string; source?: 'generated' | 'cambridge'; q?: string };
type PromptPage = { items: BankPrompt[]; page: number; pageSize: number; total: number };
type Meta = { groups: { skill: Skill; part: number; topics: string[]; types: string[] }[] };

const metaQuery = queryOptions({ queryKey: ['prompts', 'meta'], queryFn: () => api.get<Meta>('/prompts/meta'), staleTime: 10 * 60_000 });
const bankQuery = (f: Filters) =>
  infiniteQueryOptions({
    queryKey: ['prompts', 'list', f],
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ page: String(pageParam) });
      for (const [k, v] of Object.entries(f)) if (v != null && v !== '') qs.set(k, String(v));
      return api.get<PromptPage>(`/prompts?${qs}`);
    },
    initialPageParam: 1,
    getNextPageParam: nextPage,
  });

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
export const Route = createFileRoute('/_app/bank')({
  validateSearch: (s: Record<string, unknown>): Filters => {
    const skill = s.skill === 'speaking' || s.skill === 'writing' ? s.skill : undefined;
    const part = Number(s.part);
    return {
      skill,
      part: skill && [1, 2, 3].includes(part) ? part : undefined,
      type: str(s.type),
      topic: str(s.topic),
      source: s.source === 'generated' || s.source === 'cambridge' ? s.source : undefined,
      q: str(s.q),
    };
  },
  loader: ({ context }) => void context.queryClient.prefetchQuery(metaQuery),
  component: BankPage,
});

const partName = (skill: Skill, part: number) => (skill === 'speaking' ? `Part ${part}` : `Task ${part}`);
const pretty = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1)).replace(/[-_]/g, ' ');

function BankPage() {
  const f = Route.useSearch();
  const navigate = Route.useNavigate();
  const { cambridgeAccess } = useMe().data!;
  const set = (patch: Filters) => navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  // Debounced search box → ?q=
  const [q, setQ] = useState(f.q ?? '');
  useEffect(() => {
    if (q === (f.q ?? '')) return;
    const t = setTimeout(() => set({ q: q || undefined }), 250);
    return () => clearTimeout(t);
  }, [q]);

  const meta = useQuery(metaQuery).data?.groups ?? [];
  const scoped = meta.filter((g) => (!f.skill || g.skill === f.skill) && (!f.part || g.part === f.part));
  const types = [...new Set(scoped.flatMap((g) => g.types))].sort();
  const topics = [...new Set(scoped.flatMap((g) => g.topics))].sort();
  const parts = f.skill === 'writing' ? [1, 2] : [1, 2, 3];

  const list = useInfiniteQuery(bankQuery(f));
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total;
  const filtered = !!(f.skill || f.type || f.topic || f.source || f.q);

  return (
    <>
      <PageHeader title="Prompt bank" description={total != null ? `${total.toLocaleString('en')} ${total === 1 ? 'prompt' : 'prompts'}${filtered ? ' match' : ''}` : 'Every question and task you can practise.'} />

      <div className="mb-5 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input label="Search prompts" hideLabel type="search" placeholder="Search titles and questions…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0" role="group" aria-label="Skill and part">
          <Chip selected={!f.skill} onClick={() => set({ skill: undefined, part: undefined, type: undefined, topic: undefined })}>
            All
          </Chip>
          {(['speaking', 'writing'] as const).map((s) => (
            <Chip key={s} selected={f.skill === s && !f.part} onClick={() => set({ skill: s, part: undefined, type: undefined, topic: undefined })}>
              {pretty(s)}
            </Chip>
          ))}
          {f.skill && <span className="mx-1 w-px shrink-0 self-stretch bg-line" aria-hidden />}
          {f.skill &&
            parts.map((p) => (
              <Chip key={p} selected={f.part === p} onClick={() => set({ part: f.part === p ? undefined : p, type: undefined, topic: undefined })}>
                {partName(f.skill!, p)}
              </Chip>
            ))}
          {/* Without Cambridge access everything is generated, so a source filter means nothing. */}
          {cambridgeAccess && (
            <>
              <span className="mx-1 w-px shrink-0 self-stretch bg-line" aria-hidden />
              <Chip selected={f.source === 'generated'} onClick={() => set({ source: f.source === 'generated' ? undefined : 'generated' })}>
                Generated
              </Chip>
              <Chip selected={f.source === 'cambridge'} onClick={() => set({ source: f.source === 'cambridge' ? undefined : 'cambridge' })}>
                Cambridge
              </Chip>
            </>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <Select label="Type" hideLabel value={f.type ?? ''} onChange={(e) => set({ type: e.target.value || undefined })}>
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {pretty(t)}
              </option>
            ))}
          </Select>
          <Select label="Topic" hideLabel value={f.topic ?? ''} onChange={(e) => set({ topic: e.target.value || undefined })}>
            <option value="">All topics</option>
            {topics.map((t) => (
              <option key={t} value={t}>
                {pretty(t)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {list.isPending ? (
        <Card padded={false} aria-busy>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-line px-5 py-4 last:border-0">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="h-8 w-20" />
            </div>
          ))}
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<LibraryBig />}
          title={filtered ? 'No prompts match' : 'The bank is empty'}
          action={
            filtered && (
              <Button variant="secondary" onClick={() => (setQ(''), navigate({ search: {}, replace: true }))}>
                Clear filters
              </Button>
            )
          }
        >
          {filtered ? 'Try a broader search or fewer filters.' : 'Seed the prompt bank on the server to start practising.'}
        </EmptyState>
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-line">
            {items.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="text-[0.9375rem] font-medium text-pretty">{p.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted">
                    <span>
                      {pretty(p.skill)} · {partName(p.skill, p.part)}
                      {p.variant ? ` ${pretty(p.variant)}` : ''} · {pretty(p.topic)}
                    </span>
                    {p.source === 'cambridge' && <Badge tone="accent">{p.sourceRef ?? 'Cambridge'}</Badge>}
                    {p.done && (
                      <Badge tone="good">
                        <Check aria-hidden /> Done
                      </Badge>
                    )}
                  </p>
                </div>
                <PracticeLink prompt={p} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
    </>
  );
}
