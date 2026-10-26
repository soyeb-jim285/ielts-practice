# NextBand Coach: design

Date: 2026-10-27. Status: draft for owner review.
Mockup (example data): https://claude.ai/artifact/JDSDZMSZfLtTstMmcU1cSm

## 1. Intent

After each test a student already gets detailed feedback on that one test. What is missing is the layer a real teacher adds: looking at **all** of a student's past tests, noticing what keeps happening, saying what improved, and telling them the few things to do next. The coach is that layer.

The owner's words: a coach that "examines your progress, monitors you and gives overall feedback and a path for improvement", built from "all of my previous history of exams, not just one exam", "organised clearly and easy to understand", "cool and really helpful". It should cover trends, where you improved, where to focus, better words to learn or swap, the kinds of spelling you miss, what is wrong with your thinking and writing style, Listening and Reading problems, and a cheat sheet of things to keep in mind.

Research behind the shape (sources in the research notes of the brainstorm; summary here):

- Feedback changes behaviour when it is specific, carries real information, and is limited to a few targets. Over a third of feedback interventions in a large meta-analysis made performance worse, mostly when feedback was vague or aimed at the person rather than the task (Kluger & DeNisi; Wisniewski et al. 2020; Hattie & Timperley).
- Grouping errors into patterns and focusing on one or two beats marking everything (focused written corrective feedback literature).
- Band scores are noisy: the official standard error is about 0.4 band for Listening and Reading, and AI scoring adds more. A single 0.5 move is mostly noise.
- Products that model a person (Whoop, Oura) show a "still learning you" state until they have enough data.
- AI tutors invent things (Khan Academy's Khanmigo misjudged correct answers). The fix is to compute every number in code and let the model only word and prioritise from those facts, with each point citing its source.
- Compare students with themselves and their target, never with other users; peer comparison demotivates weaker students.
- Weekly emails that work are short: one win, one focus, one button, sent only when something changed, never guilt-tripping.
- Specific goals and "if-then" plans ("Tuesday: one body paragraph, 15 minutes") raise follow-through.

## 2. Goals

1. A **Coach** page for every user (guests, free and paid alike) that shows, from the whole history:
   - a short plain-language summary: where they are, what holds them back, this week's aim;
   - per-skill band range, trend and distance to target;
   - **This week's focus**: 1 to 3 items, ranked by likely band gain, each with evidence from their own tests, a link to those tests, and one action;
   - at most one **win** (a pattern that used to happen and has stopped, or a real improvement);
   - **Your patterns** per skill (tabs): Writing word swaps, spelling habits, argument and structure habits, time and length; Speaking fluency, overused words, sounds to practise, answer development; Listening and Reading marks lost by cause and accuracy by question type, and time use;
   - a **cheat sheet** ("Before your next test", up to 5 lines) from their own traps;
   - **Your week**: a short plan, sized to the exam date when one is set;
   - a "This is wrong" control on every focus item, pattern line and cheat sheet line.
2. The coach **refreshes at most once a day, and only when the student finished a new test** since the last report. No new test, no new report (the page keeps showing the last one with its date).
3. A **weekly email** on Monday morning in the student's timezone, only if they practised in the previous 7 days and have product emails on: one win, one focus, one button.
4. Optional **target band** and **exam date** that the student sets on the Coach page.
5. Words swapped in from the coach can be added to the existing Review deck.

## 3. Non-goals

- No chat with the coach. It is a report, not a conversation (could come later).
- No comparison with other users, percentiles or leaderboards.
- No push notifications (none exist on any platform yet).
- No re-analysing old attempts. The coach reads what each test already stored; older attempts missing newer fields (e.g. `lexical`, `development`, pronunciation detail) simply contribute less.
- No new per-question timing capture for Listening and Reading in this project.
- Native apps (Android, iOS) are not built in this project. The API is designed so they can add a Coach screen later.

## 4. Anti-goals (a failure even if it works)

- Any number or claim that is not computed from the student's data. If there is no evidence, the item does not appear.
- Generic advice that would fit any student ("practise more vocabulary").
- Declaring a trend from noise (two tests, or a 0.5 move that does not hold).
- Long lists. The top of the page must fit the rule: one summary, at most 3 focus items, at most 1 win.
- Guilt-tripping or person-focused copy ("you are a weak writer"). Copy talks about the work and the next step.
- Word swaps that are thesaurus upgrades a student could misuse. Only swaps grounded in their own corrected mistakes or the per-test `vocabUpgrades` suggestions.
- Surprise cost. One small model call per active user per day at most, and none for the weekly email.

## 5. Constraints

- Project rules in `AGENTS.md`: cheap OpenRouter models only (`openai/gpt-6-luna`, `deepseek/deepseek-v4.1-flash`; no Qwen); state the estimated cost before any paid run; commit only when the owner asks; native builds only on CI; decide UI details yourself and keep WCAG AA.
- Read provider docs (OpenRouter llms.txt, model page) before writing the model call; no guessed parameters.
- Brand: NextBand; do not put "IELTS" in the brand. Product copy may name IELTS question types.
- Web stack: Hono + zod-openapi server, drizzle migrations, Vite/React web with TanStack Router/Query, existing UI kit in `apps/web/src/components/ui`. After API schema changes run `pnpm gen:api` and commit `apps/web/src/openapi.json`.
- Emails go through the existing React Email system (`apps/server/src/emails/`), unsubscribe and `productEmails` setting.
- The server can run more than one process during a deploy; scheduled work must be safe if two processes run it.

## 6. What already exists (the coach builds on it)

From the codebase inventory:

| Data | Where |
|---|---|
| Writing/Speaking attempts, scores per criterion, full analysis JSON | `attempts`, `analyses.result` (`AnalysisResult` in `apps/server/src/ai/types.ts`) |
| Every Writing/Speaking mistake with a category | `mistakes` table, categories in `apps/server/src/ai/schemas.ts` (`MISTAKE_CATEGORIES`) |
| Word swap suggestions per test | `analyses.result.vocabUpgrades` |
| Writing structure (paragraph roles, position, overview) | `analyses.result.structure` |
| Writing text metrics (length, linkers, repeated words) | `analyses.result.textMetrics` |
| Speaking fluency (pauses, fillers, speed, overused words) | `analyses.result.metrics` (`SpeechMetrics`) |
| Speaking pronunciation (sound confusions, stress) | `analyses.result.pronunciation` |
| Speaking answer development per question | `analyses.result.relevance[].development` |
| Listening/Reading marks, causes, spelling, T/F/NG confusions, accuracy by type | `lrAttempts.marks`, `lrAttempts.analysis` (`LrAnalysis`: `gaps`, `tfng`, `byType`, `causes`) |
| Listening/Reading time per part, answer changes, late answers | `lrAttempts.stats` (`LrStats`: `partS`, `changes`, `late`) |
| Existing aggregations | `GET /api/progress` (W/S trend, weakest criterion, top mistakes), `GET /api/lr/progress` (L/R trend, by type, T/F/NG pattern), `GET /api/lr/spelling` |
| Review deck (spaced repetition) | `cards` table, `routes/cards.ts` |
| Email sending, unsubscribe, product emails setting | `emails/campaigns.ts`, `email.ts sendBatch`, `settings.ts productEmails` |
| Cost ledger | `aiCosts` with a `stage` string |

Gaps the project fills: no cross-test aggregation of vocabulary, structure, fluency or pronunciation; `mistakes` has no `skill` (join through `attempts`); no user timezone; no scheduler beyond in-process `setInterval`s; nowhere to store a coach report or feedback on it.

## 7. How it works (decided)

### 7.1 Two layers: facts in code, words from the model

1. **Facts (deterministic, free).** A server module builds a `CoachFacts` object from the database for one user: per-skill bands and trend, pattern counts with the IDs of the attempts/mistakes/questions behind them, candidate focus items with a priority score, candidate wins, swap candidates, cheat-sheet candidates, timing figures. Every candidate carries `evidence` (attempt IDs and, where relevant, mistake IDs or L/R question numbers) and the exact counts.
2. **Words (one model call).** The facts go to one cheap model call that returns the summary sentence(s), the chosen focus items (picked from the candidates, max 3) with titles, a one-line "why it matters" and an action, the win line, the cheat-sheet lines and the week plan lines. It must reference candidates by ID and may not introduce numbers. The server validates the output: unknown IDs are dropped, any digit in the model's text that is not in the cited candidate's facts causes that item to fall back to a template line built from the facts. If the call fails, the whole report falls back to templates (the page still works with no model).

### 7.2 Rules in the facts layer

- **Enough data.** A skill shows a trend only with at least 3 scored tests of that skill; below that it shows "Still learning you · N more test(s)". The overall summary needs at least 2 skills with any score. With zero tests the page is an empty state that says what the coach will show and links to a first test.
- **Band.** Per skill: the mean of the last 5 scored tests (Writing: Task 2 and Task 1 counted separately in the facts, shown combined as "Writing"; Speaking: full tests and single parts, as the existing progress logic does), shown with a range of ±0.5 rounded to the half band.
- **Trend.** Compare the mean of the last 3 with the mean of the 3 before. "Improving" or "Slipping a little" only when the difference is 0.5 or more and needs at least 6 tests; otherwise "Steady". With 3 to 5 tests, always "Steady" unless the target gap is the story.
- **Patterns.** A pattern is a mistake category (W/S), an L/R gap kind or cause, a structure flag, a fluency or pronunciation measure, or a question type. It counts only if it happened in at least 2 different tests, or 3 or more times overall, within the window (last 60 days or last 15 tests per skill, whichever is smaller).
- **Focus priority.** score = (target gap of that skill, floored at 0.25 so a skill at or above target can still get a lower-ranked item; 0.5 when no target) × share of recent tests showing the pattern × a fixability weight (fixed table in code: e.g. plurals, spelling, word limit, T/F/NG confusion, "ideas not developed" high; pronunciation sounds and overall fluency lower). Top 6 candidates go to the model; it picks up to 3. Never more than 2 focus items from the same skill.
- **Win.** A pattern that appeared in at least 3 of the older tests in the window and in none of the last 3 tests of that skill, or a skill trend of "Improving". At most one is shown.
- **Word swaps.** Only from (a) `mistakes` with categories `lexis.collocation`, `lexis.word-choice`, `lexis.repetition`, using the stored correction, and (b) `vocabUpgrades` (Writing and Speaking) that repeat across at least 2 tests. Each swap shows how many times the original was used. Speaking's `metrics.lexical.overused` words are listed with their count; an alternative is shown only when one of the student's own `vocabUpgrades` or corrections supplies it. The model never invents alternatives. *(Builder-check call.)*
- **Actions.** Every focus item and plan line carries an action from a fixed table in code: action type, label, route and optional filter, and its minutes. Actions link only to practice that already exists (a Writing or Speaking test or part, a Listening/Reading test or the existing suggested test, the attempts behind the evidence, the Review deck). No new exercise types in this project. The model picks an action type from the candidate's allowed list and may reword the label without numbers; minutes and other numbers come from the table. *(Builder-check call.)*
- **Spelling habits.** Writing `lexis.spelling` mistakes and Listening spelling gaps, grouped by a small rule set in code (double letters, -ment/-ence/-ance endings, silent letters, ie/ei, plural -s, other), each with up to 2 of the student's own examples.
- **Week plan.** Without an exam date: 3 to 4 short sessions this week, one per focus item plus a Review session if cards are due. With an exam date: same, and the summary states days left; within 14 days of the exam the plan shifts to full timed tests and the cheat sheet.
- **Cheat sheet.** Up to 5 lines, from the top focus items and the highest-count L/R traps; each line is one concrete check.

### 7.3 When it refreshes

- A report is a stored snapshot (facts + words + generated date).
- **Triggers:** (a) an hourly in-process sweep finds users whose newest finished test (scored W/S attempt or submitted L/R attempt) is newer than their latest report, and whose latest report is from an earlier local day; (b) when a student opens the Coach page and the same condition holds, the server generates it then (with a short "Updating your coach" state on the page).
- At most one generated report per user per local day. If no new test since the last report, nothing is generated and no model call is made.
- Concurrency: generation takes a per-user Postgres advisory lock; the sweep takes a global advisory lock so only one process runs it.
- Timezone: the web app sends the browser timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) and the server stores it in user settings; default UTC until known.

