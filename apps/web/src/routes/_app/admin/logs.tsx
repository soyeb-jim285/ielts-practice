import { createFileRoute } from '@tanstack/react-router';
import { ScrollText, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { stageLabel, usdFine } from '@/components/admin/cost';
import { dhakaTime } from '@/components/admin/format';
import { JsonView, parseJsonString } from '@/components/admin/JsonView';
import { Load } from '@/components/admin/Load';
import { Pager } from '@/components/admin/Pager';
import { DataTable } from '@/components/admin/Table';
import { Badge, Chip, EmptyState, PageContainer, Segmented, Select, Sheet, Skeleton } from '@/components/ui';
import { useAdmin } from '@/lib/admin';

type Item = {
  id: string; createdAt: string; stage: string; path: string; model: string | null; served: string | null; ok: boolean; status: number | null; latencyMs: number;
  costUsd: number | null; userId: string | null; userLabel: string | null; attemptId: string | null; sessionId: string | null; preview: string;
};
type Detail = Item & { request: unknown; response: unknown; error: string | null };
type PageData = { items: Item[]; page: number; pageSize: number; total: number; stages: string[]; models: string[] };
type Search = { stage?: string; model?: string; outcome?: 'failed'; attempt?: string; user?: string; page?: number; log?: string };

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
export const Route = createFileRoute('/_app/admin/logs')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    stage: str(s.stage), model: str(s.model), outcome: s.outcome === 'failed' ? 'failed' : undefined, attempt: str(s.attempt), user: str(s.user),
    page: Number(s.page) > 1 ? Math.floor(Number(s.page)) : undefined, log: str(s.log),
  }),
  component: LogsPage,
});

const ENDPOINT: Record<string, string> = { '/chat/completions': 'Chat', '/audio/transcriptions': 'Transcription', '/systemone': 'Jev decision', '/audio/speech': 'Speech' };
const secs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

function LogsPage() {
  const s = Route.useSearch();
  const navigate = Route.useNavigate();
  const set = (p: Partial<Search>) => void navigate({ search: (cur) => ({ ...cur, page: undefined, ...p }) });
  const q = useAdmin<PageData>('/logs', { stage: s.stage, model: s.model, outcome: s.outcome ?? 'all', attempt: s.attempt, user: s.user, page: s.page ?? 1, pageSize: 50 });
  return (
    <PageContainer>
      <AdminHeader title="AI logs" description="Every AI call of the last 14 days with its full input and output. Open a row to read it." />
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <Select label="Stage" value={s.stage ?? ''} onChange={(e) => set({ stage: e.target.value || undefined })} className="min-w-44">
          <option value="">All stages</option>
          {q.data?.stages.map((v) => <option key={v} value={v}>{stageLabel(v)}</option>)}
        </Select>
        <Select label="Model" value={s.model ?? ''} onChange={(e) => set({ model: e.target.value || undefined })} className="min-w-56">
          <option value="">All models</option>
          {q.data?.models.map((v) => <option key={v} value={v}>{v}</option>)}
        </Select>
        <Segmented label="Outcome" value={s.outcome ?? 'all'} onChange={(v) => set({ outcome: v === 'failed' ? 'failed' : undefined })} options={[{ value: 'all', label: 'All' }, { value: 'failed', label: 'Failed' }]} />
        {s.attempt && <Chip selected onClick={() => set({ attempt: undefined })} aria-label="Clear the attempt filter">Attempt {s.attempt.slice(0, 8)} <X className="size-3" aria-hidden /></Chip>}
        {s.user && <Chip selected onClick={() => set({ user: undefined })} aria-label="Clear the user filter">User {s.user.slice(0, 8)} <X className="size-3" aria-hidden /></Chip>}
      </div>
      <Load q={q}>
        {(d) =>
          d.items.length ? (
            <>
              <DataTable<Item>
                label="AI calls"
                dense
                rows={d.items}
                rowKey={(r) => r.id}
                cols={[
                  {
                    head: 'When',
                    cell: (r) => (
                      <button type="button" className="text-left text-accent-text underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-brand" onClick={() => void navigate({ search: (cur) => ({ ...cur, log: r.id }) })}>
                        <span className="type-num whitespace-nowrap">{dhakaTime(r.createdAt)}</span>
                      </button>
                    ),
                  },
                  { head: 'Stage', cell: (r) => <span className="whitespace-nowrap">{stageLabel(r.stage)}</span> },
                  { head: 'Model', cell: (r) => <span className="block max-w-56 truncate" title={`${r.model ?? ''}${r.served ? ` via ${r.served}` : ''}`}>{r.model ?? ENDPOINT[r.path] ?? r.path}</span> },
                  { head: 'Result', cell: (r) => <Badge tone={r.ok ? 'good' : 'bad'}>{r.ok ? 'OK' : r.status ? `Failed ${r.status}` : 'Failed'}</Badge> },
                  { head: 'Time', cell: (r) => <span className="type-num whitespace-nowrap">{secs(r.latencyMs)}</span>, className: 'text-right' },
                  { head: 'Cost', cell: (r) => <span className="type-num">{r.costUsd == null ? '-' : usdFine(r.costUsd)}</span>, className: 'text-right' },
                  { head: 'User', cell: (r) => (r.userId ? <button type="button" className="max-w-40 truncate text-left underline-offset-4 hover:underline" onClick={() => set({ user: r.userId! })}>{r.userLabel ?? r.userId.slice(0, 8)}</button> : <span className="text-muted">-</span>) },
                  { head: 'Output', cell: (r) => <span className={`line-clamp-2 break-words ${r.ok ? 'text-muted' : 'text-bad-text'}`}>{r.preview || '-'}</span>, className: 'min-w-64 w-full' },
                ]}
              />
              <div className="mt-4">
                <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(p) => void navigate({ search: (cur) => ({ ...cur, page: p > 1 ? p : undefined }) })} />
              </div>
            </>
          ) : (
            <EmptyState icon={<ScrollText />} title="No AI calls">Nothing matches these filters in the last 14 days.</EmptyState>
          )
        }
      </Load>
      <Sheet open={!!s.log} onClose={() => void navigate({ search: (cur) => ({ ...cur, log: undefined }) })} title="AI call" className="md:w-[min(64rem,94vw)]">
        {s.log && <LogDetail id={s.log} onFilter={set} />}
      </Sheet>
    </PageContainer>
  );
}

