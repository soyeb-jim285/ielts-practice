package com.soyeb.ieltspractice.core

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/** Listening & Reading: wire models against the shared demo fixtures, and the pure logic ported from the web (lib/lr.ts). */
class LrLogicTest {
    private val fixtures = DemoFixtures.parse(File("../../ios/IELTS/Demo/fixtures.json").readText())

    @Test fun fixturesDecode() {
        val attempts = fixtures.keys.filter { Regex("^/api/lr/attempts/[a-z-]+$").matches(it) }.map { AppJson.decodeFromString(LrAttempt.serializer(), fixtures.getValue(it)) }
        assertTrue(attempts.size >= 5, "expected the lr attempt fixtures")
        attempts.forEach { assertEquals(40, it.test.flat().size, it.id) }
        val done = attempts.first { it.id == "lra-rs" }
        assertTrue(done.submitted)
        assertEquals(40, done.marks!!.size)
        assertEquals(done.raw, done.marks!!.count { it.correct })
        assertNotNull(done.test.sections.first().passage)
        // an in-progress attempt carries no answers or transcript
        val open = attempts.first { it.id == "lra-r" }
        assertTrue(open.test.flat().all { it.q.answer == null })
        for (skill in listOf("reading", "listening")) {
            val items = AppJson.decodeList<LrTestItem>(fixtures.getValue("/api/lr/tests?skill=$skill"))
            assertTrue(items.any { it.status == "in_progress" && it.attemptId != null })
        }
        assertTrue(AppJson.decodeList<LrAttemptItem>(fixtures.getValue("/api/lr/attempts")).isNotEmpty())
    }

    @Test fun contentParsesGapsTablesAndLists() {
        val blocks = parseContent("Intro with {{1}} and **bold**.\n\n| Day | Time |\n|---|---|\n| Mon | {{2}} |\n\n- first {{3}}\n- second")
        assertEquals(3, blocks.size)
        assertEquals(listOf(Inline.Text("Intro with "), Inline.Gap(1), Inline.Text(" and "), Inline.Bold("bold"), Inline.Text(".")), (blocks[0] as Block.P).inline)
        val t = blocks[1] as Block.Table
        assertEquals(2, t.head.size)
        assertEquals(1, t.rows.size)
        assertEquals(Inline.Gap(2), t.rows[0][1].single())
        val l = blocks[2] as Block.Items
        assertEquals(false, l.ordered)
        assertEquals(2, l.items.size)
    }

    @Test fun multiBlankQuestionGetsOneSlotPerBlank() {
        assertEquals("from {{7:0:2}} to {{7:1:2}}, {{8}}", numberGapParts("from {{7}} to {{7}}, {{8}}"))
        assertEquals(
            listOf(Inline.Text("from "), Inline.Gap(7, 0, 2), Inline.Text(" to "), Inline.Gap(7, 1, 2)),
            (parseContent("from {{7}} to {{7}}")[0] as Block.P).inline,
        )
        var v = setGapPart("", 1, 2, "4.30")
        assertEquals(" / 4.30", v)
        v = setGapPart(v, 0, 2, "10 ")
        assertEquals(listOf("10 ", "4.30"), listOf(gapPart(v, 0), gapPart(v, 1)))
        assertEquals("", setGapPart(" / x", 1, 2, ""))
    }

    @Test fun hubGroupsByBookNewestFirst() {
        fun t(ref: String, source: String = "cambridge") = LrTestItem(id = ref, skill = "reading", ref = ref, title = ref, source = source)
        val g = lrHubGroups(listOf(t("C16 T2"), t("Own 1", "generated"), t("C17 T3"), t("C17 T1"), t("C16 T1")))
        assertEquals(listOf("Cambridge IELTS 17", "Cambridge IELTS 16", "Original practice tests"), g.map { it.heading })
        assertEquals(listOf("C17 T1", "C17 T3"), g[0].tests.map { it.ref })
        assertEquals(17 to 2, parseRef("C17 T2"))
    }

    @Test fun chooseNPicksLiveInSlots() {
        val g = LrGroup(from = 11, to = 12, type = "mcq-multi", questions = listOf(LrQuestion(11), LrQuestion(12)))
        var r = setMultiPicks(g, emptyMap(), listOf("B"))
        assertEquals(listOf("B"), multiPicks(g, r))
        r = setMultiPicks(g, r, listOf("B", "D"))
        assertEquals(mapOf("11" to "B", "12" to "D"), r)
        r = setMultiPicks(g, r, listOf("D")) // untick the first: the slots shift, the spare one empties
        assertEquals(mapOf("11" to "D"), r)
        assertEquals(mapOf("1" to "x"), emptyMap<String, String>().withAnswer(1, "x"))
        assertEquals(emptyMap(), mapOf("1" to "x").withAnswer(1, "  "))
    }

    @Test fun accuracyPerPartAndType() {
        val a = AppJson.decodeFromString(LrAttempt.serializer(), fixtures.getValue("/api/lr/attempts/lra-rs"))
        val rows = accuracyBy(a.test, a.marks!!) { "Passage ${it.part}" }
        assertEquals(40, rows.sumOf { it.total })
        assertEquals(a.raw, rows.sumOf { it.right })
        assertEquals("Matching headings", typeLabel(LrGroup(1, 2, "match", options = listOf(LrOption("i"), LrOption("ii")))))
        assertEquals("Table completion", typeLabel(LrGroup(1, 2, "gap", instructions = "Complete the table below.")))
    }

    @Test fun audioResumePosition() {
        assertEquals(205.5, LrAudioState.resumePosition(205.5, 600.0))
        assertEquals(0.0, LrAudioState.resumePosition(598.0, 600.0))
        assertEquals(0.0, LrAudioState.resumePosition(0.5, 600.0))
        assertEquals(0.0, LrAudioState.resumePosition(50.0, Double.NaN))
    }

    @Test fun audioCleanedAndPick() {
        val c = LrAudioState(mapOf("1" to 12.34, "2" to Double.NaN, "3" to -4.0, "4" to 9999.0, "x" to 1.0), 2.0).cleaned()
        assertEquals(mapOf("1" to 12.3, "3" to 0.0, "4" to 3600.0), c.pos)
        assertEquals(null, c.rate)
        val server = LrAudioState(mapOf("1" to 30.0), 0.75)
        assertEquals(server, LrAudioState.pick(null, server))
        val local = LrAudioState(mapOf("1" to 40.0, "3" to 7.0), 1.0)
        assertEquals(local, LrAudioState.pick(local.encode(), LrAudioState(mapOf("1" to 30.0))))
        assertEquals(null, LrAudioState.pick(null, null))
        assertEquals(server, LrAudioState.pick("not json", server))
    }
}
