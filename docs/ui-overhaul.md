# UI overhaul: audit, direction, shadcn map

Audited on branch `ui-shadcn` at 390x844 and 1440x900, light and dark, with a fresh user (screenshots in `.eval/ui/audit/`, gitignored). Source is `apps/web/src`.

**Coverage.** Captured in all four configs: login, signup, dashboard (empty and with data), speaking chooser, speaking session (idle and recording), writing home, writing editor, writing submit dialog, writing result (all 5 tabs), live pre-screen, bank, mistakes, review, history, settings.
**Not captured:** the speaking result tabs. The local stack has no object storage, so the audio upload never completes and the attempt lands on the "Not submitted" failed state (this is itself a screen, captured). Speaking result findings below come from reading `components/speaking/*` and `components/results/*`, plus the shared chrome (header, tabs, criteria grid) that the writing result renders identically.

The foundation is better than most: tokens are disciplined, no raw hex or Tailwind palette colours in components, and focus and touch targets are handled. The problems are not broken primitives. They are (a) too many *different answers to the same question* (three filter controls, three selectable-tile styles, several card-in-card patterns), (b) a flat, slightly "default" feel (everything is a white 1px-bordered box at the same weight, so nothing leads), and (c) hand-rolled primitives that lack the small finishing details shadcn/Radix gives for free.

---

## 1. Inconsistency list

### Spacing and layout
- **No page-level rhythm.** Pages mix `space-y-8` (speaking/index.tsx), `mb-3` h2s and ad-hoc `mt-1.5/mt-2/mt-5` inside cards. Card padding is `p-5` in `Card`, but list rows use `px-5 py-4`, onboarding steps use their own, result cards use `p-4/p-6` variants. On mobile the gutter is 16 px but Cards use 20 px inner padding, so text sits 36 px from the edge (dashboard mobile).
- **Content width is inconsistent on desktop.** `AppShell.tsx:93` gives every page `max-w-5xl`, but content inside then caps itself differently: `review.tsx:79` `max-w-2xl`, `EmptyState` `max-w-sm` inside a full-width dashed box (mistakes/review/history show a 900 px dashed rectangle with a 380 px message), bank filters `sm:max-w-xl`. Result: ragged right edges and large dead areas at 1440 (mistakes, review, history, settings read left-heavy).
- **Sidebar/content relationship.** The sidebar (`bg-sidebar`, 240 px) and page bg differ by a hair in light mode; the boundary is carried by a 1 px line only.

### Radii
- Scale is `rounded-card` 14, `rounded-control` 10, `rounded-full`, and then strays: `rounded-lg` (Tooltip.tsx:18, Combobox.tsx:111), `rounded-sm` (DiffView, FluencyPanel, ChartRenderer), `rounded-[3px]` x4 (Transcript.tsx, EssayHighlights.tsx), `rounded-[7px]` (Segmented.tsx, derived from the 10 px track minus 4 px padding but unnamed). Nested radii are not concentric: a `rounded-card` (14) wrapper holds `rounded-control` (10) tiles at 20 px padding, which looks loose.

### Buttons
- Sizes `sm 32 / md 40 / lg 48 / icon 40`; `sm` is used as the default inline button everywhere on mobile (dashboard "Try Speaking Part 1", empty states) and gets its 44 px target through an invisible `hit` overlay. Visually they look undersized next to 44 px inputs (login, signup: `h-11` input vs `h-10` button, so the primary CTA is *shorter* than the field above it).
- Primary and secondary both carry `shadow-card`; ghost has none; link-styled actions (`Random prompt >` in writing/index.tsx, `Show evidence` in CriteriaGrid, `Change` in live PreScreen, `Forgot password?` login.tsx:60) are plain coloured text with three different weights and underline behaviours. Raw `<button>` is hand-styled in 13 places outside `ui/` (AppShell.tsx:85/112/134, mistakes.tsx:117, review.tsx:122, writing/index.tsx:92, FluencyPanel.tsx:55, ModelPicker.tsx:106).
- Icon-only buttons: 40 px `icon` size vs `size-11` ad-hoc grids (password toggle `w-11`, AppShell sign-out).

### Inputs
- `controlStyles` is solid (line-strong edge, ring on focus) but: native `<select>` for type/topic filters (bank.tsx, writing/index.tsx) looks like a different family from Combobox in settings; search input has an inline icon here but `Input` has no prefix slot so each page re-implements it; editor textareas (WritingEditor.tsx:116, WritingExam.tsx:252, plan pad) use a different, borderless style; settings "Conversation mode" is a native `<input type=radio>` inside a custom bordered tile (settings.tsx:137), unlike Switch/Segmented elsewhere.
- Slider (TargetBandSlider): thin track, small thumb, value in a separate muted label; on the dashboard onboarding and settings it is the only control with no tick marks and no visible step.

### Cards and nesting
- Design rule says "never nest", but visually nested surfaces are everywhere: writing home "Exam conditions" card contains a tile pair (Task 1/Task 2), a Segmented and a button (a card inside a card inside a card on mobile); dashboard onboarding is a Card containing numbered rows containing buttons; CriteriaGrid card contains evidence chips with their own bordered backgrounds; settings radio tiles sit inside a Card; Transcript popovers and FixCard diff blocks sit in cards.
- Everything is the same white bordered box with `shadow-card`: the hero action (full test, onboarding, target-band card) has the same visual weight as a list. There is no surface hierarchy (hero / section / inset).
- Dashboard "Start practising" is a Card with list rows, and "Review deck" is a separate one-row Card next to it with a different row style (icon in tinted circle, larger text). Same pattern, two treatments.

