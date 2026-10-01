package com.soyeb.ieltspractice.core

import java.time.OffsetDateTime
import java.time.ZoneId
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// Pure helpers behind the result screens (port of the iOS `res*` helpers in Views/ResultView.swift and web lib/result.ts,
// lib/format.ts, lib/writing.ts). No Compose here so they are unit tested (ResultLogicTest).

private val months = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

/** "30 Sep 2026" (web formatDate); empty when the string is not a date. */
fun formatDate(iso: String): String = runCatching {
    val d = OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault())
    "${d.dayOfMonth} ${months[d.monthValue - 1]} ${d.year}"
}.getOrDefault("")

/** "51s", "4m 12s", "1h 5m" (web formatDuration). */
fun formatDuration(ms: Int): String {
    val s = Math.round(ms / 1000.0).toInt()
    if (s < 60) return "${s}s"
    val h = s / 3600
    val m = s % 3600 / 60
    if (h > 0) return if (m > 0) "${h}h ${m}m" else "${h}h"
    return if (s % 60 > 0) "${m}m ${s % 60}s" else "${m}m"
}

/** Stored prompt titles can be ALL CAPS: show those in sentence case (web sentenceCase). */
fun sentenceCase(t: String): String {
    val twoCaps = t.zipWithNext().any { (a, b) -> a in 'A'..'Z' && b in 'A'..'Z' }
    return if (twoCaps && t == t.uppercase()) t.take(1) + t.drop(1).lowercase() else t
}

/** [6, 7] gives "6–7"; [6.5, 6.5] gives "6.5" (web formatRange). */
fun bandRange(lo: Double, hi: Double): String = if (lo == hi) fmt(lo) else "${Band.format(lo)}–${Band.format(hi)}"

/** Cut at the last whole word within [max] characters, with an ellipsis (web clipWords). */
fun clipWords(s: String, max: Int): String =
    if (s.length <= max) s else s.take(max).replace(Regex("\\s+\\S*$"), "") + "…"

fun criterionLabel(k: String): String = if (k == "ta") "Task Achievement/Response" else Crit.label(k)

fun errorTitle(c: String): String = when (c) {
    "task.relevance" -> "Off-topic phrase"
    "task.overview" -> "Missing overview"
    "task.position" -> "Unclear position"
    else -> categoryLabel(c)
}

/** No usable speech: flagged by the pipeline, or overall 0. */
fun notAssessed(r: AnalysisResult): Boolean = r.noSpeech == true || r.overall == 0.0

/** Pronunciation more than 2 bands above fluency is an audio-only guess (web pronunciationUnsupported). */
fun pronUnsupported(r: AnalysisResult, k: String): Boolean {
    if (k != "p") return false
    val p = r.criteria["p"] ?: return false
    val fc = r.criteria["fc"] ?: return false
    return p.band - fc.band > 2
}

fun minWords(part: Int): Int = if (part == 1) 150 else 250

fun taskLabel(p: Prompt): String = if (p.part == 2) "Task 2" else "Task 1 ${if (p.variant == "general") "General" else "Academic"}"

/** Whether question [i] has any speech in the transcript. Unknown boundaries count as answered. */
fun wasAnswered(r: AnalysisResult, i: Int): Boolean {
    val qs = r.questions ?: return true
    if (i !in qs.indices) return true
    val q = qs[i]
    val next = qs.drop(i + 1).firstOrNull { it.startWord >= 0 }
    return q.startWord >= 0 && q.startWord < (r.words?.size ?: 0) && (next == null || next.startWord > q.startWord)
}

fun answeredRelevance(r: AnalysisResult): List<Relevance> = r.relevance.orEmpty().filter { wasAnswered(r, it.questionIdx) }

/** Speaking answers that missed their question, when that is most of them; else null. */
fun offTopic(r: AnalysisResult): Pair<Int, Int>? {
    val rel = answeredRelevance(r)
    val off = rel.count { !it.onTopic }
    return if (off * 2 > rel.size) off to rel.size else null
}

/** Transcript heading for a question: its first line, plus the rest (cue card) without a repeat of that line. */
fun questionHead(text: String): Pair<String, String> {
    val parts = text.split("\n")
    val head = parts.first()
    var rest = parts.drop(1).joinToString("\n")
    if (head.isNotEmpty() && rest.startsWith(head)) rest = rest.drop(head.length).trim()
    return head to rest.replace(Regex("\\s*\\n\\s*"), " ")
}

/** What the header shows: an off-topic writing answer is capped at one band over its Task Achievement/Response score (web capOffTopic). */
data class ResScore(val overall: Double, val raw: Double, val range: List<Double>, val offTopic: Boolean)

