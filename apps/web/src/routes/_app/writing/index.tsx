import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { BarChart3, ChevronRight, CircleCheck, Mail, PenLine, Search, Timer } from 'lucide-react';
import { useDeferredValue, useState, type ReactNode } from 'react';
import { Alert, Badge, Button, Card, EmptyState, Input, PageHeader, Segmented, Select, Skeleton, toast } from '@/components/ui';
import type { WritingPrompt } from '@/components/writing/PromptPanel';
import { api } from '@/lib/api';
import { plural } from '@/lib/format';

export const Route = createFileRoute('/_app/writing/')({ component: WritingHome });

type Kind = 't1a' | 't1g' | 't2';
const KIND: Record<Kind, { part: 1 | 2; variant?: 'academic' | 'general'; title: string; blurb: string; meta: string; icon: ReactNode }> = {
  t1a: { part: 1, variant: 'academic', title: 'Task 1 Academic', blurb: 'Describe a chart, table, process or map', meta: '20 min · 150+ words', icon: <BarChart3 /> },
  t1g: { part: 1, variant: 'general', title: 'Task 1 General', blurb: 'Write a letter covering three points', meta: '20 min · 150+ words', icon: <Mail /> },
  t2: { part: 2, title: 'Task 2', blurb: 'Argue a position in an essay', meta: '40 min · 250+ words', icon: <PenLine /> },
};
const kindQuery = (k: Kind) => `skill=writing&part=${KIND[k].part}${KIND[k].variant ? `&variant=${KIND[k].variant}` : ''}`;

const TYPE_LABEL: Record<string, string> = {
  'adv-disadv': 'Advantages & disadvantages',
  'problem-solution': 'Problem & solution',
  'two-part': 'Two-part question',
  'letter-formal': 'Formal letter',
  'letter-semi': 'Semi-formal letter',
  'letter-informal': 'Informal letter',
  line: 'Line graph',
  bar: 'Bar chart',
  pie: 'Pie chart',
  mixed: 'Mixed charts',
};
const typeLabel = (t: string) => TYPE_LABEL[t] ?? t.charAt(0).toUpperCase() + t.slice(1);

type PromptPage = { items: WritingPrompt[]; total: number; page: number; pageSize: number };
type Meta = { groups: { skill: string; part: number; topics: string[]; types: string[] }[] };

const random = (k: Kind) => api.get<WritingPrompt>(`/prompts/random?${kindQuery(k)}`);

