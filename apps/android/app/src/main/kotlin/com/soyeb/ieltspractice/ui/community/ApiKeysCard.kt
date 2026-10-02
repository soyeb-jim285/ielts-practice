package com.soyeb.ieltspractice.ui.community

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.LocalDemo
import com.soyeb.ieltspractice.core.ApiError
import com.soyeb.ieltspractice.core.Codes
import com.soyeb.ieltspractice.core.KEY_PROVIDERS
import com.soyeb.ieltspractice.core.KeyCopy
import com.soyeb.ieltspractice.core.KeyInfo
import com.soyeb.ieltspractice.core.Providers
import com.soyeb.ieltspractice.ui.screens.shell.AppField
import com.soyeb.ieltspractice.ui.screens.shell.LinkButton
import com.soyeb.ieltspractice.ui.screens.shell.RowDivider
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.ErrorLine
import com.soyeb.ieltspractice.ui.theme.PrimaryButton
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.SectionTitle
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Settings, "Your API keys" (account only): OpenRouter, OpenAI and Gemini. The key is typed into a masked field, validated by the server with
 * the provider, and stored encrypted there. It is never kept in this app: the field is cleared after a save, and the list holds only the last 4.
 */
@Composable
fun ApiKeysCard() {
    val api = LocalApp.current.api
    var keys by remember { mutableStateOf<List<KeyInfo>?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    LaunchedEffect(attempt) {
        try { keys = api.loadKeys(); loadError = null } catch (x: CancellationException) { throw x } catch (x: Exception) { loadError = (x as? ApiError)?.message ?: "Couldn't load your keys." }
    }
    val e = MaterialTheme.ext
    AppCard {
        SectionTitle("Your API keys")
        Text(
            "Optional. Add your own keys for unlimited tests and the live examiner. Without one, you share the community balance.",
            style = MaterialTheme.typography.bodySmall, color = e.muted,
        )
        val list = keys
        when {
            list != null -> KEY_PROVIDERS.forEachIndexed { i, provider ->
                if (i > 0) RowDivider()
                KeyRow(
                    provider, list.firstOrNull { it.provider == provider },
                    onSaved = { info -> keys = (list.filter { it.provider != provider } + info).sortedBy { KEY_PROVIDERS.indexOf(it.provider) } },
                    onRemoved = { keys = list.filter { it.provider != provider } },
                )
            }
            loadError != null -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ErrorLine(loadError ?: "")
                SecondaryButton("Try again", { attempt++ })
            }
            else -> Text("Loading your keys...", style = MaterialTheme.typography.bodyMedium, color = e.muted)
        }
        Text(KeyCopy.STORED, style = MaterialTheme.typography.bodySmall, color = e.muted, modifier = Modifier.padding(top = 4.dp))
    }
}

@Composable
private fun KeyRow(provider: String, saved: KeyInfo?, onSaved: (KeyInfo) -> Unit, onRemoved: () -> Unit) {
    val e = MaterialTheme.ext
    val api = LocalApp.current.api
    val demo = LocalDemo.current
    val demoTab = if (demo?.screen == "settings-keys") demo?.tab else null // screenshots: a state per tab
    val name = Providers.name(provider)
    val stopped = saved != null && !saved.valid
    var editing by remember(saved) { mutableStateOf(saved == null || stopped) }
    var value by remember { mutableStateOf(if (demoTab == "Error" && provider == "openai" || demoTab == "Checking" && provider == "openrouter") "sk-demo-not-a-real-key" else "") }
    var busy by remember { mutableStateOf(demoTab == "Checking" && provider == "openrouter") }
    var error by remember { mutableStateOf(if (demoTab == "Error" && provider == "openai") KeyCopy.error("openai", 400, Codes.INVALID_KEY, "") else null) }
    val scope = rememberCoroutineScope()
    val canSave = !busy && value.trim().let { it.length in 8..512 && ' ' !in it }

    Column(Modifier.padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(name, style = MaterialTheme.typography.titleSmall, color = e.ink)
            Text(Providers.unlocks(provider), style = MaterialTheme.typography.bodySmall, color = e.muted)
        }
        if (saved != null && !editing) {
            Text(KeyCopy.saved(saved), style = MaterialTheme.typography.bodyMedium.merge(AppText.num), color = e.ink)
            Row(Modifier.offset(x = (-12).dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) { // text buttons carry 12dp of padding: align the words with the column
                LinkButton("Replace", { editing = true; error = null })
                TextButton(
                    {
                        scope.launch {
                            try { api.removeKey(provider); onRemoved() } catch (x: CancellationException) { throw x } catch (x: Exception) {
                                error = (x as? ApiError)?.message ?: "Couldn't remove the key. Try again."
                            }
                        }
                    },
                    Modifier.heightIn(min = 48.dp),
                ) { Text("Remove", style = MaterialTheme.typography.labelLarge, color = e.badText) }
            }
        } else {
            if (stopped) Text(KeyCopy.STOPPED, style = MaterialTheme.typography.bodyMedium, color = e.warnText)
            AppField(value, { value = it; error = null }, "$name API key", password = true)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                PrimaryButton(
                    "Save",
                    {
                        scope.launch {
                            busy = true; error = null
                            try {
                                val info = api.saveKey(provider, value.trim())
                                value = "" // the key is not kept here once the server has it
                                editing = false
                                onSaved(info)
                            } catch (x: CancellationException) {
                                throw x
                            } catch (x: ApiError) {
                                error = KeyCopy.error(provider, x.status, x.code, x.message)
                            } catch (x: Exception) {
                                error = "Couldn't save the key. Try again."
                            }
                            busy = false
                        }
                    },
                    enabled = canSave, loading = busy,
                )
                if (busy) Text(KeyCopy.checking(), style = MaterialTheme.typography.bodyMedium, color = e.muted)
                else if (saved != null && !stopped) LinkButton("Cancel", { editing = false; value = ""; error = null })
            }
            error?.let { ErrorLine(it) }
        }
        if (saved != null && !editing) error?.let { ErrorLine(it) }
    }
}
