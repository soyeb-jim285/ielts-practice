package com.soyeb.ieltspractice.ui.nav

import androidx.annotation.DrawableRes
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import com.soyeb.ieltspractice.R
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.soyeb.ieltspractice.core.ApiClient
import com.soyeb.ieltspractice.core.ApiError
import com.soyeb.ieltspractice.core.Codes
import com.soyeb.ieltspractice.core.FairUse
import com.soyeb.ieltspractice.core.FairUseAck
import com.soyeb.ieltspractice.core.Gate
import com.soyeb.ieltspractice.core.Providers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

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
class AppNav(private val controller: NavHostController, private val api: ApiClient, private val scope: CoroutineScope, private val ack: FairUseAck = FairUseAck()) {
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

    // MARK: Starting a test (docs/community.md, Client UX)

    /** The limit panel or fair-use dialog over the current screen (see ui/community/CommunityUi.kt, GateHost). Null = none. */
    var gate by mutableStateOf<Gate?>(null)
    /** True while the quota is being checked before a test starts. */
    var checking by mutableStateOf(false)
        private set

    fun dismissGate() { gate = null }

    /**
     * Start a speaking or writing test: check the quota BEFORE anything is recorded or typed, show the fair-use note once per day when the
     * shared balance pays, create the guest session if there is none, then run [go]. Guests need no account to start.
     */
    fun startTest(skill: String, go: () -> Unit) = begin(skill, live = false, go)

    /** The live examiner: needs the person's own key for it (OpenRouter for turn-based, OpenAI for GPT-Live, Gemini for Gemini Live). */
    fun startLive(go: () -> Unit) = begin("speaking", live = true, go)

    private fun begin(skill: String, live: Boolean, go: () -> Unit) {
        if (checking) return
        checking = true
        scope.launch {
            try { check(skill, live, go) } catch (e: CancellationException) { throw e } finally { checking = false }
        }
    }

    private suspend fun check(skill: String, live: Boolean, go: () -> Unit) {
        val q = try {
            api.refreshQuota()
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiError) {
            gate = Gate.Message("Couldn't check your tests", e.message)
            return
        }
        val guest = !api.hasAccount.value
        if (live && q.liveProviders.isEmpty()) {
            val chosen = api.me.value?.settings?.provider ?: "turn"
            gate = Gate.Blocked(Codes.LIVE, skill, q.tier, null, q.communityBalance, needs = Providers.name(Providers.keyFor(chosen)))
            return
        }
        val s = q.of(skill)
        s.blocked?.let { gate = Gate.Blocked(it, skill, q.tier, s.resetAt, q.communityBalance); return }
        val user = if (guest) "guest" else api.me.value?.user?.id ?: "account"
        val key = FairUse.ackKey(user)
        if (!q.unlimited && !ack.has(key)) {
            gate = Gate.FairUse(skill, q, guest) { ack.set(key); gate = null; scope.launch { proceed(skill, go) } }
            return
        }
        proceed(skill, go)
    }

    private suspend fun proceed(skill: String, go: () -> Unit) {
        try {
            api.ensureSession()
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiError) {
            if (!reportBlocked(e, skill)) gate = Gate.Message("Couldn't start your test", e.message)
            return
        }
        go()
    }

    /**
     * A request refused with a limit code (the quota ran out in another tab, the balance ran out, too fast): show the same panel as at start.
     * [keep] says what was kept ("Your essay is still here."). Returns false when [e] is not a limit error.
     */
    fun reportBlocked(e: ApiError, skill: String, keep: String? = null, needs: String? = null): Boolean {
        if (!e.isLimit) return false
        val q = api.quota.value
        val tier = e.tier ?: if (!api.hasAccount.value) "guest" else q?.tier ?: "community"
        gate = Gate.Blocked(e.code.orEmpty(), e.skill ?: skill, tier, e.resetAt, q?.communityBalance, needs, keep)
        return true
    }

    /** Guests can browse; taking a test or opening personal data needs an account. Runs [action] now if signed in, otherwise opens Login first and runs it after sign-in. */
    fun requireSignIn(reason: String? = "Sign in to take a test and save your results.", action: () -> Unit) { if (api.hasAccount.value) action() else openLogin(reason, false, action) }

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
