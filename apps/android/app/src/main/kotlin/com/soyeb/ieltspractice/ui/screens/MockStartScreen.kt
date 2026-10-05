package com.soyeb.ieltspractice.ui.screens

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.R
import com.soyeb.ieltspractice.core.ApiError
import com.soyeb.ieltspractice.core.Mock
import com.soyeb.ieltspractice.core.MockFlow
import com.soyeb.ieltspractice.core.MockOptions
import com.soyeb.ieltspractice.core.mockCreate
import com.soyeb.ieltspractice.core.mockCurrent
import com.soyeb.ieltspractice.core.mockOptions
import com.soyeb.ieltspractice.ui.Load
import com.soyeb.ieltspractice.ui.ScreenScaffold
import com.soyeb.ieltspractice.ui.community.QuotaCaption
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.MockHub
import com.soyeb.ieltspractice.ui.rememberLoad
import com.soyeb.ieltspractice.ui.screens.shell.Segmented
import com.soyeb.ieltspractice.ui.screens.shell.SignInGate
import com.soyeb.ieltspractice.ui.screens.speaking.ConfirmDialog
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.ErrorLine
import com.soyeb.ieltspractice.ui.theme.PrimaryButton
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.SectionTitle
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

// Mirrors: web components/mock/MockStart.tsx, routes/_app/mock/index.tsx (docs/mock-exam.md, "Start screen")

private fun prefs(c: Context) = c.applicationContext.getSharedPreferences("ielts", Context.MODE_PRIVATE)

/** Set up and start a full mock test. A mock needs an account (it spans days and the Listening and Reading attempts need one). */
@Composable
fun MockStartScreen(nav: AppNav) {
    val api = LocalApp.current.api
    val account by api.hasAccount.collectAsState()
    ScreenScaffold("Full mock test", onBack = nav::back) {
        SignInGate(nav, "Create an account to take a full mock test.", account, "Full mock test", R.drawable.ic_books) { MockSetup(nav) }
    }
}

@Composable
private fun MockSetup(nav: AppNav) {
    val e = MaterialTheme.ext
    val api = LocalApp.current.api
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    // Academic or General Training, remembered on this device.
    var variant by remember { mutableStateOf(runCatching { prefs(context).getString("mockVariant", null) }.getOrNull().let { if (it == "general") "general" else "academic" }) }
    var source by remember { mutableStateOf("own") }
    var pick by remember { mutableStateOf<String?>(null) } // null = the default (the lowest one not started yet)
    var menu by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmReplace by remember { mutableStateOf(false) }

    val open by produceState<Mock?>(null) { value = runCatching { api.mockCurrent() }.getOrNull() }
    val options = rememberLoad(variant) { api.mockOptions(variant) }
    val opts: MockOptions? = (options.state as? Load.Ready)?.value
    val cambridge = opts?.cambridge.orEmpty()
    val useCambridge = source == "cambridge" && cambridge.isNotEmpty()
    val ref = if (useCambridge) (cambridge.firstOrNull { it.ref == pick } ?: cambridge.firstOrNull { !it.started } ?: cambridge.first()).ref else null
    val noSet = opts != null && !opts.own && cambridge.isEmpty()

    fun create(replace: Boolean) {
        busy = true
        error = null
        scope.launch {
            try {
                val m = api.mockCreate(variant, if (useCambridge) "cambridge" else "generated", ref, replace)
                nav.replace(MockHub(m.id))
            } catch (x: CancellationException) {
                throw x
            } catch (x: ApiError) {
                when {
                    x.code == "mock_open" -> confirmReplace = true
                    nav.reportBlocked(x, "writing", "Nothing has been started.") -> {}
                    else -> error = x.message
                }
                busy = false
            } catch (x: Exception) {
                error = x.message ?: "Something went wrong."
                busy = false
            }
        }
    }

    open?.let { m ->
        AppCard {
            SectionTitle("Continue your mock test")
            Text(m.next?.let { MockFlow.name(it) + " next." } ?: "Open.", style = MaterialTheme.typography.bodyMedium, color = e.muted)
            PrimaryButton("Continue", { nav.go(MockHub(m.id)) }, Modifier.fillMaxWidth())
        }
    }

    Text("Test type", style = MaterialTheme.typography.titleSmall, color = e.ink)
    Segmented(listOf("academic" to "Academic", "general" to "General Training"), variant, {
        variant = it
        pick = null
        runCatching { prefs(context).edit().putString("mockVariant", it).apply() }
    })

    when (val s = options.state) {
        Load.Loading -> Box(Modifier.fillMaxWidth().padding(16.dp), Alignment.Center) { CircularProgressIndicator() }
        is Load.Failed -> AppCard { ErrorLine(s.message); SecondaryButton("Try again", options.reload) }
        is Load.Ready -> if (cambridge.isNotEmpty()) {
            Text("Questions", style = MaterialTheme.typography.titleSmall, color = e.ink)
            Segmented(listOf("own" to "Our own tests", "cambridge" to "Cambridge complete test"), source, { source = it })
            if (source == "cambridge") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f)) {
                        SecondaryButton(cambridge.first { it.ref == ref }.let { it.bookTest + if (it.started) " (started before)" else "" }, { menu = true }, Modifier.fillMaxWidth())
                        DropdownMenu(menu, { menu = false }) {
                            cambridge.forEach { c ->
                                DropdownMenuItem({ Text(c.bookTest + if (c.started) " (started before)" else "") }, { pick = c.ref; menu = false })
                            }
                        }
                    }
                    SecondaryButton("Surprise me", { pick = cambridge.random().ref })
                }
            }
        }
    }

    AppCard {
        SectionTitle("How it works")
        MockFlow.rules.forEach { Text("•  $it", style = MaterialTheme.typography.bodyMedium, color = e.ink) }
    }

    if (noSet) {
        AppCard {
            Text("No complete test is available yet", style = MaterialTheme.typography.titleSmall, color = e.warnText)
            Text("There is no full set of Listening, Reading, Writing and Speaking for this test type. Try the other type.", style = MaterialTheme.typography.bodyMedium, color = e.muted)
        }
    }
    error?.let { ErrorLine(it) }
    // The writing and speaking allowance is checked when the mock is created (nothing is reserved); "tests left" is shown for both.
    PrimaryButton(
        if (open != null) "Start a new mock test" else "Start mock test",
        { if (open != null) confirmReplace = true else nav.startTest("writing") { create(false) } },
        Modifier.fillMaxWidth(), enabled = !noSet && opts != null, loading = busy,
    )
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) { Text("Writing:", style = MaterialTheme.typography.bodySmall, color = e.muted); QuotaCaption("writing") }
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) { Text("Speaking:", style = MaterialTheme.typography.bodySmall, color = e.muted); QuotaCaption("speaking") }

    if (confirmReplace) {
        ConfirmDialog(
            "Replace your open mock test?", "Your open mock test is discarded. Its marked sections stay in your history as normal practice.", "Discard and start new",
            onConfirm = { nav.startTest("writing") { create(true) } }, onDismiss = { confirmReplace = false }, dismissLabel = "Keep it", destructive = true,
        )
    }
}
