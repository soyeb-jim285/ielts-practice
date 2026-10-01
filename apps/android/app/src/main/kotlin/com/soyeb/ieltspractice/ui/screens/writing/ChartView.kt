package com.soyeb.ieltspractice.ui.screens.writing

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.soyeb.ieltspractice.core.ChartSpec
import com.soyeb.ieltspractice.core.MapSide
import com.soyeb.ieltspractice.core.fmtNum
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.ext
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

// A Task 1 figure (line / bar / pie / table / process / map) drawn natively, like the web ChartRenderer's hand-drawn SVG: no chart
// library, no tooltips, no animation. Series colours: brand, sky, slate, amber, rose, ink; dash patterns keep lines tellable apart without colour.
// Sky is allowed here (charts only). Past six series the palette repeats as lighter tints so neighbours never share a colour.

private val dashes = listOf<List<Float>?>(null, listOf(6f, 3f), listOf(2f, 3f), listOf(10f, 4f, 2f, 4f), listOf(1f, 2f), listOf(8f, 2f))

@Composable
private fun palette(): List<Color> {
    val e = MaterialTheme.ext
    val slate = if (e.isDark) Color(0xFF94A3B8) else Color(0xFF64748B) // web --chart-3
    return listOf(e.brand, e.sky, slate, e.warn, e.bad, e.ink)
}

private fun List<Color>.series(i: Int) = if (i < size) this[i] else this[i % size].copy(alpha = 0.55f)

/** Round axis ticks from [lo] to [hi]: steps of 1, 2, 2.5 or 5 times 10^k, about 5 of them (port of web niceTicks). */
fun niceTicks(lo: Double, hiIn: Double): List<Double> {
    val hi = if (hiIn == lo) lo + 1 else hiIn
    val raw = (hi - lo) / 5
    val mag = 10.0.pow(floor(log10(raw)))
    val step = listOf(1.0, 2.0, 2.5, 5.0, 10.0).map { it * mag }.first { it >= raw }
    val start = floor(lo / step) * step
    val out = ArrayList<Double>()
    var k = 0
    while (start + k * step < hi + step - 1e-9 && k < 40) { out += Math.round((start + k * step) * 1e9) / 1e9; k++ }
    return out
}

/** The y-axis title: the label, with the unit added when the label doesn't already say it. */
fun yAxisTitle(spec: ChartSpec): String = when {
    spec.yLabel.isEmpty() -> spec.unit
    spec.unit.isEmpty() || spec.yLabel.contains(spec.unit) -> spec.yLabel
    else -> "${spec.yLabel} (${spec.unit})"
}

/** Screen-reader summary of a line or bar chart: the underlying numbers, since the drawing is visual. */
fun describe(s: ChartSpec): String =
    "${s.kind} chart. " + s.series.joinToString(". ") { x -> "${x.name}: " + s.categories.zip(x.values).joinToString(", ") { (c, v) -> "$c ${fmtNum(v)}" } } +
        (if (s.unit.isNotEmpty()) " (${s.unit})" else "")

@Composable
fun ChartView(spec: ChartSpec, modifier: Modifier = Modifier) {
    val e = MaterialTheme.ext
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (spec.title.isNotEmpty()) {
            Text(spec.title, Modifier.fillMaxWidth(), style = MaterialTheme.typography.titleSmall, color = e.ink, textAlign = TextAlign.Center)
        }
        when (spec.kind) {
            "line", "bar" -> Cartesian(spec)
            "pie" -> Pies(spec)
            "table" -> DataTable(spec)
            "process" -> Process(spec.steps)
            "map" -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { spec.before?.let { MapCard(it) }; spec.after?.let { MapCard(it) } }
        }
    }
}

// MARK: Line and bar

private val tickFormat: NumberFormat = NumberFormat.getNumberInstance(Locale.US).apply { maximumFractionDigits = 1 }

