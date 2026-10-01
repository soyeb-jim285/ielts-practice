package com.soyeb.ieltspractice.ui.screens.result

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.LocalDemo
import com.soyeb.ieltspractice.core.AnalysisError
import com.soyeb.ieltspractice.core.AnalysisResult
import com.soyeb.ieltspractice.core.Attempt
import com.soyeb.ieltspractice.core.Band
import com.soyeb.ieltspractice.core.Comparison
import com.soyeb.ieltspractice.core.Crit
import com.soyeb.ieltspractice.core.Criterion
import com.soyeb.ieltspractice.core.Empty
import com.soyeb.ieltspractice.core.Fix
import com.soyeb.ieltspractice.core.Timeline
import com.soyeb.ieltspractice.core.answeredRelevance
import com.soyeb.ieltspractice.core.bandRange
import com.soyeb.ieltspractice.core.clipWords
import com.soyeb.ieltspractice.core.criterionLabel
import com.soyeb.ieltspractice.core.fmt
import com.soyeb.ieltspractice.core.formatDate
import com.soyeb.ieltspractice.core.formatDuration
import com.soyeb.ieltspractice.core.minWords
import com.soyeb.ieltspractice.core.notAssessed
import com.soyeb.ieltspractice.core.offTopic
import com.soyeb.ieltspractice.core.pronUnsupported
import com.soyeb.ieltspractice.core.resScore
import com.soyeb.ieltspractice.core.ResScore
import com.soyeb.ieltspractice.core.sentenceCase
import com.soyeb.ieltspractice.core.taskLabel
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.AttemptResult
import com.soyeb.ieltspractice.ui.nav.SpeakingSession
import com.soyeb.ieltspractice.ui.nav.WritingEditor
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.CardShape
import com.soyeb.ieltspractice.ui.theme.Chip
import com.soyeb.ieltspractice.ui.theme.PrimaryButton
import com.soyeb.ieltspractice.ui.theme.SectionTitle
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.bandTextColor
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** Demo screenshots: the `tab` extra is "Fluency", "Fluency-2" (scrolled two screens down) or "Transcript-Sheet" (error sheet open). */
private class DemoView(val tab: String, val scrollPages: Int, val sheet: Boolean) {
    companion object {
        fun parse(raw: String?): DemoView? {
            if (raw == null) return null
            val parts = raw.split('-')
            return DemoView(parts[0], parts.drop(1).firstNotNullOfOrNull { it.toIntOrNull() } ?: 0, parts.drop(1).any { it == "Sheet" })
        }
    }
}

