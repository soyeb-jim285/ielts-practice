package com.soyeb.ieltspractice.ui.screens.result

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.soyeb.ieltspractice.core.AnalysisError
import com.soyeb.ieltspractice.core.Criterion
import com.soyeb.ieltspractice.core.Disfluency
import com.soyeb.ieltspractice.core.DisfluencyKind
import com.soyeb.ieltspractice.core.DisfluencyKinds
import com.soyeb.ieltspractice.core.FluStat
import com.soyeb.ieltspractice.core.FluTone
import com.soyeb.ieltspractice.core.MarkerType
import com.soyeb.ieltspractice.core.SpeechMetrics
import com.soyeb.ieltspractice.core.Timeline
import com.soyeb.ieltspractice.core.TimelineMarker
import com.soyeb.ieltspractice.core.clock
import com.soyeb.ieltspractice.core.fluStats
import com.soyeb.ieltspractice.core.fluTooShort
import com.soyeb.ieltspractice.core.fluUpTo
import com.soyeb.ieltspractice.core.fmt
import com.soyeb.ieltspractice.core.isLongPause
import com.soyeb.ieltspractice.core.perMinute
import com.soyeb.ieltspractice.core.wpmAt
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.CardShape
import com.soyeb.ieltspractice.ui.theme.SectionTitle
import com.soyeb.ieltspractice.ui.theme.ext
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// Fluency tab (iOS FluencyView.swift, web components/speaking/FluencyPanel.tsx): pace chart with the timeline, pause strip, the measures
// grid against typical band-7 speech, then fillers, repeats and restarts.

/** On target / Watch / Work on this, always with an icon and words (colour is never the only cue). */
private class Indicator(val icon: ImageVector, val text: String, val color: Color)

@Composable
private fun indicator(t: FluTone): Indicator? = with(MaterialTheme.ext) {
    when (t) {
        FluTone.Good -> Indicator(Icons.Filled.CheckCircle, "On target", goodText)
        FluTone.Warn -> Indicator(Icons.Filled.Warning, "Watch", warnText)
        FluTone.Bad -> Indicator(Icons.Filled.Close, "Work on this", badText)
        FluTone.Na -> null
    }
}

@Composable
private fun IndicatorLabel(t: FluTone) {
    val ind = indicator(t) ?: return
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Icon(ind.icon, null, Modifier.size(14.dp), tint = ind.color)
        Text(ind.text, style = MaterialTheme.typography.labelMedium, color = ind.color)
    }
}

@Composable
fun FluencyPanel(
    metrics: SpeechMetrics, player: ResultPlayer, timeline: Timeline, errors: List<AnalysisError>,
    focus: String?, onFocus: (String?) -> Unit, fc: Criterion?, target: Double,
) {
    val e = MaterialTheme.ext
    val tooShort = fluTooShort(metrics)
    val pauseCount = metrics.pauses.size
    val longPauses = metrics.pauses.count(::isLongPause)
    val stats = fluStats(metrics)
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (fc != null && fc.band < target && !tooShort && stats.none { it.tone == FluTone.Bad }) {
            ResAlert(
                AlertTone.Info, "The band is limited by something these numbers don't capture, such as answer length, relevance or how ideas connect. ${fc.summary}",
                title = "Your delivery measures look fine, but Fluency & Coherence is ${fmt(fc.band)}",
            )
        }
        SectionTitle("Pace")
        if (metrics.wpmSeries.size < 2) {
            AppCard { Text("This answer is too short for a pace chart (it needs at least 15 seconds).", style = MaterialTheme.typography.bodyMedium, color = e.muted) }
        } else {
            PaceCard(metrics, timeline, errors, player, focus, onFocus)
        }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            SectionTitle("Pauses")
            Text(
                "$pauseCount ${if (pauseCount == 1) "pause" else "pauses"}, $longPauses long, ${metrics.midClausePauses} mid-clause.${if (player.isLoaded) " Tap one to hear it." else ""}",
                style = MaterialTheme.typography.bodySmall, color = e.muted,
            )
        }
        AppCard {
            Strip(
                metrics.durationS, metrics.pauses.map { p -> Mark(p.start, p.end, if (isLongPause(p)) e.bad else e.warn.copy(alpha = 0.6f)) },
                player, "$pauseCount pauses, $longPauses long",
            ) { player.seek(max(0.0, it - 1)) }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("0:00", style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum"), color = e.muted)
                Text(clock(metrics.durationS.roundToInt()), style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum"), color = e.muted)
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Swatch(e.warn.copy(alpha = 0.6f), "Short, 0.25–1 s")
                Swatch(e.bad, "Long, 1 s or more")
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            SectionTitle("Fluency measures")
            Text(
                if (tooShort) "Not enough speech to measure. Answer for at least 20 seconds to see these." else "Compared with typical band-7 speech, not the score.",
                style = MaterialTheme.typography.bodySmall, color = e.muted,
            )
        }
        StatGrid(stats)
        metrics.fluency?.let { Disfluencies(it.events, metrics, player, tooShort) }
    }
}

