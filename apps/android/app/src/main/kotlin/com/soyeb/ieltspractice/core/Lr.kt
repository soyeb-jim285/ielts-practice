package com.soyeb.ieltspractice.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

// Listening & Reading tests (cambridge-gated). Wire types for /api/lr/*, plus the pure logic ported from apps/web/src/lib/lr.ts.
// Decode with `AppJson`. Rules for answers and bands live on the server (packages/core/src/lr.ts); the app only displays them.

/** Reading is 60 minutes; the listening exam: the checking time its recording announces (LrTest.checkEndsAt), else 2 minutes after the last recording. */
const val READING_SECONDS = 3600
const val LISTENING_REVIEW_SECONDS = 120

/** Exam reading clock: 60 minutes for the whole test, 20 per passage when taking only some. */
fun readingSeconds(parts: List<Int>?) = if (!parts.isNullOrEmpty()) 1200 * parts.size else READING_SECONDS

// ponytail: every test has 4 listening parts / 3 reading passages; the server rejects a part a test lacks
fun lrParts(skill: String) = if (skill == "listening") listOf(1, 2, 3, 4) else listOf(1, 2, 3)

/** "Part 2", "Passages 1, 3", or "Full test" when parts is null. */
fun partsLabel(skill: String, parts: List<Int>?): String =
    if (parts.isNullOrEmpty()) "Full test"
    else "${if (skill == "listening") "Part" else "Passage"}${if (parts.size > 1) "s" else ""} ${parts.joinToString(", ")}"

@Serializable data class LrOption(val key: String, val text: String = "")
/** Review-only enrichment of a question (after submit): where the answer is, why, why each wrong pick is wrong, wording pairs. */
@Serializable data class LrReview(
    val evidence: String? = null,
    val at: Double? = null,
    val why: String? = null,
    val wrong: Map<String, String>? = null,
    /** `[question wording, passage wording]` pairs */
    val paraphrase: List<List<String>>? = null,
)
@Serializable data class LrQuestion(val n: Int, val text: String? = null, val options: List<LrOption>? = null, val answer: List<String>? = null, val review: LrReview? = null)
@Serializable data class LrVocab(val word: String, val meaning: String = "", val example: String? = null)
@Serializable data class LrGroup(
    val from: Int,
    val to: Int,
    /** gap | mcq | mcq-multi | tfng | ynng | match */
    val type: String,
    val instructions: String = "",
    val wordLimit: String? = null,
    val title: String? = null,
    /** gap groups: markdown (tables allowed) with `{{n}}` placeholders */
    val content: String? = null,
    val options: List<LrOption>? = null,
    val reusable: Boolean? = null,
    /** asset key of a map/plan/diagram image */
    val image: String? = null,
    val questions: List<LrQuestion> = emptyList(),
)
@Serializable data class LrParagraph(val label: String? = null, val text: String)
@Serializable data class LrPassage(val title: String, val subtitle: String? = null, val paragraphs: List<LrParagraph> = emptyList())
@Serializable data class LrSection(
    val part: Int,
    val title: String? = null,
    val audio: String? = null,
    val transcript: String? = null,
    /** After submit: key words of the part */
    val vocab: List<LrVocab>? = null,
    /** After submit, listening: `[word, start s, end s]` rows (see [timingRows]) */
    val timings: List<List<JsonElement>>? = null,
    val passage: LrPassage? = null,
    val groups: List<LrGroup> = emptyList(),
)
@Serializable data class LrTest(
    val slug: String = "",
    val skill: String,
    val variant: String = "academic",
    val source: String = "generated",
    val ref: String = "",
    val title: String,
    val sections: List<LrSection> = emptyList(),
    /** Listening, before submit: when the checking time the recording announces runs out, in seconds into the last part's audio. Null: 2 minutes. */
    val checkEndsAt: Double? = null,
) {
    val listening get() = skill == "listening"
}
@Serializable data class LrMark(val n: Int, val given: String = "", val correct: Boolean = false, val answer: List<String> = emptyList())

/** What the runner measured: seconds per part, answer changes per question, questions answered in the final 5 minutes (or after the recordings, in the exam). */
@Serializable data class LrStats(val partS: Map<String, Double> = emptyMap(), val changes: Map<String, Int> = emptyMap(), val late: List<Int> = emptyList(), val audio: LrAudioState? = null)

