package com.soyeb.ieltspractice.ui.screens.result

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.LocalDemo
import com.soyeb.ieltspractice.core.AnalysisError
import com.soyeb.ieltspractice.core.DiffOp
import com.soyeb.ieltspractice.core.Fix
import com.soyeb.ieltspractice.core.VocabUpgrade
import com.soyeb.ieltspractice.core.categoryLabel
import com.soyeb.ieltspractice.core.errorTitle
import com.soyeb.ieltspractice.core.fmt
import com.soyeb.ieltspractice.core.wordDiff
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.CardShape
import com.soyeb.ieltspractice.ui.theme.Chip
import com.soyeb.ieltspractice.ui.theme.ErrorLine
import com.soyeb.ieltspractice.ui.theme.Newsreader
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.bandColor
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.launch

// Small shared pieces of the result screens (iOS ResultView.swift: ResAlert, ResFilterChip, ResMeter, ResBandBar, ResDiffCard, FixCard,
// VocabRow, ErrorDetailsView, ErrorSheet, ErrorRow).

/** A spinner. In demo mode (screenshots) it is a static arc: a looping animation would keep the Compose test from ever going idle. */
@Composable
fun Busy(size: Dp = 20.dp, color: Color = MaterialTheme.ext.brand) {
    if (LocalDemo.current != null) CircularProgressIndicator({ 0.3f }, Modifier.size(size), color = color, strokeWidth = 2.dp)
    else CircularProgressIndicator(Modifier.size(size), color = color, strokeWidth = 2.dp)
}

enum class AlertTone { Bad, Warn, Info }

/** Inline notice (web Alert): tinted card, icon, optional title, optional action row. */
@Composable
fun ResAlert(tone: AlertTone, message: String, modifier: Modifier = Modifier, title: String? = null, action: (@Composable () -> Unit)? = null) {
    val e = MaterialTheme.ext
    val fill = when (tone) { AlertTone.Bad -> e.bad.copy(alpha = 0.10f); AlertTone.Warn -> e.warn.copy(alpha = 0.12f); AlertTone.Info -> e.surface2 }
    val iconColor = when (tone) { AlertTone.Bad -> e.bad; AlertTone.Warn -> e.warn; AlertTone.Info -> e.muted }
    Surface(modifier.fillMaxWidth(), shape = CardShape, color = fill, border = BorderStroke(1.dp, e.line)) {
        Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(if (tone == AlertTone.Info) Icons.Filled.Info else Icons.Filled.Warning, null, Modifier.size(22.dp), tint = iconColor)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (title != null) Text(title, style = MaterialTheme.typography.titleMedium, color = e.ink)
                Text(message, style = MaterialTheme.typography.bodyMedium, color = e.ink)
                action?.invoke()
            }
        }
    }
}

/** Text-only action in brand teal (a link): 48dp tall. */
@Composable
fun LinkButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(modifier.heightIn(min = 48.dp).clickable(role = Role.Button, onClick = onClick), contentAlignment = Alignment.CenterStart) {
        Text(text, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.ext.brand)
    }
}

/** Filter chip with an optional count; selected = teal ("you are here"). 48dp tall tap target. */
@Composable
fun ResFilterChip(label: String, selected: Boolean, onClick: () -> Unit, count: Int? = null) {
    val e = MaterialTheme.ext
    Surface(
        onClick, Modifier.minimumInteractiveComponentSize().semantics { this.selected = selected }, shape = CircleShape,
        color = if (selected) e.brand else e.surface2, contentColor = if (selected) e.onBrand else e.ink,
    ) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 7.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = MaterialTheme.typography.labelLarge)
            if (count != null) Text("$count", style = MaterialTheme.typography.labelLarge.copy(fontFeatureSettings = "tnum"))
        }
    }
}

