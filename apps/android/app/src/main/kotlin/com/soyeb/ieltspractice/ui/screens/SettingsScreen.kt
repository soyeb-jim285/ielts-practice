package com.soyeb.ieltspractice.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.R
import com.soyeb.ieltspractice.core.ApiClient
import com.soyeb.ieltspractice.core.ApiError
import com.soyeb.ieltspractice.core.AppSettings
import com.soyeb.ieltspractice.core.Band
import com.soyeb.ieltspractice.ui.community.QuotaSummary
import com.soyeb.ieltspractice.ui.LoadContent
import com.soyeb.ieltspractice.ui.ScreenScaffold
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.Bank
import com.soyeb.ieltspractice.ui.nav.History
import com.soyeb.ieltspractice.ui.nav.LrHub
import com.soyeb.ieltspractice.ui.nav.Mistakes
import com.soyeb.ieltspractice.ui.rememberLoad
import com.soyeb.ieltspractice.ui.screens.shell.AppField
import com.soyeb.ieltspractice.ui.screens.shell.NavRow
import com.soyeb.ieltspractice.ui.screens.shell.RowDivider
import com.soyeb.ieltspractice.ui.screens.shell.Segmented
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.ErrorLine
import com.soyeb.ieltspractice.ui.theme.PrimaryButton
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.SectionTitle
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// Mirrors: iOS Views/SettingsView.swift, SignInGate.swift (SettingsTab), web routes/_app/settings.tsx, components/settings/*

/** Settings tab: settings when signed in, otherwise the way to sign in (plus the one public page, the prompt bank). */
@Composable
fun SettingsScreen(nav: AppNav) {
    val api = LocalApp.current.api
    val ready by api.ready.collectAsState()
    val account by api.hasAccount.collectAsState()
    val me by api.me.collectAsState()
    ScreenScaffold("Settings", large = true) {
        when {
            !ready -> {}
            !account -> GuestSettings(nav)
            me == null -> LoadContent(rememberLoad { api.loadMe() }) {}
            else -> SettingsBody(me!!.settings, me!!.user.email, nav)
        }
    }
}

