package com.soyeb.ieltspractice.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// Full mock exam (docs/mock-exam.md, section 3): models of the server's `Mock` shape, the calls, and the pure copy/state logic
// (port of web lib/mock.ts). The server sends every band, including the overall one, so nothing here computes a band.

@Serializable data class MockSection(
    val skill: String, // listening | reading | writing | speaking
    val state: String = "todo", // todo | in_progress | submitted | marking | done | failed | skipped
    val band: Double? = null,
    /** LR attempt, first writing attempt, first speaking attempt (the link target). */
    val attemptId: String? = null,
    /** Writing / speaking session, to open all of its attempts together. */
    val sessionId: String? = null,
    val elapsedS: Double? = null,
    val limitS: Double? = null,
    val mode: String? = null, // speaking: recorded | live
)

@Serializable data class Mock(
    val id: String,
    val variant: String = "academic",
    val source: String = "generated",
    val ref: String? = null,
    val status: String = "in_progress", // in_progress | completed | closed
    val startedAt: String = "",
    val expiresAt: String = "",
    val completedAt: String? = null,
    /** First section not yet submitted; null once the mock is completed or closed. */
    val next: String? = null,
    val overall: Double? = null,
    val sections: List<MockSection> = emptyList(),
) {
    val open: Boolean get() = status == "in_progress"
    fun section(skill: String): MockSection? = sections.firstOrNull { it.skill == skill }
    val marking: Boolean get() = sections.any { it.state == "marking" }
}

@Serializable data class CurrentMock(val mock: Mock? = null)
@Serializable data class MockList(val items: List<Mock> = emptyList())
@Serializable data class MockCambridge(val ref: String, val bookTest: String = ref, val started: Boolean = false)
@Serializable data class MockOptions(val cambridge: List<MockCambridge> = emptyList(), val own: Boolean = false)
@Serializable data class MockSectionStarted(val attemptId: String)
@Serializable data class MockWritingStarted(val prompts: List<Prompt>, val writingSessionId: String, val elapsedS: Double = 0.0)
@Serializable data class MockSpeakingChosen(val mode: String, val sessionId: String? = null, val test: SpeakingTest? = null)

// MARK: Calls

suspend fun ApiClient.mockCurrent(): Mock? = get<CurrentMock>("/api/mock/current").mock
suspend fun ApiClient.mockGet(id: String): Mock = get("/api/mock/$id")
suspend fun ApiClient.mockList(): List<Mock> = get<MockList>("/api/mock").items
suspend fun ApiClient.mockOptions(variant: String): MockOptions = get("/api/mock/options", mapOf("variant" to variant))

/** Creates the mock. A 409 `mock_open` (ApiError.code) means one is already open: retry with [replace] after the person confirmed. */
suspend fun ApiClient.mockCreate(variant: String, source: String, ref: String?, replace: Boolean): Mock =
    send("POST", "/api/mock" + if (replace) "?replace=true" else "", buildJsonObject {
        put("variant", variant); put("source", source)
        ref?.let { put("ref", it) }
    })

/** Listening or Reading: creates (or resumes) the exam-mode attempt; open it with `LrRun(attemptId, mockId)`. */
suspend fun ApiClient.mockStartSection(id: String, skill: String): String = send<MockSectionStarted>("POST", "/api/mock/$id/sections/$skill/start").attemptId
suspend fun ApiClient.mockWritingStart(id: String): MockWritingStarted = send("POST", "/api/mock/$id/writing/start")

/** Autosave of the Writing clock; the server only ever raises it. */
suspend fun ApiClient.mockWritingClock(id: String, elapsedS: Int) {
    raw("PATCH", "/api/mock/$id/writing/clock", buildJsonObject { put("elapsedS", elapsedS.coerceIn(0, 7200)) })
}

suspend fun ApiClient.mockChoose(id: String, mode: String): MockSpeakingChosen =
    send("POST", "/api/mock/$id/speaking/choose", buildJsonObject { put("mode", mode) })

/** Live examiner: link the finished live session to the mock. */
suspend fun ApiClient.mockAttach(id: String, sessionId: String): Mock =
    send("POST", "/api/mock/$id/speaking/attach", buildJsonObject { put("sessionId", sessionId) })

