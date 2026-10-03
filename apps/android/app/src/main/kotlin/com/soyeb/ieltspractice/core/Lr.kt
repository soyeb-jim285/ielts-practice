package com.soyeb.ieltspractice.core

import kotlinx.serialization.Serializable

// Listening & Reading tests (cambridge-gated). Wire types for /api/lr/*, plus the pure logic ported from apps/web/src/lib/lr.ts.
// Decode with `AppJson`. Rules for answers and bands live on the server (packages/core/src/lr.ts); the app only displays them.

/** Reading is 60 minutes; the listening exam gives 2 minutes to check answers after the last recording. */
const val READING_SECONDS = 3600
const val LISTENING_REVIEW_SECONDS = 120

@Serializable data class LrOption(val key: String, val text: String = "")
@Serializable data class LrQuestion(val n: Int, val text: String? = null, val options: List<LrOption>? = null, val answer: List<String>? = null)
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
) {
    val listening get() = skill == "listening"
}
@Serializable data class LrMark(val n: Int, val given: String = "", val correct: Boolean = false, val answer: List<String> = emptyList())

/** `GET/POST /api/lr/attempts...`: the stripped test while in progress, the full test, marks and transcripts once submitted. */
@Serializable data class LrAttempt(
    val id: String,
    val testId: String = "",
    val mode: String = "practice",
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
    data class Gap(val n: Int) : Inline
}
sealed interface Block {
    data class P(val inline: List<Inline>) : Block
    data class Items(val ordered: Boolean, val items: List<List<Inline>>) : Block
    data class Table(val head: List<List<Inline>>, val rows: List<List<List<Inline>>>) : Block
}

private val INLINE = Regex("""(\{\{\d+\}\}|\*\*[^*]+\*\*)""")
private val GAP = Regex("""^\{\{(\d+)\}\}$""")
private val LIST_ITEM = Regex("""^([-•*]|\d+[.)])\s""")
private val RULE = Regex("""^:?-{2,}:?$""")

fun parseInline(s: String): List<Inline> {
    val out = mutableListOf<Inline>()
    var at = 0
    for (m in INLINE.findAll(s)) {
        if (m.range.first > at) out += Inline.Text(s.substring(at, m.range.first))
        val g = GAP.matchEntire(m.value)
        out += if (g != null) Inline.Gap(g.groupValues[1].toInt()) else Inline.Bold(m.value.removeSurrounding("**"))
        at = m.range.last + 1
    }
    if (at < s.length) out += Inline.Text(s.substring(at))
    return out
}

fun parseContent(md: String): List<Block> {
    val lines = md.split('\n')
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
