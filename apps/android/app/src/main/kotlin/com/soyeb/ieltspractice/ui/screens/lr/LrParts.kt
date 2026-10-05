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
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import com.soyeb.ieltspractice.ui.screens.speaking.animationsEnabled
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.LocalDemo
import com.soyeb.ieltspractice.R
import com.soyeb.ieltspractice.core.LrPassage
import com.soyeb.ieltspractice.core.LrSection
import com.soyeb.ieltspractice.core.TextSpan
import com.soyeb.ieltspractice.core.clock
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.ext

// Small pieces of the runner and the result: passage, question navigator, clock, save status, bottom sheet.

/** The reading passage in the book serif. Paragraph letters sit in a gutter. Long-press selects text to copy. */
@Composable
fun PassageView(p: LrPassage, modifier: Modifier = Modifier, evidence: TextSpan? = null, scrollKey: Int = 0, hl: Marks? = null, part: Int = 0) {
    val e = MaterialTheme.ext
    SelectionContainer {
        Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(p.title, Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineSmall, color = e.ink)
            p.subtitle?.let { Text(it, style = AppText.readingSm, color = e.muted, fontStyle = FontStyle.Italic) }
            val labelled = p.paragraphs.any { it.label != null }
            p.paragraphs.forEachIndexed { pi, para ->
                // "### " marks a text heading (GT reading); "• " lines are bullets
                if (para.text.startsWith("### ")) {
                    Text(para.text.removePrefix("### "), Modifier.semantics { heading() }.padding(top = 4.dp), style = AppText.reading.copy(fontWeight = FontWeight.SemiBold), color = e.ink)
                    return@forEachIndexed
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (labelled) Box(Modifier.size(28.dp).padding(top = 3.dp), contentAlignment = Alignment.Center) {
                        if (para.label != null) Box(Modifier.size(24.dp).background(e.surface2, RoundedCornerShape(6.dp)), contentAlignment = Alignment.Center) {
                            Text(para.label, style = MaterialTheme.typography.labelMedium.merge(AppText.num), color = e.muted)
                        }
                    }
                    Column(Modifier.weight(1f).semantics { if (para.label != null) contentDescription = "Paragraph ${para.label}. ${para.text}" }, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (hl != null) MarkedText(hl, "passage:$part:$pi", para.text, AppText.reading, e.ink)
                        else if (evidence?.p == pi) EvidenceText(para.text, evidence, AppText.reading, e.ink, scrollKey)
                        else para.text.split('\n').forEach { line ->
                            if (line.startsWith("• ")) Row(Modifier.padding(start = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text("•", style = AppText.reading, color = e.muted)
                                Text(line.removePrefix("• "), Modifier.weight(1f), style = AppText.reading, color = e.ink)
                            } else Text(line, style = AppText.reading, color = e.ink)
                        }
                    }
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

/** Reading exam clock tone: 0 neutral, 1 warn under 10:00, 2 strong under 5:00. Only when the limit is above 10 minutes (a one-passage attempt has 20, so it applies). */
fun readingTone(left: Int, limit: Int): Int = if (limit <= 600) 0 else if (left <= 300) 2 else if (left <= 600) 1 else 0

/** The first 10 seconds after each of the two marks: the clock flashes. */
fun readingPulse(left: Int, limit: Int): Boolean = limit > 600 && (left in 291..300 || left in 591..600)

/**
 * A timer pill. [tone] is 0 neutral, 1 warn, 2 strong; [pulse] flashes it at 1 Hz (not with animations removed). With [announce], each rise of
 * the tone is spoken once ("10 minutes remaining", "5 minutes remaining") through a polite live region; the pill's own label stays the time.
 */
@Composable
fun ClockPill(seconds: Int, countdown: Boolean, label: String, modifier: Modifier = Modifier, tone: Int = 0, pulse: Boolean = false, announce: Boolean = false) {
    val e = MaterialTheme.ext
    val context = LocalContext.current
    val animated = remember { animationsEnabled(context) }
    val flashing = pulse && animated
    val beat = if (flashing) {
        val a by rememberInfiniteTransition(label = "clock").animateFloat(0f, 1f, infiniteRepeatable(tween(500), RepeatMode.Reverse), label = "beat")
        a
    } else 0f
    val (bg, fg) = when {
        !countdown || tone == 0 -> e.surface2 to e.ink
        tone >= 2 -> e.bad.copy(alpha = 0.14f + 0.3f * beat) to e.badText
        else -> e.warn.copy(alpha = 0.16f + 0.3f * beat) to e.warnText
    }
    var said by remember { mutableStateOf("") }
    var last by remember { mutableIntStateOf(tone) }
    LaunchedEffect(tone) {
        if (announce && tone > last) said = if (tone >= 2) "5 minutes remaining" else "10 minutes remaining"
        last = tone
    }
    Row(
        modifier.heightIn(min = 40.dp).background(bg, RoundedCornerShape(8.dp)).padding(horizontal = 10.dp)
            .semantics { contentDescription = "$label: ${clock(seconds)}" },
        horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(painterResource(R.drawable.ic_w_timer), null, Modifier.size(18.dp), tint = fg)
        Text(clock(seconds), style = MaterialTheme.typography.titleMedium.merge(AppText.num), color = fg)
        if (said.isNotEmpty()) Box(Modifier.size(1.dp).semantics { liveRegion = LiveRegionMode.Polite; contentDescription = said })
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
fun SectionPassage(s: LrSection, modifier: Modifier = Modifier, evidence: TextSpan? = null, scrollKey: Int = 0, hl: Marks? = null) { s.passage?.let { PassageView(it, modifier, evidence, scrollKey, hl, s.part) } }
