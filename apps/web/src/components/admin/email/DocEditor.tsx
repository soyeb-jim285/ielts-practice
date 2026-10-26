import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Monitor, Plus, Smartphone, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Input, Segmented, Select, Textarea } from '@/components/ui';
import type { Schemas } from '@/lib/api';
import { cn } from '@/lib/utils';

export type Doc = Schemas['EmailDoc'];
export type Block = Schemas['EmailBlock'];
type Rendered = Schemas['AdminEmailRendered'];
type Of<T extends Block['type']> = Extract<Block, { type: T }>;

const NAMES: Record<Block['type'], string> = { hero: 'Banner', text: 'Text', button: 'Button', code: 'Code box', details: 'Details table', stats: 'Stat cards', callout: 'Callout', image: 'Image', divider: 'Divider' };
const NEW: { [K in Block['type']]: Of<K> } = {
  hero: { type: 'hero', eyebrow: '', title: 'A clear headline', subtitle: '', tone: 'brand' },
  text: { type: 'text', text: '' },
  button: { type: 'button', label: 'Open NextBand', url: '/', variant: 'solid' },
  code: { type: 'code', value: '{{code}}' },
  details: { type: 'details', title: '', rows: [{ label: '', value: '' }] },
  stats: { type: 'stats', items: [{ value: '', label: '', change: '', trend: 'none' }] },
  callout: { type: 'callout', tone: 'info', title: '', text: '' },
  image: { type: 'image', src: '', alt: '', href: '' },
  divider: { type: 'divider' },
};

export const sameDoc = (a: Doc, b: Doc) => JSON.stringify(a) === JSON.stringify(b);
export const docValid = (d: Doc) => !!d.subject.trim() && d.blocks.length > 0;

/** Debounced value: the preview re-renders 350 ms after typing stops. */
function useDebounced<T>(v: T, ms = 350) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

const Sub = ({ children }: { children: ReactNode }) => <div className="grid gap-3 sm:grid-cols-2">{children}</div>;

/** Rows of a list field (details rows, stat cards): edit, add, remove. */
function Rows<T>({ items, onChange, blank, max, label, render }: { items: T[]; onChange: (v: T[]) => void; blank: T; max: number; label: string; render: (t: T, set: (p: Partial<T>) => void) => ReactNode }) {
  return (
    <div className="space-y-3">
      {items.map((t, i) => (
        <div key={i} className="flex items-end gap-2">
          <div className="min-w-0 flex-1">{render(t, (p) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x))))}</div>
          <Button variant="ghost" size="icon-sm" aria-label={`Remove ${label} ${i + 1}`} disabled={items.length === 1} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <Trash2 />
          </Button>
        </div>
      ))}
      {items.length < max && (
        <Button variant="ghost" size="sm" icon={<Plus />} onClick={() => onChange([...items, blank])}>
          Add {label}
        </Button>
      )}
    </div>
  );
}

