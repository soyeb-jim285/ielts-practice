package com.soyeb.ieltspractice.ui.screens.result

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.soyeb.ieltspractice.core.AnalysisError
import com.soyeb.ieltspractice.core.AnalysisResult
import com.soyeb.ieltspractice.core.DisfluencyKinds
import com.soyeb.ieltspractice.core.MarkerType
import com.soyeb.ieltspractice.core.Pause
import com.soyeb.ieltspractice.core.Timeline
import com.soyeb.ieltspractice.core.Word
import com.soyeb.ieltspractice.core.categoryLabel
import com.soyeb.ieltspractice.core.isLongPause
import com.soyeb.ieltspractice.core.pauseSec
import com.soyeb.ieltspractice.core.questionHead
import com.soyeb.ieltspractice.core.wordIndexAt
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.SectionTitle
import com.soyeb.ieltspractice.ui.theme.ext
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

// Interactive transcript (iOS TranscriptView.swift, web components/speaking/Transcript.tsx): filter chips with counts, tap a word to hear
// it, tap an underlined error for its explanation, typed tags for fillers/repeats/restarts, pause chips, and "Also noted".

private enum class TrFilter(val label: String, val type: MarkerType?) {
    All("All", null), Grammar("Grammar", MarkerType.Grammar), Vocab("Vocabulary", MarkerType.Vocabulary),
    Pronunciation("Pronunciation", MarkerType.Pronunciation), Fluency("Fluency", MarkerType.Fluency), Other("Task & other", null), Pauses("Pauses", null),
}

/** Transcript filter for an error: its timeline type, else "other" (task, cohesion). */
private fun group(e: AnalysisError): TrFilter = when (MarkerType.of(e.category)) {
    MarkerType.Grammar -> TrFilter.Grammar
    MarkerType.Vocabulary -> TrFilter.Vocab
    MarkerType.Pronunciation -> TrFilter.Pronunciation
    MarkerType.Fluency -> TrFilter.Fluency
    null -> TrFilter.Other
}

/** A task or relevance note on a whole stretch (8+ words): drawn as a sentence tint, only when its filter is on. */
private fun isSentenceNote(e: AnalysisError) = group(e) == TrFilter.Other && e.end - e.start >= 7

/** A typed tag before the word where a repeat, repair, false start, cut-off or held sound happens. */
private class TrMark(val short: String, val detail: String, val time: Double)

private class TrToken(val id: Int, val word: Word) {
    val errors = mutableListOf<AnalysisError>()
    var unclearTier: Int? = null
    var filler = false
    var pauseAfter: Pause? = null
    val marks = mutableListOf<TrMark>()
}

private class TrSection(val id: Int, val n: Int?, val head: String, val rest: String, val range: IntRange)

/** Everything derived from the analysis, built once per result (the playback clock must not rebuild it). */
private class TrModel(r: AnalysisResult, timeline: Timeline) {
    val words: List<Word> = r.words.orEmpty()
    val tokens = words.mapIndexed { i, w -> TrToken(i, w) }
    val sections: List<TrSection>
    val unplaced: List<AnalysisError>
    val counts = mutableMapOf<TrFilter, Int>()
    val hasSentenceNotes: Boolean

