package com.soyeb.ieltspractice.ui.screens.result

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.core.MarkerType
import com.soyeb.ieltspractice.core.Timeline
import com.soyeb.ieltspractice.core.clock
import com.soyeb.ieltspractice.core.fmt
import com.soyeb.ieltspractice.ui.theme.ext
import kotlin.math.abs
import kotlin.math.max

/** Floating player for the recording (web AudioBar): play/pause, a scrubber with a tick per mistake, time, speed. */
@Composable
fun ResAudioBar(player: ResultPlayer, timeline: Timeline, focus: String?, onFocus: (String) -> Unit, modifier: Modifier = Modifier) {
    val e = MaterialTheme.ext
    Surface(modifier.fillMaxWidth(), shape = RoundedCornerShape(28.dp), color = e.surface, border = BorderStroke(1.dp, e.line)) {
        Row(Modifier.padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Box(
                Modifier.size(48.dp).clickable(role = Role.Button, onClickLabel = null) { player.toggle() }
                    .semantics { contentDescription = if (player.isPlaying) "Pause recording" else "Play recording" },
                contentAlignment = Alignment.Center,
            ) { PlayPauseIcon(player.isPlaying, e.brand) }
            Scrubber(player, timeline, focus, onFocus, Modifier.weight(1f))
            Text(
                "${clock(player.currentTime.toInt())} / ${clock(player.duration.toInt())}",
                style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum"), color = e.muted, maxLines = 1,
            )
            Box(
                Modifier.size(width = 52.dp, height = 48.dp).clickable(role = Role.Button) { player.toggleSpeed() }
                    .semantics { contentDescription = if (player.speed == 1f) "Playback speed 1 times. Switch to slower, 0.75 times" else "Playback speed 0.75 times. Switch to normal speed" },
                contentAlignment = Alignment.Center,
            ) {
                Text(if (player.speed == 1f) "1×" else "0.75×", style = MaterialTheme.typography.labelMedium, color = e.ink, maxLines = 1)
            }
        }
    }
}

@Composable
private fun PlayPauseIcon(playing: Boolean, color: Color) {
    Canvas(Modifier.size(20.dp)) {
        if (playing) {
            val w = size.width * 0.28f
            drawRoundRect(color, Offset(size.width * 0.12f, 0f), Size(w, size.height), CornerRadius(2.dp.toPx()))
            drawRoundRect(color, Offset(size.width * 0.6f, 0f), Size(w, size.height), CornerRadius(2.dp.toPx()))
        } else {
            val p = Path().apply { moveTo(size.width * 0.15f, 0f); lineTo(size.width, size.height / 2); lineTo(size.width * 0.15f, size.height); close() }
            drawPath(p, color)
        }
    }
}

/** Track with a thin tick per mistake (type colour) above it and a divider per question. Tap a tick to hear it; drag to scrub. */
@Composable
private fun Scrubber(player: ResultPlayer, timeline: Timeline, focus: String?, onFocus: (String) -> Unit, modifier: Modifier) {
    val e = MaterialTheme.ext
    val colors = MarkerType.entries.map { it to it.color() }.toMap()
    val d = max(player.duration, 0.1)
    Canvas(
        modifier.widthIn(min = 80.dp).height(44.dp)
            .semantics {
                contentDescription = "Playback position"
                progressBarRangeInfo = ProgressBarRangeInfo(player.currentTime.toFloat(), 0f..d.toFloat())
                setProgress { v -> player.seek(v.toDouble(), player.isPlaying); true }
            }
            .pointerInput(timeline, d) {
                detectTapGestures { off ->
                    val w = size.width.toFloat()
                    fun x(t: Double) = w * (t / d).coerceIn(0.0, 1.0).toFloat()
                    // A tap in the tick band picks the nearest mistake within 14dp; anywhere else seeks there.
                    val m = if (off.y < 16.dp.toPx()) timeline.markers.minByOrNull { abs(x(it.t) - off.x) }?.takeIf { abs(x(it.t) - off.x) <= 14.dp.toPx() } else null
                    if (m != null) { onFocus(m.id); player.seek(max(0.0, m.t - 0.5)) } else player.seek(off.x / w * d, player.isPlaying)
                }
            }
            .pointerInput(d) {
                detectHorizontalDragGestures(onDragStart = { player.seek(it.x / size.width * d, player.isPlaying) }) { change, _ ->
                    player.seek(change.position.x / size.width * d, player.isPlaying)
                }
            },
    ) {
        val w = size.width
        fun x(t: Double) = w * (t / d).coerceIn(0.0, 1.0).toFloat()
        val cur = player.currentTime
        timeline.questions.drop(1).forEach { drawRect(e.muted.copy(alpha = 0.7f), Offset(x(it.start), 0f), Size(1.dp.toPx(), 28.dp.toPx())) }
        val r = CornerRadius(2.dp.toPx())
        drawRoundRect(e.surface2, Offset(0f, 20.dp.toPx()), Size(w, 4.dp.toPx()), r)
        drawRoundRect(e.ink.copy(alpha = 0.4f), Offset(0f, 20.dp.toPx()), Size(x(cur), 4.dp.toPx()), r)
        timeline.markers.forEach { m ->
            val h = (if (m.id == focus) 12 else 9).dp.toPx()
            drawRoundRect(colors.getValue(m.type), Offset(x(m.t) - 1.5.dp.toPx(), 1.dp.toPx()), Size(3.dp.toPx(), h), CornerRadius(1.5.dp.toPx()))
        }
        drawCircle(e.brand, 7.dp.toPx(), Offset(x(cur), 22.dp.toPx()))
    }
}
