# Web design system

Everything here lives in `apps/web/src`. Reuse it; don't restyle primitives per page. If something is missing, add it to `components/ui/` (ask the owner) rather than inlining a one-off.

## Principles

- **Calm and focused.** Warm neutral surfaces, one accent (indigo), and semantic colour only when it means something: good / warn / bad.
- **Mobile-first.** Build at 390 px first. The AppShell switches to a sidebar at `md` (768 px).
- **Accessible by default.** Every control has a visible label or `aria-label`, a visible focus ring, and keyboard support. Colour never carries meaning alone: pair it with text or an icon.
- **Motion conveys state.** 150-250 ms, `ease-(--ease-out-quart)`; Radix enter/exit animations come from `tw-animate-css`. Reduced motion is handled globally.
- **Primitives are shadcn/ui.** `components/ui/shadcn/*` is the vendored shadcn (new-york) source, restyled to our tokens; `components/ui/*.tsx` are thin wrappers that keep our prop API. Screens import only from `@/components/ui`.

### Do / don't

- **Do** use exactly one primary (`Button variant="primary"`) per view; everything else is `secondary`, `ghost` or `link`.
- **Do** use one hero block (`<Card tone="hero">`) per screen for the "do this next" action. **Don't** tint more than one.
- **Don't** nest bordered cards. Inside a Card use dividers (`divide-y divide-line`) or a `bg-surface-2` inset (controls, quotes, diffs only). `EmptyState` inside a Card takes `bare`.
- **Don't** use a coloured side-stripe border, gradient text or glass blur.
- **Do** pair colour with text/icon; semantic colours mean band thresholds and real errors only (neutral `Badge` + a warn dot for "Needs work").
- **Do** use lists in one panel with dividers (rows `px-5 py-4`), not grids of identical cards.
- **Do** build destructive flows as `Dialog` (confirm) + `Button variant="danger"`; detail views as `Sheet`; explanations as `Popover`/`InfoTip`.
- **Don't** hard-code hex, px radii or one-off control heights. Use tokens and the sizes below.
- **Don't** use `text-muted` for anything that must read as primary; it is secondary text (5.3:1 on `bg`).

## Tokens (Tailwind class names)

Raw tokens live in `styles.css` (`:root` light, `.dark` dark). `@theme inline` exposes them as Tailwind colours, so every class adapts to the theme. Never hard-code hex values.

