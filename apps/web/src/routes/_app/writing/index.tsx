import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { BarChart3, CircleCheck, Mail, PenLine, Search, Shuffle } from 'lucide-react';
import { useDeferredValue, useState, type ReactNode } from 'react';
import { listStyles, PanelHeader, RowChevron, RowIcon, rowStyles } from '@/components/bank/ListRow';
import { Alert, Badge, Button, buttonStyles, Card, EmptyState, Input, PageContainer, PageHeader, Segmented, Select, Skeleton, toast } from '@/components/ui';
import type { WritingPrompt } from '@/components/writing/PromptPanel';
import { api, call, client } from '@/lib/api';
import { ensureSession } from '@/lib/auth';
import { formatBand, formatDate, plural } from '@/lib/format';
import { GuestRecent } from '@/components/dashboard/GuestRecent';
import { QuotaNote } from '@/components/community/QuotaNote';
import { useAccount } from '@/lib/query';
import { bandColor } from '@/lib/result';
import { cn } from '@/lib/utils';
import { typeLabel } from '@/lib/writing';

export const Route = createFileRoute('/_app/writing/')({ component: WritingHome });

type Kind = 't1a' | 't1g' | 't2';
const KIND: Record<Kind, { part: 1 | 2; variant?: 'academic' | 'general'; title: string; blurb: string; meta: string; icon: ReactNode }> = {
  t1a: { part: 1, variant: 'academic', title: 'Task 1 Academic', blurb: 'Describe a chart, table, process or map', meta: '20 min, 150+ words', icon: <BarChart3 /> },
  t1g: { part: 1, variant: 'general', title: 'Task 1 General', blurb: 'Write a letter covering three points', meta: '20 min, 150+ words', icon: <Mail /> },
  t2: { part: 2, title: 'Task 2', blurb: 'Argue a position in an essay', meta: '40 min, 250+ words', icon: <PenLine /> },
};
const kindQuery = (k: Kind) => `skill=writing&part=${KIND[k].part}${KIND[k].variant ? `&variant=${KIND[k].variant}` : ''}`;

