package com.soyeb.ieltspractice.ui.screens.lr

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.withLink
import com.soyeb.ieltspractice.core.clock
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.LocalDemo
import com.soyeb.ieltspractice.core.DictStatus
import com.soyeb.ieltspractice.core.FlatQ
import com.soyeb.ieltspractice.core.LrGapEntry
import com.soyeb.ieltspractice.core.LrMark
import com.soyeb.ieltspractice.core.LrSection
import com.soyeb.ieltspractice.core.LrStats
import com.soyeb.ieltspractice.core.LrTfngPattern
import com.soyeb.ieltspractice.core.LrTfngRow
import com.soyeb.ieltspractice.core.LrVocab
import com.soyeb.ieltspractice.core.TFNG_RULES
import com.soyeb.ieltspractice.core.TextSpan
import com.soyeb.ieltspractice.core.audioWindow
import com.soyeb.ieltspractice.core.dictationDiff
import com.soyeb.ieltspractice.core.dictationScore
import com.soyeb.ieltspractice.core.timesText
import com.soyeb.ieltspractice.core.timingRows
import com.soyeb.ieltspractice.core.wordsBetween
import com.soyeb.ieltspractice.core.wrongNote
import com.soyeb.ieltspractice.ui.screens.shell.AppField
import com.soyeb.ieltspractice.ui.screens.shell.BandBar
import com.soyeb.ieltspractice.ui.screens.shell.LinkButton
import com.soyeb.ieltspractice.ui.screens.shell.ShellDate
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.Chip
import com.soyeb.ieltspractice.ui.theme.PrimaryButton
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.SectionTitle
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// Mirrors: web components/lr/ReviewPanels.tsx (question detail, dictation, TFNG panel, pacing, vocabulary) and the evidence marks of Passage.tsx.

/** A question's answer sits at offset [s] of paragraph [p]. */
data class QPin(val p: Int, val s: Int, val n: Int, val correct: Boolean)

/** Paragraph text with the evidence span marked (soft teal, underlined). When [scrollKey] changes it scrolls the marked line into view. */
@Composable
fun EvidenceText(text: String, span: TextSpan?, style: TextStyle, color: Color, scrollKey: Int, modifier: Modifier = Modifier, pins: List<QPin> = emptyList(), onPin: (Int) -> Unit = {}) {
    val e = MaterialTheme.ext
    val req = remember { BringIntoViewRequester() }
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    // a "Q7" pill (tappable link) sits right before each question's evidence; the evidence span shifts by the pills before it
    val (marked, mspan) = remember(text, span, pins, e) {
        val ps = pins.sortedBy { it.s }
        fun len(p: QPin) = "Q${p.n}".length + 2 // Q7 + mark + space
        fun shifted(o: Int, inclusive: Boolean) = o + ps.filter { if (inclusive) it.s <= o else it.s < o }.sumOf(::len)
        val out = buildAnnotatedString {
            var at = 0
            for (p in ps) {
                val s0 = p.s.coerceIn(at, text.length)
                append(text.substring(at, s0)); at = s0
                val c = if (p.correct) e.goodText else e.badText
                withLink(LinkAnnotation.Clickable("q${p.n}", TextLinkStyles(SpanStyle(color = c, fontWeight = FontWeight.Bold, background = (if (p.correct) e.good else e.bad).copy(alpha = 0.15f)))) { onPin(p.n) }) {
                    append("Q${p.n}${if (p.correct) "\u2713" else "\u2717"}")
                }
                append(" ")
            }
            append(text.substring(at))
            if (span != null) addStyle(
                SpanStyle(background = e.brandSoft, textDecoration = TextDecoration.Underline),
                shifted(span.s.coerceIn(0, text.length), true), shifted(span.e.coerceIn(0, text.length), false),
            )
        }
        out to span?.let { TextSpan(it.p, shifted(it.s.coerceIn(0, text.length), true), shifted(it.e.coerceIn(0, text.length), false)) }
    }
    if (mspan != null) LaunchedEffect(scrollKey, layout != null) {
        val l = layout
        if (l != null && scrollKey > 0) {
            delay(450)
            val n = marked.text.length
            val a = mspan.s.coerceIn(0, maxOf(0, n - 1))
            val b = (mspan.e - 1).coerceIn(a, maxOf(a, n - 1))
            runCatching { req.bringIntoView(Rect(0f, l.getLineTop(l.getLineForOffset(a)), l.size.width.toFloat(), l.getLineBottom(l.getLineForOffset(b)))) }
        }
    }
    Text(
        marked, modifier.bringIntoViewRequester(req).semantics { if (span != null && pins.isEmpty()) contentDescription = "$text. Where the answer is: ${text.substring(span.s.coerceIn(0, text.length), span.e.coerceIn(0, text.length))}" },
        style = style, color = color, onTextLayout = { layout = it },
    )
}

