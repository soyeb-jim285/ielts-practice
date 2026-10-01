package com.soyeb.ieltspractice.ui.screens.writing

import com.soyeb.ieltspractice.core.AppJson
import com.soyeb.ieltspractice.core.ChartSpec
import com.soyeb.ieltspractice.core.DemoFixtures
import com.soyeb.ieltspractice.core.Prompt
import java.io.File
import java.time.ZoneId
import java.util.Locale
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Plain JVM tests of the writing rules (word count, clock, warnings, submit floor, paste, drafts) and the chart maths. */
class WritingLogicTest {
    private fun prompt(part: Int, variant: String? = null) = Prompt(id = "p$part", skill = "writing", part = part, variant = variant, title = "t", body = "b")

    @Test fun wordCountMatchesCore() {
        assertEquals(3, wordCount("75% in 2017")) // numbers count
        assertEquals(8, wordCount("It cost \$20 - a rise of 5.5 points.")) // a lone dash does not
        assertEquals(0, wordCount("  \n - ... "))
        assertEquals(4, wordCount("one\ntwo\tthree   four"))
    }

    @Test fun minimumsAndClock() {
        assertEquals(150, minWords(1)); assertEquals(250, minWords(2))
        assertEquals(3600, examSeconds(listOf(prompt(1), prompt(2))))
        assertEquals(1200, examSeconds(listOf(prompt(1)))); assertEquals(2400, examSeconds(listOf(prompt(2))))
        assertEquals("Task 1 Academic", taskLabel(prompt(1, "academic"))); assertEquals("Task 1 General", taskLabel(prompt(1, "general")))
        assertEquals("Task 2", taskLabel(prompt(2)))
        // a wall-clock deadline: 10 s in, 1190 s left; a part-second rounds up; negative once overtime
        assertEquals(1190, secondsLeft(1200, 1_000, 11_000)); assertEquals(1191, secondsLeft(1200, 1_000, 10_001))
        assertEquals(0, secondsLeft(1200, 0, 1_200_000)); assertEquals(-5, secondsLeft(1200, 0, 1_205_000))
    }

    @Test fun warningsFireOnceAsTheClockPassesThem() {
        assertNull(timeEvent(400, 399))
        assertEquals(TimeEvent.Warn5, timeEvent(301, 300)); assertNull(timeEvent(300, 299))
        assertEquals(TimeEvent.Warn1, timeEvent(61, 60)); assertNull(timeEvent(60, 59))
        assertEquals(TimeEvent.TimeUp, timeEvent(1, 0)); assertNull(timeEvent(0, -1))
        assertEquals(TimeEvent.Warn5, timeEvent(500, 200)) // a jump past 5 minutes still warns
        assertEquals(TimeEvent.TimeUp, timeEvent(30, -5))
        assertEquals(Tone.Neutral, timerTone(301)); assertEquals(Tone.Warn, timerTone(300)); assertEquals(Tone.Warn, timerTone(61))
        assertEquals(Tone.Bad, timerTone(60)); assertEquals(Tone.Bad, timerTone(-1))
    }

    @Test fun wordBarStates() {
        assertEquals(WordBar(BarTint.Muted, "Minimum 250 words", 0f), wordBar(0, 250))
        assertEquals(BarTint.Muted, wordBar(224, 250).tint); assertEquals(BarTint.Warn, wordBar(225, 250).tint) // 90%
        assertEquals("30 more to reach 250", wordBar(220, 250).hint)
        assertEquals(WordBar(BarTint.Good, "250-word minimum reached", 1f), wordBar(300, 250))
    }

    @Test fun submitConfirmation() {
        val ok = listOf(TaskCount(2, 260))
        assertNull(submitNote(ok, 100)); assertFalse(tooShort(ok)); assertNull(underMinimum(ok))
        assertEquals("Write at least a paragraph before submitting.", submitNote(listOf(TaskCount(2, SUBMIT_FLOOR - 1)), 100))
        assertFalse(tooShort(listOf(TaskCount(2, SUBMIT_FLOOR))))
        assertEquals("Write at least a paragraph for each task before submitting.", submitNote(listOf(TaskCount(1, 160), TaskCount(2, 5)), 100))
        assertEquals("Under 250 words costs Task Response marks. You have 2:05 left to add more.", submitNote(listOf(TaskCount(2, 100)), 125))
        assertEquals("Under 150 words costs Task Achievement marks.", submitNote(listOf(TaskCount(1, 100), TaskCount(2, 300)), 0))
        assertEquals(1, underMinimum(listOf(TaskCount(1, 100), TaskCount(2, 100)))?.part)
    }

