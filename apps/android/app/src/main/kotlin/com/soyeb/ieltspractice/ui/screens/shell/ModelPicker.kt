package com.soyeb.ieltspractice.ui.screens.shell

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.core.ModelInfo
import com.soyeb.ieltspractice.ui.Load
import com.soyeb.ieltspractice.ui.rememberLoad
import com.soyeb.ieltspractice.ui.theme.ErrorLine
import com.soyeb.ieltspractice.ui.theme.ext

/** The searchable list of OpenRouter models for one capability (text, stt, tts, audio-in), with each model's price. Full screen over Settings. */
@Composable
fun ModelPickerDialog(title: String, capability: String, selected: String, onPick: (String) -> Unit, onClose: () -> Unit) {
    Dialog(onClose, DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.ext.bg) {
            Column(Modifier.statusBarsPadding().navigationBarsPadding()) {
                Row(Modifier.padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClose) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = MaterialTheme.ext.ink) }
                    Text(title, style = MaterialTheme.typography.titleLarge, color = MaterialTheme.ext.ink)
                }
                ModelPickerBody(capability, selected, onPick)
            }
        }
    }
}

@Composable
fun ColumnScope.ModelPickerBody(capability: String, selected: String, onPick: (String) -> Unit) {
    val e = MaterialTheme.ext
    val api = LocalApp.current.api
    val models = rememberLoad { api.getList<ModelInfo>("/api/models", mapOf("capability" to capability)) }
    var query by remember { mutableStateOf("") }
    AppField(query, { query = it }, "Search models", Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
    when (val s = models.state) {
        Load.Loading -> Box(Modifier.fillMaxWidth().padding(24.dp), Alignment.Center) { CircularProgressIndicator() }
        is Load.Failed -> Box(Modifier.padding(16.dp)) { ErrorLine(s.message) }
        is Load.Ready -> {
            val list = s.value.filter { query.isEmpty() || it.id.contains(query, true) || (it.name ?: "").contains(query, true) }
            LazyColumn(Modifier.weight(1f)) {
                items(list, key = { it.id }) { m ->
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(role = Role.RadioButton) { onPick(m.id) }.padding(horizontal = 16.dp, vertical = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(m.name ?: m.id, style = MaterialTheme.typography.bodyLarge, color = e.ink)
                            Text(m.id, style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace), color = e.muted)
                            modelPrice(m.pricing?.prompt, m.pricing?.completion)?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = e.muted) }
                        }
                        if (m.id == selected) Icon(Icons.Filled.Check, contentDescription = "Selected", tint = e.brand)
                    }
                    RowDivider()
                }
            }
        }
    }
}
