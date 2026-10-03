package com.soyeb.ieltspractice.core

import java.text.Normalizer
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive

// Listening & Reading review helpers: answer location in a passage / transcript / word timings and the dictation diff.
// Faithful port of packages/core/src/lr-review.ts (the gap classifier and TFNG analysis come from the server in `analysis`).

private val COMBINING = Regex("[̀-ͯ]")
private val QUOTES = Regex("[‘’`]")
private val DASHES = Regex("[-–—/]")
private val PUNCT = Regex("[.,;:!?\"“”]+")
private val SPACES = Regex("\\s+")

/** Lower case, accents and punctuation removed, one space between words (core `fold`, also `norm` in lr.ts). */
fun fold(s: String): String = Normalizer.normalize(s.lowercase(), Normalizer.Form.NFKD)
    .replace(COMBINING, "").replace(QUOTES, "'").replace(DASHES, " ").replace(PUNCT, " ").replace(SPACES, " ").trim()

fun lrWords(s: String): List<String> = fold(s).split(' ').filter { it.isNotEmpty() }

/** "(the) old (town) hall" gives every variant with and without each optional part. */
fun expandAnswer(a: String): List<String> {
    val m = Regex("\\(([^()]*)\\)").find(a) ?: return listOf(fold(a))
    val pre = a.substring(0, m.range.first)
    val post = a.substring(m.range.last + 1)
    return expandAnswer(pre + m.groupValues[1] + post) + expandAnswer(pre + post)
}

private fun variantsOf(answers: List<String>) = answers.flatMap(::expandAnswer).distinct().filter { it.length >= 3 }.sortedByDescending { it.length }

// ---------------------------------------------------------------- TRUE / FALSE / NOT GIVEN

private val TF = mapOf("t" to "TRUE", "true" to "TRUE", "f" to "FALSE", "false" to "FALSE", "ng" to "NOT GIVEN", "not given" to "NOT GIVEN", "y" to "YES", "yes" to "YES", "n" to "NO", "no" to "NO")
fun tfngValue(given: String): String = TF[fold(given)] ?: ""

class TfngRule(val value: String, val rule: String)
val TFNG_RULES: Map<String, List<TfngRule>> = mapOf(
    "tfng" to listOf(
        TfngRule("TRUE", "The passage says the same thing, usually in different words. Look for a paraphrase, not matching words."),
        TfngRule("FALSE", "The passage says the opposite. You can point to a sentence that contradicts the statement."),
        TfngRule("NOT GIVEN", "The passage never settles it. If no sentence confirms or contradicts the statement, it is NOT GIVEN, whatever you know yourself."),
    ),
    "ynng" to listOf(
        TfngRule("YES", "The statement agrees with the writer's view or claim. Check it is the writer's opinion, not a fact or someone else's view."),
        TfngRule("NO", "The statement contradicts the writer's view or claim. You can point to the sentence that says the opposite."),
        TfngRule("NOT GIVEN", "The writer expresses no view on it. If the passage neither agrees nor disagrees, it is NOT GIVEN."),
    ),
)

/** Key under which a wrong pick is explained: option letter / roman numeral as given, or TRUE / FALSE / NOT GIVEN. */
fun wrongNote(q: LrQuestion, given: String): String? {
    val w = q.review?.wrong ?: return null
    val g = given.trim()
    if (g.isEmpty()) return null
    val keys = listOf(g, g.uppercase(), g.lowercase(), tfngValue(g)).filter { it.isNotEmpty() }
    val hit = w.keys.firstOrNull { k -> keys.any { it.equals(k, ignoreCase = true) } }
    return hit?.let { w[it] }
}

fun timesText(n: Int) = when (n) { 1 -> "once"; 2 -> "2 times"; else -> "$n times" }

// ---------------------------------------------------------------- answer location

data class TextSpan(val p: Int, val s: Int, val e: Int)

/** Letters/digits lower-cased, everything else one space, with each kept char's index in the raw text. */
private fun normMap(text: String): Pair<String, List<Int>> {
    val out = StringBuilder()
    val idx = ArrayList<Int>()
    for (i in text.indices) {
        val ch = fold(text[i].toString().replace(Regex("\\s"), " ").ifEmpty { " " })
        for (c in if (ch.isEmpty()) " " else ch) {
            if (c in 'a'..'z' || c in '0'..'9') { out.append(c); idx.add(i) }
            else if (out.isNotEmpty() && out.last() != ' ') { out.append(' '); idx.add(i) }
        }
    }
    return out.toString() to idx
}

