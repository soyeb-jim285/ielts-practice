package com.soyeb.ieltspractice.ui.screens

import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.LocalDemo
import com.soyeb.ieltspractice.ui.ScreenScaffold
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.SectionTitle
import com.soyeb.ieltspractice.ui.theme.ext

/**
 * The stand-in every screen starts as. When you build a screen, delete its PlaceholderScreen call and write the real UI with
 * ScreenScaffold; keep the file, the composable name and its parameters (AppNavHost and the screenshot catalog depend on them).
 *
 * [ios] / [web] name the files the screen must match in features, flow and copy.
 */
@Composable
fun PlaceholderScreen(
    title: String, nav: AppNav, ios: String, web: String, root: Boolean = false,
    extra: @Composable ColumnScope.() -> Unit = {},
) {
    val api = LocalApp.current.api
    val me by api.me.collectAsState()
    val token by api.token.collectAsState()
    ScreenScaffold(title, large = root, onBack = if (root) null else nav::back) {
        AppCard {
            SectionTitle(title)
            // TODO(android): replace this placeholder with the real screen (feature, flow and copy parity with iOS and web).
            Text("TODO: build this screen.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.ext.ink)
            Text("iOS: $ios", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.ext.muted)
            Text("Web: $web", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.ext.muted)
        }
        AppCard {
            // Foundation smoke check, also what the screenshots show: auth state and the /api/me round trip.
            val who = me?.user?.name ?: if (token == null) "Browsing as a guest" else "Loading your account..."
            Text(who, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.ext.ink)
            LocalDemo.current?.let { Text("Demo mode: answers come from fixtures.json", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.ext.muted) }
        }
        extra()
    }
}
