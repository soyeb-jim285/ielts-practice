import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ArrowLeft, Mail, Plus, RotateCcw, Send, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { dhakaTime } from '@/components/admin/format';
import { Load } from '@/components/admin/Load';
import { docValid, DocFields, Preview, sameDoc, type Doc } from '@/components/admin/email/DocEditor';
import { Alert, Badge, Button, Dialog, EmptyState, Input, PageContainer, Select, Tabs, toast, type Tone } from '@/components/ui';
import { useAdmin } from '@/lib/admin';
import { api, ApiError, type Schemas } from '@/lib/api';
import { cn } from '@/lib/utils';

type Template = Schemas['AdminEmailTemplate'];
type Campaign = Schemas['AdminCampaign'];
type Campaigns = Schemas['AdminCampaigns'];
type Settings = Schemas['EmailSettings'];
type Rendered = Schemas['AdminEmailRendered'];
type Audience = Campaign['audience'];
type Tab = 'account' | 'campaigns' | 'brand';

export const Route = createFileRoute('/_app/admin/emails')({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab; t?: string; c?: string } => ({
    tab: s.tab === 'campaigns' || s.tab === 'brand' ? s.tab : undefined,
    t: typeof s.t === 'string' ? s.t : undefined,
    c: typeof s.c === 'string' ? s.c : undefined,
  }),
  component: EmailsPage,
});

const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const bad = (fallback: string) => (e: unknown) => toast(errText(e, fallback), { tone: 'bad' });
const AUDIENCE: Record<Audience, string> = { all: 'Everyone', free: 'Free plan', paid: 'Paid plan' };
const STATUS: Record<Campaign['status'], { label: string; tone: Tone }> = { draft: { label: 'Draft', tone: 'neutral' }, sending: { label: 'Sending', tone: 'accent' }, sent: { label: 'Sent', tone: 'good' }, failed: { label: 'Failed', tone: 'bad' } };
const docOf = (x: { subject: string; preheader: string; blocks: Doc['blocks'] }): Doc => ({ subject: x.subject, preheader: x.preheader, blocks: x.blocks });

/** Editor on the left, live preview on the right (stacked on phones). */
const Split = ({ left, right }: { left: React.ReactNode; right: React.ReactNode }) => <div className="grid gap-8 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">{left}{right}</div>;

// ---------- Account emails ----------

function TemplateEditor({ t }: { t: Template }) {
  const qc = useQueryClient();
  const [doc, setDoc] = useState<Doc>(t.doc);
  useEffect(() => setDoc(t.doc), [t.doc]);
  const dirty = !sameDoc(doc, t.doc);
  const done = (msg: string) => (n: Template) => (qc.setQueryData(['admin', '/emails', {}], (all: Template[] | undefined) => all?.map((x) => (x.key === n.key ? n : x))), toast(msg, { tone: 'good' }));
  const save = useMutation({ mutationFn: () => api.put<Template>(`/admin/emails/${t.key}`, doc), onSuccess: done('Saved. The next email uses it.'), onError: bad('Could not save.') });
  const reset = useMutation({ mutationFn: () => api.del<Template>(`/admin/emails/${t.key}`), onSuccess: done('Back to the default.'), onError: bad('Could not reset.') });
  const test = useMutation({ mutationFn: () => api.post<{ to: string }>(`/admin/emails/${t.key}/test`, doc), onSuccess: (r) => toast(`Test sent to ${r.to}.`, { tone: 'good' }), onError: bad('Could not send the test.') });
  return (
    <Split
      left={
        <form className="space-y-5" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
          <div>
            <p className="flex flex-wrap items-center gap-2 font-medium">
              {t.name} {t.custom ? <Badge tone="accent">Edited</Badge> : <Badge>Default</Badge>}
            </p>
            <p className="type-caption mt-1">{t.description}</p>
          </div>
          <DocFields doc={doc} onChange={setDoc} vars={Object.keys(t.vars)} />
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <Button type="submit" loading={save.isPending} disabled={!dirty || !docValid(doc)}>
              Save
            </Button>
            <Button variant="outline" icon={<Send />} loading={test.isPending} disabled={!docValid(doc)} onClick={() => test.mutate()}>
              Send me a test
            </Button>
            {dirty && (
              <Button variant="ghost" onClick={() => setDoc(t.doc)}>
                Discard changes
              </Button>
            )}
            {t.custom && !dirty && (
              <Button variant="ghost" icon={<RotateCcw />} loading={reset.isPending} onClick={() => reset.mutate()}>
                Reset to default
              </Button>
            )}
          </div>
        </form>
      }
      right={<Preview doc={doc} queryKey={['t', t.key]} render={(d) => api.post<Rendered>(`/admin/emails/${t.key}/preview`, d)} />}
    />
  );
}