/** One attempt: header, score, tabs and their panels, the analysing/failed/no-speech states, audio bar and the mistake sheet. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun AttemptResultView(attempt: Attempt, stage: String?, retryable: Boolean, nav: AppNav, onRetry: () -> Unit, extras: (@Composable () -> Unit)? = null) {
    val e = MaterialTheme.ext
    val api = LocalApp.current.api
    val demo = LocalDemo.current
    val demoView = remember { DemoView.parse(demo?.tab) }
    val context = LocalContext.current
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val me by api.me.collectAsState()
    val target = me?.settings?.targetBand ?: 7.0

    val speaking = attempt.skill == "speaking"
    val tabs = if (speaking) listOf("Overview", "Transcript", "Fluency", "Language", "Improve") else listOf("Overview", "Essay", "Structure", "Language", "Improve")
    var tab by rememberSaveable { mutableStateOf(demoView?.tab ?: "Overview") }
    val current = if (tab in tabs) tab else "Overview"
    val result = attempt.analysis
    val timeline = remember(result) { result?.let { Timeline.of(it) } ?: Timeline.Empty }
    var focus by remember { mutableStateOf<String?>(null) }
    var selectedError by remember { mutableStateOf(if (demoView?.sheet == true) result?.errors?.firstOrNull() else null) }
    var toast by remember { mutableStateOf<String?>(null) }
    var parentText by remember { mutableStateOf<String?>(null) }
    var addedFixes by remember { mutableStateOf(false) }
    var showPrompt by remember { mutableStateOf(false) }
    var scrollToRelevance by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()

    val player = remember(attempt.id) { ResultPlayer(if (demo != null && speaking && attempt.status == "done") result?.metrics?.durationS else null) }
    DisposableEffect(player) { onDispose { player.release() } }
    LaunchedEffect(attempt.audioUrl) {
        val url = attempt.audioUrl
        if (speaking && url != null && demo == null) { player.load(context, url); player.poll() }
    }
    LaunchedEffect(attempt.parentAttemptId) {
        val id = attempt.parentAttemptId ?: return@LaunchedEffect
        parentText = runCatching { api.get<Attempt>("/api/attempts/$id") }.getOrNull()?.answerText
    }
    LaunchedEffect(toast) { if (toast != null) { delay(2000); toast = null } }
    // Demo screenshots of a scrolled tab: wait for the list to lay out, then move down by whole screens.
    LaunchedEffect(Unit) {
        val pages = demoView?.scrollPages ?: 0
        if (pages > 0) {
            snapshotFlow { listState.layoutInfo.totalItemsCount }.first { it > 0 }
            listState.scrollBy(with(density) { (pages * 640).dp.toPx() })
        }
    }

    val showAudio = speaking && player.isLoaded && attempt.status == "done" && current in listOf("Transcript", "Fluency", "Language")
    fun openRelevance() { scrollToRelevance = true; tab = "Language" }
    fun playFor(err: AnalysisError): (() -> Unit)? {
        val t = err.time ?: return null
        return if (player.isLoaded) ({ player.seek(max(0.0, t - 0.3)) }) else null
    }
    fun retryRoute(): Any =
        if (speaking) SpeakingSession("prompt", promptId = attempt.promptId, parentId = attempt.id)
        else WritingEditor("prompt", promptId = attempt.promptId, parentId = attempt.id)
    val retryLabel = fun(again: Boolean): String =
        if (!speaking) "Retry this prompt" else if (again) "Record again" else if ((attempt.prompt.followUps?.size ?: 0) > 1) "Retry Part ${attempt.part}" else "Retry this question"

    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
            LazyColumn(Modifier.fillMaxSize(), state = listState, verticalArrangement = Arrangement.spacedBy(16.dp), contentPadding = PaddingValues(top = 4.dp, bottom = 24.dp)) {
                item { Header(attempt, result, speaking, target, showPrompt, { showPrompt = !showPrompt }, ::openRelevance) }
                if (extras != null) item { extras() }
                when (attempt.status) {
                    "done" -> if (result == null) item { ResUnavailable("No analysis", "This answer has no analysis yet.") }
                    else if (notAssessed(result)) item {
                        ResUnavailable(
                            "No speech detected",
                            "We couldn't hear enough speech in this recording to score it. Check the right microphone is selected, speak a little closer to it, and keep talking for at least 20 seconds.",
                        ) { PrimaryButton(retryLabel(false), { nav.go(retryRoute()) }) }
                    } else {
                        stickyHeader { Box(Modifier.fillMaxWidth().background(e.bg).padding(vertical = 4.dp)) { TabStrip(tabs, current) { tab = it } } }
                        item {
                            Panel(
                                current, result, attempt, speaking, target, timeline, player, focus, { focus = it }, parentText, addedFixes,
                                scrollToRelevance, { scrollToRelevance = false }, ::openRelevance, nav, retryLabel, ::retryRoute, { selectedError = it },
                                onAddFixes = { fixes ->
                                    scope.launch {
                                        toast = try {
                                            api.send<Empty>("POST", "/api/cards/bulk", buildJsonObject {
                                                putJsonArray("cards") {
                                                    fixes.forEach { addJsonObject { put("front", "${it.title}\n\n${it.before}"); put("back", "${it.after}\n\n${it.why}"); put("source", "fix") } }
                                                }
                                            })
                                            addedFixes = true
                                            "Added ${fixes.size} ${if (fixes.size == 1) "card" else "cards"} to your review deck"
                                        } catch (x: Exception) {
                                            x.message ?: "Couldn't add the cards."
                                        }
                                    }
                                },
                            )
                        }
                    }
                    "failed" -> item { Failed(attempt, speaking, retryable, nav, onRetry, retryLabel(true), ::retryRoute) }
                    "recording" -> if (speaking) item { NotSubmitted(attempt, nav, retryLabel(true), ::retryRoute) } else item { Analyzing(false, stage) }
                    else -> item { Analyzing(speaking, stage) }
                }
            }
            toast?.let {
                Surface(
                    Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp).semantics { contentDescription = it },
                    shape = CircleShape, color = e.ink, contentColor = e.bg,
                ) { Text(it, Modifier.padding(horizontal = 16.dp, vertical = 12.dp), style = MaterialTheme.typography.labelLarge) }
            }
            // A real bottom sheet opens in its own window, which a screenshot cannot see: demo mode draws the same content inline.
            selectedError?.let { err ->
                if (demo != null) {
                    Surface(Modifier.align(Alignment.BottomCenter).fillMaxWidth(), shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp), color = e.surface, border = BorderStroke(1.dp, e.line), shadowElevation = 8.dp) {
                        Column(Modifier.padding(top = 12.dp)) {
                            Box(Modifier.align(Alignment.CenterHorizontally).size(width = 32.dp, height = 4.dp).clip(CircleShape).background(e.muted.copy(alpha = 0.5f)))
                            Box(Modifier.size(12.dp))
                            ErrorSheetContent(err, playFor(err))
                        }
                    }
                }
            }
        }
        if (showAudio) ResAudioBar(player, timeline, focus, { focus = it }, Modifier.padding(bottom = 8.dp))
    }

    if (demo == null) selectedError?.let { err ->
        ModalBottomSheet({ selectedError = null }, containerColor = e.surface) {
            ErrorSheetContent(err, playFor(err))
        }
    }
}

// MARK: Header

@Composable
private fun Header(attempt: Attempt, r: AnalysisResult?, speaking: Boolean, target: Double, showPrompt: Boolean, onTogglePrompt: () -> Unit, onOffTopic: () -> Unit) {
    val e = MaterialTheme.ext
    val title = if (speaking) (if (attempt.part == 1) "Part 1: ${sentenceCase(attempt.prompt.title)}" else sentenceCase(attempt.prompt.title)) else attempt.prompt.title
    val meta = buildList {
        if (speaking) {
            add(if (attempt.part == 1) "Speaking" else "Speaking, Part ${attempt.part}")
            val nq = r?.questions?.size ?: 0
            if (nq > 1) add("$nq questions")
        } else {
            add("Writing"); add(taskLabel(attempt.prompt))
        }
        formatDate(attempt.createdAt).takeIf { it.isNotEmpty() }?.let { add(it) }
        if (speaking) attempt.durationMs?.takeIf { it > 0 }?.let { add(formatDuration(it)) }
    }.joinToString(", ")
    // Long writing prompts are clipped on a word boundary until opened (web PromptTitle).
    val clipped = !speaking && title.length > 48
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(if (clipped && !showPrompt) clipWords(title, 48) else title, style = MaterialTheme.typography.headlineSmall, color = e.ink, modifier = Modifier.semantics { heading() })
            Text(meta, style = MaterialTheme.typography.bodyMedium, color = e.muted)
            if (clipped) LinkButton(if (showPrompt) "Hide prompt" else "Show prompt", onTogglePrompt)
        }
        if (attempt.status == "done" && r != null && !notAssessed(r)) ScoreCard(attempt, r, speaking, target, onOffTopic)
    }
}

@Composable
private fun ScoreCard(attempt: Attempt, r: AnalysisResult, speaking: Boolean, target: Double, onOffTopic: () -> Unit) {
    val e = MaterialTheme.ext
    val s = resScore(r)
    val off = if (speaking) offTopic(r) else null
    val words = r.textMetrics?.words ?: 0
    val under = !speaking && r.tooShort != true && r.textMetrics != null && words < minWords(attempt.part)
    val gap = target - s.overall
    AppCard {
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.semantics(mergeDescendants = true) { contentDescription = "Overall band ${fmt(s.overall)}" }) {
                Text("Overall band", style = MaterialTheme.typography.bodySmall, color = e.muted)
                Text(fmt(s.overall), style = AppText.band(60), color = bandTextColor(s.overall, target), modifier = Modifier.padding(top = 4.dp))
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (s.overall > 0 && s.range.size == 2) Chip("likely ${bandRange(max(s.range[0], s.overall - 1), min(s.range[1], s.overall + 1))}")
                    if (s.overall > 0 && r.calibrated == false) Chip("AI estimate", color = e.warnText, modifier = Modifier.semantics { contentDescription = "AI estimate. An estimate from AI scoring, not an official IELTS result. It may be off by about a band." })
                    if (off != null) Chip("Off topic", color = e.badText, modifier = Modifier.clickable(role = Role.Button, onClickLabel = "Open the Language tab", onClick = onOffTopic))
                    if (s.offTopic) Chip("Capped: off topic", color = e.badText)
                    if (r.tooShort == true || under) Chip("Under word limit", color = e.badText)
                    else if (r.textMetrics != null) Chip("$words ${if (words == 1) "word" else "words"}")
                    if (attempt.overtime == true) Chip("Overtime", color = e.warnText)
                }
                Text(
                    buildAnnotatedString {
                        withStyle(SpanStyle(color = bandTextColor(s.overall, target), fontWeight = FontWeight.SemiBold)) { append(if (gap <= 0) "At or above" else "${fmt(gap)} below") }
                        append(" your ${fmt(target)} target")
                    },
                    style = MaterialTheme.typography.bodyMedium, color = e.ink,
                )
            }
        }
    }
}

// MARK: Tabs

@Composable
private fun TabStrip(tabs: List<String>, current: String, onSelect: (String) -> Unit) {
    val e = MaterialTheme.ext
    Surface(Modifier.fillMaxWidth(), shape = CircleShape, color = e.surface, border = BorderStroke(1.dp, e.line)) {
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(4.dp)) {
            tabs.forEach { t ->
                val on = t == current
                Box(
                    Modifier.heightIn(min = 44.dp).clip(CircleShape).background(if (on) e.brand else Color.Transparent)
                        .clickable(role = Role.Tab) { onSelect(t) }.semantics { selected = on }.padding(horizontal = 9.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(t, style = MaterialTheme.typography.labelLarge.copy(fontSize = 13.sp), color = if (on) e.onBrand else e.ink, maxLines = 1, softWrap = false)
                }
            }
        }
    }
}

@Composable
private fun Panel(
    tab: String, r: AnalysisResult, attempt: Attempt, speaking: Boolean, target: Double, timeline: Timeline, player: ResultPlayer,
    focus: String?, onFocus: (String?) -> Unit, parentText: String?, addedFixes: Boolean, scrollToRelevance: Boolean, onScrolled: () -> Unit,
    openRelevance: () -> Unit, nav: AppNav, retryLabel: (Boolean) -> String, retryRoute: () -> Any, onSelect: (AnalysisError) -> Unit,
    onAddFixes: (List<Fix>) -> Unit,
) {
    val e = MaterialTheme.ext
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        when (tab) {
            "Transcript" -> {
                TranscriptPanel(r, player, timeline, focus, onSelect)
                if (player.failed) Text("Couldn't load the recording, so words can't be played.", style = MaterialTheme.typography.bodySmall, color = e.muted)
            }
            "Fluency" -> r.metrics?.let { FluencyPanel(it, player, timeline, r.errors, focus, onFocus, r.criteria["fc"], target) }
                ?: ResUnavailable("No fluency data", "This analysis has no speech measurements.")
            "Essay" -> {
                val text = r.text ?: attempt.text ?: ""
                if (text.isBlank()) ResUnavailable("No essay text", "Nothing was written for this task.") else EssayPanel(r, text, onSelect)
            }
            "Structure" -> r.structure?.let { StructurePanel(it) } ?: ResUnavailable("No structure analysis", "The answer was too short to map its paragraphs.")
            "Language" -> LanguagePanel(r, player, scrollToRelevance, onScrolled)
            "Improve" -> Improve(r, attempt, speaking, parentText, addedFixes, nav, retryLabel, retryRoute, onAddFixes)
            else -> Overview(r, attempt, speaking, target, openRelevance, nav)
        }
    }
}

// MARK: Overview

@Composable
private fun Overview(r: AnalysisResult, attempt: Attempt, speaking: Boolean, target: Double, openRelevance: () -> Unit, nav: AppNav) {
    val e = MaterialTheme.ext
    val s = resScore(r)
    val order = Crit.order(attempt.skill)
    val off = if (speaking) offTopic(r) else null
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (off != null) {
            ResAlert(
                AlertTone.Bad, "${if (off.second > 1) "${off.first} of ${off.second} answers didn’t" else "Your answer didn’t"} address the question.",
                title = "Off topic", action = { LinkButton("See details in Language", openRelevance) },
            )
        }
        if (!speaking) WritingAlert(r, s, attempt, nav)
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            SectionTitle("Band by criterion")
            Text(criteriaNote(r, s, order, attempt.part), style = MaterialTheme.typography.bodySmall, color = e.muted)
        }
        order.forEach { k ->
            r.criteria[k]?.let { CriterionCard(k, it, target, r.comparison?.deltas?.get(k), pronUnsupported(r, k)) }
        }
        Text("Your target band is ${fmt(target)}. Unrounded average of the criteria: ${fmt(s.raw, 2)}.", style = MaterialTheme.typography.bodySmall, color = e.muted)
        r.comparison?.let { c ->
            ComparisonStrip(c, s.overall, order, attempt.parentAttemptId ?: c.parentAttemptId, if (speaking) "See last try" else "View previous attempt") { nav.go(AttemptResult.of(it)) }
        }
        if (r.topFixes.isNotEmpty()) {
            SectionTitle(if (r.topFixes.size == 1) "One thing to fix next" else "${r.topFixes.size} things to fix next")
            r.topFixes.forEachIndexed { i, f -> FixCard(i + 1, f) }
        }
    }
}

/** One line on how the headline number relates to the rows below (web OverviewPanel). */
private fun criteriaNote(r: AnalysisResult, s: ResScore, order: List<String>, part: Int): String {
    val bands = order.mapNotNull { k -> r.criteria[k]?.let { k to it.band } }
    val low = bands.minByOrNull { it.second } ?: return ""
    val high = bands.maxOf { it.second }
    val avg = Band.round(bands.sumOf { it.second } / bands.size)
    if (s.offTopic && avg > s.overall) {
        return "Average of these ${bands.size} bands would be ${fmt(avg)}, capped at ${fmt(s.overall)} because the ${if (part == 1) "answer" else "essay"} is off topic."
    }
    val pulls = if (high - low.second >= 2) ", so ${criterionLabel(low.first)} (${fmt(low.second)}) pulls it down without capping it" else ""
    return "Overall ${fmt(s.overall)} is the average of these ${bands.size} bands, rounded to the nearest half band$pulls."
}

