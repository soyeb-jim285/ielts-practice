package com.soyeb.ieltspractice.ui.screens.result

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.core.AnalysisError
import com.soyeb.ieltspractice.core.AnalysisResult
import com.soyeb.ieltspractice.core.TextMetrics
import com.soyeb.ieltspractice.core.VocabUpgrade
import com.soyeb.ieltspractice.core.WritingStructure
import com.soyeb.ieltspractice.core.answeredRelevance
import com.soyeb.ieltspractice.core.categoryLabel
import com.soyeb.ieltspractice.core.fmt
import com.soyeb.ieltspractice.core.mtld
import com.soyeb.ieltspractice.core.questionHead
import com.soyeb.ieltspractice.core.Repeated
import com.soyeb.ieltspractice.core.formMatcher
import com.soyeb.ieltspractice.core.repeatedWords
import com.soyeb.ieltspractice.core.tokenize
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.Chip
import com.soyeb.ieltspractice.ui.theme.SectionTitle
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.delay
import kotlin.math.max
import kotlin.math.roundToInt

// Language tab (speaking and writing), Essay and Structure tabs (writing). iOS ResultView.swift: LanguageView, EssayView, StructureView.

private fun groups(r: AnalysisResult): List<Pair<String, List<AnalysisError>>> =
    r.errors.groupBy { it.category }.toList().sortedWith(compareByDescending<Pair<String, List<AnalysisError>>> { it.second.size }.thenBy { it.first })

/** Upgrades whose suggestions differ from the original. */
private fun upgrades(r: AnalysisResult): List<VocabUpgrade> = r.vocabUpgrades.orEmpty().mapNotNull { v ->
    val better = v.better.filter { it.trim().lowercase() != v.original.trim().lowercase() }
    if (better.isEmpty()) null else VocabUpgrade(v.original, better, v.note)
}

private fun playAction(player: ResultPlayer, e: AnalysisError): (() -> Unit)? {
    val t = e.time ?: return null
    return if (player.isLoaded) ({ player.seek(max(0.0, t - 0.3)) }) else null
}

@Composable
fun LanguagePanel(
    result: AnalysisResult, player: ResultPlayer, scrollToRelevance: Boolean = false, onScrolled: () -> Unit = {},
    lean: Repeated? = null, onLean: (Repeated?) -> Unit = {},
) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (result.skill == "speaking") SpeakingLanguage(result, player, scrollToRelevance, onScrolled, lean, onLean) else WritingLanguage(result, lean, onLean)
    }
}

// MARK: Speaking

@Composable
private fun SpeakingLanguage(r: AnalysisResult, player: ResultPlayer, scrollToRelevance: Boolean, onScrolled: () -> Unit, lean: Repeated?, onLean: (Repeated?) -> Unit) {
    val e = MaterialTheme.ext
    val groups = groups(r)
    SectionTitle("Mistakes by type")
    if (groups.isEmpty()) {
        AppCard { Text("No grammar or vocabulary mistakes were flagged in this answer.", style = MaterialTheme.typography.bodyMedium, color = e.muted) }
    } else {
        val maxCount = max(groups.first().second.size, 5)
        RowsCard {
            groups.forEachIndexed { i, g ->
                if (i > 0) RowDivider()
                ErrorGroup(g.first, g.second, maxCount, player)
            }
        }
    }
    val ups = upgrades(r)
    if (ups.isNotEmpty()) { SectionTitle("Vocabulary upgrades"); ups.forEach { VocabRow(it) } }
    SpeakingLexical(r, lean, onLean)
    Relevance(r, scrollToRelevance, onScrolled)
    Pronunciation(r, player)
}

/** One mistake category: name, count bar, and its mistakes behind a disclosure (web Collapsible row). */
@Composable
private fun ErrorGroup(category: String, errors: List<AnalysisError>, maxCount: Int, player: ResultPlayer) {
    val e = MaterialTheme.ext
    var open by remember { mutableStateOf(false) }
    Column {
        Column(
            Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(role = Role.Button) { open = !open }
                .semantics { stateDescription = if (open) "Expanded" else "Collapsed" }
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(categoryLabel(category), Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, color = e.ink)
                Text("${errors.size}", style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = "tnum"), color = e.ink)
                Icon(if (open) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown, null, Modifier.size(18.dp), tint = e.muted)
            }
            ResMeter(errors.size.toFloat() / max(maxCount, 1))
        }
        if (open) Column(Modifier.fillMaxWidth().background(e.surface2)) {
            errors.forEachIndexed { i, err ->
                if (i > 0) RowDivider()
                Column(Modifier.padding(16.dp)) { ErrorDetails(err, playAction(player, err), hideCategory = true) }
            }
        }
    }
}

