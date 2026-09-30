# Web design system

Everything here lives in `apps/web/src`. Reuse it; don't restyle primitives per page. If something is missing, add it to `components/ui/` (ask the owner) rather than inlining a one-off.

## Principles

- **Calm and focused.** Warm neutral surfaces, one accent (indigo), and semantic colour only when it means something: good / warn / bad.
- **Mobile-first.** Build at 390 px first. The AppShell switches to a sidebar at `md` (768 px).
- **Accessible by default.** Every control has a visible label or `aria-label`, a visible focus ring (global `:focus-visible`), and keyboard support. Colour never carries meaning alone: pair it with text or an icon.
- **Motion conveys state.** Use 150–250 ms and `ease-(--ease-out-quart)`. Reduced motion is handled globally.
- **No nested cards and no coloured side-stripe borders.** Inside a Card, use `bg-surface-2` insets or `border-line` dividers.

## Tokens (Tailwind class names)

Tokens are defined in `styles.css` (`:root` for light, `.dark` for dark) and exposed through `@theme inline`, so every class adapts to the theme automatically. Never hard-code hex values.

| Role | Classes | Use |
|---|---|---|
| Page background | `bg-bg` | body |
| Surface | `bg-surface` | cards, popovers, inputs |
| Second surface | `bg-surface-2` | sidebar, insets inside cards, input wells |
| Text | `text-ink`, `text-muted` | body text, secondary text (muted passes 4.5:1) |
| Lines | `border-line`, `border-line-strong` | `line` for dividers and card edges; `line-strong` (≥3:1) for form-control edges, switch tracks and hover borders |
| Accent | `bg-accent text-accent-ink`, `hover:bg-accent-hover`, `text-accent-text` (links and text), `bg-accent-soft` | primary actions, current selection |
| Semantic fills | `bg-good` `bg-warn` `bg-bad`; `text-bad-ink` on a solid `bg-bad` | chart marks, dots, progress; danger buttons |
| Semantic text | `text-good-text` `text-warn-text` `text-bad-text` | text in these colours (contrast-safe) |
| Semantic tints | `bg-good-soft` `bg-warn-soft` `bg-bad-soft` | badges, highlights, error underlines' backgrounds |
| Hover wash | `hover:bg-ink/5` | ghost buttons, list rows |
| Radius | `rounded-card` (14 px), `rounded-control` (10 px), `rounded-full` | cards/sheets, buttons/inputs, chips |
| Shadow | `shadow-card`, `shadow-pop` | resting surfaces, floating layers |
| Fonts | `font-sans` (Inter, the default), `font-serif` (Source Serif 4) | UI, essays/transcripts/prompts. Self-hosted variable woff2 (latin) in `public/fonts`, declared in `styles.css`; Inter is preloaded in `index.html`. |
| Prose | `prose-serif` | serif 17 px/1.7, max 68ch: essays, transcripts, reading prompts |
| Easing | `ease-(--ease-out-quart)` | transitions |

When you need raw CSS values (SVG strokes, Recharts colours, inline styles), use the variables: `var(--accent)`, `var(--good)`, `var(--warn)`, `var(--bad)`, `var(--muted)`, `var(--line)`, `var(--ink)`, `var(--surface)`.

**Chart series** (per criterion) use the non-semantic categorical palette in `components/dashboard/criteria.ts` (indigo, teal, violet, slate) so green/amber/red always mean good/warn/bad.

**Band colours:** good when band ≥ target, warn when it's 0.5–1.0 below, bad when 1.5 or more below (`bandColor` in `lib/result.ts`). Map the result to the `Tone` type.

**Type scale** (fixed rem, no fluid type): page h1 `text-2xl md:text-[1.75rem] font-semibold tracking-tight` (use PageHeader), section h2 `text-lg font-semibold`, card title `text-base font-semibold`, body `text-[0.9375rem]`, meta `text-sm text-muted`, micro `text-xs text-muted`. Numbers get `tabular-nums`. Big band numbers: `text-5xl font-semibold tracking-tight tabular-nums`.

**Z-index scale:** sidebar/tab bar `z-30` · ExamShell `z-40` · dialog `z-50` · popover/listbox `z-[60]` · toast `z-[70]` · tooltip `z-[80]`. Native `<dialog>` and popovers use the top layer anyway.

