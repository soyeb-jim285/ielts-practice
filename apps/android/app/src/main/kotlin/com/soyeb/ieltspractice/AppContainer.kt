package com.soyeb.ieltspractice

import android.content.Context
import androidx.compose.runtime.staticCompositionLocalOf
import com.soyeb.ieltspractice.core.ApiClient
import com.soyeb.ieltspractice.core.DemoCommunity
import com.soyeb.ieltspractice.core.DemoConfig
import com.soyeb.ieltspractice.core.DemoFixtures
import com.soyeb.ieltspractice.core.DemoInterceptor
import com.soyeb.ieltspractice.core.KeystoreTokenStore
import com.soyeb.ieltspractice.core.MemoryTokenStore
import com.soyeb.ieltspractice.core.PendingStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import java.io.File

/**
 * The app's long-lived objects (manual DI: there are only three). Screens reach it through `LocalApp.current`.
 * In demo mode ([demo] != null) the API answers from the bundled fixtures, nothing touches the network or the keystore.
 */
class AppContainer(context: Context, val demo: DemoConfig? = null) {
    /** Outlives every screen: uploads and sign-out cleanup run here. */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val api: ApiClient
    val pending: PendingStore
    private val prefs = context.applicationContext.getSharedPreferences("ielts", Context.MODE_PRIVATE)

    /** Question bank for random speaking tests (web: useQuestionSource): "any", "cambridge" or "generated", remembered on this device. */
    var speakingSource: String
        get() = prefs.getString("questionSource:speaking", null) ?: "any"
        set(v) { prefs.edit().putString("questionSource:speaking", v).apply() }

    /** The `source` to send: only Cambridge-allowlisted accounts choose; null = the server default (any visible prompt). */
    fun speakingSourceParam(): String? = speakingSource.takeIf { api.me.value?.cambridgeAccess == true && (it == "cambridge" || it == "generated") }

    init {
        val app = context.applicationContext
        api = if (demo == null) {
            ApiClient(store = KeystoreTokenStore(app), scope = scope)
        } else {
            DemoCommunity.pinClock()
            ApiClient(
                baseUrl = "https://demo.ielts.local", store = MemoryTokenStore(),
                interceptor = DemoInterceptor(DemoCommunity.overlay(DemoFixtures.load(app, demo.tour), demo.screen, demo.tab)) { name -> runCatching { app.assets.open(name).use { it.readBytes() } }.getOrNull() },
                // iOS: `-screen login` / `guest-*` show the signed-out state; a screen with "guest" in its name is signed out, except the guest's own result.
                initialToken = if (demo.screen == "login" || (DemoCommunity.guest(demo.screen) && !DemoCommunity.anonymousSession(demo.screen))) null else "demo",
                scope = scope,
            )
        }
        pending = PendingStore(File(app.filesDir, if (demo == null) "PendingRecordings" else "DemoPendingRecordings"), scope)
    }
}

val LocalApp = staticCompositionLocalOf<AppContainer> { error("LocalApp not provided: wrap content in IeltsApp") }
val LocalDemo = staticCompositionLocalOf<DemoConfig?> { null }
