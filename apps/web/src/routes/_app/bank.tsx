import { infiniteQueryOptions, queryOptions, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Check, LibraryBig, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LoadMore, nextPage } from '@/components/bank/LoadMore';
import { GroupHeading, listStyles, RowChevron, rowStyles } from '@/components/bank/ListRow';
import { runs } from '@/components/bank/group';
import { PromptLink } from '@/components/bank/PracticeLink';
import { Alert, Badge, Button, EmptyState, Input, PageContainer, PageHeader, Segmented, Select, Skeleton } from '@/components/ui';
import { call, client, type Schemas } from '@/lib/api';
import { typeLabel } from '@/lib/writing';
import { useMe } from '@/lib/query';

type Skill = 'speaking' | 'writing';
export type BankPrompt = Schemas['Prompt'];
type Variant = 'academic' | 'general';
type Filters = { skill?: Skill; part?: number; variant?: Variant; type?: string; topic?: string; source?: 'generated' | 'cambridge'; q?: string };

const metaQuery = queryOptions({ queryKey: ['prompts', 'meta'], queryFn: () => call(client.GET('/api/prompts/meta')), staleTime: 10 * 60_000 });
const bankQuery = (f: Filters) =>
  infiniteQueryOptions({
    queryKey: ['prompts', 'list', f],
    queryFn: ({ pageParam }) => call(client.GET('/api/prompts', { params: { query: { ...f, type: f.type || undefined, topic: f.topic || undefined, q: f.q || undefined, page: pageParam } } })),
    initialPageParam: 1,
    getNextPageParam: nextPage,
  });

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
export const Route = createFileRoute('/_app/bank')({
  validateSearch: (s: Record<string, unknown>): Filters => {
    const skill = s.skill === 'speaking' || s.skill === 'writing' ? s.skill : undefined;
    const part = Number(s.part);
    const p = skill && [1, 2, 3].includes(part) ? part : undefined;
    return {
      skill,
      part: p,
      variant: skill === 'writing' && p === 1 && (s.variant === 'academic' || s.variant === 'general') ? s.variant : undefined,
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
// Same vocabulary as the Writing page: Task 1 splits into Academic and General.
const PARTS = {
  speaking: [
    { value: 'all', label: 'All' },
    { value: '1', label: 'Part 1' },
    { value: '2', label: 'Part 2' },
    { value: '3', label: 'Part 3' },
  ],
  writing: [
    { value: 'all', label: 'All' },
    { value: '1-academic', label: 'T1 Academic' },
    { value: '1-general', label: 'T1 General' },
    { value: '2', label: 'Task 2' },
  ],
};
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
  // Type only appears once a part is picked (the tabs already split the bank by part; speaking Parts 1 and 2 have one type each), and then lists just that part's types.
  // Task 1 types are shared across variants in the meta; letters are General, everything else Academic (as on the Writing page).
  const ofVariant = (t: string) => !f.variant || (f.variant === 'general') === t.startsWith('letter');
  const types = f.part ? [...new Set(scoped.flatMap((g) => g.types.filter(ofVariant)))].sort() : [];
  const topics = [...new Set(scoped.flatMap((g) => g.topics))].sort();

  const list = useInfiniteQuery(bankQuery(f));
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total;
  const filtered = !!(f.skill || f.type || f.topic || f.source || f.q);
  // Rows arrive sorted by skill, then part: group consecutive runs under one sticky header.
  const groups = runs(items, (p) => `${p.skill}${p.part}`).map((g) => {
    const p = g.items[0]!;
    return { ...g, label: `${pretty(p.skill)}, ${partName(p.skill, p.part)}${p.skill === 'writing' && f.variant ? ` ${pretty(f.variant)}` : ''}` };
  });

  return (
    <PageContainer>
      <PageHeader title="Prompt bank" description={total != null ? `${total.toLocaleString('en')} ${total === 1 ? 'prompt' : 'prompts'}${filtered ? ' match' : ''}` : 'Every question and task you can practise.'} />

      <div className="mb-6 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 z-10 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input label="Search prompts" hideLabel type="search" placeholder="Search titles and questions" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <Segmented
            label="Skill"
            className="max-sm:w-full"
            value={f.skill ?? 'all'}
            onChange={(v) => set({ skill: v === 'all' ? undefined : v, part: undefined, variant: undefined, type: undefined, topic: undefined })}
            options={[
              { value: 'all', label: 'All' },
              { value: 'speaking', label: 'Speaking' },
              { value: 'writing', label: 'Writing' },
            ]}
          />
          {f.skill && (
            <Segmented
              label={f.skill === 'speaking' ? 'Part' : 'Task'}
              className="max-sm:w-full"
              value={f.part ? `${f.part}${f.variant ? `-${f.variant}` : ''}` : 'all'}
              onChange={(v) => {
                const [part, variant] = v.split('-') as [string, Variant | undefined];
                set({ part: v === 'all' ? undefined : Number(part), variant, type: undefined, topic: undefined });
              }}
              options={PARTS[f.skill]}
            />
          )}
          <div className="grid grow grid-cols-2 gap-3 sm:ml-auto sm:flex sm:grow-0 sm:[&>*]:w-44">
            {types.length > 1 && (
              <Select label="Type" hideLabel value={f.type ?? ''} onChange={(e) => set({ type: e.target.value || undefined })}>
                <option value="">Any type</option>
                {types.map((t) => (
                  <option key={t} value={t}>
                    {typeLabel(t)}
                  </option>
                ))}
              </Select>
            )}
            <Select label="Topic" hideLabel value={f.topic ?? ''} onChange={(e) => set({ topic: e.target.value || undefined })}>
              <option value="">All topics</option>
              {topics.map((t) => (
                <option key={t} value={t}>
                  {pretty(t)}
                </option>
              ))}
            </Select>
            {/* Without Cambridge access everything is generated, so a source filter means nothing. */}
            {cambridgeAccess && (
              <Select label="Source" hideLabel value={f.source ?? ''} onChange={(e) => set({ source: (e.target.value || undefined) as Filters['source'] })}>
                <option value="">All sources</option>
                <option value="generated">Generated</option>
                <option value="cambridge">Cambridge</option>
              </Select>
            )}
          </div>
        </div>
      </div>

      {list.isError ? (
        <Alert
          tone="bad"
          title="Couldn't load prompts"
          action={
            <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
              Try again
            </Button>
          }
        >
          Check your connection and try again.
        </Alert>
      ) : list.isPending ? (
        <div className={listStyles} aria-busy>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="space-y-2 py-4">
              <Skeleton className="h-[1.125rem] w-2/3" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<LibraryBig />}
          title={filtered ? 'No prompts match' : 'The bank is empty'}
          action={
            filtered && (
              <Button variant="outline" onClick={() => (setQ(''), navigate({ search: {}, replace: true }))}>
                Clear filters
              </Button>
            )
          }
        >
          {filtered ? 'Try a broader search or fewer filters.' : 'Seed the prompt bank on the server to start practising.'}
        </EmptyState>
      ) : (
        <div>
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label}>
              <GroupHeading>{g.label}</GroupHeading>
              <ul className={listStyles}>
                {g.items.map((p) => {
                  // Speaking Part 1/3 titles are just the topic: show the first question under it; writing shows the task type.
                  const question = p.skill === 'speaking' ? p.body.split('\n')[0] : typeLabel(p.type);
                  return (
                    <li key={p.id}>
                      <PromptLink prompt={p} className={rowStyles}>
                        <span className="min-w-0 flex-1">
                          <span className="type-reading-sm line-clamp-2 block text-pretty">{p.title}</span>
                          <span className="type-caption mt-0.5 flex items-center gap-2">
                            {question && question !== p.title && <span className="truncate">{question}</span>}
                            {p.source === 'cambridge' && <Badge tone="accent">{p.sourceRef ?? 'Cambridge'}</Badge>}
                            {p.done && (
                              <Badge tone="good">
                                <Check aria-hidden /> Done
                              </Badge>
                            )}
                          </span>
                        </span>
                        <RowChevron />
                      </PromptLink>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
    </PageContainer>
  );
}
