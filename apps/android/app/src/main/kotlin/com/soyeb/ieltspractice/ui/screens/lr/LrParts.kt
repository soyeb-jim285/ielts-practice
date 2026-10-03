package com.soyeb.ieltspractice.ui.screens.lr

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.LocalDemo
import com.soyeb.ieltspractice.R
import com.soyeb.ieltspractice.core.LrPassage
import com.soyeb.ieltspractice.core.LrSection
import com.soyeb.ieltspractice.core.clock
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.ext

// Small pieces of the runner and the result: passage, question navigator, clock, save status, bottom sheet.

/** The reading passage in the book serif. Paragraph letters sit in a gutter. Long-press selects text to copy. */
@Composable
fun PassageView(p: LrPassage, modifier: Modifier = Modifier) {
    val e = MaterialTheme.ext
    SelectionContainer {
        Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(p.title, Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineSmall, color = e.ink)
            p.subtitle?.let { Text(it, style = AppText.readingSm, color = e.muted, fontStyle = FontStyle.Italic) }
            p.paragraphs.forEach { para ->
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(Modifier.size(28.dp).padding(top = 3.dp), contentAlignment = Alignment.Center) {
                        if (para.label != null) Box(Modifier.size(24.dp).background(e.surface2, RoundedCornerShape(6.dp)), contentAlignment = Alignment.Center) {
                            Text(para.label, style = MaterialTheme.typography.labelMedium.merge(AppText.num), color = e.muted)
                        }
                    }
                    Text(
                        para.text, Modifier.weight(1f).semantics { if (para.label != null) contentDescription = "Paragraph ${para.label}. ${para.text}" },
                        style = AppText.reading, color = e.ink,
                    )
                }
            }
        }
    }
}

class NavPart(val part: Int, val label: String, val questions: List<Int>)

/** Question number button: teal fill = answered, amber flag = marked for review, ring = where you are. 48dp. */
@Composable
private fun QButton(n: Int, answered: Boolean, flagged: Boolean, current: Boolean, onJump: (Int) -> Unit) {
    val e = MaterialTheme.ext
    Box(
        Modifier.size(48.dp)
            .background(if (answered) e.brandSoft else e.surface, RoundedCornerShape(8.dp))
            .border(if (current) 2.dp else 1.dp, if (current) e.brand else if (answered) e.brand.copy(alpha = 0.4f) else MaterialTheme.colorScheme.outline.copy(alpha = 0.5f), RoundedCornerShape(8.dp))
            .clickable(role = Role.Button) { onJump(n) }
            .semantics { contentDescription = "Question $n, ${if (answered) "answered" else "not answered"}${if (flagged) ", flagged for review" else ""}" },
        contentAlignment = Alignment.Center,
    ) {
        Text("$n", style = MaterialTheme.typography.labelLarge.merge(AppText.num), color = if (answered) e.brand else e.muted)
        if (flagged) Icon(painterResource(R.drawable.ic_lr_flag), null, Modifier.align(Alignment.TopEnd).padding(2.dp).size(14.dp), tint = e.warn)
    }
}

/** Questions 1 to 40 grouped by part, with how many are answered in each. */
@Composable
fun QuestionNavigator(parts: List<NavPart>, answered: (Int) -> Boolean, flagged: Set<Int>, current: Int, onJump: (Int) -> Unit) {
    val e = MaterialTheme.ext
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        parts.forEach { p ->
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(p.label, style = MaterialTheme.typography.titleSmall, color = e.ink, modifier = Modifier.semantics { heading() })
                    Text("${p.questions.count(answered)} of ${p.questions.size} answered", style = MaterialTheme.typography.bodySmall.merge(AppText.num), color = e.muted)
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    p.questions.forEach { n -> QButton(n, answered(n), n in flagged, n == current, onJump) }
                }
            }
        }
    }
}

/** A timer pill. Countdowns go amber under 5 minutes and rose under 1. */
@Composable
fun ClockPill(seconds: Int, countdown: Boolean, label: String, modifier: Modifier = Modifier) {
    val e = MaterialTheme.ext
    val (bg, fg) = when {
        countdown && seconds <= 60 -> e.bad.copy(alpha = 0.14f) to e.badText
        countdown && seconds <= 300 -> e.warn.copy(alpha = 0.16f) to e.warnText
        else -> e.surface2 to e.ink
    }
    Row(
        modifier.heightIn(min = 40.dp).background(bg, RoundedCornerShape(8.dp)).padding(horizontal = 10.dp)
            .semantics { contentDescription = "$label: ${clock(seconds)}" },
        horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(painterResource(R.drawable.ic_w_timer), null, Modifier.size(18.dp), tint = fg)
        Text(clock(seconds), style = MaterialTheme.typography.titleMedium.merge(AppText.num), color = fg)
    }
}

@Composable
fun SaveIndicator(state: SaveState, modifier: Modifier = Modifier) {
    val e = MaterialTheme.ext
    Box(modifier.size(28.dp).semantics { contentDescription = state.label; liveRegion = LiveRegionMode.Polite }, contentAlignment = Alignment.Center) {
        when (state) {
            SaveState.Saved -> Icon(Icons.Filled.Check, null, Modifier.size(20.dp), tint = e.goodText)
            SaveState.Error -> Icon(Icons.Filled.Warning, null, Modifier.size(20.dp), tint = e.warnText)
            else -> Box(Modifier.size(8.dp).background(e.muted, CircleShape))
        }
    }
}

/** Bottom sheet. Robolectric (screenshot tests) cannot host the real one, so there it is drawn inline over the screen. */
@Composable
fun LrSheet(onDismiss: () -> Unit, content: @Composable () -> Unit) {
    val e = MaterialTheme.ext
    val inline = LocalDemo.current != null && Build.FINGERPRINT.contains("robolectric", ignoreCase = true)
    if (inline) {
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.32f)).clickable(onClick = onDismiss), contentAlignment = Alignment.BottomCenter) {
            Surface(Modifier.fillMaxWidth().padding(top = 96.dp), shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp), color = e.surface) {
                Column(Modifier.navigationBarsPadding().padding(horizontal = 20.dp).padding(top = 12.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.align(Alignment.CenterHorizontally).size(width = 32.dp, height = 4.dp).background(e.muted.copy(alpha = 0.5f), CircleShape))
                    content()
                }
            }
        }
    } else {
        ModalBottomSheet(onDismiss, containerColor = e.surface, contentColor = e.ink, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
            Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { content() }
        }
    }
}

/** The passage of a section, or nothing when it has none. */
@Composable
fun SectionPassage(s: LrSection, modifier: Modifier = Modifier) { s.passage?.let { PassageView(it, modifier) } }
