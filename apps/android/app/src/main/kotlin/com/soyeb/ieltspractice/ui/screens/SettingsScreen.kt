package com.soyeb.ieltspractice.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.LocalDemo
import com.soyeb.ieltspractice.R
import com.soyeb.ieltspractice.core.ApiError
import com.soyeb.ieltspractice.core.AppSettings
import com.soyeb.ieltspractice.core.Band
import com.soyeb.ieltspractice.core.ModelChoices
import com.soyeb.ieltspractice.ui.LoadContent
import com.soyeb.ieltspractice.ui.ScreenScaffold
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.Bank
import com.soyeb.ieltspractice.ui.nav.History
import com.soyeb.ieltspractice.ui.nav.Mistakes
import com.soyeb.ieltspractice.ui.rememberLoad
import com.soyeb.ieltspractice.ui.screens.shell.AppField
import com.soyeb.ieltspractice.ui.screens.shell.DefaultModels
import com.soyeb.ieltspractice.ui.screens.shell.FilterMenu
import com.soyeb.ieltspractice.ui.screens.shell.LinkButton
import com.soyeb.ieltspractice.ui.screens.shell.ModelPickerBody
import com.soyeb.ieltspractice.ui.screens.shell.ModelPickerDialog
import com.soyeb.ieltspractice.ui.screens.shell.NavRow
import com.soyeb.ieltspractice.ui.screens.shell.RowDivider
import com.soyeb.ieltspractice.ui.screens.shell.TtsModel
import com.soyeb.ieltspractice.ui.screens.shell.demoTab
import com.soyeb.ieltspractice.ui.screens.shell.shortModel
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.ErrorLine
import com.soyeb.ieltspractice.ui.theme.PrimaryButton
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.SectionTitle
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

// Mirrors: iOS Views/SettingsView.swift, SignInGate.swift (SettingsTab), web routes/_app/settings.tsx, components/settings/*

/** Settings tab: settings when signed in, otherwise the way to sign in (plus the one public page, the prompt bank). */
@Composable
fun SettingsScreen(nav: AppNav) {
    val api = LocalApp.current.api
    val ready by api.ready.collectAsState()
    val token by api.token.collectAsState()
    val me by api.me.collectAsState()
    val demo = LocalDemo.current
    if (demoTab(demo) == "Picker") { // screenshot of the model picker (a dialog in the app)
        ScreenScaffold("Scoring and feedback", onBack = {}, scroll = false) { ModelPickerBody("text", DefaultModels.ANALYSIS) {} }
        return
    }
    ScreenScaffold("Settings", large = true) {
        when {
            !ready -> {}
            token == null -> GuestSettings(nav)
            me == null -> LoadContent(rememberLoad { api.loadMe() }) {}
            else -> SettingsBody(me!!.settings, me!!.realtimeAvailable, me!!.geminiLiveAvailable, me!!.user.email, nav)
        }
    }
}