### 7.4 Weekly email

- Hourly sweep checks for users whose local time is Monday 09:00–09:59, who have `productEmails` on, a verified non-guest email, at least one finished test in the last 7 days, and a report; and who have not been sent the weekly email for that week (recorded per user).
- Content comes from the latest report plus the week's numbers, no extra model call. In order:
  1. Subject and hero line from the win (or the summary when there is no win).
  2. "Hi {name}, here's your week."
  3. **This week in numbers**: one row of 3 to 4 stats using the existing `stats` email block: tests finished, minutes practised and days practised, each with the change against the previous 7 days; plus one skill band when the trend rules in 7.2 call it "Improving", whose change is that same last-3-vs-previous-3 difference (e.g. "Listening 7.0, +0.5"). *(Builder-check call.)* Stats with no data are left out, never shown as zero to shame.
  4. One win, one focus (from the coach report), one button to the Coach page.
- Branding: the standard NextBand email layout, never a stripped-down one: logo and "Open NextBand" in the header, the brand-coloured hero, and the dark footer with the light logo, social icons, links and the reason line. Uses the existing email layout with the promo footer (Preferences and Unsubscribe links, List-Unsubscribe headers).
- Admin can edit the weekly email's wording in Admin → Emails: subject, hero eyebrow, intro line and button label, with placeholders. The numbers row, win and focus are filled by the server into fixed places and are not editable blocks. No conditional or repeating blocks are added to the template system. *(Builder-check call.)*

