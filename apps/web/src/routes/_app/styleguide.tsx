import { createFileRoute } from '@tanstack/react-router';
import { ArrowRight, Bell, Check, ChevronRight, Ellipsis, History, House, Layers, LibraryBig, Mic, PenLine, Plus, RotateCcw, Search, Settings, Trash2, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import {
  Alert,
  Badge,
  Button,
  Card,
  Chip,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Combobox,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  GhostList,
  IconTile,
  InfoTip,
  Input,
  Kbd,
  PageContainer,
  PageHeader,
  Popover,
  ProgressBar,
  ProgressRing,
  Segmented,
  Select,
  Sheet,
  Skeleton,
  Slider,
  Stat,
  Switch,
  Tabs,
  Textarea,
  toast,
  Tooltip,
  type Tone,
} from '@/components/ui';
import pairs from '@/lib/contrastPairs.json';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_app/styleguide')({ component: Styleguide });

/* ---------- helpers ---------- */

const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex: string) => {
  const n = parseInt(hex.slice(1, 7), 16);
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

/** Reads a raw token from :root and re-reads when the theme class on <html> flips. */
function useToken() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const mo = new MutationObserver(() => setTick((t) => t + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (name: string) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim(), [tick]);
}

const SECTIONS = [
  ['colour', 'Colour'],
  ['type', 'Typography'],
  ['shape', 'Space, radius, elevation'],
  ['buttons', 'Buttons'],
  ['forms', 'Forms'],
  ['feedback', 'Badges and alerts'],
  ['nav', 'Navigation controls'],
  ['overlays', 'Overlays'],
  ['data', 'Cards and data'],
  ['states', 'States'],
  ['motion', 'Motion'],
  ['layout', 'Layout'],
  ['icons', 'Icons'],
  ['rules', 'Do and do not'],
] as const;

function Section({ id, title, lead, children }: { id: string; title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} data-sg-section className="scroll-mt-6 border-t border-line pt-10 first:border-t-0 first:pt-0">
      <h2 className="type-heading">{title}</h2>
      {lead && <p className="mt-1.5 max-w-[62ch] text-muted">{lead}</p>}
      <div className="mt-6 space-y-8">{children}</div>
    </section>
  );
}

/** A labelled specimen: small title + note, then the live component on a surface. */
function Spec({ title, note, children, className }: { title: string; note?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div>
      <div className="mb-2.5 flex flex-wrap items-baseline gap-x-3">
        <h3 className="type-subheading">{title}</h3>
        {note && <p className="type-caption">{note}</p>}
      </div>
      <div className={cn('rounded-lg border border-line bg-surface p-5', className)}>{children}</div>
    </div>
  );
}

const Mono = ({ children }: { children: ReactNode }) => <code className="type-mono text-muted">{children}</code>;

/* ---------- colour ---------- */

type Sw = { name: string; role: string };
const GROUPS: { title: string; items: Sw[] }[] = [
  {
    title: 'Surfaces and lines',
    items: [
      { name: 'bg', role: 'Page background' },
      { name: 'surface', role: 'Cards, inputs, popovers' },
      { name: 'surface-2', role: 'Insets, wells, segmented track' },
      { name: 'sidebar', role: 'Sidebar background' },
      { name: 'line', role: 'Hairline borders, dividers' },
      { name: 'line-strong', role: 'Form-control edges, switch track' },
    ],
  },
  {
    title: 'Text',
    items: [
      { name: 'ink', role: 'Primary text, headings' },
      { name: 'muted', role: 'Secondary text, captions, placeholders' },
    ],
  },
  {
    title: 'Brand (the one accent)',
    items: [
      { name: 'accent', role: 'Primary button, focus ring, progress' },
      { name: 'accent-hover', role: 'Primary hover' },
      { name: 'accent-text', role: 'Links and brand text' },
      { name: 'accent-soft', role: 'Selected, hero, brand badge fill' },
    ],
  },
  {
    title: 'Status',
    items: [
      { name: 'good', role: 'Above target: icons and bars' },
      { name: 'good-soft', role: 'Good badge fill' },
      { name: 'warn', role: 'Near target: icons and bars' },
      { name: 'warn-soft', role: 'Warn badge fill' },
      { name: 'bad', role: 'Below target, errors, destructive' },
      { name: 'bad-soft', role: 'Error badge fill' },
    ],
  },
  {
    title: 'Data',
    items: [
      { name: 'sky', role: 'Chart series 2, info' },
      { name: 'sky-soft', role: 'Info badge fill' },
      { name: 'chart-3', role: 'Chart series 3 (slate)' },
    ],
  },
];

function Swatch({ name, role }: Sw) {
  const tok = useToken();
  const hex = tok(name);
  return (
    <div className="min-w-0">
      <div className="h-12 rounded-md border border-black/10 dark:border-white/10" style={{ background: `var(--${name})` }} />
      <p className="mt-2 truncate text-sm font-medium">{name}</p>
      <p className="type-mono truncate uppercase">{hex}</p>
      <p className="type-caption mt-0.5">{role}</p>
    </div>
  );
}