/** Lexical range and the words leaned on, from the transcript. */
@Composable
private fun SpeakingLexical(r: AnalysisResult, lean: Repeated?, onLean: (Repeated?) -> Unit) {
    val e = MaterialTheme.ext
    val tokens = remember(r) { tokenize(r.words.orEmpty().joinToString(" ") { it.w }) }
    val m = mtld(tokens)
    val (tone, word) = if (m >= 70) e.goodText to "Wide range" else if (m >= 50) e.warnText to "Adequate range" else e.badText to "Limited range"
    val repeated = repeatedWords(tokens)
    AppCard {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Lexical diversity", style = MaterialTheme.typography.titleMedium, color = e.ink)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("${m.roundToInt()}", style = AppText.band(34), color = e.ink)
                Text("MTLD", style = MaterialTheme.typography.bodyMedium, color = e.muted)
                Chip(word, color = tone)
            }
            if (tokens.size < 50 || word != "Wide range") {
                Text(
                    if (tokens.size < 50) "Short answer, so treat this number as rough." else "Try synonyms and more precise words for repeated ideas.",
                    style = MaterialTheme.typography.bodySmall, color = e.muted,
                )
            }
            Text(
                "MTLD: how long you keep using new words before repeating yourself. Higher means a wider range. Around 70+ is typical of band 7 speech.",
                style = MaterialTheme.typography.bodySmall, color = e.muted,
            )
        }
        RowDivider()
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Words you leaned on", style = MaterialTheme.typography.titleMedium, color = e.ink)
            if (repeated.isEmpty()) Text("No content word stood out as overused.", style = MaterialTheme.typography.bodySmall, color = e.muted)
            else LeanChips(repeated, "Select a word to highlight every use in your transcript.", lean, onLean)
        }
    }
}

@Composable
private fun LeanChips(rows: List<Repeated>, hint: String, lean: Repeated?, onLean: (Repeated?) -> Unit) {
    Text(hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.ext.muted)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        rows.forEach { r -> LeanChip(r, lean?.word == r.word) { onLean(if (lean?.word == r.word) null else r) } }
    }
}

@Composable
private fun Relevance(r: AnalysisResult, scrollTo: Boolean, onScrolled: () -> Unit) {
    val e = MaterialTheme.ext
    val rel = answeredRelevance(r)
    if (rel.isEmpty()) return
    val requester = remember { BringIntoViewRequester() }
    LaunchedEffect(scrollTo) {
        if (scrollTo) { delay(150); requester.bringIntoView(); onScrolled() }
    }
    SectionTitle("Did you answer the question?", Modifier.bringIntoViewRequester(requester))
    RowsCard {
        rel.forEachIndexed { i, x ->
            if (i > 0) RowDivider()
            val text = r.questions?.getOrNull(x.questionIdx)?.text ?: "Question ${x.questionIdx + 1}"
            val (head, rest) = questionHead(text)
            Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(
                    if (x.onTopic) Icons.Filled.CheckCircle else Icons.Filled.Warning, if (x.onTopic) "On topic" else "Off topic",
                    Modifier.size(22.dp), tint = if (x.onTopic) e.goodText else e.warnText,
                )
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(head, style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Medium), color = e.ink)
                    if (rest.isNotEmpty()) Text(rest, style = MaterialTheme.typography.bodySmall, color = e.muted)
                    if (x.note.isNotEmpty()) Text(x.note, style = MaterialTheme.typography.bodySmall, color = e.muted)
                }
            }
        }
    }
}

private val issues = mapOf("sound" to "Sound", "stress" to "Word stress", "intonation" to "Intonation", "unclear" to "Unclear")

/** The web's short labels, else the model's sentence in sentence case without its trailing period. */
private fun issueLabel(raw: String): String {
    issues[raw.lowercase()]?.let { return it }
    val t = raw.trim().trimEnd('.')
    return t.take(1).uppercase() + t.drop(1).lowercase()
}

@Composable
private fun PlayWordButton(word: String, onClick: () -> Unit) {
    Box(
        Modifier.size(48.dp).clickable(role = Role.Button, onClick = onClick).semantics { contentDescription = "Play $word" },
        contentAlignment = Alignment.Center,
    ) { Icon(Icons.Filled.PlayArrow, null, Modifier.size(22.dp), tint = MaterialTheme.ext.brand) }
}