function AccountEmails() {
  const { t: key } = Route.useSearch();
  const navigate = Route.useNavigate();
  const q = useAdmin<Template[]>('/emails');
  return (
    <Load q={q}>
      {(all) => {
        const t = all.find((x) => x.key === key) ?? all[0]!;
        return (
          <>
            <nav aria-label="Account emails" className="mb-8 flex flex-wrap gap-2">
              {all.map((x) => (
                <button
                  key={x.key}
                  type="button"
                  aria-current={x.key === t.key ? 'page' : undefined}
                  onClick={() => void navigate({ search: (s) => ({ ...s, t: x.key }), replace: true })}
                  className={cn(
                    'inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    x.key === t.key ? 'border-brand bg-accent-soft font-medium text-accent-text' : 'border-line bg-card text-muted hover:border-input hover:text-ink',
                  )}
                >
                  {x.name}
                  {x.custom && <span aria-label="edited" className="size-1.5 rounded-full bg-brand" />}
                </button>
              ))}
            </nav>
            <TemplateEditor key={t.key} t={t} />
          </>
        );
      }}
    </Load>
  );
}

// ---------- Campaigns ----------

const BLANK: Schemas['AdminCampaignBody'] = {
  subject: 'What is new on NextBand',
  preheader: '',
  audience: 'all',
  blocks: [
    { type: 'hero', eyebrow: 'Product news', title: 'A clear headline', subtitle: '', tone: 'brand' },
    { type: 'text', text: 'Hi {{firstName}},\n\nWrite your message here.' },
    { type: 'button', label: 'Open NextBand', url: '/', variant: 'solid' },
  ],
};

function CampaignEditor({ c, data, onBack }: { c: Campaign; data: Campaigns; onBack: () => void }) {
  const qc = useQueryClient();
  const [doc, setDoc] = useState<Doc>(docOf(c));
  const [audience, setAudience] = useState<Audience>(c.audience);
  const [confirm, setConfirm] = useState(false);
  const editable = c.status === 'draft';
  const dirty = !sameDoc(doc, docOf(c)) || audience !== c.audience;
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', '/campaigns'] });
  const save = useMutation({ mutationFn: () => api.put<Campaign>(`/admin/campaigns/${c.id}`, { ...doc, audience }), onSuccess: () => (refresh(), toast('Draft saved.', { tone: 'good' })), onError: bad('Could not save.') });
  const test = useMutation({ mutationFn: () => api.post<{ to: string }>('/admin/campaigns/test', doc), onSuccess: (r) => toast(`Test sent to ${r.to}.`, { tone: 'good' }), onError: bad('Could not send the test.') });
  const remove = useMutation({ mutationFn: () => api.del(`/admin/campaigns/${c.id}`), onSuccess: () => (refresh(), onBack()), onError: bad('Could not delete.') });
  const send = useMutation({
    mutationFn: async () => {
      if (dirty) await api.put<Campaign>(`/admin/campaigns/${c.id}`, { ...doc, audience });
      return api.post<Campaign>(`/admin/campaigns/${c.id}/send`);
    },
    onSuccess: () => (setConfirm(false), refresh(), toast('Sending. Progress shows in the list.', { tone: 'good' })),
    onError: bad('Could not send.'),
  });
  const reach = data.audience[audience];
  return (
    <>
      <Button variant="link" className="hit mb-4" icon={<ArrowLeft />} onClick={onBack}>
        All campaigns
      </Button>
      <Split
        left={
          <form className="space-y-5" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
              {c.status !== 'draft' && (
                <span className="type-caption type-num">
                  {c.sent} of {c.recipients} sent{c.failed ? `, ${c.failed} failed` : ''}
                  {c.sentAt && `, ${dhakaTime(c.sentAt)}`}
                </span>
              )}
            </div>
            <Select label="Send to" value={audience} disabled={!editable} onChange={(e) => setAudience(e.target.value as Audience)} hint="Verified accounts with product emails on.">
              {(Object.keys(AUDIENCE) as Audience[]).map((a) => (
                <option key={a} value={a}>
                  {AUDIENCE[a]} ({data.audience[a]})
                </option>
              ))}
            </Select>
            <DocFields doc={doc} onChange={setDoc} vars={Object.keys(data.vars)} disabled={!editable} />
            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              {editable && (
                <>
                  <Button type="submit" variant="outline" loading={save.isPending} disabled={!dirty || !docValid(doc)}>
                    Save draft
                  </Button>
                  <Button icon={<Mail />} disabled={!docValid(doc) || reach === 0} onClick={() => setConfirm(true)}>
                    Send to {reach} {reach === 1 ? 'person' : 'people'}
                  </Button>
                </>
              )}
              <Button variant="ghost" icon={<Send />} loading={test.isPending} disabled={!docValid(doc)} onClick={() => test.mutate()}>
                Send me a test
              </Button>
              {editable && (
                <Button variant="ghost" icon={<Trash2 />} loading={remove.isPending} onClick={() => remove.mutate()}>
                  Delete draft
                </Button>
              )}
            </div>
          </form>
        }
        right={<Preview doc={doc} queryKey={['c', c.id]} render={(d) => api.post<Rendered>('/admin/campaigns/preview', d)} />}
      />
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Send to ${reach} ${reach === 1 ? 'person' : 'people'}?`}
        description={`"${doc.subject}" goes to ${AUDIENCE[audience].toLowerCase()} now. It cannot be unsent.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button loading={send.isPending} onClick={() => send.mutate()}>
              Send now
            </Button>
          </>
        }
      />
    </>
  );
}