private fun exactSpan(paras: List<String>, phrase: String): TextSpan? {
    val needle = fold(phrase).replace(Regex("[^a-z0-9 ]"), " ").replace(SPACES, " ").trim()
    if (needle.isEmpty()) return null
    for (p in paras.indices) {
        val (out, idx) = normMap(paras[p])
        val at = out.indexOf(needle)
        if (at >= 0) return TextSpan(p, idx[at], idx[at + needle.length - 1] + 1)
    }
    return null
}

private val SENT_END = Regex("[.!?][\"”’']?\\s\\z")

/** Sentence (in the raw paragraph) around [s,e). */
private fun sentenceAround(text: String, s: Int, e: Int): Pair<Int, Int> {
    var a = s
    while (a > 0 && !(SENT_END.containsMatchIn(text.substring(maxOf(0, a - 3), a)) || text[a - 1] == '\n')) a--
    var b = e
    while (b < text.length && !(text.getOrNull(b - 1)?.let { it in ".!?" } ?: false)) b++
    while (b < text.length && text[b] in "\"”’'") b++
    return a to minOf(b, text.length)
}

private fun bestSentence(paras: List<String>, phrase: String): TextSpan? {
    val want = lrWords(phrase).toSet()
    if (want.size < 3) return null
    var best: TextSpan? = null
    var top = 0.0
    paras.forEachIndexed { p, t ->
        val sents = Regex("[^.!?\\n]+[.!?]*[\"”’']?").findAll(t).toList()
        for (i in sents.indices) for (n in 1..3) {
            if (i + n > sents.size) break
            val run = sents.subList(i, i + n)
            val have = lrWords(run.joinToString(" ") { it.value }).toSet()
            val score = want.count { it in have }.toDouble() / want.size - (n - 1) * 0.01
            if (score > top) { top = score; best = TextSpan(p, run.first().range.first, run.last().range.last + 1) }
        }
    }
    return if (best != null && top >= 0.6) best else null
}

/** Where a gap answer sits: the sentence of the paragraph containing the longest accepted variant as whole words. */
fun answerSentence(paras: List<String>, accepted: List<String>): TextSpan? {
    for (v in variantsOf(accepted)) for (p in paras.indices) {
        val (out, idx) = normMap(paras[p])
        val m = Regex("(^| )" + Regex.escape(v) + "( |$)").find(out) ?: continue
        val start = m.range.first + m.groupValues[1].length
        val s = idx[start]
        val e = idx[start + v.length - 1] + 1
        val (a, b) = sentenceAround(paras[p], s, e)
        return TextSpan(p, a, b)
    }
    return null
}

/**
 * The text to highlight for a question: `review.evidence` when it can be found (verbatim, then its fragments split at an ellipsis, then the
 * closest sentence), else for gap questions the sentence containing the accepted answer.
 */
fun evidenceSpan(paras: List<String>, q: LrQuestion, gap: Boolean): TextSpan? {
    val ev = q.review?.evidence?.trim()
    if (!ev.isNullOrEmpty()) {
        exactSpan(paras, ev)?.let { return it }
        val parts = ev.split("...", "…").map { it.trim() }.filter { lrWords(it).size >= 3 }
        val found = parts.mapNotNull { exactSpan(paras, it) }
        if (found.isNotEmpty() && found.all { it.p == found[0].p }) return TextSpan(found[0].p, found.minOf { it.s }, found.maxOf { it.e })
        bestSentence(paras, ev)?.let { return it }
    }
    return if (gap) answerSentence(paras, q.answer.orEmpty()) else null
}

/** The paragraphs of a section's reading passage, or the transcript's lines for listening. */
fun sectionParagraphs(s: LrSection): List<String> = s.passage?.paragraphs?.map { it.text } ?: (s.transcript.orEmpty()).split('\n')

// ---------------------------------------------------------------- listening: word timings

data class Timing(val w: String, val s: Double, val e: Double)

/** The `[word, start, end]` rows of a section (loosely typed on the wire). */
val LrSection.timingRows: List<Timing>
    get() = timings.orEmpty().mapNotNull { r ->
        if (r.size < 3) null else Timing(r[0].jsonPrimitive.content, r[1].jsonPrimitive.doubleOrNull ?: return@mapNotNull null, r[2].jsonPrimitive.doubleOrNull ?: return@mapNotNull null)
    }

data class Phrase(val start: Double, val end: Double)