/** Practice listening resume state (stats.audio, mirrored on the device): playback position per part in seconds, and the speed. */
@Serializable data class LrAudioState(val pos: Map<String, Double> = emptyMap(), val rate: Double? = null) {
    /** Drops anything the server would reject (non-finite, out of range, unknown speed). */
    fun cleaned() = LrAudioState(
        pos.filter { (k, v) -> k.length == 1 && k[0].isDigit() && v.isFinite() }.mapValues { Math.round(it.value.coerceIn(0.0, 3600.0) * 10) / 10.0 },
        rate?.takeIf { it in RATES },
    )
    fun encode() = AppJson.encodeToString(serializer(), cleaned())

    companion object {
        val RATES = listOf(0.75, 1.0, 1.25)
        /** Where to put the playhead: within 3 s of the end (or unknown) means the part was finished, so start over. */
        fun resumePosition(pos: Double, duration: Double) = if (pos > 1 && duration.isFinite() && duration > 0 && pos < duration - 3) pos else 0.0
        /** This device's copy wins over the server's (it is never older than what this device last played). */
        fun pick(local: String?, server: LrAudioState?): LrAudioState? =
            local?.let { runCatching { AppJson.decodeFromString(serializer(), it).cleaned() }.getOrNull() } ?: server?.cleaned()
    }
}
/** A wrong gap answer with a deterministic reason (server `analysis.gaps`). */
@Serializable data class LrGapEntry(val n: Int, val kind: String, val label: String, val message: String, val word: String? = null, val typed: String? = null, val before: Int? = null)
@Serializable data class LrTfngRow(val n: Int, val kind: String, val chose: String, val answer: String)
@Serializable data class LrTypeAcc(val label: String, val right: Int, val total: Int)
@Serializable data class LrAnalysis(val gaps: List<LrGapEntry> = emptyList(), val tfng: List<LrTfngRow> = emptyList(), val byType: List<LrTypeAcc> = emptyList())

/** `GET /api/lr/progress` */
@Serializable data class LrTrendPoint(val attemptId: String = "", val skill: String, val date: String, val band: Double)
@Serializable data class LrTypeStat(val skill: String, val label: String, val right: Int, val total: Int)
@Serializable data class LrSuggested(val id: String, val title: String, val skill: String, val label: String, val count: Int)
@Serializable data class LrTfngPattern(val kind: String = "tfng", val answer: String = "", val chose: String = "", val count: Int = 0, val of: Int = 0, val pct: Int = 0, val text: String = "")
@Serializable data class LrTfngSummary(val pattern: LrTfngPattern? = null, val rows: Int = 0)
@Serializable data class LrProgress(
    val trend: List<LrTrendPoint> = emptyList(),
    val byType: List<LrTypeStat> = emptyList(),
    val weakest: List<LrTypeStat> = emptyList(),
    val suggested: LrSuggested? = null,
    val tfng: LrTfngSummary = LrTfngSummary(),
)
/** `GET /api/lr/spelling`: words misspelt (or wrongly pluralised) in gap answers, most frequent first. */
@Serializable data class LrSpellingItem(val word: String, val kind: String = "spelling", val count: Int = 1, val typed: List<String> = emptyList(), val lastAt: String = "")
@Serializable data class LrSpelling(val items: List<LrSpellingItem> = emptyList())

/** `GET/POST /api/lr/attempts...`: the stripped test while in progress, the full test, marks and transcripts once submitted. */
@Serializable data class LrAttempt(
    val id: String,
    val testId: String = "",
    val mode: String = "practice",
    /** Chosen parts; null = the whole test. Partial attempts have no band. */
    val parts: List<Int>? = null,
    val status: String = "in_progress",
    val responses: Map<String, String> = emptyMap(),
    val elapsedS: Int = 0,
    val startedAt: String = "",
    val submittedAt: String? = null,
    val raw: Int? = null,
    val total: Int? = null,
    val band: Double? = null,
    val marks: List<LrMark>? = null,
    val test: LrTest,
    /** Asset key to presigned GET URL (audio supports Range). */
    val assets: Map<String, String> = emptyMap(),
    val stats: LrStats? = null,
    /** Null for attempts submitted before the analysis existed. */
    val analysis: LrAnalysis? = null,
) {
    val submitted get() = status == "submitted"
    val exam get() = mode == "exam"
}

@Serializable data class LrTestItem(
    val id: String,
    val slug: String = "",
    val skill: String,
    val variant: String = "academic",
    val source: String = "generated",
    val ref: String = "",
    val title: String,
    val total: Int = 40,
    /** new | in_progress | submitted (from the latest attempt) */
    val status: String = "new",
    val attemptId: String? = null,
    val mode: String? = null,
    /** Parts of the in-progress attempt (null = whole test or none). */
    val parts: List<Int>? = null,
    val answered: Int = 0,
    val bestBand: Double? = null,
    val attempts: Int = 0,
)