fun resScore(r: AnalysisResult): ResScore {
    val plain = ResScore(r.overall, r.overallRaw, r.range, false)
    if (r.skill != "writing" || r.tooShort == true) return plain
    val ta = r.criteria["ta"]?.band ?: return plain
    val major = r.errors.any { it.category == "task.relevance" && it.severity == "major" }
    if (!(ta <= 4 || major)) return plain
    val cap = ta + 1
    return ResScore(min(r.overall, cap), min(r.overallRaw, cap), r.range.map { min(it, cap) }, true)
}

// MARK: Session overall (web sessionOverall)

/** Speaking: criteria averaged across parts weighted by speaking time, whole bands, then the usual rounding. Null when no part is scored. */
fun speakingSessionOverall(attempts: List<Attempt>): Pair<Double, Int>? {
    val scored = attempts.filter { a ->
        val r = a.analysis
        r != null && !notAssessed(r) && Crit.order("speaking").all { r.criteria[it] != null }
    }
    if (scored.isEmpty()) return null
    val total = scored.sumOf { max((it.durationMs ?: 0).toDouble(), 1.0) }
    fun avg(k: String): Double =
        Math.round(scored.sumOf { (it.analysis?.criteria?.get(k)?.band ?: 0.0) * max((it.durationMs ?: 0).toDouble(), 1.0) } / total).toDouble()
    return Band.speakingOverall(avg("fc"), avg("lr"), avg("gra"), avg("p")).band to scored.size
}

/** Writing: (Task 1 + 2 x Task 2) / 3 on the shown (off-topic capped) bands; null until both tasks are scored. */
fun writingSessionOverall(attempts: List<Attempt>): Double? {
    fun shown(part: Int) = attempts.firstOrNull { it.part == part }?.analysis?.let { resScore(it).overall }
    val t1 = shown(1) ?: return null
    val t2 = shown(2) ?: return null
    return Band.writingOverall(t1, t2).band
}

// MARK: Text metrics (port of packages/core/src/text.ts: tokenize, MTLD, repeated words)

fun tokenize(text: String): List<String> {
    val chars = text.lowercase()
    fun letter(c: Char) = c in 'a'..'z'
    val out = mutableListOf<String>()
    var i = 0
    while (i < chars.length) {
        if (!letter(chars[i])) { i++; continue }
        var j = i
        while (j < chars.length && letter(chars[j])) j++
        if (j + 1 < chars.length && chars[j] == '\'' && letter(chars[j + 1])) {
            var k = j + 1
            while (k < chars.length && letter(chars[k])) k++
            j = k
        }
        out += chars.substring(i, j)
        i = j
    }
    return out
}

private fun mtldPass(tokens: List<String>, threshold: Double): Double {
    var factors = 0.0
    var types = HashSet<String>()
    var count = 0
    var ttr = 1.0
    for (t in tokens) {
        types.add(t)
        count++
        ttr = types.size.toDouble() / count
        if (ttr <= threshold) { factors++; types = HashSet(); count = 0; ttr = 1.0 }
    }
    if (count > 0) factors += (1 - ttr) / (1 - threshold)
    return if (factors == 0.0) tokens.size.toDouble() else tokens.size / factors
}

fun mtld(tokens: List<String>): Double =
    if (tokens.isEmpty()) 0.0 else (mtldPass(tokens, 0.72) + mtldPass(tokens.reversed(), 0.72)) / 2

private val stop = ("that this with have from they their there them then than these those were been being will would could should what when where " +
    "which while about after before because also some such more most many much very only just into over other each both same does " +
    "doing done your yours make made like well even here itself ours whom upon among within without again further once").split(" ").toSet()

/** Content words (length > 3, not a function word) used 4+ times, most frequent first (max 10). */
fun repeatedWords(tokens: List<String>): List<Repeated> {
    val freq = LinkedHashMap<String, Int>()
    for (t in tokens) if (t.length > 3 && t !in stop) freq[t] = (freq[t] ?: 0) + 1
    return freq.entries.filter { it.value >= 4 }.sortedByDescending { it.value }.take(10).map { Repeated(it.key, it.value) }
}

// MARK: Word diff (retry vs parent, rewrite vs answer)

enum class DiffOp { Same, Removed, Added }
data class DiffRun(val op: DiffOp, val text: String)

/**
 * Word-level diff (LCS over whitespace tokens), merged into runs.
 * ponytail: O(n*m) table, fine for answers of a few hundred words; Myers diff if essays get much longer.
 */