/** One alert for everything wrong with the essay itself (web writing Done). */
@Composable
private fun WritingAlert(r: AnalysisResult, s: ResScore, attempt: Attempt, nav: AppNav) {
    val part = attempt.part
    val ta = if (part == 1) "Task Achievement" else "Task Response"
    val words = r.textMetrics?.words ?: 0
    val under = r.tooShort != true && r.textMetrics != null && words < minWords(part)
    val cap = fmt((r.criteria["ta"]?.band ?: 0.0) + 1)
    val kind = if (part == 1) "answer" else "essay"
    val message = buildList {
        if (s.offTopic) add("Your $kind doesn’t answer this question, so your overall band can’t go above $cap: one band over your $ta score.")
        if (under) add("You wrote $words of the ${minWords(part)} words required, which lowers $ta.")
    }.joinToString(" ")
    if (r.tooShort == true) {
        ResAlert(AlertTone.Warn, "Responses of 20 words or fewer are rated Band 1 on every criterion. Aim for at least ${minWords(part)} words.", title = "Too short to assess")
    } else if (s.offTopic || under) {
        ResAlert(
            if (s.offTopic) AlertTone.Bad else AlertTone.Warn, message, title = if (s.offTopic) "Off topic" else "Under ${minWords(part)} words",
            action = if (s.offTopic) ({ SecondaryButton("Rewrite on this topic", { nav.go(WritingEditor("prompt", promptId = attempt.promptId, parentId = attempt.id)) }) }) else null,
        )
    }
}