function PairTable() {
  const tok = useToken();
  const rows = pairs.map(([fg, bg, min, what]) => {
    const f = tok(fg as string);
    const b = tok(bg as string);
    const r = f && b ? ratio(f, b) : 0;
    return { fg: fg as string, bg: bg as string, min: min as number, what: what as string, f, b, r, ok: r >= (min as number) };
  });
  const passing = rows.filter((r) => r.ok).length;
  return (
    <Collapsible>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-5 py-4">
        <div>
          <p className="type-subheading">{passing === rows.length ? `All ${rows.length} pairs meet WCAG AA in this theme` : `${rows.length - passing} pairs fail in this theme`}</p>
          <p className="type-caption mt-0.5">
            4.5:1 for text, 3:1 for icons, bars and control edges. Gated by <Mono>node scripts/check-contrast.mjs</Mono>.
          </p>
        </div>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm">
            Show every pair
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="type-caption text-left">
              <tr className="border-b border-line">
                <th className="px-4 py-2.5 font-medium">Sample</th>
                <th className="px-2 py-2.5 font-medium">Text on background</th>
                <th className="px-2 py-2.5 text-right font-medium">Ratio</th>
                <th className="px-2 py-2.5 font-medium">Needs</th>
                <th className="px-4 py-2.5 font-medium">Used for</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={`${r.fg}-${r.bg}`}>
                  <td className="px-4 py-2">
                    <span className="inline-grid h-7 w-12 place-items-center rounded-sm border border-black/10 text-xs font-semibold dark:border-white/10" style={{ background: r.b, color: r.f }}>
                      Aa
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <Mono>
                      {r.fg} on {r.bg}
                    </Mono>
                  </td>
                  <td className="type-num px-2 py-2 text-right font-medium">{r.r.toFixed(2)}:1</td>
                  <td className="px-2 py-2">
                    <Badge tone={r.ok ? 'good' : 'bad'}>{r.ok ? `AA ${r.min}` : `Fails ${r.min}`}</Badge>
                  </td>
                  <td className="type-caption px-4 py-2">{r.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ColourSection() {
  return (
    <Section id="colour" title="Colour" lead="Ocean Teal. Cool slate neutrals, one teal accent, status colours that never stand in for the accent. Every swatch reads its hex from the live CSS variable, so flip the theme and it updates.">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <h3 className="type-subheading mb-3">{g.title}</h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 xl:grid-cols-6">
            {g.items.map((i) => (
              <Swatch key={i.name} {...i} />
            ))}
          </div>
        </div>
      ))}
      <PairTable />
    </Section>
  );
}

/* ---------- typography ---------- */

const SCALE: { cls: string; name: string; spec: string; sample: string }[] = [
  { cls: 'type-display', name: 'Display', spec: 'Newsreader 500, 32-44 / 1.08, -0.02em', sample: 'Every mistake, pinned to the words you wrote' },
  { cls: 'type-title', name: 'Title (page h1)', spec: 'Newsreader 500, 30-40 / 1.08, -0.02em', sample: 'Good evening, Amara' },
  { cls: 'type-title-sm', name: 'Title, compact', spec: 'Newsreader 500, 26-32 / 1.15. Settings, hero cards, cue-card titles.', sample: 'Lexical Resource is holding your band back' },
  { cls: 'type-heading', name: 'Section heading', spec: 'Newsreader 500, 22 / 1.25, -0.012em. Same voice as the title, one clear step down.', sample: 'Band by criterion' },
  { cls: 'type-subheading', name: 'Subheading', spec: 'Hanken Grotesk 600, 15 / 1.4. Card and row titles.', sample: 'Fluency and coherence' },
  { cls: 'type-body', name: 'Body', spec: 'Hanken Grotesk 400, 15 / 1.6', sample: 'Each answer is scored against the public band descriptors, with feedback you can act on.' },
  { cls: 'type-lede', name: 'Lede', spec: 'Hanken Grotesk 400, 15 / 1.5, ink at 74%. Descriptions under titles.', sample: 'Record your answers and get a band for each criterion.' },
  { cls: 'type-caption', name: 'Caption', spec: 'Hanken Grotesk 400, 13 / 1.45, muted. Hints, metadata.', sample: 'Scores at or above your target show green.' },
  { cls: 'type-reading', name: 'Reading', spec: 'Newsreader 400, 18 / 1.7, max 68ch. Essays, transcripts.', sample: 'I think the main reason is that people have become more aware of it.' },
  { cls: 'type-reading-sm', name: 'Reading, small', spec: 'Newsreader 400, 17 / 1.45. Prompt titles in lists, before and after pairs, cue-card bullets.', sample: 'Advertising aimed at children should be banned.' },
  { cls: 'type-band', name: 'Band numeral', spec: 'Hanken Grotesk 600, tabular, -0.025em. Set the size with text-*. Every band in the app.', sample: '6.5' },
  { cls: 'type-overline', name: 'Overline', spec: 'Hanken Grotesk 600, 11 / 1.3, +0.08em caps, muted. One per view at most.', sample: 'Part 2 cue card' },
  { cls: 'type-mono', name: 'Mono', spec: 'System mono, 13, tabular, slashed zero', sample: 'band 6.5  00:42.180  0x1F' },
];