private fun noCurrency(s: String) = s.map { if (it in "£$€¥") ' ' else it }.joinToString("")
private val UNIT_WORDS = mapOf("zero" to 0, "oh" to 0, "one" to 1, "two" to 2, "three" to 3, "four" to 4, "five" to 5, "six" to 6, "seven" to 7, "eight" to 8, "nine" to 9, "ten" to 10, "eleven" to 11, "twelve" to 12, "thirteen" to 13, "fourteen" to 14, "fifteen" to 15, "sixteen" to 16, "seventeen" to 17, "eighteen" to 18, "nineteen" to 19)
private val TENS_WORDS = mapOf("twenty" to 20, "thirty" to 30, "forty" to 40, "fifty" to 50, "sixty" to 60, "seventy" to 70, "eighty" to 80, "ninety" to 90)
private val ORDINALS = mapOf("first" to "one", "second" to "two", "third" to "three", "fifth" to "five", "eighth" to "eight", "ninth" to "nine", "twelfth" to "twelve")
private fun cardinal(w: String): String = ORDINALS[w] ?: when {
    w.endsWith("ieth") -> w.dropLast(4) + "y"
    w.endsWith("th") && (w.dropLast(2) in UNIT_WORDS || w.dropLast(2) in TENS_WORDS) -> w.dropLast(2)
    else -> w
}
private fun numberWord(raw: String): Pair<Int, Boolean>? { val w = cardinal(raw); return UNIT_WORDS[w]?.let { it to false } ?: TENS_WORDS[w]?.let { it to true } }
private val ORDINAL_DIGITS = Regex("^(\\d+)(st|nd|rd|th)$")

/** Numbers spoken as words become digits ("eleven thirty" = "11.30", "thirty five" = 35, "five hundred" = 500, "fifteenth" = 15); same rules as web `canon`. */
private fun canonTokens(t: List<Triple<String, Double, Double>>): List<Triple<String, Double, Double>> {
    val out = ArrayList<Triple<String, Double, Double>>()
    var i = 0
    while (i < t.size) {
        val x = t[i]
        val n = numberWord(x.first)
        if (n == null) { out.add(Triple(x.first.replace(ORDINAL_DIGITS, "$1"), x.second, x.third)); i++; continue }
        val nx = t.getOrNull(i + 1)?.let { numberWord(it.first) }
        if (n.second && nx != null && !nx.second && nx.first < 10) { out.add(Triple((n.first + nx.first).toString(), x.second, t[i + 1].third)); i += 2 }
        else if (!n.second && n.first < 10 && t.getOrNull(i + 1)?.first == "hundred") { out.add(Triple((n.first * 100).toString(), x.second, t[i + 1].third)); i += 2 }
        else { out.add(Triple(n.first.toString(), x.second, x.third)); i++ }
    }
    return out
}

/** Groups moments within `gap` (a fraction of the recording) of the previous one, so crowded scrubber markers can fold into one. */
fun <T> clusterMoments(items: List<T>, duration: Double, gap: Double = 0.08, at: (T) -> Double): List<List<T>> {
    val out = ArrayList<MutableList<T>>()
    for (m in items.sortedBy(at)) {
        val last = out.lastOrNull()?.last()
        if (duration > 0 && last != null && (at(m) - at(last)) / duration < gap) out.last().add(m) else out.add(mutableListOf(m))
    }
    return out
}

/** Finds a phrase in the word timings (normalised token alignment): exact run first, else the best window with at least 60% of its words. */
fun locatePhrase(timings: List<Timing>?, phrase: String): Phrase? {
    if (timings.isNullOrEmpty()) return null
    val tk = canonTokens(timings.flatMap { t -> lrWords(noCurrency(t.w)).map { Triple(it, t.s, t.e) } })
    val p = canonTokens(lrWords(noCurrency(phrase)).map { Triple(it, 0.0, 0.0) }).map { it.first }
    if (p.isEmpty() || p.size > tk.size) return null
    for (i in 0..tk.size - p.size) if (p.indices.all { k -> tk[i + k].first == p[k] }) return Phrase(tk[i].second, tk[i + p.size - 1].third)
    // spelled out letter by letter or digit by digit ("RH12 3TL" = R H one two three T L)
    val ps = p.joinToString("")
    if (ps.length >= 3) for (i in tk.indices) {
        var acc = ""
        var k = i
        while (k < tk.size && tk[k].first.length <= 2 && ps.startsWith(acc + tk[k].first)) { acc += tk[k].first; k++ }
        if (acc == ps && k - i >= 2) return Phrase(tk[i].second, tk[k - 1].third)
    }
    if (p.size < 4) return null
    val want = HashMap<String, Int>()
    p.forEach { want[it] = (want[it] ?: 0) + 1 }
    fun score(from: Int): Int {
        val left = HashMap(want)
        var hit = 0
        for (i in from until from + p.size) if ((left[tk[i].first] ?: 0) > 0) { left[tk[i].first] = left[tk[i].first]!! - 1; hit++ }
        return hit
    }
    var at = -1
    var top = 0
    for (i in 0..tk.size - p.size) { val s = score(i); if (s > top) { top = s; at = i } }
    if (at < 0 || top.toDouble() / p.size < 0.6) return null
    val set = p.toSet()
    var a = at
    var b = at + p.size - 1
    while (a < b && tk[a].first !in set) a++
    while (b > a && tk[b].first !in set) b--
    return Phrase(tk[a].second, tk[b].third)
}

