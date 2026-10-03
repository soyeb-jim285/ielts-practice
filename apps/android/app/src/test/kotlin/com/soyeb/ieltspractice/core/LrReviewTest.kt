package com.soyeb.ieltspractice.core

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Mirrors packages/core/src/lr-review.test.ts (locating evidence, word timings, dictation) plus the review fields of the shared fixtures. */
class LrReviewTest {
    private fun q(evidence: String? = null, answer: List<String>? = null, at: Double? = null) =
        LrQuestion(n = 1, answer = answer, review = if (evidence != null || at != null) LrReview(evidence = evidence, at = at) else null)

    private val paras = listOf(
        "The museum opened in 1895. It was designed by a local architect, who later moved abroad.",
        "Visitors can park behind the library on Fridays. Entry is free.",
    )

    @Test fun evidenceExactIgnoringCaseAndPunctuation() {
        val sp = evidenceSpan(paras, q("it was designed by a local architect"), false)!!
        assertEquals(0, sp.p)
        assertEquals("it was designed by a local architect", paras[0].substring(sp.s, sp.e).lowercase())
    }

    @Test fun evidenceFragmentsThenClosestSentence() {
        val f = evidenceSpan(paras, q("The museum opened in 1895 ... who later moved abroad"), false)!!
        assertTrue(paras[0].substring(f.s, f.e).contains("abroad"))
        val n = evidenceSpan(paras, q("Visitors are able to park behind the library on Friday. Entry is free."), false)!!
        assertEquals(1, n.p)
    }

    @Test fun gapUsesTheSentenceAroundTheAnswer() {
        val sp = evidenceSpan(paras, q(answer = listOf("(the) library")), true)!!
        assertEquals("Visitors can park behind the library on Fridays.", paras[1].substring(sp.s, sp.e))
        assertNull(answerSentence(paras, listOf("nowhere")))
    }

    @Test fun nonGapWithoutEvidenceHasNothing() = assertNull(evidenceSpan(paras, q(answer = listOf("B")), false))

    private val t = listOf(
        "The" to (0.0 to 0.2), "tour" to (0.3 to 0.6), "starts" to (0.7 to 1.0), "at" to (1.1 to 1.2), "half" to (1.3 to 1.5), "past" to (1.6 to 1.8),
        "six," to (1.9 to 2.3), "not" to (2.5 to 2.7), "seven." to (2.8 to 3.2), "Please" to (6.0 to 6.4), "bring" to (6.5 to 6.8), "a" to (6.9 to 7.0), "coat." to (7.1 to 7.6),
    ).map { Timing(it.first, it.second.first, it.second.second) }

    @Test fun locatePhrase() {
        assertEquals(Phrase(1.3, 2.3), locatePhrase(t, "half past six"))
        assertEquals(Phrase(2.8, 3.2), locatePhrase(t, "Seven"))
        val fuzzy = locatePhrase(t, "The tour starts at half-past six, not seven")!!
        assertEquals(0.0, fuzzy.start); assertEquals(3.2, fuzzy.end)
        assertNull(locatePhrase(t, "elephant")); assertNull(locatePhrase(null, "six")); assertNull(locatePhrase(emptyList(), "six"))
    }

    @Test fun audioWindow() {
        val a = audioWindow(t, q("Please bring a coat"))!!
        assertEquals(4.0, a.from, 1e-9); assertEquals(8.1, a.to, 1e-9); assertEquals(6.0, a.start, 1e-9); assertEquals(7.6, a.end, 1e-9); assertTrue(a.exact)
        val b = audioWindow(t, q(answer = listOf("coat")))!!
        assertTrue(b.exact); assertEquals(5.1, b.from, 1e-9)
        val c = audioWindow(null, q(at = 1.0))!!
        assertEquals(0.0, c.from); assertEquals(7.0, c.to); assertEquals(false, c.exact)
        assertNull(audioWindow(null, q(answer = listOf("x"))))
    }

    @Test fun questionMomentsOrderedAndApprox() {
        fun qq(n: Int, a: String, at: Double? = null) = LrQuestion(n, answer = listOf(a), review = at?.let { LrReview(at = it) })
        val g = LrGroup(from = 1, to = 4, type = "gap", instructions = "", questions = listOf(qq(2, "coat"), qq(3, "x", 20.0), qq(4, "y")))
        val m = questionMoments(t, listOf(g))
        assertEquals(listOf(2, 3), m.map { it.n })
        assertEquals(7.1, m[0].at, 1e-9); assertTrue(m[0].exact)
        assertEquals(20.0, m[1].at, 1e-9); assertEquals(false, m[1].exact)
    }

