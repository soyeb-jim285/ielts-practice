package com.soyeb.ieltspractice.ui.nav

/**
 * Every screen, by its demo/screenshot name (the names are the iOS `-screen` values, so Android and iOS shots line up).
 *
 * - [name]: `--es screen <name>` in demo mode, and the screenshot file name (`light-<name>.png`, `dark-<name>.png`).
 * - [start]: the destination the app opens on (a tab root or a pushed route).
 * - [variants]: screen-specific sub-tabs (the iOS `-tab` argument); one extra screenshot each, read in the screen with
 *   `LocalDemo.current?.tab`. Empty = just the screen.
 *
 * To cover a new screen in the screenshot tests, add a row here. Nothing else.
 */
data class ScreenSpec(val name: String, val start: Any = HomeTab, val variants: List<String> = emptyList())

val screenCatalog: List<ScreenSpec> = listOf(
    // Shell area. Sub-screens of login: Signup, Verify (emailed code), Forgot (email), Reset (code + new password). A "+end" suffix opens scrolled to the bottom.
    ScreenSpec("login", Login, listOf("SignIn", "Signup", "Verify", "Forgot", "Reset")),
    // Signed-out states (names match the iOS `-screen` values).
    ScreenSpec("guest-home", HomeTab, listOf("Top", "Lower+end")),
    ScreenSpec("guest-speaking", SpeakingTab),
    ScreenSpec("guest-writing", WritingTab),
    ScreenSpec("guest-review", ReviewTab),
    ScreenSpec("guest-settings", SettingsTab),
    ScreenSpec("guest-signin-sheet", Login),
    // Community mode: the guest's result and gates, the limit panels and fair-use dialog (drawn over their screen), tests left, the balance, own keys.
    ScreenSpec("guest-result", AttemptResult.of("as1")),
    ScreenSpec("guest-history", History()),
    ScreenSpec("quota-speaking-spent", SpeakingTab),
    ScreenSpec("gate-fairuse", SpeakingTab),
    ScreenSpec("gate-fairuse-guest", WritingTab),
    ScreenSpec("gate-quota-guest", WritingTab),
    ScreenSpec("gate-quota-community", SpeakingTab),
    ScreenSpec("gate-balance", SpeakingTab),
    ScreenSpec("gate-busy", WritingTab),
    ScreenSpec("gate-live-guest", SpeakingTab),
    ScreenSpec("gate-live-community", SpeakingTab),
    ScreenSpec("editor-blocked", WritingEditor("task2"), listOf("Typing")),
    ScreenSpec("settings-keys", SettingsTab, listOf("Empty", "Saved", "Stopped", "Error", "Checking")),
    ScreenSpec("settings-own-key", SettingsTab),
    ScreenSpec("home", HomeTab, listOf("Top", "Lower+end")),
    ScreenSpec("speaking", SpeakingTab),
    ScreenSpec("writing", WritingTab),
    ScreenSpec("review", ReviewTab, listOf("Question", "Revealed")),
    ScreenSpec("settings", SettingsTab, listOf("Top", "Models+end", "Picker")),
    ScreenSpec("bank", Bank("speaking")),
    ScreenSpec("bank-all", Bank("")),
    ScreenSpec("history", History()),
    ScreenSpec("mistakes", Mistakes()),
    // iOS result sub-tabs (Overview, Transcript, Fluency, Language, Improve; writing: Overview, Essay, Structure, Language, Improve):
    // Result sub-tabs; "-N" scrolls N screens down, "-Sheet" opens the mistake sheet (read in ui/screens/result/AttemptView.kt).
    ScreenSpec("result-speaking", AttemptResult.of("as1"), listOf(
        "Overview", "Overview-1", "Overview-2", "Transcript", "Transcript-1", "Transcript-Sheet", "Transcript-Lean", "Fluency", "Fluency-1", "Fluency-2", "Fluency-3",
        "Language", "Language-1", "Language-2", "Improve",
    )),
    ScreenSpec("result-writing", AttemptResult.of("aw1"), listOf("Overview", "Overview-1", "Essay", "Essay-Sheet", "Essay-Lean", "Structure", "Language", "Language-1", "Improve", "Improve-1")),
    ScreenSpec("result-session", AttemptResult.of("as1", "as2")),
    ScreenSpec("result-analysing", AttemptResult.of("as3")),
    ScreenSpec("result-failed", AttemptResult.of("as4")),
    ScreenSpec("result-nospeech", AttemptResult.of("as5")),
    ScreenSpec("session", SpeakingSession("part", 2)),
    ScreenSpec("session-p1", SpeakingSession("part", 1)),
    // Speaking area: the hub (pending uploads, scrolled), every state of the practice session, and the live examiner pre-screen and stage.
    // The screens read the screen name in demo mode (`LocalDemo.current?.screen`), so each state is its own row.
    ScreenSpec("speaking-pending", SpeakingTab),
    ScreenSpec("speaking-scrolled", SpeakingTab),
    ScreenSpec("session-prep", SpeakingSession("part", 2)),
    ScreenSpec("session-recording", SpeakingSession("part", 2)),
    ScreenSpec("session-recording-p1", SpeakingSession("part", 1)),
    ScreenSpec("session-mic", SpeakingSession("part", 1)),
    ScreenSpec("session-saving", SpeakingSession("full")),
    ScreenSpec("session-empty", SpeakingSession("prompt", 0, "missing")),
    ScreenSpec("editor", WritingEditor("task2")),
    ScreenSpec("editor-t1", WritingEditor("task1", "academic")),
    ScreenSpec("editor-full", WritingEditor("full", "academic")),
    // Writing area: hub, exam states (the editor reads `tab` in demo mode: Typing, Plan, Warning = 5 min, Final = 1 min, Overtime, Submit/Short = confirm, Exit, Paste, Error) and one Task 1 figure per chart kind.
    ScreenSpec("writing-scrolled", WritingTab, variants = listOf("Scrolled")),
    ScreenSpec("editor-states", WritingEditor("task2"), variants = listOf("Typing", "Plan", "Warning", "Final", "Overtime", "Submit", "Short", "Exit", "Paste", "Error")),
    ScreenSpec("editor-t1-scrolled", WritingEditor("task1", "academic"), variants = listOf("Scrolled")),
    ScreenSpec("editor-full-states", WritingEditor("full", "academic"), variants = listOf("Typing", "Submit")),
    ScreenSpec("editor-letter", WritingEditor("task1", "general")),
    ScreenSpec("chart-bar", WritingEditor("prompt", "academic", "w1b")),
    ScreenSpec("chart-pie", WritingEditor("prompt", "academic", "w1p"), variants = listOf("Top", "Scrolled")),
    ScreenSpec("chart-table", WritingEditor("prompt", "academic", "w1t")),
    ScreenSpec("chart-process", WritingEditor("prompt", "academic", "w1pr"), variants = listOf("Top", "Scrolled")),
    ScreenSpec("chart-map", WritingEditor("prompt", "academic", "w1m"), variants = listOf("Top", "Scrolled")),
    // Listening & Reading (names are the iOS `-screen` values). Runner states: the reading attempt is an in-progress exam, lra-l a practice listening, lra-le a listening exam.
    ScreenSpec("lr-hub", LrHub("reading")),
    ScreenSpec("lr-hub-listening", LrHub("listening")),
    ScreenSpec("lr-mode", LrHub("reading")),
    ScreenSpec("lr-reading", LrRun("lra-r")),
    ScreenSpec("lr-reading-questions", LrRun("lra-r")),
    ScreenSpec("lr-reading-p2", LrRun("lra-r")),
    ScreenSpec("lr-navigator", LrRun("lra-r")),
    ScreenSpec("lr-submit", LrRun("lra-r")),
    ScreenSpec("lr-leave", LrRun("lra-r")),
    ScreenSpec("lr-listening", LrRun("lra-l")),
    ScreenSpec("lr-listening-exam", LrRun("lra-le")),
    ScreenSpec("lr-listening-gate", LrRun("lra-le")),
    ScreenSpec("lr-listening-review", LrRun("lra-le")),
    ScreenSpec("lr-result", LrResult("lra-rs"), listOf("Top", "Lower+end")),
    ScreenSpec("lr-result-p2", LrResult("lra-rs"), listOf("Lower+end")),
    ScreenSpec("lr-result-listening", LrResult("lra-ls"), listOf("Top", "Lower+end")),
    // Review and analysis: a question selected in the result (evidence marked in the passage / transcript), the dictation sheet, pacing, spelling, dashboard.
    ScreenSpec("lr-result-detail", LrResult("lra-rs")),
    ScreenSpec("lr-result-detail-listening", LrResult("lra-ls")),
    ScreenSpec("lr-result-timestamps", LrResult("lra-ls")),
    ScreenSpec("lr-dictation", LrResult("lra-ls")),
    ScreenSpec("lr-result-pacing", LrResult("lra-rs")),
    ScreenSpec("mistakes-spelling", Mistakes()),
    ScreenSpec("dashboard-lr", HomeTab, listOf("LR")),
    ScreenSpec("lr-history", History()),
    ScreenSpec("lr-home", HomeTab, listOf("Lower+end")),
    ScreenSpec("live", LiveExam),
    ScreenSpec("live-heard", LiveExam),
    ScreenSpec("live-intro", LiveExam),
    ScreenSpec("live-prep", LiveExam),
    ScreenSpec("live-talk", LiveExam),
    ScreenSpec("live-failed", LiveExam),
)

/** Where `--es screen <name>` opens; unknown or missing names open Home. */
fun startFor(screen: String?): Any = screenCatalog.firstOrNull { it.name == screen }?.start ?: HomeTab