@Composable
private fun GuestSettings(nav: AppNav) {
    AppCard {
        SectionTitle("Account")
        Text("Sign in to keep your results, history and settings in one place.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.ext.muted)
        PrimaryButton("Sign in", { nav.openLogin("Sign in to see your settings.") }, Modifier.fillMaxWidth())
        SecondaryButton("Create account", { nav.openLogin("Create an account to save your practice.", signUp = true) }, Modifier.fillMaxWidth())
    }
    AppCard {
        SectionTitle("More")
        NavRow("Prompt bank", null, { nav.go(Bank("")) }, icon = R.drawable.ic_books)
    }
}

@Composable
private fun SettingsBody(initial: AppSettings, realtimeOk: Boolean, geminiOk: Boolean, email: String, nav: AppNav) {
    val e = MaterialTheme.ext
    val container = LocalApp.current
    val api = container.api
    val scope = rememberCoroutineScope()
    var s by remember { mutableStateOf(initial) }
    var draft by remember { mutableStateOf(initial.targetBand) }
    var voices by remember { mutableStateOf(emptyMap<String, List<String>>()) }
    var error by remember { mutableStateOf<String?>(null) }
    val demoModels = demoTab(LocalDemo.current) == "Models"
    var customise by remember { mutableStateOf(demoModels) }
    var picking by remember { mutableStateOf<Pair<String, String>?>(null) } // capability to model-row title
    var showDelete by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        runCatching { api.getList<TtsModel>("/api/models", mapOf("capability" to "tts")) }.getOrNull()?.let { list ->
            voices = list.mapNotNull { m -> m.voices?.let { m.id to it } }.toMap()
        }
    }

    fun update(new: AppSettings) {
        s = new
        scope.launch {
            try { api.saveSettings(new); error = null } catch (x: CancellationException) { throw x } catch (x: Exception) { error = (x as? ApiError)?.message ?: "Couldn't save your settings." }
        }
    }
    fun setModels(f: ModelChoices.() -> ModelChoices) = update(s.copy(models = s.models.f()))
    fun setTts(id: String) {
        // A new voice model may not offer the current voice: switch to its first one (web pickVoice).
        val list = voices[id]
        setModels { copy(tts = id, ttsVoice = if (list != null && ttsVoice !in list) list.first() else ttsVoice) }
    }

    error?.let { ErrorLine(it) }

    AppCard {
        SectionTitle("More")
        Column {
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

    AppCard {
        SectionTitle("Live examiner")
        Text("How the live speaking test talks to you.", style = MaterialTheme.typography.bodySmall, color = e.muted)
        val natural = "Talk back and forth as in the real test. You can interrupt each other."
        Column {
            ProviderRow("turn", "Examiner waits for you to finish", "The examiner asks a question, then listens until you pause.", s.liveProvider) { update(s.copy(liveProvider = "turn")) }
            RowDivider()
            ProviderRow("openai-realtime", "Natural conversation (OpenAI)", if (realtimeOk) natural else "Not available right now.", s.liveProvider, realtimeOk) { update(s.copy(liveProvider = "openai-realtime")) }
            RowDivider()
            ProviderRow("gemini-live", "Natural conversation (Gemini)", if (geminiOk) natural else "Not available right now.", s.liveProvider, geminiOk) { update(s.copy(liveProvider = "gemini-live")) }
        }
    }

    AppCard {
        SectionTitle("AI models")
        Text("The models that score your work and play the examiner. The defaults suit most people.", style = MaterialTheme.typography.bodySmall, color = e.muted)
        Row(
            Modifier.fillMaxWidth().heightIn(min = 56.dp).toggleable(customise, role = Role.Button) { customise = it },
            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Customise models", style = MaterialTheme.typography.bodyLarge, color = e.ink)
                Text("Scoring: ${shortModel(s.models.analysis)}", style = MaterialTheme.typography.bodySmall, color = e.muted)
            }
            Icon(if (customise) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown, if (customise) "Collapse" else "Expand", tint = e.muted)
        }
        if (customise) {
            Text("Any OpenRouter model works. Costs are rough estimates for scoring one essay or spoken answer.", style = MaterialTheme.typography.bodySmall, color = e.muted)
            ModelRow("Scoring and feedback", null, s.models.analysis, DefaultModels.ANALYSIS, { picking = "text" to "Scoring and feedback" }) { setModels { copy(analysis = it) } }
            ModelRow("Examiner", "Asks the questions when the examiner waits for you to finish.", s.models.examiner, DefaultModels.EXAMINER, { picking = "text" to "Examiner" }) { setModels { copy(examiner = it) } }
            ModelRow("Speech to text", "Needs word timestamps for fluency metrics.", s.models.stt, DefaultModels.STT, { picking = "stt" to "Speech to text" }) { setModels { copy(stt = it) } }
            ModelRow("Examiner voice model", null, s.models.tts, DefaultModels.TTS, { picking = "tts" to "Examiner voice model" }) { setTts(it) }
            val list = voices[s.models.tts].orEmpty()
            FilterMenu("Voice", (if (s.models.ttsVoice in list) list else listOf(s.models.ttsVoice) + list).map { it to it }, s.models.ttsVoice, { v -> setModels { copy(ttsVoice = v) } })
            SwitchRow("Audio pronunciation check", "Sends your recording to an audio model for prosody and pronunciation notes. Slower and costs more.", s.audioPronEnabled) { update(s.copy(audioPronEnabled = it)) }
            if (s.audioPronEnabled) {
                ModelRow("Pronunciation model", "Must accept audio input.", s.models.audioPron, DefaultModels.AUDIO_PRON, { picking = "audio-in" to "Pronunciation model" }) { setModels { copy(audioPron = it) } }
            }
        }
    }

    AppCard {
        SectionTitle("Account")
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Signed in as", style = MaterialTheme.typography.bodyMedium, color = e.muted)
            Text(email, style = MaterialTheme.typography.bodyMedium, color = e.ink)
        }
        SecondaryButton("Sign out", { container.scope.launch { api.signOut() } }, Modifier.fillMaxWidth())
    }

    AppCard {
        SectionTitle("Danger zone")
        Text("Delete account", style = MaterialTheme.typography.titleSmall, color = e.ink)
        Text("Removes your recordings, essays, results and review cards. This can't be undone.", style = MaterialTheme.typography.bodySmall, color = e.muted)
        OutlinedButton(
            { showDelete = true }, Modifier.fillMaxWidth().heightIn(min = 48.dp), shape = com.soyeb.ieltspractice.ui.theme.ControlShape,
            border = BorderStroke(1.dp, e.bad), colors = ButtonDefaults.outlinedButtonColors(contentColor = e.badText),
        ) { Text("Delete account") }
    }

    picking?.let { (capability, title) ->
        val current = when (title) {
            "Scoring and feedback" -> s.models.analysis; "Examiner" -> s.models.examiner; "Speech to text" -> s.models.stt
            "Examiner voice model" -> s.models.tts; else -> s.models.audioPron
        }
        ModelPickerDialog(title, capability, current, { id ->
            when (title) {
                "Scoring and feedback" -> setModels { copy(analysis = id) }
                "Examiner" -> setModels { copy(examiner = id) }
                "Speech to text" -> setModels { copy(stt = id) }
                "Examiner voice model" -> setTts(id)
                else -> setModels { copy(audioPron = id) }
            }
            picking = null
        }) { picking = null }
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

/** One conversation-mode choice as a full-width radio row. */
@Composable
private fun ProviderRow(value: String, title: String, description: String, current: String, enabled: Boolean = true, onSelect: () -> Unit) {
    val e = MaterialTheme.ext
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).selectable(current == value, enabled = enabled, role = Role.RadioButton, onClick = onSelect).padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, color = if (enabled) e.ink else e.muted)
            Text(description, style = MaterialTheme.typography.bodySmall, color = e.muted)
        }
        RadioButton(
            current == value, null, enabled = enabled,
            colors = RadioButtonDefaults.colors(selectedColor = e.brand, unselectedColor = MaterialTheme.colorScheme.outline, disabledSelectedColor = e.muted, disabledUnselectedColor = e.line),
        )
    }
}

/** A model choice: opens the searchable list, with the web's hint and "Reset to default" under it. */
@Composable
private fun ModelRow(title: String, hint: String?, value: String, defaultId: String, onPick: () -> Unit, onSet: (String) -> Unit) {
    val e = MaterialTheme.ext
    Column {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button, onClick = onPick),
            horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(title, style = MaterialTheme.typography.bodyLarge, color = e.ink, modifier = Modifier.weight(1f))
            Text(shortModel(value), style = MaterialTheme.typography.bodyMedium, color = e.brand)
        }
        if (hint != null) Text(hint, style = MaterialTheme.typography.bodySmall, color = e.muted)
        if (value != defaultId) LinkButton("Reset to default (${shortModel(defaultId)})", { onSet(defaultId) })
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