@Composable
private fun DetailBlock(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title.uppercase(), Modifier.semantics { heading() }, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.ext.muted)
        content()
    }
}

/** What went wrong and where to look, for the selected question. */
@Composable
fun QuestionDetail(
    f: FlatQ, section: LrSection, mark: LrMark?, entry: LrGapEntry?, onClose: () -> Unit, onPlay: () -> Unit, onDictate: () -> Unit, modifier: Modifier = Modifier,
) {
    val e = MaterialTheme.ext
    val q = f.q
    val r = q.review
    val listening = section.audio != null
    val timings = remember(section) { section.timingRows }
    val win = if (listening) remember(q, timings) { audioWindow(timings, q) } else null
    val canDictate = listening && timings.isNotEmpty() && win?.exact == true && mark != null && !mark.correct
    val wrong = if (mark != null && !mark.correct) wrongNote(q, mark.given) else null
    AppCard(modifier.semantics { contentDescription = "Question ${q.n} review" }) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Question ${q.n}", Modifier.semantics { heading() }, style = MaterialTheme.typography.titleLarge, color = e.ink)
                if (mark != null) Text(
                    if (mark.correct) "Correct" else "You wrote ${mark.given.ifEmpty { "nothing" }}, the answer is ${mark.answer.joinToString(" / ")}",
                    style = MaterialTheme.typography.bodyMedium, color = if (mark.correct) e.goodText else e.badText,
                )
            }
            LinkButton("Close", onClose)
        }
        if (entry != null) Column(
            Modifier.fillMaxWidth().background(e.warn.copy(alpha = 0.12f), RoundedCornerShape(10.dp)).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Chip(entry.label, color = e.warnText)
                if (entry.word != null && entry.typed != null) Text(
                    buildAnnotatedString {
                        withStyle(SpanStyle(color = e.badText, textDecoration = TextDecoration.LineThrough)) { append(entry.typed) }
                        append("  →  ")
                        withStyle(SpanStyle(color = e.goodText, fontWeight = FontWeight.SemiBold)) { append(entry.word) }
                    },
                    Modifier.semantics { contentDescription = "${entry.typed}, should be ${entry.word}" }, style = MaterialTheme.typography.bodyMedium.merge(AppText.num),
                )
            }
            Text(entry.message, style = MaterialTheme.typography.bodyMedium, color = e.ink)
            val before = entry.before ?: 0
            if (before > 0 && entry.kind == "spelling") Text("You've misspelt '${entry.word}' ${timesText(before)} before.", style = MaterialTheme.typography.bodyMedium, color = e.warnText, fontWeight = FontWeight.Medium)
            if (before > 0 && entry.kind == "plural") Text("You've slipped on the ending of '${entry.word}' ${timesText(before)} before.", style = MaterialTheme.typography.bodyMedium, color = e.warnText, fontWeight = FontWeight.Medium)
        }
        r?.why?.let { DetailBlock("Why") { Text(it, style = MaterialTheme.typography.bodyMedium, color = e.ink) } }
        if (wrong != null && mark != null) {
            val g = mark.given.uppercase()
            DetailBlock("Why ${if (g.length <= 3) g else "\"${mark.given}\""} is wrong") { Text(wrong, style = MaterialTheme.typography.bodyMedium, color = e.ink) }
        }
        if (!r?.paraphrase.isNullOrEmpty()) DetailBlock("Same idea, different words") {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                r!!.paraphrase!!.filter { it.size >= 2 }.forEach { (a, b) ->
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(a, Modifier.background(e.surface2, RoundedCornerShape(4.dp)).padding(horizontal = 6.dp, vertical = 2.dp), style = MaterialTheme.typography.bodyMedium, color = e.ink)
                        Text("=", Modifier.clearAndSetSemantics { contentDescription = "means" }, color = e.muted)
                        Text(b, Modifier.background(e.brandSoft, RoundedCornerShape(4.dp)).padding(horizontal = 6.dp, vertical = 2.dp), style = MaterialTheme.typography.bodyMedium, color = e.brand)
                    }
                }
            }
        }
        r?.evidence?.let { ev ->
            DetailBlock(if (listening) "In the recording" else "In the passage") {
                Row(Modifier.height(IntrinsicSize.Min)) {
                    Box(Modifier.width(2.dp).fillMaxHeight().background(e.brand))
                    Text(ev, Modifier.padding(start = 10.dp), style = AppText.readingSm, color = e.ink)
                }
            }
        }
        if (win != null) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SecondaryButton("Play from ${clock(win.from.toInt())}", onPlay)
                Text("Answer heard at ${clock(win.start.toInt())}${if (win.exact) "" else " (approx.)"}", Modifier.align(Alignment.CenterVertically), style = MaterialTheme.typography.bodySmall.merge(AppText.num), color = e.muted)
                if (canDictate) SecondaryButton("Dictation", onDictate)
            }
        }
        if (r == null && entry == null && win == null) Text("No extra notes for this question.", style = MaterialTheme.typography.bodySmall, color = e.muted)
    }
}

