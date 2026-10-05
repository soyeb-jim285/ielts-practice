# Full mock exam

One guided run of the whole test: Listening, Reading, Writing, then Speaking, with a combined overall band. It is a thin layer over the existing sections. Nothing about how a section runs, is scored or is charged changes; the mock only picks the tests, sequences them, keeps the clocks honest and gathers the results.

Hard rules: do not fork `Runner`, `WritingExam`, `SessionFlow` or the live examiner. Each section creates its normal attempt (`lr_attempts` row, `attempts` rows for writing and speaking) and the result pages stay as they are. No change to scoring, to quota arithmetic, or to the Listening/Reading/Writing/Speaking runners beyond the small hooks listed under "Reuse hooks".

## 1. Behaviour

### Start screen (`/mock`)
- Entry points: a "Full mock test" row on the dashboard and one card on each of the four skill hubs (Listening, Reading, Writing, Speaking), all linking to `/mock`. Signed-out visitors and guests see the usual `AccountGate` (a mock needs an account: it spans days and L/R attempts need one).
- Variant: Academic or General Training (segmented control, remembered per device).
- Question source (shown as the existing source picker, same wording):
  - "Cambridge complete test" only when `GET /api/mock/options` returns Cambridge candidates (account has Cambridge access). A list of `C<book> T<test>` choices, each guaranteed to have Listening, Reading, Writing and Speaking for that variant (see 3.3). Default: the lowest-numbered one the person has not started a mock on; "Surprise me" picks one.
  - "Our own tests" (default for everyone else): the server picks one Listening, one Reading, a Writing Task 1 + Task 2 (task 1 matches the variant) and a speaking set from our generated bank.
- Rules card (plain list, no modal): order Listening, Reading, Writing, Speaking; times (Listening about 30 minutes plus a 2-minute check, Reading 60, Writing 60 for both tasks, Speaking 11 to 14); no pausing inside a timed section, as in the real test; the clock runs only inside a section; if you leave you resume with the time already used kept; Speaking may be done later, the mock stays open 7 days.
- Quota note via the existing `QuotaNote`. Start is blocked (same `BlockedPanel` and error codes) when the writing or speaking allowance is used up, checked before anything starts (see 4.1). Own-key and owner accounts never block.
- Resume: if the person has an open mock, `/mock` shows it first ("Continue your mock test, Reading next") with "Start a new one" behind a confirm that discards it. Only one open mock per user.

### Sequence and transitions
1. Listening: normal exam-mode Listening run (recording plays once, 2-minute check, 30-minute exam timing as the runner already does).
2. Reading: exam-mode Reading, 60 minutes.
3. Writing: Task 1 + Task 2 in `WritingExam` with the 3600 s `WRITING_SECONDS.full` clock.
4. Speaking: a choice screen: **Recorded test** (examiner reads the questions, non-live `SessionFlow`), **Live examiner** (offered only when `quota.liveProviders` is non-empty; otherwise shown disabled with the existing "add your own key" hint), or **Do it later** (mock stays open until `expires_at`).

Between sections a transition screen (`/mock/$id`, the same page doubles as the hub): "Listening finished. Next: Reading, 60 minutes." with one Start button, the list of sections with state ticks, and nothing running. Sections start only on that button. A section clock never runs on the transition screen.

Leaving mid-section (close tab, back, kill app): opening the mock again lands on the same section; Listening/Reading resume their existing `lr_attempt` with `elapsed_s` as saved by autosave; Writing resumes with elapsed time from `mock_exams.writing_elapsed_s` (drafts already persist locally per `useDrafts`, mobile equivalents likewise). Speaking has no countdown to preserve; an unfinished recorded session restarts at Part 1 (attempts only exist once parts are submitted, as today).

A submitted section can never be re-opened from the mock. Time-out behaviour inside a section is whatever the section already does (auto-submit).