const PAGE = 15;
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
      await ensureSession(); // picking a test prompt needs a session; a guest gets theirs when they press Start
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
    <PageContainer>
      <PageHeader title="Writing" description="Timed tasks, marked against the public band descriptors with every mistake located." />

      <GuestRecent skill="writing" />
      <div className="space-y-12">
        <section aria-label="Start a task" className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <Card tone="hero" className="flex flex-col p-5 sm:p-7">
            <h2 className="type-title-sm">Full test</h2>
            <p className="type-lede mt-2 max-w-[46ch]">Task 1 and Task 2 on one 60-minute clock, as on test day. You manage your own time.</p>
            <p className="type-caption type-num mt-4">Task 1, 20 min. Task 2, 40 min. Both answers are marked together into one writing band.</p>
            <div className="mt-auto flex flex-col gap-3 pt-8 sm:flex-row sm:items-center sm:justify-between">
              <Segmented
                label="Test type"
                value={fullVariant}
                onChange={setFullVariant}
                className="sm:min-w-56"
                options={[
                  { value: 'academic', label: 'Academic' },
                  { value: 'general', label: 'General' },
                ]}
              />
              <Button size="lg" onClick={() => void start('full')} loading={starting === 'full'} disabled={!!starting && starting !== 'full'}>
                Start full test
              </Button>
            </div>
            <QuotaNote skill="writing" className="mt-3 sm:text-right" />
          </Card>

          <section aria-labelledby="one-h" className="flex flex-col">
            <PanelHeader id="one-h" title="Or practise one task" meta={<QuotaNote skill="writing" />} />
            <ul className={cn(listStyles, 'stagger flex-1')}>
              {(Object.keys(KIND) as Kind[]).map((k) => (
                <li key={k}>
                  <button type="button" onClick={() => void start(k)} disabled={!!starting} aria-busy={starting === k || undefined} className={cn(rowStyles, 'min-h-[4.75rem] disabled:opacity-50')}>
                    <RowIcon>{KIND[k].icon}</RowIcon>
                    <span className="min-w-0 flex-1">
                      <span className="type-subheading block">{KIND[k].title}</span>
                      <span className="type-lede block text-sm">{KIND[k].blurb}</span>
                      <span className="type-caption type-num block">{KIND[k].meta}</span>
                    </span>
                    <span className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 text-sm font-medium text-brand-text">
                      <Shuffle className="size-4" aria-hidden />
                      <span className="max-sm:sr-only">{starting === k ? 'Picking...' : 'Random'}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </section>

        <Recent />
        <Bank />
      </div>
    </PageContainer>
  );
}

/** The last few writing attempts with their band, so a returning learner can reopen feedback or see progress at a glance. Hidden until there is one. */
function Recent() {
  const me = useAccount();
  const target = me?.settings.targetBand ?? 7;
  const { data } = useQuery({
    enabled: !!me, // guests have no attempts
    queryKey: ['writing-recent'],
    queryFn: () => call(client.GET('/api/attempts', { params: { query: { page: 1, skill: 'writing' } } })),
  });
  const items = (data?.items ?? []).filter((a) => a.status === 'done' || a.status === 'analyzing').slice(0, 3);
  if (!items.length) return null;
  const TEXT = { good: 'text-good-text', warn: 'text-warn-text', bad: 'text-bad-text' };
  return (
    <section aria-labelledby="recent-h">
      <PanelHeader
        id="recent-h"
        title="Recent writing"
        meta={
          <Link to="/history" search={{ skill: 'writing' }} className={buttonStyles({ variant: 'link', className: 'hit' })}>
            All writing attempts
          </Link>
        }
      />
      <ul className={cn(listStyles, 'stagger')}>
        {items.map((a) => (
          <li key={a.id}>
            <Link to="/writing/result/$attemptId" params={{ attemptId: a.id }} search={{}} className={rowStyles}>
              <span className="min-w-0 flex-1">
                <span className="type-reading-sm line-clamp-1 block">{a.promptTitle}</span>
                <span className="type-caption mt-0.5 block">
                  Task {a.part}, {formatDate(a.createdAt)}
                </span>
              </span>
              {a.status === 'analyzing' ? (
                <Badge tone="accent">Scoring...</Badge>
              ) : a.overall != null ? (
                <span className={cn('type-band text-xl', TEXT[bandColor(a.overall, target)])}>
                  <span className="sr-only">Band </span>
                  {formatBand(a.overall)}
                </span>
              ) : null}
              <RowChevron />
            </Link>
          </li>
        ))}
      </ul>
    </section>
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
  // ponytail: the API pages at 30; show 15 at a time so the list stays scannable.
  const [shown, setShown] = useState(PAGE);
  const all = list.data?.pages.flatMap((p) => p.items) ?? [];
  const items = all.slice(0, shown);
  const more = all.length > shown || list.hasNextPage;
  const showMore = () => {
    if (all.length < shown + PAGE && list.hasNextPage) void list.fetchNextPage();
    setShown((n) => n + PAGE);
  };
  const total = list.data?.pages[0]?.total;

  const changeKind = (k: Kind) => {
    setKind(k);
    setType('');
    setTopic('');
  };
  // New filters → back to the first 15 (adjusting state during render, per React docs).
  const [prevParams, setPrevParams] = useState(params.toString());
  if (prevParams !== params.toString()) {
    setPrevParams(params.toString());
    setShown(PAGE);
  }

  return (
    <section aria-labelledby="bank-h">
      <PanelHeader id="bank-h" title="Choose a prompt" meta={total != null && <span className="type-num">{plural(total, 'prompt')}</span>} />

      {/* One row of 40px controls: same height, border and text size (Segmented, Select, Input share the scale). */}
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
        <Segmented
          label="Task"
          className="lg:shrink-0"
          value={kind}
          onChange={changeKind}
          options={(Object.keys(KIND) as Kind[]).map((k) => ({ value: k, label: k === 't2' ? 'Task 2' : k === 't1a' ? 'T1 Academic' : 'T1 General' }))}
        />
        <div className="grid flex-1 grid-cols-2 gap-3 lg:grid-cols-[1fr_1fr_1.4fr]">
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
          <div className="relative col-span-2 lg:col-span-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input label="Search prompts" hideLabel type="search" placeholder="Search prompts" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
        </div>
      </div>

      {list.isError ? (
        <Alert tone="bad" title="Couldn't load prompts" action={<Button size="sm" variant="outline" onClick={() => void list.refetch()}>Try again</Button>}>
          {list.error.message}
        </Alert>
      ) : list.isPending ? (
        <div className={listStyles} aria-busy>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="space-y-2 py-4">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={<Search />} title="No prompts match" action={<Button variant="outline" onClick={() => (setType(''), setTopic(''), setQ(''))}>Clear filters</Button>}>
          Try another type or topic, or clear the search.
        </EmptyState>
      ) : (
        <>
          <ul className={cn(listStyles, 'stagger', list.isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity')}>
            {items.map((p) => (
              <li key={p.id}>
                <Link to="/writing/task/$promptId" params={{ promptId: p.id }} search={{}} className={rowStyles}>
                  <span className="min-w-0 flex-1">
                    <span className="type-reading-sm line-clamp-2 block text-pretty">{p.title}</span>
                    <span className="type-caption mt-1 block">
                      {p.topic}, {typeLabel(p.type).toLowerCase()}
                    </span>
                  </span>
                  {p.done && (
                    <Badge tone="good">
                      <CircleCheck aria-hidden /> Done
                    </Badge>
                  )}
                  <RowChevron />
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex items-center justify-between gap-4">
            <p className="type-caption type-num">{total != null ? `Showing ${items.length} of ${total}` : `Showing ${items.length}`}</p>
            {more && (
              <Button variant="outline" onClick={showMore} loading={list.isFetchingNextPage}>
                Load more
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
