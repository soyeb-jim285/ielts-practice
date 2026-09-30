# Design System: IELTS Practice ("Ocean Teal")

Status: implemented in `apps/web/src/styles.css` and `apps/web/src/components/ui/**`. Living reference: `/styleguide` in the running app. Contrast gate: `node scripts/check-contrast.mjs`. Engineering usage notes: `docs/design-system.md`.

## 1. Visual Theme & Atmosphere

A calm, exacting study instrument. It should feel like a well-lit reading room with a precise measuring tool on the desk: cool slate surfaces, one deep teal accent, long-form text set in a book serif, and interface chrome set in a quiet humanist grotesque. The product's job is honest feedback on a learner's own words, so the interface stays out of the way and lets the words, the scores and the corrections carry the weight.

- Design dials: DESIGN_VARIANCE 5 (offset, not chaotic: asymmetric headers and split layouts, never centred posters), MOTION_INTENSITY 4 (fluid CSS, every animation motivated), VISUAL_DENSITY 5 (daily-app balance: hairlines and space instead of boxes).
- Density keeps to a 4px grid. Sidebar rows are 32px, buttons and inputs 36px (44px invisible hit area on phones), page gutters 40px desktop and 16px phone.
- Redesign stance: this replaced an indigo-on-warm-cream scheme, Inter, 14px panel radii and a 44px-row sidebar. Structure, routes and copy are unchanged.

## 2. Color Palette & Roles

One accent. Saturation below 80%. No purple, no glow, no pure black or white text on tinted grounds. Every pair below is verified by `scripts/check-contrast.mjs` (WCAG AA: 4.5:1 text, 3:1 icons, bars and control edges). Raw tokens are flat hex in `styles.css`; components use the Tailwind names.

### Light

| Role | Token / Tailwind | Hex | Notes |
|---|---|---|---|
| Page canvas | `--bg` `bg-bg` | `#F7F9FB` | cool, not cream |
| Surface | `--surface` `bg-card` | `#FFFFFF` | cards, inputs, popovers |
| Inset | `--surface-2` | `#EEF2F6` | wells, segmented track, secondary button |
| Sidebar | `--sidebar` | `#F1F4F8` | |
| Sidebar hover / active | `--sidebar-accent` | `#E5EBF2` | |
| Ink | `--ink` `text-ink` | `#0F172A` | navy-tinted, never `#000` |
| Muted | `--muted` `text-muted` | `#5B6B80` | secondary text, 5.4:1 on bg |
| Hairline | `--line` `border-line` | `#E3E8EF` | default border colour |
| Control edge | `--line-strong` `border-input` | `#7A8A9E` | >= 3:1, form fields, switch track |
| Brand | `--accent` `bg-brand` | `#0F766E` | white text 5.5:1 |
| Brand hover | `--accent-hover` | `#0D6861` | |
| Brand text | `--accent-text` `text-brand-text` | `#0F766E` | links, selected labels |
| Brand soft | `--accent-soft` `bg-brand-soft` | `#DDF3EF` | selected, hero, brand badge |
| Good | `--good` / `--good-text` / `--good-soft` | `#15803D` / `#166534` / `#DDF3E4` | |
| Warn | `--warn` / `--warn-text` / `--warn-soft` | `#B45309` / `#92400E` / `#FBEBD0` | |
| Bad | `--bad` / `--bad-text` / `--bad-soft` | `#BE123C` / `#BE123C` / `#FCE3EA` | white on bad 5.9:1 |
| Sky (data) | `--sky` / `--sky-text` / `--sky-soft` | `#0284C7` / `#0369A1` / `#DCF0FB` | chart series 2, info |
| Slate (data) | `--chart-3` | `#64748B` | chart series 3 |

### Dark