function LogDetail({ id, onFilter }: { id: string; onFilter: (p: Partial<Search>) => void }) {
  const q = useAdmin<Detail>(`/logs/${id}`);
  if (!q.data) return q.isError ? <p className="text-sm text-bad-text">Couldn't load this call.</p> : <Skeleton className="h-64" />;
  const d = q.data;
  return (
    <div className="space-y-5 pb-6">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        {(
          [
            ['When', dhakaTime(d.createdAt)],
            ['Stage', stageLabel(d.stage)],
            ['Endpoint', ENDPOINT[d.path] ?? d.path],
            ['Model', d.model ?? '-'],
            ['Answered by', d.served ?? '-'],
            ['Result', <Badge key="r" tone={d.ok ? 'good' : 'bad'}>{d.ok ? `OK ${d.status ?? ''}` : `Failed ${d.status ?? ''}`}</Badge>],
            ['Time', secs(d.latencyMs)],
            ['Cost', d.costUsd == null ? 'not reported' : usdFine(d.costUsd)],
            ['User', d.userId ? d.userLabel ?? d.userId : '-'],
          ] as [string, ReactNode][]
        ).map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="type-caption">{k}</dt>
            <dd className="truncate font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {d.attemptId && (
        <p className="text-sm">
          Attempt <code className="font-mono">{d.attemptId.slice(0, 8)}</code> ·{' '}
          <button type="button" className="text-accent-text underline-offset-4 hover:underline" onClick={() => onFilter({ attempt: d.attemptId!, log: undefined })}>
            all calls of this attempt
          </button>
        </p>
      )}
      {d.error && (
        <section>
          <h3 className="type-h5 mb-2">Error</h3>
          <JsonView value={parseJsonString(d.error) ?? d.error} />
        </section>
      )}
      <Readable d={d} />
      <details className="rounded-md border border-line p-3">
        <summary className="cursor-pointer font-medium">Full request</summary>
        <JsonView value={d.request} open={3} className="mt-3" />
      </details>
      {d.response != null && (
        <details className="rounded-md border border-line p-3">
          <summary className="cursor-pointer font-medium">Full response</summary>
          <JsonView value={d.response} open={3} className="mt-3" />
        </details>
      )}
    </div>
  );
}