@Composable
private fun CriterionCard(key: String, c: Criterion, target: Double, delta: Double?, soft: Boolean) {
    val e = MaterialTheme.ext
    var open by remember { mutableStateOf(false) }
    // Audio-only pronunciation is a rough guide: widen its range.
    val lo = if (c.range.size == 2) (if (soft) max(0.0, min(c.range[0], c.band - 1.5)) else c.range[0]) else c.band
    val hi = if (c.range.size == 2) (if (soft) min(9.0, max(c.range[1], c.band + 1.5)) else c.range[1]) else c.band
    AppCard {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(criterionLabel(key), Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, color = e.ink)
                Text(fmt(c.band), style = AppText.band(28), color = bandTextColor(c.band, target))
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("likely ${bandRange(lo, hi)}", style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum"), color = e.muted)
                if (delta != null && delta != 0.0) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(if (delta > 0) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown, null, Modifier.size(16.dp), tint = if (delta > 0) e.goodText else e.badText)
                        Text("${fmt(abs(delta))} vs last try", style = MaterialTheme.typography.labelMedium, color = if (delta > 0) e.goodText else e.badText)
                    }
                }
            }
            ResBandBar(c.band, target, "${criterionLabel(key)} band")
            if (soft) Chip("Audio check only, low confidence", color = e.warnText, modifier = Modifier.semantics { contentDescription = "Audio check only, low confidence. The pronunciation band comes from the audio alone. Halting or very short speech is hard to judge, so treat it as a rough guide." })
            Text(c.summary, style = MaterialTheme.typography.bodyMedium, color = e.ink)
            if (c.descriptor.isNotEmpty() || c.evidence.isNotEmpty()) {
                Disclosure("Show evidence", "Hide evidence", open, { open = !open })
                if (open) Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    c.evidence.forEach { q ->
                        Text("“$q”", Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(e.surface2).padding(horizontal = 12.dp, vertical = 8.dp), style = serifBody, color = e.ink)
                    }
                    if (c.descriptor.isNotEmpty()) Text(
                        buildAnnotatedString {
                            withStyle(SpanStyle(fontWeight = FontWeight.SemiBold, color = e.ink)) { append("Band descriptor: ") }
                            withStyle(SpanStyle(color = e.muted)) { append(c.descriptor) }
                        },
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}

/** Retry comparison: previous overall to this overall, per-criterion deltas, and a link to the previous try (web ComparisonStrip). */
@Composable
private fun ComparisonStrip(c: Comparison, overall: Double, order: List<String>, parentId: String, linkText: String, onOpen: (String) -> Unit) {
    val e = MaterialTheme.ext
    val change = Math.round((overall - c.parentOverall) * 10) / 10.0
    val num = MaterialTheme.typography.titleSmall.copy(fontFeatureSettings = "tnum")
    Surface(Modifier.fillMaxWidth(), shape = CardShape, color = e.surface2) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Last try", style = MaterialTheme.typography.bodyMedium, color = e.muted)
                Text(fmt(c.parentOverall), style = num, color = e.ink)
                Text("→", Modifier.semantics { contentDescription = "to" }, style = MaterialTheme.typography.bodyMedium, color = e.muted)
                Text(fmt(overall), style = num, color = e.ink)
                ResDelta(change)
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                order.filter { c.deltas[it] != null }.forEach { k ->
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(criterionLabel(k), style = MaterialTheme.typography.bodySmall, color = e.muted)
                        ResDelta(c.deltas[k] ?: 0.0, small = true)
                    }
                }
            }
            LinkButton(linkText, { onOpen(parentId) })
        }
    }
}

