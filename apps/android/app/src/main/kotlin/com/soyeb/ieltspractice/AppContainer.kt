package com.soyeb.ieltspractice

import android.content.Context
import androidx.compose.runtime.staticCompositionLocalOf
import com.soyeb.ieltspractice.core.ApiClient
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

    init {
        val app = context.applicationContext
        api = if (demo == null) {
            ApiClient(store = KeystoreTokenStore(app), scope = scope)
        } else {
            ApiClient(
                baseUrl = "https://demo.ielts.local", store = MemoryTokenStore(),
                interceptor = DemoInterceptor(DemoFixtures.load(app)),
                initialToken = if (demo.screen == "login" || demo.screen?.startsWith("guest") == true) null else "demo", // iOS: `-screen login` / `guest-*` show the signed-out state
                scope = scope,
            )
        }
        pending = PendingStore(File(app.filesDir, if (demo == null) "PendingRecordings" else "DemoPendingRecordings"), scope)
    }
}

val LocalApp = staticCompositionLocalOf<AppContainer> { error("LocalApp not provided: wrap content in IeltsApp") }
val LocalDemo = staticCompositionLocalOf<DemoConfig?> { null }
