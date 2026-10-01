package com.soyeb.ieltspractice.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Port of iOS TimelineTests / web lib/timeline.test.ts: markers by category prefix, question segments, long pauses, wpmAt, wordIndexAt. */
class TimelineTest {
    private fun result(errors: String = "[]", questions: String = "[]", unclear: String = "[]", events: String = "[]", pauses: String = "[]"): AnalysisResult {
        val words = (0 until 8).joinToString(",") { """{"w":"w$it","start":${it * 2.0},"end":${it * 2.0 + 1.5}}""" }
        val json = """
        {"skill":"speaking","overall":6,"overallRaw":6,"range":[5,7],"criteria":{},"topFixes":[],"errors":$errors,
         "rewrite":{"text":"","note":""},"words":[$words],"questions":$questions,
         "metrics":{"durationS":16,"wordCount":8,"speechRate":100,"articulationRate":120,"phonationRatio":0.8,"pauseRatio":0.2,"mlr":5,
           "pauses":$pauses,"longPauses":0,"midClausePauses":0,"fillers":[],"fillersPerMin":0,"repetitions":[],"selfCorrections":[],
           "unclear":$unclear,"wpmSeries":[{"t":0,"wpm":100},{"t":5,"wpm":140}],"wpmStdDev":10,
           "fluency":{"events":$events}}}
        """
        return AppJson.decodeFromString(AnalysisResult.serializer(), json)
    }

    private fun err(id: String, cat: String, start: Int = 1, time: String = "null") =
        """{"id":"$id","category":"$cat","severity":"minor","start":$start,"end":${start + 1},"original":"a","correction":"b","explanation":"x","time":$time}"""

    @Test fun categoryPrefixMapping() {
        assertEquals(MarkerType.Grammar, MarkerType.of("grammar.article"))
        assertEquals(MarkerType.Vocabulary, MarkerType.of("lexis.collocation"))
        assertEquals(MarkerType.Vocabulary, MarkerType.of("vocabulary.collocation"))
        assertEquals(MarkerType.Pronunciation, MarkerType.of("pronunciation.stress"))
        assertEquals(MarkerType.Fluency, MarkerType.of("fluency.filler"))
        assertNull(MarkerType.of("task.relevance"))
        assertNull(MarkerType.of("cohesion.linker"))
    }

    @Test fun markersFromErrorsEventsAndUnclear() {
        val r = result(
            errors = "[${err("e1", "grammar.tense", start = 3)},${err("e2", "task.relevance")},${err("e3", "lexis.word", start = 1, time = "9.5")}]",
            unclear = """[{"wordIdx":0,"w":"w0","conf":0.4,"tier":2}]""",
            events = """[{"kind":"filled","start":4.2,"end":4.6,"sources":["stt"]}]""",
        )
        val tl = Timeline.of(r)
        assertEquals(listOf("u0", "d0", "e1", "e3"), tl.markers.map { it.id }) // sorted by time; the task note has no marker
        assertEquals(listOf(MarkerType.Pronunciation, MarkerType.Fluency, MarkerType.Grammar, MarkerType.Vocabulary), tl.markers.map { it.type })
        assertEquals(6.0, tl.markers[2].t) // no time: the start word's start
        assertEquals(9.5, tl.markers[3].t) // explicit time wins
        assertEquals("a → b", tl.markers[2].label)
        assertEquals("filler", tl.markers[1].label)
        assertEquals(1, tl.count(MarkerType.Grammar))
    }

    @Test fun questionSegmentsAndLongPauses() {
        val pauses = """[{"start":1.5,"end":2.4,"dur":0.9,"kind":"between","midClause":false,"voiced":false},{"start":3.5,"end":4.8,"dur":1.3,"kind":"between","midClause":false,"voiced":false}]"""
        val tl = Timeline.of(result(questions = """[{"text":"Q one","startWord":0},{"text":"Q two","startWord":4}]""", pauses = pauses))
        assertEquals(listOf(QuestionSegment(0, 0.0, 8.0, "Q one"), QuestionSegment(1, 8.0, 16.0, "Q two")), tl.questions)
        assertEquals(listOf(TimelinePause(3.5, 4.8)), tl.pauses) // 0.9 s is not long
        assertEquals(16.0, tl.durationS)
    }

    @Test fun wpmAtInterpolatesAlongTheLine() {
        val s = listOf(WpmPoint(0.0, 100.0), WpmPoint(10.0, 140.0)) // plotted at 5 and 15
        assertEquals(100.0, wpmAt(s, 0.0))
        assertEquals(120.0, wpmAt(s, 10.0), 1e-9)
        assertEquals(140.0, wpmAt(s, 99.0))
        assertEquals(0.0, wpmAt(emptyList(), 3.0))
    }

    @Test fun wordIndexAt() {
        val w = listOf(Word("a", 1.0, 2.0), Word("b", 3.0, 4.0))
        assertEquals(-1, wordIndexAt(w, 0.5))
        assertEquals(0, wordIndexAt(w, 1.0))
        assertEquals(0, wordIndexAt(w, 2.9))
        assertEquals(1, wordIndexAt(w, 3.0))
        assertEquals(1, wordIndexAt(w, 99.0))
    }

    @Test fun longPauseIsOneSecondRoundedToATenth() {
        fun p(d: Double) = Pause(0.0, d, d, "between", false, false)
        assertEquals(false, isLongPause(p(0.94)))
        assertEquals(true, isLongPause(p(0.96)))
        assertEquals("1.3", pauseSec(p(1.26)))
    }
}
