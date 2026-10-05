package com.soyeb.ieltspractice.core

import com.soyeb.ieltspractice.ui.screens.sessionAttemptIds
import com.soyeb.ieltspractice.ui.screens.shell.HistoryItem
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Full mock exam (docs/mock-exam.md): the wire shape the server sends, and the copy and state logic (web lib/mock.ts). */
class MockTest {
    private val json = """
        {"id":"m1","variant":"academic","source":"cambridge","ref":"C19 T2","status":"in_progress","startedAt":"2026-10-01T09:00:00.000Z",
         "expiresAt":"2026-10-08T09:00:00.000Z","completedAt":null,"next":"reading","overall":null,"extra":1,
         "sections":[
           {"skill":"listening","state":"done","band":7.5,"attemptId":"l1","sessionId":null,"elapsedS":1800,"limitS":1800,"mode":null},
           {"skill":"reading","state":"in_progress","band":null,"attemptId":"r1","sessionId":null,"elapsedS":600,"limitS":3600,"mode":null},
           {"skill":"writing","state":"todo","band":null,"attemptId":null,"sessionId":null,"elapsedS":null,"limitS":3600,"mode":null},
           {"skill":"speaking","state":"todo","band":null,"attemptId":null,"sessionId":null,"elapsedS":null,"limitS":null,"mode":null}]}
    """.trimIndent()

    private fun mock(vararg states: Pair<String, Double?>, next: String? = "reading", status: String = "in_progress", overall: Double? = null) = Mock(
        "m1", status = status, next = next, overall = overall,
        sections = MockFlow.skills.zip(states.toList()).map { (k, s) -> MockSection(k, s.first, s.second) },
    )

    @Test fun decodesTheMockShape() {
        val m = AppJson.decodeFromString(Mock.serializer(), json)
        assertEquals("C19 T2", m.ref)
        assertEquals("reading", m.next)
        assertTrue(m.open)
        assertNull(m.overall)
        assertEquals(listOf("listening", "reading", "writing", "speaking"), m.sections.map { it.skill })
        assertEquals(7.5, m.section("listening")?.band)
        assertEquals(600.0, m.section("reading")?.elapsedS)
        assertEquals(false, m.marking)
    }

    @Test fun decodesTheCallAnswers() {
        assertNull(AppJson.decodeFromString(CurrentMock.serializer(), """{"mock":null}""").mock)
        assertEquals("m1", AppJson.decodeFromString(CurrentMock.serializer(), """{"mock":$json}""").mock?.id)
        assertEquals(1, AppJson.decodeFromString(MockList.serializer(), """{"items":[$json]}""").items.size)
        val o = AppJson.decodeFromString(MockOptions.serializer(), """{"cambridge":[{"ref":"C19 T2","bookTest":"C19 T2","started":true}],"own":true,"quota":{"writing":{},"speaking":{}}}""")
        assertTrue(o.own)
        assertEquals(true, o.cambridge.single().started)
        assertEquals("a1", AppJson.decodeFromString(MockSectionStarted.serializer(), """{"attemptId":"a1"}""").attemptId)
        val w = AppJson.decodeFromString(MockWritingStarted.serializer(), """{"prompts":[{"id":"p1","skill":"writing","part":1,"title":"t","body":"b"}],"writingSessionId":"s1","elapsedS":120}""")
        assertEquals(120.0, w.elapsedS)
        assertEquals("s1", w.writingSessionId)
        val c = AppJson.decodeFromString(MockSpeakingChosen.serializer(), """{"mode":"live","source":"cambridge","ref":null}""")
        assertEquals("live", c.mode)
        assertNull(c.test)
    }

    @Test fun transitionsNameWhatFinishedAndWhatIsNext() {
        assertEquals("Ready for Listening?", MockFlow.transition("listening")?.first)
        assertEquals("Listening finished.", MockFlow.transition("reading")?.first)
        assertEquals("Next: Reading, 60 minutes. Nothing is running. The clock starts when you press Start.", MockFlow.transition("reading")?.second)
        assertEquals("Next: Writing, 60 minutes for both tasks. Nothing is running. The clock starts when you press Start.", MockFlow.transition("writing")?.second)
        assertEquals("Writing finished. Choose how to do Speaking.", MockFlow.transition("speaking")?.first)
        assertNull(MockFlow.transition(null))
    }