function Fields({ b, set }: { b: Block; set: (b: Block) => void }) {
  const up = <T extends Block>(p: Partial<T>) => set({ ...b, ...p } as Block);
  switch (b.type) {
    case 'hero':
      return (
        <div className="space-y-3">
          <Input label="Headline" value={b.title} maxLength={200} onChange={(e) => up<Of<'hero'>>({ title: e.target.value })} />
          <Sub>
            <Input label="Label above" hint="Small caps line, optional." value={b.eyebrow} maxLength={80} onChange={(e) => up<Of<'hero'>>({ eyebrow: e.target.value })} />
            <Select label="Colour" value={b.tone} onChange={(e) => up<Of<'hero'>>({ tone: e.target.value as Of<'hero'>['tone'] })}>
              <option value="brand">Teal</option>
              <option value="ink">Navy</option>
              <option value="soft">Light teal</option>
            </Select>
          </Sub>
          <Input label="Strip below" hint="A darker band under the headline, optional (a date, an account)." value={b.subtitle} maxLength={200} onChange={(e) => up<Of<'hero'>>({ subtitle: e.target.value })} />
        </div>
      );
    case 'text':
      return <Textarea label="Text" hideLabel rows={6} className="font-mono text-sm" value={b.text} maxLength={8000} onChange={(e) => up<Of<'text'>>({ text: e.target.value })} hint="Markdown: **bold**, [link](https://…), - bullets, ## heading, | tables |." />;
    case 'button':
      return (
        <Sub>
          <Input label="Label" value={b.label} maxLength={60} onChange={(e) => up<Of<'button'>>({ label: e.target.value })} />
          <Input label="Link" hint="A page like /writing, or a full URL." value={b.url} maxLength={500} onChange={(e) => up<Of<'button'>>({ url: e.target.value })} />
          <Select label="Style" value={b.variant} onChange={(e) => up<Of<'button'>>({ variant: e.target.value as Of<'button'>['variant'] })}>
            <option value="solid">Filled</option>
            <option value="outline">Outline</option>
          </Select>
        </Sub>
      );
    case 'code':
      return <Input label="Code" hint="Usually {{code}}." value={b.value} maxLength={40} onChange={(e) => up<Of<'code'>>({ value: e.target.value })} />;
    case 'details':
      return (
        <div className="space-y-3">
          <Input label="Title above" hint="Optional." value={b.title} maxLength={120} onChange={(e) => up<Of<'details'>>({ title: e.target.value })} />
          <Rows
            label="row"
            max={20}
            items={b.rows}
            blank={{ label: '', value: '' }}
            onChange={(rows) => up<Of<'details'>>({ rows })}
            render={(r, s) => (
              <Sub>
                <Input label="Label" value={r.label} maxLength={80} onChange={(e) => s({ label: e.target.value })} />
                <Input label="Value" value={r.value} maxLength={200} onChange={(e) => s({ value: e.target.value })} />
              </Sub>
            )}
          />
        </div>
      );
    case 'stats':
      return (
        <Rows
          label="card"
          max={6}
          items={b.items}
          blank={{ value: '', label: '', change: '', trend: 'none' as const }}
          onChange={(items) => up<Of<'stats'>>({ items })}
          render={(r, s) => (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Input label="Number" value={r.value} maxLength={30} onChange={(e) => s({ value: e.target.value })} />
              <Input label="Label" value={r.label} maxLength={60} onChange={(e) => s({ label: e.target.value })} />
              <Input label="Change" hint="e.g. 12%" value={r.change} maxLength={20} onChange={(e) => s({ change: e.target.value })} />
              <Select label="Trend" value={r.trend} onChange={(e) => s({ trend: e.target.value as typeof r.trend })}>
                <option value="none">None</option>
                <option value="up">Up (green)</option>
                <option value="down">Down (red)</option>
              </Select>
            </div>
          )}
        />
      );
    case 'callout':
      return (
        <div className="space-y-3">
          <Sub>
            <Input label="Title" value={b.title} maxLength={120} onChange={(e) => up<Of<'callout'>>({ title: e.target.value })} />
            <Select label="Kind" value={b.tone} onChange={(e) => up<Of<'callout'>>({ tone: e.target.value as Of<'callout'>['tone'] })}>
              <option value="info">Information (blue)</option>
              <option value="good">Good news (green)</option>
              <option value="warn">Heads up (amber)</option>
            </Select>
          </Sub>
          <Textarea label="Text" rows={3} value={b.text} maxLength={2000} onChange={(e) => up<Of<'callout'>>({ text: e.target.value })} />
        </div>
      );
    case 'image':
      return (
        <div className="space-y-3">
          <Input label="Image URL" hint="A public https:// image, 1000 px wide or more for sharp phones." value={b.src} maxLength={500} onChange={(e) => up<Of<'image'>>({ src: e.target.value })} />
          <Sub>
            <Input label="Description" hint="Read aloud and shown when images are off." value={b.alt} maxLength={200} onChange={(e) => up<Of<'image'>>({ alt: e.target.value })} />
            <Input label="Link" hint="Optional." value={b.href} maxLength={500} onChange={(e) => up<Of<'image'>>({ href: e.target.value })} />
          </Sub>
        </div>
      );
    case 'divider':
      return <p className="type-caption">A thin line between sections.</p>;
  }
}

