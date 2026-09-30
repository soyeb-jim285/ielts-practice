# Web design system

Everything here lives in `apps/web/src`. Reuse it; don't restyle primitives per page. If something is missing, add it to `components/ui/` rather than inlining a one-off.

- **Spec:** `/DESIGN.md` (tokens, type scale, motion, anti-patterns). **Living reference:** run the app and open `/styleguide` (every swatch with live contrast, type specimens, every component and variant, motion demos, states). **Contrast gate:** `node scripts/check-contrast.mjs` checks every text/background pair in `src/lib/contrastPairs.json` against WCAG AA in both themes; run it after touching a colour in `styles.css`.

## Principles

- **Calm and exact.** "Ocean Teal": cool slate surfaces, one teal accent, semantic colour only when it means something (good / warn / bad). Hairline borders and space do the grouping, not boxes.
- **Two typefaces, one job each.** Hanken Grotesk for the interface; Newsreader for page titles and everything the learner reads or writes (essays, transcripts, prompts, cue cards, descriptors).
- **Mobile-first.** Build at 390 px first. The AppShell switches from a bottom tab bar to the sidebar at `md` (768 px).
- **Accessible by default.** Every control has a visible label or `aria-label`, a visible focus ring, and keyboard support. Colour never carries meaning alone. Text >= 4.5:1, icons/bars/control edges >= 3:1 (gated by the script above).
- **Motion conveys state.** 120 / 200 / 320 ms, exponential ease-out, transform and opacity only. Reduced motion is handled globally.
- **Primitives are shadcn/ui.** `components/ui/shadcn/*` is the vendored shadcn (new-york) source, restyled to our tokens; `components/ui/*.tsx` are thin wrappers that keep our prop API. The app shell uses the official shadcn `Sidebar`. Screens import only from `@/components/ui`.

### Do / don't

- **Do** use exactly one primary (`Button variant="primary"`) per view; everything else is `secondary`, `outline`, `ghost` or `link`.
- **Do** wrap every page in `<PageContainer>` and start it with `<PageHeader>`. Every app page is `default` (1080 px, one left edge); `narrow` (720 px, centred) is for exam screens only. Constrain prose inside the page (`max-w-[60ch]`), not the page itself.
- **Do** use one hero block (`<Card tone="hero">`) per screen for the "do this next" action.
- **Don't** nest bordered cards. Inside a Card use dividers (`divide-y divide-line`) or a `bg-surface-2` inset. `EmptyState` inside a Card takes `bare`.
- **Don't** use a coloured side-stripe border, gradient text, glows or glass blur; no `rounded-2xl`, no pill badges, no emoji icons.
- **Do** put text the learner reads or writes in Newsreader (`type-reading`), everything else in Hanken Grotesk. Numbers that change use `type-num`.
- **Do** build destructive flows as `Dialog` (confirm) + `Button variant="destructive"`; detail views as `Sheet`; explanations as `Popover`/`InfoTip`.
- **Don't** hard-code hex, px radii or one-off control heights. Use tokens and the sizes below.
- **Don't** use `text-muted` for anything that must read as primary; it is secondary text (5.4:1 on `bg`).

## Tokens (Tailwind class names)

Raw tokens live in `styles.css` (`:root` light, `.dark` dark) as flat hex so the contrast script can read them. `@theme inline` exposes them as Tailwind colours, so every class adapts to the theme. Never hard-code hex values.

