package com.soyeb.ieltspractice.ui.theme

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.core.Band

// Shared building blocks (ports of the iOS helpers in Core/Theme.swift). Use these instead of raw Material components so every
// screen gets the same radii, borders and colour rules. 16dp side gutters and 12dp between blocks are set by ScreenScaffold.

/** Band colour for a score against the user's target: good at/above target, warn within one band, bad otherwise. */
@Composable fun bandColor(band: Double, target: Double): Color =
    with(MaterialTheme.ext) { if (band >= target) good else if (band >= target - 1) warn else bad }

/** Text-safe variant of [bandColor] (AA on soft fills). */
@Composable fun bandTextColor(band: Double, target: Double): Color =
    with(MaterialTheme.ext) { if (band >= target) goodText else if (band >= target - 1) warnText else badText }

/** Content card: surface fill with a hairline edge (web: bg-card + border-line). Pass [onClick] to make the whole card tappable. */
@Composable
fun AppCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    padding: Dp = 16.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    val border = BorderStroke(1.dp, MaterialTheme.ext.line)
    val inner: @Composable () -> Unit = {
        Column(Modifier.fillMaxWidth().padding(padding), verticalArrangement = Arrangement.spacedBy(8.dp), content = content)
    }
    if (onClick == null) {
        Surface(modifier.fillMaxWidth(), shape = CardShape, color = MaterialTheme.ext.surface, border = border, content = inner)
    } else {
        Surface(onClick, modifier.fillMaxWidth(), shape = CardShape, color = MaterialTheme.ext.surface, border = border, content = inner)
    }
}

/** A section heading in the serif voice (web type-heading). */
@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text, modifier.fillMaxWidth().semantics { heading() },
        style = MaterialTheme.typography.titleLarge, color = MaterialTheme.ext.ink,
    )
}

/** A score as a capsule coloured against [target] (default band 7). */
@Composable
fun BandPill(band: Double, modifier: Modifier = Modifier, target: Double = 7.0) {
    Surface(
        modifier.semantics { contentDescription = "Band ${Band.format(band)}" },
        shape = CircleShape, color = bandColor(band, target).copy(alpha = 0.14f),
    ) {
        Text(
            Band.format(band), Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
            style = AppText.band(15), color = bandTextColor(band, target),
        )
    }
}

/** A small label capsule. [color] tints text and a 12% fill: use `ext.muted` (default), `ext.goodText`, `ext.warnText`, `ext.badText`, or brand. */
@Composable
fun Chip(text: String, modifier: Modifier = Modifier, color: Color = MaterialTheme.ext.muted) {
    Surface(modifier, shape = CircleShape, color = color.copy(alpha = 0.12f)) {
        Text(text, Modifier.padding(horizontal = 8.dp, vertical = 3.dp), style = MaterialTheme.typography.labelMedium, color = color)
    }
}

/** Chips that wrap onto new lines (`FlowRow`). */
@Composable
fun ChipRow(items: List<String>, modifier: Modifier = Modifier, color: Color = MaterialTheme.ext.muted) {
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        items.forEach { Chip(it, color = color) }
    }
}

/** An inline error: a real failure only (rose). */
@Composable
fun ErrorLine(message: String, modifier: Modifier = Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
        Icon(Icons.Filled.Warning, contentDescription = null, Modifier.size(18.dp).padding(top = 2.dp), tint = MaterialTheme.ext.badText)
        Text(message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.ext.badText)
    }
}

/** The one "act here" button on a screen: solid brand, 8dp corners, 48dp tall. [loading] swaps the label for a spinner. */
@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, loading: Boolean = false) {
    Button(
        onClick, modifier.heightIn(min = 48.dp), enabled = enabled && !loading, shape = ControlShape,
        colors = ButtonDefaults.buttonColors(
            containerColor = MaterialTheme.ext.brand, contentColor = MaterialTheme.ext.onBrand,
            disabledContainerColor = MaterialTheme.ext.surface2, disabledContentColor = MaterialTheme.ext.muted,
        ),
    ) {
        if (loading) CircularProgressIndicator(Modifier.size(20.dp), color = MaterialTheme.ext.onBrand, strokeWidth = 2.dp)
        else Text(text)
    }
}

/** Secondary action: a neutral grey fill (iOS `.bordered`), never teal. */
@Composable
fun SecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    FilledTonalButton(
        onClick, modifier.heightIn(min = 48.dp), enabled = enabled, shape = ControlShape,
        colors = ButtonDefaults.filledTonalButtonColors(
            containerColor = MaterialTheme.ext.surface2, contentColor = MaterialTheme.ext.ink,
            disabledContainerColor = MaterialTheme.ext.surface2, disabledContentColor = MaterialTheme.ext.muted,
        ),
    ) { Text(text) }
}