/** Thin horizontal meter (counts, lexical range). */
@Composable
fun ResMeter(fraction: Float, modifier: Modifier = Modifier, color: Color = MaterialTheme.ext.brand) {
    Box(modifier.fillMaxWidth().height(6.dp).clip(CircleShape).background(MaterialTheme.ext.surface2)) {
        Box(Modifier.fillMaxWidth(fraction.coerceIn(0f, 1f)).height(6.dp).clip(CircleShape).background(color))
    }
}

/** 0-9 band meter in the band colour against the target, with a tick at the target (web BandBar). */
@Composable
fun ResBandBar(band: Double, target: Double, label: String, modifier: Modifier = Modifier) {
    val e = MaterialTheme.ext
    val fill = bandColor(band, target)
    Canvas(
        modifier.fillMaxWidth().height(14.dp)
            .semantics { contentDescription = "$label, band ${fmt(band)}, target ${fmt(target)}" },
    ) {
        val h = 6.dp.toPx()
        val y = (size.height - h) / 2
        val r = androidx.compose.ui.geometry.CornerRadius(h / 2)
        drawRoundRect(e.surface2, androidx.compose.ui.geometry.Offset(0f, y), androidx.compose.ui.geometry.Size(size.width, h), r)
        drawRoundRect(fill, androidx.compose.ui.geometry.Offset(0f, y), androidx.compose.ui.geometry.Size(size.width * (band.coerceIn(0.0, 9.0) / 9).toFloat(), h), r)
        val x = size.width * (target.coerceIn(0.0, 9.0) / 9).toFloat() - 1.dp.toPx()
        drawRect(e.ink.copy(alpha = 0.7f), androidx.compose.ui.geometry.Offset(x, 0f), androidx.compose.ui.geometry.Size(2.dp.toPx(), size.height))
    }
}

/** Up, down or no change (web Delta); the arrow and the word say it, colour is only a hint. */
@Composable
fun ResDelta(d: Double, modifier: Modifier = Modifier, small: Boolean = false) {
    val e = MaterialTheme.ext
    val style = if (small) MaterialTheme.typography.labelMedium else MaterialTheme.typography.labelLarge
    val icon = if (d > 0) Icons.Filled.KeyboardArrowUp else if (d < 0) Icons.Filled.KeyboardArrowDown else null
    val color = if (d > 0) e.goodText else if (d < 0) e.badText else e.muted
    val text = if (d > 0) "+${fmt(d)}" else if (d < 0) "−${fmt(-d)}" else "0"
    val spoken = if (d > 0) "up ${fmt(d)}" else if (d < 0) "down ${fmt(-d)}" else "no change"
    Row(modifier.semantics(mergeDescendants = true) { contentDescription = spoken }, verticalAlignment = Alignment.CenterVertically) {
        if (icon != null) Icon(icon, null, Modifier.size(16.dp), tint = color)
        Text(text, style = style.copy(fontFeatureSettings = "tnum"), color = color)
    }
}

