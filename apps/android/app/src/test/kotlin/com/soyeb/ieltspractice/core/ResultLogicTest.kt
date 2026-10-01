package com.soyeb.ieltspractice.core

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The pure helpers behind the result screens, and the demo fixtures run through them. */
class ResultLogicTest {
    private val fixtures = DemoFixtures.parse(File("../../ios/IELTS/Demo/fixtures.json").readText())
    private fun attempt(id: String) = AppJson.decodeFromString(Attempt.serializer(), fixtures.getValue("/api/attempts/$id"))

    @Test fun wordDiffMergesRunsAndPutsRemovedFirst() {
        val d = wordDiff("The data has risen  sharply", "The data have risen sharply since 2000")
        assertEquals(listOf(DiffOp.Same, DiffOp.Removed, DiffOp.Added, DiffOp.Same, DiffOp.Added), d.map { it.op })
        assertEquals(listOf("The data", "has", "have", "risen sharply", "since 2000"), d.map { it.text })
    }

    @Test fun wordDiffEdgeCases() {
        assertTrue(wordDiff("", "").isEmpty())
        assertEquals(listOf(DiffOp.Added), wordDiff("", "new words").map { it.op })
        assertEquals(listOf(DiffOp.Removed), wordDiff("old words", "").map { it.op })
        assertEquals(listOf(DiffOp.Same), wordDiff("same\ntext", "same text").map { it.op })
    }

    @Test fun formatting() {
        assertEquals("51s", formatDuration(51_000))
        assertEquals("4m 12s", formatDuration(252_000))
        assertEquals("1h 5m", formatDuration(3_900_000))
        assertEquals("30 Sep 2026", formatDate("2026-09-30T12:00:00.000Z")) // noon UTC is the same day in every zone but UTC+12 and up
        assertEquals("", formatDate("not a date"))
        assertEquals("6–7", bandRange(6.0, 7.0))
        assertEquals("6.5", bandRange(6.5, 6.5))
        assertEquals("one two…", clipWords("one two three four", 9))
        assertEquals("short", clipWords("short", 9))
    }

    @Test fun sentenceCaseOnlyTouchesAllCapsTitles() {
        assertEquals("Describe a place you like", sentenceCase("DESCRIBE A PLACE YOU LIKE"))
        assertEquals("IELTS tips", sentenceCase("IELTS tips"))
        assertEquals("A", sentenceCase("A"))
    }

    @Test fun questionHeadDropsTheRepeatedFirstLine() {
        assertEquals("Describe a book" to "You should say: why", questionHead("Describe a book\nDescribe a book\nYou should say:\nwhy"))
        assertEquals("What is your hometown?" to "", questionHead("What is your hometown?"))
    }

    @Test fun mtldAndRepeatedWords() {
        assertEquals(0.0, mtld(emptyList()))
        val tokens = tokenize("It's a good idea, and the idea is good; good ideas need good people and good plans")
        assertTrue("it's" in tokens && "good" in tokens)
        val reps = repeatedWords(tokens)
        assertEquals("good", reps.first().word)
        assertEquals(5, reps.first().count)
        assertTrue(mtld(tokens) > 0)
        // All-unique text never lowers the type-token ratio below the threshold: MTLD is the token count.
        assertEquals(5.0, mtld(listOf("a", "b", "c", "d", "e")))
    }

    @Test fun offTopicWritingIsCappedOneBandAboveTaskResponse() {
        val r = attempt("aw1").analysis!!
        val plain = resScore(r)
        assertEquals(r.overall, plain.overall)
        val major = r.copy(
            criteria = r.criteria + ("ta" to r.criteria.getValue("ta").copy(band = 4.0)),
            errors = r.errors + AnalysisError("x", "task.relevance", "major", 0, 1, "a", "b", "off topic"),
        )
        val capped = resScore(major)
        assertTrue(capped.offTopic)
        assertTrue(capped.overall <= 5.0)
    }

    @Test fun noSpeechFixtureIsNotAssessed() {
        assertTrue(notAssessed(attempt("as5").analysis!!))
        assertTrue(!notAssessed(attempt("as1").analysis!!))
    }

    @Test fun pronunciationIsSoftWhenFarAboveFluency() {
        val r = attempt("as1").analysis!!
        val hot = r.copy(criteria = r.criteria + ("p" to r.criteria.getValue("p").copy(band = 9.0)) + ("fc" to r.criteria.getValue("fc").copy(band = 5.0)))
        assertTrue(pronUnsupported(hot, "p"))
        assertTrue(!pronUnsupported(hot, "fc"))
    }

    @Test fun fluencyStatsAgainstBand7() {
        val m = attempt("as1").analysis!!.metrics!!
        val stats = fluStats(m)
        assertEquals(10, stats.size)
        if (!fluTooShort(m)) assertTrue(stats.none { it.tone == FluTone.Na })
        val short = fluStats(m.copy(wordCount = 10))
        assertTrue(short.all { it.tone == FluTone.Na && it.value == "—" })
        assertEquals(FluTone.Good, fluUpTo(1.0, 1.0, 2.0))
        assertEquals(FluTone.Warn, fluUpTo(1.5, 1.0, 2.0))
        assertEquals(FluTone.Bad, fluAtLeast(1.0, 8.0, 5.0))
        assertEquals(2.0, perMinute(1, 30.0)) // 30 s of speech: 1 event is 2 a minute
        assertEquals(4.0, perMinute(1, 5.0)) // floored at 15 s
    }

    @Test fun sessionOverallWeighsPartsByTimeAndNeedsAScoredPart() {
        val a = attempt("as1")
        val b = attempt("as2")
        val o = speakingSessionOverall(listOf(a, b))
        assertNotNull(o)
        assertEquals(2, o.second)
        assertNull(speakingSessionOverall(listOf(attempt("as5"), attempt("as3"))))
        assertNull(writingSessionOverall(listOf(attempt("aw1")))) // needs Task 1 and Task 2
    }

    @Test fun answeredRelevanceSkipsQuestionsWithNoSpeech() {
        val r = attempt("as1").analysis!!
        assertTrue(answeredRelevance(r).size <= r.relevance.orEmpty().size)
        assertTrue(wasAnswered(r, 99)) // unknown boundaries count as answered
    }
}