    @Test fun rowStatesReadLikeTheWeb() {
        assertEquals("Not taken yet" to MockTone.Neutral, MockFlow.stateLabel("speaking", "todo"))
        assertEquals("Not started" to MockTone.Neutral, MockFlow.stateLabel("reading", "todo"))
        assertEquals("Being marked" to MockTone.Accent, MockFlow.stateLabel("writing", "marking"))
        assertEquals("Marking failed, retry" to MockTone.Bad, MockFlow.stateLabel("writing", "failed"))
        assertEquals("Skipped" to MockTone.Neutral, MockFlow.stateLabel("speaking", "skipped"))
        assertEquals("Marked" to MockTone.Good, MockFlow.stateLabel("listening", "done"))
        assertEquals(listOf(false, false, true, true, true, true), listOf("todo", "in_progress", "submitted", "marking", "done", "failed").map { MockFlow.isFinished(it) })
    }

    @Test fun rowMetaShowsTimeUsedOrTheSpeakingMode() {
        assertEquals("10 min used of 60", MockFlow.meta(MockSection("reading", "in_progress", elapsedS = 600.0, limitS = 3600.0)))
        assertEquals("5 min used", MockFlow.meta(MockSection("writing", "in_progress", elapsedS = 330.0)))
        assertNull(MockFlow.meta(MockSection("reading", "in_progress")))
        assertEquals("Live examiner", MockFlow.meta(MockSection("speaking", "marking", mode = "live")))
        assertEquals("Recorded test", MockFlow.meta(MockSection("speaking", "done", mode = "recorded")))
        assertNull(MockFlow.meta(MockSection("speaking", "skipped", mode = "recorded")))
    }

    @Test fun overallNoteExplainsAMissingBand() {
        val all = arrayOf("done" to 7.0, "done" to 7.0, "done" to 6.5, "done" to 6.0)
        assertEquals("Mean of your four section bands, to the nearest half band. Target 7.0.", MockFlow.overallNote(mock(*all, next = null, status = "completed", overall = 6.5), 7.0))
        assertEquals("This mock was finished without Speaking, so it has no overall band.", MockFlow.overallNote(mock(*all, next = null, status = "closed"), 7.0))
        val marking = mock("done" to 7.0, "done" to 7.0, "marking" to null, "todo" to null, next = "speaking")
        assertTrue(marking.marking)
        assertEquals("Overall appears when all four sections are marked. Marking takes about a minute.", MockFlow.overallNote(marking, 7.0))
        assertEquals("Overall appears when all four sections are marked.", MockFlow.overallNote(mock("done" to 7.0, "todo" to null, "todo" to null, "todo" to null), 7.0))
    }

    @Test fun entryCardSaysWhatIsNext() {
        assertEquals("Reading next. Pick up where you stopped.", MockFlow.continueLine(mock("done" to 7.0, "todo" to null, "todo" to null, "todo" to null)))
        assertEquals("Open. Pick up where you stopped.", MockFlow.continueLine(mock("done" to 7.0, "done" to 7.0, "done" to 7.0, "done" to 7.0, next = null)))
    }

    @Test fun aSessionOpensEveryAttemptInTheOrderTheyWereTaken() {
        fun h(id: String, session: String?, at: String) = HistoryItem(id, "t", "writing", 1, "done", 6.5, at, sessionId = session)
        val items = listOf(h("w2", "s1", "2026-10-02T10:30:00Z"), h("x", "other", "2026-10-02T10:20:00Z"), h("w1", "s1", "2026-10-02T10:00:00Z"))
        assertEquals(listOf("w1", "w2"), sessionAttemptIds(items, "s1", "w1"))
        assertEquals(listOf("w1"), sessionAttemptIds(items, "gone", "w1"))
        assertEquals(listOf("w1"), sessionAttemptIds(items, null, "w1"))
    }

    @Test fun aPendingMockRecordingKeepsItsMock() {
        val r = PendingRecording("r1", "p1", 1, "Part 1", 0L, 1000, emptyList(), emptyList(), sessionId = "s1", mockId = "m1")
        val back = AppJson.decodeFromString(PendingRecording.serializer(), AppJson.encodeToString(PendingRecording.serializer(), r))
        assertEquals("m1", back.mockId)
        assertNull(AppJson.decodeFromString(PendingRecording.serializer(), """{"id":"r","promptId":"p","part":1,"label":"l","createdAt":0,"durationMs":1,"energy":[],"marks":[]}""").mockId)
    }
}