**Dark mode:** the `.dark` class on `<html>` is set before paint from `localStorage.theme` (`light`/`dark`) or the system preference. Use the `dark:` variant only when a token isn't enough.

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

### Button / buttonStyles
```tsx
<Button>Start</Button>                                   // primary (one per view)
<Button variant="secondary" icon={<Mic />}>Record</Button>
<Button variant="ghost" size="sm">Skip</Button>
<Button variant="danger" loading={isPending}>Delete</Button>
<Button size="icon" aria-label="Play"><Play /></Button>  // icon-only needs aria-label
<Link to="/writing" className={buttonStyles({ variant: 'secondary' })}>Writing</Link>
```
Variants are `primary | secondary | ghost | danger`. Sizes are `sm (32) | md (40) | lg (48) | icon (40²)`. `loading` disables the button and shows a spinner.

**Touch targets:** everything tappable is ≥ 44 px on phones. `sm` buttons and Segmented options keep their look and get an invisible 44 px hit area from the `hit` utility (styles.css); use `hit` on any other compact control (icon links). Don't put `hit` controls inside `overflow-x-auto` rows (the overhang makes the row scroll vertically); Chip instead grows to `h-11` below `md`.

### Card
`<Card>` is a padded surface with a border and `shadow-card`. Pass `padded={false}` for edge-to-edge content (lists, charts with their own padding). Pass `interactive` for a clickable card (hover lift); wrap it in a `<Link>` or make it a button yourself. **Never nest.**

### Badge, Chip, Tone
```tsx
<Badge tone="good">On topic</Badge>   // tone: neutral | accent | good | warn | bad
<Chip selected={f === 'grammar'} onClick={() => setF('grammar')}>Grammar</Chip>   // filter chip, aria-pressed
```
`TONE_STYLES[tone]` gives you the soft-bg plus text classes for your own elements.

### Alert
```tsx
<Alert tone="bad" title="Analysis failed" action={<Button size="sm" onClick={retry}>Retry analysis</Button>}>The transcription service timed out.</Alert>
```
Tones are `accent | good | warn | bad`. A `bad` alert gets `role=alert`.

### Input, Textarea, Select, controlStyles
These are labelled controls with `hint` and `error` support (the error sets `aria-invalid` and `aria-describedby`).
```tsx
<Input label="Email" name="email" type="email" error={err} />
<Input label="Password" type="password" />          // gets a show/hide toggle
<Textarea label="Notes" hint="Only you see these" rows={6} />
<Select label="Part" value={p} onChange={…}><option value="p1">Part 1</option></Select>
<Input label="Search prompts" hideLabel placeholder="Search…" />
```
For a bare control with a custom layout, use the `controlStyles` class string.

### Combobox
A searchable single-select for long lists (the model pickers).
```tsx
<Combobox label="Scoring model" options={models.map(m => ({ value: m.id, label: m.name, description: m.id }))} value={v} onChange={setV} />
```

### Segmented
Use it for 2–5 exclusive options (a radiogroup driven by the arrow keys).
```tsx
<Segmented label="Mode" value={mode} onChange={setMode} options={[{ value: 'practice', label: 'Practice' }, { value: 'exam', label: 'Exam' }]} />
```
`size="sm"` is available. For icon-only options, give each one an `'aria-label'`.

### Tabs
This is the underlined tab bar used by the results pages. On phones the tabs share the width with tighter padding, so five short labels fit in 360 px; if they still don't fit, the bar scrolls, fades its right edge while tabs are hidden, and keeps the active tab in view. Keep labels to one short word. It is controlled, and you render the panel yourself:
```tsx
<Tabs id="res" value={tab} onChange={setTab} items={[{ value: 'overview', label: 'Overview' }, { value: 'transcript', label: 'Transcript', count: 12 }]} />
<div role="tabpanel" id="res-panel" aria-labelledby={`res-${tab}`}>…</div>
```
You can sync `tab` to a search param with `validateSearch` so it survives a reload.

### Switch / Slider
```tsx
<Switch label="Block paste in exam mode" description="Matches the real test" checked={s} onChange={setS} />
<Slider label="Target band" min={4} max={9} step={0.5} value={t} onChange={setT} format={formatBand} />
```

