package com.soyeb.ieltspractice.ui.nav

import kotlinx.serialization.Serializable

// Type-safe Navigation Compose routes: one per iOS `Route` case (apps/ios/IELTS/IELTSApp.swift) plus the five tab roots and Login.
// Arguments are flattened to primitives (Navigation handles those natively): iOS `SpeakingMode.part(2)` becomes
// `SpeakingSession(mode = "part", part = 2)`.

// Tab roots (the bottom navigation bar). iOS `Route.review` (push) is just the Review tab here: `nav.openTab(Tab.Review)`.
@Serializable data object HomeTab
@Serializable data object SpeakingTab
@Serializable data object WritingTab
@Serializable data object ReviewTab
@Serializable data object SettingsTab

/** Sign in / create account / forgot password. Guests browse freely; screens call `nav.requireSignIn { ... }` before taking a test or showing personal data. */
@Serializable data object Login

/** iOS `.speaking(SpeakingMode)`: mode = "full" | "part" (with [part] 1..3) | "prompt" (with [promptId], optional [parentId] for a retry). */
@Serializable data class SpeakingSession(
    val mode: String = "full", val part: Int = 0, val promptId: String? = null, val parentId: String? = null,
    /** mode = "mock": the recorded Speaking of this full mock test (the questions and session id come from the mock). */
    val mockId: String? = null,
)

/** iOS `.live`: the live examiner. */
@Serializable data object LiveExam

/** iOS `.writing(WritingMode)`: mode = "full" | "task1" | "task2" | "prompt"; [variant] = "academic" | "general" (task1/full); [promptId]/[parentId] for "prompt". */
@Serializable data class WritingEditor(
    val mode: String = "task2", val variant: String = "academic", val promptId: String? = null, val parentId: String? = null,
    /** mode = "mock": the Writing of this full mock test (both tasks, the session id and the clock come from the mock). */
    val mockId: String? = null,
)

/** iOS `.result([ids])`: one attempt, or a whole session (comma-joined ids, see [ids]). */
@Serializable data class AttemptResult(val ids: String) {
    val idList: List<String> get() = ids.split(',').filter { it.isNotBlank() }

    companion object { fun of(vararg ids: String) = AttemptResult(ids.joinToString(",")) }
}

/** iOS `.bank(skill:)`: "speaking" | "writing". */
@Serializable data class Bank(val skill: String)

/** iOS `.history(skill:)`: null for both skills. */
@Serializable data class History(val skill: String? = null)

/** iOS `.mistakes(category:)`: null for all categories. */
@Serializable data class Mistakes(val category: String? = null)

/** Listening & Reading (cambridge-gated): the hub of one skill ("listening" | "reading"), a test being taken, and the result of a submitted one. */
@Serializable data class LrHub(val skill: String)
/** [mockId]: the attempt belongs to a full mock test; submit and Exit return to the mock. */
@Serializable data class LrRun(val attemptId: String, val mockId: String? = null)
@Serializable data class LrResult(val attemptId: String)

/** Full mock test (docs/mock-exam.md): the start screen, the hub of one mock (transition, Speaking choice, result), and its live-examiner Speaking. */
@Serializable data object MockStart
@Serializable data class MockHub(val id: String)
@Serializable data class MockLive(val mockId: String)