| Role | Classes | Use |
|---|---|---|
| Page background | `bg-bg` / `bg-background` | body |
| Surface | `bg-surface` / `bg-card` | panels, popovers, inputs |
| Inset | `bg-surface-2` / `bg-secondary` | insets inside panels, segmented track, secondary button, disabled inputs |
| Sidebar | `bg-sidebar`, `bg-sidebar-accent` | sidebar and its hover/active row |
| Text | `text-ink` / `text-foreground`, `text-muted` / `text-muted-foreground` | body; secondary (passes 4.5:1) |
| Lines | `border-line` / `border-border`, `border-line-strong` / `border-input` | dividers and panel edges (the default border colour); form-control edges, switch tracks, hover borders (>= 3:1) |
| Brand | `bg-brand text-brand-ink`, `hover:bg-brand-hover`, `text-brand-text`, `bg-brand-soft` (+ `bg-primary text-primary-foreground`, `ring-ring`) | primary actions, selection, links |
| Hover wash | `bg-hover` (5% ink light, 7% dark) | ghost hover, menu-item focus (shadcn's "accent" role) |
| Semantic fills | `bg-good` `bg-warn` `bg-bad`; `bg-destructive text-destructive-foreground` | chart marks, dots, progress; destructive |
| Semantic text | `text-good-text` `text-warn-text` `text-bad-text` `text-sky-text` | text in these colours (contrast-safe) |
| Semantic tints | `bg-good-soft` `bg-warn-soft` `bg-bad-soft` `bg-sky-soft` | badges, alerts (alerts use them at 50%) |
| Data | `bg-chart-1` teal, `bg-chart-2` / `bg-sky`, `bg-chart-3` slate, `bg-chart-4` warn, `bg-chart-5` bad | chart series |
| Radius | `rounded-sm` 6 (badge, chip, menu item), `rounded-md` 8 (controls, popovers), `rounded-lg` 12 (cards, dialogs, sheets; `rounded-card`), `rounded-full` (avatars, switches) | from `@theme` in `styles.css` |
| Shadow | `shadow-card`, `shadow-pop`, `shadow-(--highlight)` | resting panels; floating layers; 1px top light on filled buttons |
| Fonts | `font-sans` (Hanken Grotesk), `font-serif` (Newsreader, upright, weight axis only), `font-mono` | UI; titles and reading. The two latin files are preloaded from `vite.config.ts`; don't add italic/opsz/extra subsets. |
| Easing | `ease-(--ease-out-expo)`, `ease-(--ease-out-quart)` | transitions |

**Legacy names (kept so screens compile):** `bg-accent` / `text-accent-text` / `bg-accent-soft` / `text-accent-ink` / `bg-accent-hover` (same values as `brand-*`). **Collision note:** in shadcn, `accent` means the neutral hover wash and `muted` a neutral *surface*; in our code `accent` is the brand teal and `muted` is text. The vendored shadcn sources therefore use `bg-hover` and `bg-surface-2` instead of `bg-accent` / `bg-muted`. After `shadcn add <x>`, run `sed -i -E 's/accent-foreground/ink/g; s/\bbg-accent\b/bg-hover/g; s/\bbg-muted\b/bg-surface-2/g' src/components/ui/shadcn/<x>.tsx`, fix `import { cn } from "cn"` to `"@/lib/utils"`, and check it. Do not let `shadcn add` overwrite `styles.css` or the existing primitives (it will: restore from git).

When you need raw CSS values (SVG strokes, Recharts colours, inline styles) use the variables: `var(--accent)`, `var(--good)`, `var(--warn)`, `var(--bad)`, `var(--sky)`, `var(--chart-3)`, `var(--muted)`, `var(--line)`, `var(--ink)`, `var(--surface)`.

**Band colours:** good when band >= target, warn 0.5-1.0 below, bad 1.5+ below (`bandColor` in `lib/result.ts`, `Tone` type).

**Surfaces (3 levels + hero):** page (`bg`) > panel (`surface`, 1 px line, `shadow-card`) > inset (`surface-2`, no border, controls only). The hero is a panel tinted `brand-soft` at 55%. Dark mode lifts panels off the page by colour (`#111B2B` on `#0A111C`) and drops the shadow.

**Type scale** (utilities in `styles.css`; use these instead of ad-hoc `text-*` combos for headings and prose):

| Utility | Face / size / weight | Use |
|---|---|---|
| `type-display` | Newsreader, 32-44 px, 500 | auth panel, big moments |
| `type-title` | Newsreader, 26-32 px, 500 | page `h1` (PageHeader does this for you) |
| `type-heading` | Hanken, 18 px, 600 | section headings |
| `type-subheading` | Hanken, 15 px, 600 | card and row titles |
| `type-body` | Hanken, 15 px / 1.6 | default interface copy |
| `type-reading` (`prose-serif`) | Newsreader, 18 px / 1.7, max 68ch | essays, transcripts, prompts, cue cards |
| `type-caption` | Hanken, 13 px, muted | hints, metadata |
| `type-overline` | 11 px caps, muted | rare, one per view |
| `type-mono` | system mono, 13 px | timestamps |
| `type-num` | modifier | tabular lining figures for scores, timers, counts |

`text-xs` (12 px) is the floor. Control labels are weight 500.

**Spacing scale (4 px base):** `1 / 2 / 3 / 4 / 6 / 8 / 10 / 12` (4, 8, 12, 16, 24, 32, 40, 48 px). Panel padding `p-5`; list rows `px-5 py-4`; page sections `space-y-10`; shell gutters 16 / 24 / 40 px.

**Control heights (product density):** `sm` 32 px, default 36 px (buttons, inputs, selects, combobox, Segmented md), `lg` 40 px, `icon` 36 px, `icon-sm` 32 px, the same at every width; phones get a 44 px invisible hit area via `hit` (Segmented instead makes its options 40 px tall). Icons: lucide at 1.75 stroke (set once in CSS), 16 px inline and in buttons, 20 px in nav and empty states.

**Motion utilities:** `.page-enter` (PageContainer applies it), `.stagger` (put on a list/grid wrapper: children rise 40 ms apart), `.shimmer` (Skeleton). `CountUp` and `Stat` count scores up; `ProgressBar` / `ProgressRing` fill from empty on mount.

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
Used automatically by `_app.tsx`. Desktop: the official shadcn `Sidebar` (240 px, collapses to a 56 px icon rail; Ctrl/Cmd+B or the header trigger; state remembered in the `sidebar_state` cookie), grouped Dashboard / Practise (Speaking, Writing, Prompt bank) / Improve (Mistakes, Review, History), Settings and a user menu (name, email, style guide, sign out; the theme lives in Settings) in the footer. Phones: a bottom tab bar (Home, Speak, Write, Review, More, which opens a Sheet with the rest and the theme). The shell provides the gutters and a 1080 px column; **wrap each page in `<PageContainer>` and start it with `<PageHeader>`.**

### PageContainer / PageHeader
`PageContainer` is the only width decision a page makes: `default` 1080 px for every page, `narrow` 720 px (centred) for exam screens, plus the page-enter fade. `WIDTH` exports the two class strings (ExamShell uses `WIDTH.reading`). `PageHeader` renders the Newsreader title, a `type-lede` description, actions at the right, and an optional back link; `compact` is the smaller title for Settings. There is no rule under it: space does the work. Both are in `@/components/ui`.

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
| `Button` / `buttonStyles` | shadcn `button` (cva) | `variant`: primary (one per view) / secondary / outline / ghost / destructive (alias `danger`) / link; `size`: sm 32 / md 36 / lg 40 / icon / icon-sm; `loading`, `icon` | actions. `link` is inline text size (Forgot password?, Change, Show evidence). `buttonStyles()` (alias `buttonVariants`) styles a router `<Link>`. Icon-only needs `aria-label`. |
| `Card` (+ `CardHeader/Title/Description/Content/Footer`) | shadcn `card` | `padded`, `interactive`, `tone="hero"` | a panel. Never nest. |
| `Badge`, `Chip` | shadcn `badge`, Radix `Toggle` | `tone` neutral/accent/good/warn/bad/info; Chip `selected` (aria-pressed) | static status; toggleable filter. Multi-line badge: `className="h-auto whitespace-normal py-1"`. |
| `Alert` | shadcn `alert` | `tone` accent/good/warn/bad/info, `title`, `action` | inline notices and errors (bad = `role=alert`) |
| `Input`, `Textarea`, `Select`, `controlStyles` | shadcn `input`, `textarea`, `label`; native `<select>` | `label`, `hint`, `error`, `hideLabel`; password toggle | forms. `Select` stays native (best on phones; `<option>` children). Use `Combobox` for long searchable lists. |
| `Combobox` | shadcn `popover` + `command` (cmdk) | `options` (`group`, `description`) | model pickers |
| `Segmented` | Radix `RadioGroup` | `size` sm (32 px, in panels) / md (toolbar, same height as Input), options with `aria-label` | 2-5 exclusive options (skill/part filters). One look everywhere; options are 40 px tall on phones so touch targets never overlap. |
| `Tabs` | shadcn `tabs` (Radix) | `id`, `items` (`count`), `value`, `onChange` | results page sections. You render `<div role="tabpanel" id="{id}-panel" aria-labelledby="{id}-{value}">`. |
| `Switch`, `Slider` | shadcn `switch`, `slider` (Radix) | `label`, `description`/`hint` | settings. The slider thumb is the labelled control (focus it, arrows/Home/End). |
| `Dialog` / `Sheet` | shadcn `dialog` / `sheet` (Radix) | `open`, `onClose`, `title`, `description`, `footer` | Dialog for confirmations; Sheet (bottom on phones, right panel from md) for details and menus. Focus is trapped and returned to whatever opened it (remembered at open time), or to `returnFocusRef` when the opener is not the focused element (tab-bar "More"). |
| `Popover` | shadcn `popover` (Radix) | `trigger={(p) => <button {...p}>}`, `children` or `(close) => …`, `align` | rich anchored content (error explanations). Collision-aware, never clipped. |
| `Tooltip`, `InfoTip` | shadcn `tooltip` / `popover` | `content`, `side` | short plain-text hints on a focusable child; InfoTip opens on hover (mouse) and on tap/click/Enter (touch). |
| `toast()` / `<Toaster/>` | sonner | `tone` neutral/good/bad, `action`, `durationMs` | confirmations ("Saved", "Added to review deck" + Undo). Bottom-centre, above the mobile tab bar. sonner loads on the first toast, not with the entry. |
| `Skeleton`, `PageSkeleton`, `Spinner` | shadcn `skeleton` | | loading shaped like content; `Spinner` only for small inline waits |
| `EmptyState`, `GhostList` | custom | `icon`, `title`, `action`, `preview`, `bare`, `as` | zero data: no frame, hairline + serif title + one or two lines + one action; `preview={<GhostList/>}` exists but the app does not use it: greyed rows under a finished message read as a stuck loader (mistakes and history show the message and its action alone). Skeletons are for `isPending` only. Give each screen its own copy and action. |
| `IconTile` | custom | `tone` muted / brand | the one icon slot for rows and empty states: a bare 20 px icon, no box |
| `Kbd` | custom | `onBrand` | keyboard shortcut hint |
| `StickyTabs` | custom | | wraps a tab bar (and the audio strip) so it sticks under the top edge at z-20 and bleeds over the shell gutter (`--gutter`) |
| `ProgressRing`, `ProgressBar` | custom SVG; shadcn `progress` | `value` 0..1, `tone`, `label` | timers/goals (ring); criterion and upload bars |
| `PageContainer`, `WIDTH` | layout | `width` default / narrow | wraps every page (width contract, page-enter) |
| `PageHeader` | layout | `title`, `description`, `actions`, `back`, `compact` | first element of every page; `ResultHeader` (results) wraps it and adds the overall-band strip |
| `Stat`, `CountUp` | custom | `label`, `value` (number counts up), `decimals`, `unit`, `delta`, `hint`, `size` | a score, count or streak with its label; `dl` parent |
| `DropdownMenu*`, `Separator`, `ScrollArea`, `Collapsible*` | shadcn, re-exported | | user menu / row actions; semantic dividers; scrollable panes; disclosure ("Show evidence") |

Available but not wrapped (import from `@/components/ui/shadcn/<name>`): `alert-dialog`, `select` (Radix), `toggle-group`, `command`.

### Button / buttonStyles
```tsx
<Button>Start</Button>                                   // primary (one per view)
<Button variant="secondary" icon={<Mic />}>Record</Button>
<Button variant="ghost" size="sm">Skip</Button>
<Button variant="link" onClick={…}>Forgot password?</Button>
<Button variant="destructive" loading={isPending}>Delete</Button>
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

- **Page:** `<PageContainer>` > `PageHeader`, then sections separated by `space-y-10`. Section titles are `type-heading` (Newsreader 22 px), via `PanelHeader` from `bank/ListRow` when there is an aside on the right.
- **Lists of items:** no card. `listStyles` (hairline above and below, divided rows) with `rowStyles` rows, `RowIcon` (bare 20 px), `RowText`, `RowChevron` (arrow on hover only) from `components/bank/ListRow`. One tinted `Card tone="hero"` per page at most.
- **Type:** bands are `type-band` (Hanken, tabular), prompts and the learner's words are Newsreader (`type-reading`, `type-reading-sm`), descriptions `type-lede`. No `text-[...]` sizes: `text-body`, `text-caption`, `text-micro` exist for the odd case.
- **Forms:** use `space-y-4`, a full-width primary submit on mobile, and an `Alert tone="bad"` above the fields for server errors.
- **Loading / error / empty:** every data view handles all three. Error = `Alert tone="bad"` plus a retry action. Empty = `EmptyState`.
- **Charts:** the dashboard's criteria trend is plain SVG (`components/dashboard/Charts.tsx`, fixed-height container, no chunk to wait for). recharts is ~100 KB gz: where it is still used, load it with `lazy()` and render only when there is data to plot. The Writing Task 1 figure (`ChartRenderer`) is plain SVG with no recharts, so the exam screen never waits on that chunk; draw tiny decorative sparklines as inline SVG. Series colours are `var(--accent)` (teal), `var(--sky)`, `var(--chart-3)`; grid `var(--line)`, axis ticks `var(--muted)` at 12 px, and tooltips styled like a Popover (`bg-surface border-line rounded-md shadow-pop`).
- **Exam screens:** use `ExamShell`, large type (`text-lg`/`type-reading`), the timer on the right of the top bar, and no other chrome.

## Redesign status

Ocean Teal palette, Hanken Grotesk + Newsreader, shadcn sidebar, motion and the style guide are implemented across every screen. Checks at the last pass: `pnpm typecheck`, `vitest` (60 of 60), `vite build`, the Playwright smoke and auth specs, `node scripts/check-contrast.mjs` (all pairs pass), a keyboard pass (focus return from the More sheet and the delete dialog, solid teal focus outline on links and buttons), a heading-outline check on every route (one h1, no skipped levels), zero console errors, and screenshots of every screen at 1440 and 390 in light and dark (`.eval/redesign/polisher/`, not committed).

What the polish pass settled:

- **One width.** Every page is 1080 px with one left edge; Mistakes, Review and Settings constrain their own content instead of narrowing the page. Settings is a 14 rem heading column beside a 40 rem column of plain rows.
- **Lists are not cards.** Dashboard, hubs, bank, history and mistakes are hairline-divided rows on the page; tinted hero cards are the only filled blocks. The boxed icon tile is gone (bare `IconTile`), the chevron shows on hover, group headings are plain text.
- **Type roles.** Section headings moved to Newsreader; `type-lede`, `type-reading-sm`, `type-band` and the `text-body` / `text-caption` / `text-micro` sizes replace the hand-rolled rem values. Bands are Hanken everywhere. `cn()` knows the named sizes (tailwind-merge otherwise reads `text-body` as a colour and drops `text-primary-foreground`).
- **Accessibility.** Focus is a solid teal outline everywhere (the pale 35% ring is gone); overlays return focus to their opener; Switch has a hit area; Segmented options no longer overlap; icons that carry meaning have `role="img"`; loading buttons keep full contrast.
- **Empty states** are framed by a hairline only, each with its own copy and action, and preview the populated list.
- **Auth** is a left-aligned form near the top of the viewport beside one real sample of the feedback (no fake product cards).

Open points:

- A second editor changed button, input and select heights to 36 px and made `secondary` a borderless soft fill while this pass was running (DESIGN.md section 4 follows that). Screens that put a quiet action beside a primary now use `outline`, so it never reads as disabled. `Segmented` md is 36 px to match.
- `text-sm text-muted` (14 px) is still used for secondary notes inside panels; `type-caption` (13 px) for hints. Converging them is cosmetic.
- Reduced-motion behaviour relies on the global rule in `styles.css` and was checked in code only for the examiner voice bars.

## Bundle budget

`vite.config.ts` splits the build so signed-out pages (`/login`, `/signup`) load only the `ui-core` chunk (button, input, alert, `cn`): menus, dialogs, sliders, popovers and the command palette live in `overlay`, which only lazy app routes import. Keep it that way: import from `@/components/ui` (the barrel is side-effect-free), never add top-level side effects to `components/ui/**`, and put heavy libraries behind `lazy()`/dynamic `import()`.