@Serializable data class LrAttemptItem(
    val id: String,
    val testId: String = "",
    val skill: String,
    val variant: String = "academic",
    val ref: String = "",
    val title: String,
    val mode: String = "practice",
    val parts: List<Int>? = null,
    val status: String = "in_progress",
    val raw: Int? = null,
    val total: Int? = null,
    val band: Double? = null,
    val answered: Int = 0,
    val startedAt: String = "",
    val submittedAt: String? = null,
)

@Serializable data class LrSaved(val savedAt: String = "")

/** A question in test order with the part and group it belongs to. */
data class FlatQ(val n: Int, val part: Int, val group: LrGroup, val q: LrQuestion)

fun LrTest.flat(): List<FlatQ> = sections.flatMap { s -> s.groups.flatMap { g -> g.questions.map { FlatQ(it.n, s.part, g, it) } } }

fun Map<String, String>.isAnswered(n: Int) = this[n.toString()]?.isNotBlank() == true
fun Map<String, String>.answeredCount(t: LrTest) = t.flat().count { isAnswered(it.n) }

/** Returns [this] with question [n] set to [v] (blank removes it). */
fun Map<String, String>.withAnswer(n: Int, v: String): Map<String, String> = if (v.isBlank()) this - n.toString() else this + (n.toString() to v)

/** Names a group's question type for the accuracy table ("Matching headings", "Table completion"). */
fun typeLabel(g: LrGroup): String = when (g.type) {
    "tfng" -> "True / False / Not Given"
    "ynng" -> "Yes / No / Not Given"
    "mcq" -> "Multiple choice"
    "mcq-multi" -> "Multiple choice (more than one)"
    "match" -> when {
        g.image != null -> "Labelling a map or diagram"
        g.options?.any { Regex("^[ivx]+$", RegexOption.IGNORE_CASE).matches(it.key) } == true -> "Matching headings"
        else -> "Matching"
    }
    else -> {
        val t = "${g.title.orEmpty()} ${g.instructions}".lowercase()
        when {
            g.image != null -> "Labelling a map or diagram"
            g.options != null -> "Summary with a word box"
            "table" in t -> "Table completion"
            "flow" in t -> "Flow-chart completion"
            "summary" in t -> "Summary completion"
            "form" in t -> "Form completion"
            "notes" in t -> "Note completion"
            "sentence" in t -> "Sentence completion"
            else -> "Completion"
        }
    }
}

data class Accuracy(val label: String, val right: Int, val total: Int)

/** Accuracy per [key] (part, question type) from the marks of a submitted attempt, in first-seen order. */
fun accuracyBy(t: LrTest, marks: List<LrMark>, key: (FlatQ) -> String): List<Accuracy> {
    val ok = marks.associate { it.n to it.correct }
    val out = linkedMapOf<String, IntArray>()
    for (f in t.flat()) {
        val e = out.getOrPut(key(f)) { IntArray(2) }
        e[1]++
        if (ok[f.n] == true) e[0]++
    }
    return out.map { (k, v) -> Accuracy(k, v[0], v[1]) }
}

/** The letters picked in a choose-N group, in slot order. Picks are stored one per question slot of the group. */
fun multiPicks(g: LrGroup, r: Map<String, String>): List<String> = g.questions.mapNotNull { r[it.n.toString()]?.takeIf { v -> v.isNotBlank() } }

fun setMultiPicks(g: LrGroup, r: Map<String, String>, picks: List<String>): Map<String, String> {
    val next = r.toMutableMap()
    g.questions.forEachIndexed { i, q -> picks.getOrNull(i)?.let { next[q.n.toString()] = it } ?: next.remove(q.n.toString()) }
    return next
}

// ---- gap content markup: a markdown subset (tables, lists, paragraphs, **bold**) with {{n}} placeholders ----

sealed interface Inline {
    data class Text(val text: String) : Inline
    data class Bold(val text: String) : Inline
    /** [part] of [of] blanks of one question ("from {{7}} to {{7}}"); of = 1 is a plain gap. */
    data class Gap(val n: Int, val part: Int = 0, val of: Int = 1) : Inline
}
sealed interface Block {
    data class P(val inline: List<Inline>) : Block
    data class Items(val ordered: Boolean, val items: List<List<Inline>>) : Block
    data class Table(val head: List<List<Inline>>, val rows: List<List<List<Inline>>>) : Block
}

private val INLINE = Regex("""(\{\{\d+(?::\d+:\d+)?\}\}|\*\*[^*]+\*\*)""")
private val GAP = Regex("""^\{\{(\d+)(?::(\d+):(\d+))?\}\}$""")
private val PLAIN_GAP = Regex("""\{\{(\d+)\}\}""")
private val LIST_ITEM = Regex("""^([-•*]|\d+[.)])\s""")
private val RULE = Regex("""^:?-{2,}:?$""")