function TypeSection() {
  return (
    <Section id="type" title="Typography" lead="Hanken Grotesk carries the interface. Newsreader carries page titles and everything you read or write: essays, transcripts, prompts, cue cards, descriptors.">
      <div className="grid gap-x-8 gap-y-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-lg border border-line bg-surface p-5">
          <p className="font-sans text-[3.5rem] leading-none font-semibold tracking-tight">Aa</p>
          <p className="mt-3 type-subheading">Hanken Grotesk</p>
          <p className="type-caption">Variable 100-900. UI, labels, buttons, numbers. Weights in use: 400, 500, 600.</p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-5">
          <p className="font-serif text-[3.5rem] leading-none font-medium tracking-tight">Aa</p>
          <p className="mt-3 type-subheading">Newsreader</p>
          <p className="type-caption">Variable, optical size 6-72. Page titles and reading surfaces. Weights: 400, 500, italic for emphasis inside prose only.</p>
        </div>
      </div>

      <div className="divide-y divide-line rounded-lg border border-line bg-surface">
        {SCALE.map((s) => (
          <div key={s.name} className="grid gap-x-8 gap-y-1.5 p-5 sm:grid-cols-[13rem_minmax(0,1fr)]">
            <div>
              <p className="text-sm font-medium">{s.name}</p>
              <p className="type-caption mt-0.5">{s.spec}</p>
              <p className="mt-1">
                <Mono>.{s.cls}</Mono>
              </p>
            </div>
            <p className={cn(s.cls, 'min-w-0')}>{s.sample}</p>
          </div>
        ))}
      </div>

      <Spec title="Reading surface" note="Newsreader 18 / 1.7, max 68ch. Corrections sit on it without changing its rhythm.">
        <p className="type-reading">
          Some people believe that children should start learning a foreign language as soon as they begin school. I{' '}
          <span className="underline decoration-bad decoration-2 underline-offset-4">am agree</span> with this view, because young learners absorb <em>sounds and rhythm</em> far more easily than adults, and the
          habit of practising every day is easier to build at seven than at seventeen.
        </p>
      </Spec>

      <Spec title="Figures" note="Bands use .type-band (Hanken, semibold, tabular) in every screen; timers and counts use .type-num. Figures never shift as they change. Serif numerals are only list indices.">
        <div className="grid gap-6 sm:grid-cols-2">
          <p className="type-band text-4xl">
            38:12
            <br />
            00:59
          </p>
          <dl className="type-num grid w-fit grid-cols-[auto_auto] gap-x-6 text-lg">
            {[
              ['Fluency', '6.5'],
              ['Lexical', '7.0'],
              ['Grammar', '5.5'],
              ['Overall', '6.5'],
            ].map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd className="text-right font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Spec>
    </Section>
  );
}

/* ---------- space, radius, elevation ---------- */

function ShapeSection() {
  return (
    <Section id="shape" title="Space, radius, elevation" lead="A 4px grid. Three radii. Hairline borders do the structural work; one shadow level lifts cards, one lifts overlays.">
      <Spec title="Spacing scale" note="Tailwind steps, 4px base.">
        <div className="space-y-2">
          {[
            ['1', 4],
            ['2', 8],
            ['3', 12],
            ['4', 16],
            ['6', 24],
            ['8', 32],
            ['12', 48],
            ['16', 64],
          ].map(([k, px]) => (
            <div key={k} className="flex items-center gap-3">
              <Mono>{`space-${k}`}</Mono>
              <span className="h-3 rounded-[2px] bg-brand" style={{ width: Number(px) * 2 }} />
              <span className="type-caption type-num">{px}px</span>
            </div>
          ))}
        </div>
      </Spec>

      <div className="grid gap-8 md:grid-cols-2">
        <Spec title="Radius" note="No rounded-2xl. Full only for avatars, switches, dots.">
          <div className="flex flex-wrap items-end gap-5">
            {[
              ['sm', '6px', 'rounded-sm', 'Badge, chip, menu item'],
              ['md', '8px', 'rounded-md', 'Button, input, popover'],
              ['lg', '12px', 'rounded-lg', 'Card, dialog, sheet'],
            ].map(([n, px, cls, use]) => (
              <div key={n} className="w-24">
                <div className={cn('h-16 border border-input bg-surface-2', cls)} />
                <p className="mt-2 text-sm font-medium">
                  {n} <span className="type-num font-normal text-muted">{px}</span>
                </p>
                <p className="type-caption">{use}</p>
              </div>
            ))}
          </div>
        </Spec>
        <Spec title="Elevation" note="Flat, raised, overlay.">
          <div className="grid grid-cols-3 gap-3 bg-bg p-3 -m-5 rounded-lg">
            {[
              ['Flat', 'border border-line bg-surface', 'Hairline only'],
              ['Raised', 'border border-line bg-surface shadow-card', 'Cards'],
              ['Overlay', 'bg-surface shadow-pop', 'Menus, dialogs'],
            ].map(([n, cls, use]) => (
              <div key={n} className={cn('rounded-md p-3', cls)}>
                <p className="text-sm font-medium">{n}</p>
                <p className="type-caption">{use}</p>
              </div>
            ))}
          </div>
        </Spec>
      </div>
    </Section>
  );
}

/* ---------- buttons ---------- */

function ButtonsSection() {
  const variants = ['primary', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const;
  return (
    <Section id="buttons" title="Buttons" lead="Primary once per view. Filled buttons get a 1px top highlight, never a glow. Press moves them 1px down. Secondary is a real outline (transparent, line-strong edge), so it never reads as disabled. Default height is 40px, 44px on phones. Loading keeps full contrast; only disabled fades.">
      <Spec title="Variants">
        <div className="flex flex-wrap items-center gap-3">
          {variants.map((v) => (
            <Button key={v} variant={v}>
              {v[0]!.toUpperCase() + v.slice(1)}
            </Button>
          ))}
        </div>
      </Spec>
      <Spec title="Sizes" note="sm 32px (44px hit area on phones), default 40px, lg 44px. Icon buttons match; inputs and selects are 40px so rows line up.">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button>Default</Button>
          <Button size="lg">Large</Button>
          <Button size="icon-sm" variant="outline" aria-label="Add">
            <Plus />
          </Button>
          <Button size="icon" variant="outline" aria-label="Search">
            <Search />
          </Button>
        </div>
      </Spec>
      <Spec title="States">
        <div className="flex flex-wrap items-center gap-3">
          <Button icon={<Mic />}>With icon</Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
          <Button variant="outline" disabled>
            Disabled
          </Button>
          <Button variant="destructive" icon={<Trash2 />}>
            Delete attempt
          </Button>
        </div>
      </Spec>
    </Section>
  );
}

/* ---------- forms ---------- */

function FormsSection() {
  const [on, setOn] = useState(true);
  const [band, setBand] = useState(7);
  const [seg, setSeg] = useState<'speaking' | 'writing'>('speaking');
  const [model, setModel] = useState<string | null>('mistral-small');
  return (
    <Section id="forms" title="Forms" lead="Label above, hint or error below, never a placeholder as label. Control edges use line-strong so they hold 3:1 against the surface.">
      <Spec title="Text inputs">
        <div className="grid gap-5 md:grid-cols-2">
          <Input label="Name" placeholder="Amara Okafor" />
          <Input label="Email" type="email" hint="We only use it to sign you in." defaultValue="amara@test.dev" />
          <Input label="Password" type="password" defaultValue="password1234" />
          <Input label="Target band" error="Enter a band between 4.0 and 9.0." defaultValue="11" />
          <Input label="Disabled" disabled defaultValue="Locked while scoring" />
          <Select label="Part" defaultValue="2">
            <option value="1">Part 1, interview</option>
            <option value="2">Part 2, cue card</option>
            <option value="3">Part 3, discussion</option>
          </Select>
          <div className="md:col-span-2">
            <Textarea label="Essay" hint="250 words minimum." placeholder="Start typing here." rows={3} />
          </div>
        </div>
      </Spec>
      <Spec title="Choices">
        <div className="grid gap-6 md:grid-cols-2">
          <Switch checked={on} onChange={setOn} label="Show band after each answer" description="Hide it to practise under exam conditions." />
          <Slider label="Target band" value={band} onChange={setBand} min={4} max={9} step={0.5} format={(v) => v.toFixed(1)} />
          <div>
            <p className="mb-1.5 text-sm font-medium">Skill</p>
            <Segmented
              label="Skill"
              value={seg}
              onChange={setSeg}
              options={[
                { value: 'speaking', label: 'Speaking' },
                { value: 'writing', label: 'Writing' },
              ]}
            />
          </div>
          <Combobox
            label="Scoring model"
            value={model}
            onChange={setModel}
            options={[
              { value: 'mistral-small', label: 'Mistral Small', description: 'Fast, cheap' },
              { value: 'qwen-72b', label: 'Qwen 72B', description: 'Slower, steadier bands' },
              { value: 'llama-70b', label: 'Llama 70B' },
            ]}
          />
        </div>
      </Spec>
    </Section>
  );
}

/* ---------- badges and alerts ---------- */

const TONES: Tone[] = ['neutral', 'accent', 'good', 'warn', 'bad', 'info'];

function FeedbackSection() {
  return (
    <Section id="feedback" title="Badges and alerts" lead="Badges are square-ish status labels, not pills. Colour always pairs with words or an icon.">
      <Spec title="Badge tones">
        <div className="flex flex-wrap items-center gap-2">
          {TONES.map((t) => (
            <Badge key={t} tone={t}>
              {t === 'neutral' ? 'Draft' : t === 'accent' ? 'Scoring' : t === 'good' ? 'On target' : t === 'warn' ? 'Near target' : t === 'bad' ? 'Below target' : 'Part 2'}
            </Badge>
          ))}
          <Badge tone="good">
            <Check /> Saved
          </Badge>
        </div>
      </Spec>
      <Spec title="Alerts" note="role=alert only for errors.">
        <div className="space-y-3">
          <Alert tone="accent" title="Scoring takes about a minute">
            You can leave this page. The result appears in History.
          </Alert>
          <Alert tone="good" title="Saved">
            Your target band is now 7.0.
          </Alert>
          <Alert tone="warn" title="Short essay">
            You wrote 212 words. Task 2 needs at least 250 to reach a 6.
          </Alert>
          <Alert tone="bad" title="Could not score this answer" action={<Button size="sm" variant="outline" icon={<RotateCcw />}>Try again</Button>}>
            The scoring service timed out. Nothing was lost.
          </Alert>
        </div>
      </Spec>
      <Spec title="Toast (sonner)" note="Transient confirmations only. Errors that block work go inline.">
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => toast('Copied to clipboard')}>
            Neutral
          </Button>
          <Button variant="outline" onClick={() => toast('Target band saved', { tone: 'good' })}>
            Success
          </Button>
          <Button variant="outline" onClick={() => toast('Upload failed', { tone: 'bad', action: { label: 'Retry', onClick: () => toast('Retrying', { tone: 'good' }) } })}>
            Error with action
          </Button>
        </div>
      </Spec>
    </Section>
  );
}

/* ---------- navigation controls ---------- */

function NavSection() {
  const [tab, setTab] = useState<'overview' | 'criteria' | 'transcript' | 'mistakes'>('overview');
  const [chips, setChips] = useState<string[]>(['Grammar']);
  const [seg, setSeg] = useState<'all' | 'part1' | 'part2'>('all');
  return (
    <Section id="nav" title="Navigation controls" lead="Tabs switch views of one thing, segmented controls switch a mode, chips filter a list. The active indicator slides rather than jumps.">
      <Spec title="Tabs">
        <Tabs
          id="sg-tabs"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'overview', label: 'Overview' },
            { value: 'criteria', label: 'Criteria' },
            { value: 'transcript', label: 'Transcript' },
            { value: 'mistakes', label: 'Mistakes', count: 7 },
          ]}
        />
        <div role="tabpanel" id="sg-tabs-panel" aria-labelledby={`sg-tabs-${tab}`} className="pt-4 text-sm text-muted">
          Showing <span className="font-medium text-ink">{tab}</span>.
        </div>
      </Spec>
      <div className="grid gap-8 md:grid-cols-2">
        <Spec title="Segmented">
          <Segmented
            label="Part"
            value={seg}
            onChange={setSeg}
            options={[
              { value: 'all', label: 'All' },
              { value: 'part1', label: 'Part 1' },
              { value: 'part2', label: 'Part 2' },
            ]}
          />
        </Spec>
        <Spec title="Filter chips">
          <div className="flex flex-wrap gap-2">
            {['Grammar', 'Vocabulary', 'Cohesion', 'Pronunciation'].map((c) => (
              <Chip key={c} selected={chips.includes(c)} onClick={() => setChips((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))}>
                {c}
              </Chip>
            ))}
          </div>
        </Spec>
      </div>
    </Section>
  );
}