@Composable
private fun Pronunciation(r: AnalysisResult, player: ResultPlayer) {
    val e = MaterialTheme.ext
    val words = r.words.orEmpty()
    val unclear = r.pronunciation?.unclear.orEmpty()
    val llm = r.pronunciation?.llm
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        SectionTitle(if (llm == null) "Speech clarity hints" else "Pronunciation")
        Text("Low recognition confidence does not prove a pronunciation mistake. Percentages may be approximated from a whole segment; listen again to check.", style = MaterialTheme.typography.bodySmall, color = e.muted)
    }
    RowsCard {
        if (unclear.isEmpty() && llm == null) {
            Text(if (words.any { it.conf != null }) "No low-confidence words were flagged. This does not confirm correct pronunciation." else "The recogniser did not return confidence scores. Pronunciation cannot be checked from the transcript alone.", Modifier.padding(16.dp), style = MaterialTheme.typography.bodyMedium, color = e.muted)
        }
        unclear.forEachIndexed { i, u ->
            if (i > 0) RowDivider()
            Row(Modifier.fillMaxWidth().padding(end = 16.dp, start = if (player.isLoaded) 0.dp else 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (player.isLoaded && u.wordIdx in words.indices) PlayWordButton(u.w) { player.seek(max(0.0, words[u.wordIdx].start - 0.3)) }
                Text(u.w, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Medium), color = e.ink)
                Chip(if (u.tier >= 3) "Low confidence" else "Lower confidence", color = e.warnText)
                Text("${(u.conf * 100).roundToInt()}%", Modifier.width(36.dp), style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum"), color = e.muted, textAlign = androidx.compose.ui.text.style.TextAlign.End)
            }
        }
        if (llm != null) {
            llm.words.forEachIndexed { i, w ->
                if (i > 0 || unclear.isNotEmpty()) RowDivider()
                Row(Modifier.fillMaxWidth().padding(end = 16.dp, start = if (player.isLoaded) 0.dp else 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (player.isLoaded) PlayWordButton(w.word) { player.seek(max(0.0, w.time - 0.3)) }
                    Column(Modifier.padding(vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(w.word, style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Medium), color = e.ink)
                            Chip(issueLabel(w.issue))
                        }
                        Text(w.tip, style = MaterialTheme.typography.bodySmall, color = e.muted)
                    }
                }
            }
            if (llm.prosody.isNotEmpty()) {
                RowDivider()
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Rhythm and intonation", style = MaterialTheme.typography.titleSmall, color = e.ink)
                    Text(llm.prosody, style = MaterialTheme.typography.bodySmall, color = e.muted)
                }
            }
        }
    }
}

// MARK: Writing

@Composable
private fun WritingLanguage(r: AnalysisResult, lean: Repeated?, onLean: (Repeated?) -> Unit) {
    val e = MaterialTheme.ext
    r.textMetrics?.let { Glance(it) }
    val groups = groups(r)
    if (groups.isNotEmpty()) {
        SectionTitle("Mistakes by type")
        val maxCount = max(3, groups.first().second.size)
        AppCard {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                groups.forEach { g ->
                    Column(Modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row { Text(categoryLabel(g.first), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = e.ink); Text("${g.second.size}", style = MaterialTheme.typography.titleSmall.copy(fontFeatureSettings = "tnum"), color = e.ink) }
                        ResMeter(max(0.04f, g.second.size.toFloat() / maxCount))
                    }
                }
            }
        }
    }
    r.textMetrics?.takeIf { it.linkers.isNotEmpty() }?.let { Linking(it) }
    r.textMetrics?.takeIf { it.repeated.isNotEmpty() }?.let { m ->
        SectionTitle("Repeated words")
        LeanChips(m.repeated, "Select a word to highlight every use in your essay.", lean, onLean)
    }
    val ups = upgrades(r)
    if (ups.isNotEmpty()) { SectionTitle("Vocabulary upgrades"); ups.forEach { VocabRow(it) } }
}