### Typography scale
- Body is `text-[0.9375rem]` (31 uses) and `text-sm` (159) interchangeably for the same role (descriptions under titles vary between the two within a single card). Off-scale sizes: `text-[0.8125rem]` (Tabs.tsx:63, ChartRenderer), `text-[0.6875rem]` = 11 px (AppShell tab-bar labels, below the 12 px floor), `text-[1.0625rem]`, `text-[1.75rem]`.
- h2 is `text-lg` on pages but card titles vary `text-base`/`text-lg` (speaking full-test card uses `text-lg` inside a card, bank uses `text-base`). Band numbers: `text-5xl` (ResultHeader) vs ring labels `text-lg`.
- Serif is used for essay/transcript (good) and for criterion descriptor quotes and the plan hint, in italic at 15 px, where it competes with the actual feedback (writing result Overview: the quoted band descriptors are the longest text in each card and read as primary content).
- Display heading weight is 600 everywhere; hierarchy relies on size alone.

### Icons
- Sizes in use: 10, 14, 16 (most), 18 (`size-[18px]` sidebar), 20, 22 (`size-[22px]` tab bar), 24, plus `size-4.5`. Sidebar 18 vs tab bar 22 vs list-row 18 (`size-9` circle with `[&_svg]:size-4.5`) vs dashboard 20. Stroke width is lucide default 2 everywhere, which is heavy at 16 px next to 14 px regular text.
- Icon containers: `size-9` tinted circle (lists), `size-11` accent-soft circle (full test), `size-12` ringed circle (EmptyState), `size-8` logo. Three colour recipes (`bg-surface-2 text-muted`, `bg-accent-soft text-accent-text`, `bg-surface-2 ring-1 ring-line`).

### Colour misuse
- Semantic colour is used for decoration in a few spots: the overall band on the writing result is a full-size `text-bad` 4.5 (correct use of the band colour, but it is the loudest element on the screen and a failing score is the first thing a user sees every time, with no "next step" beside it); the progress rings and badge both go red for the same number, so red appears three times in the header.
- Accent appears on too many things at once in dark mode (`text-accent-text` links, `bg-accent-soft` circles, tab underline, slider, focus ring), which flattens the "one accent, one primary action" rule.
- Yellow/amber "Needs work" paragraph-map badge and the amber "Overused" linking badges use `warn` for *advice*, not for a band threshold, which dilutes the good/warn/bad meaning defined in the design system.
- Diff view (`DiffView.tsx`) uses `bad-soft`/`good-soft` over serif text with strikethrough; on the Improve tab on mobile the entire essay is a wall of pink and green (`wres-4`), hard to scan.

### Chips, badges, pills
- Badge: `h-6 rounded-full text-xs`, 5 tones. Chip: `h-8 (h-11 on phones)` bordered, selected = solid `bg-ink text-bg`. Inline overrides: `h-auto! min-h-7 py-1 text-sm whitespace-normal!` on Badges in both LanguagePanels (upgrade suggestions), `Badge className="h-7 text-sm"` (speaking LanguagePanel:99). That is a *third* pill style hacked from Badge. Repeated-words chips (writing Language tab) are another hand-rolled pill. "likely 3.5-5.5" range pill in ResultHeader is a fourth.
- The selected Chip (black on cream) and the selected Segmented option (white raised on grey) and the active Tab (underline) are three different "selected" languages on the same page (writing result: Essay filter chips under an underlined tab bar, with a Segmented in the header).

### Tabs and filters
- Filter controls: `Segmented` (bank, history, writing home, DiffView, AudioBar speed, ThemeToggle), `Chip` row (mistakes, EssayHighlights, Transcript), native `Select` (bank, writing). Three controls for "filter this list". The dashboard `Tabs` and result `Tabs` are underline style; the Tabs scroll-mask trick and `max-sm:grow` make five tabs 11 px-ish and cramped on mobile (writing result `Overview Essay 5 Structure Language Improve` at 13 px, tight 4 px padding).
- Tab panels are not visually bound to the tab bar (panel content starts with an h2 at a different left offset on desktop).

### Empty, loading, error
- Empty: dashed `border-line-strong` box, `py-12`, centred. Good content, but on desktop it is full-width with an oversized blank area, and the dashed 14 px border reads as a drag-and-drop target (mistakes/review/history). Dashboard empty state is a different thing entirely (onboarding card).
- Loading: a mix of `Skeleton` with a random height (`h-96`, `h-68`, `h-72`, `h-64`) not matching content, `PageSkeleton` after 1 s, plain `Spinner` (LiveStage), and "Uploading your answers" text screen with a bare spinner (speaking session after finish; attempt that gets stuck shows "Not submitted" only after navigation).
- Error: `Alert tone="bad"` (full width pink block with big title, `Retry` + link) versus inline `text-bad-text` text in Field; the failed-state alert on the speaking result at mobile scales its type up (large 20 px title) versus desktop 14 px because of `clamp`/`text-lg` differences, so it looks like a different component across widths.

### Dark mode
- Borders `--line #2e2c29` vs card `#1e1d1b` vs bg `#161514`: cards nearly vanish on dashboard/settings; lift comes only from 1 px lines. Elevation (popover, dialog) looks the same as cards.
- `surface-2` insets are *lighter* than the card (by design) but the segmented track and the inset evidence chips then look like raised buttons rather than wells (writing result "Show changes / Clean rewrite" toggle, DiffView).
- Accent in dark (`#6d86ee` bg with `#0f1330` ink) is a bright periwinkle that reads much louder than the light-mode indigo; primary buttons (Sign in, Start full test) dominate every dark screen.
- The auth marketing panel (login desktop, right half) uses a slightly lighter slab that looks unfinished next to the dark form column.
- Essay error underlines (`decoration-bad`) and diff pink/green on dark keep contrast but the soft fills are too saturated at 12-15% mix on `#1e1d1b`.

