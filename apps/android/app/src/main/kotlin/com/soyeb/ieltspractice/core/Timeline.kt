package com.soyeb.ieltspractice.core

import kotlin.math.roundToInt

// One timeline for a speaking result: where (seconds) and what (type) went wrong, shared by the pace chart, the audio bar and the
// transcript. Port of iOS Core/Timeline.swift and apps/web/src/lib/timeline.ts. Pure Kotlin (no Compose): colours and shapes live in
// ui/screens/result/Markers.kt.

enum class MarkerType(val label: String) {
    Grammar("Grammar"), Vocabulary("Vocabulary"), Pronunciation("Pronunciation"), Fluency("Fluency");

    companion object {
        /** Error category prefix to type: grammar.*, vocabulary.* or lexis.*, pronunciation.*, fluency.*; task and cohesion have none. */
        fun of(category: String): MarkerType? = when (category.substringBefore('.')) {
            "grammar" -> Grammar
            "lexis", "vocabulary" -> Vocabulary
            "pronunciation" -> Pronunciation
            "fluency" -> Fluency
            else -> null
        }
    }
}

data class TimelineMarker(val id: String, val t: Double, val end: Double?, val type: MarkerType, val label: String, val errorId: String?)
data class QuestionSegment(val idx: Int, val start: Double, val end: Double, val text: String)
data class TimelinePause(val start: Double, val end: Double)

data class Timeline(
    val markers: List<TimelineMarker> = emptyList(),
    val questions: List<QuestionSegment> = emptyList(),
    val pauses: List<TimelinePause> = emptyList(),
    val durationS: Double = 0.0,
) {
    fun count(t: MarkerType): Int = markers.count { it.type == t }

    companion object {
        val Empty = Timeline()

        /** Short names of fused disfluency kinds (web DISFLUENCY[kind].short). */
        val disfluencyShort = mapOf(
            "filled" to "filler", "repetition" to "repeat", "repair" to "repair",
            "false_start" to "false start", "partial" to "cut-off", "prolongation" to "held sound",
        )

        /** Mistake markers (errors with a time, disfluency events, unclear words), question segments and long pauses (1 s or more). */
        fun of(r: AnalysisResult): Timeline {
            val words = r.words.orEmpty()
            val m = r.metrics
            val durationS = m?.durationS ?: words.lastOrNull()?.end ?: 0.0
            val markers = mutableListOf<TimelineMarker>()
            for (e in r.errors) {
                val type = MarkerType.of(e.category) ?: continue
                val w = words.getOrNull(e.start)
                val t = e.time ?: w?.start ?: continue
                val endWord = words.getOrNull(e.end)?.end
                markers += TimelineMarker(e.id, t, endWord, type, if (e.original.isEmpty()) e.explanation else "${e.original} → ${e.correction}", e.id)
            }
            if (m != null) {
                m.fluency?.events.orEmpty().forEachIndexed { i, d ->
                    markers += TimelineMarker("d$i", d.start, d.end, MarkerType.Fluency, disfluencyShort[d.kind] ?: d.kind, null)
                }
                for (u in m.unclear) {
                    val w = words.getOrNull(u.wordIdx) ?: continue
                    markers += TimelineMarker("u${u.wordIdx}", w.start, w.end, MarkerType.Pronunciation, "Unclear: “${u.w}”", null)
                }
            }
            val sorted = markers.sortedBy { it.t }

            val starts = r.questions.orEmpty().mapIndexedNotNull { i, q ->
                if (q.startWord in words.indices) Triple(i, words[q.startWord].start, q.text) else null
            }
            val questions = starts.mapIndexed { i, s ->
                QuestionSegment(s.first, s.second, starts.getOrNull(i + 1)?.second ?: durationS, s.third)
            }
            val pauses = m?.pauses.orEmpty().filter(::isLongPause).map { TimelinePause(it.start, it.end) }
            return Timeline(sorted, questions, pauses, durationS)
        }
    }
}

/** Pace at time t, interpolated along the chart line (windows are plotted at their midpoint). */
fun wpmAt(series: List<WpmPoint>, t: Double, windowS: Double = 10.0): Double {
    if (series.isEmpty()) return 0.0
    val xs = series.map { it.t + windowS / 2 }
    val i = xs.indexOfFirst { it >= t }
    if (i < 0) return series.last().wpm
    if (i == 0) return series.first().wpm
    val span = xs[i] - xs[i - 1]
    return series[i - 1].wpm + (series[i].wpm - series[i - 1].wpm) * (t - xs[i - 1]) / (if (span == 0.0) 1.0 else span)
}

/** Index of the word playing at time t (the last word that started), or -1 before the first. */
fun wordIndexAt(words: List<Word>, t: Double): Int {
    var lo = 0
    var hi = words.size
    while (lo < hi) {
        val mid = (lo + hi) / 2
        if (words[mid].start <= t) lo = mid + 1 else hi = mid
    }
    return lo - 1
}

/** A pause counts as long from 1 s (rounded to a tenth, like the web). */
fun isLongPause(p: Pause): Boolean = (p.dur * 10).roundToInt() >= 10

/** "1.3" */
fun pauseSec(p: Pause): String = fmt((p.dur * 10).roundToInt() / 10.0)
