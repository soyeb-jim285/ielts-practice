package com.soyeb.ieltspractice.ui

import androidx.compose.ui.graphics.Color
import com.soyeb.ieltspractice.ui.theme.DarkExt
import com.soyeb.ieltspractice.ui.theme.DarkScheme
import com.soyeb.ieltspractice.ui.theme.ExtColors
import com.soyeb.ieltspractice.ui.theme.LightExt
import com.soyeb.ieltspractice.ui.theme.LightScheme
import kotlin.math.pow
import kotlin.test.Test
import kotlin.test.assertTrue

/** WCAG AA for the Ocean Teal pairs the components use: 4.5:1 for text, 3:1 for control edges. Fails the build if a token drifts. */
class ContrastTest {
    private fun lum(c: Color): Double {
        fun ch(v: Float) = v.toDouble().let { if (it <= 0.03928) it / 12.92 else ((it + 0.055) / 1.055).pow(2.4) }
        return 0.2126 * ch(c.red) + 0.7152 * ch(c.green) + 0.0722 * ch(c.blue)
    }

    private fun ratio(a: Color, b: Color) = (maxOf(lum(a), lum(b)) + 0.05) / (minOf(lum(a), lum(b)) + 0.05)

    private fun check(name: String, e: ExtColors, scheme: androidx.compose.material3.ColorScheme) {
        val text = listOf(
            "ink/bg" to (e.ink to e.bg), "ink/surface" to (e.ink to e.surface), "muted/bg" to (e.muted to e.bg),
            "muted/surface" to (e.muted to e.surface), "muted/surface2" to (e.muted to e.surface2),
            "brand/surface" to (e.brand to e.surface), "brand/bg" to (e.brand to e.bg), "onBrand/brand" to (e.onBrand to e.brand),
            "brand/brandSoft" to (e.brand to e.brandSoft),
            "goodText/surface" to (e.goodText to e.surface), "warnText/surface" to (e.warnText to e.surface),
            "badText/surface" to (e.badText to e.surface), "bad/bg" to (e.bad to e.bg),
            "onPrimaryContainer/primaryContainer" to (scheme.onPrimaryContainer to scheme.primaryContainer),
            "onError/error" to (scheme.onError to scheme.error),
            "onErrorContainer/errorContainer" to (scheme.onErrorContainer to scheme.errorContainer),
        )
        text.forEach { (label, p) -> assertTrue(ratio(p.first, p.second) >= 4.5, "$name $label = ${ratio(p.first, p.second)}") }
        assertTrue(ratio(scheme.outline, e.surface) >= 3.0, "$name outline/surface = ${ratio(scheme.outline, e.surface)}")
        assertTrue(ratio(scheme.outline, e.bg) >= 3.0, "$name outline/bg = ${ratio(scheme.outline, e.bg)}")
    }

    @Test fun light() = check("light", LightExt, LightScheme)
    @Test fun dark() = check("dark", DarkExt, DarkScheme)
}
