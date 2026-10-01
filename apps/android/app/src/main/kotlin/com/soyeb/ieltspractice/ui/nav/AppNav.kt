package com.soyeb.ieltspractice.ui.nav

import androidx.annotation.DrawableRes
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import com.soyeb.ieltspractice.R
import com.soyeb.ieltspractice.core.ApiClient

/** The bottom navigation bar: Home, Speaking, Writing, Review, Settings (same order and labels as the iOS tab bar and web nav). */
enum class Tab(val route: Any, val label: String, @DrawableRes val icon: Int) {
    Home(HomeTab, "Home", R.drawable.ic_home),
    Speaking(SpeakingTab, "Speaking", R.drawable.ic_mic),
    Writing(WritingTab, "Writing", R.drawable.ic_edit),
    Review(ReviewTab, "Review", R.drawable.ic_review),
    Settings(SettingsTab, "Settings", R.drawable.ic_settings),
}

/**
 * What screens use to move around. Pass it to every screen composable; do not hand them the NavHostController.
 * `nav.go(AttemptResult.of(id))`, `nav.back()`, `nav.openTab(Tab.Review)`, `nav.requireSignIn { nav.go(SpeakingSession("full")) }`.
 */
class AppNav(private val controller: NavHostController, private val api: ApiClient) {
    fun go(route: Any) = controller.navigate(route)

    fun back() { controller.popBackStack() }

    /** Switch tab like the bottom bar does (keeps each tab's stack). */
    fun openTab(tab: Tab) = controller.navigate(tab.route) {
        popUpTo(controller.graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }

    /** What Login shows: why the guest was sent there, and whether it opens on "Create account". Read by LoginScreen. */
    var loginReason: String? = null
        private set
    var loginSignUp: Boolean = false
        private set
    private var pending: (() -> Unit)? = null

    /** Guests can browse; taking a test or opening personal data needs an account. Runs [action] now if signed in, otherwise opens Login first and runs it after sign-in. */
    fun requireSignIn(reason: String? = "Sign in to take a test and save your results.", action: () -> Unit) { if (api.isSignedIn) action() else openLogin(reason, false, action) }

    fun openLogin(reason: String? = null, signUp: Boolean = false, then: (() -> Unit)? = null) {
        loginReason = reason; loginSignUp = signUp; pending = then
        go(Login)
    }

    /** Called by LoginScreen: leaves it, and continues the pending action when the user signed in. */
    fun loginFinished(signedIn: Boolean) {
        val action = pending
        pending = null
        back()
        if (signedIn) action?.invoke()
    }
}