@Composable
private fun Glance(m: TextMetrics) {
    val e = MaterialTheme.ext
    val (tone, word) = if (m.mtld >= 80) e.goodText to "Wide range" else if (m.mtld >= 55) e.warnText to "Adequate range" else e.badText to "Limited range"
    val cells = listOf(
        Triple("Words", "${m.words}", null),
        Triple("Paragraphs", "${m.paragraphs}", null),
        Triple("Sentences", "${m.sentences}", null),
        Triple("Avg sentence", "${fmt(m.avgSentenceLen)} words", "Band 7+ essays usually mix short and long sentences, averaging roughly 15–25 words."),
        Triple("Unique-word ratio", "${(m.ttr * 100).roundToInt()}%", "Type–token ratio. It naturally falls as essays get longer, so compare like with like."),
    )
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionTitle("At a glance")
        RowsCard {
            cells.chunked(2).forEachIndexed { i, pair ->
                if (i > 0) RowDivider()
                Row(Modifier.height(IntrinsicSize.Min)) {
                    GlanceCell(pair[0], Modifier.weight(1f))
                    Box(Modifier.width(1.dp).fillMaxHeight().background(e.line))
                    if (pair.size > 1) GlanceCell(pair[1], Modifier.weight(1f)) else Box(Modifier.weight(1f))
                }
            }
            RowDivider()
            Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Lexical diversity", style = MaterialTheme.typography.bodySmall, color = e.muted)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("MTLD ${m.mtld.roundToInt()}", style = AppText.band(20), color = e.ink)
                    Chip(word, color = tone)
                }
                Text(
                    "MTLD: how long you keep using new words before repeating yourself. Higher is more varied. Ranges here are rough guides, not band cut-offs.",
                    style = MaterialTheme.typography.bodySmall, color = e.muted,
                )
            }
        }
    }
}

@Composable
private fun GlanceCell(c: Triple<String, String, String?>, modifier: Modifier) {
    var show by remember { mutableStateOf(false) }
    Column(modifier.padding(start = 14.dp, end = 6.dp, top = if (c.third != null) 6.dp else 14.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        if (c.third != null) InfoLabel(c.first, show) { show = !show } else Text(c.first, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.ext.muted)
        Text(c.second, style = AppText.band(20), color = MaterialTheme.ext.ink)
        if (show && c.third != null) Text(c.third!!, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.ext.muted, modifier = Modifier.padding(end = 8.dp))
    }
}

@Composable
private fun Linking(m: TextMetrics) {
    val e = MaterialTheme.ext
    val linkers = m.linkers.sortedByDescending { it.count }
    val maxCount = max(3, linkers.first().count)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionTitle("Linking words")
        Text(
            "Examiners penalise mechanical linking. Overused ones are flagged; swap some for referencing (“this trend”, “such policies”).",
            style = MaterialTheme.typography.bodySmall, color = e.muted,
        )
        AppCard {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                linkers.forEach { l ->
                    val over = l.overused && l.count >= 2
                    Column(Modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(l.word, style = MaterialTheme.typography.bodyMedium, color = e.ink)
                            if (over) Chip("Overused", color = e.warnText)
                            Box(Modifier.weight(1f))
                            Text("${l.count}", style = MaterialTheme.typography.titleSmall.copy(fontFeatureSettings = "tnum"), color = e.ink)
                        }
                        ResMeter(max(0.04f, l.count.toFloat() / maxCount), color = if (over) e.warn else e.brand)
                    }
                }
            }
        }
    }
}

// MARK: Essay

/** Essay with inline error highlights (char spans are UTF-16 offsets, matching JS string indices). */
@Composable
fun EssayPanel(result: AnalysisResult, text: String, lean: Repeated? = null, onSelect: (AnalysisError) -> Unit) {
    val e = MaterialTheme.ext
    var filter by remember { mutableStateOf<String?>(null) }
    fun group(x: AnalysisError) = x.category.substringBefore('.')
    val gs = result.errors.groupBy(::group).toList().sortedWith(compareByDescending<Pair<String, List<AnalysisError>>> { it.second.size }.thenBy { it.first })
    val visible = if (filter == null) result.errors else result.errors.filter { group(it) == filter }
    fun located(x: AnalysisError) = x.start >= 0 && x.end > x.start && x.end <= text.length
    val tint = leanTint()
    val body = remember(text, visible, e.isDark, lean) {
        AnnotatedString.Builder(text).apply {
            for (x in visible.filter(::located)) {
                val c = if (x.severity == "major") e.bad else e.warn
                addStyle(SpanStyle(background = c.copy(alpha = 0.16f), textDecoration = TextDecoration.Underline), x.start, x.end)
                addLink(LinkAnnotation.Clickable("err-${x.id}", TextLinkStyles(SpanStyle(color = e.ink))) { onSelect(x) }, x.start, x.end)
            }
            // Every use of the leaned-on word, drawn over the error tint (the error underline stays).
            if (lean != null) {
                val match = formMatcher(lean)
                for (m in Regex("[A-Za-z]+(?:'[A-Za-z]+)?").findAll(text)) if (match(m.value)) addStyle(SpanStyle(background = tint), m.range.first, m.range.last + 1)
            }
        }.toAnnotatedString()
    }
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (result.errors.isNotEmpty()) ChipScroller {
            ResFilterChip("All", filter == null, { filter = null }, count = result.errors.size)
            gs.forEach { (name, list) -> ResFilterChip(categoryLabel(name), filter == name, { filter = if (filter == name) null else name }, count = list.size) }
        }
        AppCard { SelectionContainer { Text(body, style = AppText.reading, color = e.ink) } }
        if (result.errors.isNotEmpty()) {
            Text("Underlined text has a mistake: red for major, amber for minor. Tap it to see why.", style = MaterialTheme.typography.bodySmall, color = e.muted)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SectionTitle("Mistakes", Modifier.weight(1f, fill = false))
                Text("${visible.size}", style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = "tnum"), color = e.muted)
            }
            if (visible.isEmpty()) Text("No mistakes in this category.", style = MaterialTheme.typography.bodySmall, color = e.muted)
            else RowsCard {
                visible.forEachIndexed { i, x ->
                    if (i > 0) RowDivider()
                    ErrorRow(x, { onSelect(x) }, located(x))
                }
            }
        }
    }
}

