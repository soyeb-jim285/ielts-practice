package com.soyeb.ieltspractice.ui.screens.lr

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.TextToolbar
import androidx.compose.ui.platform.TextToolbarStatus
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.BaselineShift
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import com.soyeb.ieltspractice.core.AppJson
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer

// Mirrors: web components/lr/Marks.tsx + lib/lr.ts (marks). Highlights and notes on the test text; docs/exam-fidelity.md section 1.
// Stored per attempt on this device only (SharedPreferences "lr" key `marks:<attemptId>`), never sent anywhere.

const val NOTE_MAX = 500

/** One highlight, with an optional note. [region] is `passage:<part>:<paragraph>`, `q:<n>:<field>` or `grp:<from>:<field>`; [s]/[e] are character offsets into that region's plain text. [x] caches the marked text for the Notes list. */
@Serializable
data class TextMark(val id: String, val region: String, val p: Int = 0, val s: Int, val e: Int, val note: String? = null, val x: String? = null)

class Sel(val region: String, val s: Int, val e: Int)

fun parseMarks(json: String?): List<TextMark> =
    runCatching { AppJson.decodeFromString(ListSerializer(TextMark.serializer()), json.orEmpty()) }.getOrDefault(emptyList())

fun marksJson(marks: List<TextMark>): String = AppJson.encodeToString(ListSerializer(TextMark.serializer()), marks)

private fun TextMark.hits(s: Int, e: Int) = this.s < e && s < this.e
private fun paraOf(region: String) = region.split(':').let { if (it[0] == "passage") it.getOrNull(2)?.toIntOrNull() ?: 0 else 0 }

/** A plain highlight merges with the plain highlights it overlaps. Over a note it does nothing (the note is edited instead). */
fun withHighlight(marks: List<TextMark>, region: String, s: Int, e: Int, id: String): List<TextMark> {
    if (e <= s) return marks
    val here = marks.filter { it.region == region && it.hits(s, e) }
    if (here.any { it.note != null }) return marks
    val lo = minOf(s, here.minOfOrNull { it.s } ?: s)
    val hi = maxOf(e, here.maxOfOrNull { it.e } ?: e)
    return marks.filter { m -> here.none { it.id == m.id } } + TextMark(id, region, paraOf(region), lo, hi)
}

/** Add a note over a selection. Over an existing note it edits that note; plain highlights under the selection are absorbed. */
fun withNote(marks: List<TextMark>, region: String, s: Int, e: Int, note: String, id: String): List<TextMark> {
    val text = note.trim().take(NOTE_MAX).ifEmpty { null }
    val here = marks.filter { it.region == region && it.hits(s, e) }
    val own = here.firstOrNull { it.note != null }
    if (own != null) return withNoteText(marks, own.id, note)
    val lo = minOf(s, here.minOfOrNull { it.s } ?: s)
    val hi = maxOf(e, here.maxOfOrNull { it.e } ?: e)
    return marks.filter { m -> here.none { it.id == m.id } } + TextMark(id, region, paraOf(region), lo, hi, text)
}

/** Set (or, when blank, clear) the note of one mark; a mark whose note is cleared stays as a plain highlight. */
fun withNoteText(marks: List<TextMark>, id: String, note: String): List<TextMark> =
    marks.map { if (it.id == id) it.copy(note = note.trim().take(NOTE_MAX).ifEmpty { null }) else it }

fun withoutMark(marks: List<TextMark>, id: String): List<TextMark> = marks.filter { it.id != id }

/** "Passage 2, paragraph 3" / "Question 14". */
fun markWhere(m: TextMark): String {
    val p = m.region.split(':')
    return when (p[0]) {
        "passage" -> "Passage ${p.getOrNull(1)}, paragraph ${(p.getOrNull(2)?.toIntOrNull() ?: 0) + 1}"
        "q", "grp" -> "Question ${p.getOrNull(1)}"
        else -> "Test"
    }
}

/** The question a q:/grp: mark belongs to, or null (passage marks). */
fun markQuestion(m: TextMark): Int? = m.region.split(':').let { if (it[0] == "q" || it[0] == "grp") it.getOrNull(1)?.toIntOrNull() else null }

/**
 * Where the selected text sits. Compose's SelectionContainer does not expose offsets, so the selection is copied and searched for in the
 * visible regions (first match). ponytail: a phrase that occurs twice marks its first occurrence; add per-text selection ranges if that bites.
 */