@Composable
private fun Cartesian(spec: ChartSpec) {
    val e = MaterialTheme.ext
    val colors = palette()
    val measurer = rememberTextMeasurer()
    val label = MaterialTheme.typography.bodySmall.copy(color = e.muted, fontSize = 12.sp, lineHeight = 14.sp)
    val bar = spec.isBar
    val vals = spec.series.flatMap { it.values }.filter { it.isFinite() }
    val ticks = niceTicks(min(0.0, vals.minOrNull() ?: 0.0), max(0.0, vals.maxOrNull() ?: 0.0))
    val lo = ticks.first()
    val hi = ticks.last()
    val yTitle = yAxisTitle(spec)
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Canvas(Modifier.fillMaxWidth().height(260.dp).semantics { contentDescription = describe(spec) }) {
            val grid = e.muted.copy(alpha = 0.22f)
            val axis = e.muted.copy(alpha = 0.55f)
            val tickLayouts = ticks.map { measurer.measure(AnnotatedString(tickFormat.format(it)), label) }
            val left = (tickLayouts.maxOf { it.size.width } + 6.dp.toPx()) + (if (yTitle.isNotEmpty()) 28.dp.toPx() else 6.dp.toPx())
            val right = 12.dp.toPx()
            val top = 8.dp.toPx()
            val pw = max(0f, size.width - left - right)
            val n = max(1, spec.categories.size)
            val band = pw / n
            // x labels: wrap onto up to two lines; only when that still doesn't fit, show every nth on one line.
            val wrapped = spec.categories.map { c ->
                measurer.measure(AnnotatedString(c), label, overflow = TextOverflow.Clip, maxLines = 2, constraints = Constraints(maxWidth = max(1, (band - 4.dp.toPx()).toInt())))
            }
            val fits = wrapped.none { it.hasVisualOverflow }
            val single = if (fits) wrapped else spec.categories.map { measurer.measure(AnnotatedString(it), label, maxLines = 1) }
            val every = if (fits) 1 else max(1, ceil((single.maxOf { it.size.width } + 8.dp.toPx()) / max(band, 1f)).toInt())
            val labelsH = single.maxOf { it.size.height }
            val bottom = 8.dp.toPx() + labelsH + (if (spec.xLabel.isNotEmpty()) 22.dp.toPx() else 4.dp.toPx())
            val ph = size.height - top - bottom
            fun x(i: Int) = left + band * (i + 0.5f)
            fun y(v: Double) = top + ph * (1 - ((v - lo) / (hi - lo)).toFloat())

            ticks.forEachIndexed { i, t ->
                drawLine(if (t == lo) axis else grid, Offset(left, y(t)), Offset(left + pw, y(t)), 1.dp.toPx())
                val l = tickLayouts[i]
                drawText(l, topLeft = Offset(left - 6.dp.toPx() - l.size.width, y(t) - l.size.height / 2f))
            }
            drawLine(axis, Offset(left, top), Offset(left, top + ph), 1.dp.toPx())
            spec.categories.forEachIndexed { i, _ ->
                if (i % every != 0) return@forEachIndexed
                val l = single[i]
                drawText(l, topLeft = Offset(x(i) - l.size.width / 2f, top + ph + 8.dp.toPx()))
            }
            if (spec.xLabel.isNotEmpty()) {
                val l = measurer.measure(AnnotatedString(spec.xLabel), label, maxLines = 1)
                drawText(l, topLeft = Offset(left + pw / 2 - l.size.width / 2f, size.height - l.size.height - 2.dp.toPx()))
            }
            if (yTitle.isNotEmpty()) {
                val l = measurer.measure(AnnotatedString(yTitle), label, maxLines = 1, overflow = TextOverflow.Ellipsis, constraints = Constraints(maxWidth = max(1, ph.toInt())))
                val cx = 2.dp.toPx() + l.size.height / 2f
                rotate(-90f, Offset(cx, top + ph / 2)) { drawText(l, topLeft = Offset(cx - l.size.width / 2f, top + ph / 2 - l.size.height / 2f)) }
            }
            val bw = band * 0.8f / max(1, spec.series.size)
            spec.series.forEachIndexed { si, s ->
                val c = colors.series(si)
                if (bar) {
                    s.values.forEachIndexed { i, v ->
                        if (!v.isFinite()) return@forEachIndexed
                        val y0 = y(0.0)
                        val yv = y(v)
                        drawRoundRect(c, Offset(x(i) - band * 0.4f + bw * si, min(yv, y0)), Size(max(bw - 1.dp.toPx(), 1f), abs(yv - y0)), CornerRadius(2.dp.toPx()))
                    }
                } else {
                    val path = Path()
                    var open = false
                    s.values.forEachIndexed { i, v ->
                        if (!v.isFinite()) { open = false; return@forEachIndexed }
                        if (open) path.lineTo(x(i), y(v)) else path.moveTo(x(i), y(v))
                        open = true
                    }
                    drawPath(path, c, style = Stroke(2.dp.toPx(), pathEffect = dash(si)))
                    s.values.forEachIndexed { i, v -> if (v.isFinite()) drawCircle(c, 3.dp.toPx(), Offset(x(i), y(v))) }
                }
            }
        }
        if (spec.series.size > 1) Legend(spec.series.map { it.name }, colors, line = !bar)
    }
}

private fun DrawScope.dash(i: Int): PathEffect? = dashes[i % dashes.size]?.let { d -> PathEffect.dashPathEffect(d.map { it.dp.toPx() }.toFloatArray()) }

@Composable
private fun Legend(names: List<String>, colors: List<Color>, line: Boolean) {
    val e = MaterialTheme.ext
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        names.forEachIndexed { i, name ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                val c = colors.series(i)
                if (line) {
                    Canvas(Modifier.size(20.dp, 8.dp)) { drawLine(c, Offset(0f, size.height / 2), Offset(size.width, size.height / 2), 2.dp.toPx(), pathEffect = dash(i)) }
                } else {
                    Spacer(Modifier.size(10.dp).clip(RoundedCornerShape(2.dp)).background(c))
                }
                Text(name, style = MaterialTheme.typography.bodySmall, color = e.ink)
            }
        }
    }
}

// MARK: Pie

