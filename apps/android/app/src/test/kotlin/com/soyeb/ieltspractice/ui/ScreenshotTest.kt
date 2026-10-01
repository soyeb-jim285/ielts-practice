package com.soyeb.ieltspractice.ui

import androidx.compose.ui.test.ComposeTimeoutException
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import com.soyeb.ieltspractice.AppContainer
import com.soyeb.ieltspractice.core.DemoConfig
import com.soyeb.ieltspractice.ui.nav.screenCatalog
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** One screenshot of a screen (optionally one of its sub-tabs) in one theme: `light-result-speaking-Overview.png`. */
data class ScreenCase(val screen: String, val variant: String?, val dark: Boolean) {
    val fileName get() = "${if (dark) "dark" else "light"}-$screen${variant?.let { "-$it" }.orEmpty()}"
    override fun toString() = fileName
}

/**
 * Renders every screen in `screenCatalog` (ui/nav/ScreenCatalog.kt), light and dark, at phone size from the demo fixtures, into
 * apps/android/screenshots/<name>.png. JVM only (Robolectric native graphics), no emulator.
 *
 * Run: `./gradlew recordRoborazziDebug` (CI does). Without Roborazzi's record flag the capture is skipped, so a plain
 * `testDebugUnitTest` is fast. To add a screen, add a row to `screenCatalog`; this class needs no change.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w412dp-h915dp-xxhdpi")
class ScreenshotTest(private val case: ScreenCase) {
    @get:Rule val rule = createComposeRule()

    @Test fun capture() {
        val demo = DemoConfig(screen = case.screen, tab = case.variant, theme = if (case.dark) "dark" else "light")
        val container = AppContainer(RuntimeEnvironment.getApplication(), demo)
        rule.setContent { IeltsApp(container, demo) }
        // Demo requests answer synchronously from fixtures but complete on an IO thread: wait until none are in flight, then let
        // the UI settle. Repeat, since a loaded screen can start follow-up requests.
        repeat(4) {
            rule.waitForIdle()
            Thread.sleep(80) // let a request that follows another one start before the counter is read
            // Soft wait: a slow CI worker must not lose the shot (the capture shows whatever state was reached).
            try { rule.waitUntil(30_000) { container.api.inflight.get() == 0 } } catch (e: ComposeTimeoutException) { println("capture ${case.fileName}: inflight=${container.api.inflight.get()} after 30s") }
        }
        rule.waitForIdle()
        rule.onRoot().captureRoboImage("../screenshots/${case.fileName}.png")
    }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
        fun cases(): List<Array<Any>> = screenCatalog.flatMap { s ->
            (s.variants.ifEmpty { listOf(null) }).flatMap { v -> listOf(false, true).map { d -> arrayOf<Any>(ScreenCase(s.name, v, d)) } }
        }
    }
}
