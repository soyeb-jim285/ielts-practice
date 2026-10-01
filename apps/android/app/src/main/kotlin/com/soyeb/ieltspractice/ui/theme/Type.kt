package com.soyeb.ieltspractice.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.soyeb.ieltspractice.R

// Hanken Grotesk for UI, Newsreader for titles and anything you read or write: the same pairing as the web (apps/web/src/styles.css).
// Both are SIL OFL 1.1 variable fonts bundled in res/font (licences in assets/licenses). Weight axis only: no optical-size axis, like the web.
private fun variable(res: Int, vararg weights: Int) =
    FontFamily(weights.map { w -> Font(res, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w))) })

val Hanken = variable(R.font.hanken_grotesk, 400, 500, 600, 700)
val Newsreader = variable(R.font.newsreader, 400, 500, 600)

private fun serif(size: Int, line: Int, weight: Int = 500, tracking: Double = -0.012) = TextStyle(
    fontFamily = Newsreader, fontWeight = FontWeight(weight), fontSize = size.sp, lineHeight = line.sp, letterSpacing = tracking.em,
)

private fun sans(size: Int, line: Int, weight: Int = 400, tracking: Double = 0.0) = TextStyle(
    fontFamily = Hanken, fontWeight = FontWeight(weight), fontSize = size.sp, lineHeight = line.sp, letterSpacing = tracking.em,
)

/**
 * Material 3 type scale on our faces. Display/headline/titleLarge are the serif (page titles, section headings: web type-title,
 * type-heading); titleMedium and below are Hanken (web type-subheading, type-body, type-caption, type-overline).
 */
val AppTypography = Typography(
    displayLarge = serif(44, 48, tracking = -0.02),
    displayMedium = serif(36, 40, tracking = -0.02),
    displaySmall = serif(32, 36, tracking = -0.02),
    headlineLarge = serif(32, 38, tracking = -0.02),
    headlineMedium = serif(28, 34, tracking = -0.016), // expanded large top app bar title
    headlineSmall = serif(24, 30),
    titleLarge = serif(22, 28), // section headings (SectionTitle); collapsed top app bar title
    titleMedium = sans(16, 22, 600),
    titleSmall = sans(15, 21, 600, -0.005),
    bodyLarge = sans(16, 24),
    bodyMedium = sans(15, 24),
    bodySmall = sans(13, 19),
    labelLarge = sans(15, 20, 600), // buttons
    labelMedium = sans(13, 17, 500),
    labelSmall = sans(11, 14, 600, 0.08), // overline: one per view, never above every section
)

/** Styles with no Material slot. Colour is applied by the caller (`ext.ink`, `ext.muted`). */
object AppText {
    /** Essays, transcripts, prompts, cue cards (web type-reading). */
    val reading = serif(18, 30, 400, -0.003)

    /** Reading-size serif for list items: prompt titles, before/after pairs (web type-reading-sm). */
    val readingSm = serif(17, 25, 400, -0.003)

    /** Band numerals: Hanken semibold, tabular lining figures, tight (web type-band). */
    fun band(size: Int) = TextStyle(
        fontFamily = Hanken, fontWeight = FontWeight.SemiBold, fontSize = size.sp, lineHeight = size.sp,
        letterSpacing = (-0.025).em, fontFeatureSettings = "tnum, lnum",
    )

    /** Scores, timers, counts: figures must not jiggle as they change (web type-num). */
    val num = TextStyle(fontFamily = Hanken, fontFeatureSettings = "tnum, lnum")
}