fun wordDiff(old: String, new: String): List<DiffRun> {
    val a = old.split(Regex("\\s+")).filter { it.isNotEmpty() }
    val b = new.split(Regex("\\s+")).filter { it.isNotEmpty() }
    val lcs = Array(a.size + 1) { IntArray(b.size + 1) }
    for (i in a.size - 1 downTo 0) for (j in b.size - 1 downTo 0) {
        lcs[i][j] = if (a[i] == b[j]) lcs[i + 1][j + 1] + 1 else max(lcs[i + 1][j], lcs[i][j + 1])
    }
    val out = mutableListOf<DiffRun>()
    fun push(op: DiffOp, w: String) {
        if (out.lastOrNull()?.op == op) out[out.lastIndex] = DiffRun(op, out.last().text + " " + w) else out += DiffRun(op, w)
    }
    var i = 0
    var j = 0
    while (i < a.size || j < b.size) {
        if (i < a.size && j < b.size && a[i] == b[j]) { push(DiffOp.Same, a[i]); i++; j++ }
        else if (i < a.size && (j == b.size || lcs[i + 1][j] >= lcs[i][j + 1])) { push(DiffOp.Removed, a[i]); i++ } // removed first: "has -> have"
        else { push(DiffOp.Added, b[j]); j++ }
    }
    return out
}

// MARK: Fluency measures (web speechStats)

enum class FluTone { Good, Warn, Bad, Na }

data class FluStat(val key: String, val label: String, val value: String, val tone: FluTone, val info: String)

/** Under ~20 words or 15 s, rates and per-minute counts are noise: show no verdicts. */
fun fluTooShort(m: SpeechMetrics): Boolean = m.wordCount < 20 || m.durationS < 15

fun fluUpTo(v: Double, good: Double, warn: Double) = if (v <= good) FluTone.Good else if (v <= warn) FluTone.Warn else FluTone.Bad
fun fluAtLeast(v: Double, good: Double, warn: Double) = if (v >= good) FluTone.Good else if (v >= warn) FluTone.Warn else FluTone.Bad

/** Events per minute with the same floor as the web (a 5 s clip is not 12x a minute). */
fun perMinute(n: Int, durationS: Double): Double = n / max(durationS / 60, 0.25)

/** Stat grid with a tone against a band-7 heuristic. */
fun fluStats(m: SpeechMetrics): List<FluStat> {
    val rate = m.speechRate
    val long = m.pauses.count(::isLongPause)
    val pace = if (rate in 120.0..170.0) FluTone.Good else if (rate in 100.0..190.0) FluTone.Warn else FluTone.Bad
    val d = m.durationS
    val stats = listOf(
        FluStat("rate", "Speech rate", "${rate.roundToInt()} wpm", pace,
            "Words per minute over the whole answer, pauses included. Band 7+ speakers usually sit around 120–170."),
        FluStat("artic", "Articulation rate", "${m.articulationRate.roundToInt()} wpm", fluAtLeast(m.articulationRate, 150.0, 130.0),
            "Words per minute while you are actually speaking (pauses removed). Low values mean slow, effortful delivery."),
        FluStat("mlr", "Mean length of run", "${fmt(m.mlr)} words", fluAtLeast(m.mlr, 8.0, 5.0),
            "Average number of words between pauses. Longer runs sound more fluent."),
        FluStat("pauseRatio", "Pause ratio", "${(m.pauseRatio * 100).roundToInt()}%", fluUpTo(m.pauseRatio, 0.2, 0.3),
            "Share of the answer spent in silence."),
        FluStat("long", "Long pauses", "$long", fluUpTo(perMinute(long, d), 1.0, 2.0),
            "Silences of 1 second or more. Examiners hear these as searching for words."),
        FluStat("mid", "Mid-clause pauses", "${m.midClausePauses}", fluUpTo(perMinute(m.midClausePauses, d), 1.0, 2.5),
            "Pauses inside a clause rather than at a natural boundary. These hurt fluency more than pauses between ideas."),
        FluStat("fillers", "Fillers", "${fmt(m.fillersPerMin)}/min", fluUpTo(m.fillersPerMin, 2.0, 4.0),
            "um, uh, er, \"you know\", \"sort of\" and voiced hesitations per minute."),
        FluStat("reps", "Repetitions", "${m.repetitions.size}", fluUpTo(perMinute(m.repetitions.size, d), 1.0, 2.0),
            "Words or phrases repeated back-to-back while you search for the next idea."),
        FluStat("self", "Self-corrections", "${m.selfCorrections.size}", fluUpTo(perMinute(m.selfCorrections.size, d), 1.0, 2.0),
            "Restarts like \"I go— I went\". A few are natural; many suggest hesitation."),
        FluStat("var", "Pace variability", "±${m.wpmStdDev.roundToInt()} wpm", fluUpTo(m.wpmStdDev, 20.0, 35.0),
            "Standard deviation of your pace across 10-second windows. Big swings = uneven pace."),
    )
    return if (fluTooShort(m)) stats.map { it.copy(value = "—", tone = FluTone.Na) } else stats
}