| Role | Token | Hex |
|---|---|---|
| Canvas | `--bg` | `#0A111C` |
| Surface | `--surface` | `#111B2B` |
| Inset | `--surface-2` | `#172338` |
| Sidebar | `--sidebar` | `#0D1522` |
| Sidebar hover / active | `--sidebar-accent` | `#172338` |
| Ink | `--ink` | `#E6EDF5` |
| Muted | `--muted` | `#8C9AAE` |
| Hairline | `--line` | `#1D293B` |
| Control edge | `--line-strong` | `#5A6B82` |
| Brand | `--accent` | `#2DD4BF` (label `#042F2C`, 9.6:1) |
| Brand hover | `--accent-hover` | `#5EEAD4` |
| Brand text | `--accent-text` | `#2DD4BF` |
| Brand soft | `--accent-soft` | `#0E2F33` |
| Good | `--good` / `-soft` | `#4ADE80` / `#0F2E1D` |
| Warn | `--warn` / `-soft` | `#FBBF24` / `#33270C` |
| Bad | `--bad` / `-soft` (label `#2B0A10`) | `#FB7185` / `#3A1621` |
| Sky | `--sky` / `-soft` | `#38BDF8` / `#0C2A3D` |
| Slate | `--chart-3` | `#94A3B8` |

Semantics: teal means "act here" or "you are here" and nothing else. Green/amber/rose mean band thresholds and real errors only (good >= target, warn within 1.0 below, bad further below). Sky and slate exist for chart series and info notes; they never become a second UI accent. Status colour always travels with a word or icon.

## 3. Typography Rules

- **UI:** Hanken Grotesk (variable, self-bundled via `@fontsource-variable`). Weights 400, 500, 600 only. Tabular lining figures wherever numbers change (`.type-num`).
- **Reading and titles:** Newsreader (variable with optical size, roman and italic). Page titles, section headings, display, essays, transcripts, prompts, cue cards, band descriptors. Italic is for emphasis inside prose only; never mix serif words into sans headings.
- **Band numerals:** Hanken Grotesk semibold, tabular (`.type-band`), in every screen, so a band looks the same wherever it appears. Serif numerals are only list indices (the 1, 2, 3 beside Speaking parts, numbered fixes).
- **Mono:** system monospace stack, 13px, tabular and slashed zero, for timestamps and code only.
- **Banned:** Inter, Geist, Roboto, system-UI as the design font; serif in buttons, nav, labels or tables; all-caps labels above every section (the `type-overline` style exists for one-off use).

| Utility | Face | Size / line-height | Weight | Tracking | Use |
|---|---|---|---|---|---|
| `type-display` | Newsreader | clamp 32-44px / 1.08 | 500 | -0.02em | auth panel, one-off display |
| `type-title` | Newsreader | clamp 30-40px / 1.08 | 500 | -0.02em | every page `h1` (PageHeader) |
| `type-title-sm` | Newsreader | clamp 26-32px / 1.15 | 500 | -0.016em | Settings title, hero-card titles, cue-card titles |
| `type-heading` | Newsreader | 22px / 1.25 | 500 | -0.012em | section headings (same voice as the title, one step down) |
| `type-subheading` | Hanken | 15px / 1.4 | 600 | -0.005em | card titles, row titles |
| `type-body` (default) | Hanken | 15px / 1.6 | 400 | 0 | interface copy |
| `type-lede` | Hanken | 15px / 1.5, ink at 74% | 400 | 0 | descriptions under titles |
| `type-reading` | Newsreader | 18px / 1.7, max 68ch | 400 | -0.003em | essays, transcripts, prompts |
| `type-reading-sm` | Newsreader | 17px / 1.45 | 400 | -0.003em | prompt titles in lists, before/after pairs, cue-card bullets |
| `type-caption` | Hanken | 13px / 1.45, `muted` | 400 | 0 | hints, metadata |
| `type-band` | Hanken | set with `text-*` | 600 | -0.025em | band numerals (tabular) |
| `type-overline` | Hanken | 11px / 1.3, caps | 600 | +0.08em | rare; one per view |
| `type-mono` | system mono | 13px | 400 | 0 | timestamps, code |
| `type-num` | (modifier) | inherits | inherits | 0 | tabular lining figures |

Named sizes `text-body` (15), `text-caption` (13) and `text-micro` (11, tab labels) exist for the odd element that needs a size but not a role; no `text-[...]` arbitrary sizes in screens.

Body line length 65-75ch. `text-wrap: balance` on headings, `pretty` on paragraphs. Minimum text size 12px (`text-xs`), only for meta.

## 4. Component Stylings