/* ---------- overlays ---------- */

function OverlaysSection() {
  const [dlg, setDlg] = useState(false);
  const [sheet, setSheet] = useState(false);
  return (
    <Section id="overlays" title="Overlays" lead="Popovers and menus are 8px radius with the overlay shadow. Dialogs confirm, sheets show detail. All trap focus and return it.">
      <Spec title="Dialog, sheet, popover, menu, tooltip">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => setDlg(true)}>
            Dialog
          </Button>
          <Button variant="outline" onClick={() => setSheet(true)}>
            Sheet
          </Button>
          <Popover trigger={(p) => <Button variant="outline" {...p}>Popover</Button>}>
            <p className="type-subheading">Band 6.5</p>
            <p className="mt-1 text-sm text-muted">Likely to reach 7 if you fix repeated article errors.</p>
          </Popover>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" icon={<Ellipsis />}>
                Menu
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-44">
              <DropdownMenuLabel className="text-xs font-normal text-muted">Attempt</DropdownMenuLabel>
              <DropdownMenuItem>Open result</DropdownMenuItem>
              <DropdownMenuItem>Practise again</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-bad-text">Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip content="Start a timed Part 2 answer">
            <Button size="icon" variant="outline" aria-label="Start Part 2">
              <Mic />
            </Button>
          </Tooltip>
          <span className="inline-flex items-center gap-1 text-sm text-muted">
            Lexical resource <InfoTip>How varied and precise your word choice is.</InfoTip>
          </span>
        </div>
      </Spec>
      <Dialog
        open={dlg}
        onClose={() => setDlg(false)}
        title="Delete this attempt?"
        description="The recording, transcript and feedback are removed. This cannot be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDlg(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => setDlg(false)}>
              Delete
            </Button>
          </>
        }
      />
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Error detail" description="Subject-verb agreement">
        <p className="type-reading">
          <span className="text-bad-text line-through">people has become</span> <span className="text-good-text">people have become</span>
        </p>
        <p className="mt-3 text-sm text-muted">Plural subjects take plural verbs, even when a phrase sits between them.</p>
      </Sheet>
    </Section>
  );
}