@Composable
private fun Swatch(color: Color, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(end = 4.dp)) {
        Box(Modifier.size(width = 12.dp, height = 10.dp).clip(RoundedCornerShape(2.dp)).background(color))
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.ext.muted)
    }
}

// MARK: Measures

@Composable
private fun StatGrid(stats: List<FluStat>) {
    val e = MaterialTheme.ext
    Surface(Modifier.fillMaxWidth(), shape = CardShape, color = e.surface, border = BorderStroke(1.dp, e.line)) {
        Column {
            stats.chunked(2).forEachIndexed { i, pair ->
                if (i > 0) RowDivider()
                Row(Modifier.height(IntrinsicSize.Min)) {
                    StatCell(pair[0], Modifier.weight(1f))
                    Box(Modifier.width(1.dp).fillMaxHeight().background(e.line))
                    if (pair.size > 1) StatCell(pair[1], Modifier.weight(1f)) else Box(Modifier.weight(1f))
                }
            }
        }
    }
}

/** One measure: label with an info tip, the value, and where it sits against typical band-7 speech. */
@Composable
private fun StatCell(stat: FluStat, modifier: Modifier) {
    val e = MaterialTheme.ext
    var showInfo by remember { mutableStateOf(false) }
    Column(modifier.padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        InfoLabel(stat.label, showInfo) { showInfo = !showInfo }
        Text(stat.value, style = AppText.band(20), color = e.ink)
        IndicatorLabel(stat.tone)
        if (showInfo) Text(stat.info, style = MaterialTheme.typography.bodySmall, color = e.muted, modifier = Modifier.padding(end = 8.dp, top = 2.dp))
    }
}

/** A caption with an (i) button that toggles an explanation (48dp tall hit area, 18dp icon). */
@Composable
fun InfoLabel(label: String, open: Boolean, onToggle: () -> Unit) {
    Row(Modifier.fillMaxWidth().height(40.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f, fill = false), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.ext.muted)
        Box(
            Modifier.size(40.dp).clickable(role = Role.Button, onClick = onToggle)
                .semantics { contentDescription = "About $label"; stateDescription = if (open) "Shown" else "Hidden" },
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Filled.Info, null, Modifier.size(18.dp), tint = MaterialTheme.ext.muted) }
    }
}

// MARK: Strips

private class Mark(val start: Double, val end: Double, val color: Color)

/** Whole-recording bar with marks placed on it. Tap near a mark to hear it; the playhead follows playback. */
@Composable
private fun Strip(durationS: Double, marks: List<Mark>, player: ResultPlayer, summary: String, onPick: (Double) -> Unit) {
    val e = MaterialTheme.ext
    val d = max(durationS, 1.0)
    Canvas(
        Modifier.fillMaxWidth().height(44.dp).semantics { contentDescription = summary }
            .pointerInput(marks, d) {
                detectTapGestures { off ->
                    val w = size.width.toFloat()
                    var best: Double? = null
                    var bestDist = 22.dp.toPx()
                    for (m in marks) {
                        val dist = abs(w * ((m.start + (m.end - m.start) / 2) / d).toFloat() - off.x)
                        if (dist <= bestDist) { bestDist = dist; best = m.start }
                    }
                    best?.let(onPick)
                }
            },
    ) {
        drawRoundRect(e.surface2, Offset.Zero, size, CornerRadius(8.dp.toPx()))
        val top = (size.height - 28.dp.toPx()) / 2
        for (m in marks) {
            val x = min(max(size.width - 4.dp.toPx(), 0f), size.width * (m.start / d).toFloat())
            val w = max(4.dp.toPx(), size.width * ((m.end - m.start) / d).toFloat())
            drawRoundRect(m.color, Offset(x, top), Size(w, 28.dp.toPx()), CornerRadius(3.dp.toPx()))
        }
        if (player.isLoaded) {
            val x = min(size.width - 2.dp.toPx(), size.width * (max(player.currentTime, 0.0) / d).toFloat())
            drawRect(e.brand, Offset(x, (size.height - 40.dp.toPx()) / 2), Size(2.dp.toPx(), 40.dp.toPx()))
        }
    }
}