/** Two-or-more option control: the selected option is a raised surface (iOS segmented / part switcher). */
@Composable
fun Segmented(options: List<String>, selected: Int, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
    val e = MaterialTheme.ext
    Row(modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(e.surface2).padding(3.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        options.forEachIndexed { i, label ->
            val on = i == selected
            Box(
                Modifier.weight(1f).heightIn(min = 44.dp).clip(RoundedCornerShape(10.dp))
                    .then(if (on) Modifier.background(e.surface).border(1.dp, e.line, RoundedCornerShape(10.dp)) else Modifier)
                    .clickable(role = Role.Tab) { onSelect(i) }.semantics { this.selected = on },
                contentAlignment = Alignment.Center,
            ) {
                Text(label, Modifier.padding(horizontal = 8.dp), style = MaterialTheme.typography.labelLarge, color = if (on) e.ink else e.muted, maxLines = 1)
            }
        }
    }
}

/** Word diff with a clean-read toggle (web DiffView). */
@Composable
fun ResDiffCard(original: String, rewrite: String, cleanLabel: String, serif: Boolean) {
    val e = MaterialTheme.ext
    var clean by remember { mutableStateOf(false) }
    val style = if (serif) AppText.reading else MaterialTheme.typography.bodyLarge
    AppCard {
        Segmented(listOf("Show changes", cleanLabel), if (clean) 1 else 0, { clean = it == 1 })
        if (!clean) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { Chip("removed", color = e.badText); Chip("added", color = e.goodText) }
        val text = if (clean) AnnotatedString(rewrite) else buildAnnotatedString {
            wordDiff(original, rewrite).forEachIndexed { i, run ->
                if (i > 0) append(" ")
                when (run.op) {
                    DiffOp.Same -> append(run.text)
                    DiffOp.Removed -> withStyle(SpanStyle(color = e.badText, textDecoration = TextDecoration.LineThrough, background = e.bad.copy(alpha = 0.12f))) { append(run.text) }
                    DiffOp.Added -> withStyle(SpanStyle(color = e.goodText, background = e.good.copy(alpha = 0.12f))) { append(run.text) }
                }
            }
        }
        SelectionContainer { Text(text, style = style, color = e.ink) }
    }
}

/** One "thing to fix next": numeral, title, why it limits the band, and the before and after wording. */
@Composable
fun FixCard(index: Int, fix: Fix) {
    val e = MaterialTheme.ext
    AppCard {
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("$index", Modifier.width(24.dp), style = MaterialTheme.typography.headlineSmall, color = e.muted)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(fix.title, style = MaterialTheme.typography.titleMedium, color = e.ink)
                Text(fix.why, style = MaterialTheme.typography.bodyMedium, color = e.muted)
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(e.surface2).padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    BeforeAfter("Before", fix.before, e.muted, strike = true)
                    BeforeAfter("After", fix.after, e.goodText, strike = false)
                }
            }
        }
    }
}

@Composable
private fun BeforeAfter(label: String, text: String, color: Color, strike: Boolean) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(label, Modifier.width(48.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.ext.muted)
        Text(
            text, Modifier.weight(1f), color = color,
            style = AppText.readingSm.copy(fontSize = MaterialTheme.typography.bodyMedium.fontSize, lineHeight = MaterialTheme.typography.bodyMedium.lineHeight,
                textDecoration = if (strike) TextDecoration.LineThrough else null, fontWeight = if (strike) FontWeight.Normal else FontWeight.Medium),
        )
    }
}

@Composable
fun VocabRow(upgrade: VocabUpgrade) {
    val e = MaterialTheme.ext
    AppCard(padding = 12.dp) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(2.dp), itemVerticalAlignment = Alignment.CenterVertically) {
            Text(upgrade.original, style = AppText.readingSm.copy(fontSize = MaterialTheme.typography.bodyMedium.fontSize), color = e.muted)
            Text("→", style = MaterialTheme.typography.bodySmall, color = e.muted, modifier = Modifier.semantics { contentDescription = "try" })
            upgrade.better.forEach {
                Text(it, style = AppText.readingSm.copy(fontSize = MaterialTheme.typography.bodyMedium.fontSize, fontWeight = FontWeight.SemiBold), color = e.brand)
            }
        }
        if (upgrade.note.isNotEmpty()) Text(upgrade.note, style = MaterialTheme.typography.bodySmall, color = e.muted)
    }
}

/** "original → correction" as one wrapping run. */
@Composable
fun fixText(e: AnalysisError): AnnotatedString {
    val x = MaterialTheme.ext
    return buildAnnotatedString {
        withStyle(SpanStyle(color = x.muted, textDecoration = TextDecoration.LineThrough)) { append(e.original) }
        withStyle(SpanStyle(color = x.muted)) { append("  →  ") }
        withStyle(SpanStyle(color = x.goodText, fontWeight = FontWeight.Medium)) { append(e.correction) }
    }
}

/** Serif at body size, for the wording in mistakes and fixes. */
internal val serifBody get() = AppText.readingSm.copy(fontSize = 15.sp, lineHeight = 22.sp)

/** Severity chip: major = rose, minor = amber. */
@Composable
fun SeverityChip(severity: String) = Chip(severity, color = if (severity == "major") MaterialTheme.ext.badText else MaterialTheme.ext.warnText)