### Results (`/mock/$id` once any section is done; the final state is the "Mock result" page)
- Four rows: Listening, Reading, Writing, Speaking, each with its band and a link to the normal section result (`/lr/result/$id`, `/writing/result/$id?session=`, `/speaking/result/$id?session=`).
- Overall band: mean of the four section bands, rounded to the nearest 0.5 by IELTS rules: x.25 becomes x.5, x.75 becomes x+1. Computed only when all four bands exist; until then "Overall appears when all four sections are marked".
- Pending states per row: "Not taken yet" (Speaking, with Do it now / Choose mode), "Being marked" (Writing or Speaking attempt still `analyzing`), "Marking failed, retry" (links to the attempt result page, which already has retry), "Skipped" (see abandon below).
- Section bands: Listening/Reading use `lr_attempts.band`. Writing = Task 1 band once, Task 2 band twice, divided by 3, rounded to the nearest 0.5 (official weighting). Speaking = mean of the part overalls from the speaking session, rounded to the nearest 0.5, using whatever session-overall helper the result page already uses; if none exists, add `sessionBand` next to the overall rounding. One function `overallBand(bands: number[])` and one `weightedWritingBand(t1, t2)` live in `packages/core/src/band.ts`; the server calls them and sends the finished numbers, so mobile never recomputes bands.
- Shown in History (a "Mock test" row at the top of the dated list with the overall band and a link) and on the dashboard (an open mock appears as the top "continue" item; a finished one as the latest mock band).
- "Finish without Speaking" (on the open mock, with confirm) closes it with `status = 'closed'`, Speaking "Skipped", overall null. Expired mocks (past `expires_at` with no speaking) close the same way lazily on read.
- Owner admin activity: out of scope unless trivial. Skipped; mocks are visible through the normal attempt rows.

## 2. Data model (one migration `apps/server/drizzle/0013_mock_exams.sql`, plus `schema.ts` and the drizzle snapshot/journal)

```ts
export const mockExams = pgTable('mock_exams', {
  id: id(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  variant: variantEnum('variant').notNull(),                       // academic | general
  source: text('source').$type<'cambridge' | 'generated'>().notNull(),
  ref: text('ref'),                                                 // "C19 T2" when source = cambridge, else null
  listeningTestId: text('listening_test_id').notNull().references(() => lrTests.id),
  readingTestId: text('reading_test_id').notNull().references(() => lrTests.id),
  writingPromptIds: text('writing_prompt_ids').array().notNull(),   // [task1, task2] prompt ids
  speakingPromptIds: text('speaking_prompt_ids').array(),           // recorded: [p1.., p2, p3]; null until Recorded is chosen
  listeningAttemptId: text('listening_attempt_id'),                 // lr_attempts.id, set when the section starts
  readingAttemptId: text('reading_attempt_id'),
  writingSessionId: text('writing_session_id').notNull(),           // shared by both writing attempts (quota unit, as WritingExam already does)
  writingAttemptIds: text('writing_attempt_ids').array().notNull().default([]),
  writingStartedAt: timestamp('writing_started_at', { withTimezone: true }),
  writingElapsedS: integer('writing_elapsed_s').notNull().default(0),
  speakingMode: text('speaking_mode').$type<'recorded' | 'live'>(), // null until chosen ("later" = still null)
  speakingSessionId: text('speaking_session_id'),                   // attempts.sessionId (recorded: made at choose time; live: the live_sessions id, attached at finish)
  status: text('status').$type<'in_progress' | 'completed' | 'closed'>().notNull().default('in_progress'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), // startedAt + 7 days
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (t) => [
  index('mock_exams_user_started_idx').on(t.userId, t.startedAt),
  uniqueIndex('mock_exams_one_open_idx').on(t.userId).where(sql`status = 'in_progress'`), // one open mock per user
]);
```

Per-section state is derived, not stored twice. The server computes, per section, `state: 'todo' | 'in_progress' | 'submitted' | 'marking' | 'done' | 'failed' | 'skipped'` and the band from the linked rows (`lr_attempts.status/band`, `attempts.status` + `analyses.overall`). `status = completed` is set lazily the first time a read finds all four bands; `completedAt` then is the latest section completion time.