### Screen-specific notes from screenshots
- **Auth:** login/signup on mobile are top-left aligned with a huge empty area above the heading (logo at top, form vertically centred on `justify-center`, heading at ~215 px); the password eye toggle icon is 16 px in a 44 px box with no hover state. Desktop has a split layout with a product-teaser panel that is only visible at `lg`, but dark teaser card text is 11-12 px.
- **Dashboard:** empty state is three numbered steps in one card plus two list cards, nothing leads the eye. With data, the "Predicted speaking/writing band" cards and the weakest-area banner have equal weight; the banner's CTA (`Practise: Task 2 essay`) is the only primary on the page but sits at the banner's far right on desktop and below on mobile.
- **Speaking chooser:** a hero card, a grouped list and a separate interactive card for Live examiner (three different surfaces in one page; the Live card has a tiny "Voice" badge inline with the title).
- **Speaking session:** text-only layout, good focus, but mic button + caption + "Check your microphone first" link sit at 3 different font sizes and the recording state has two heading-sized labels ("Work", "What do you do for a living?") at equal weight. The timer ring is 96 px with a 15-40 s caption and a waveform canvas that uses dashed baseline; Finish part early is an unboxed ghost text button next to a primary button of different height.
- **Writing home:** "Exam conditions" card with the `Task 1 / Task 2` tile pair (a fake segmented) plus a real Segmented `Academic | General` on the next line, then three task rows with `Random prompt >` links, then another Segmented + two selects + a search input for prompt picking. Dense and hard to tell which control affects which list.
- **Writing editor:** top bar `Exit` / title / timer / Submit is good; the plan pad is a collapsible with "Show" link; word count and "250 to go - min 250" sit at 12 px at the bottom of the textarea; serif 17 px prompt on the left is nicely readable. Submit is a `sm` button (32 px visual).
- **Writing result:** header has four different things in one row (back link, meta line, h1 title, words badge, big band, range pill, target text). Tabs are in the header region but the header is not sticky, so on mobile the bottom tab bar, the page tabs and the result header stack. The Improve tab uses Segmented inside a Card plus a diff view that paints most of the essay.
- **Live pre-screen:** content is a narrow `max-w-3xl` column under an Exit bar (ExamShell), so on 1440 it is a 540 px column with 400 px empty either side and looks like a mis-laid page instead of a deliberate focus screen. Disabled "Start test" (faded primary) plus helper text to its right is easy to miss.
- **Bank / Mistakes / Review / History:** bank is a dense grouped list with sticky group header row (the darker `Speaking - Part 1` band is an unstyled `surface-2` strip); history rows are a Card list with badge right-aligned ("Not submitted" outline badge vs `4.5` bold band vs nothing); mistakes/review lead with full-width dashed empty states.
- **Settings:** label column + card column at `md`, nice; but each card is a different recipe (slider alone, switch list, radio tiles, combobox, theme Segmented) and the "AI models" disclosure looks like an input because it is a bordered row with a chevron.
- **Mobile chrome:** bottom tab bar is 64 px with 11 px labels; `More` opens a Sheet. Page content gets `pb-[calc(6rem+env)]`. The active tab has only colour change (no indicator) so in dark mode the difference between active and inactive is subtle.

---

## 2. Design direction (keep the brand, raise the polish)

Brand stays: calm, warm neutrals, one indigo accent, Inter for UI, Source Serif for anything the learner wrote or reads. The aim is Linear's restraint plus Duolingo's clarity about *what to do next*.

1. **Three surface levels, used on purpose.**
   - *Page* (`bg`): warm off-white / near-black.
   - *Panel* (`surface`, 1 px line, tiny shadow): the main content blocks. Lists inside a panel use dividers, never inner cards.
   - *Inset* (`surface-2`, no border): only for controls (segmented track, code-ish wells, diff blocks, evidence quotes).
   - *Hero* (new): one per screen, accent-tinted (`accent-soft` surface with an accent hairline), for the single "do this next" block: dashboard next-action, speaking full test, writing full test, result "fix this first". This is what gives the screen a lead.
   Delete every other nested bordered box.
2. **Type.** Collapse to 6 steps and stop mixing 14/15 px: `display` (band numbers 48/600, tabular), `h1` 28/600 (-0.02em), `h2` 18/600, `body` 15/400 (both descriptions and lists), `meta` 13/500 muted, `micro` 12 (never 11). Tab labels 14. Use weight 500 for control labels, 600 for headings, and serif only for user text and pull-quotes; turn the italic criterion descriptors into a collapsed "Band descriptor" disclosure so they stop outshouting the feedback.
3. **Density and rhythm.** 4 px base; use exactly `4 / 8 / 12 / 16 / 24 / 40` (gap-1/2/3/4/6/10). Panel padding 20 mobile and desktop alike (16 for list rows is wrong; rows are 20 x 16). Page: header `mb-8`, sections `gap-10`, h2 to content `mb-4`. One page width (`max-w-5xl`), with reading screens (result tabs, settings, empty states) inside `max-w-3xl` left aligned *within* the column, not centred boxes that mismatch.
4. **Controls.** One height system: 36 (compact, desktop-only), 44 (default, touch), 52 (hero CTA). Primary button 44 on all viewports so it matches the 44 px inputs; drop the `hit` overlay by making default 44 and `sm` 36 on desktop. One selected state: raised white segment with ink text (Segmented) everywhere for exclusive choice; filter chips become a `ToggleGroup` (same look, multi-select) so there is one pill language; tabs stay underlined but sit in a sticky bar with counts in a muted tabular badge.
5. **Colour.** Keep one accent. Reserve `bg-accent` for exactly one primary per view; the hero block uses the tint. Semantic colours only for band thresholds and real errors: paragraph-map "Needs work" and linking "Overused" become neutral badges with a warn dot. Band numbers keep semantic colour but the header no longer repeats it in ring + badge + text (colour the number only; the range pill becomes neutral).
6. **Dark mode.** Raise separation: card `#1f1e1c` over bg `#151413` with line `#34322e` plus an inner 1 px `rgb(255 255 255 / 0.03)` top highlight as the shadow, popovers `#262522` + `shadow-pop`. Tone accent down (`#6d86ee` to about `#7b92f0` bg only for buttons, text links `#a3b2f7`). Lower soft fills to 10%.
7. **Motion and feedback.** 150-250 ms ease-out-quart only: press scale 0.98, tab underline slides (shared element), Sheet/Dialog already animate; add skeletons that match the final layout; toasts bottom-center on mobile above the tab bar. Reduced motion already global.
8. **Empty, loading, error.** One `EmptyState` recipe: no dashed border, `py-10`, icon in a 40 px inset, title 16/600, one sentence, one button, left-aligned on desktop inside the panel (so it matches the list it replaces). One Skeleton per panel, sized to the row heights. Errors: `Alert` with icon, 14 px title, same on all widths.
9. **Icons.** One size per role: 16 inline and buttons, 20 nav (sidebar and tab bar the same), 24 empty-state/hero; stroke 1.75; one container recipe (`size-10 rounded-control bg-surface-2` neutral, `bg-accent-soft` only in the hero).
10. **Auth and exam screens.** Auth: vertically centred card (max-w-sm) with logo above heading on mobile, teaser panel kept at `lg` with legible 13 px text. Live pre-screen/ExamShell non-wide: centre the `max-w-3xl` column on desktop with a soft `surface` panel so the focus layout looks intentional.

