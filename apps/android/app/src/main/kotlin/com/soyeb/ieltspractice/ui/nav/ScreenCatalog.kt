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
    ScreenSpec("guest", HomeTab, listOf("Top", "Lower+end")),
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
    // the Result agent adds `variants = listOf("Overview", ...)` here.
    ScreenSpec("result-speaking", AttemptResult.of("as1")),
    ScreenSpec("result-writing", AttemptResult.of("aw1")),
    ScreenSpec("result-session", AttemptResult.of("as1", "as2")),
    ScreenSpec("result-analysing", AttemptResult.of("as3")),
    ScreenSpec("result-failed", AttemptResult.of("as4")),
    ScreenSpec("result-nospeech", AttemptResult.of("as5")),
    ScreenSpec("session", SpeakingSession("part", 2)),
    ScreenSpec("session-p1", SpeakingSession("part", 1)),
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
    ScreenSpec("live", LiveExam),
)

/** Where `--es screen <name>` opens; unknown or missing names open Home. */
fun startFor(screen: String?): Any = screenCatalog.firstOrNull { it.name == screen }?.start ?: HomeTab