fun locateSelection(regions: Map<String, String>, picked: String): List<Sel> {
    val clean = picked.replace("\u2020", "")
    fun find(piece: String): Sel? {
        val t = piece.trim()
        if (t.isEmpty()) return null
        for ((r, text) in regions) { val i = text.indexOf(t); if (i >= 0) return Sel(r, i, i + t.length) }
        return null
    }
    find(clean)?.let { return listOf(it) }
    return clean.split('\n').mapNotNull(::find).distinctBy { it.region + ":" + it.s }
}

class NoteDraft(val sel: Sel?, val id: String?, val text: String)

/** The marks of one attempt plus the transient UI state around them. [persist] saves every change. */
class Marks(initial: List<TextMark>, private val persist: (List<TextMark>) -> Unit) {
    var list by mutableStateOf(initial)
        private set
    /** Plain text of every region on screen now, for locating a selection. */
    val regions = LinkedHashMap<String, String>()
    var menu by mutableStateOf<String?>(null)
    var editor by mutableStateOf<NoteDraft?>(null)
    var flash by mutableStateOf<String?>(null)

    fun update(next: List<TextMark>) {
        val withText = next.map { m -> regions[m.region]?.let { t -> runCatching { m.copy(x = t.substring(m.s, m.e).take(80)) }.getOrNull() } ?: m }
        list = withText
        persist(withText)
    }

    fun newId() = java.util.UUID.randomUUID().toString().take(8)
    fun highlight(sels: List<Sel>) { if (sels.isNotEmpty()) update(sels.fold(list) { acc, x -> withHighlight(acc, x.region, x.s, x.e, newId()) }) }
    fun beginNote(sel: Sel) {
        val own = list.firstOrNull { it.region == sel.region && it.note != null && it.s < sel.e && sel.s < it.e }
        editor = if (own != null) NoteDraft(null, own.id, own.note.orEmpty()) else NoteDraft(sel, null, "")
    }
    fun save(d: NoteDraft, text: String) {
        if (d.id != null) update(withNoteText(list, d.id, text))
        else if (d.sel != null && text.isNotBlank()) update(withNote(list, d.sel.region, d.sel.s, d.sel.e, text, newId()))
    }
    fun excerpt(m: TextMark): String = regions[m.region]?.let { runCatching { it.substring(m.s, m.e) }.getOrNull() } ?: m.x.orEmpty()

    /** Registers [text] as the content of [region] while it is on screen. */
    @Composable
    fun Track(region: String, text: String) {
        remember(region, text) { regions[region] = text; 0 }
        DisposableEffect(region) { onDispose { regions.remove(region) } }
    }
}

class MarkLook(val bg: Color, val fg: Color, val flashBg: Color, val underline: Boolean)

@Composable
fun markLook(): MarkLook {
    val e = MaterialTheme.ext
    return when (LocalLrScheme.current) {
        "bw" -> MarkLook(Color(0xFFFFE14D), Color.Black, Color(0xFFFFA000), false)
        "cream" -> MarkLook(Color(0xFFF2C200), Color.Black, Color(0xFFE08A00), false)
        "yb" -> MarkLook(Color(0xFF00B3FF), Color.Black, Color(0xFF9BE0FF), true) // underline stands in for the 1 px outline
        else -> if (e.isDark) MarkLook(Color(0xFF854D0E), Color.Unspecified, Color(0xFFB45309), false) else MarkLook(Color(0xFFFEF08A), Color.Unspecified, Color(0xFFFDBA74), false)
    }
}