---

## 3. shadcn/ui adoption map

**Approach.** Initialise shadcn (new-york style, Tailwind v4, CSS variables, `@/components/ui` path, `lucide` icons) but keep our public API: each existing file in `src/components/ui/*` becomes a thin re-export or wrapper of the shadcn component (same names/props), so the ~40 call sites do not change. Add `components.json`, `cn()` in `lib/utils.ts` (clsx + tailwind-merge), `class-variance-authority`, and the `radix-ui` umbrella package (or `@radix-ui/react-*` per component). The native `<dialog>` Dialog/Sheet, hand-rolled Popover/Tooltip/Combobox and Toast are where Radix adds real value (focus return, collision handling, portals, typeahead); Button/Card/Badge/Input are just styling.

| Ours (`components/ui/`) | shadcn component | Notes |
|---|---|---|
| `Button.tsx` (+`buttonStyles`) | `button` (cva) | Variants map: primary=`default`, secondary=`outline`, ghost=`ghost`, danger=`destructive`. Add `link` for the text actions. Keep `loading`/`icon` props in the wrapper; keep exporting `buttonStyles` (= `buttonVariants`) for `<Link>`. Sizes: sm 36, md 44, lg 52, icon 44. |
| `Card.tsx` | `card` (+`CardHeader/Title/Description/Content/Footer`) | Keep `padded`/`interactive` props as wrapper sugar. |
| `Badge.tsx` (Badge) | `badge` | Tones via cva variants: neutral=`secondary`, accent, good, warn, bad (soft bg + text). Fixes the `h-auto!` hacks by adding a `size="lg"` (wrapping, multi-line). |
| `Badge.tsx` (Chip) | `toggle` / `toggle-group` | Chip row becomes `ToggleGroup type="single"` (filters) with the same pill look as `Segmented`. |
| `Segmented.tsx` | `toggle-group` (single, `variant="segmented"`) or `tabs` styled as a pill track | Keeps radiogroup semantics through Radix RovingFocus; removes our arrow-key code. |
| `Tabs.tsx` | `tabs` (`TabsList/Trigger/Content`) | Underline variant. Keep the scroll-fade/active-into-view wrapper; Radix gives the roving focus and `aria-controls` pairing, so the `-panel` id workaround disappears. |
| `Dialog.tsx` (Dialog) | `dialog` / `alert-dialog` | Confirmations (submit essay, exit exam) use `alert-dialog`. |
| `Dialog.tsx` (Sheet) | `sheet` (side `bottom` on mobile, `right` from `md`) | Mobile More-menu, error detail sheet. Possibly `drawer` (vaul) for swipe-to-close on mobile; optional. |
| `Popover.tsx` | `popover` | ErrorPopover/Transcript error bubbles; Radix handles collision so no clipping in the scrolling transcript. |
| `Tooltip.tsx` (Tooltip, InfoTip) | `tooltip` | Wrap app in `TooltipProvider`; InfoTip = `Tooltip` on a 44 px `Button size="icon" variant="ghost"`. On touch, InfoTip should open a `popover` (tooltips do not fire on tap). |
| `Field.tsx` Input | `input` + `label` (+ `field` helper optional) | Keep our `Input` wrapper that adds label/hint/error/password toggle using shadcn `Input`/`Label`. |
| `Field.tsx` Textarea | `textarea` | Also restyle editor textareas to the same tokens. |
| `Field.tsx` Select | `select` (Radix) for desktop filter selects; keep native `<select>` on the phone-first forms | Bank "All types / All topics" becomes `Select`; consider native on mobile via `md:` switch (or keep native everywhere, a11y-wise it is better on touch). |
| `Combobox.tsx` | `command` + `popover` (shadcn combobox recipe) | Model pickers; adds keyboard filtering with `cmdk` and group headings. |
| `Switch.tsx` | `switch` | Keep label + description wrapper. |
| `Slider.tsx` | `slider` | Target band 4-9 step 0.5; add tick marks; value label on the thumb. |
| `Toast.tsx` | `sonner` (`<Toaster />` + `toast()`) | Keeps the `toast(msg, {tone, action})` call shape via a one-file adapter; position `bottom-center`, offset above the mobile tab bar. |
| `Skeleton.tsx` (Skeleton) | `skeleton` | Keep `PageSkeleton`; `Spinner` stays (lucide `LoaderCircle`). |
| `ProgressRing.tsx` | `progress` for linear bars only | The ring is custom SVG and has no shadcn equivalent; keep it. Use `progress` for the linear criterion/mistake bars and upload progress. |
| `Alert.tsx` | `alert` (`Alert/AlertTitle/AlertDescription`) | Tones via variants: accent, good, warn, destructive. |
| `EmptyState.tsx` | `empty` (shadcn `Empty`) or keep | Newer shadcn has `empty`; otherwise keep and restyle. |
| `PageHeader.tsx` | none (keep) | Layout primitive. |
| (new) | `separator` | Replace ad-hoc `divide-y`/`border-t` on dividers where semantic (sidebar sections, settings). |
| (new) | `dropdown-menu` | Sidebar user menu (sign out, theme), history row actions (retry, delete), bank item "practise as...". Replaces the custom More sheet on desktop. |
| (new) | `scroll-area` | Transcript pane, prompt lists in the editor sidebar, tab bars that overflow (custom scrollbar only where it helps). |
| (new) | `collapsible` / `accordion` | Plan pad ("Show"), "Show evidence" in CriteriaGrid, AI models disclosure. |
| (new) | `sidebar` (optional) | Only if rebuilding AppShell; our sidebar is simple enough to restyle instead. Skip unless time allows. |