/* ---------- cards and data ---------- */

function DataSection() {
  return (
    <Section id="data" title="Cards and data" lead="Cards only when a block needs to read as one object. Never nest them: inside a card use a surface-2 inset or a divider.">
      <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
        <Card>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="type-subheading">Writing Task 2</h3>
              <p className="type-caption mt-0.5">Submitted 14 Mar, 40 min</p>
            </div>
            <Badge tone="good">On target</Badge>
          </div>
          <dl className="mt-5 grid grid-cols-3 gap-4">
            <Stat label="Overall" value={7} decimals={1} size="lg" delta={{ value: '+0.5', tone: 'good' }} />
            <Stat label="Words" value={284} />
            <Stat label="Time" value="38:12" />
          </dl>
          <div className="mt-5 space-y-2.5 border-t border-line pt-4">
            {[
              ['Task response', 0.78, 'good'],
              ['Coherence', 0.62, 'warn'],
              ['Lexical resource', 0.7, 'accent'],
              ['Grammar', 0.44, 'bad'],
            ].map(([l, v, t]) => (
              <div key={l as string} className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-3 text-sm">
                <span className="text-muted">{l as string}</span>
                <ProgressBar label={l as string} value={v as number} tone={t as Tone} />
              </div>
            ))}
          </div>
        </Card>
        <div className="space-y-4">
          <Card tone="hero">
            <h3 className="type-subheading">Next up</h3>
            <p className="mt-1 text-sm text-ink/80">Part 2 cue card: a place you visited that you liked.</p>
            <Button className="mt-4" icon={<Mic />}>
              Start speaking
            </Button>
          </Card>
          <Card interactive className="flex items-center justify-between gap-3">
            <div>
              <p className="type-subheading">Interactive card</p>
              <p className="type-caption">Border darkens on hover.</p>
            </div>
            <ChevronRight className="size-4 text-muted" aria-hidden />
          </Card>
          <Card className="flex items-center gap-4">
            <ProgressRing label="Time used" value={0.72} size={56} tone="accent">
              <span className="type-num text-xs font-semibold">29:00</span>
            </ProgressRing>
            <div>
              <p className="type-subheading">Timer ring</p>
              <p className="type-caption">Tabular figures inside.</p>
            </div>
          </Card>
        </div>
      </div>
    </Section>
  );
}