### Dialog / Sheet
These are controlled native `<dialog>` elements, which give you the focus trap, Esc and backdrop-click to close. Content mounts only while open.
```tsx
<Dialog open={o} onClose={() => setO(false)} title="Submit essay?" description="You can't edit after submitting."
  footer={<><Button variant="ghost" onClick={() => setO(false)}>Keep writing</Button><Button onClick={submit}>Submit</Button></>} />
<Sheet open={!!err} onClose={() => setErr(null)} title="Grammar · major">…details…</Sheet>
```
- Use Dialog for confirmations.
- Use Sheet (a bottom sheet on mobile, a right panel on desktop) for details and menus.
- Prefer inline UI before reaching for either.

### Popover
An anchored bubble that uses the native Popover API: light-dismiss, Esc, and the top layer, so it is never clipped. The trigger must be a `<button>` with the provided props spread onto it.
```tsx
<Popover trigger={(p) => <button {...p} className="underline decoration-bad">has become</button>}>
  {(close) => <><p>…explanation…</p><Button size="sm" onClick={() => { addCard(); close(); }}>Add to review</Button></>}
</Popover>
```
`align` is `start | center | end`. On mobile, a Sheet is often the better choice for rich content.

### Tooltip / InfoTip
Use these for short plain-text hints on a focusable child. For the ⓘ next to a metric, use `InfoTip`.
```tsx
<Tooltip content="Words per minute, pauses excluded"><button>…</button></Tooltip>
<span className="inline-flex items-center gap-1">Articulation rate <InfoTip>Syllables per second while speaking…</InfoTip></span>
```

### Toast
```tsx
toast('Saved');
toast('Pasting is disabled in exam mode', { tone: 'bad' });
toast('Added to review deck', { tone: 'good', action: { label: 'Undo', onClick: undo } });
```
`<Toaster/>` is already mounted in `__root`.

### Skeleton, PageSkeleton, Spinner
Use `<Skeleton className="h-6 w-40" />` shaped like the content it stands in for. `PageSkeleton` is the route-level placeholder. Use `<Spinner label="Analysing" />` only for small inline waits; buttons use `loading`.

### EmptyState
Tell the user what will appear here and give them the action that creates it:
```tsx
<EmptyState icon={<Layers />} title="No cards due" action={<Link to="/speaking" className={buttonStyles()}>Practise speaking</Link>}>
  Mistakes you add from results come back here on a spaced schedule.
</EmptyState>
```

### ProgressRing
Values run from 0 to 1. Use it for timers (with the tone switching by zone), goals and small scores.
```tsx
<ProgressRing value={elapsed / 120} size={96} stroke={8} tone={zoneTone} label="Answer time"><span className="text-lg font-semibold">{formatClock(elapsed)}</span></ProgressRing>
```

### PageHeader
```tsx
<PageHeader title="History" description="Every attempt, newest first." actions={<Button>…</Button>} back={<Link …>← Results</Link>} />
```

## Patterns

- **Page:** `PageHeader`, then sections separated by `space-y-8`. Put section titles in an `h2.text-lg.font-semibold` with `mb-3`.
- **Lists of items:** use one `Card padded={false}` with `divide-y divide-line` rows (`px-5 py-4`, hover `hover:bg-ink/[0.03]`), not a grid of identical cards.
- **Forms:** use `space-y-4`, a full-width primary submit on mobile, and an `Alert tone="bad"` above the fields for server errors.
- **Loading / error / empty:** every data view handles all three. Error = `Alert tone="bad"` plus a retry action. Empty = `EmptyState`.
- **Charts (Recharts):** recharts is ~100 KB gz, so load chart components with `lazy()` and render them only when there is data to plot (see the dashboard); draw tiny decorative sparklines as inline SVG. Use `stroke="var(--accent)"`, grid `var(--line)`, axis ticks `var(--muted)` at 12 px, and tooltips styled like a Popover (`bg-surface border-line rounded-card shadow-pop`).
- **Exam screens:** use `ExamShell`, large type (`text-lg`/`prose-serif`), the timer on the right of the top bar, and no other chrome.