Cascade: deleting a user deletes the mock. Deleting one of its attempts (existing remove-attempt) leaves the mock row; that section reads as `skipped`/not taken and the overall stays null. The attempt/LR rows get no new column: the link is the mock's ids (LR) and `writing_session_id` / `speaking_session_id` (writing and speaking), so History's grouping by `sessionId` already works.

## 3. Server (`apps/server`, zod-openapi, tag `Mock exam`)

New file `apps/server/src/routes/mock.ts`, registered in `routes/index.ts`. All routes use `requireUser` and load the mock with `where id = :id and user_id = :me` (404 for any other user, the same pattern as `ownAttempt`); the owner admin gets no extra access. After `pnpm gen:api` the web types come from `apps/web/src/lib/schema.d.ts`.

### 3.1 Endpoints
| Method, path | Purpose |
|---|---|
| `GET /api/mock/options?variant=` | What can be started: `{ cambridge: [{ ref, bookTest: "C19 T2", started: boolean }], own: boolean, quota: {writing, speaking} }`. `cambridge` is empty unless `isCambridgeAllowed(user)`. |
| `POST /api/mock` `{variant, source, ref?}` | Create. Picks the content (3.3), runs the quota pre-check for writing and speaking, inserts the row with fresh `writingSessionId`. 201 `Mock`. 409 `mock_open` if an open mock exists (body carries its id; client may retry with `?replace=true`, which deletes the old open mock row only, its attempts remain). 404 when `ref` is not a complete test or not allowed. 429/402/503 with the existing quota codes. |
| `GET /api/mock/current` | The open mock or `{mock: null}`; the dashboard/hubs/History use it. |
| `GET /api/mock/{id}` | `Mock` (shape below). Applies lazy `expired -> closed` and lazy `completed`. |
| `GET /api/mock` | My mocks, newest first (History, dashboard latest band). |
| `POST /api/mock/{id}/sections/{listening\|reading}/start` | Creates (or returns the existing in-progress) `lr_attempt` for that test in `exam` mode, whole test, same as `POST /api/lr/tests/{id}/attempts` (share the insert helper from `lr.ts`, do not copy it). Sections must be started in order: 409 `out_of_order` otherwise. Returns `{ attemptId }`. |
| `POST /api/mock/{id}/writing/start` | Marks `writing_started_at` if unset and returns the two prompts (full `PromptSchema`, same as `/api/prompts/{id}`) plus `writingSessionId`, `elapsedS`. 409 until Reading is submitted. |
| `PATCH /api/mock/{id}/writing/clock` `{elapsedS}` | Autosave of the writing clock (monotonic: only increases; rate-limited like the LR autosave). |
| `POST /api/mock/{id}/speaking/choose` `{mode: 'recorded' \| 'live'}` | Needs Writing submitted. `recorded`: chooses the speaking set (Cambridge: that ref's prompts; own: `pickSpeakingTest`), stores `speaking_prompt_ids`, `speaking_mode`, a new `speaking_session_id`; returns the `SpeakingTest` plus `sessionId`. `live`: `requireLive(payer, ...)` as `/api/live/start` does (403 `live_requires_own_key`); stores `speaking_mode = 'live'` and returns `{ source, ref }` for the client to pass to the live start. Re-choosing before any speaking attempt exists is allowed (switch mode); after attempts exist, 409. |
| `POST /api/mock/{id}/speaking/attach` `{sessionId}` | Live only: after `/api/live/finish`, store the live session id as `speaking_session_id`. Verifies attempts with that `session_id` exist and belong to the same user; 400 otherwise. |
| `POST /api/mock/{id}/close` | "Finish without Speaking": `status = 'closed'`. Allowed when Writing is submitted. |
| `DELETE /api/mock/{id}` | Abandon: deletes the mock row only (its attempts stay as normal practice history). |

`Mock` response (`.openapi('Mock')`):
```
{ id, variant, source, ref|null, status, startedAt, expiresAt, completedAt|null,
  next: 'listening'|'reading'|'writing'|'speaking'|null,     // first section not submitted
  overall: number|null,                                       // overallBand of four bands, null until all four
  sections: [
    { skill: 'listening'|'reading'|'writing'|'speaking',
      state, band: number|null,
      attemptId: string|null,           // lr attempt, first writing attempt, first speaking attempt (link target)
      sessionId: string|null,           // writing / speaking session for the result switcher
      elapsedS: number|null, limitS: number,   // listening 1800 (+check), reading 3600, writing 3600, speaking null
      mode: 'recorded'|'live'|null }
  ] }
```
Never includes answers or other users' data. Test content is read through the existing endpoints with the test ids returned by the start calls.

### 3.2 Reuse hooks in existing server files (small, optional fields only)
- `routes/attempts.ts` `POST /api/attempts`: accept optional `mockId`. When present, require the mock to be the caller's and open, require `sessionId === mock.writing_session_id` (writing) or `mock.speaking_session_id` (speaking), and append the new attempt id to `writing_attempt_ids` for writing. This lets the unchanged `WritingExam`/`SessionFlow` code keep sending `sessionId` and just add `mockId`.
- `routes/live.ts` `POST /api/live/start`: accept optional `mockId`; when present, load the mock (owner check), use `pickSpeakingTest` with the mock's `ref` and `source` (add an optional `ref` filter to `pickSpeakingTest` in `routes/prompts.ts`, matching `prompts.sourceRef`), and check `speaking_mode = 'live'`.
- `routes/lr.ts`: export the attempt-insert helper used by `POST /api/lr/tests/{id}/attempts` for reuse. Nothing else.
- `quota.ts` needs no change. The mock pre-check calls `checkStart(payer, 'writing', ip, writingSessionId)` and `checkStart(payer, 'speaking', ip)` at create; the real reservation still happens at submit exactly as today (writing: unit = `writingSessionId`; recorded speaking: unit = `speakingSessionId`, all parts share one test; live: not charged from the community balance). Because speaking is often done days later, create only checks that speaking is not blocked now; `speaking/choose` (recorded) runs `checkStart` again and surfaces the normal blocker. Mock create/choose never reserve anything.

### 3.3 Picking content ("complete Cambridge test")
- Key: the `"C<book> T<test>"` string. It is `lr_tests.ref` for Listening and Reading (`C11 T1`, from `data/cambridge-lr`) and `prompts.sourceRef` for Writing and Speaking prompts (e.g. `C17 T2`). Same format, so one equality join.
- A ref is a complete test for a variant when all of these exist: an `lr_tests` Listening row with that ref and `variant`; an `lr_tests` Reading row with that ref and `variant`; writing prompts with `source = 'cambridge'`, that `sourceRef`, part 1 with `variant` = the variant and part 2; speaking prompts with that `sourceRef` for part 1, part 2 (with a `groupId` that has a part 3). Listening is the same recording for both variants, so its `variant` is not matched (a matching one is preferred); Reading, Writing 1 and the other pieces must match the variant.
- The options query is one SQL grouped by `sourceRef`/`ref` with `bool_and`-style existence checks; cache nothing (cheap, rare).
- Own tests: Listening and Reading from `lr_tests` with `source = 'generated'`, preferring ones the user has no submitted attempt on; writing via `/prompts/random` logic (task 1 for the variant, task 2); speaking via `pickSpeakingTest(user, 'generated')`. If any piece is missing the create fails with 404 `no_complete_set` and a plain message.
- Restricted (Cambridge) rows are only picked for `isCambridgeAllowed` accounts (reuse `canOpen` / `visiblePromptWhere`).

### 3.4 Core (`packages/core`)
`overallBand(bands)` and `weightedWritingBand(t1, t2)` in `band.ts` with a unit test (6.25 to 6.5, 6.75 to 7, 6.125 to 6.0, 6.375 to 6.5). Exported from the package index. Mobile does not port them (the server sends results), keeping a single implementation.

### 3.5 Tests (`apps/server/src/routes/mock.test.ts`)
Owner-only access (second user gets 404 on read, start, clock, close), one open mock per user, section ordering (409), Cambridge refs hidden from non-allowed accounts, quota pre-check blocks at create, band maths (overall and writing weighting), lazy expiry, attach rejects a foreign session id. Run: `TEST_DB=<unique> nice pnpm --filter server exec vitest run src/routes/mock.test.ts`.

## 4. Web (`apps/web`)

New and changed:
- `src/routes/_app/mock/index.tsx`: start screen (variant, source, rules, quota, resume card).
- `src/routes/_app/mock/$id.tsx`: the hub/transition/result page. Renders by `mock.next`: transition card with Start for the next section, the speaking choice card, or the final result. Polls `GET /api/mock/{id}` every 5 s while any section is `marking`.
- `src/components/mock/` (new folder): `MockStart.tsx`, `SectionList.tsx` (the four-row list used by transition and result), `Transition.tsx`, `SpeakingChoice.tsx`, `MockResult.tsx`, `MockCta.tsx` (the "Full mock test" entry card used on the dashboard and hubs), `useMock.ts` (query + mutations, `mockQuery`).
- Section routes, existing files with a `mock` search param only:
  - `routes/_app/lr/run.$attemptId.tsx`: `validateSearch` adds `mock?: string`; passes it to `Runner`.
  - `components/lr/Runner.tsx`: accept optional `mockId`; on submit navigate to `/mock/$id` instead of the LR result; Exit goes to `/mock/$id` (does not discard). No other change. A mock's LR attempt is always `exam` mode, so the existing exam chrome applies.
  - `routes/_app/writing/full.tsx`: new sibling `routes/_app/writing/mock.$id.tsx` is not needed; add `mock?: string` to `full.tsx` search. When set, load prompts from `writing/start` (not from `t1`/`t2`), pass `mockId`, `initialElapsedS` and `sessionId` to `WritingExam`.
  - `components/writing/WritingExam.tsx`: optional props `mockId`, `sessionId`, `initialElapsedS`. `useDeadline` starts from `seconds - initialElapsedS`; while mounted it PATCHes `writing/clock` every 15 s and on `visibilitychange`; sends `mockId` with each `POST /attempts`; after the last submit navigates to `/mock/$id`. The existing local `sessionId` ref is replaced by the prop when present.
  - `routes/_app/speaking/session.tsx`: add `mock?: string` search; when set, skip `/speaking/test` and use the segments from `speaking/choose`, pass `sessionId` and `mockId`; `SessionFlow` forwards `mockId` on its `POST /attempts` and returns to `/mock/$id` instead of the result.
  - `routes/_app/speaking/live.tsx`: add `mock?: string`; passes `mockId` to `/live/start`, and after `onFinished` calls `speaking/attach` then navigates to `/mock/$id`.
- Entry points: `routes/_app/index.tsx` (dashboard row and, when `current` exists, a continue banner), `components/lr/Hub.tsx` (both L and R hubs), `routes/_app/writing/index.tsx`, `routes/_app/speaking/index.tsx`: one `<MockCta />` each.
- History: `routes/_app/history.tsx` merges `GET /api/mock` rows as a "Mock test" item (overall band, date, link to `/mock/$id`). The member attempts still appear in their own skill filters.
- Quota and gate: `/mock` start uses `QuotaNote`/`BlockedPanel`; section writing/speaking inside a mock are wrapped in `TestGate` as today (they pass quickly because the mock already checked).
- Design: follow `docs/design-system.md` and existing tokens (`panelFooterStyles`, `rowStyles`, `ExamShell` for the transition screens so the exam chrome stays calm; `type-num` for bands). Four-row result list reuses band colours via `bandColor`. Mobile width first; keep AA. Tests: `components/mock/*.test.tsx` for the transition copy and pending states, `lib` helper for "next section" label/time.

## 5. iOS (`apps/ios/IELTS`)
- `Core/MockModels.swift` (Codable `Mock`, `MockSection`, options) and calls on `APIClient` (extension in the same new file, not editing `APIClient.swift`).
- `Views/MockStartView.swift`, `Views/MockHubView.swift` (transition, speaking choice, result in one view like the web page), `Views/MockCards.swift` (the entry card).
- Hooks into existing views (smallest edits): `DashboardView.swift` (entry/continue card), `LrHubView.swift`, `WritingHomeView.swift`, `SpeakingHomeView.swift` (entry card), `HistoryView.swift` (mock rows), `LrRunnerView.swift` (optional `mockId`; Exit/submit return to the hub), `WritingEditorView.swift` (optional `mockId`, `sessionId`, `initialElapsedS`, clock PATCH every 15 s, `mockId` on attempt create), `SpeakingSessionView.swift` and `LiveExamView.swift` (optional `mockId`; attach after live finish), `IELTSApp.swift` navigation destinations.
- Demo fixtures (`Demo/fixtures.json`) get one mock only if the demo tour already lists LR; otherwise skip.

## 6. Android (`apps/android/app/src/main/kotlin/com/soyeb/ieltspractice`)
- `core/Mock.kt` (models and API calls), `ui/screens/MockStartScreen.kt`, `ui/screens/MockHubScreen.kt`, `ui/mock/MockCards.kt` (entry card).
- Hooks: `ui/nav/Routes.kt` and `ui/nav/AppNav.kt` (routes `mock`, `mock/{id}`), `DashboardScreen.kt`, `ui/screens/lr/LrHubScreen` (the L/R hub file, wherever it lives under `ui/screens/lr/`), `SpeakingHomeScreen.kt`, the writing home (`WritingEditorScreen.kt` neighbour), `HistoryScreen.kt`, `ui/screens/lr/LrRunnerScreen.kt`, `WritingEditorScreen.kt`, `SpeakingSessionScreen.kt`, `LiveExamScreen.kt` with the same optional `mockId` behaviour as iOS.
- Tests: `core/MockTest.kt` for JSON decoding and next-section label logic. CI builds; no local Gradle.
- Update `apps/android/PARITY.md` with the mock rows.

## 7. File ownership (no overlaps)

| Agent | Owns (may create or edit) |
|---|---|
| Server | `apps/server/**` (`routes/mock.ts`, `routes/mock.test.ts`, `routes/index.ts`, `db/schema.ts`, `drizzle/0013_mock_exams.sql` + `meta/*`, hook edits in `routes/attempts.ts`, `routes/live.ts`, `routes/lr.ts`, `routes/prompts.ts`), `packages/core/src/band.ts` + its test + index export, `docs/mock-exam.md` (spec fixes only). Runs `pnpm gen:api` and commits the regenerated `apps/web/src/lib/schema.d.ts` before the web agent starts. |
| Web | `apps/web/src/**` except `lib/schema.d.ts` (generated, read-only). |
| iOS | `apps/ios/**`. |
| Android | `apps/android/**`. |

Order: server first (API + generated types + OpenAPI), then web, iOS and Android in parallel against the spec. Mobile agents read the endpoint table in section 3 and the `Mock` shape; they do not wait for the web.

## 8. Edge cases to keep in mind
- Cambridge access revoked mid-mock: the linked Cambridge tests keep working through the existing attempt endpoints? They do not (`canOpen` fails). Accept it: the section start returns 404 and the hub offers "Abandon".
- Two devices: the mock is server state, so both see the same next step; the writing clock takes the max elapsed. A second device resuming a section that the first one is running is last-write-wins on autosave, as LR already is.
- Quota rolled over before Speaking: the normal speaking gate decides at that time.
- Failed analysis of one attempt: that row says "Marking failed, retry" and the overall waits; the existing refund logic applies per unit untouched.