@Composable
private fun GuestSettings(nav: AppNav) {
    QuotaSummary(nav)
    AppCard {
        SectionTitle("Account")
        Text("Create a free account to keep your results, history and settings, and to get more tests.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.ext.muted)
        PrimaryButton("Create account", { nav.openLogin("Create an account to save your practice.", signUp = true) }, Modifier.fillMaxWidth())
        SecondaryButton("Sign in", { nav.openLogin("Sign in to see your settings.") }, Modifier.fillMaxWidth())
    }
    AppCard {
        SectionTitle("More")
        NavRow("Prompt bank", null, { nav.go(Bank("")) }, icon = R.drawable.ic_books)
    }
    AppearanceCard()
    HelpCard()
}

@Composable
private fun SettingsBody(initial: AppSettings, email: String, nav: AppNav) {
    val e = MaterialTheme.ext
    val container = LocalApp.current
    val api = container.api
    val scope = rememberCoroutineScope()
    var s by remember { mutableStateOf(initial) }
    var draft by remember { mutableStateOf(initial.targetBand) }
    var error by remember { mutableStateOf<String?>(null) }
    var showDelete by remember { mutableStateOf(false) }

    fun update(new: AppSettings) {
        s = new
        scope.launch {
            try { api.saveSettings(new); error = null } catch (x: CancellationException) { throw x } catch (x: Exception) { error = (x as? ApiError)?.message ?: "Couldn't save your settings." }
        }
    }

    error?.let { ErrorLine(it) }

    QuotaSummary(nav)

    AppCard {
        SectionTitle("More")
        Column {
            run {
                NavRow("Listening tests", null, { nav.go(LrHub("listening")) }, icon = R.drawable.ic_sp_headphones)
                RowDivider()
                NavRow("Reading tests", null, { nav.go(LrHub("reading")) }, icon = R.drawable.ic_lr_book)
                RowDivider()
            }
            NavRow("Past attempts", null, { nav.go(History()) }, icon = R.drawable.ic_history)
            RowDivider()
            NavRow("Mistakes", null, { nav.go(Mistakes()) }, icon = R.drawable.ic_alert)
            RowDivider()
            NavRow("Prompt bank", null, { nav.go(Bank("")) }, icon = R.drawable.ic_books)
        }
    }

    AppCard {
        SectionTitle("Goal")
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Target band", style = MaterialTheme.typography.titleSmall, color = e.ink)
            Text(Band.format(draft), style = MaterialTheme.typography.titleLarge, color = e.ink)
        }
        TargetSlider(draft, { draft = it }) { if (draft != s.targetBand) update(s.copy(targetBand = draft)) }
        Row(Modifier.fillMaxWidth().clearAndSetSemantics {}, horizontalArrangement = Arrangement.SpaceBetween) {
            (4..9).forEach { Text("$it", style = MaterialTheme.typography.bodySmall, color = e.muted) }
        }
        Text("Most universities ask for 6.5-7.0 overall.", style = MaterialTheme.typography.bodySmall, color = e.muted)
        Text("Scores at or above your target show green; up to one band below, amber; further below, red.", style = MaterialTheme.typography.bodySmall, color = e.muted)
    }

    AppCard {
        SectionTitle("Writing")
        Text("How the timed essay editor behaves.", style = MaterialTheme.typography.bodySmall, color = e.muted)
        SwitchRow("Submit when time runs out", "Off: the timer keeps counting as overtime and the result is flagged.", s.writingAutoSubmit) { update(s.copy(writingAutoSubmit = it)) }
        RowDivider()
        SwitchRow("Block pasting", "Matches the real test, where you type every word.", s.blockPaste) { update(s.copy(blockPaste = it)) }
    }

    AppearanceCard()

    AppCard {
        SectionTitle("Account")
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Signed in as", style = MaterialTheme.typography.bodyMedium, color = e.muted)
            Text(email, style = MaterialTheme.typography.bodyMedium, color = e.ink)
        }
        SecondaryButton("Sign out", { container.scope.launch { api.signOut() } }, Modifier.fillMaxWidth())
    }

    HelpCard()

    AppCard {
        SectionTitle("Danger zone")
        Text("Delete account", style = MaterialTheme.typography.titleSmall, color = e.ink)
        Text("Removes your recordings, essays, results and review cards. This can't be undone.", style = MaterialTheme.typography.bodySmall, color = e.muted)
        OutlinedButton(
            { showDelete = true }, Modifier.fillMaxWidth().heightIn(min = 48.dp), shape = com.soyeb.ieltspractice.ui.theme.ControlShape,
            border = BorderStroke(1.dp, e.bad), colors = ButtonDefaults.outlinedButtonColors(contentColor = e.badText),
        ) { Text("Delete account") }
    }

    if (showDelete) DeleteAccountDialog { showDelete = false }
}

@Composable
private fun SwitchRow(title: String, description: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    val e = MaterialTheme.ext
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).toggleable(checked, role = Role.Switch, onValueChange = onChange).padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, color = e.ink)
            Text(description, style = MaterialTheme.typography.bodySmall, color = e.muted)
        }
        Switch(
            checked, null,
            colors = SwitchDefaults.colors(
                checkedThumbColor = e.onBrand, checkedTrackColor = e.brand, checkedBorderColor = e.brand,
                uncheckedThumbColor = e.muted, uncheckedTrackColor = e.surface2, uncheckedBorderColor = MaterialTheme.colorScheme.outline,
            ),
        )
    }
}

/** Deleting needs the account password, like the web dialog (Better Auth delete-user). */
@Composable
private fun DeleteAccountDialog(onClose: () -> Unit) {
    val e = MaterialTheme.ext
    val api = LocalApp.current.api
    val scope = rememberCoroutineScope()
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = { if (!busy) onClose() },
        containerColor = e.surface,
        title = { Text("Delete your account?", style = MaterialTheme.typography.titleLarge, color = e.ink) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Everything you've recorded and written will be permanently deleted.", style = MaterialTheme.typography.bodyMedium, color = e.muted)
                AppField(password, { password = it }, "Confirm with your password", password = true)
                error?.let { ErrorLine(it) }
            }
        },
        dismissButton = { TextButton(onClose, enabled = !busy) { Text("Keep account", color = e.ink) } },
        confirmButton = {
            TextButton(
                {
                    busy = true; error = null
                    scope.launch {
                        try { api.deleteAccount(password) } catch (x: CancellationException) { throw x } catch (x: Exception) {
                            error = (x as? ApiError)?.message ?: "Couldn't delete the account."
                            busy = false
                        }
                    }
                },
                enabled = password.isNotEmpty() && !busy,
            ) { Text("Delete forever", color = if (password.isNotEmpty() && !busy) e.badText else e.muted) }
        },
    )
}

