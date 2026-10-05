package com.soyeb.ieltspractice.ui

import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.core.tween
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import android.content.Context
import com.soyeb.ieltspractice.core.FairUseAck
import com.soyeb.ieltspractice.ui.community.GateHost
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import com.soyeb.ieltspractice.AppContainer
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.LocalDemo
import com.soyeb.ieltspractice.core.DemoConfig
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.AttemptResult
import com.soyeb.ieltspractice.ui.nav.Bank
import com.soyeb.ieltspractice.ui.nav.History
import com.soyeb.ieltspractice.ui.nav.HomeTab
import com.soyeb.ieltspractice.ui.nav.LiveExam
import com.soyeb.ieltspractice.ui.nav.Login
import com.soyeb.ieltspractice.ui.nav.LrHub
import com.soyeb.ieltspractice.ui.nav.MockHub
import com.soyeb.ieltspractice.ui.nav.MockLive
import com.soyeb.ieltspractice.ui.nav.MockStart
import com.soyeb.ieltspractice.ui.nav.LrResult
import com.soyeb.ieltspractice.ui.nav.LrRun
import com.soyeb.ieltspractice.ui.screens.lr.LrHubScreen
import com.soyeb.ieltspractice.ui.screens.lr.LrResultScreen
import com.soyeb.ieltspractice.ui.screens.lr.LrRunScreen
import com.soyeb.ieltspractice.ui.nav.Mistakes
import com.soyeb.ieltspractice.ui.nav.ReviewTab
import com.soyeb.ieltspractice.ui.nav.SettingsTab
import com.soyeb.ieltspractice.ui.nav.SpeakingSession
import com.soyeb.ieltspractice.ui.nav.SpeakingTab
import com.soyeb.ieltspractice.ui.nav.Tab
import com.soyeb.ieltspractice.ui.nav.WritingEditor
import com.soyeb.ieltspractice.ui.nav.WritingTab
import com.soyeb.ieltspractice.ui.nav.startFor
import com.soyeb.ieltspractice.ui.screens.BankScreen
import com.soyeb.ieltspractice.ui.screens.DashboardScreen
import com.soyeb.ieltspractice.ui.screens.HistoryScreen
import com.soyeb.ieltspractice.ui.screens.LiveExamScreen
import com.soyeb.ieltspractice.ui.screens.MockHubScreen
import com.soyeb.ieltspractice.ui.screens.MockStartScreen
import com.soyeb.ieltspractice.ui.screens.LoginScreen
import com.soyeb.ieltspractice.ui.screens.MistakesScreen
import com.soyeb.ieltspractice.ui.screens.ResultScreen
import com.soyeb.ieltspractice.ui.screens.ReviewScreen
import com.soyeb.ieltspractice.ui.screens.SettingsScreen
import com.soyeb.ieltspractice.ui.screens.SpeakingHomeScreen
import com.soyeb.ieltspractice.ui.screens.SpeakingSessionScreen
import com.soyeb.ieltspractice.ui.screens.WritingEditorScreen
import com.soyeb.ieltspractice.ui.screens.WritingHomeScreen
import com.soyeb.ieltspractice.ui.theme.IeltsTheme
import com.soyeb.ieltspractice.ui.theme.ext

/** The whole app. [demo] (null in production) picks the start screen and theme for screenshots. */
@Composable
fun IeltsApp(container: AppContainer, demo: DemoConfig? = null) {
    val dark = demo?.dark ?: isSystemInDarkTheme()
    CompositionLocalProvider(LocalApp provides container, LocalDemo provides demo) {
        IeltsTheme(dark) {
            LaunchedEffect(container) { container.api.restoreSession() }
            AppNavHost(start = startFor(demo?.screen))
        }
    }
}

// Short, plain fades: no decorative motion (Android's animator-duration scale / "remove animations" still applies).
private val Enter: EnterTransition = fadeIn(tween(120))
private val Exit: ExitTransition = fadeOut(tween(120))

/**
 * One NavHost: the five tab roots plus every pushed route (add new routes in ui/nav/Routes.kt, then a `composable<...>` here).
 * The bottom bar shows on tab roots only; pushed screens are full screen with a back arrow, the Android convention.
 */
@Composable
private fun AppNavHost(start: Any) {
    val api = LocalApp.current.api
    val controller = rememberNavController()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val demo = LocalDemo.current
    val nav = remember(controller) {
        AppNav(controller, api, scope, FairUseAck(if (demo == null) context.applicationContext.getSharedPreferences("ielts", Context.MODE_PRIVATE) else null))
    }
    val entry by controller.currentBackStackEntryAsState()
    val destination = entry?.destination
    val current = Tab.entries.firstOrNull { destination?.hasRoute(it.route::class) == true }

    Box {
        Scaffold(
            containerColor = MaterialTheme.ext.bg,
            contentWindowInsets = WindowInsets(0),
            bottomBar = { if (current != null) TabBar(current, nav) },
        ) { pad ->
            NavHost(
                controller, startDestination = start,
                modifier = Modifier.padding(bottom = pad.calculateBottomPadding()).consumeWindowInsets(pad),
                enterTransition = { Enter }, exitTransition = { Exit },
                popEnterTransition = { Enter }, popExitTransition = { Exit },
            ) {
                composable<HomeTab> { DashboardScreen(nav) }
                composable<SpeakingTab> { SpeakingHomeScreen(nav) }
                composable<WritingTab> { WritingHomeScreen(nav) }
                composable<ReviewTab> { ReviewScreen(nav) }
                composable<SettingsTab> { SettingsScreen(nav) }
                composable<Login> { LoginScreen(nav) }
                composable<SpeakingSession> { SpeakingSessionScreen(it.toRoute(), nav) }
                composable<LiveExam> { LiveExamScreen(nav) }
                composable<WritingEditor> { WritingEditorScreen(it.toRoute(), nav) }
                composable<AttemptResult> { ResultScreen(it.toRoute(), nav) }
                composable<Bank> { BankScreen(it.toRoute(), nav) }
                composable<History> { HistoryScreen(it.toRoute(), nav) }
                composable<Mistakes> { MistakesScreen(it.toRoute(), nav) }
                composable<LrHub> { LrHubScreen(it.toRoute(), nav) }
                composable<LrRun> { LrRunScreen(it.toRoute(), nav) }
                composable<LrResult> { LrResultScreen(it.toRoute(), nav) }
                composable<MockStart> { MockStartScreen(nav) }
                composable<MockHub> { MockHubScreen(it.toRoute(), nav) }
                composable<MockLive> { LiveExamScreen(nav, it.toRoute<MockLive>().mockId) }
            }
        }
        GateHost(nav) // the limit panel and the fair-use dialog, over whatever screen is open
    }
}

@Composable
private fun TabBar(current: Tab, nav: AppNav) {
    val e = MaterialTheme.ext
    Column {
        HorizontalDivider(color = e.line)
        NavigationBar(containerColor = e.surface, tonalElevation = 0.dp) {
            Tab.entries.forEach { tab ->
                NavigationBarItem(
                    selected = tab == current,
                    onClick = { if (tab != current) nav.openTab(tab) },
                    icon = { Icon(painterResource(tab.icon), contentDescription = null) },
                    label = { Text(tab.label) },
                    // Teal means "you are here": the selected tab gets the soft brand pill, everything else stays muted.
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = e.brand, selectedTextColor = e.brand, indicatorColor = e.brandSoft,
                        unselectedIconColor = e.muted, unselectedTextColor = e.muted,
                    ),
                )
            }
        }
    }
}
