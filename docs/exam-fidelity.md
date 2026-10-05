# Exam fidelity: Listening and Reading

Behaviour spec for making Listening and Reading match the computer-delivered IELTS test. Applies to exam mode; features 1, 2, 4 and 5 also apply to practice mode. Feature 3 is exam mode only (practice shows an untimed "time spent" pill and keeps its neutral tone).

Notes never leave the device. No API, schema, or server change is needed or allowed for any feature here. Do not touch `apps/server/**` or any admin file.

## Current state (read before building)

- Web: `components/lr/Runner.tsx` owns the top bar (Exit, title, `SaveIndicator`, `ClockPill`, Submit), the clocks and the part tabs. `Passage.tsx` has `useHighlights(key)` (localStorage key `lr:<attemptId>:hl:<part>`, type `Highlight = {p,s,e}` in `lib/lr.ts`, `addHighlight` merges overlaps, click removes). Highlights exist for the Reading passage only. `QuestionGroup.tsx` renders question and form text and inputs. `Audio.tsx` holds the exam playlist (`useExamPlaylist`, `ExamAudioBar`). `ClockPill` currently turns warn at 300 s and bad at 60 s for every countdown, including Listening.
- iOS: `Views/LrRunnerView.swift` (runner, `LrClockPill`, `LrExamBar`, `LrPassageView`, `LrNavigatorSheet`, `LrSubmitSheet`), `Views/LrQuestionViews.swift` (`LrGroupView`, `LrInline`, `LrGapField`), `Core/LrSession.swift` (flags, position), `Core/LrAudio.swift`. Flags persist via UserDefaults. No highlights, notes, settings, hide or help exist.
- Android: `ui/screens/lr/LrRunnerScreen.kt` (runner, `prefs()` = SharedPreferences "lr", flags and position keyed by attempt id), `LrParts.kt` (`PassageView`, `ClockPill`, `LrSheet`, `QuestionNavigator`), `LrQuestions.kt` (`RichText`, `QuestionGroup`), `LrAudio.kt`, `core/Lr.kt`. No highlights, notes, settings, hide or help exist.

## 1. Highlight and notes

Surfaces where text can be highlighted: Reading passage paragraphs; Reading question text (stems, instructions, option text, form and table text); Listening question text and form, table and note-completion text. Never inside answer inputs (text fields, dropdowns, option letters used as controls, the gap field itself). The Q-number pill and gap fields are skipped when computing offsets.

Data model (per attempt, per device):
- `Mark = { id, region, p, s, e, note? }`. `region` is a stable string: `passage:<part>:<paragraph>` or `q:<n>:<field>` or `grp:<groupFrom>:<field>`. `s`/`e` are character offsets into the rendered plain text of that region. Notes are optional, max 500 characters.
- Merge rule: a plain highlight merges with overlapping plain highlights (existing `addHighlight`). A mark with a note never merges; selecting over it edits it instead.
- Web key: `lr:<attemptId>:marks:<part>` via `lsGet`/`lsSet`. Migrate on read: old `Highlight {p,s,e}` entries become passage marks without notes, so existing attempts keep their highlights.
- iOS: UserDefaults key `lr.marks.<attemptId>`. Android: SharedPreferences "lr" key `marks:<attemptId>` (JSON string). Same JSON shape as web so the spec is one thing.
- Delete the stored marks when the attempt is submitted or abandoned on mobile; on web leave as today (cheap, per attempt).
- Never serialised into responses, autosave payloads, or analytics.

Creating:
- Desktop: select text, then a small popover appears next to the selection (Highlight, Add note) and the same two items appear in the right-click context menu on a selection. Selecting alone no longer auto-highlights; the old click-to-remove stays (click a highlight opens a small menu: Edit note / Add note, Remove).
- Touch: long-press, then the native selection handles, then the system selection menu is extended with Highlight and Add note (iOS `UIEditMenu`/`editMenuForTextIn`; Android `ActionMode.Callback` custom items). If the platform cannot extend the menu in a Compose or SwiftUI text view, use a floating "Highlight | Note" chip that appears above the selection.
- Keyboard (web): with a selection, `Alt+H` highlights and `Alt+N` opens the note editor. Mark elements are focusable; Enter opens the mark menu, Delete removes it.