// MARK: Fillers, repeats and restarts

@Composable
private fun kindColor(kind: String): Color = with(MaterialTheme.ext) {
    when (kind) {
        "filled" -> muted
        "repetition" -> sky
        "repair" -> bad
        "false_start" -> warn
        "partial" -> ink.copy(alpha = 0.55f)
        "prolongation" -> sky.copy(alpha = 0.5f)
        else -> muted
    }
}

@Composable
private fun Disfluencies(events: List<Disfluency>, metrics: SpeechMetrics, player: ResultPlayer, tooShort: Boolean) {
    val e = MaterialTheme.ext
    val kinds = DisfluencyKinds.all.filter { k -> k.core || events.any { it.kind == k.key } }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        SectionTitle("Fillers, repeats and restarts")
        Text(
            if (player.isLoaded) "Each mark is one event along your answer. Tap a mark to hear it." else "Each mark is one event along your answer.",
            style = MaterialTheme.typography.bodySmall, color = e.muted,
        )
    }
    AppCard {
        Strip(
            metrics.durationS, events.map { Mark(it.start, max(it.end, it.start + 0.15), kindColor(it.kind)) }, player,
            "${events.size} fillers, repeats and restarts along the recording",
        ) { player.seek(max(0.0, it - 1)) }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            kinds.filter { k -> events.any { it.kind == k.key } }.forEach { Swatch(kindColor(it.key), it.label) }
        }
    }
    kinds.forEach { Breakdown(it, events, metrics, tooShort) }
}