/** Appends [text] (which starts at plain offset [base] of its region) with the marks that fall inside it. A noted mark gets a dagger marker after its end. */
fun AnnotatedString.Builder.appendMarked(text: String, base: Int, marks: List<TextMark>, look: MarkLook, noteColor: Color, flash: String?, onOpen: (String) -> Unit) {
    var at = 0
    for (m in marks.sortedBy { it.s }) {
        val s = (m.s - base).coerceIn(at, text.length)
        val e = (m.e - base).coerceIn(s, text.length)
        if (e <= s) continue
        append(text.substring(at, s))
        val bg = if (m.id == flash) look.flashBg else look.bg
        val style = SpanStyle(background = bg, color = look.fg, textDecoration = if (look.underline) TextDecoration.Underline else null)
        withLink(LinkAnnotation.Clickable(m.id, TextLinkStyles(style)) { onOpen(m.id) }) { append(text.substring(s, e)) }
        at = e
        if (m.note != null && m.e - base in 1..text.length) {
            val note = SpanStyle(color = noteColor, fontWeight = FontWeight.Bold, baselineShift = BaselineShift.Superscript)
            withLink(LinkAnnotation.Clickable(m.id + "n", TextLinkStyles(note)) { onOpen(m.id) }) { append("\u2020") }
        }
    }
    append(text.substring(at))
}

/** Text that can carry marks. With no [hl] (the review screens) it is a plain Text. */
@Composable
fun MarkedText(hl: Marks?, region: String, text: String, style: TextStyle, color: Color, modifier: Modifier = Modifier, fontWeight: FontWeight? = null) {
    if (hl == null) { Text(text, modifier, color = color, style = style, fontWeight = fontWeight); return }
    hl.Track(region, text)
    val look = markLook()
    val brand = MaterialTheme.ext.brand
    val marks = hl.list.filter { it.region == region }
    val str = buildAnnotatedString { appendMarked(text, 0, marks, look, brand, hl.flash) { hl.menu = it } }
    Text(str, modifier, color = color, style = style, fontWeight = fontWeight)
}

// ---------- selection menu: a floating "Highlight | Note | Copy" chip ----------

/**
 * Replaces the text toolbar for read-only selections with [chip] state; anything that can paste or cut (the gap fields) goes to [base] untouched.
 * Compose has no hook to add items to the system selection menu, so this is the floating chip the spec allows.
 */
class MarkToolbar(private val base: TextToolbar) : TextToolbar {
    var rect by mutableStateOf<Rect?>(null)
    var copy: (() -> Unit)? = null
    override val status: TextToolbarStatus get() = if (rect != null) TextToolbarStatus.Shown else base.status
    override fun showMenu(rect: Rect, onCopyRequested: (() -> Unit)?, onPasteRequested: (() -> Unit)?, onCutRequested: (() -> Unit)?, onSelectAllRequested: (() -> Unit)?) {
        if (onPasteRequested != null || onCutRequested != null) { this.rect = null; base.showMenu(rect, onCopyRequested, onPasteRequested, onCutRequested, onSelectAllRequested); return }
        this.rect = rect
        copy = onCopyRequested
    }
    override fun hide() { rect = null; copy = null; base.hide() }
}

/** Copies the current selection to the clipboard and reads it back (the previous clip is restored). Empty when nothing arrived. */
private suspend fun readSelection(ctx: Context, copy: (() -> Unit)?): String {
    val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return ""
    var out = ""
    runCatching {
        val prev = cm.primaryClip
        cm.setPrimaryClip(ClipData.newPlainText("", ""))
        copy?.invoke()
        repeat(10) {
            if (out.isEmpty()) {
                delay(40)
                out = cm.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(ctx)?.toString().orEmpty()
            }
        }
        if (prev != null) cm.setPrimaryClip(prev)
    }
    return out
}

@Composable
fun MarkChip(tb: MarkToolbar, hl: Marks) {
    val r = tb.rect ?: return
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val e = MaterialTheme.ext
    val pos = remember(r) {
        object : PopupPositionProvider {
            override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize, layoutDirection: LayoutDirection, popupContentSize: IntSize): IntOffset {
                val x = (r.center.x.toInt() - popupContentSize.width / 2).coerceIn(0, (windowSize.width - popupContentSize.width).coerceAtLeast(0))
                val above = r.top.toInt() - popupContentSize.height - 12
                return IntOffset(x, if (above >= 0) above else r.bottom.toInt() + 64)
            }
        }
    }
    fun act(then: (List<Sel>) -> Unit) {
        val copy = tb.copy
        scope.launch {
            val picked = readSelection(ctx, copy)
            tb.hide()
            then(locateSelection(hl.regions, picked))
        }
    }
    Popup(popupPositionProvider = pos, properties = PopupProperties(focusable = false)) {
        Surface(shape = RoundedCornerShape(12.dp), color = e.surface, shadowElevation = 6.dp, border = BorderStroke(1.dp, e.line)) {
            Row {
                TextButton({ act { hl.highlight(it) } }, Modifier.heightIn(min = 48.dp)) { Text("Highlight", color = e.ink) }
                TextButton({ act { s -> s.firstOrNull()?.let(hl::beginNote) } }, Modifier.heightIn(min = 48.dp)) { Text("Add note", color = e.ink) }
                TextButton({ tb.copy?.invoke(); tb.hide() }, Modifier.heightIn(min = 48.dp)) { Text("Copy", color = e.muted) }
            }
        }
    }
}