data class AudioWin(val from: Double, val to: Double, val start: Double, val end: Double, val exact: Boolean)

/** Seconds to play for a question: evidence, else the accepted answer, else `review.at` (6 s). `from` starts 2 s early. */
fun audioWindow(timings: List<Timing>?, q: LrQuestion): AudioWin? {
    val ev = q.review?.evidence
    val hit = (if (!ev.isNullOrEmpty()) locatePhrase(timings, ev) else null)
        ?: q.answer.orEmpty().flatMap(::expandAnswer).distinct().filter { it.length >= 3 || (it.length >= 2 && it.any(Char::isDigit)) }.sortedByDescending { it.length }.firstNotNullOfOrNull { locatePhrase(timings, it) }
    if (hit != null) return AudioWin(maxOf(0.0, hit.start - 2), hit.end + 0.5, hit.start, hit.end, true)
    val at = q.review?.at ?: return null
    return AudioWin(maxOf(0.0, at - 2), at + 6, at, at + 6, false)
}

data class QuestionMoment(val n: Int, val at: Double, val from: Double, val to: Double, val exact: Boolean)

/** Where each question of a listening part is answered in the recording, in time order (web questionMoments). Unlocatable questions are left out. */
fun questionMoments(timings: List<Timing>?, groups: List<LrGroup>): List<QuestionMoment> =
    groups.flatMap { it.questions }.mapNotNull { q -> audioWindow(timings, q)?.let { QuestionMoment(q.n, it.start, it.from, it.to, it.exact) } }
        .sortedWith(compareBy({ it.at }, { it.n }))

/** The recording's words between two instants, as spoken (for the dictation drill). */
fun wordsBetween(t: List<Timing>?, from: Double, to: Double): String =
    t.orEmpty().filter { it.s >= from - 0.01 && it.e <= to + 0.01 }.joinToString(" ") { it.w }

// ---------------------------------------------------------------- dictation

enum class DictStatus { Correct, Missing, Wrong, Extra }
data class DictOp(val word: String, val typed: String?, val status: DictStatus)

/** Word-by-word comparison (LCS on normalised words). Unmatched stretches pair up as "wrong", leftovers are missing / extra. */
fun dictationDiff(typed: String, expected: String): List<DictOp> {
    val e = expected.split(SPACES).filter { it.isNotEmpty() }
    val t = typed.split(SPACES).filter { it.isNotEmpty() }
    val en = e.map(::fold)
    val tn = t.map(::fold)
    val l = Array(e.size + 1) { IntArray(t.size + 1) }
    for (i in e.size - 1 downTo 0) for (j in t.size - 1 downTo 0) l[i][j] = if (en[i] == tn[j]) l[i + 1][j + 1] + 1 else maxOf(l[i + 1][j], l[i][j + 1])
    val out = ArrayList<DictOp>()
    var i = 0
    var j = 0
    fun gap(ei: Int, tj: Int) {
        val es = e.subList(i, ei)
        val ts = t.subList(j, tj)
        es.forEachIndexed { k, w -> out.add(if (k < ts.size) DictOp(w, ts[k], DictStatus.Wrong) else DictOp(w, null, DictStatus.Missing)) }
        ts.drop(es.size).forEach { out.add(DictOp("", it, DictStatus.Extra)) }
    }
    while (i < e.size && j < t.size) {
        if (en[i] == tn[j]) { out.add(DictOp(e[i], t[j], DictStatus.Correct)); i++; j++; continue }
        var ni = i
        var nj = j
        while (ni < e.size && nj < t.size && en[ni] != tn[nj]) { if (l[ni + 1][nj] >= l[ni][nj + 1]) ni++ else nj++ }
        if (ni >= e.size || nj >= t.size) break
        gap(ni, nj)
        i = ni; j = nj
    }
    gap(e.size, t.size)
    return out
}

/** Words right out of the words that should have been heard (extras do not count). */
fun dictationScore(ops: List<DictOp>): Pair<Int, Int> = ops.count { it.status == DictStatus.Correct } to ops.count { it.status != DictStatus.Extra }