    @Test fun locateNumbersSpokenAsWords() {
        fun sp(w: String) = w.split(' ').mapIndexed { i, x -> Timing(x, i.toDouble(), i + 0.9) }
        assertEquals(3.0, locatePhrase(sp("we finish at eleven thirty sharp"), "11.30")!!.start, 1e-9)
        assertEquals(2.0, locatePhrase(sp("it costs thirty five pounds an hour"), "£35")!!.start, 1e-9)
        assertEquals(2.0, locatePhrase(sp("on the fifteenth of june"), "15th")!!.start, 1e-9)
        assertEquals(1.0, locatePhrase(sp("about five hundred people"), "500")!!.start, 1e-9)
        assertEquals(8.9, locatePhrase(sp("it is R H one two three T L thanks"), "RH12 3TL")!!.end, 1e-9)
        assertTrue(audioWindow(sp("it costs thirty five pounds"), q(answer = listOf("35")))!!.exact)
    }

    @Test fun clusterMomentsFoldsCloseMarkers() {
        val g = clusterMoments(listOf(100.0, 102.0, 104.0, 200.0), 400.0) { it }
        assertEquals(listOf(listOf(100.0, 102.0, 104.0), listOf(200.0)), g)
    }

    @Test fun dictationPerfect() = assertTrue(dictationDiff("half past six", "Half past six.").all { it.status == DictStatus.Correct })

    @Test fun dictationWrongMissingExtra() {
        val ops = dictationDiff("the tour start at six now", "The tour starts at half past six")
        assertEquals(listOf("The:Correct", "tour:Correct", "starts:Wrong", "at:Correct", "half:Missing", "past:Missing", "six:Correct", ":Extra"), ops.map { "${it.word}:${it.status}" })
        assertEquals(4 to 7, dictationScore(ops))
        assertEquals(listOf(DictStatus.Missing, DictStatus.Missing), dictationDiff("", "a b").map { it.status })
    }

    @Test fun expandAnswerAndTfng() {
        assertEquals(listOf("the old town hall", "the old hall", "old town hall", "old hall"), expandAnswer("(the) old (town) hall"))
        assertEquals("NOT GIVEN", tfngValue("ng")); assertEquals("YES", tfngValue("Yes")); assertEquals("", tfngValue("B"))
    }

    @Test fun fixturesCarryReviewData() {
        val fx = DemoFixtures.parse(File("../../ios/IELTS/Demo/fixtures.json").readText())
        val l = AppJson.decodeFromString(LrAttempt.serializer(), fx.getValue("/api/lr/attempts/lra-ls"))
        val sec = l.test.sections[2]
        assertTrue(sec.timingRows.isNotEmpty())
        val q28 = l.test.flat().first { it.n == 28 }.q
        val win = audioWindow(sec.timingRows, q28)!!
        assertTrue(win.exact)
        assertEquals("record the weight of each hive every week", fold(wordsBetween(sec.timingRows, win.start, win.end)))
        assertNotNull(l.analysis); assertNotNull(l.stats)
        assertEquals("spelling", l.analysis!!.gaps.first { it.n == 28 }.kind)
        val r = AppJson.decodeFromString(LrAttempt.serializer(), fx.getValue("/api/lr/attempts/lra-rs"))
        val p1 = r.test.sections[0]
        val q9 = r.test.flat().first { it.n == 9 }
        val span = evidenceSpan(sectionParagraphs(p1), q9.q, true)!!
        assertTrue(sectionParagraphs(p1)[span.p].substring(span.s, span.e).contains("sediment"))
        assertEquals("sediment", r.analysis!!.gaps.first { it.n == 9 }.word)
        val tf = r.test.flat().first { it.n == 4 }
        assertNotNull(wrongNote(tf.q, "TRUE"))
        assertTrue(AppJson.decodeFromString(LrProgress.serializer(), fx.getValue("/api/lr/progress")).trend.isNotEmpty())
        assertTrue(AppJson.decodeFromString(LrSpelling.serializer(), fx.getValue("/api/lr/spelling")).items.isNotEmpty())
    }
}