- **Buttons:** radius 8px. Variants: primary (solid teal, 1px top highlight, hover darkens), secondary (soft inset fill, no border; use it for quiet actions on the page background), outline (surface + `line-strong` edge; the secondary action next to a primary or inside a tinted panel, so it never looks disabled), ghost (hover wash), destructive (solid bad), link (brand text). Sizes: sm 32px, default 36px, lg 40px, icon 36px and icon-sm 32px; the same at every width, with a 44px invisible hit area on phones (product density, not a fatter button). Loading keeps full contrast (`aria-busy`, spinner, clicks swallowed); only true disabled fades to 50%. Active = 1px down. No glow, no gradient. One primary per view. Focus = solid 2px teal outline, 2px offset (no pale ring).
- **Cards:** 12px radius, 1px `line` border, `shadow-card` (`0 1px 2px` navy at 4%). Used only when a block is one object; never nested (insets use `surface-2` or a divider). `tone="hero"` is teal-soft, one per screen (the full test, next up, the first-run speaking tile). Lists, rows and settings groups are not cards: they sit on the page between hairlines.
- **Badges:** 6px radius, 22px tall, soft fill + 15% ring + contrast-safe text. Tones neutral, accent, good, warn, bad, info. Not pills.
- **Chips (filters):** 6px radius, 32px (44px on phones), selected = teal-soft fill + teal text.
- **Inputs:** 8px radius, 1px `line-strong` edge, surface fill, 36px (matches buttons in a row; 44px hit area on phones), focus = teal border + 1px teal ring (2px of solid teal). Label above, hint or error below, never a placeholder as label.
- **Tabs:** underline style, the 2px teal indicator slides between triggers; result pages hold them in `StickyTabs`. **Segmented:** one look everywhere (inset track, white thumb slides, 14px/500, muted to ink); 36px from md (32px `sm` in panels), options 40px tall on phones so touch targets never overlap.
- **Rows and lists:** `rowStyles` / `listStyles` (bank/ListRow.tsx): rows between hairlines, no outer card, hover wash bleeding 12px past the text, arrow only on hover or focus, group headings are plain text. **Icons in rows** are a bare 20px `IconTile`, never a boxed tile. **Kbd** for shortcut hints.
- **Overlays:** menus, popovers, tooltips 8px; dialogs and sheets 12px; all use the single overlay shadow (`0 0 0 1px` navy 6% + `0 12px 32px -8px` navy 16%). Scrim is off-navy at 55%, no blur.
- **Toasts:** sonner, 12px radius, bottom centre, above the mobile tab bar. Transient confirmations only.
- **Sidebar:** the official shadcn Sidebar. 240px, collapses to a 56px icon rail (Ctrl/Cmd+B or the trigger), grouped nav (Dashboard; Practise; Improve), 32px rows, current row = `sidebar-accent` fill + teal icon, Settings and user menu in the footer, square initial avatar. Below 768px it is replaced by a 56px bottom tab bar (4 tabs + More sheet) with a sliding top indicator.
- **Loaders:** shimmer skeletons shaped like the final content. Spinners only inside buttons.
- **Empty states:** no frame: a hairline, a 20px icon, a serif title, one or two sentences, one action, all left aligned; optionally a faded `GhostList` previewing the populated layout. Each screen has its own copy and action (Mistakes: Write an essay; Review: Browse your mistakes; History: Start practising).
- **Errors:** inline `Alert tone="bad"` with a retry. Dialogs for confirmations, sheets for detail.

## 5. Layout Principles

- **Shell:** sidebar + content. Content column max 1080px with 40px gutters (24 at sm, 16 on phones). Everything below `md` collapses to one column.
- **PageContainer** is the only width decision a page makes. Every page in the shell is `default` (1080px, one left edge), so Mistakes, Review, Settings, History and the rest never shift sideways between sidebar items; prose limits itself (`max-w-[60ch]`/68ch), the Review card is 720px and Settings groups are a 14rem heading column plus a 40rem control column, all left aligned inside it. `narrow` (720px, centred, `WIDTH.reading`) is only for exam screens (timed session, live stage, pre-screens, ExamShell). Wrap PageHeader and body together so they share one edge.
- **Page header:** Newsreader title (30-40px, 26-32px `compact` for Settings), `type-lede` description (max 60ch), actions right (wrapping under on phones), space instead of a rule below. Optional back link above. Result pages use the same header (`ResultHeader` wraps `PageHeader`) and put the overall band in a strip below it.
- **Spacing:** 4px grid. Panel padding 20px, list rows 16px x 20px, section gaps 40px, title-to-content 24-32px.
- **Radius scale:** control 8, card 12, chip and badge 6. Full only for real circles: radio, switch, mic button, progress ring, dots. No `rounded-2xl`.
- **Surfaces:** fills are tokens, never alpha tints: `surface-2` for insets, `*-soft` for tone fills. One literal white exists on purpose: the frame around raster exam figures, which are drawn on white.
- **Elevation:** flat (hairline), raised (`shadow-card`), overlay (`shadow-pop`). Nothing else.
- Grid over flex math. Full-height screens use `min-h-dvh`. Lists are one panel with dividers, not a grid of identical cards.
- **z-index:** sticky in-page bars (result tabs) 20, sidebar/tab bar 30, exam shell 40, dialog/sheet 50, popover/select/menu 60, toast above, tooltip 80. No ad-hoc values.