/** One question with two blanks ("from {{7}} to {{7}}") becomes "{{7:0:2}} ... {{7:1:2}}", so each blank gets its own field (web numberGapParts). */
fun numberGapParts(md: String): String {
    val total = PLAIN_GAP.findAll(md).groupingBy { it.groupValues[1] }.eachCount()
    val seen = HashMap<String, Int>()
    return PLAIN_GAP.replace(md) { m ->
        val n = m.groupValues[1]
        val of = total.getValue(n)
        if (of > 1) { val k = seen.getOrDefault(n, 0); seen[n] = k + 1; "{{$n:$k:$of}}" } else m.value
    }
}

/** The answer to a multi-blank question is stored as "part / part"; marking folds "/" to a space. */
fun gapPart(v: String, part: Int): String = v.split(" / ").getOrElse(part) { "" }
fun setGapPart(v: String, part: Int, of: Int, text: String): String {
    val parts = List(of) { if (it == part) text else gapPart(v, it) }
    return if (parts.any { it.isNotBlank() }) parts.joinToString(" / ") else ""
}

fun parseInline(s: String): List<Inline> {
    val out = mutableListOf<Inline>()
    var at = 0
    for (m in INLINE.findAll(s)) {
        if (m.range.first > at) out += Inline.Text(s.substring(at, m.range.first))
        val g = GAP.matchEntire(m.value)
        out += if (g != null) Inline.Gap(g.groupValues[1].toInt(), g.groupValues[2].toIntOrNull() ?: 0, g.groupValues[3].toIntOrNull() ?: 1) else Inline.Bold(m.value.removeSurrounding("**"))
        at = m.range.last + 1
    }
    if (at < s.length) out += Inline.Text(s.substring(at))
    return out
}

fun parseContent(md: String): List<Block> {
    val lines = numberGapParts(md).split('\n')
    val blocks = mutableListOf<Block>()
    var i = 0
    while (i < lines.size) {
        val line = lines[i].trim()
        when {
            line.isEmpty() -> i++
            line.startsWith("|") -> {
                val rows = mutableListOf<List<String>>()
                while (i < lines.size && lines[i].trim().startsWith("|")) {
                    val cells = lines[i].trim().removePrefix("|").removeSuffix("|").split("|").map { it.trim() }
                    if (!cells.all { RULE.matches(it) }) rows += cells
                    i++
                }
                val head = rows.firstOrNull().orEmpty()
                blocks += Block.Table(head.map(::parseInline), rows.drop(1).map { r -> r.map(::parseInline) })
            }
            LIST_ITEM.containsMatchIn(line) -> {
                val ordered = line[0].isDigit()
                val items = mutableListOf<List<Inline>>()
                while (i < lines.size && LIST_ITEM.containsMatchIn(lines[i].trim())) {
                    items += parseInline(lines[i].trim().replace(Regex("""^([-•*]|\d+[.)])\s+"""), ""))
                    i++
                }
                blocks += Block.Items(ordered, items)
            }
            else -> { blocks += Block.P(parseInline(line)); i++ }
        }
    }
    return blocks
}

/** "C17 T2" gives book 17, test 2. */
fun parseRef(ref: String): Pair<Int, Int>? =
    Regex("""^C(\d+)\s*T(\d+)""", RegexOption.IGNORE_CASE).find(ref)?.let { it.groupValues[1].toInt() to it.groupValues[2].toInt() }

class LrHubGroup(val key: String, val heading: String, val tests: List<LrTestItem>)

/** Cambridge tests grouped by book (newest first, tests in order); our own tests under one heading at the end. */
fun lrHubGroups(items: List<LrTestItem>): List<LrHubGroup> {
    val books = sortedMapOf<Int, MutableList<LrTestItem>>(compareByDescending<Int> { it })
    val own = mutableListOf<LrTestItem>()
    val other = mutableListOf<LrTestItem>()
    for (t in items) {
        val r = if (t.source == "cambridge") parseRef(t.ref) else null
        when {
            r != null -> books.getOrPut(r.first) { mutableListOf() } += t
            t.source == "cambridge" -> other += t
            else -> own += t
        }
    }
    val out = books.map { (book, ts) -> LrHubGroup("c$book", "Cambridge IELTS $book", ts.sortedBy { parseRef(it.ref)!!.second }) }.toMutableList()
    if (other.isNotEmpty()) out += LrHubGroup("c", "Cambridge IELTS", other)
    if (own.isNotEmpty()) out += LrHubGroup("own", "Original practice tests", own)
    return out
}