// MARK: Improve

@Composable
private fun Improve(
    r: AnalysisResult, attempt: Attempt, speaking: Boolean, parentText: String?, addedFixes: Boolean, nav: AppNav,
    retryLabel: (Boolean) -> String, retryRoute: () -> Any, onAddFixes: (List<Fix>) -> Unit,
) {
    val e = MaterialTheme.ext
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            PrimaryButton(retryLabel(false), { nav.go(retryRoute()) }, Modifier.fillMaxWidth())
            if (r.topFixes.isNotEmpty()) {
                SecondaryButton(if (addedFixes) "Fixes in your deck" else "Add top fixes to review deck", { onAddFixes(r.topFixes) }, Modifier.fillMaxWidth(), enabled = !addedFixes)
            }
        }
        val now = attempt.answerText
        if (parentText != null && now != null) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                SectionTitle("Since your last attempt")
                Text("Your previous answer against this one.", style = MaterialTheme.typography.bodySmall, color = e.muted)
            }
            ResDiffCard(parentText, now, "This attempt", serif = !speaking)
        }
        if (r.rewrite.text.isEmpty()) {
            if (!speaking) ResUnavailable("No rewrite for this answer", "Write a full-length answer to get a band-higher version to compare against.")
        } else if (speaking) {
            SectionTitle("Your answer, one band higher")
            AppCard { SelectionContainer { Text(r.rewrite.text, style = MaterialTheme.typography.bodyLarge.copy(fontFamily = AppText.reading.fontFamily, lineHeight = 26.sp), color = e.ink) } }
            if (r.rewrite.note.isNotEmpty()) ResAlert(AlertTone.Info, r.rewrite.note)
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                SectionTitle("One band higher")
                Text(
                    r.rewrite.note.ifEmpty { "Study what changed and why. Don’t memorise it: examiners recognise learned essays." },
                    style = MaterialTheme.typography.bodySmall, color = e.muted,
                )
            }
            ResDiffCard(r.text ?: attempt.text ?: "", r.rewrite.text, "Clean rewrite", serif = true)
        }
    }
}

