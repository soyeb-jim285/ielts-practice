package com.soyeb.ieltspractice.ui.screens.speaking

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import android.text.format.DateUtils
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.soyeb.ieltspractice.core.Prompt
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.CardShape
import com.soyeb.ieltspractice.ui.theme.ext

// Building blocks shared by the speaking hub, the session and the live examiner.

fun Zone.color(e: com.soyeb.ieltspractice.ui.theme.ExtColors): Color = when (this) { Zone.Brand -> e.brand; Zone.Warn -> e.warn; Zone.Good -> e.good }

/** "5 minutes ago" / "just now" (web formatRelative). */
fun relativeTime(millis: Long): String {
    val now = System.currentTimeMillis()
    if (now - millis < 60_000) return "just now"
    return DateUtils.getRelativeTimeSpanString(millis, now, DateUtils.MINUTE_IN_MILLIS).toString().replaceFirstChar { it.lowercase() }
}

/** False when the system animation scale is 0 ("Remove animations"): the one decorative-motion switch we respect. */
fun animationsEnabled(context: Context): Boolean =
    runCatching { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f }.getOrDefault(true)

/** A card of rows separated by hairlines (iOS `.card(padding: 0)`), no inner gaps. */
@Composable
fun ListCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Surface(modifier.fillMaxWidth(), shape = CardShape, color = MaterialTheme.ext.surface, border = BorderStroke(1.dp, MaterialTheme.ext.line)) {
        Column(content = content)
    }
}

@Composable fun RowDivider() = HorizontalDivider(color = MaterialTheme.ext.line)

/** A warm notice: amber icon, ink title, muted text on a soft amber wash (a non-fatal condition the test works around). */
@Composable
fun Notice(title: String, text: String, modifier: Modifier = Modifier) {
    val e = MaterialTheme.ext
    Column(modifier.fillMaxWidth().background(e.warn.copy(alpha = 0.12f), CardShape).padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Warning, contentDescription = null, Modifier.size(18.dp), tint = e.warn)
            Text(title, style = MaterialTheme.typography.titleSmall, color = e.ink)
        }
        Text(text, style = MaterialTheme.typography.bodyMedium, color = e.muted)
    }
}

@Composable
fun ConfirmDialog(
    title: String, message: String, confirm: String, onConfirm: () -> Unit, onDismiss: () -> Unit,
    dismissLabel: String = "Cancel", destructive: Boolean = false,
) {
    val e = MaterialTheme.ext
    AlertDialog(
        onDismissRequest = onDismiss, containerColor = e.surface, titleContentColor = e.ink, textContentColor = e.muted,
        title = { Text(title) }, text = { Text(message) },
        confirmButton = { TextButton({ onDismiss(); onConfirm() }) { Text(confirm, color = if (destructive) e.badText else e.brand) } },
        dismissButton = { TextButton(onDismiss) { Text(dismissLabel, color = e.ink) } },
    )
}

/** iOS micDeniedAlert: the microphone permission is off, with a deep link to the app's settings. */
@Composable
fun MicDeniedDialog(onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    ConfirmDialog(
        "Microphone access is off", "IELTS Practice needs the microphone to record your answers. Turn it on in the app's permissions in Settings.",
        "Open Settings",
        onConfirm = {
            runCatching {
                ctx.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", ctx.packageName, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
        },
        onDismiss = onDismiss,
    )
}

/** Microphone permission: `access.ask { granted -> ... }` runs the callback at once when already granted, otherwise after the system prompt. */
class MicAccess(private val context: Context, private val request: ((Boolean) -> Unit) -> Unit) {
    fun granted() = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    fun ask(onResult: (Boolean) -> Unit) { if (granted()) onResult(true) else request(onResult) }
}

@Composable
fun rememberMicAccess(): MicAccess {
    val ctx = LocalContext.current
    val pending = remember { arrayOfNulls<(Boolean) -> Unit>(1) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> pending[0]?.invoke(ok); pending[0] = null }
    return remember(launcher) { MicAccess(ctx) { cb -> pending[0] = cb; launcher.launch(Manifest.permission.RECORD_AUDIO) } }
}

/** A progress ring (web TimerRing / iOS ring): [value] 0..1 around the [line]-wide track, [content] in the middle. */
@Composable
fun TimerRing(value: Double, tone: Color, size: Dp, line: Dp, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val track = MaterialTheme.ext.muted.copy(alpha = 0.25f)
    Box(modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val w = line.toPx()
            val arc = Size(this.size.width - w, this.size.height - w)
            drawArc(track, 0f, 360f, false, Offset(w / 2, w / 2), arc, style = Stroke(w))
            drawArc(tone, -90f, 360f * value.coerceIn(0.0, 1.0).toFloat(), false, Offset(w / 2, w / 2), arc, style = Stroke(w, cap = StrokeCap.Round))
        }
        content()
    }
}

/** Part 2 cue card, set as reading material: the topic, the prompt text, and the "You should say" bullets. */
@Composable
fun CueCard(p: Prompt, modifier: Modifier = Modifier) {
    val e = MaterialTheme.ext
    val intro = cueIntro(p)
    AppCard(modifier, padding = 20.dp) {
        Text("Cue card", style = MaterialTheme.typography.labelMedium, color = e.muted)
        Text(p.title, style = MaterialTheme.typography.titleLarge, color = e.ink)
        val bullets = p.bullets.orEmpty()
        if (bullets.isNotEmpty()) {
            Text("You should say:", Modifier.padding(top = 6.dp), style = MaterialTheme.typography.titleSmall, color = e.ink)
            bullets.forEach { b ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("•", style = AppText.readingSm, color = e.muted)
                    Text(b, style = AppText.readingSm, color = e.ink)
                }
            }
        }
        // Cambridge layout: the "and explain ..." line closes the card, then the standard instruction.
        if (intro.isNotEmpty()) Text(intro, style = AppText.readingSm, color = e.ink)
        if (!p.body.contains("You will have to talk")) {
            Text(
                "You will have to talk about the topic for one to two minutes. You have one minute to think about what you are going to say. You can make some notes to help you if you wish.",
                style = MaterialTheme.typography.bodySmall, color = e.muted,
            )
        }
    }
}