/** Original to correction, explanation, and the actions. Used inline (Language tab, "Also noted") and in the sheet. */
@Composable
fun ErrorDetails(error: AnalysisError, onPlay: (() -> Unit)? = null, hideCategory: Boolean = false) {
    val e = MaterialTheme.ext
    val api = LocalApp.current.api
    val scope = rememberCoroutineScope()
    var added by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            SeverityChip(error.severity)
            if (!hideCategory) Text(categoryLabel(error.category), style = MaterialTheme.typography.bodySmall, color = e.muted)
        }
        if (error.original.isNotEmpty() || error.correction.isNotEmpty()) Text(fixText(error), style = serifBody)
        Text(error.explanation, style = MaterialTheme.typography.bodyMedium, color = e.ink)
        failure?.let { ErrorLine(it) }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (onPlay != null) SecondaryButton("Play this bit", onPlay)
            SecondaryButton(if (added) "In your deck" else "Add to review deck", {
                scope.launch {
                    try {
                        api.addCard("Fix: \"${error.original}\"", "${error.correction}\n\n${error.explanation}", "mistake")
                        added = true
                    } catch (x: Exception) {
                        failure = x.message ?: "Couldn't add the card."
                    }
                }
            }, enabled = !added)
        }
    }
}

/** Bottom-sheet body for one mistake (the sheet frame is added by the caller). */
@Composable
fun ErrorSheetContent(error: AnalysisError, onPlay: (() -> Unit)?) {
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(errorTitle(error.category), style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.ext.ink)
        ErrorDetails(error, onPlay, hideCategory = true)
    }
}

/** A mistake in a list: severity, title, the fix, and the explanation. Tap opens the sheet. */
@Composable
fun ErrorRow(error: AnalysisError, onClick: () -> Unit, located: Boolean = true) {
    val e = MaterialTheme.ext
    Column(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            SeverityChip(error.severity)
            Text(errorTitle(error.category), Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = e.muted, maxLines = 1)
            if (!located) Text("not located", style = MaterialTheme.typography.labelMedium, color = e.muted)
        }
        if (error.original.isNotEmpty() || error.correction.isNotEmpty()) Text(fixText(error), style = serifBody)
        Text(error.explanation, style = MaterialTheme.typography.bodySmall, color = e.muted, maxLines = 3)
    }
}

/** A tappable row that opens and closes ("Show evidence"). */
@Composable
fun Disclosure(closedLabel: String, openLabel: String, open: Boolean, onToggle: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier.heightIn(min = 48.dp).clickable(role = Role.Button, onClick = onToggle).semantics { stateDescription = if (open) "Expanded" else "Collapsed" },
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(if (open) openLabel else closedLabel, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.ext.brand)
        Icon(if (open) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown, null, Modifier.size(18.dp), tint = MaterialTheme.ext.brand)
    }
}

/** A horizontally scrolling row (filter chips). */
@Composable
fun ChipScroller(content: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) { content() }
}

/** Empty-state block: title, description, optional action (iOS ContentUnavailableView). */
@Composable
fun ResUnavailable(title: String, description: String, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    val e = MaterialTheme.ext
    Column(modifier.fillMaxWidth().padding(vertical = 24.dp, horizontal = 8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.titleLarge, color = e.ink)
        Text(description, style = MaterialTheme.typography.bodyMedium, color = e.muted, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        action?.invoke()
    }
}

/** Divider-separated rows inside one card (iOS `VStack(spacing: 0)` + `.card(padding: 0)`). */
@Composable
fun RowsCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val e = MaterialTheme.ext
    Surface(modifier.fillMaxWidth(), shape = CardShape, color = e.surface, border = BorderStroke(1.dp, e.line)) {
        Column(Modifier.fillMaxWidth()) { content() }
    }
}

@Composable
fun RowDivider() = androidx.compose.material3.HorizontalDivider(color = MaterialTheme.ext.line)
