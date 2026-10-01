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
    ScreenSpec("live", LiveExam),
)

/** Where `--es screen <name>` opens; unknown or missing names open Home. */
fun startFor(screen: String?): Any = screenCatalog.firstOrNull { it.name == screen }?.start ?: HomeTab