suspend fun ApiClient.mockClose(id: String): Mock = send("POST", "/api/mock/$id/close")
suspend fun ApiClient.mockAbandon(id: String) { raw("DELETE", "/api/mock/$id") }

// MARK: Copy and state (web lib/mock.ts)

enum class MockTone { Neutral, Accent, Good, Warn, Bad }

object MockFlow {
    val skills = listOf("listening", "reading", "writing", "speaking")
    val label = mapOf("listening" to "Listening", "reading" to "Reading", "writing" to "Writing", "speaking" to "Speaking")

    /** How long a section runs, for the transition copy. */
    val time = mapOf(
        "listening" to "about 30 minutes plus a 2-minute check",
        "reading" to "60 minutes",
        "writing" to "60 minutes for both tasks",
        "speaking" to "11 to 14 minutes",
    )

    val rules = listOf(
        "Order: Listening, Reading, Writing, then Speaking.",
        "Times: Listening about 30 minutes plus a 2-minute check, Reading 60, Writing 60 for both tasks, Speaking 11 to 14.",
        "No pausing inside a timed section, as in the real test. The clock runs only inside a section.",
        "If you leave, you resume with the time already used kept.",
        "Speaking can wait: the mock stays open for 7 days.",
    )

    fun name(skill: String) = label[skill] ?: skill.replaceFirstChar { it.uppercase() }

    /** What just finished and what comes next, or null when nothing is left. */
    fun transition(next: String?): Pair<String, String>? {
        if (next == null) return null
        val prev = skills.getOrNull(skills.indexOf(next) - 1)
        val nextTime = "${name(next)}, ${time[next]}"
        return when {
            prev == null -> "Ready for Listening?" to "Next: $nextTime. Nothing is running yet. The clock starts when you press Start."
            next == "speaking" -> "Writing finished. Choose how to do Speaking." to "Speaking has no countdown, so you can take it now or later this week."
            else -> "${name(prev)} finished." to "Next: $nextTime. Nothing is running. The clock starts when you press Start."
        }
    }

    /** The status text of a section row; Speaking has its own "not taken yet" wording. */
    fun stateLabel(skill: String, state: String): Pair<String, MockTone> = when (state) {
        "todo" -> (if (skill == "speaking") "Not taken yet" else "Not started") to MockTone.Neutral
        "in_progress" -> "In progress" to MockTone.Accent
        "submitted" -> "Submitted" to MockTone.Accent
        "marking" -> "Being marked" to MockTone.Accent
        "done" -> "Marked" to MockTone.Good
        "failed" -> "Marking failed, retry" to MockTone.Bad
        "skipped" -> "Skipped" to MockTone.Neutral
        else -> state to MockTone.Neutral
    }

    /** A submitted section has a result page to open. */
    fun isFinished(state: String) = state in setOf("submitted", "marking", "done", "failed")

    /** The small line under a section's name: time used, or the Speaking mode. */
    fun meta(s: MockSection): String? {
        val used = s.elapsedS
        if (s.state == "in_progress" && used != null && used > 0) {
            val limit = s.limitS?.takeIf { it > 0 }?.let { " of ${Math.round(it / 60.0)}" }.orEmpty()
            return "${(used / 60).toInt()} min used$limit"
        }
        if (s.skill == "speaking" && s.mode != null && s.state != "skipped") return if (s.mode == "live") "Live examiner" else "Recorded test"
        return null
    }

    /** The sentence under the overall band (or its absence). */
    fun overallNote(m: Mock, target: Double): String = when {
        m.overall != null -> "Mean of your four section bands, to the nearest half band. Target ${fmt(target)}."
        m.status == "closed" -> "This mock was finished without Speaking, so it has no overall band."
        m.marking -> "Overall appears when all four sections are marked. Marking takes about a minute."
        else -> "Overall appears when all four sections are marked."
    }

    /** "Continue your mock test" meta line for the entry card. */
    fun continueLine(m: Mock): String = "${m.next?.let { "${name(it)} next" } ?: "Open"}. Pick up where you stopped."
}