/* ---------- states ---------- */

function StatesSection() {
  return (
    <Section id="states" title="States" lead="Every data view ships all three: a skeleton shaped like the final content, an empty state that teaches the next step (no frame, hairline, serif title, optional faded preview of the real list), and an inline error with a retry.">
      <Spec title="Loading" note="Skeleton, not a spinner.">
        <div className="space-y-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-9 shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-4/5" />
              </div>
              <Skeleton className="h-6 w-14" />
            </div>
          ))}
        </div>
      </Spec>
      <div>
        <div className="mb-2.5 flex items-baseline gap-3">
          <h3 className="type-subheading">Empty</h3>
          <p className="type-caption">Say what will appear, offer the action that creates it.</p>
        </div>
        <EmptyState icon={<TriangleAlert />} title="Your error log is empty" preview={<GhostList rows={3} />} action={<Button icon={<PenLine />}>Write an essay</Button>}>
          Grammar slips and word choices from your results collect here, so you can spot the ones that keep coming back.
        </EmptyState>
      </div>
      <Spec title="Error" note="Inline, says what failed and what to do.">
        <Alert tone="bad" title="We could not load your history" action={<Button size="sm" variant="outline" icon={<RotateCcw />}>Retry</Button>}>
          The connection dropped. Your attempts are safe.
        </Alert>
      </Spec>
    </Section>
  );
}

/* ---------- motion ---------- */