### 7.5 Target band and exam date

- Two optional fields stored in user settings, editable on the Coach page (small inline control in the header) and in Settings.
- Target band choices 5.0 to 9.0 in half steps. Without a target, the page hides "distance to target" lines and the priority uses 0.5 as the gap.

### 7.6 "This is wrong"

- Each focus item, pattern line and cheat-sheet line has a "This is wrong" control. It hides that item for that student until the next report and stores the feedback (user, report, item key, optional note).
- Admin sees a simple list of coach feedback (a section on the existing admin pages), to spot bad rules or prompts.

### 7.7 Where it lives

- Web: a **Coach** item in the sidebar "Improve" group (above Mistakes) and in the mobile More sheet, route `/coach`. The dashboard gets a small card with the summary sentence and a link.
- API: `GET /api/coach` returns the latest report (or the empty / calibrating state and whether an update is running), `POST /api/coach/feedback`, settings fields for target band, exam date and timezone through the existing settings route.
- The page follows the mockup's order: summary, by skill, this week's focus, win, patterns (tabs), cheat sheet, your week. Links from evidence go to the existing result pages (Writing/Speaking attempt pages, L/R result pages).

### 7.8 Cost

- One model call per user per local day, only on days they finished a new test. Model: `openai/gpt-6-luna` (fallback `deepseek/deepseek-v4.1-flash`). Input is the facts JSON (target well under 6k tokens; trim lists to the top candidates), output under 1k tokens.
- Recorded in `aiCosts` with stage `coach`.
- Before the first paid run the builder looks up current prices on the OpenRouter model pages and states the estimated cost per report and per 1,000 active users per day to the owner.
- Weekly email: no model call.

## 8. Left to the builder

- Table and column names, exact JSON shapes of `CoachFacts` and the stored report, and file layout.
- The exact fixability weights and spelling grouping rules (start from the lists above; keep them in one table in code).
- Prompt wording, within the rules in 7.1 (cite candidate IDs, no new numbers, plain friendly copy that talks about the work).
- Copy for empty and calibrating states, following the existing app voice.
- Visual details, following the mockup and the app's UI kit, WCAG AA, light and dark.
- How "Writing" combines Task 1 and Task 2 on screen, as long as the facts keep them apart.
- Test strategy (follow the repo's vitest patterns; the facts layer needs unit tests with fixture histories covering: zero tests, 2 tests, noisy trend, a real win, a validator rejecting an invented number).