    init {
        for (e in r.errors) if (e.start in tokens.indices) for (i in e.start..min(max(e.start, e.end), tokens.lastIndex)) tokens[i].errors += e
        r.metrics?.let { m ->
            for (p in m.pauses) {
                val i = tokens.indexOfFirst { abs(it.word.end - p.start) < 0.001 }.takeIf { it >= 0 } ?: tokens.indexOfLast { it.word.end <= p.start + 0.001 }
                if (i >= 0) tokens[i].pauseAfter = p
            }
            for (f in m.fillers) if (f.kind == "lexical") {
                val i = tokens.indexOfFirst { abs(it.word.start - f.time) < 0.001 }
                if (i < 0) continue
                tokens[i].filler = true
                if (' ' in f.word && i + 1 < tokens.size) tokens[i + 1].filler = true
            }
            for (u in m.unclear) if (u.wordIdx in tokens.indices) tokens[u.wordIdx].unclearTier = u.tier
            for (e in m.fluency?.events.orEmpty()) {
                if (e.kind == "filled" && "stt" in e.sources) continue // already struck through on its word
                if (tokens.isEmpty()) break
                val i = tokens.indexOfFirst { it.word.end > e.start - 0.02 }.takeIf { it >= 0 } ?: tokens.lastIndex
                val what = DisfluencyKinds.all.firstOrNull { it.key == e.kind }?.what ?: "Disfluency"
                tokens[i].marks += TrMark(Timeline.disfluencyShort[e.kind] ?: e.kind, what, e.start)
            }
        }
        unplaced = r.errors.filter { it.start !in tokens.indices }
        hasSentenceNotes = r.errors.any(::isSentenceNote)
        for (f in TrFilter.entries) f.type?.let { counts[f] = timeline.count(it) }
        counts[TrFilter.Other] = r.errors.count { group(it) == TrFilter.Other }
        counts[TrFilter.Pauses] = r.metrics?.pauses?.size ?: 0

        // One section per question, headed "Q1. ..."; without question boundaries, one headless block.
        val qs = r.questions.orEmpty().withIndex().filter { it.value.startWord in tokens.indices }.sortedBy { it.value.startWord }
        sections = if (qs.isEmpty()) {
            if (tokens.isEmpty()) emptyList() else listOf(TrSection(0, null, "", "", tokens.indices))
        } else qs.mapIndexed { j, q ->
            val from = if (j == 0) 0 else q.value.startWord
            val to = if (j + 1 < qs.size) qs[j + 1].value.startWord else tokens.size
            val (head, rest) = questionHead(q.value.text)
            TrSection(j, q.index + 1, head, rest, from until max(from, to))
        }
    }
}

@Composable
fun TranscriptPanel(result: AnalysisResult, player: ResultPlayer, timeline: Timeline, focus: String?, onSelect: (AnalysisError) -> Unit) {
    val e = MaterialTheme.ext
    val model = remember(result, timeline) { TrModel(result, timeline) }
    var filter by remember { mutableStateOf(TrFilter.All) }
    var markDetail by remember { mutableStateOf<String?>(null) }
    val colors = MarkerType.entries.map { it to it.color() }.toMap()
    // Index of the word playing now (-1 for none). Derived, so the 10 Hz clock only recomposes the two words that change.
    val now = remember(player, model) {
        derivedStateOf {
            val t = player.currentTime
            val i = if (player.isLoaded && player.isPlaying) wordIndexAt(model.words, t) else -1
            if (i >= 0 && t < model.words[i].end + 0.05) i else -1
        }
    }
    val focusWord = focus?.let { id -> timeline.markers.firstOrNull { it.id == id } }?.let { max(wordIndexAt(model.words, it.t), 0) }

    if (model.tokens.isEmpty() && model.unplaced.isEmpty()) {
        Unavailable("No transcript", "No transcript is available for this answer.")
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        ChipScroller {
            TrFilter.entries.filter { it == TrFilter.All || it == filter || (model.counts[it] ?: 0) > 0 }.forEach { f ->
                ResFilterChip(f.label, filter == f, { filter = f }, count = if (f == TrFilter.All) null else model.counts[f] ?: 0)
            }
        }
        Legend(model, timeline, player.isLoaded, colors)
        markDetail?.let { ResAlert(AlertTone.Info, it) }
        model.sections.forEach { s ->
            AppCard {
                if (s.n != null) {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("Q${s.n}. ${s.head}", style = MaterialTheme.typography.titleSmall, color = e.muted)
                        if (s.rest.isNotEmpty()) Text(s.rest, style = MaterialTheme.typography.bodySmall, color = e.muted)
                    }
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (i in s.range) WordView(model.tokens[i], filter, now, focusWord, colors, player, onSelect) { d -> markDetail = if (markDetail == d) null else d }
                }
            }
        }
        if (model.unplaced.isNotEmpty()) {
            SectionTitle("Also noted")
            RowsCard {
                model.unplaced.forEachIndexed { i, err ->
                    if (i > 0) RowDivider()
                    Column(Modifier.padding(16.dp)) { ErrorDetails(err, playAction(player, err)) }
                }
            }
        }
    }
}

private fun playAction(player: ResultPlayer, e: AnalysisError): (() -> Unit)? {
    val t = e.time ?: return null
    return if (player.isLoaded) ({ player.seek(max(0.0, t - 0.3)) }) else null
}