## 6. Motion & Interaction

Motion communicates arrival, change or feedback. Exponential ease-out only (`--ease-out-expo` cubic-bezier(0.16, 1, 0.3, 1), `--ease-out-quart`). Only `transform` and `opacity` animate (plus the tiny Segmented thumb width). Three durations: 120ms (hover, press, focus), 200ms (menus, toggles, sidebar, thumb), 320ms (page enter, list rise, tab underline, progress).

| What | Spec |
|---|---|
| Page enter | `.page-enter` on PageContainer: fade + 4px rise, 320ms |
| List stagger | `.stagger` on a list or grid: children rise 6px + fade, 40ms apart, first 8 only |
| Score count-up | `CountUp` / `Stat`: 0 to value in 600ms, ease-out-quart; final value is the initial render |
| Progress fill | `ProgressBar` mounts empty and fills in 320ms; `ProgressRing` 600ms |
| Tab indicator | `Tabs` underline slides via translateX/scaleX, 320ms |
| Segmented thumb | slides, 200ms |
| Button press | 1px translate-y, 120ms |
| Skeleton | `.shimmer` band sweeps on transform, 1.4s loop |
| Dialog / sheet / menu | tw-animate-css fade + zoom 95% or slide, 200-300ms |

`prefers-reduced-motion: reduce` collapses every animation and transition to 1ms and disables scroll smoothing (global rule in `styles.css`). Reveal animations always start from an already-legible default (`animation-fill-mode: backwards`), so a paused animation never hides content. No scroll-linked effects, no parallax, no perpetual loops except skeletons and the recording indicator.

## 7. Iconography

Lucide only, 1.75 stroke set once in CSS (`.lucide { stroke-width: 1.75 }`). 16px inside buttons and inline with text, 20px in navigation, rows and empty states (bare, no box), 36px only for the recording control. Badge glyphs and trend arrows are the two 14px exceptions. Icons accompany words; icon-only controls need `aria-label`; an icon that carries meaning on its own gets `role="img"` plus a label, a decorative one `aria-hidden`. No emoji, no hand-drawn SVG except the serif monogram mark.

## 8. States

- **Loading:** shimmer skeleton in the final layout's shape; route-level `PageSkeleton` after 1s.
- **Empty:** `EmptyState` (what appears here, how to fill it, one button).
- **Error:** inline `Alert tone="bad"` (role=alert) with what failed and a retry; route errors use `ErrorPage`.
- **Success:** toast for transient saves, inline `Alert tone="good"` when the user must read it.
- **Disabled:** 50% opacity, no hover; a disabled control still has its label.

## 9. Anti-Patterns (Banned)

- No coloured glow shadows, gradient blobs, gradient text, glass blur, or pure black text.
- No Inter or Geist. No serif outside reading surfaces and page titles.
- No `rounded-2xl` everywhere; no pill badges; no emoji as icons; no avatar circles as the only avatar shape.
- No nested bordered cards; no identical three-up card rows; no centred-everything heroes.
- No coloured side-stripe borders on cards or alerts; no decorative status dots; no numbered section eyebrows.
- No second accent colour; no status colour used as decoration.
- No cream, sand or beige surfaces; no indigo-to-purple gradients.
- No em dashes in UI copy; no "Oops!", no exclamation marks in success messages, no filler verbs (elevate, seamless, unleash).
- No hard-coded hex, pixel radii or one-off control heights in screens; use tokens.
- No animation of layout properties, no `window` scroll listeners, no motion without a reason.