/** One card per disfluency type: how many, how often, and what is normal versus what hurts coherence. */
@Composable
private fun Breakdown(k: DisfluencyKind, events: List<Disfluency>, metrics: SpeechMetrics, tooShort: Boolean) {
    val e = MaterialTheme.ext
    val n = events.count { it.kind == k.key }
    val perMin = perMinute(n, max(metrics.durationS, 1.0))
    val tone = if (tooShort) FluTone.Na else fluUpTo(perMin, k.rate[0], k.rate[1])
    var open by remember { mutableStateOf(false) }
    AppCard {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(k.label, style = MaterialTheme.typography.titleMedium, color = e.ink)
                Text(k.what, style = MaterialTheme.typography.bodySmall, color = e.muted)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text("$n", style = AppText.band(22), color = e.ink)
                if (!tooShort) Text("${fmt(perMin)}/min", style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum"), color = e.muted)
            }
        }
        IndicatorLabel(tone)
        Disclosure("When is this a problem?", "When is this a problem?", open, { open = !open })
        if (open) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(labelled("Normal: ", k.normal), style = MaterialTheme.typography.bodySmall)
                Text(labelled("Hurts when: ", k.harmful), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun labelled(label: String, text: String): AnnotatedString = buildAnnotatedString {
    withStyle(SpanStyle(fontWeight = FontWeight.SemiBold, color = MaterialTheme.ext.ink)) { append(label) }
    withStyle(SpanStyle(color = MaterialTheme.ext.muted)) { append(text) }
}

// MARK: Pace chart with the speaking timeline (web WpmChart in FluencyPanel.tsx)

/**
 * Pace over time with the typical band-7 zone. Mistakes sit on the line (shape and colour per type), questions are bands, long pauses
 * are shaded, and the teal line follows the audio. Without a recording the playhead is hidden and tapping just selects.
 */
@Composable
private fun PaceCard(metrics: SpeechMetrics, timeline: Timeline, errors: List<AnalysisError>, player: ResultPlayer, focus: String?, onFocus: (String?) -> Unit) {
    val e = MaterialTheme.ext
    val series = metrics.wpmSeries
    val duration = max(metrics.durationS, 1.0)
    var hidden by remember { mutableStateOf(emptySet<MarkerType>()) }
    val shown = timeline.markers.filter { it.type !in hidden && it.t <= duration }
    val picked = timeline.markers.firstOrNull { it.id == focus }
    val lo = (series.minOf { it.wpm }).roundToInt()
    val hi = (series.maxOf { it.wpm }).roundToInt()
    val top = ceil(max(200.0, series.maxOf { it.wpm }) / 40) * 40
    val multi = timeline.questions.size > 1
    val measurer = rememberTextMeasurer()
    val tick = TextStyle(fontSize = 11.sp, color = e.muted, fontFeatureSettings = "tnum")
    val markerColors = MarkerType.entries.map { it to it.color() }.toMap()

    fun select(m: TimelineMarker) {
        onFocus(m.id)
        if (player.isLoaded) player.seek(max(0.0, m.t - 0.5))
    }

    AppCard {
        Text("words / min", style = MaterialTheme.typography.labelMedium, color = e.muted)
        // Plot geometry shared by the drawing and the tap handler.
        val left = 30.dp
        val bottom = 22.dp
        val topPad = 16.dp
        val right = 6.dp
        Canvas(
            Modifier.fillMaxWidth().height(220.dp)
                .semantics { contentDescription = "Words per minute over time, from $lo to $hi" }
                .pointerInput(shown, duration, top) {
                    detectTapGestures { off ->
                        val pw = size.width - left.toPx() - right.toPx()
                        val ph = size.height - topPad.toPx() - bottom.toPx()
                        var best: TimelineMarker? = null
                        var bestDist = 28.dp.toPx()
                        for (m in shown) {
                            val px = left.toPx() + pw * (m.t / duration).toFloat()
                            val py = topPad.toPx() + ph * (1 - (wpmAt(series, m.t) / top).toFloat())
                            val d = hypot(px - off.x, py - off.y)
                            if (d <= bestDist) { bestDist = d; best = m }
                        }
                        best?.let(::select)
                    }
                },
        ) {
            val x0 = left.toPx()
            val pw = size.width - x0 - right.toPx()
            val y0 = topPad.toPx()
            val ph = size.height - y0 - bottom.toPx()
            fun px(t: Double) = x0 + pw * (t / duration).toFloat()
            fun py(w: Double) = y0 + ph * (1 - (w / top).toFloat())
            // Gridlines and y ticks every 40 wpm.
            var v = 0.0
            while (v <= top + 0.1) {
                drawLine(e.line, Offset(x0, py(v)), Offset(x0 + pw, py(v)), 1.dp.toPx())
                val label = measurer.measure("${v.roundToInt()}", tick)
                drawText(label, topLeft = Offset(x0 - 4.dp.toPx() - label.size.width, py(v) - label.size.height / 2f))
                v += 40
            }
            // X ticks.
            val step = listOf(5, 10, 15, 20, 30, 60, 120, 300).firstOrNull { duration / it <= 6 } ?: 600
            var t = 0
            while (t <= duration) {
                val label = measurer.measure(clock(t), tick)
                drawText(label, topLeft = Offset(min(px(t.toDouble()) - label.size.width / 2f, size.width - label.size.width.toFloat()).coerceAtLeast(0f), y0 + ph + 4.dp.toPx()))
                t += step
            }
            // Typical band-7 zone.
            drawRect(e.good.copy(alpha = 0.14f), Offset(x0, py(160.0)), Size(pw, py(120.0) - py(160.0)))
            if (multi) timeline.questions.filter { it.idx % 2 == 1 }.forEach {
                drawRect(e.ink.copy(alpha = 0.05f), Offset(px(it.start), y0), Size(px(min(it.end, duration)) - px(it.start), ph))
            }
            timeline.pauses.forEach { drawRect(e.muted.copy(alpha = 0.25f), Offset(px(it.start), y0), Size(max(1.dp.toPx(), px(min(it.end, duration)) - px(it.start)), ph)) }
            if (multi) timeline.questions.forEach {
                drawLine(e.muted.copy(alpha = 0.6f), Offset(px(it.start), y0), Offset(px(it.start), y0 + ph), 1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 3.dp.toPx())))
                val label = measurer.measure("Q${it.idx + 1}", tick)
                drawText(label, topLeft = Offset(px(it.start) + 2.dp.toPx(), y0 - label.size.height))
            }
            // The pace line (windows are plotted at their midpoint).
            for (i in 1 until series.size) {
                drawLine(e.ink.copy(alpha = 0.55f), Offset(px(series[i - 1].t + 5), py(series[i - 1].wpm)), Offset(px(series[i].t + 5), py(series[i].wpm)), 2.dp.toPx())
            }
            shown.forEach { m ->
                val c = Offset(px(m.t), py(wpmAt(series, m.t)))
                if (m.id == focus) drawCircle(e.ink, 10.dp.toPx(), c, style = Stroke(1.5.dp.toPx()))
                drawMarker(m.type, c, 5.5.dp.toPx(), markerColors.getValue(m.type), e.surface)
            }
            if (player.isLoaded) drawRect(e.brand, Offset(px(min(player.currentTime, duration)) - 1.dp.toPx(), y0), Size(2.dp.toPx(), ph))
        }
        Text("seconds", Modifier.fillMaxWidth(), style = MaterialTheme.typography.labelMedium, color = e.muted, textAlign = androidx.compose.ui.text.style.TextAlign.End)
        Text(
            "Words per minute in 10-second windows, every 5 seconds. Shaded green: roughly where band-7 speakers sit.",
            style = MaterialTheme.typography.bodySmall, color = e.muted,
        )
        Legend(timeline, hidden, { t -> hidden = if (t in hidden) hidden - t else hidden + t }, player.isLoaded)
        if (picked != null) PickedDetail(picked, errors, player, onClose = { onFocus(null) })
        if (shown.isNotEmpty()) MomentList(shown, focus, ::select)
    }
}