/** Subject, preview text and the block list. `vars` are the {{placeholders}} this email can use. */
export function DocFields({ doc, onChange, vars, disabled }: { doc: Doc; onChange: (d: Doc) => void; vars: string[]; disabled?: boolean }) {
  const blocks = doc.blocks;
  const setBlocks = (b: Block[]) => onChange({ ...doc, blocks: b });
  const move = (i: number, d: -1 | 1) => {
    const b = [...blocks];
    [b[i], b[i + d]] = [b[i + d]!, b[i]!];
    setBlocks(b);
  };
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-4">
      <Input label="Subject" value={doc.subject} maxLength={200} required onChange={(e) => onChange({ ...doc, subject: e.target.value })} />
      <Input label="Preview text" hint="The grey line inboxes show after the subject." value={doc.preheader} maxLength={200} onChange={(e) => onChange({ ...doc, preheader: e.target.value })} />
      {vars.length > 0 && (
        <div>
          <p className="type-caption mb-1.5">Placeholders, filled for each person</p>
          <div className="flex flex-wrap gap-1.5">
            {vars.map((v) => (
              <code key={v} className="rounded border border-line bg-card px-1.5 py-0.5 text-xs">{`{{${v}}}`}</code>
            ))}
          </div>
        </div>
      )}
      <ol className="space-y-3" aria-label="Blocks">
        {blocks.map((b, i) => (
          <li key={i} className="rounded-lg border border-line bg-card">
            <div className="flex items-center gap-1 border-b border-line py-1 pr-1 pl-3">
              <span className="type-caption flex-1 font-medium text-ink">
                {i + 1}. {NAMES[b.type]}
              </span>
              <Button variant="ghost" size="icon-sm" aria-label={`Move ${NAMES[b.type]} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label={`Move ${NAMES[b.type]} down`} disabled={i === blocks.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label={`Remove ${NAMES[b.type]}`} disabled={blocks.length === 1} onClick={() => setBlocks(blocks.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            </div>
            <div className="p-3">
              <Fields b={b} set={(nb) => setBlocks(blocks.map((x, j) => (j === i ? nb : x)))} />
            </div>
          </li>
        ))}
      </ol>
      {blocks.length < 40 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" icon={<Plus />}>
              Add a block
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-48">
            {(Object.keys(NEW) as Block['type'][]).map((t) => (
              <DropdownMenuItem key={t} className="h-9" onSelect={() => setBlocks([...blocks, structuredClone(NEW[t])])}>
                {NAMES[t]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </fieldset>
  );
}

/** Live preview of `doc`, rendered by the server exactly as it will be sent. */
export function Preview({ doc, render, queryKey }: { doc: Doc; render: (d: Doc) => Promise<Rendered>; queryKey: unknown[] }) {
  const [width, setWidth] = useState<'desktop' | 'mobile'>('desktop');
  const draft = useDebounced(doc);
  const q = useQuery({ queryKey: ['admin', 'email-preview', ...queryKey, draft], queryFn: () => render(draft), enabled: docValid(draft), placeholderData: (p) => p });
  return (
    <section aria-label="Preview" className="min-w-0 lg:sticky lg:top-6 lg:self-start">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-sm">
          <p className="type-caption">Subject</p>
          <p className="truncate font-medium">{q.data?.subject ?? doc.subject}</p>
        </div>
        <Segmented
          size="sm"
          label="Preview width"
          value={width}
          onChange={setWidth}
          options={[
            { value: 'desktop', label: <span className="inline-flex items-center gap-1.5"><Monitor className="size-3.5" aria-hidden />Desktop</span> },
            { value: 'mobile', label: <span className="inline-flex items-center gap-1.5"><Smartphone className="size-3.5" aria-hidden />Phone</span> },
          ]}
        />
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-[#eef2f6]">
        {q.data ? (
          <iframe title="Email preview" srcDoc={q.data.html} sandbox="allow-popups" className={cn('mx-auto block h-[calc(100vh-10rem)] min-h-[560px] w-full bg-[#eef2f6] transition-[max-width] duration-200', width === 'mobile' && 'max-w-[375px] border-x border-line')} />
        ) : (
          <p className="grid h-[560px] place-items-center text-sm text-muted">{q.isError ? 'Could not render the preview.' : 'Rendering…'}</p>
        )}
      </div>
      <p className="type-caption mt-2">Sample values fill the placeholders. Images load from the live site.</p>
    </section>
  );
}