// MARK: Structure

private val roles = mapOf(
    "intro" to "Introduction", "overview" to "Overview", "body" to "Body", "conclusion" to "Conclusion",
    "greeting" to "Greeting", "closing" to "Closing", "other" to "Other",
)

@Composable
fun StructurePanel(s: WritingStructure) {
    val e = MaterialTheme.ext
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (s.overview != null || s.position != null || s.planFollowed != null) {
            SectionTitle("Checks")
            RowsCard {
                s.overview?.let { o ->
                    CheckRow("Overview", listOf("Overview present" to o.present, "States the main trends" to o.mainTrends, "No detailed figures in it" to o.noData), o.note)
                }
                s.position?.let { p ->
                    if (s.overview != null) RowDivider()
                    CheckRow("Position", listOf("Clear position" to p.clear, "Consistent throughout" to p.consistent), p.note)
                }
                s.planFollowed?.let { p ->
                    if (s.overview != null || s.position != null) RowDivider()
                    CheckRow("Your plan", listOf("Essay followed the plan" to p.followed), p.note)
                }
            }
        }
        SectionTitle("Paragraph map")
        if (s.paragraphs.isEmpty()) {
            Text("No paragraphs were detected. Separate paragraphs with a blank line.", style = MaterialTheme.typography.bodySmall, color = e.muted)
        } else RowsCard {
            s.paragraphs.forEachIndexed { i, p ->
                if (i > 0) RowDivider()
                Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.size(32.dp).background(e.surface2, androidx.compose.foundation.shape.RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
                        Text("${i + 1}", style = MaterialTheme.typography.titleSmall.copy(fontFeatureSettings = "tnum"), color = e.ink)
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("Paragraph ${i + 1}: ${roles[p.role] ?: p.role.replaceFirstChar { it.uppercase() }}", Modifier.weight(1f, fill = false), style = MaterialTheme.typography.titleSmall, color = e.ink)
                            StatusLabel(p.ok, "Works", "Needs work")
                        }
                        if (p.topicSentence.isNotEmpty()) Text("“${p.topicSentence}”", style = serifBody, color = e.ink)
                        if (p.note.isNotEmpty()) Text(p.note, style = MaterialTheme.typography.bodySmall, color = e.muted)
                    }
                }
            }
        }
    }
}

@Composable
private fun StatusLabel(ok: Boolean, yes: String, no: String) {
    val e = MaterialTheme.ext
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Icon(if (ok) Icons.Filled.CheckCircle else Icons.Filled.Warning, null, Modifier.size(14.dp), tint = if (ok) e.goodText else e.warnText)
        Text(if (ok) yes else no, style = MaterialTheme.typography.bodySmall, color = if (ok) e.goodText else e.warnText)
    }
}

@Composable
private fun CheckRow(title: String, checks: List<Pair<String, Boolean>>, note: String) {
    val e = MaterialTheme.ext
    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.titleSmall, color = e.ink)
        checks.forEach { (label, ok) ->
            Row(
                Modifier.semantics(mergeDescendants = true) { contentDescription = "$label: ${if (ok) "yes" else "no"}" },
                horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(if (ok) Icons.Filled.CheckCircle else Icons.Filled.Close, null, Modifier.size(18.dp), tint = if (ok) e.goodText else e.badText)
                Text(label, style = MaterialTheme.typography.bodyMedium, color = if (ok) e.goodText else e.badText)
            }
        }
        if (note.isNotEmpty()) Text(note, style = MaterialTheme.typography.bodySmall, color = e.muted)
    }
}