/** Web settings "Appearance": light, dark or follow the device, saved on this device (AppContainer.appearance, applied in IeltsApp). */
@Composable
private fun AppearanceCard() {
    val container = LocalApp.current
    val appearance by container.appearance.collectAsState()
    AppCard {
        SectionTitle("Appearance")
        Text("Light, dark, or follow your device. Saved on this device.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.ext.muted)
        Segmented(listOf("light" to "Light", "system" to "System", "dark" to "Dark"), appearance, container::setAppearance)
    }
}

/** Report a problem (web FeedbackDialog) and the legal pages, which open on the website (web settings Account section). */
@Composable
private fun HelpCard() {
    val e = MaterialTheme.ext
    val uri = LocalUriHandler.current
    var reporting by remember { mutableStateOf(false) }
    var sent by remember { mutableStateOf(false) }
    fun openPage(path: String) { runCatching { uri.openUri(ApiClient.SERVER + path) } } // no browser: nothing to open
    AppCard {
        SectionTitle("Help and legal")
        Column {
            NavRow("Report a problem", "Tell us what went wrong.", { sent = false; reporting = true }, icon = R.drawable.ic_alert)
            if (sent) Text("Thanks, we got it.", Modifier.padding(bottom = 8.dp), style = MaterialTheme.typography.bodySmall, color = e.goodText)
            RowDivider()
            NavRow("Privacy policy", "What we collect, including session recording, and how long we keep it.", { openPage("/privacy") })
            RowDivider()
            NavRow("Terms and refunds", "The rules for using the service and getting your money back.", { openPage("/terms") })
            RowDivider()
            NavRow("Contact", null, { openPage("/contact") })
        }
    }
    if (reporting) FeedbackDialog(onClose = { reporting = false }, onSent = { reporting = false; sent = true })
}

private const val FEEDBACK_MAX = 2000

/** POST /api/feedback (no account needed). `page` names the app screen, as the web sends its path. */
@Composable
private fun FeedbackDialog(onClose: () -> Unit, onSent: () -> Unit) {
    val e = MaterialTheme.ext
    val api = LocalApp.current.api
    val scope = rememberCoroutineScope()
    var message by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val canSend = message.isNotBlank() && !busy
    AlertDialog(
        onDismissRequest = { if (!busy) onClose() },
        containerColor = e.surface,
        title = { Text("Report a problem", style = MaterialTheme.typography.titleLarge, color = e.ink) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Tell us what went wrong. We also get the screen you are on.", style = MaterialTheme.typography.bodyMedium, color = e.muted)
                AppField(message, { message = it.take(FEEDBACK_MAX) }, "What happened?", Modifier.heightIn(min = 140.dp), singleLine = false)
                Text("${message.length}/$FEEDBACK_MAX", style = MaterialTheme.typography.bodySmall.merge(com.soyeb.ieltspractice.ui.theme.AppText.num), color = e.muted)
                error?.let { ErrorLine(it) }
            }
        },
        dismissButton = { TextButton(onClose, enabled = !busy) { Text("Cancel", color = e.ink) } },
        confirmButton = {
            TextButton(
                {
                    busy = true; error = null
                    scope.launch {
                        try {
                            api.raw("POST", "/api/feedback", buildJsonObject { put("message", message.trim()); put("page", "android:settings") })
                            onSent()
                        } catch (x: CancellationException) {
                            throw x
                        } catch (x: Exception) {
                            error = if ((x as? ApiError)?.status == 429) "You have sent a few already. Try again in a while." else "Couldn't send that. Try again."
                        }
                        busy = false
                    }
                },
                enabled = canSend,
            ) { Text("Send", color = if (canSend) e.brand else e.muted) }
        },
    )
}