type Msg = { role: string; content: string | { type: string; text?: string; input_audio?: { data?: string; format?: string } }[] };
const ROLE: Record<string, { label: string; tone: 'neutral' | 'accent' | 'info' }> = { system: { label: 'System prompt', tone: 'neutral' }, user: { label: 'Input', tone: 'info' }, assistant: { label: 'Assistant', tone: 'accent' } };

/** Text, or the structure when the text is JSON. */
function Content({ text }: { text: string }) {
  const j = parseJsonString(text);
  return j !== undefined ? <JsonView value={j} /> : <p className="rounded-md border border-line bg-surface-2 p-3 text-sm leading-relaxed break-words whitespace-pre-wrap">{text}</p>;
}

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h3 className="type-h5 mb-2 flex items-center gap-2">{title}</h3>
      {children}
    </section>
  );
}

/** The call as a person reads it: the prompt messages and the output for chats, state/questions/answers for Jev, the transcript for STT. */
function Readable({ d }: { d: Detail }) {
  const req = (d.request ?? {}) as Record<string, unknown>, res = (d.response ?? {}) as Record<string, unknown>;
  if (d.path === '/chat/completions') {
    const msgs = (req.messages as Msg[] | undefined) ?? [];
    const out = (res.choices as { message?: { content?: string | null; reasoning?: string } }[] | undefined)?.[0]?.message;
    const usage = res.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    return (
      <>
        {msgs.map((m, i) => {
          const r = ROLE[m.role] ?? { label: m.role, tone: 'neutral' as const };
          const body =
            typeof m.content === 'string' ? (
              <Content text={m.content} />
            ) : (
              <div className="space-y-2">
                {m.content.map((p, k) => (p.type === 'text' && p.text ? <Content key={k} text={p.text} /> : <p key={k} className="type-caption">[{p.type}{p.input_audio ? `: ${p.input_audio.format ?? ''} ${p.input_audio.data ?? ''}` : ''}]</p>))}
              </div>
            );
          return (
            <Section key={i} title={<Badge tone={r.tone}>{r.label}</Badge>}>
              {m.role === 'system' && typeof m.content === 'string' && m.content.length > 1200 ? (
                <details>
                  <summary className="cursor-pointer text-sm text-muted">{m.content.length.toLocaleString('en-GB')} characters, show</summary>
                  <div className="mt-2">{body}</div>
                </details>
              ) : (
                body
              )}
            </Section>
          );
        })}
        {out && (
          <Section title={<><Badge tone="good">Output</Badge>{usage && <span className="type-caption font-normal">{usage.prompt_tokens} in · {usage.completion_tokens} out tokens</span>}</>}>
            {out.reasoning && (
              <details className="mb-2">
                <summary className="cursor-pointer text-sm text-muted">Reasoning</summary>
                <p className="mt-2 text-sm whitespace-pre-wrap text-muted">{out.reasoning}</p>
              </details>
            )}
            {out.content ? <Content text={out.content} /> : <p className="text-sm text-muted">(no content)</p>}
          </Section>
        )}
      </>
    );
  }
  if (d.path === '/systemone') {
    const { usage: _u, ...answers } = res;
    return (
      <>
        <Section title={<Badge tone="info">State</Badge>}><JsonView value={req.state} open={3} /></Section>
        <Section title={<Badge tone="neutral">Questions</Badge>}><JsonView value={req.questions} open={2} /></Section>
        {d.ok && <Section title={<Badge tone="good">Answers</Badge>}><JsonView value={answers} open={3} /></Section>}
      </>
    );
  }
  if (d.path === '/audio/transcriptions') {
    const words = (res.words as unknown[] | undefined)?.length;
    return (
      <>
        <Section title={<Badge tone="info">Input</Badge>}>
          <JsonView value={Object.fromEntries(Object.entries(req).filter(([k]) => k !== 'timestamp_granularities'))} open={2} />
        </Section>
        {d.ok && (
          <Section title={<><Badge tone="good">Transcript</Badge><span className="type-caption font-normal">{words ?? 0} timed words{typeof res.duration === 'number' ? ` · ${res.duration.toFixed(1)} s audio` : ''}</span></>}>
            <Content text={String(res.text ?? '')} />
          </Section>
        )}
      </>
    );
  }
  if (d.path === '/audio/speech') return <Section title={<Badge tone="info">Text spoken</Badge>}><Content text={String(req.input ?? '')} /></Section>;
  return null;
}
