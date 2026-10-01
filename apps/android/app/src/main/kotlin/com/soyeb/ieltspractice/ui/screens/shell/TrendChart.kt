package com.soyeb.ieltspractice.ui.screens.shell

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.soyeb.ieltspractice.core.Crit
import com.soyeb.ieltspractice.core.TrendPoint
import com.soyeb.ieltspractice.core.fmt
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.ext

/** Chart series: teal, sky, slate, ink (the fourth also dashed). Green, amber and red stay reserved for good, warn and bad. */
@Composable
fun seriesColor(key: String): Color = with(MaterialTheme.ext) { when (key) { "fc", "ta" -> brand; "lr" -> sky; "gra" -> muted; else -> ink } }

fun seriesDashed(key: String) = key == "p" || key == "cc"

/** Band by criterion over the last attempts (oldest first): one line per criterion, a dashed target line, whole-band gridlines, a legend. */
@Composable
fun TrendChart(rows: List<TrendPoint>, keys: List<String>, target: Double, modifier: Modifier = Modifier) {
    val e = MaterialTheme.ext
    val measurer = rememberTextMeasurer()
    val label = MaterialTheme.typography.bodySmall.merge(AppText.num).copy(color = e.muted, fontSize = 11.sp, lineHeight = 14.sp)
    val (lo, ticks) = trendTicks(rows.flatMap { it.criteria.values }, target)
    val colors = keys.associateWith { seriesColor(it) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Canvas(
            Modifier.fillMaxWidth().height(220.dp)
                .semantics { contentDescription = "Band trend over your last ${rows.size} attempts, oldest first" },
        ) {
            val left = 26.dp.toPx(); val right = 8.dp.toPx(); val top = 16.dp.toPx(); val bottom = 22.dp.toPx()
            val pw = size.width - left - right
            val ph = size.height - top - bottom
            fun y(v: Double) = top + ((9 - v) / (9 - lo)).toFloat() * ph
            fun x(i: Int) = left + if (rows.size == 1) pw / 2 else i * pw / (rows.size - 1)

            ticks.forEach { t ->
                drawLine(e.line, Offset(left, y(t.toDouble())), Offset(size.width - right, y(t.toDouble())), 1.dp.toPx())
                val m = measurer.measure(t.toString(), label)
                drawText(m, topLeft = Offset(left - 6.dp.toPx() - m.size.width, y(t.toDouble()) - m.size.height / 2f))
            }
            val every = maxOf(1, Math.ceil(rows.size / 5.0).toInt())
            rows.indices.filter { it % every == 0 }.forEach { i ->
                val m = measurer.measure("#${i + 1}", label)
                drawText(m, topLeft = Offset(x(i) - m.size.width / 2f, size.height - bottom + 6.dp.toPx()))
            }

            // Target: a dotted rule with its label above the right end.
            val ty = y(target)
            drawLine(e.muted, Offset(left, ty), Offset(size.width - right, ty), 1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(2.dp.toPx(), 4.dp.toPx())))
            val tl = measurer.measure("Target ${fmt(target)}", label)
            drawText(tl, topLeft = Offset(size.width - right - tl.size.width, ty - tl.size.height - 2.dp.toPx()))

            keys.forEach { k ->
                val path = Path()
                var started = false
                rows.forEachIndexed { i, r ->
                    val v = r.criteria[k] ?: return@forEachIndexed
                    if (!started) { path.moveTo(x(i), y(v)); started = true } else path.lineTo(x(i), y(v))
                }
                drawPath(
                    path, colors.getValue(k),
                    style = Stroke(
                        2.5.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round,
                        pathEffect = if (seriesDashed(k)) PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 3.dp.toPx())) else null,
                    ),
                )
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            keys.forEach { k ->
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Canvas(Modifier.size(width = 18.dp, height = 3.dp)) {
                        drawLine(
                            colors.getValue(k), Offset(0f, size.height / 2), Offset(size.width, size.height / 2), 3.dp.toPx(), StrokeCap.Round,
                            pathEffect = if (seriesDashed(k)) PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx())) else null,
                        )
                    }
                    Text(Crit.label(k), style = MaterialTheme.typography.bodySmall, color = e.muted)
                }
            }
        }
    }
}