function MotionSection() {
  const [k, setK] = useState(0);
  const [tab, setTab] = useState<'a' | 'b' | 'c'>('a');
  return (
    <Section id="motion" title="Motion" lead="Motion says something changed or something arrived. Three durations, exponential ease-out, transform and opacity only. Under prefers-reduced-motion every animation collapses to an instant change.">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {[
            ['120ms', 'hover, press, focus'],
            ['200ms', 'menus, toggles, tab underline'],
            ['320ms', 'page enter, list rise, progress'],
          ].map(([d, u]) => (
            <span key={d}>
              <span className="type-num font-semibold">{d}</span> <span className="text-muted">{u}</span>
            </span>
          ))}
        </div>
        <Button variant="outline" size="sm" icon={<RotateCcw />} onClick={() => setK((x) => x + 1)}>
          Replay
        </Button>
      </div>
      <div className="grid gap-8 md:grid-cols-2">
        <Spec title="Page enter" note="Fade + 4px rise, 320ms.">
          <div key={k} className="page-enter rounded-md border border-line bg-surface-2 p-4 text-sm">
            <p className="font-medium">Dashboard</p>
            <p className="text-muted">Content arrives as one unit.</p>
          </div>
        </Spec>
        <Spec title="List stagger" note="40ms apart, first 8 only.">
          <ul key={k} className="stagger space-y-1.5">
            {['Speaking Part 2', 'Writing Task 2', 'Speaking Part 1', 'Writing Task 1'].map((t) => (
              <li key={t} className="flex items-center justify-between rounded-md border border-line bg-surface-2 px-3 py-2 text-sm">
                {t}
                <Badge tone="accent">6.5</Badge>
              </li>
            ))}
          </ul>
        </Spec>
        <Spec title="Score count-up" note="600ms, figures stay tabular.">
          <dl key={k} className="flex gap-10">
            <Stat label="Overall" value={6.5} decimals={1} size="lg" />
            <Stat label="Fluency" value={7} decimals={1} size="lg" />
            <Stat label="Words" value={284} size="lg" />
          </dl>
        </Spec>
        <Spec title="Progress fill" note="Bars fill in 320ms, rings 600ms.">
          <div key={k} className="flex items-center gap-6">
            <div className="flex-1 space-y-3">
              <ProgressBar label="Good" value={0.8} tone="good" />
              <ProgressBar label="Warn" value={0.55} tone="warn" />
              <ProgressBar label="Bad" value={0.3} tone="bad" />
            </div>
            <ProgressRing label="Sample" value={0.66} size={64}>
              <span className="text-sm font-semibold">66%</span>
            </ProgressRing>
          </div>
        </Spec>
        <Spec title="Sliding indicators" note="Underline 320ms, segmented thumb 200ms.">
          <div className="space-y-5">
            <Tabs
              id="sg-motion"
              value={tab}
              onChange={setTab}
              items={[
                { value: 'a', label: 'Overview' },
                { value: 'b', label: 'Criteria' },
                { value: 'c', label: 'Transcript' },
              ]}
            />
            <Segmented
              label="Motion demo"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'a', label: 'One' },
                { value: 'b', label: 'Two' },
                { value: 'c', label: 'Three' },
              ]}
            />
          </div>
        </Spec>
        <Spec title="Press and shimmer" note="Buttons sink 1px. Skeletons sweep a light band.">
          <div className="space-y-4">
            <Button>Press and hold me</Button>
            <div className="space-y-2" aria-hidden>
              <Skeleton className="h-3.5 w-3/5" />
              <Skeleton className="h-3.5 w-4/5" />
            </div>
          </div>
        </Spec>
      </div>
    </Section>
  );
}

/* ---------- layout ---------- */

