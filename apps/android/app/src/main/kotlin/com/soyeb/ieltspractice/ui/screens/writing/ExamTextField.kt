package com.soyeb.ieltspractice.ui.screens.writing

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.input.InputTransformation
import androidx.compose.foundation.text.input.TextFieldDecorator
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.Clipboard
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.ext

/** A clipboard that never has anything to paste, so the selection menu shows no Paste and Ctrl+V does nothing. */
private class EmptyClipboard(private val base: Clipboard) : Clipboard by base {
    override suspend fun getClipEntry(): ClipEntry? = null
}

/**
 * The exam answer box. Autocorrect, suggestions and spellcheck are off; paste is refused three ways when [blockPaste]:
 * no Paste in the selection menu (empty clipboard), Ctrl+V / Shift+Insert, and any single edit that inserts [PASTE_CHARS]
 * or more characters (the keyboard's clipboard chip, a drop). [onPasteBlocked] shows the notice. [value] is read once;
 * give the field a `key` per prompt so a task switch starts a fresh field.
 */
@Composable
fun ExamTextField(
    value: String,
    onChange: (String) -> Unit,
    blockPaste: Boolean,
    onPasteBlocked: () -> Unit,
    label: String,
    placeholder: String,
    minLines: Int,
    modifier: Modifier = Modifier,
) {
    val state = rememberTextFieldState(value)
    val change by rememberUpdatedState(onChange)
    val blocked by rememberUpdatedState(onPasteBlocked)
    val block by rememberUpdatedState(blockPaste)
    LaunchedEffect(state) { snapshotFlow { state.text.toString() }.collect { change(it) } }
    val guard = remember {
        InputTransformation {
            if (block && looksPasted(originalText.toString(), asCharSequence().toString())) {
                revertAllChanges()
                blocked()
            }
        }
    }
    val clipboard = LocalClipboard.current
    val provided = remember(clipboard, blockPaste) { if (blockPaste) EmptyClipboard(clipboard) else clipboard }
    val e = MaterialTheme.ext
    CompositionLocalProvider(LocalClipboard provides provided) {
        BasicTextField(
            state,
            modifier
                .fillMaxWidth()
                .onPreviewKeyEvent { k ->
                    val paste = k.type == KeyEventType.KeyDown && ((k.isCtrlPressed && k.key == Key.V) || (k.isShiftPressed && k.key == Key.Insert))
                    if (paste && block) { blocked(); true } else false
                }
                .semantics { contentDescription = label },
            inputTransformation = guard,
            textStyle = AppText.reading.copy(color = e.ink),
            cursorBrush = SolidColor(e.brand),
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.Sentences,
                autoCorrectEnabled = false,
                keyboardType = KeyboardType.Text,
            ),
            lineLimits = TextFieldLineLimits.MultiLine(minHeightInLines = minLines),
            decorator = TextFieldDecorator { inner ->
                Box {
                    if (state.text.isEmpty()) Text(placeholder, style = AppText.reading, color = e.muted)
                    inner()
                }
            },
        )
    }
}
