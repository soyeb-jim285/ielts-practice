package com.soyeb.ieltspractice.ui

import androidx.compose.ui.test.junit4.createComposeRule
import com.soyeb.ieltspractice.ui.nav.screenCatalog
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The Listening & Reading screens at an expanded width (1280x800 dp, a tablet): `wide-light-lr-reading.png`. Reading is side by side here. */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w1280dp-h800dp-xxhdpi")
class LrWideScreenshotTest(private val case: ScreenCase) {
    @get:Rule val rule = createComposeRule()

    @Test fun capture() = captureScreen(rule, case, "wide-${case.fileName}")

    companion object {
        private val shown = setOf("lr-hub", "lr-reading", "lr-reading-questions", "lr-listening", "lr-listening-exam", "lr-result", "lr-navigator")

        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
        fun cases(): List<Array<Any>> = screenCatalog.filter { it.name in shown }.flatMap { s ->
            (s.variants.ifEmpty { listOf(null) }).flatMap { v -> listOf(false, true).map { d -> arrayOf<Any>(ScreenCase(s.name, v, d)) } }
        }
    }
}