// MARK: Failed, not submitted, analysing

@Composable
private fun Failed(attempt: Attempt, speaking: Boolean, retryable: Boolean, nav: AppNav, onRetry: () -> Unit, recordAgain: String, route: () -> Any) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        ResAlert(
            AlertTone.Bad, attempt.error ?: "Something went wrong. Your answer is saved, so you can retry.", title = "Analysis failed",
            action = {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                    if (retryable) PrimaryButton("Retry analysis", onRetry) else SecondaryButton("Try again later", onRetry)
                    if (speaking) {
                        SecondaryButton(recordAgain, { nav.go(route()) })
                        LinkButton("Practise another part", nav::back)
                    }
                }
            },
        )
        QuestionsCard(attempt)
    }
}

@Composable
private fun NotSubmitted(attempt: Attempt, nav: AppNav, recordAgain: String, route: () -> Any) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        ResAlert(
            AlertTone.Bad, "This recording never finished uploading. Record it again to get your result.", title = "Not submitted",
            action = {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                    PrimaryButton(recordAgain, { nav.go(route()) })
                    LinkButton("Practise another part", nav::back)
                }
            },
        )
        QuestionsCard(attempt)
    }
}

/** What the candidate was asked: the cue card (Part 2) or the question list. */
@Composable
private fun QuestionsCard(attempt: Attempt) {
    val e = MaterialTheme.ext
    val p = attempt.prompt
    if (attempt.part == 2) {
        var intro = p.body
        if (intro.startsWith(p.title)) intro = intro.removePrefix(p.title)
        val bullets = p.bullets.orEmpty()
        val lines = intro.split("\n").map { it.trim() }.filter { it.isNotEmpty() && (bullets.isEmpty() || it.lowercase().trim(':', ' ') != "you should say") }
        AppCard(padding = 20.dp) {
            Text("Cue card", style = MaterialTheme.typography.bodySmall, color = e.muted)
            Text(p.title, style = MaterialTheme.typography.titleLarge, color = e.ink)
            if (lines.isNotEmpty()) Text(lines.joinToString("\n"), style = MaterialTheme.typography.bodyMedium, color = e.muted)
            if (bullets.isNotEmpty()) {
                Text("You should say", style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Medium), color = e.ink, modifier = Modifier.padding(top = 6.dp))
                bullets.forEach { b ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("•", style = MaterialTheme.typography.bodyMedium, color = e.muted)
                        Text(b, style = serifBody.copy(fontSize = 16.sp), color = e.ink)
                    }
                }
            }
        }
    } else {
        val qs = p.followUps.orEmpty().ifEmpty { listOf(p.body) }
        AppCard {
            Text("Questions you were asked", style = MaterialTheme.typography.titleMedium, color = e.ink)
            qs.forEachIndexed { i, q -> Text("${i + 1}. $q", style = serifBody, color = e.ink) }
        }
    }
}

