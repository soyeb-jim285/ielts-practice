package com.soyeb.ieltspractice.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color

// Ocean Teal, mirroring the web tokens in apps/web/src/styles.css and iOS Core/Theme.swift (DESIGN.md, docs/design-system.md).
// Teal means "act here" or "you are here"; green/amber/rose are band thresholds and real errors only; sky is for charts only.
// Material 3 has no dynamic colour here: the schemes below are fixed. Read the extra tokens with `MaterialTheme.ext`.

/** The Ocean Teal tokens that have no Material 3 slot. Access: `MaterialTheme.ext.line`, `MaterialTheme.ext.goodText`. */
@Immutable
class ExtColors(
    val bg: Color,
    val surface: Color,
    /** Inset wells, tracks, segmented backgrounds (web --surface-2). */
    val surface2: Color,
    val ink: Color,
    val muted: Color,
    /** Hairline edges: card borders, dividers. Decorative only (not enough contrast for a control edge; use `colorScheme.outline`). */
    val line: Color,
    val brand: Color,
    val brandSoft: Color,
    /** Text/icons on a solid brand fill. */
    val onBrand: Color,
    val good: Color,
    /** Text-safe variant of [good] (AA on soft fills). */
    val goodText: Color,
    val warn: Color,
    val warnText: Color,
    val bad: Color,
    val badText: Color,
    /** Second data colour for charts only; never a UI accent. */
    val sky: Color,
    val isDark: Boolean,
)

val LightExt = ExtColors(
    bg = Color(0xFFF7F9FB), surface = Color(0xFFFFFFFF), surface2 = Color(0xFFEEF2F6),
    ink = Color(0xFF0F172A), muted = Color(0xFF5B6B80), line = Color(0xFFE3E8EF),
    brand = Color(0xFF0F766E), brandSoft = Color(0xFFDDF3EF), onBrand = Color(0xFFFFFFFF),
    good = Color(0xFF15803D), goodText = Color(0xFF166534),
    warn = Color(0xFFB45309), warnText = Color(0xFF92400E),
    bad = Color(0xFFBE123C), badText = Color(0xFFBE123C),
    sky = Color(0xFF0284C7), isDark = false,
)

val DarkExt = ExtColors(
    bg = Color(0xFF0A111C), surface = Color(0xFF111B2B), surface2 = Color(0xFF172338),
    ink = Color(0xFFE6EDF5), muted = Color(0xFF8C9AAE), line = Color(0xFF1D293B),
    brand = Color(0xFF2DD4BF), brandSoft = Color(0xFF0E2F33), onBrand = Color(0xFF042F2C),
    good = Color(0xFF4ADE80), goodText = Color(0xFF4ADE80),
    warn = Color(0xFFFBBF24), warnText = Color(0xFFFBBF24),
    bad = Color(0xFFFB7185), badText = Color(0xFFFB7185),
    sky = Color(0xFF38BDF8), isDark = true,
)

// Control edges (text fields, outlined chips) need 3:1 against the surface (WCAG 1.4.11), so `outline` is darker than `line`.
val LightScheme: ColorScheme = lightColorScheme(
    primary = LightExt.brand, onPrimary = LightExt.onBrand,
    primaryContainer = LightExt.brandSoft, onPrimaryContainer = Color(0xFF0B4F4A),
    secondary = LightExt.muted, onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = LightExt.surface2, onSecondaryContainer = LightExt.ink,
    tertiary = LightExt.sky, onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFE0F2FE), onTertiaryContainer = Color(0xFF075985),
    error = LightExt.bad, onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFE4EA), onErrorContainer = Color(0xFF881337),
    background = LightExt.bg, onBackground = LightExt.ink,
    surface = LightExt.surface, onSurface = LightExt.ink,
    surfaceVariant = LightExt.surface2, onSurfaceVariant = LightExt.muted,
    surfaceTint = LightExt.brand,
    inverseSurface = LightExt.ink, inverseOnSurface = LightExt.bg, inversePrimary = DarkExt.brand,
    outline = Color(0xFF7A8AA0), outlineVariant = LightExt.line,
    scrim = Color(0xFF000000),
    surfaceBright = LightExt.surface, surfaceDim = LightExt.surface2,
    surfaceContainerLowest = LightExt.surface, surfaceContainerLow = LightExt.surface, surfaceContainer = LightExt.surface,
    surfaceContainerHigh = LightExt.surface2, surfaceContainerHighest = LightExt.surface2,
)

val DarkScheme: ColorScheme = darkColorScheme(
    primary = DarkExt.brand, onPrimary = DarkExt.onBrand,
    primaryContainer = DarkExt.brandSoft, onPrimaryContainer = Color(0xFF99F6E4),
    secondary = DarkExt.muted, onSecondary = DarkExt.bg,
    secondaryContainer = DarkExt.surface2, onSecondaryContainer = DarkExt.ink,
    tertiary = DarkExt.sky, onTertiary = Color(0xFF082F49),
    tertiaryContainer = Color(0xFF0C4A6E), onTertiaryContainer = Color(0xFFBAE6FD),
    error = DarkExt.bad, onError = Color(0xFF3B0613),
    errorContainer = Color(0xFF4C0519), onErrorContainer = Color(0xFFFFD6DD),
    background = DarkExt.bg, onBackground = DarkExt.ink,
    surface = DarkExt.surface, onSurface = DarkExt.ink,
    surfaceVariant = DarkExt.surface2, onSurfaceVariant = DarkExt.muted,
    surfaceTint = DarkExt.brand,
    inverseSurface = DarkExt.ink, inverseOnSurface = DarkExt.bg, inversePrimary = LightExt.brand,
    outline = Color(0xFF5F7088), outlineVariant = DarkExt.line,
    scrim = Color(0xFF000000),
    surfaceBright = DarkExt.surface2, surfaceDim = DarkExt.bg,
    surfaceContainerLowest = DarkExt.bg, surfaceContainerLow = DarkExt.surface, surfaceContainer = DarkExt.surface,
    surfaceContainerHigh = DarkExt.surface2, surfaceContainerHighest = DarkExt.surface2,
)
