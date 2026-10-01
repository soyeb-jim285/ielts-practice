package com.soyeb.ieltspractice.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf

val LocalExtColors = staticCompositionLocalOf { LightExt }

/** Tokens beyond the Material 3 scheme: `MaterialTheme.ext.line`, `.surface2`, `.muted`, `.good`, `.goodText`, `.warn`, `.bad`, `.sky`. */
val MaterialTheme.ext: ExtColors
    @Composable @ReadOnlyComposable get() = LocalExtColors.current

/** The Ocean Teal Material 3 theme (custom colours, no dynamic colour). Wrap every screen; previews and screenshot tests set [dark]. */
@Composable
fun IeltsTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalExtColors provides if (dark) DarkExt else LightExt) {
        MaterialTheme(
            colorScheme = if (dark) DarkScheme else LightScheme,
            typography = AppTypography,
            shapes = AppShapes,
            content = content,
        )
    }
}