/** Small tag text (no overline tracking). */
private val chipText @Composable get() = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.sp)

// MARK: Legend

/** What the marks mean; only the marks that appear in this transcript. */
@Composable
private fun Legend(model: TrModel, timeline: Timeline, loaded: Boolean, colors: Map<MarkerType, Color>) {
    val e = MaterialTheme.ext
    FlowRow(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp), itemVerticalAlignment = Alignment.CenterVertically) {
        MarkerType.entries.filter { timeline.count(it) > 0 || it == MarkerType.Grammar || it == MarkerType.Vocabulary }.forEach { t ->
            LegendItem(t.label.lowercase()) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    MarkerGlyph(t, 9.dp)
                    Underlined("word", t.underlineDashes(), colors.getValue(t))
                }
            }
        }
        if (model.tokens.any { it.filler }) LegendItem("filler") {
            Text("um", style = MaterialTheme.typography.bodySmall.copy(textDecoration = TextDecoration.LineThrough), color = e.muted)
        }
        if (model.tokens.any { it.marks.isNotEmpty() }) LegendItem("tap a tag for the detail") { TagChip("repeat") }
        LegendItem("long pause; short ones show under Pauses") { PauseSample() }
        if (model.hasSentenceNotes) LegendItem("task note (select Task & other)") {
            Text("…", Modifier.background(e.warn.copy(alpha = 0.14f), RoundedCornerShape(4.dp)).padding(horizontal = 4.dp), style = MaterialTheme.typography.bodySmall, color = e.ink)
        }
        if (loaded) LegendItem("playing now; tap any word to hear it") {
            Text("word", Modifier.background(e.brandSoft, RoundedCornerShape(3.dp)).padding(horizontal = 3.dp), style = MaterialTheme.typography.bodySmall, color = e.ink)
        }
    }
}

@Composable
private fun LegendItem(label: String, sample: @Composable () -> Unit) {
    Row(Modifier.semantics(mergeDescendants = true) { contentDescription = "Legend: $label" }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        sample()
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.ext.muted)
    }
}

@Composable
private fun TagChip(text: String) {
    Text(text, Modifier.background(MaterialTheme.ext.surface2, CircleShape).padding(horizontal = 6.dp, vertical = 2.dp), style = chipText, color = MaterialTheme.ext.muted)
}

@Composable
private fun PauseSample() {
    val e = MaterialTheme.ext
    Text("pause 1.3s", Modifier.background(e.bad.copy(alpha = 0.12f), CircleShape).padding(horizontal = 6.dp, vertical = 2.dp), style = chipText, color = e.badText)
}

/** Text with a dashed (or solid, when [dashes] is null) underline in [color]: the type reads without colour. */
@Composable
private fun Underlined(text: String, dashes: FloatArray?, color: Color, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier.drawBehind {
            val y = size.height - 1.dp.toPx()
            drawLine(
                color, androidx.compose.ui.geometry.Offset(0f, y), androidx.compose.ui.geometry.Offset(size.width, y), 1.5.dp.toPx(),
                pathEffect = dashes?.let { PathEffect.dashPathEffect(FloatArray(it.size) { i -> it[i].dp.toPx() }) },
            )
        },
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.ext.ink,
    )
}

// MARK: Words