@Composable
private fun Pies(spec: ChartSpec) {
    val e = MaterialTheme.ext
    val colors = palette()
    // One shared colour per label across every pie, so "Coal" is the same colour in 1990 and 2020.
    val labels = spec.pies.flatMap { p -> p.slices.map { it.label } }.distinct()
    val unit = spec.unit.ifEmpty { "%" }
    fun value(v: Double) = if (unit == "%") "${fmtNum(v)}%" else "${fmtNum(v)} $unit"
    Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
        spec.pies.forEach { pie ->
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(pie.name, Modifier.fillMaxWidth(), style = MaterialTheme.typography.titleSmall, color = e.ink, textAlign = TextAlign.Center)
                val total = pie.slices.sumOf { it.value }.takeIf { it > 0 } ?: 1.0
                val surface = e.surface
                Canvas(Modifier.align(Alignment.CenterHorizontally).size(180.dp).clearAndSetSemantics { }) {
                    var a0 = -90f
                    pie.slices.forEach { s ->
                        val sweep = (s.value / total * 360).toFloat()
                        val c = colors.series(labels.indexOf(s.label))
                        drawArc(c, a0, sweep, true)
                        if (pie.slices.size > 1) drawArc(surface, a0, sweep, true, style = Stroke(2.dp.toPx()))
                        a0 += sweep
                    }
                }
                // The values double as the legend: swatch, label, number.
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    pie.slices.forEach { s ->
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Spacer(Modifier.size(10.dp).clip(RoundedCornerShape(2.dp)).background(colors.series(labels.indexOf(s.label))))
                            Text(s.label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = e.ink)
                            Text(value(s.value), style = MaterialTheme.typography.bodyMedium.merge(AppText.num), color = e.muted)
                        }
                    }
                }
            }
        }
    }
}

// MARK: Table

@Composable
private fun DataTable(spec: ChartSpec) {
    val e = MaterialTheme.ext
    val rows = spec.rowsText
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val n = max(1, spec.columns.size)
        val unit = maxOf(84.dp, maxWidth / (n - 1 + 1.4f)) // first column is 1.4 units wide; narrower than 84dp per column scrolls sideways
        val total = unit * (n - 1 + 1.4f)
        Surface(Modifier.horizontalScroll(rememberScrollState()), shape = RoundedCornerShape(10.dp), color = e.surface, border = BorderStroke(1.dp, e.line)) {
            Column(Modifier.width(total)) {
                @Composable fun cell(text: String, i: Int, style: TextStyle, modifier: Modifier = Modifier) =
                    Text(text, modifier.width(if (i == 0) unit * 1.4f else unit).padding(horizontal = 12.dp, vertical = 10.dp), style = style, color = e.ink, textAlign = if (i == 0) TextAlign.Start else TextAlign.End)
                Row(Modifier.background(e.surface2)) { spec.columns.forEachIndexed { i, c -> cell(c, i, MaterialTheme.typography.titleSmall) } }
                rows.forEach { r ->
                    HorizontalDivider(color = e.line)
                    Row { r.forEachIndexed { i, c -> cell(c, i, if (i == 0) MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Medium) else MaterialTheme.typography.bodyMedium.merge(AppText.num)) } }
                }
            }
        }
    }
}

// MARK: Process and map

@Composable
private fun Process(steps: List<String>) {
    val e = MaterialTheme.ext
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        steps.forEachIndexed { i, step ->
            Surface(
                Modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = "Step ${i + 1}, $step" },
                shape = RoundedCornerShape(10.dp), color = e.surface2, border = BorderStroke(1.dp, e.line),
            ) {
                Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(Modifier.size(24.dp).clip(RoundedCornerShape(6.dp)).background(e.ink), contentAlignment = Alignment.Center) {
                        Text("${i + 1}", style = MaterialTheme.typography.labelMedium.merge(AppText.num), color = e.bg)
                    }
                    Text(step, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = e.ink)
                }
            }
            if (i + 1 < steps.size) Icon(Icons.Filled.KeyboardArrowDown, contentDescription = null, Modifier.size(20.dp), tint = e.muted)
        }
    }
}

@Composable
private fun MapCard(side: MapSide) {
    val e = MaterialTheme.ext
    val line = e.muted.copy(alpha = 0.6f)
    Column(
        Modifier.fillMaxWidth()
            .semantics(mergeDescendants = true) { contentDescription = "${side.label}. ${side.features.joinToString(", ")}" }
            .clip(RoundedCornerShape(10.dp)).background(e.surface2)
            .drawBehind {
                val w = 1.dp.toPx()
                drawRoundRect(line, Offset(w / 2, w / 2), Size(size.width - w, size.height - w), CornerRadius(10.dp.toPx()), Stroke(w, pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx()))))
            }
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(side.label, Modifier.fillMaxWidth(), style = MaterialTheme.typography.titleSmall, color = e.ink, textAlign = TextAlign.Center)
        side.features.forEach { f ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Spacer(Modifier.padding(top = 9.dp).size(6.dp).clip(RoundedCornerShape(3.dp)).background(e.ink.copy(alpha = 0.5f)))
                Text(f, style = MaterialTheme.typography.bodyMedium, color = e.ink)
            }
        }
    }
}