/** The menu of one mark (note text, Edit or Add note, Remove) and the note editor. */
@Composable
fun MarkDialogs(hl: Marks) {
    val e = MaterialTheme.ext
    val open = hl.menu?.let { id -> hl.list.firstOrNull { it.id == id } }
    if (open != null) AlertDialog(
        { hl.menu = null }, containerColor = e.surface, titleContentColor = e.ink, textContentColor = e.muted,
        title = { Text(if (open.note != null) "Note" else "Highlight") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("\u201C${hl.excerpt(open)}\u201D", style = MaterialTheme.typography.bodySmall, color = e.muted, maxLines = 3)
                open.note?.let { Text(it, style = MaterialTheme.typography.bodyLarge, color = e.ink) }
            }
        },
        confirmButton = { TextButton({ hl.menu = null; hl.editor = NoteDraft(null, open.id, open.note.orEmpty()) }) { Text(if (open.note == null) "Add note" else "Edit note", color = e.brand) } },
        dismissButton = {
            Row {
                TextButton({ hl.update(withoutMark(hl.list, open.id)); hl.menu = null }) { Text(if (open.note == null) "Remove" else "Delete", color = e.badText) }
                TextButton({ hl.menu = null }) { Text("Close", color = e.ink) }
            }
        },
    )
    hl.editor?.let { d ->
        var text by remember(d) { mutableStateOf(d.text) }
        AlertDialog(
            { hl.editor = null }, containerColor = e.surface, titleContentColor = e.ink, textContentColor = e.muted,
            title = { Text("Note", Modifier.semantics { heading() }) },
            text = {
                OutlinedTextField(
                    text, { text = it.take(NOTE_MAX) }, Modifier.fillMaxWidth(), label = { Text("Your note") },
                    supportingText = { Text("${text.length} of $NOTE_MAX. Kept on this device only.") }, minLines = 3,
                )
            },
            confirmButton = { TextButton({ hl.save(d, text); hl.editor = null }) { Text("Save", color = e.brand) } },
            dismissButton = { TextButton({ hl.editor = null }) { Text("Cancel", color = e.ink) } },
        )
    }
}

/** The Notes sheet: every mark of the attempt with its place, the marked text and the note. [canJump] false hides Go to (Listening exam, another part). */
@Composable
fun NotesSheet(hl: Marks, canJump: (TextMark) -> Boolean, onJump: (TextMark) -> Unit, onDismiss: () -> Unit) {
    val e = MaterialTheme.ext
    LrSheet(onDismiss) {
        Text("Notes", style = MaterialTheme.typography.headlineSmall, color = e.ink, modifier = Modifier.semantics { heading() })
        if (hl.list.isEmpty()) Text("Nothing marked yet.", style = MaterialTheme.typography.bodyMedium, color = e.muted)
        hl.list.forEach { m ->
            Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp), color = e.surface2) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(markWhere(m), style = MaterialTheme.typography.labelMedium, color = e.muted)
                    Text("\u201C${hl.excerpt(m)}\u201D", style = MaterialTheme.typography.bodyMedium, color = e.ink, maxLines = 3)
                    m.note?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = e.brand) }
                    Row {
                        if (canJump(m)) TextButton({ onJump(m) }, Modifier.heightIn(min = 48.dp)) { Text("Go to", color = e.brand) }
                        TextButton({ onDismiss(); hl.editor = NoteDraft(null, m.id, m.note.orEmpty()) }, Modifier.heightIn(min = 48.dp)) { Text(if (m.note == null) "Add note" else "Edit note", color = e.ink) }
                        TextButton({ hl.update(withoutMark(hl.list, m.id)) }, Modifier.heightIn(min = 48.dp)) { Text("Delete", color = e.badText) }
                    }
                }
            }
        }
    }
}