/** The word-by-word comparison: correct / wrong / missing / extra, each marked by text and shape as well as colour. */
@Composable
fun DictationResult(typed: String, expected: String) {
    val e = MaterialTheme.ext
    val ops = remember(typed, expected) { dictationDiff(typed, expected) }
    val (right, total) = dictationScore(ops)
    Column(Modifier.semantics { liveRegion = LiveRegionMode.Polite }, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("$right of $total ${if (total == 1) "word" else "words"} right", style = MaterialTheme.typography.titleMedium, color = e.ink)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            ops.forEach { o ->
                when (o.status) {
                    DictStatus.Correct -> Text(o.word, style = AppText.readingSm, color = e.goodText)
                    DictStatus.Wrong -> Text(
                        buildAnnotatedString {
                            withStyle(SpanStyle(color = e.badText, textDecoration = TextDecoration.LineThrough)) { append(o.typed.orEmpty()) }
                            append(" ")
                            withStyle(SpanStyle(color = e.goodText, fontWeight = FontWeight.SemiBold)) { append(o.word) }
                        },
                        Modifier.background(e.bad.copy(alpha = 0.12f), RoundedCornerShape(4.dp)).padding(horizontal = 4.dp).semantics { contentDescription = "${o.typed}, wrong, should be ${o.word}" },
                        style = AppText.readingSm,
                    )
                    DictStatus.Missing -> Text(
                        o.word, Modifier.border(1.dp, e.bad, RoundedCornerShape(4.dp)).padding(horizontal = 4.dp).semantics { contentDescription = "${o.word}, missing" },
                        style = AppText.readingSm, color = e.badText,
                    )
                    DictStatus.Extra -> Text(
                        o.typed.orEmpty(), Modifier.background(e.surface2, RoundedCornerShape(4.dp)).padding(horizontal = 4.dp).semantics { contentDescription = "${o.typed}, extra word" },
                        style = AppText.readingSm.copy(textDecoration = TextDecoration.LineThrough), color = e.muted,
                    )
                }
            }
        }
        Text("Boxed = you missed it, struck through = not in the recording.", style = MaterialTheme.typography.bodySmall, color = e.muted)
    }
}

/** Plays the evidence segment and lets you type what you hear. Needs word timings. */
@Composable
fun DictationSheet(src: String, section: LrSection, f: FlatQ, initialTyped: String, onClose: () -> Unit) {
    val e = MaterialTheme.ext
    val context = LocalContext.current
    val demo = LocalDemo.current != null
    val timings = remember(section) { section.timingRows }
    val win = remember(f) { audioWindow(timings, f.q) } ?: return
    val player = remember(src) { LrPlayer(demo) }
    LaunchedEffect(player) { if (src.isNotEmpty()) { player.load(context, src); player.poll() } }
    androidx.compose.runtime.DisposableEffect(player) { onDispose { player.release() } }
    var typed by remember { mutableStateOf(initialTyped) }
    var checked by remember { mutableStateOf(initialTyped.isNotBlank()) }
    var slow by remember { mutableStateOf(false) }
    val expected = remember(win) { wordsBetween(timings, win.start, win.end) }
    LrSheet(onClose) {
        Text("Dictation", Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineSmall, color = e.ink)
        Text("Question ${f.n}. Play the sentence with the answer in it, as many times as you like, and type what you hear.", style = MaterialTheme.typography.bodyMedium, color = e.muted)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            PrimaryButton("Play sentence", { player.changeSpeed(if (slow) 0.75f else 1f); player.playWindow(maxOf(0.0, win.start - 0.3), win.end + 0.4) })
            SecondaryButton(if (slow) "Slow 0.75×: on" else "Slow (0.75×)", { slow = !slow; player.changeSpeed(if (slow) 0.75f else 1f) }, Modifier.semantics { contentDescription = "Slow, 0.75 times speed, ${if (slow) "on" else "off"}" })
        }
        AppField(typed, { typed = it; checked = false }, "What do you hear?", singleLine = false)
        PrimaryButton("Check", { checked = true }, Modifier.fillMaxWidth(), enabled = typed.isNotBlank())
        if (checked) DictationResult(typed, expected)
    }
}