Notes UI:
- A note shows a small marker (a 14 px note icon, superscript-style, after the marked text) with `aria-label="Note: <first 40 chars>"`. Clicking or tapping it opens a popover with the note text, Edit and Delete. Editing uses a textarea in the same popover, Save/Cancel, Esc cancels, focus returns to the marker.
- A "Notes" panel is reachable from the top bar (inside the Help sheet's neighbour; see feature 5: a Notes button with a count badge, shown only when at least one mark exists). It lists marks for the whole attempt: excerpt (highlighted text), the note, the location ("Passage 2, paragraph 3", "Question 14"), tap to jump and flash the mark, edit and delete actions. Web: right-side sheet; iOS: sheet; Android: `LrSheet`.
- Colour for highlights uses the existing highlight token; under the settings colour schemes (feature 2) highlight colours must be overridden so they stay visible (scheme table below).

Out of scope: highlighting in the Results/Review screens, syncing notes, exporting notes.

## 2. Settings

Top-right Settings button opens a popover (web) or sheet (mobile) with two radio groups.

Text size: Standard (100 %), Large (125 %), Extra large (150 %). Scales the passage, question text, options and gap fields inside the test content area only. Chrome (top bar, tabs, navigator, audio bar) stays fixed so the layout does not break.

Colour scheme (applies to test content area only, not the top bar):

| Scheme | Background | Text | Highlight |
|---|---|---|---|
| Standard | app tokens | app tokens | existing highlight token |
| Black on white | `#ffffff` | `#000000` | `#ffe14d` fill, black text |
| Black on cream | `#f5efdc` | `#000000` | `#f2c200` fill, black text |
| Yellow on black | `#000000` | `#ffe600` | `#00b3ff` fill, black text, 1 px outline |

Minimum contrast 7:1 for text in all non-standard schemes; keep inputs, borders and the focus ring visible (inputs inherit the scheme background with a 2 px text-colour border). Right/wrong marks never rely on colour alone (already true).

Persistence: remembered per device, not per attempt. Web `localStorage` key `lr:settings` = `{size:'std'|'lg'|'xl', scheme:'std'|'bw'|'cream'|'yb'}`. iOS `UserDefaults` `lr.settings`; Android SharedPreferences "lr" key `settings`. Same JSON. Apply immediately, no confirm. Include a "Reset to default" action. Applies in exam and practice, Listening and Reading. On web implement as `data-lr-size` and `data-lr-scheme` attributes on the content wrapper with CSS variables, not by recolouring component by component.

## 3. Timer behaviour

Reading exam countdown (the only countdown that warns):
- At 10:00 remaining, the clock flashes for about 10 s (1 Hz pulse of background and text), then stays in warn tone until 5:00. At 5:00 remaining it flashes again for about 10 s and then stays in the strong tone until time up. Announce once each time via a polite live region: "10 minutes remaining", "5 minutes remaining" (do not announce every second; the `role="timer"` element keeps its existing label).
- `prefers-reduced-motion: reduce` (web `@media`; iOS `accessibilityReduceMotion`; Android `Settings.Global.ANIMATOR_DURATION_SCALE == 0`/`isReduceMotionEnabled`): no pulsing; the colour change itself is the signal (static warn tone from 10:00, static strong tone from 5:00).
- Replaces the current thresholds (warn 300 s, bad 60 s). Because Reading practice has no countdown, nothing changes there.
- For a partial Reading attempt (`readingSeconds(parts)` = 1200 per part), the same absolute 10 and 5 minute marks apply, but only if the total limit is above 10 minutes.

Listening exam countdown: neutral tone at all times, no flashing, no warning announcements. The Review window (the 2 minute check at the end) may stay highlighted (warn tone, no animation), unchanged from today. `lateFrom` (the "late" evidence of the existing flow) is not a UI warning and stays as is.

Do not change clock arithmetic, autosave, auto-submit, or the stats ticker.

## 4. Hide screen

A Hide button in the top bar covers the test content area and the part tabs with a neutral full-area panel (app surface colour, centred text "Test hidden", a single "Show" button, auto-focused). The top bar stays visible so Submit and the clock remain reachable; the clock keeps running in exam mode. The panel states "The clock is still running." Listening: audio keeps playing, the panel adds "The recording is still playing." Hiding never pauses anything and never counts as leaving the test.

Details: hide content from assistive tech (`inert` on the content wrapper web-side, `.accessibilityHidden(true)` iOS, `clearAndSetSemantics` / `importantForAccessibility` Android) while the panel is shown; `Esc` or Enter on Show restores and returns focus to the Hide button. State is not persisted (a reload shows the test). Applies to practice mode too (harmless).

## 5. Top bar layout

Order, left to right: Exit (kept), test title with part (for example "Cambridge 17 Test 2, Part 3"; keep "Exam mode/Practice mode" as a small caption), then the timer centred in the bar, then on the right Notes (conditional), Help, Settings, Hide, Submit. Keep `SaveIndicator` just left of Notes. Timer centring: three-column grid `1fr auto 1fr` on web; mobile uses the same logic where width allows.

Small screens: below 640 px on web and on phones, the title drops to one line caption below the bar or is hidden (as today), Help/Settings/Hide/Notes collapse into one overflow "More" menu, while the timer and Submit stay visible. All buttons need text labels visible at 640 px and up, icon-only with `aria-label` below.

Help sheet content (short, scannable, same text on all platforms):
1. Navigation: use the question numbers at the bottom to jump; Next and Back move one question. Part tabs switch parts (in Listening exam the recording moves parts for you).
2. Flag for review: flag a question you want to come back to. Flagged questions are marked in the navigator and listed when you submit.
3. Highlight and notes: select text and choose Highlight or Add note (long-press on touch). Tap a highlight to remove it or open its note. Notes are kept on this device and are never sent anywhere.
4. Settings: change text size and colours without affecting the timer.
5. Hide: covers the test; the clock keeps running (and the recording keeps playing in Listening).
6. Submit: you can submit early; unanswered questions are listed first.
Keyboard shortcuts line (web only). Dismiss with Esc or Close; focus returns to the Help button.

Accessibility for all five features: every control is a real button with a label, popovers and sheets trap focus and close on Esc, focus returns to the trigger, the Hide panel and Help sheet are announced, no feature depends on colour alone, touch targets at least 44 pt/48 dp, and all text scales with the platform text-size settings in addition to the in-app size.

## File ownership

Each agent edits only its own list. Shared definitions (JSON shapes, colours, thresholds, Help text) live in this document, not in code. If a rule here is unclear, the web agent's choice is the reference implementation; mobile agents follow this text and do not wait.

Web agent (owns, may create new files under `apps/web/src/components/lr/` and `apps/web/src/lib/`):
- `apps/web/src/components/lr/Runner.tsx`, `Passage.tsx`, `QuestionGroup.tsx`, `Navigator.tsx`, `Audio.tsx` (only if the timer or hide needs it), their `*.test.tsx` files, and new files for marks, settings, help sheet, hide panel (suggested: `Marks.tsx`, `LrSettings.tsx`, `HelpSheet.tsx`).
- `apps/web/src/lib/lr.ts` (mark type, migration, settings helpers) plus a new test file.
- `apps/web/src/styles.css` for the `data-lr-size` / `data-lr-scheme` variables and the clock pulse keyframes.
- Not allowed: anything under `apps/web/src/routes/_app/admin*`, `apps/web/src/components/admin/*`, `apps/web/src/lib/admin.ts`, `apps/server/**`, `apps/web/src/openapi.json`, `apps/web/src/lib/schema.d.ts`, `Results.tsx`, `ReviewPanels.tsx`, `Hub.tsx` unless a shared type forces a trivial fix.

iOS agent (owns only):
- `apps/ios/IELTS/Views/LrRunnerView.swift`, `Views/LrQuestionViews.swift`, `Core/LrSession.swift`, and new files `apps/ios/IELTS/Core/LrMarks.swift`, `Core/LrSettings.swift`, `Views/LrMarksViews.swift`, `Views/LrHelpView.swift`.
- Add new files to the Xcode project/XcodeGen spec only if the project requires it (check `project.yml`); no other project edits.
- Not allowed: Result/Review/Hub views, `LrModels.swift`, `LrAudio.swift` (the Hide feature must not touch playback), Android, web, server.

Android agent (owns only):
- `apps/android/app/src/main/kotlin/com/soyeb/ieltspractice/ui/screens/lr/LrRunnerScreen.kt`, `LrParts.kt`, `LrQuestions.kt`, and new files in that package: `LrMarks.kt`, `LrSettings.kt`, `LrHelp.kt`.
- Strings and drawables used only by these features may be added to new resource files (for example `res/values/strings_lr_exam.xml`, `res/drawable/ic_lr_note.xml`, `ic_lr_settings.xml`, `ic_lr_hide.xml`, `ic_lr_help.xml`); do not edit existing resource files.
- Not allowed: `LrAudio.kt`, `LrSession.kt`, `LrHubScreen.kt`, `LrReviewUi.kt`, `LrResultScreen.kt`, `core/Lr.kt`, iOS, web, server.

Rules for all three: no local Xcode, Gradle, or emulator builds (CI builds mobile; web agent may run `nice pnpm --filter web exec tsc --noEmit` and `nice pnpm --filter web exec vitest run <files>`; report type errors in admin files without fixing them). Match the design system (`docs/design-system.md`) and existing tokens; keep copy free of em dashes. Do not commit unless asked.

## Acceptance checklist (per platform)

- Highlight in passage, question text and Listening form text; nothing highlightable inside an input.
- Note add, open, edit, delete, Notes panel with jump; survives reload/relaunch of the same attempt; absent from every network request.
- Settings: three sizes, four schemes, content area only, persists across attempts, reset works.
- Reading countdown pulses at 10 and 5 minutes; reduced motion gives a static change; Listening countdown stays neutral throughout.
- Hide covers content, clock and audio continue, Show restores focus.
- Top bar order and collapse behaviour as specified; Help sheet text matches.
- Keyboard / screen reader / large system text pass.