/** Shown while an attempt is analysing (the screen polls). Real pipeline stages from the server, else the web's estimated schedule. */
@Composable
private fun Analyzing(speaking: Boolean, stage: String?) {
    val e = MaterialTheme.ext
    val demo = LocalDemo.current != null
    // A looping ticker would keep a screenshot test from ever going idle, so demo mode stays at the first step.
    val elapsed by produceState(0, demo) { if (!demo) while (true) { delay(1000); value += 1 } }
    val labels = mapOf(
        "transcribing" to "Transcribing your recording", "analyzing" to "Analysing fluency, grammar and vocabulary",
        "feedback" to "Marking mistakes and writing your fixes", "scoring" to "Scoring against the band descriptors", "finalizing" to "Finishing up",
    )
    val stages = if (speaking) listOf("transcribing", "analyzing", "finalizing") else listOf("feedback", "scoring", "finalizing")
    val fallback = if (speaking) listOf("Uploading", "Transcribing", "Measuring fluency", "Scoring against the band descriptors")
    else listOf("Measuring vocabulary and linking", "Scoring against the band descriptors", "Locating mistakes", "Writing your fixes")
    val real = stage?.let { stages.indexOf(it) }?.takeIf { it >= 0 }
    val steps = if (real != null) stages.map { labels[it] ?: it } else fallback
    val active = real ?: min(fallback.size - 1, elapsed / (if (speaking) 7 else 8))
    AppCard {
        Text(if (speaking) "Analysing your answer" else "Marking your answer", style = MaterialTheme.typography.titleLarge, color = e.ink)
        Text(
            if (elapsed >= 45) "Taking longer than usual. You can leave this page; we'll keep working and the result will be in your history."
            else "Usually under a minute. You can leave this page; the result will be in your history.",
            style = MaterialTheme.typography.bodySmall, color = e.muted,
        )
        Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            steps.forEachIndexed { i, s ->
                Row(
                    Modifier.semantics(mergeDescendants = true) { contentDescription = "$s, ${if (i < active) "done" else if (i == active) "in progress" else "waiting"}" },
                    horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) {
                        if (i < active) Icon(Icons.Filled.CheckCircle, null, Modifier.size(22.dp), tint = e.goodText)
                        else if (i == active) Busy(20.dp)
                        else Box(Modifier.size(18.dp).border(2.dp, e.muted.copy(alpha = 0.6f), CircleShape))
                    }
                    Text(s, style = MaterialTheme.typography.bodyLarge, color = if (i > active) e.muted else e.ink)
                }
            }
        }
    }
}