**Dependencies to add (single flock'd call):** `class-variance-authority`, `tailwind-merge`, `radix-ui` (or the individual `@radix-ui/react-{dialog,alert-dialog,popover,tooltip,select,switch,slider,tabs,toggle-group,dropdown-menu,scroll-area,separator,progress,collapsible,label,slot}`), `cmdk`, `sonner`; `tw-animate-css` for the Radix enter/exit classes (Tailwind v4 replacement for `tailwindcss-animate`).

### Token mapping (our CSS vars to shadcn)

Keep our raw tokens as the source of truth and add the shadcn names as aliases in `styles.css`, so both old classes (`bg-surface`, `text-muted`) and shadcn classes (`bg-background`, `text-muted-foreground`) work during migration.

```css
:root {
  --background: var(--bg);             --foreground: var(--ink);
  --card: var(--surface);              --card-foreground: var(--ink);
  --popover: var(--surface);           --popover-foreground: var(--ink);
  --primary: var(--accent);            --primary-foreground: var(--accent-ink);
  --secondary: var(--surface-2);       --secondary-foreground: var(--ink);
  --muted: var(--surface-2);           --muted-foreground: var(--muted-raw);   /* see note */
  --accent: ...                        /* collision: see note */
  --destructive: var(--bad);           --destructive-foreground: var(--bad-ink);
  --border: var(--line);               --input: var(--line-strong);
  --ring: var(--accent);
  --radius: 0.625rem;                  /* 10 px = today's rounded-control; card = calc(var(--radius) + 4px) = 14 */
  --sidebar: var(--sidebar);           --sidebar-foreground: var(--ink);
  --sidebar-primary: var(--accent);    --sidebar-accent: color-mix(in oklab, var(--ink) 6%, transparent);
  --sidebar-border: var(--line);       --sidebar-ring: var(--accent);
}
```

**Name collisions to resolve (important).** Our `--accent` means the indigo brand colour, shadcn's `--accent` means the *neutral hover surface* (`bg-accent` on ghost hover, menu item focus), and our `--muted` is a *text* colour while shadcn's `--muted` is a *surface* (`--muted-foreground` is the text). Do this rename once, in `styles.css`, before adopting components:
- Rename ours: `--accent` to `--brand` (and `--accent-hover/-ink/-text` to `--brand-hover/-ink/-text`), `--muted` (text) to `--ink-muted`; update `@theme inline` names (`--color-brand`, `--color-ink-muted`) and do a mechanical sed over `bg-accent`/`text-muted` etc. (about 300 call sites; safest is to keep Tailwind names `text-muted`, `bg-accent-soft`, `text-accent-text` as utilities by defining them in `@theme` from the renamed vars, and only change the *CSS variable names* plus `--color-accent`/`--color-muted` which collide).
- Then: `--primary: var(--brand)`, `--accent: var(--hover-surface)` where `--hover-surface = color-mix(in oklab, var(--ink) 6%, transparent)` (light) / 8% (dark), `--muted: var(--surface-2)`, `--muted-foreground: var(--ink-muted)`.
- Keep `good/warn/bad` (+`-soft`, `-text`) as extra semantic tokens; register in `@theme inline` so Badge/Alert variants can use `bg-good-soft text-good-text`.

`.dark` block is identical in structure (the aliases reference our vars so they follow automatically). Extra dark tuning from section 2: card `#1f1e1c`, bg `#151413`, line `#34322e`, brand bg `#7b92f0`, soft fills 10%.

`@theme inline` additions: `--color-background`, `--color-foreground`, `--color-card(-foreground)`, `--color-popover(-foreground)`, `--color-primary(-foreground)`, `--color-secondary(-foreground)`, `--color-muted(-foreground)`, `--color-accent(-foreground)`, `--color-destructive`, `--color-border`, `--color-input`, `--color-ring`, `--radius-sm/md/lg/xl` derived from `--radius` (sm = -4, md = -2, lg = 0, xl = +4). Keep `--radius-card`/`--radius-control` as aliases of `xl`/`lg`.

---

## 4. Screen-by-screen fix list (by owner)

Owners are disjoint by file ownership so work can proceed in parallel. **Shared primitives (`components/ui/*`, `styles.css`, `components.json`, `lib/utils.ts`) belong to the shell owner and land first**; the others consume them.

### Shell owner: `components/ui`, `styles.css`, `components/layout`, `routes/__root.tsx`, `routes/_app.tsx`, auth routes
1. Initialise shadcn, add `cn`, do the token rename/alias (section 3), add `tw-animate-css`. Land before anyone else touches styles.
2. Re-implement each `ui/*` primitive on shadcn per the map, preserving prop APIs; export `buttonVariants` alias of `buttonStyles`. Buttons: md = 44 px (kill the `hit` overlay except for the tiny inline icon case); primary/secondary lose the double shadow; add `link` variant and migrate the plain-text actions (`Forgot password?`, `Change`, `Show evidence`, `Random prompt`) to it.
3. `Card`: add `CardHeader/Title/Description` and a `tone="hero"` (accent-soft surface) variant; padding 20; `interactive` gets a consistent hover (border-line-strong + lift 1 px).
4. `Badge`: add `size` (default, lg wrapping); `Chip` becomes `ToggleGroup` item; `Segmented` gets one selected style (raised white, ink); `Tabs` on Radix with a sliding underline and muted count.
5. `EmptyState`: no dashed border; `py-10`; left-aligned inside a `Card` on `md`+; one icon recipe.
6. `Skeleton`/`PageSkeleton`: make the page skeleton match PageHeader + one panel; `Toast` to sonner bottom-center offset above the tab bar.
7. `AppShell.tsx`: nav icons 20 px both sidebar and tab bar (kill `size-[18px]`, `size-[22px]`), tab-bar labels 12 px, add an active pill/indicator on the active tab; sidebar becomes a `dropdown-menu` for user (sign out, theme) with the ThemeToggle kept in Settings; sidebar/page contrast: `--sidebar` slightly darker than bg in light, slightly lighter in dark, plus `border-r`. Page wrapper: one `max-w-5xl`, `px-4 md:px-8`, `py-6 md:py-10`.
8. `AuthLayout.tsx` + `login/signup/forgot/reset`: vertically centred `Card` form on mobile with logo above the heading, full-width 44 px submit, teaser panel at `lg` with >=13 px type and a proper surface; fix the eye toggle hover/focus; dark teaser slab to match `bg`.
9. `ExamShell.tsx`: centre the non-wide column on desktop inside a `surface` panel; top bar 56 px, exit as `Button variant="ghost"`, timer as a neutral badge that turns warn/bad (with icon) near the end.
10. `RouteError`/`__root` not-found: one `Alert`-based recipe at `max-w-lg`.
11. Dark-mode token pass (section 2.6), contrast recheck (AA) for `--accent-text` on `bg` and on `accent-soft`, and `line-strong` >= 3:1.

### Pages owner: `components/dashboard|settings|bank`, `routes/_app/{index,bank,mistakes,review,history,settings}.tsx`
1. **Dashboard** (`index.tsx`, `Onboarding.tsx`, `Charts.tsx`): lead with one hero (empty: onboarding steps as a single hero panel with a single primary at a time; with data: the "weakest area" recommendation becomes the hero with the primary CTA). Predicted speaking/writing bands as two equal panels with `display` number (band colour only on the number), "Start practising" and "Review deck" unified as one list panel with identical row style; recurring-mistakes panel rows aligned with counts in tabular muted; tabs (`Tabs` for chart criteria) on Radix.
2. **Bank** (`bank.tsx`, `components/bank/*`): filters in one toolbar row (search with icon slot, `ToggleGroup` skill, `Select` type/topic), group headers as sticky `text-sm font-medium` rows on `bg-surface-2` with no stray border; rows `px-5 py-4` and a chevron; `LoadMore` as `Button variant="secondary"`; skeleton rows matching row height.
3. **Mistakes** (`mistakes.tsx`): category filter becomes `ToggleGroup`; each mistake row = one collapsible (shadcn `collapsible`) inside a single panel with dividers (kill the per-row expand button hand-styling at line 117); empty state per direction.
4. **Review** (`review.tsx`): `max-w-2xl` card centred within the page width; grade buttons as four equal 52 px `Button`s with the keyboard hint in muted; a `Progress` bar for remaining cards; skeleton sized to the card.
5. **History** (`history.tsx`): filter `ToggleGroup`; rows with icon, title, meta, right-aligned status (`Badge`) or band (band colour number); "Not submitted" as a warn badge with a clear retry affordance; keep one panel with dividers.
6. **Settings** (`settings.tsx`, `components/settings/*`): one card recipe per group (card header title + description, content, no label column duplication); the radio tiles become `RadioGroup` (shadcn) with check indicator; `TargetBandSlider` on shadcn `slider` with ticks; `ModelPicker` on `Command`+`Popover` with the "AI models" disclosure as a `collapsible` with a clear heading (not a fake input); theme `ToggleGroup` with icons and labels.
7. Replace the raw `<button>`s at `mistakes.tsx:117`, `review.tsx:122` with `Button`/`collapsible` triggers.

### Speaking owner: `components/speaking`, `components/results`, `components/live`, `routes/_app/speaking`
1. **Chooser** (`speaking/index.tsx`): hero = full practice test (`Card tone="hero"`, 52 px CTA), single panel list for Parts 1-3 (same row as dashboard) and Live examiner as a row in the same panel (with `Badge` "Voice" on the right), not a separate interactive Card.
2. **Session** (`SessionFlow.tsx`, `MicButton.tsx`, `TimerRing.tsx`, `Waveform.tsx`, `LiveHints.tsx`, `CueCard.tsx`): hierarchy: part label (meta) > question (h1 26-28 serif or sans 600) > timer/ring > waveform > controls. Only one big title size (the "Work" topic becomes a meta chip above the question). Mic button 88-96 px with a pulse ring while recording (reduced-motion safe); "Finish part early" as `Button variant="ghost"` 44 px aligned with the primary; "Check your microphone first" as `MicCheck` inline status row with icon + state text. Uploading/"Saving your answers" screen: list with per-recording `Progress` and check icons; if it stalls >20 s show an `Alert` with retry.
3. **Result** (`routes/_app/speaking/result.$attemptId.tsx`, `ResultHeader`, `OverviewPanel`, `CriteriaGrid`, `FailedState`, `AnalyzingState`, `FluencyPanel`, `LanguagePanel`, `ImprovePanel`, `Transcript`, `AudioBar`, `ErrorPopover`, `FixCard`, `BandGauge`, `ComparisonStrip`): shared result header (see writing owner for the same component): title, meta, band `display` number, neutral range pill, target delta as text, one row on desktop, stacked on mobile. Tabs sticky under the header. CriteriaGrid: each criterion = row in one panel (name, band, bar, one-line reason) with the band-descriptor quote behind a `collapsible`; evidence chips as `Badge size=lg`. `FailedState`: same `Alert` at every width, primary "Retry part" and ghost "Practise another part". `AudioBar`: one 44 px row, speed `ToggleGroup`, sticky at the bottom of the viewport above the tab bar on mobile. Transcript: filter `ToggleGroup`, words in serif, error underlines via the tokens, popovers/sheets via Radix (Popover on desktop, Sheet on mobile).
4. **Live** (`routes/_app/speaking/live.tsx`, `PreScreen.tsx`, `LiveStage.tsx`): pre-screen in a centred `surface` panel; "How it runs" as a 3-row table; mic check as a status `Alert`; "Start test" a 52 px primary that is enabled-looking with a clear disabled reason beneath (not faded text to the right); `LiveStage` uses a status `Badge` (connecting/listening/speaking), the same MicButton/Waveform, Exit confirmation with `alert-dialog`.

### Writing owner: `components/writing`, `routes/_app/writing`
1. **Home** (`writing/index.tsx`): single hero "Full test" card that contains at most: title, meta, the Academic/General `Segmented`, one primary button; the Task 1 / Task 2 "tiles" become a two-row time summary in muted text (they are not controls). Task rows (T1 Academic / T1 General / Task 2) in one panel list with a single `Random` ghost button each. "Choose a prompt" becomes a toolbar like the bank (same component as the bank owner's: share a `PromptFilters` built by the pages owner, or duplicate only if they lag).
2. **Editor** (`WritingExam.tsx`, `WritingEditor.tsx`, `PromptPanel.tsx`, `ChartRenderer.tsx`): ExamShell with split view at `lg`; textarea restyled to the control tokens (border on focus only, `text-[1.0625rem]` serif kept, 68ch cap on desktop); counter/min-words bar sticky at the textarea bottom (13 px, tabular, turns good at the minimum); Submit a 44 px primary with a `alert-dialog` confirm showing word count and time left; plan pad as `collapsible` with `Button variant="ghost"` toggle; timer badge states. On mobile put the prompt in a collapsible "Prompt" panel above the textarea so typing gets the screen.
3. **Result** (`result.$attemptId.tsx`, `ResultHeader` (shared), `EssayHighlights.tsx`, `StructureMap.tsx`, `LanguagePanel.tsx`, `DiffView.tsx`, `offTopic.ts` logic only): header per speaking owner (shared component; the writing result currently renders the same ResultHeader, so coordinate one edit, owned by speaking). Tabs: Overview / Essay / Structure / Language / Improve on Radix tabs, sticky. Essay tab: filter `ToggleGroup` above the essay, counts in muted; highlights keep underline style but use `decoration-1` for minor. Structure: paragraph map with neutral badges + warn dot; "Needs work" is text not a yellow pill. Language: "At a glance" stats as a stat row (4 equal cells in one panel with dividers), mistakes by type as `Progress` rows, linking words as a simple table with a neutral "Overused" badge, repeated words as `Badge` neutral, vocabulary upgrades as a list (from -> to with arrow icon). Improve: three "fix next" items as rows with an inset diff block (surface-2) and one `ToggleGroup` for "Show changes / Clean rewrite" (DiffView); diff on mobile: show only changed sentences by default with an "Expand full essay" disclosure so the tab is not a wall of pink/green.
4. Replace the `h-auto! min-h-7 ... whitespace-normal!` Badge overrides with `Badge size="lg"`.

### Cross-cutting checks for every owner
- Run typecheck, `vitest`, `vite build`; re-screenshot your screens at 390/1440 light/dark and compare with `.eval/ui/audit/`.
- Accessibility: visible label or `aria-label` on every control, `:focus-visible` ring on every Radix trigger (shadcn default `ring-ring/50` is too faint on `bg`; set `focus-visible:ring-2 ring-ring ring-offset-2 ring-offset-background`), 44 px targets, AA contrast, no colour-only state.
- Do not edit `routeTree.gen.ts`, server code or the typed API layer.

### Suggested order
1. Shell owner: shadcn init, token rename/aliases, primitives, AppShell/Auth/ExamShell (blocking).
2. In parallel after that lands: pages, speaking, writing owners.
3. Final pass: dark-mode contrast and screenshot regression of all screens, update `docs/design-system.md` (tokens table, new primitives, single filter control rule, hero surface).

## Remaining audit caveats
- Speaking result tabs were not screenshotted (no object storage locally, so uploads never complete). Re-audit after wiring a mock analysis or fixture attempt.
- Bottom tab bar appears mid-page in full-page screenshots; that is a capture artefact of `position: fixed`, not a layout bug.
- The audit user's dashboard was captured with one writing result only (no speaking data), so the "with data" dashboard shows the writing card plus recurring mistakes, not charts.

---

## Status: foundation (shadcn primitive layer) landed

Done in `apps/web`:
- **shadcn/ui adopted** (new-york, Tailwind v4, `components.json`, `cn()` in `src/lib/utils.ts`, `tw-animate-css`, `radix-ui`, `cmdk`, `sonner`, `class-variance-authority`, `tailwind-merge`). CLI output lives in `src/components/ui/shadcn/*` (alias `ui`), restyled to our tokens; the PascalCase files in `src/components/ui/` are thin wrappers with the **unchanged exports and props**, so no screen code changed.
- **Tokens** (`styles.css`): shadcn semantic names (`background/foreground/card/popover/primary/secondary/muted-foreground/destructive/border/input/ring`) aliased to our raw vars, plus `brand-*` and `hover`; `--radius` (10 px) with `sm/md/lg/xl` derived, `rounded-card` = xl, `rounded-control` = lg. Dark elevation pass (bg `#151413`, surface `#1f1e1c`, line `#34322e`, inner highlight). Default border colour is `--line`. Native `<dialog>`/toast CSS removed.
- **Deviation from section 3:** the one-time `--accent`/`--muted` rename was **not** done repo-wide, because other owners are editing screens in the same tree (a sed would clobber in-flight work). Legacy `text-muted` / `*-accent*` utilities keep working; new code uses `brand-*` / `muted-foreground`, and vendored shadcn uses `bg-hover` / `bg-surface-2` for shadcn's accent/muted roles. Migration is a mechanical sed once screen owners are done (documented in `docs/design-system.md`).
- **Sizes:** Button md is now 44 px (was 40), sm 36 (+hit), lg 52, icon 44; inputs/selects/combobox 44. Added `Button variant="link"`, `Card tone="hero"` + `CardHeader/Title/…`, `EmptyState bare` (no dashed border; panel by default), `ProgressBar`, and re-exports of `DropdownMenu*`, `Separator`, `ScrollArea`, `Collapsible*`.
- **Behavioural notes for screen owners:** Toast is sonner (same `toast(msg, {tone, action, durationMs})`); Segmented is a Radix RadioGroup; Chip is a Radix Toggle; Tabs/Dialog/Sheet/Popover/Tooltip/Combobox/Switch/Slider are Radix. `Select` stays native on purpose. The Slider thumb (not an `<input>`) is now the labelled control: `e2e/smoke.spec.ts` was updated (`aria-valuenow`, `press('End')`). `Popover` keeps `popoverTarget`/`showPopover()` working through a shim for `EssayHighlights`; that caller can switch to the trigger's `onClick` and the shim can go.
- Checks: `typecheck`, `vitest run` (58 tests) and `build` pass; screenshots of dashboard, settings, bank, result tabs, More sheet, dialog, combobox and toast checked in light/dark at 390 and 1440.

Not done (still open from the list above): Segmented/Chip unification into one pill language beyond the shared tokens, sliding tab underline, `dropdown-menu` user menu in AppShell, `EmptyState` left-align on desktop, AppShell/AuthLayout/ExamShell restyling (shell owner's layout files).

---

## Status: screens migrated and QA'd

**Before → after.** The audit's "same white bordered box everywhere" is now a surface hierarchy: one tinted hero per page (full test, weakest area, onboarding, exam conditions), then single divided panels for lists (shared `bank/ListRow` row: `px-5 py-4`, hover wash, inset focus ring), with no card-in-card. One filter language per page (`Segmented` for skill/part/range, native `Select` for long lists). Band numbers are the only coloured element in result headers; `CriteriaGrid` is one panel with a `BandBar` per criterion; fixes are rows in one panel. The shell has a grouped sidebar with an account dropdown (theme, sign out), a solid mobile tab bar with 12 px labels, and one `ErrorPage` for 404/route errors. Settings groups are title column + divided card. Legacy `text-muted` / `accent-*` remain only in a few shell files and still resolve.

**QA pass (ui-qa).** Every screen screenshotted at 390 and 1440, light and dark: login, signup, forgot, 404, dashboard (empty and with data), bank, settings, history, mistakes, review, speaking chooser and session, live pre-screen, writing home and editor, and all five writing and speaking result tabs. Data screens and results use mocked API responses (fixtures in a throwaway script). Automated scans ran on every shot: horizontal overflow (none; the only hit is the mistakes chip row, which scrolls on purpose) and text contrast against rendered backgrounds (WCAG AA 4.5 / 3 for large text). Fixed in this pass:
- **Tabs had no active underline.** The shadcn list kept `h-9` while triggers were `h-11`, so the `overflow-x-auto` list clipped the 2 px border. The list is now `h-auto` and the `-mb-px` is gone. This affected every result page.
- **`Chip` squashed in scrolling rows** (transcript filters showed "Grammar 5Vocabulary"). Added `shrink-0`.
- **Dashboard for a new user** had the Practise panel at half width under a full-width hero; it is now full width until there are recurring mistakes to sit beside it.
- **Review "Space" hint** on the primary button was 4.2:1; now an outlined keycap in the button's own colour.

**Checks.** `pnpm typecheck`, `vitest run` (13 files, 58 tests), `pnpm -F @ielts/web build`, and Playwright e2e (desktop + mobile, 6 tests) against the running :5174 server all pass. One mobile smoke test failed once when desktop and mobile ran in parallel (still on /signup after submit) and passed on every re-run, including serial; likely parallel sign-ups against the local stack, not a UI change.

**Remaining gaps.**
- Transcript error details still open in a popover on phones; a bottom `Sheet` would suit better.
- `Chip` (black pill), `Segmented` (raised segment) and `Tabs` (underline) are still three selected styles; `Chip` is kept for scrolling rows (mistakes, transcript/essay filters).
- Tabs label is 13 px on phones with five tabs; there is no `sticky` prop (routes wrap it in a sticky div).
- `EmptyState` is centred; `ExamShell` keeps a centred narrow column on desktop, so the live pre-screen is narrow at 1440.
- No `Slider` tick prop (scale is drawn in the hint), no `Badge` large size, no low-contrast accent tone on `ProgressBar`, and `categoryLabel` returns raw text for ungrouped categories.
- Not exercised in a browser: real recording/upload and live examiner session, writing full-test combined band, failed/analyzing result states, reduced-motion on the new pills, touch devices. No `PRODUCT.md` exists (`design-system.md` was the reference).