@Composable
private fun WordView(
    t: TrToken, filter: TrFilter, now: State<Int>, focusWord: Int?, colors: Map<MarkerType, Color>, player: ResultPlayer,
    onSelect: (AnalysisError) -> Unit, onMark: (String) -> Unit,
) {
    val e = MaterialTheme.ext
    // Sentence-wide notes would drown word-level marks, so they only show under their own filter.
    val err = t.errors.firstOrNull { !isSentenceNote(it) || filter == group(it) }
    val sentence = err?.let(::isSentenceNote) ?: false
    var type = err?.let { MarkerType.of(it.category) }
    if (err == null && t.unclearTier != null && !t.filler) type = MarkerType.Pronunciation
    val underlineColor: Color? = if (sentence) null else (type?.let { colors.getValue(it) } ?: if (err != null) e.muted else null)
    val isNow by remember(t.id) { derivedStateOf { now.value == t.id } }
    val picked = t.id == focusWord
    val matches = when (filter) {
        TrFilter.All -> true
        TrFilter.Pauses -> false // words dim; the pause chips light up
        TrFilter.Other -> t.errors.any { group(it) == TrFilter.Other }
        TrFilter.Pronunciation -> t.unclearTier != null || t.errors.any { group(it) == TrFilter.Pronunciation }
        TrFilter.Fluency -> t.filler || t.marks.isNotEmpty() || t.errors.any { group(it) == TrFilter.Fluency }
        TrFilter.Grammar, TrFilter.Vocab -> t.errors.any { group(it) == filter }
    }
    val background = if (isNow) e.brandSoft else if (sentence) e.warn.copy(alpha = 0.14f) else Color.Transparent
    val shape = RoundedCornerShape(4.dp)
    var bring = Modifier
    if (picked) {
        val r = remember { BringIntoViewRequester() }
        LaunchedEffect(focusWord) { r.bringIntoView() }
        bring = Modifier.bringIntoViewRequester(r)
    }
    val dashes = type?.underlineDashes()
    Row(bring, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        t.marks.forEach { m -> MarkChip(m, filter, onMark, player) }
        val label = if (err == null) t.word.w else "${t.word.w}, ${categoryLabel(err.category)} mistake"
        Text(
            t.word.w,
            Modifier.alpha(if (filter == TrFilter.All || matches) 1f else 0.35f)
                .background(background, shape)
                .then(if (picked) Modifier.border(1.5.dp, e.ink, shape) else Modifier)
                .drawBehind {
                    if (underlineColor != null) {
                        val y = size.height - 2.dp.toPx()
                        drawLine(
                            underlineColor, androidx.compose.ui.geometry.Offset(0f, y), androidx.compose.ui.geometry.Offset(size.width, y), 1.5.dp.toPx(),
                            pathEffect = dashes?.let { d -> PathEffect.dashPathEffect(FloatArray(d.size) { i -> d[i].dp.toPx() }) },
                        )
                    }
                }
                .clickable(role = Role.Button) { if (err != null) onSelect(err) else player.seek(max(0.0, t.word.start - 0.3)) }
                .semantics { contentDescription = label }
                .padding(horizontal = 2.dp),
            style = AppText.readingSm.copy(textDecoration = if (t.filler) TextDecoration.LineThrough else null),
            color = if (t.filler) e.muted else e.ink,
        )
        t.pauseAfter?.let { p -> if (isLongPause(p) || filter == TrFilter.Pauses) PauseChip(p, filter, player) }
    }
}

@Composable
private fun MarkChip(m: TrMark, filter: TrFilter, onMark: (String) -> Unit, player: ResultPlayer) {
    val e = MaterialTheme.ext
    Surface(
        { onMark(m.detail); player.seek(max(0.0, m.time - 0.3)) },
        Modifier.alpha(if (filter == TrFilter.All || filter == TrFilter.Fluency) 1f else 0.35f).semantics { contentDescription = m.detail },
        shape = CircleShape, color = e.surface2,
        border = BorderStroke(1.5.dp, if (filter == TrFilter.Fluency) e.muted else Color.Transparent),
    ) {
        Row(Modifier.padding(horizontal = 6.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            MarkerGlyph(MarkerType.Fluency, 7.dp)
            Text(m.short, style = chipText, color = e.muted)
        }
    }
}

@Composable
private fun PauseChip(p: Pause, filter: TrFilter, player: ResultPlayer) {
    val e = MaterialTheme.ext
    val long = isLongPause(p)
    val color = if (long) e.badText else e.muted
    Text(
        "pause ${pauseSec(p)}s",
        Modifier.background(if (long) e.bad.copy(alpha = 0.12f) else e.surface2, CircleShape)
            .then(if (filter == TrFilter.Pauses) Modifier.border(1.dp, color, CircleShape) else Modifier)
            .clickable(role = Role.Button) { player.seek(max(0.0, p.start - 0.3)) }
            .semantics { contentDescription = "${if (long) "Long pause" else "Pause"}, ${pauseSec(p)} seconds" }
            .padding(horizontal = 6.dp, vertical = 2.dp),
        style = chipText.copy(fontFeatureSettings = "tnum"), color = color,
    )
}
