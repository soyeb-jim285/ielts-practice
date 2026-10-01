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
)

/** iOS `.live`: the live examiner. */
@Serializable data object LiveExam

/** iOS `.writing(WritingMode)`: mode = "full" | "task1" | "task2" | "prompt"; [variant] = "academic" | "general" (task1/full); [promptId]/[parentId] for "prompt". */
@Serializable data class WritingEditor(
    val mode: String = "task2", val variant: String = "academic", val promptId: String? = null, val parentId: String? = null,
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
