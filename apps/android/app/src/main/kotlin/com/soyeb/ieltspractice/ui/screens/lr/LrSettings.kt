package com.soyeb.ieltspractice.ui.screens.lr

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.core.AppJson
import com.soyeb.ieltspractice.ui.theme.ExtColors
import com.soyeb.ieltspractice.ui.theme.LocalExtColors
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.serialization.Serializable

// Mirrors: web components/lr/LrSettings.tsx. Text size and colour scheme of the test content only; remembered per device (docs/exam-fidelity.md section 2).

@Serializable
data class LrSettings(val size: String = "std", val scheme: String = "std")

private val SIZES = setOf("std", "lg", "xl")
private val SCHEMES = setOf("std", "bw", "cream", "yb")

/** Stored JSON `{"size":"std","scheme":"std"}` (same as web `lr:settings`); anything unreadable or unknown is the default. */
fun parseSettings(json: String?): LrSettings {
    val s = runCatching { AppJson.decodeFromString(LrSettings.serializer(), json.orEmpty()) }.getOrDefault(LrSettings())
    return LrSettings(if (s.size in SIZES) s.size else "std", if (s.scheme in SCHEMES) s.scheme else "std")
}

fun settingsJson(s: LrSettings): String = AppJson.encodeToString(LrSettings.serializer(), s)

fun LrSettings.scale(): Float = when (size) { "lg" -> 1.25f; "xl" -> 1.5f; else -> 1f }

val LocalLrScheme = staticCompositionLocalOf { "std" }

private fun palette(b: ExtColors, bg: Long, well: Long, fg: Long, soft: Long) = ExtColors(
    bg = Color(bg), surface = Color(bg), surface2 = Color(well), ink = Color(fg), muted = Color(fg), line = Color(fg),
    brand = Color(fg), brandSoft = Color(soft), onBrand = Color(bg),
    good = b.good, goodText = b.goodText, warn = b.warn, warnText = b.warnText, bad = b.bad, badText = b.badText, sky = b.sky,
    isDark = bg == 0xFF000000,
)

/** The test content area: text size and colour scheme applied here only, so the top bar, tabs, navigator and audio bar stay put. */
@Composable
fun ColumnScope.LrContent(s: LrSettings, content: @Composable ColumnScope.() -> Unit) {
    val e = MaterialTheme.ext
    val d = LocalDensity.current
    val pal = when (s.scheme) {
        "bw" -> palette(e, 0xFFFFFFFF, 0xFFEDEDED, 0xFF000000, 0xFFE0E0E0)
        "cream" -> palette(e, 0xFFF5EFDC, 0xFFE8E0C4, 0xFF000000, 0xFFDDD2A8)
        "yb" -> palette(e, 0xFF000000, 0xFF1F1F00, 0xFFFFE600, 0xFF3A3500)
        else -> null
    }
    val inner: @Composable () -> Unit = {
        CompositionLocalProvider(LocalLrScheme provides s.scheme, LocalDensity provides Density(d.density, d.fontScale * s.scale())) {
            Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp), content = content)
        }
    }
    if (pal == null) Box(Modifier.weight(1f).fillMaxWidth()) { inner() }
    else CompositionLocalProvider(LocalExtColors provides pal) {
        val cs = MaterialTheme.colorScheme
        MaterialTheme(
            colorScheme = cs.copy(
                outline = pal.ink, outlineVariant = pal.ink, primary = pal.brand, onPrimary = pal.onBrand, primaryContainer = pal.brandSoft, onPrimaryContainer = pal.ink,
                surface = pal.surface, background = pal.bg, onSurface = pal.ink, onBackground = pal.ink, surfaceVariant = pal.surface2, onSurfaceVariant = pal.ink,
            ),
            typography = MaterialTheme.typography, shapes = MaterialTheme.shapes,
        ) {
            Surface(Modifier.weight(1f).fillMaxWidth(), shape = RoundedCornerShape(12.dp), color = pal.bg, contentColor = pal.ink) {
                Box(Modifier.padding(8.dp)) { inner() }
            }
        }
    }
}

@Composable
private fun RadioGroup(title: String, options: List<Pair<String, String>>, value: String, onPick: (String) -> Unit) {
    val e = MaterialTheme.ext
    Column(Modifier.selectableGroup(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(title, style = MaterialTheme.typography.titleSmall, color = e.ink, modifier = Modifier.semantics { heading() })
        options.forEach { (k, label) ->
            Row(
                Modifier.fillMaxWidth().heightIn(min = 48.dp).selectable(k == value, role = Role.RadioButton) { onPick(k) },
                horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
            ) {
                RadioButton(k == value, null)
                Text(label, style = MaterialTheme.typography.bodyLarge, color = e.ink)
            }
        }
    }
}

@Composable
fun SettingsSheet(s: LrSettings, onChange: (LrSettings) -> Unit, onDismiss: () -> Unit) {
    val e = MaterialTheme.ext
    LrSheet(onDismiss) {
        Text("Settings", style = MaterialTheme.typography.headlineSmall, color = e.ink, modifier = Modifier.semantics { heading() })
        Text("Applies to the questions and passage only, not the timer.", style = MaterialTheme.typography.bodySmall, color = e.muted)
        RadioGroup("Text size", listOf("std" to "Standard (100%)", "lg" to "Large (125%)", "xl" to "Extra large (150%)"), s.size) { onChange(s.copy(size = it)) }
        RadioGroup("Colour scheme", listOf("std" to "Standard", "bw" to "Black on white", "cream" to "Black on cream", "yb" to "Yellow on black"), s.scheme) { onChange(s.copy(scheme = it)) }
        SecondaryButton("Reset to default", { onChange(LrSettings()) })
    }
}
