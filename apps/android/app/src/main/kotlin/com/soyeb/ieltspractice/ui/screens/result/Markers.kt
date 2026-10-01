package com.soyeb.ieltspractice.ui.screens.result

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.core.MarkerType
import com.soyeb.ieltspractice.ui.theme.ext

// How each mistake type looks (iOS Timeline.swift MarkerType.color / MarkerShape): one colour AND one shape per type so the chart reads
// without colour. Teal is never used here: it means the playhead and the word playing.

@Composable
fun MarkerType.color(): Color = with(MaterialTheme.ext) {
    when (this@color) {
        MarkerType.Grammar -> bad
        MarkerType.Vocabulary -> warn
        MarkerType.Pronunciation -> sky
        MarkerType.Fluency -> muted
    }
}

/** Underline dash pattern in dp (null = solid), so the type reads in text without colour. */
fun MarkerType.underlineDashes(): FloatArray? = when (this) {
    MarkerType.Grammar -> null
    MarkerType.Vocabulary -> floatArrayOf(5f, 3f)
    MarkerType.Pronunciation -> floatArrayOf(1.5f, 3f)
    MarkerType.Fluency -> floatArrayOf(5f, 3f, 1.5f, 3f)
}

/** Circle, square, triangle or diamond per type, centred on [c] with radius [r] (px), outlined in [edge]. */
fun DrawScope.drawMarker(type: MarkerType, c: Offset, r: Float, fill: Color, edge: Color) {
    val p = Path()
    when (type) {
        MarkerType.Grammar -> p.addOval(Rect(c, r))
        MarkerType.Vocabulary -> { val s = r * 0.85f; p.addRect(Rect(c.x - s, c.y - s, c.x + s, c.y + s)) }
        MarkerType.Pronunciation -> {
            p.moveTo(c.x, c.y - r); p.lineTo(c.x + r, c.y + r * 0.8f); p.lineTo(c.x - r, c.y + r * 0.8f); p.close()
        }
        MarkerType.Fluency -> { p.moveTo(c.x, c.y - r); p.lineTo(c.x + r, c.y); p.lineTo(c.x, c.y + r); p.lineTo(c.x - r, c.y); p.close() }
    }
    drawPath(p, fill)
    drawPath(p, edge, style = Stroke(1.dp.toPx()))
}

/** A type's shape in its colour, decorative (the text next to it names the type). */
@Composable
fun MarkerGlyph(type: MarkerType, size: Dp = 10.dp, modifier: Modifier = Modifier) {
    val fill = type.color()
    val edge = MaterialTheme.ext.surface
    Canvas(modifier.size(size)) { drawMarker(type, center, this.size.minDimension / 2 - 0.5f, fill, edge) }
}
