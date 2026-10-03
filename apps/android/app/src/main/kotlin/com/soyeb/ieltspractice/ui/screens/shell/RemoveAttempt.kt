package com.soyeb.ieltspractice.ui.screens.shell

import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.RowScope
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import com.soyeb.ieltspractice.core.ApiClient
import com.soyeb.ieltspractice.core.Empty
import com.soyeb.ieltspractice.ui.theme.ext

// Mirrors: iOS Views/RemoveAttempt.swift, web components/history/RemoveAttempt.tsx

/** What a confirm dialog is asking about. [lr]: a Listening or Reading attempt. */
data class RemovalTarget(val id: String, val title: String, val lr: Boolean)

/** DELETE /api/attempts/{id} or /api/lr/attempts/{id}: the server hard-deletes the row, analysis and recording; the test allowance is NOT given back. */
suspend fun removeAttempt(api: ApiClient, t: RemovalTarget) {
    api.send<Empty>("DELETE", if (t.lr) "/api/lr/attempts/${t.id}" else "/api/attempts/${t.id}")
}

/** The confirm step before any removal. */
@Composable
fun ConfirmRemoveDialog(target: RemovalTarget, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    val e = MaterialTheme.ext
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = e.surface,
        title = { Text("Remove from history?", style = MaterialTheme.typography.titleLarge, color = e.ink) },
        text = { Text("${target.title}\nThis permanently deletes the result, recording and analysis. It can't be undone.", style = MaterialTheme.typography.bodyMedium, color = e.muted) },
        dismissButton = { TextButton(onDismiss) { Text("Cancel", color = e.ink) } },
        confirmButton = { TextButton(onConfirm) { Text("Remove", color = e.badText) } },
    )
}

/** Top-bar "More actions" menu for a result screen: one item, "Remove from history". Shows nothing until [onRemove] is known. */
@Composable
fun RowScope.RemoveMenuAction(onRemove: (() -> Unit)?) {
    if (onRemove == null) return
    var open by remember { mutableStateOf(false) }
    IconButton({ open = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "More actions") }
    DropdownMenu(open, { open = false }) {
        DropdownMenuItem(
            text = { Text("Remove from history", color = MaterialTheme.ext.badText) },
            leadingIcon = { Icon(Icons.Filled.Delete, null, tint = MaterialTheme.ext.badText) },
            onClick = { open = false; onRemove() },
        )
    }
}

/** A long-press menu anchored on a list row (the same item). Put it right after the row's clickable content, inside a Box. */
@Composable
fun RemoveRowMenu(open: Boolean, onClose: () -> Unit, onRemove: () -> Unit) {
    DropdownMenu(open, onClose) {
        DropdownMenuItem(
            text = { Text("Remove from history", color = MaterialTheme.ext.badText) },
            leadingIcon = { Icon(Icons.Filled.Delete, null, tint = MaterialTheme.ext.badText) },
            onClick = { onClose(); onRemove() },
        )
    }
}

/** A list row that opens on tap and offers "Remove from history" on long press (and as a TalkBack custom action). */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun RemovableRow(onClick: () -> Unit, onRemove: () -> Unit, content: @Composable () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    androidx.compose.foundation.layout.Box(
        Modifier
            .fillMaxWidth()
            .combinedClickable(role = androidx.compose.ui.semantics.Role.Button, onLongClickLabel = "Remove from history", onLongClick = { menu = true }, onClick = onClick)
            .semantics { customActions = listOf(CustomAccessibilityAction("Remove from history") { onRemove(); true }) },
    ) {
        content()
        RemoveRowMenu(menu, { menu = false }, onRemove)
    }
}
