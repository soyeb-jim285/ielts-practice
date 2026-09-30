import { infiniteQueryOptions, queryOptions, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Check, ChevronRight, LibraryBig, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LoadMore, nextPage } from '@/components/bank/LoadMore';
import { PromptLink } from '@/components/bank/PracticeLink';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Segmented, Select, Skeleton } from '@/components/ui';
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
  // Type options grouped by skill/part, so Task 1 and Task 2 types (or speaking formats) never mix in one flat list.
  // Task 1 types are shared across variants in the meta; letters are General, everything else Academic (as on the Writing page).
  const ofVariant = (t: string) => !f.variant || (f.variant === 'general') === t.startsWith('letter');
  const typeGroups = scoped
    .map((g) => ({ label: `${pretty(g.skill)} ${partName(g.skill, g.part)}`, types: g.types.filter(ofVariant).sort() }))
    .filter((g) => g.types.length);
  const topics = [...new Set(scoped.flatMap((g) => g.topics))].sort();

  const list = useInfiniteQuery(bankQuery(f));
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total;
  const filtered = !!(f.skill || f.type || f.topic || f.source || f.q);
  // Rows arrive sorted by skill, then part: group consecutive runs under one sticky header.
  const groups: { key: string; label: string; items: BankPrompt[] }[] = [];
  for (const p of items) {
    const key = `${p.skill}${p.part}`;
    if (groups.at(-1)?.key !== key) groups.push({ key, label: `${pretty(p.skill)} · ${partName(p.skill, p.part)}${p.skill === 'writing' && f.variant ? ` ${pretty(f.variant)}` : ''}`, items: [] });
    groups.at(-1)!.items.push(p);
  }

  return (
    <>
      <PageHeader title="Prompt bank" description={total != null ? `${total.toLocaleString('en')} ${total === 1 ? 'prompt' : 'prompts'}${filtered ? ' match' : ''}` : 'Every question and task you can practise.'} />

      <div className="mb-5 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input label="Search prompts" hideLabel type="search" placeholder="Search titles and questions…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Segmented
            label="Skill"
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
              value={f.part ? `${f.part}${f.variant ? `-${f.variant}` : ''}` : 'all'}
              onChange={(v) => {
                const [part, variant] = v.split('-') as [string, Variant | undefined];
                set({ part: v === 'all' ? undefined : Number(part), variant, type: undefined, topic: undefined });
              }}
              options={PARTS[f.skill]}
            />
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:max-w-xl sm:grid-cols-3">
          <Select label="Type" hideLabel value={f.type ?? ''} onChange={(e) => set({ type: e.target.value || undefined })}>
            <option value="">All types</option>
            {typeGroups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.types.map((t) => (
                  <option key={t} value={t}>
                    {typeLabel(t)}
                  </option>
                ))}
              </optgroup>
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

      {list.isPending ? (
        <Card padded={false} aria-busy>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-line px-5 py-4 last:border-0">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
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
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label}>
              <h2 className="sticky top-0 z-10 border-b border-line bg-surface-2/95 px-4 py-2 text-xs font-medium text-muted backdrop-blur sm:px-5 [section:first-child>&]:rounded-t-card [section:not(:first-child)>&]:border-t">
                {g.label}
              </h2>
              <ul className="divide-y divide-line">
                {g.items.map((p) => {
                  // Speaking Part 1/3 titles are just the topic: show the first question under it; writing shows the task type.
                  const question = p.skill === 'speaking' ? p.body.split('\n')[0] : typeLabel(p.type);
                  return (
                    <li key={p.id}>
                      <PromptLink prompt={p} className="flex items-center gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-ink/[0.03] sm:px-5">
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 text-[0.9375rem] font-medium text-pretty">{p.title}</span>
                          <span className="mt-0.5 flex items-center gap-2 text-sm text-muted">
                            {question && question !== p.title && <span className="truncate">{question}</span>}
                            {p.source === 'cambridge' && <Badge tone="accent">{p.sourceRef ?? 'Cambridge'}</Badge>}
                            {p.done && (
                              <Badge tone="good">
                                <Check aria-hidden /> Done
                              </Badge>
                            )}
                          </span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                      </PromptLink>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </Card>
      )}
      <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
    </>
  );
}