| Role | Classes | Use |
|---|---|---|
| Page background | `bg-bg` / `bg-background` | body |
| Surface | `bg-surface` / `bg-card` | panels, popovers, inputs |
| Second surface | `bg-surface-2` / `bg-secondary` | insets inside panels, segmented track, disabled inputs (darker than `surface` in light, lighter in dark) |
| Sidebar | `bg-sidebar` | desktop nav rail only |
| Text | `text-ink` / `text-foreground`, `text-muted` / `text-muted-foreground` | body; secondary (passes 4.5:1) |
| Lines | `border-line` / `border-border`, `border-line-strong` / `border-input` | dividers and panel edges (default border colour is `--line`); form-control edges, switch tracks, hover borders (>= 3:1) |
| Brand | `bg-brand text-brand-ink`, `hover:bg-brand-hover`, `text-brand-text`, `bg-brand-soft` (+ `bg-primary text-primary-foreground`, `ring-ring`) | primary actions, selection, links |
| Hover wash | `bg-hover` (6% ink light, 9% dark) | ghost hover, menu-item focus (shadcn's "accent" role) |
| Semantic fills | `bg-good` `bg-warn` `bg-bad`; `bg-destructive text-destructive-foreground` | chart marks, dots, progress; danger |
| Semantic text | `text-good-text` `text-warn-text` `text-bad-text` | text in these colours (contrast-safe) |
| Semantic tints | `bg-good-soft` `bg-warn-soft` `bg-bad-soft` | badges, highlights |
| Radius | `rounded-lg` = `--radius` 10 px (controls, `rounded-control`), `rounded-xl` 14 px (panels, sheets, `rounded-card`), `rounded-md` 8, `rounded-sm` 6, `rounded-full` | derived from `--radius` in `styles.css` |
| Shadow | `shadow-card`, `shadow-pop` | resting panels; floating layers |
| Fonts | `font-sans` (Inter), `font-serif` (Source Serif 4) | UI; essays, transcripts, prompts (`prose-serif`: 17 px/1.7, 68ch) |
| Easing | `ease-(--ease-out-quart)` | transitions |

**Legacy names (kept so screens compile):** `text-muted` (secondary text), `bg-accent` / `text-accent-text` / `bg-accent-soft` / `text-accent-ink` / `bg-accent-hover` (same values as `brand-*`). **Collision note:** in shadcn, `accent` means the neutral hover wash and `muted` a neutral *surface*; in our code `accent` is the indigo brand and `muted` is text. Until screens are migrated (mechanical sed: `text-muted` to `text-muted-foreground`, `*-accent*` to `*-brand*`), the vendored shadcn sources use `bg-hover` and `bg-surface-2` instead of `bg-accent` / `bg-muted`. After `shadcn add <x>`, run `sed -i -E 's/accent-foreground/ink/g; s/\bbg-accent\b/bg-hover/g; s/\bbg-muted\b/bg-surface-2/g' src/components/ui/shadcn/<x>.tsx`, then check it. The CLI's `ui` alias is `@/components/ui/shadcn`, so additions never collide with our PascalCase wrappers; `cn()` is in `@/lib/utils`.

When you need raw CSS values (SVG strokes, Recharts colours, inline styles) use the variables: `var(--accent)`, `var(--good)`, `var(--warn)`, `var(--bad)`, `var(--muted)`, `var(--line)`, `var(--ink)`, `var(--surface)`.

**Chart series** use the categorical palette in `components/dashboard/criteria.ts` so green/amber/red always mean good/warn/bad. **Band colours:** good when band >= target, warn 0.5-1.0 below, bad 1.5+ below (`bandColor` in `lib/result.ts`, `Tone` type).

**Surfaces (3 levels + hero):** page (`bg`) > panel (`surface`, 1 px line, `shadow-card`) > inset (`surface-2`, no border, controls only). The hero is a panel tinted `brand-soft`. Dark mode lifts panels off the page (`#1f1e1c` on `#151413`, line `#34322e`) and adds a 1 px inner top highlight instead of a heavier border.

**Type scale** (fixed rem, no fluid type): display `text-5xl font-semibold tracking-tight tabular-nums` (band numbers) · h1 `text-2xl md:text-[1.75rem] font-semibold tracking-tight` (PageHeader) · h2 `text-lg font-semibold` · card title `text-base font-semibold` · body `text-[0.9375rem]` · meta `text-sm text-muted` · micro `text-xs text-muted` (never smaller). Control labels are weight 500. Serif only for text the learner wrote or reads.

**Spacing scale (4 px base):** `1 / 2 / 3 / 4 / 6 / 10` (4, 8, 12, 16, 24, 40 px). Panel padding `p-5`; list rows `px-5 py-4`; page sections `space-y-10`; h2 to content `mb-4`; page wrapper `max-w-5xl`.

**Control heights:** `sm` 36 px (+44 px invisible hit area on phones via `hit`), `md` 44 px (default: buttons, inputs, selects, combobox), `lg` 52 px (hero CTA), `icon` 44 px / `icon-sm` 36 px. Icons: 16 px inline and in buttons, 20 px nav and icon buttons, 24 px hero/empty state.

**Z-index scale:** sidebar/tab bar `z-30` · ExamShell `z-40` · dialog/sheet `z-50` · popover/select/menu `z-[60]` · toast (sonner, top of the stack) · tooltip `z-[80]`. Radix portals to `<body>`.

**Dark mode:** `.dark` on `<html>`, set before paint from `localStorage.theme` or the system preference. Use `dark:` only when a token isn't enough.

## Lib

```ts
import { call, client, ApiError, type Schemas, type Me, type Settings } from '@/lib/api';
// Contract-typed (preferred): paths, params, bodies and responses come from src/lib/schema.d.ts, generated from openapi.json.
const page = await call(client.GET('/api/prompts', { params: { query: { skill: 'writing', page: 1 } } }));
await call(client.POST('/api/cards/{id}/review', { params: { path: { id } }, body: { grade: 4 } }));
type Mistake = Schemas['Mistake'];
// Legacy, caller-typed (not checked against the contract; migrate when you touch it):
await api.get<T>('/prompts?skill=writing');     // path is relative to /api ('/api/…' also accepted)
// Both throw ApiError { status, message } on non-2xx (message = server `{error}`).

import { queryClient, meQuery, useMe } from '@/lib/query';
const { data: me } = useMe();                     // user + settings + cambridgeAccess + realtimeAvailable
// After changing settings: queryClient.invalidateQueries({ queryKey: ['me'] })
// Query defaults: staleTime 30s, no refetch on focus, no retry on 4xx.

import { authClient, useSession, signOut, safeRedirect } from '@/lib/auth';   // better-auth/react

import { formatClock, formatDuration, formatBand, formatRange, formatRelative, formatDate, plural, formatPercent } from '@/lib/format';
formatClock(65) // "1:05" (negative → "-0:12" overtime)
formatBand(6)   // "6.0"
formatRange([6, 7]) // "6–7"
formatRelative(date) // "5 minutes ago"
plural(3, 'word') // "3 words"
```

Server result types are shared by importing them as types: `import type { AnalysisResult, ChartSpec } from '@server/ai/types'`.

## Routing

- File-based TanStack Router: `src/routes/`. `routeTree.gen.ts` is generated by the Vite plugin (dev or build). Never edit it.
- **Authed pages go in `routes/_app/`**, for example `_app/history.tsx` → `/history` and `_app/speaking/index.tsx` → `/speaking`. The `_app` layout guards the page (redirecting to `/login?redirect=…`), preloads `me`, and renders AppShell. Don't add your own guard.
- Loaders: `loader: ({ context }) => context.queryClient.ensureQueryData(opts)`, then `useSuspenseQuery(opts)` or `useQuery` in the component. The pending UI defaults to `PageSkeleton` after 1 s.
- Sign-out: `signOut()` from `lib/auth` (clears the query cache), then navigate to `/login`.

## Layout components (`@/components/layout/*`)

### AppShell
Used automatically by `_app.tsx`. It gives a desktop sidebar (Dashboard, Speaking, Writing, Prompt bank, Mistakes, Review, History, Settings, the theme toggle and the user with sign-out) and a mobile bottom bar (Home, Speak, Write, Review, More → a Sheet with the rest). Pages render inside a `max-w-5xl` column that already has padding. **Start each page with `<PageHeader>`.**

### ExamShell
A distraction-free, full-screen overlay for timed tasks. It covers the app nav, so the route can stay under `_app/`.
```tsx
import { ExamShell } from '@/components/layout/ExamShell';
<ExamShell title="Writing · Task 2" status={<><Timer/><Button size="sm">Submit</Button></>} exit={<Button variant="ghost" size="sm" onClick={confirmExit}>Exit</Button>} wide>
  …
</ExamShell>
```
- Without `wide`, the content is a centred `max-w-3xl` column with padding.
- With `wide`, the content gets the full width and height (lay out your own split). The `<main>` scrolls.
- `exit` defaults to an "Exit" link to `/`. Pass your own control when leaving should ask for confirmation first.

### ThemeToggle / useTheme
`<ThemeToggle />` is a light / system / dark segmented control. `const [theme, setTheme] = useTheme()` is available for a settings page.

### AuthLayout, CheckEmail, Logo
These are for signed-out pages only (login, signup, forgot-password, reset-password). `<Logo />` is the wordmark.

## UI components (`import { … } from '@/components/ui'`)

Each row: what it wraps, variants, and when to use it. Wrappers keep the original prop API.

| Component | Built on | Variants / props | Use for |
|---|---|---|---|
| `Button` / `buttonStyles` | shadcn `button` (cva) | `variant`: primary (one per view) / secondary / ghost / danger / link; `size`: sm 36 / md 44 / lg 52 / icon / icon-sm; `loading`, `icon` | actions. `link` is inline text size (Forgot password?, Change, Show evidence). `buttonStyles()` (alias `buttonVariants`) styles a router `<Link>`. Icon-only needs `aria-label`. |
| `Card` (+ `CardHeader/Title/Description/Content/Footer`) | shadcn `card` | `padded`, `interactive`, `tone="hero"` | a panel. Never nest. |
| `Badge`, `Chip` | shadcn `badge`, Radix `Toggle` | `tone` neutral/accent/good/warn/bad; Chip `selected` (aria-pressed) | static status; toggleable filter. Multi-line badge: `className="h-auto whitespace-normal py-1"`. |
| `Alert` | shadcn `alert` | `tone` accent/good/warn/bad, `title`, `action` | inline notices and errors (bad = `role=alert`) |
| `Input`, `Textarea`, `Select`, `controlStyles` | shadcn `input`, `textarea`, `label`; native `<select>` | `label`, `hint`, `error`, `hideLabel`; password toggle | forms. `Select` stays native (best on phones; `<option>` children). Use `Combobox` for long searchable lists. |
| `Combobox` | shadcn `popover` + `command` (cmdk) | `options` (`group`, `description`) | model pickers |
| `Segmented` | Radix `RadioGroup` | `size` sm/md, options with `aria-label` | 2-5 exclusive options (skill/part filters). One selected style: raised white segment. |
| `Tabs` | shadcn `tabs` (Radix) | `id`, `items` (`count`), `value`, `onChange` | results page sections. You render `<div role="tabpanel" id="{id}-panel" aria-labelledby="{id}-{value}">`. |
| `Switch`, `Slider` | shadcn `switch`, `slider` (Radix) | `label`, `description`/`hint` | settings. The slider thumb is the labelled control (focus it, arrows/Home/End). |
| `Dialog` / `Sheet` | shadcn `dialog` / `sheet` (Radix) | `open`, `onClose`, `title`, `description`, `footer` | Dialog for confirmations; Sheet (bottom on phones, right panel from md) for details and menus. Focus is trapped and returned. |
| `Popover` | shadcn `popover` (Radix) | `trigger={(p) => <button {...p}>}`, `children` or `(close) => …`, `align` | rich anchored content (error explanations). Collision-aware, never clipped. |
| `Tooltip`, `InfoTip` | shadcn `tooltip` / `popover` | `content`, `side` | short plain-text hints on a focusable child; InfoTip opens on hover (mouse) and on tap/click/Enter (touch). |
| `toast()` / `<Toaster/>` | sonner | `tone` neutral/good/bad, `action`, `durationMs` | confirmations ("Saved", "Added to review deck" + Undo). Bottom-centre, above the mobile tab bar. |
| `Skeleton`, `PageSkeleton`, `Spinner` | shadcn `skeleton` | | loading shaped like content; `Spinner` only for small inline waits |
| `EmptyState` | custom | `icon`, `title`, `action`, `bare` | zero data: say what will appear and offer the action. `bare` when inside a Card. |
| `ProgressRing`, `ProgressBar` | custom SVG; shadcn `progress` | `value` 0..1, `tone`, `label` | timers/goals (ring); criterion and upload bars |
| `PageHeader` | layout | `title`, `description`, `actions`, `back` | first element of every page |
| `DropdownMenu*`, `Separator`, `ScrollArea`, `Collapsible*` | shadcn, re-exported | | user menu / row actions; semantic dividers; scrollable panes; disclosure ("Show evidence") |

Available but not wrapped (import from `@/components/ui/shadcn/<name>`): `alert-dialog`, `select` (Radix), `toggle-group`, `command`.

### Button / buttonStyles
```tsx
<Button>Start</Button>                                   // primary (one per view)
<Button variant="secondary" icon={<Mic />}>Record</Button>
<Button variant="ghost" size="sm">Skip</Button>
<Button variant="link" onClick={…}>Forgot password?</Button>
<Button variant="danger" loading={isPending}>Delete</Button>
<Button size="icon" aria-label="Play"><Play /></Button>
<Link to="/writing" className={buttonStyles({ variant: 'secondary' })}>Writing</Link>
```
**Touch targets:** everything tappable is >= 44 px on phones. `sm` and `icon-sm` get an invisible 44 px area from the `hit` utility (`styles.css`); use `hit` on other compact controls. Don't put `hit` controls inside `overflow-x-auto` rows (Chip grows to `h-11` below `md` instead).

### Dialog / Sheet / Popover
```tsx
<Dialog open={o} onClose={() => setO(false)} title="Submit essay?" description="You can't edit after submitting."
  footer={<><Button variant="ghost" onClick={() => setO(false)}>Keep writing</Button><Button onClick={submit}>Submit</Button></>} />
<Sheet open={!!err} onClose={() => setErr(null)} title="Grammar: major">…details…</Sheet>
<Popover trigger={(p) => <button {...p}>has become</button>}>{(close) => <Button size="sm" onClick={close}>Got it</Button>}</Popover>
```
Content mounts only while open. Prefer inline UI before reaching for either.

### Tabs
```tsx
<Tabs id="res" value={tab} onChange={setTab} items={[{ value: 'overview', label: 'Overview' }, { value: 'transcript', label: 'Transcript', count: 12 }]} />
<div role="tabpanel" id="res-panel" aria-labelledby={`res-${tab}`}>…</div>
```
Labels: one short word. On phones tabs share the width; if they still overflow the bar scrolls, fades its right edge and keeps the active tab in view.

### Toast
```tsx
toast('Saved');
toast('Pasting is disabled in exam mode', { tone: 'bad' });
toast('Added to review deck', { tone: 'good', action: { label: 'Undo', onClick: undo } });
```

### Form + state examples
```tsx
<Input label="Email" type="email" error={err} />       <Textarea label="Notes" hint="Only you see these" rows={6} />
<Select label="Part" value={p} onChange={…}><option value="p1">Part 1</option></Select>
<Switch label="Block paste" description="Matches the real test" checked={s} onChange={setS} />
<Slider label="Target band" min={4} max={9} step={0.5} value={t} onChange={setT} format={formatBand} />
<Alert tone="bad" title="Analysis failed" action={<Button size="sm" onClick={retry}>Retry</Button>}>The service timed out.</Alert>
<EmptyState icon={<Layers />} title="No cards due" action={<Link to="/speaking" className={buttonStyles()}>Practise speaking</Link>}>Mistakes you add from results come back here.</EmptyState>
<ProgressRing value={elapsed / 120} size={96} stroke={8} tone={zoneTone} label="Answer time"><span>{formatClock(elapsed)}</span></ProgressRing>
<PageHeader title="History" description="Every attempt, newest first." actions={<Button>…</Button>} back={<Link …>← Results</Link>} />
```

## Patterns

- **Page:** `PageHeader`, then sections separated by `space-y-8`. Put section titles in an `h2.text-lg.font-semibold` with `mb-3`.
- **Lists of items:** use one `Card padded={false}` with `divide-y divide-line` rows (`px-5 py-4`, hover `hover:bg-ink/[0.03]`), not a grid of identical cards.
- **Forms:** use `space-y-4`, a full-width primary submit on mobile, and an `Alert tone="bad"` above the fields for server errors.
- **Loading / error / empty:** every data view handles all three. Error = `Alert tone="bad"` plus a retry action. Empty = `EmptyState`.
- **Charts (Recharts):** recharts is ~100 KB gz, so load chart components with `lazy()` and render them only when there is data to plot (see the dashboard). The Writing Task 1 figure (`ChartRenderer`) is plain SVG with no recharts, so the exam screen never waits on that chunk; draw tiny decorative sparklines as inline SVG. Use `stroke="var(--accent)"`, grid `var(--line)`, axis ticks `var(--muted)` at 12 px, and tooltips styled like a Popover (`bg-surface border-line rounded-card shadow-pop`).
- **Exam screens:** use `ExamShell`, large type (`text-lg`/`prose-serif`), the timer on the right of the top bar, and no other chrome.
