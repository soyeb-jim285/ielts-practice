package com.soyeb.ieltspractice.ui.screens.writing

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.R
import com.soyeb.ieltspractice.core.Prompt
import com.soyeb.ieltspractice.core.clock
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.ext

// The small parts of the exam screen (WritingEditorScreen): timer, word bar, question toggle, toast and the in-page modal.

/** Teal never shows here: the timer and counts are state, not actions. Amber at 5 minutes, rose at 1 minute and over. */
@Composable
fun TimerChip(left: Int) {
    val e = MaterialTheme.ext
    val color = when (timerTone(left)) { Tone.Neutral -> e.ink; Tone.Warn -> e.warnText; Tone.Bad -> e.badText }
    val bg = if (timerTone(left) == Tone.Neutral) e.surface2 else color.copy(alpha = 0.12f)
    Surface(
        Modifier.semantics { contentDescription = if (left < 0) "Overtime ${clock(-left)}" else "${clock(left)} left" },
        shape = CircleShape, color = bg,
    ) {
        Row(Modifier.padding(horizontal = 10.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(painterResource(R.drawable.ic_w_timer), contentDescription = null, Modifier.size(18.dp), tint = color)
            Text(if (left < 0) "+${clock(-left)} over" else clock(left), style = MaterialTheme.typography.titleMedium.merge(AppText.num), color = color)
        }
    }
}

/** Word count against the task minimum: neutral at zero, amber near the minimum, green once reached. Never red. */
@Composable
fun WordBarCard(words: Int, need: Int, modifier: Modifier = Modifier) {
    val e = MaterialTheme.ext
    val b = wordBar(words, need)
    val tint = when (b.tint) { BarTint.Good -> e.goodText; BarTint.Warn -> e.warnText; BarTint.Muted -> e.muted }
    Surface(modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), color = e.surface, border = BorderStroke(1.dp, e.line)) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("$words / $need", Modifier.semantics { contentDescription = plural(words) }, style = MaterialTheme.typography.titleSmall.merge(AppText.num), color = tint)
                Text(b.hint, style = MaterialTheme.typography.bodySmall.merge(AppText.num), color = e.muted)
            }
            Box(
                Modifier.fillMaxWidth().height(6.dp).clip(CircleShape).background(e.surface2)
                    .semantics { contentDescription = "Progress to the minimum word count"; progressBarRangeInfo = ProgressBarRangeInfo(b.progress, 0f..1f) },
            ) {
                Box(Modifier.fillMaxHeight().fillMaxWidth(b.progress).background(if (b.tint == BarTint.Good) e.good else e.brand))
            }
        }
    }
}

/** "Question  <title>  Hide/Show". Folded, it pins above the answer as a one-line summary of the task. */
@Composable
fun QuestionToggle(p: Prompt, open: Boolean, onToggle: () -> Unit) {
    val e = MaterialTheme.ext
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp)
            .clickable(role = Role.Button, onClick = onToggle)
            .semantics { stateDescription = if (open) "Expanded" else "Collapsed" },
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("Question", style = MaterialTheme.typography.titleSmall, color = e.ink)
        if (!open) Text(p.title, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = e.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        else Box(Modifier.weight(1f))
        Text(if (open) "Hide" else "Show", style = MaterialTheme.typography.bodyMedium, color = e.muted)
        Icon(if (open) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown, contentDescription = null, Modifier.size(20.dp), tint = e.muted)
    }
}

/** The plan pad's header ("Plan (about 5 minutes, not graded)") with its expand chevron. */
@Composable
fun PlanHeader(open: Boolean, onToggle: () -> Unit) {
    val e = MaterialTheme.ext
    Row(
        Modifier.fillMaxWidth().heightIn(min = 44.dp)
            .clickable(role = Role.Button, onClick = onToggle)
            .semantics { stateDescription = if (open) "Expanded" else "Collapsed" },
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(painterResource(R.drawable.ic_w_note), contentDescription = null, Modifier.size(18.dp), tint = e.muted)
        Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Plan", style = MaterialTheme.typography.titleSmall, color = e.ink)
            Text("(about 5 minutes, not graded)", style = MaterialTheme.typography.bodyMedium, color = e.muted)
        }
        Icon(if (open) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown, contentDescription = null, Modifier.size(20.dp), tint = e.muted)
    }
}

/** A notice at the top of the screen: the 5 and 1 minute warnings, time up, and paste refused. Read out politely by TalkBack. */
data class ExamToast(val text: String, val tone: Tone, val id: Int, val paste: Boolean = false)

@Composable
fun ToastPill(t: ExamToast, modifier: Modifier = Modifier) {
    val e = MaterialTheme.ext
    val tint = if (t.tone == Tone.Bad) e.badText else if (t.tone == Tone.Warn) e.warnText else e.muted
    Surface(
        modifier.padding(horizontal = 16.dp).semantics { liveRegion = LiveRegionMode.Polite },
        shape = RoundedCornerShape(28.dp), color = e.surface, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (t.paste) Icon(Icons.Filled.Warning, contentDescription = null, Modifier.size(18.dp), tint = tint)
            else Icon(painterResource(R.drawable.ic_w_timer), contentDescription = null, Modifier.size(18.dp), tint = tint)
            Text(t.text, style = MaterialTheme.typography.titleSmall, color = e.ink)
        }
    }
}

/**
 * A confirmation drawn in the page rather than in a separate window: a scrim and a centred card. Back and a tap outside dismiss it.
 * (In-page so the screenshot tests can capture it; the content under it is hidden from TalkBack by the caller.)
 */
@Composable
fun ModalCard(title: String, onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    val e = MaterialTheme.ext
    BackHandler(onBack = onDismiss)
    Box(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.5f)).pointerInput(Unit) { detectTapGestures { onDismiss() } },
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            Modifier.padding(24.dp).widthIn(max = 420.dp).fillMaxWidth().pointerInput(Unit) { detectTapGestures { } }.semantics { paneTitle = title },
            shape = MaterialTheme.shapes.extraLarge, color = e.surface, border = BorderStroke(1.dp, e.line),
        ) {
            Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(title, Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineSmall, color = e.ink)
                content()
            }
        }
    }
}

/** A scrim with a spinner while the answer is sent; swallows touches so nothing changes mid-submit. */
@Composable
fun BusyOverlay(text: String) {
    val e = MaterialTheme.ext
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.32f)).pointerInput(Unit) { detectTapGestures { } }, contentAlignment = Alignment.Center) {
        Surface(shape = RoundedCornerShape(16.dp), color = e.surface, border = BorderStroke(1.dp, e.line)) {
            Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                CircularProgressIndicator(color = e.brand)
                Text(text, style = MaterialTheme.typography.bodyMedium, color = e.ink)
            }
        }
    }
}

