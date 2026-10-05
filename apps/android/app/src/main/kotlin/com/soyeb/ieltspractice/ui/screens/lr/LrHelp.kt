package com.soyeb.ieltspractice.ui.screens.lr

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.ui.theme.PrimaryButton
import com.soyeb.ieltspractice.ui.theme.ext

// Mirrors: web components/lr/HelpSheet.tsx. The Help text is the same on every platform (docs/exam-fidelity.md section 5).

private val HELP = listOf(
    "Navigation" to "Use the question numbers at the bottom to jump; Next and Back move one question. Part tabs switch parts (in Listening exam the recording moves parts for you).",
    "Flag for review" to "Flag a question you want to come back to. Flagged questions are marked in the navigator and listed when you submit.",
    "Highlight and notes" to "Select text and choose Highlight or Add note (long-press on touch). Tap a highlight to remove it or open its note. Notes are kept on this device and are never sent anywhere.",
    "Settings" to "Change text size and colours without affecting the timer.",
    "Hide" to "Covers the test; the clock keeps running (and the recording keeps playing in Listening).",
    "Submit" to "You can submit early; unanswered questions are listed first.",
)

@Composable
fun HelpSheet(onDismiss: () -> Unit) {
    val e = MaterialTheme.ext
    LrSheet(onDismiss) {
        Text("Help", style = MaterialTheme.typography.headlineSmall, color = e.ink, modifier = Modifier.semantics { heading() })
        HELP.forEachIndexed { i, (h, t) ->
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("${i + 1}. $h", style = MaterialTheme.typography.titleSmall, color = e.ink, fontWeight = FontWeight.SemiBold)
                Text(t, style = MaterialTheme.typography.bodyMedium, color = e.muted)
            }
        }
    }
}

/** Covers the tabs and test content; the clock and recording carry on underneath. Announced when it appears; Show takes focus. */
@Composable
fun HidePanel(listening: Boolean, onShow: () -> Unit, modifier: Modifier = Modifier) {
    val e = MaterialTheme.ext
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    Box(
        modifier.background(e.bg).clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
        contentAlignment = Alignment.Center,
    ) {
        Column(Modifier.padding(24.dp).semantics { liveRegion = LiveRegionMode.Polite }, verticalArrangement = Arrangement.spacedBy(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Test hidden", style = MaterialTheme.typography.headlineSmall, color = e.ink, modifier = Modifier.semantics { heading() })
            Text("The clock is still running.", style = MaterialTheme.typography.bodyLarge, color = e.muted)
            if (listening) Text("The recording is still playing.", style = MaterialTheme.typography.bodyLarge, color = e.muted)
            PrimaryButton("Show", onShow, Modifier.focusRequester(focus))
        }
    }
}