@Composable
private fun Legend(timeline: Timeline, hidden: Set<MarkerType>, onToggle: (MarkerType) -> Unit, playing: Boolean) {
    val e = MaterialTheme.ext
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(0.dp), itemVerticalAlignment = Alignment.CenterVertically) {
        MarkerType.entries.filter { timeline.count(it) > 0 }.forEach { t ->
            val on = t !in hidden
            Surface(
                { onToggle(t) },
                Modifier.minimumInteractiveComponentSize().semantics {
                    contentDescription = "${t.label}, ${timeline.count(t)} mistakes"
                    stateDescription = if (on) "Shown" else "Hidden"
                },
                shape = CircleShape, color = if (on) e.surface2 else Color.Transparent, border = BorderStroke(1.dp, e.line),
            ) {
                Row(Modifier.padding(horizontal = 12.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    MarkerGlyph(t)
                    Text(t.label, style = MaterialTheme.typography.labelLarge, color = if (on) e.ink else e.muted)
                    Text("${timeline.count(t)}", style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum"), color = e.muted)
                }
            }
        }
        if (timeline.pauses.isNotEmpty()) Swatch(e.muted.copy(alpha = 0.25f), "Long pause")
        if (playing) Swatch(e.brand, "Playing now")
    }
}

@Composable
private fun PickedDetail(m: TimelineMarker, errors: List<AnalysisError>, player: ResultPlayer, onClose: () -> Unit) {
    val e = MaterialTheme.ext
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(e.surface2).padding(start = 12.dp, top = 0.dp, end = 4.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            MarkerGlyph(m.type)
            Text(m.type.label, style = MaterialTheme.typography.labelLarge, color = e.ink)
            Text(clock(m.t.toInt()), style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum"), color = e.muted)
            Box(Modifier.weight(1f))
            Box(Modifier.size(48.dp).clickable(role = Role.Button, onClick = onClose).semantics { contentDescription = "Close" }, contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Close, null, Modifier.size(20.dp), tint = e.muted)
            }
        }
        Box(Modifier.padding(end = 8.dp)) {
            val err = errors.firstOrNull { it.id == m.errorId }
            if (err != null) ErrorDetails(err, if (player.isLoaded) ({ player.seek(max(0.0, m.t - 0.3)) }) else null, hideCategory = true)
            else Text(m.label, style = MaterialTheme.typography.bodyMedium, color = e.ink)
        }
    }
}

/** Every dot as a list: the screen-reader route into the chart, and a precise way to pick one. */
@Composable
private fun MomentList(shown: List<TimelineMarker>, focus: String?, onSelect: (TimelineMarker) -> Unit) {
    val e = MaterialTheme.ext
    var open by remember { mutableStateOf(false) }
    Disclosure("All ${shown.size} marked ${if (shown.size == 1) "moment" else "moments"}", "All ${shown.size} marked ${if (shown.size == 1) "moment" else "moments"}", open, { open = !open })
    if (open) Column {
        shown.forEach { m ->
            Row(
                Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable { onSelect(m) }
                    .semantics { contentDescription = "${m.type.label} mistake at ${clock(m.t.toInt())}: ${m.label}" },
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                MarkerGlyph(m.type)
                Text(clock(m.t.toInt()), style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum"), color = e.muted)
                Text(m.label, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = e.ink, maxLines = 1, fontWeight = if (m.id == focus) FontWeight.SemiBold else null)
            }
        }
    }
}