/** Confusion table (the answer vs what you chose) per statement type, the fixed rules, and your pattern across attempts. */
@Composable
fun TfngPanel(rows: List<LrTfngRow>, pattern: LrTfngPattern?) {
    val e = MaterialTheme.ext
    val kinds = listOf("tfng", "ynng").filter { k -> rows.any { it.kind == k } }
    if (kinds.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionTitle("True / False / Not Given")
        if (pattern != null && pattern.text.isNotEmpty()) Text(
            "${pattern.text} Across all your attempts.", Modifier.fillMaxWidth().background(e.warn.copy(alpha = 0.12f), RoundedCornerShape(10.dp)).padding(12.dp),
            style = MaterialTheme.typography.bodyMedium, color = e.warnText, fontWeight = FontWeight.Medium,
        )
        kinds.forEach { k ->
            val rules = TFNG_RULES.getValue(k)
            val vals = rules.map { it.value }
            val mine = rows.filter { it.kind == k }
            AppCard {
                Text(
                    "${if (k == "tfng") "True / False / Not Given" else "Yes / No / Not Given"}: the answer (rows) against what you chose (columns)",
                    style = MaterialTheme.typography.bodySmall, color = e.muted,
                )
                Row(Modifier.fillMaxWidth()) {
                    Text("Answer", Modifier.weight(1.25f), style = MaterialTheme.typography.labelMedium, color = e.muted)
                    vals.forEach { Text(it.replace("NOT GIVEN", "NOT\nGIVEN"), Modifier.weight(1f).semantics { contentDescription = "You chose $it" }, style = MaterialTheme.typography.labelSmall, color = e.muted, textAlign = TextAlign.Center) }
                }
                vals.forEach { a ->
                    HorizontalDivider(color = e.line)
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(a, Modifier.weight(1.25f), style = MaterialTheme.typography.labelLarge, color = e.ink)
                        vals.forEach { c ->
                            val n = mine.count { it.answer == a && it.chose == c }
                            val right = a == c
                            Text(
                                if (n > 0) "$n" else "·",
                                Modifier.weight(1f).then(if (n > 0 && !right) Modifier.background(e.bad.copy(alpha = 0.12f), RoundedCornerShape(6.dp)) else Modifier).padding(vertical = 8.dp)
                                    .semantics { contentDescription = "Answer $a, you chose $c: $n${if (n > 0 && !right) " wrong" else ""}" },
                                style = MaterialTheme.typography.titleSmall.merge(AppText.num), textAlign = TextAlign.Center,
                                color = if (right) (if (n > 0) e.goodText else e.muted) else if (n > 0) e.badText else e.muted,
                            )
                        }
                    }
                }
            }
            AppCard {
                rules.forEach { r ->
                    Column(Modifier.padding(vertical = 4.dp).semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(r.value, style = MaterialTheme.typography.titleSmall, color = e.ink)
                        Text(r.rule, style = MaterialTheme.typography.bodySmall, color = e.muted)
                    }
                }
            }
        }
    }
}