    @Test fun pasteIsAnEditThatInsertsALot() {
        assertEquals(1, insertedLength("hello", "hellos")); assertEquals(0, insertedLength("hello", "hello"))
        assertEquals(0, insertedLength("hello world", "hell world")) // a deletion inserts nothing
        assertEquals(8, insertedLength("a b", "a 1234567 b")) // "1234567 "
        val clip = "x".repeat(PASTE_CHARS)
        assertTrue(looksPasted("start end", "start $clip end"))
        assertTrue(looksPasted("", clip))
        assertFalse(looksPasted("start end", "start ${"x".repeat(PASTE_CHARS - 3)} end")) // a long word
        assertFalse(looksPasted("a long essay so far.", "a long essay so far. Then")) // typing and word suggestions are small
        assertTrue(looksPasted("a".repeat(100), "b".repeat(100))) // replacing a selection with pasted text
    }

    @Test fun draftsRoundTripAndReadOlderPlainText() {
        assertEquals(Draft("essay", "plan"), decodeDraft(encodeDraft(Draft("essay", "plan"))))
        assertEquals(Draft(), decodeDraft(null))
        assertEquals(Draft(text = "just the essay"), decodeDraft("just the essay")) // a plain-text draft is the essay
        assertEquals(Draft(text = "e"), decodeDraft("""{"text":"e"}"""))
        assertEquals("""{"text":"a\nb","plan":""}""", encodeDraft(Draft("a\nb")))
    }

    @Test fun sessionSurvivesSaving() {
        val chart = AppJson.parseToJsonElement("""{"kind":"table","title":"T","columns":["a"],"rows":[["x"]]}""")
        val s = ExamSession(listOf(prompt(1, "academic").copy(chart = chart)), 123L, "sid", "parent")
        val back = AppJson.decodeFromString(ExamSession.serializer(), AppJson.encodeToString(ExamSession.serializer(), s))
        assertEquals(s, back)
        assertEquals("table", back.prompts[0].chartSpec?.kind)
    }

    @Test fun dateAndTitleHelpers() {
        assertEquals("28 Sep", shortDate("2026-09-28T09:30:00.000Z", ZoneId.of("UTC"), Locale.US))
        assertEquals("2026-09-28", shortDate("2026-09-28", ZoneId.of("UTC"), Locale.US)) // not an instant: show the date part
        val p = prompt(1).copy(title = "The graph below shows the percentage…", body = "The graph below shows the percentage of electricity.")
        assertFalse(showPromptTitle(p, null)) // seeded title = the body's first words
        assertFalse(showPromptTitle(p.copy(title = "Renewables", body = "x"), "Renewables")) // the figure repeats it
        assertTrue(showPromptTitle(p.copy(title = "Renewables", body = "x"), "Other"))
    }

    @Test fun niceTicksMatchWeb() {
        assertEquals(listOf(0.0, 20.0, 40.0, 60.0, 80.0, 100.0), niceTicks(0.0, 87.0))
        assertEquals(listOf(0.0, 1.0, 2.0, 3.0, 4.0, 5.0), niceTicks(0.0, 4.3))
        assertEquals(listOf(0.0, 250.0, 500.0, 750.0, 1000.0, 1250.0), niceTicks(0.0, 1200.0))
        assertEquals(listOf(-20.0, -10.0, 0.0, 10.0, 20.0, 30.0), niceTicks(-12.0, 30.0))
        assertEquals(listOf(0.0, 0.2, 0.4, 0.6, 0.8, 1.0), niceTicks(0.0, 0.0))
    }

    @Test fun chartLabelsAndSummary() {
        val line = ChartSpec(kind = "line", yLabel = "Share", unit = "%", categories = listOf("2000", "2005"), series = listOf(com.soyeb.ieltspractice.core.Series("DK", listOf(15.0, 22.5))))
        assertEquals("Share (%)", yAxisTitle(line)); assertEquals("%", yAxisTitle(line.copy(yLabel = "%")))
        assertEquals("%", yAxisTitle(line.copy(yLabel = ""))); assertEquals("Share", yAxisTitle(line.copy(unit = "")))
        assertEquals("line chart. DK: 2000 15, 2005 22.5 (%)", describe(line))
    }

    @Test fun everyWritingFixtureDrawsFromAKnownChartKind() {
        val fixtures = DemoFixtures.parse(File("../../ios/IELTS/Demo/fixtures.json").readText())
        val prompts = fixtures.filterKeys { it != "/api/prompts/meta" && Regex("^/api/prompts/[a-z0-9]+$").matches(it) }.values.map { AppJson.decodeFromString(Prompt.serializer(), it) }.filter { it.skill == "writing" }
        assertTrue(prompts.size >= 8, "expected the writing prompt fixtures, found ${prompts.map { it.id }}")
        val kinds = prompts.mapNotNull { it.chartSpec?.kind }.toSet()
        assertEquals(setOf("line", "bar", "pie", "table", "process", "map"), kinds)
        prompts.filter { it.part == 1 && it.variant == "academic" }.forEach { assertNotNull(it.chartSpec, "${it.id} should decode a chart") }
    }
}