function LayoutSection() {
  return (
    <Section id="layout" title="Layout" lead="Every page lives in a PageContainer at one width, so titles and content sit on the same edge whichever sidebar item you open. Prose and forms limit themselves inside it.">
      <div className="rounded-lg border border-line bg-surface p-5">
        <div className="space-y-4">
          {[
            ['default', '1080px', 'Every page: hubs, lists, dashboard, results, settings, review. Prose stays at 60-68ch, forms at 40rem, the review card at 720px, all left aligned.'],
            ['narrow', '720px', 'Exam screens only: the timed session, the live stage and their pre-screens (centred).'],
          ].map(([n, px, use]) => (
            <div key={n}>
              <div className="h-9 rounded-md border border-brand/30 bg-accent-soft" style={{ width: n === 'default' ? '100%' : '66.6%', marginInline: n === 'default' ? undefined : 'auto' }} />
              <p className="mt-1.5 text-sm">
                <Mono>{`<PageContainer${n === 'narrow' ? ' width="narrow"' : ''}>`}</Mono> <span className="type-num font-medium">{px}</span> <span className="text-muted">{use}</span>
              </p>
            </div>
          ))}
        </div>
      </div>
      <Spec title="Page header pattern" note="Newsreader title, a readable lede, actions at the right. Space, not a rule, separates it from the content. Optional back link above.">
        <PageHeader title="History" description="Every attempt, newest first." actions={<Button variant="outline" size="sm">Export</Button>} className="mb-0" as="h4" />
        <p className="type-caption mt-4">Shell: 240px sidebar that collapses to a 56px icon rail (Ctrl or Cmd + B), 40px side gutters on desktop, 16px on phones, bottom tab bar below 768px. Result pages use the same PageHeader (ResultHeader wraps it) and put the overall band in a strip below it.</p>
      </Spec>
      <Spec title="Lists and rows" note="Rows sit on the page between hairlines, no card. The hover wash bleeds 12px past the text; the arrow only appears on hover or focus.">
        <ul className="divide-y divide-line border-y border-line">
          {[
            ['Part 1: Interview', 'Everyday questions about you, your home, work or studies.'],
            ['Part 2: Long turn', 'A cue card, one minute to prepare, then up to two minutes of talking.'],
          ].map(([t, d], i) => (
            <li key={t}>
              <a href="#layout" className="group relative isolate flex items-center gap-3.5 rounded-md py-3.5 before:absolute before:inset-y-0 before:-inset-x-3 before:-z-10 before:rounded-md before:transition-colors hover:before:bg-hover focus-visible:outline-offset-[6px]">
                <span className="w-9 shrink-0 font-serif text-3xl leading-none font-medium text-muted transition-colors group-hover:text-accent-text">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="type-subheading block">{t}</span>
                  <span className="type-lede block text-sm">{d}</span>
                </span>
                <ArrowRight className="size-4 -translate-x-1 opacity-0 transition-[opacity,translate] group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      </Spec>
      <Spec title="Icon slot, keys, sticky tabs" note="IconTile is a bare 20px icon, no box. Kbd hints keyboard shortcuts. StickyTabs holds a tab bar under the top edge (z-20, bleeds over the shell gutter).">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <span className="group flex items-center gap-2 text-sm">
            <IconTile>
              <Mic />
            </IconTile>
            Muted, teal on row hover
          </span>
          <span className="flex items-center gap-2 text-sm">
            <IconTile tone="brand">
              <Layers />
            </IconTile>
            Brand
          </span>
          <span className="flex items-center gap-2 text-sm">
            Show answer <Kbd>Space</Kbd>
          </span>
        </div>
      </Spec>
      <Spec title="Shape rule" note="Control 8px, card 12px, chip and badge 6px. Fully round only for real circles: radio, switch, mic button, avatar, progress ring.">
        <p className="type-caption">Icon sizes: 16px inline and in buttons, 20px in navigation, rows and empty states, 36px only for the recording control. Badge glyphs and trend arrows are the two documented 14px exceptions.</p>
      </Spec>
    </Section>
  );
}

/* ---------- icons ---------- */

const ICONS: [string, LucideIcon][] = [
  ['House', House],
  ['Mic', Mic],
  ['PenLine', PenLine],
  ['LibraryBig', LibraryBig],
  ['TriangleAlert', TriangleAlert],
  ['Layers', Layers],
  ['History', History],
  ['Settings', Settings],
  ['Bell', Bell],
  ['Search', Search],
];

function IconsSection() {
  return (
    <Section id="icons" title="Icons" lead="Lucide only, 1.75 stroke set once in CSS. 16px inside controls, 20px in navigation and empty states. Icons accompany words; they do not replace them.">
      <div className="rounded-lg border border-line bg-surface p-5">
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-5">
          {ICONS.map(([n, I]) => (
            <div key={n} className="flex items-center gap-3">
              <I className="size-4 text-ink" aria-hidden />
              <I className="size-5 text-ink" aria-hidden />
              <span className="type-caption">{n}</span>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* ---------- rules ---------- */

const DO = [
  'Use one accent. Teal means "act here" or "you are here".',
  'Group with space and hairlines. Reach for a card only when the block is one object.',
  'Put essays, transcripts and prompts in Newsreader, everything interactive in Hanken Grotesk.',
  'Write sentence-case, plain copy: "We could not save your changes."',
  'Pair colour with a word or icon. Band colours are never the only signal.',
  'Keep figures tabular wherever they change.',
];
const DONT = [
  'No coloured glows, gradient blobs, gradient text or pure black.',
  'No rounded-2xl everywhere, no pill badges, no emoji as icons.',
  'No nested bordered cards, no identical three-up card rows.',
  'No second accent colour, no status colour used as decoration.',
  'No scroll-driven or looping motion without a reason; no animation of layout properties.',
  'No Inter, Geist or system-font fallbacks in design work, no all-caps labels above every section.',
];

function RulesSection() {
  return (
    <Section id="rules" title="Do and do not">
      <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
        {[
          ['Do', DO, 'text-good-text'],
          ['Do not', DONT, 'text-bad-text'],
        ].map(([t, items, c]) => (
          <div key={t as string}>
            <h3 className={cn('type-subheading', c as string)}>{t as string}</h3>
            <ul className="mt-2 space-y-2.5 text-sm">
              {(items as string[]).map((i) => (
                <li key={i} className="max-w-[52ch]">
                  {i}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ---------- page ---------- */

function Styleguide() {
  const [active, setActive] = useState<string>(SECTIONS[0][0]);
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive(hit.target.id);
      },
      { rootMargin: '0px 0px -70% 0px' },
    );
    document.querySelectorAll('[data-sg-section]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return (
    <PageContainer>
      <PageHeader title="Style guide" description="Ocean Teal tokens, type, components and motion. Everything here renders from the live tokens, so it follows the theme." actions={<ThemeToggle />} />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_11rem]">
        <div className="min-w-0 space-y-12">
          <ColourSection />
          <TypeSection />
          <ShapeSection />
          <ButtonsSection />
          <FormsSection />
          <FeedbackSection />
          <NavSection />
          <OverlaysSection />
          <DataSection />
          <StatesSection />
          <MotionSection />
          <LayoutSection />
          <IconsSection />
          <RulesSection />
        </div>
        <nav aria-label="On this page" className="sticky top-10 hidden self-start lg:block">
          <p className="type-caption mb-2">On this page</p>
          <ul className="space-y-0.5 border-l border-line">
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  aria-current={active === id ? 'true' : undefined}
                  className={cn('-ml-px block border-l py-1 pl-3 text-caption text-muted transition-colors duration-[120ms] hover:text-ink', active === id ? 'border-brand font-medium text-ink' : 'border-transparent')}
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </PageContainer>
  );
}