function CampaignsTab() {
  const { c: openId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const q = useAdmin<Campaigns>('/campaigns', {}, { refetchInterval: 5000 });
  const open = (id?: string) => void navigate({ search: (s) => ({ ...s, c: id }), replace: !id });
  const create = useMutation({
    mutationFn: () => api.post<Campaign>('/admin/campaigns', BLANK),
    onSuccess: (n) => (qc.invalidateQueries({ queryKey: ['admin', '/campaigns'] }), open(n.id)),
    onError: bad('Could not create a draft.'),
  });
  return (
    <Load q={q}>
      {(d) => {
        const c = openId ? d.campaigns.find((x) => x.id === openId) : undefined;
        if (c) return <CampaignEditor key={c.id} c={c} data={d} onBack={() => open()} />;
        return (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="type-caption type-num">
                Reaches {d.audience.all} {d.audience.all === 1 ? 'account' : 'accounts'} now ({d.audience.free} free, {d.audience.paid} paid). Everyone gets their own unsubscribe link.
              </p>
              <Button icon={<Plus />} loading={create.isPending} onClick={() => create.mutate()}>
                New campaign
              </Button>
            </div>
            {d.campaigns.length ? (
              <ul className="divide-y divide-line border-y border-line">
                {d.campaigns.map((x) => (
                  <li key={x.id}>
                    <button type="button" onClick={() => open(x.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 py-4 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                      <Badge tone={STATUS[x.status].tone}>{STATUS[x.status].label}</Badge>
                      <span className="min-w-0 flex-1 truncate font-medium">{x.subject}</span>
                      <span className="type-caption type-num">
                        {AUDIENCE[x.audience]}
                        {x.status === 'draft' ? '' : `, ${x.sent}/${x.recipients} sent`}, {dhakaTime(x.sentAt ?? x.createdAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<Mail />} title="No campaigns yet">
                Announce new tests, share tips or bring people back. Drafts stay private until you send them.
              </EmptyState>
            )}
          </div>
        );
      }}
    </Load>
  );
}

// ---------- Brand and footer ----------

const SOCIAL: { key: keyof Settings['social']; label: string }[] = [
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'x', label: 'X' },
  { key: 'tiktok', label: 'TikTok' },
];

function BrandForm({ s }: { s: Settings }) {
  const qc = useQueryClient();
  const [v, setV] = useState(s);
  const dirty = JSON.stringify(v) !== JSON.stringify(s);
  const save = useMutation({
    mutationFn: () => api.put<Settings>('/admin/email-settings', v),
    onSuccess: (n) => (qc.setQueryData(['admin', '/email-settings', {}], n), qc.invalidateQueries({ queryKey: ['admin', 'email-preview'] }), toast('Saved. Every email uses it now.', { tone: 'good' })),
    onError: bad('Could not save.'),
  });
  return (
    <form className="max-w-xl space-y-5" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
      {!v.address.trim() && <Alert tone="warn" title="Add a postal address before sending campaigns">Anti-spam laws (and Gmail) expect promotional emails to show where the sender is.</Alert>}
      <Input label="Name in emails" value={v.company} maxLength={80} required onChange={(e) => setV({ ...v, company: e.target.value })} />
      <Input label="Postal address" hint="Shown in every footer." value={v.address} maxLength={300} onChange={(e) => setV({ ...v, address: e.target.value })} />
      <Input label="Support email" hint="Adds a Help link to the footer." type="email" value={v.supportEmail} maxLength={200} onChange={(e) => setV({ ...v, supportEmail: e.target.value })} />
      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-medium">Social links</legend>
        <p className="type-caption -mt-1">Only filled ones show, as icons in the footer.</p>
        {SOCIAL.map(({ key, label }) => (
          <Input key={key} label={label} type="url" placeholder="https://" value={v.social[key]} maxLength={500} onChange={(e) => setV({ ...v, social: { ...v.social, [key]: e.target.value } })} />
        ))}
      </fieldset>
      <Button type="submit" loading={save.isPending} disabled={!dirty || !v.company.trim()}>
        Save
      </Button>
    </form>
  );
}

function BrandTab() {
  const q = useAdmin<Settings>('/email-settings');
  return <Load q={q}>{(s) => <BrandForm s={s} />}</Load>;
}

function EmailsPage() {
  const { tab = 'account' } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PageContainer>
      <AdminHeader title="Emails" description="Everything NextBand sends. Build each email from blocks; the logo, header and footer stay the same everywhere." />
      <Tabs<Tab>
        id="email-sections"
        value={tab}
        onChange={(v) => void navigate({ search: { tab: v === 'account' ? undefined : v } })}
        items={[
          { value: 'account', label: 'Account emails' },
          { value: 'campaigns', label: 'Campaigns' },
          { value: 'brand', label: 'Brand and footer' },
        ]}
        className="mb-8"
      />
      {tab === 'account' ? <AccountEmails /> : tab === 'campaigns' ? <CampaignsTab /> : <BrandTab />}
    </PageContainer>
  );
}