/** Time per part against an even split, answer changes, last-minute answers and blanks. Reading is 60 minutes. */
@Composable
fun PacingPanel(stats: LrStats, parts: List<Pair<Int, List<Int>>>, noun: String, totalS: Double?, marks: Map<Int, LrMark>, blank: List<Int>) {
    val e = MaterialTheme.ext
    val times = parts.map { it.first to (stats.partS[it.first.toString()] ?: 0.0) }
    val spent = times.sumOf { it.second }
    if (spent < 5 && stats.changes.isEmpty()) return
    val split = totalS?.let { it / parts.size }
    val max = maxOf(1.0, split ?: 0.0, times.maxOfOrNull { it.second } ?: 0.0)
    val changed = stats.changes.filterValues { it > 0 }.map { it.key.toInt() to it.value }.sortedWith(compareByDescending<Pair<Int, Int>> { it.second }.thenBy { it.first })
    val lateWrong = stats.late.filter { marks[it]?.correct == false }
    fun list(ns: List<Int>) = ns.sorted().joinToString(", ")
    fun dur(s: Double) = ShellDate.duration((s * 1000).toInt())
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionTitle("Pacing")
        AppCard {
            Text("Time per ${noun.lowercase()}${split?.let { ", against ${dur(it)} each" }.orEmpty()}", style = MaterialTheme.typography.bodySmall, color = e.muted)
            times.forEach { (part, s) ->
                val over = split != null && s > split * 1.15
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Row(Modifier.fillMaxWidth()) {
                        Text("$noun $part", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = e.ink)
                        Text(dur(s) + if (over) " (over)" else "", style = MaterialTheme.typography.bodyMedium.merge(AppText.num), color = if (over) e.warnText else e.muted, fontWeight = if (over) FontWeight.SemiBold else FontWeight.Normal)
                    }
                    BandBar(s / max, "$noun $part: ${dur(s)}${if (over) ", over the suggested time" else ""}", fill = if (over) e.warn else e.brand, marker = split?.let { it / max }, height = 8.dp)
                }
            }
            if (split != null) Text("The marker is an even split of the 60 minutes.", style = MaterialTheme.typography.bodySmall, color = e.muted)
        }
        AppCard {
            Fact("Answers you changed") {
                if (changed.isNotEmpty()) {
                    Text(buildAnnotatedString {
                        withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append("${changed.sumOf { it.second }}") }
                        append(" changes across ${changed.size} ${if (changed.size == 1) "question" else "questions"}")
                    }, style = MaterialTheme.typography.bodyMedium, color = e.ink)
                    Text("Most: " + changed.take(5).joinToString(", ") { "Q${it.first} (${it.second}×)" }, style = MaterialTheme.typography.bodySmall, color = e.muted)
                } else Text("None. You stuck with your first answers.", style = MaterialTheme.typography.bodyMedium, color = e.ink)
            }
            HorizontalDivider(color = e.line)
            Fact("Answered in the last 5 minutes") {
                if (stats.late.isNotEmpty()) {
                    Text("${stats.late.size} ${if (stats.late.size == 1) "question" else "questions"}: ${list(stats.late)}", style = MaterialTheme.typography.bodyMedium, color = e.ink)
                    if (lateWrong.isNotEmpty()) Text("${lateWrong.size} of them wrong (${list(lateWrong)}). Rushed guesses cost marks.", style = MaterialTheme.typography.bodySmall, color = e.warnText)
                } else Text("None.", style = MaterialTheme.typography.bodyMedium, color = e.ink)
            }
            HorizontalDivider(color = e.line)
            Fact("Left blank") {
                Text(if (blank.isNotEmpty()) "${blank.size}: ${list(blank)}. There is no penalty for guessing." else "None.", style = MaterialTheme.typography.bodyMedium, color = e.ink)
            }
        }
    }
}

@Composable
private fun Fact(label: String, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp).semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.ext.muted)
        content()
    }
}

/** Key words of a part, each with an explicit "Add to review". Guests have no deck, so they only read. */
@Composable
fun VocabList(vocab: List<LrVocab>) {
    if (vocab.isEmpty()) return
    val e = MaterialTheme.ext
    val api = LocalApp.current.api
    val account by api.hasAccount.collectAsState()
    val scope = rememberCoroutineScope()
    var added by remember { mutableStateOf(setOf<String>()) }
    var busy by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    AppCard(padding = 0.dp) {
        Text("Key vocabulary", Modifier.padding(16.dp).semantics { heading() }, style = MaterialTheme.typography.titleMedium, color = e.ink)
        vocab.forEach { v ->
            HorizontalDivider(color = e.line)
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(v.word, style = MaterialTheme.typography.titleSmall, color = e.ink)
                    Text(v.meaning, style = MaterialTheme.typography.bodyMedium, color = e.ink)
                    v.example?.let { Text(it, style = AppText.readingSm, color = e.muted, fontStyle = FontStyle.Italic) }
                }
                if (account) {
                    val done = v.word in added
                    SecondaryButton(
                        if (done) "In review" else "Add to review", {
                            busy = v.word; error = null
                            scope.launch {
                                try {
                                    api.addCard(v.word, if (v.example != null) "${v.meaning}\n\n${v.example}" else v.meaning, "vocab")
                                    added = added + v.word
                                } catch (ex: Exception) { error = (ex as? com.soyeb.ieltspractice.core.ApiError)?.message ?: "Couldn't add the card. Try again." }
                                busy = null
                            }
                        },
                        Modifier.semantics { contentDescription = if (done) "${v.word} is in your review deck" else "Add ${v.word} to review" }, enabled = !done && busy != v.word,
                    )
                }
            }
        }
        error?.let { Text(it, Modifier.padding(16.dp), style = MaterialTheme.typography.bodySmall, color = e.badText) }
    }
}