function WritingHome() {
  const navigate = useNavigate();
  const [starting, setStarting] = useState<Kind | 'full' | null>(null);
  const [fullVariant, setFullVariant] = useState<'academic' | 'general'>('academic');

  const start = async (k: Kind | 'full') => {
    setStarting(k);
    try {
      if (k === 'full') {
        const [t1, t2] = await Promise.all([random(fullVariant === 'academic' ? 't1a' : 't1g'), random('t2')]);
        await navigate({ to: '/writing/full', search: { t1: t1.id, t2: t2.id } });
      } else {
        const p = await random(k);
        await navigate({ to: '/writing/task/$promptId', params: { promptId: p.id }, search: {} });
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not start', { tone: 'bad' });
      setStarting(null);
    }
  };

  return (
    <div className="space-y-10">
      <PageHeader title="Writing" description="Timed tasks, marked against the public band descriptors with every mistake located." />

      <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <Card className="flex flex-col">
          <div className="mb-1 flex items-center gap-2 text-sm font-medium text-accent-text">
            <Timer className="size-4" aria-hidden /> Exam conditions
          </div>
          <h2 className="text-lg font-semibold">Full test</h2>
          <p className="mt-1 text-sm text-muted">Task 1 and Task 2 on one 60-minute clock, just like test day. Manage your own time.</p>
          <div className="mt-5 flex flex-1 flex-wrap items-end justify-between gap-3">
            <Segmented
              label="Test type"
              size="sm"
              value={fullVariant}
              onChange={setFullVariant}
              options={[
                { value: 'academic', label: 'Academic' },
                { value: 'general', label: 'General' },
              ]}
            />
            <Button onClick={() => void start('full')} loading={starting === 'full'} disabled={!!starting}>
              Start full test
            </Button>
          </div>
        </Card>

        <Card padded={false}>
          <ul className="divide-y divide-line">
            {(Object.keys(KIND) as Kind[]).map((k) => (
              <li key={k}>
                <button
                  type="button"
                  onClick={() => void start(k)}
                  disabled={!!starting}
                  aria-busy={starting === k || undefined}
                  className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors duration-150 first:rounded-t-card last:rounded-b-card hover:bg-ink/[0.03] disabled:opacity-60"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-control bg-surface-2 text-muted [&_svg]:size-5">{KIND[k].icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold">{KIND[k].title}</span>
                    <span className="block text-sm text-muted">
                      {KIND[k].blurb} · {KIND[k].meta}
                    </span>
                  </span>
                  <span className="text-sm font-medium text-accent-text">{starting === k ? 'Picking…' : 'Random'}</span>
                  <ChevronRight className="size-4 text-muted" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <Bank />
    </div>
  );
}

function Bank() {
  const [kind, setKind] = useState<Kind>('t2');
  const [type, setType] = useState('');
  const [topic, setTopic] = useState('');
  const [q, setQ] = useState('');
  const query = useDeferredValue(q.trim());

  const meta = useQuery({ queryKey: ['prompt-meta'], queryFn: () => api.get<Meta>('/prompts/meta'), staleTime: 5 * 60_000 });
  const group = meta.data?.groups.find((g) => g.skill === 'writing' && g.part === KIND[kind].part);
  // Task 1 types are shared across variants in the meta; letters are General, everything else Academic.
  const types = (group?.types ?? []).filter((t) => kind === 't2' || (kind === 't1g') === t.startsWith('letter'));

  const params = new URLSearchParams(kindQuery(kind));
  if (type) params.set('type', type);
  if (topic) params.set('topic', topic);
  if (query) params.set('q', query);
  const list = useInfiniteQuery({
    queryKey: ['prompts', params.toString()],
    queryFn: ({ pageParam }) => api.get<PromptPage>(`/prompts?${params}&page=${pageParam}`),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    placeholderData: keepPreviousData,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total;

  const changeKind = (k: Kind) => {
    setKind(k);
    setType('');
    setTopic('');
  };

  return (
    <section aria-labelledby="bank-h">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="bank-h" className="text-lg font-semibold">
          Choose a prompt
        </h2>
        {total != null && <p className="text-sm text-muted tabular-nums">{plural(total, 'prompt')}</p>}
      </div>

      <div className="mb-4 space-y-3">
        <Segmented
          label="Task"
          value={kind}
          onChange={changeKind}
          options={(Object.keys(KIND) as Kind[]).map((k) => ({ value: k, label: k === 't2' ? 'Task 2' : k === 't1a' ? 'T1 Academic' : 'T1 General' }))}
        />
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1.4fr]">
          <Select label="Type" hideLabel value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {typeLabel(t)}
              </option>
            ))}
          </Select>
          <Select label="Topic" hideLabel value={topic} onChange={(e) => setTopic(e.target.value)}>
            <option value="">All topics</option>
            {group?.topics.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input label="Search prompts" hideLabel type="search" placeholder="Search prompts…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
        </div>
      </div>

      {list.isError ? (
        <Alert tone="bad" title="Couldn't load prompts" action={<Button size="sm" variant="secondary" onClick={() => void list.refetch()}>Try again</Button>}>
          {list.error.message}
        </Alert>
      ) : list.isPending ? (
        <Card padded={false} className="divide-y divide-line">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="space-y-2 px-5 py-4">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))}
        </Card>
      ) : items.length === 0 ? (
        <EmptyState icon={<Search />} title="No prompts match" action={<Button variant="secondary" onClick={() => (setType(''), setTopic(''), setQ(''))}>Clear filters</Button>}>
          Try another type or topic, or clear the search.
        </EmptyState>
      ) : (
        <>
          <Card padded={false} className={list.isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            <ul className="divide-y divide-line">
              {items.map((p) => (
                <li key={p.id}>
                  <Link
                    to="/writing/task/$promptId"
                    params={{ promptId: p.id }}
                    search={{}}
                    className="flex items-center gap-4 px-5 py-4 transition-colors duration-150 first:rounded-t-card last:rounded-b-card hover:bg-ink/[0.03]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[0.9375rem] font-medium">{p.title}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                        {p.topic}
                        <span aria-hidden>·</span>
                        {typeLabel(p.type)}
                      </span>
                    </span>
                    {p.done && (
                      <Badge tone="good">
                        <CircleCheck aria-hidden /> Done
                      </Badge>
                    )}
                    <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          {list.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
