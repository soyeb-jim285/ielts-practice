package com.soyeb.ieltspractice.ui.screens.lr

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.core.Block
import com.soyeb.ieltspractice.core.Inline
import com.soyeb.ieltspractice.core.LrGroup
import com.soyeb.ieltspractice.core.LrMark
import com.soyeb.ieltspractice.core.LrOption
import com.soyeb.ieltspractice.core.LrQuestion
import com.soyeb.ieltspractice.core.multiPicks
import com.soyeb.ieltspractice.core.parseContent
import com.soyeb.ieltspractice.core.parseInline
import com.soyeb.ieltspractice.core.setMultiPicks
import com.soyeb.ieltspractice.core.withAnswer
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.ControlShape
import com.soyeb.ieltspractice.ui.theme.ext

// Mirrors: web components/lr/QuestionGroup.tsx. One composable per group; the shape follows the group type.

/** Where each question is on screen, so a jump can scroll to it and focus it. Remember one per screen; [QCtx] is rebuilt on every change. */
class QRegistry {
    private val bring = HashMap<Int, BringIntoViewRequester>()
    private val focus = HashMap<Int, FocusRequester>()
    fun requester(n: Int) = bring.getOrPut(n) { BringIntoViewRequester() }
    fun focuser(n: Int) = focus.getOrPut(n) { FocusRequester() }
}

/** What every question composable of one screen shares. [marks] non-null = a submitted attempt: read-only, right and wrong shown. */
class QCtx(
    val responses: Map<String, String>,
    val onChange: (Map<String, String>) -> Unit,
    val assets: Map<String, String>,
    val marks: Map<Int, LrMark>? = null,
    /** The question to ring (jumped to from the navigator or the answers table). */
    val active: Int? = null,
    val onFocus: (Int) -> Unit = {},
    val reg: QRegistry = QRegistry(),
) {
    fun requester(n: Int) = reg.requester(n)
    fun focuser(n: Int) = reg.focuser(n)

    fun value(n: Int) = responses[n.toString()].orEmpty()
    fun set(n: Int, v: String) = onChange(responses.withAnswer(n, v))
    fun mark(n: Int) = marks?.get(n)
    val review get() = marks != null

    /** Scroll question [n] into view and put the cursor in it when it is a text field. */
    suspend fun reveal(n: Int, focusField: Boolean) {
        runCatching { requester(n).bringIntoView() }
        if (focusField && marks == null) runCatching { focuser(n).requestFocus() }
    }
}

@Composable
private fun ringColor(ctx: QCtx, n: Int, focused: Boolean = false): Color {
    val e = MaterialTheme.ext
    val m = ctx.mark(n)
    return when {
        m != null -> if (m.correct) e.good else e.bad
        focused || ctx.active == n -> e.brand
        else -> MaterialTheme.colorScheme.outline
    }
}

/** Number chip in front of an item: teal once answered, green/rose in review. */
@Composable
fun QNum(n: Int, done: Boolean, mark: LrMark?, modifier: Modifier = Modifier) {
    val e = MaterialTheme.ext
    val (bg, fg) = when {
        mark != null -> if (mark.correct) e.good.copy(alpha = 0.16f) to e.goodText else e.bad.copy(alpha = 0.16f) to e.badText
        done -> e.brandSoft to e.brand
        else -> e.surface2 to e.muted
    }
    Box(
        modifier.heightIn(min = 28.dp).widthIn(min = 28.dp).background(bg, RoundedCornerShape(6.dp)).padding(horizontal = 6.dp).clearAndSetSemantics {},
        contentAlignment = Alignment.Center,
    ) { Text("$n", style = MaterialTheme.typography.labelLarge.merge(AppText.num), color = fg) }
}

@Composable
private fun Expected(mark: LrMark?) {
    if (mark == null || mark.correct) return
    val e = MaterialTheme.ext
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Filled.Check, null, Modifier.size(14.dp), tint = e.goodText)
        Text("Correct answer: ${mark.answer.joinToString(" / ")}", style = MaterialTheme.typography.bodySmall, color = e.goodText)
    }
}

// ---------- gap: a text field inside the text ----------

@Composable
private fun GapField(n: Int, ctx: QCtx, wordLimit: String?) {
    val e = MaterialTheme.ext
    val value = ctx.value(n)
    val mark = ctx.mark(n)
    var focused by remember { mutableStateOf(false) }
    val border = ringColor(ctx, n, focused)
    val width = if (focused || ctx.active == n) 2.dp else 1.dp
    BasicTextField(
        value, { ctx.set(n, it) },
        Modifier.fillMaxSize().padding(vertical = 2.dp)
            .focusRequester(ctx.focuser(n)).bringIntoViewRequester(ctx.requester(n))
            .onFocusChanged { focused = it.isFocused; if (it.isFocused) ctx.onFocus(n) }
            .semantics {
                contentDescription = "Question $n" + (wordLimit?.let { ", ${it.lowercase()}" } ?: "")
                if (mark != null) stateDescription = if (mark.correct) "Correct" else "Wrong"
            },
        readOnly = mark != null, singleLine = true,
        textStyle = MaterialTheme.typography.bodyLarge.merge(AppText.num).copy(color = e.ink, textAlign = TextAlign.Center, fontWeight = FontWeight.Medium),
        cursorBrush = SolidColor(e.brand),
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false, imeAction = ImeAction.Next),
        decorationBox = { inner ->
            Box(
                Modifier.fillMaxSize().background(e.surface, ControlShape).border(width, border, ControlShape).padding(horizontal = 6.dp),
                contentAlignment = Alignment.Center,
            ) {
                if (value.isEmpty()) Text("$n", style = MaterialTheme.typography.bodyMedium.merge(AppText.num), color = e.muted)
                inner()
            }
        },
    )
}

/** A dropdown that reads like a field: the chosen key (or the question number), a menu of "key  text". Used for match items and word-box gaps. */
@Composable
private fun ChoiceDropdown(n: Int, ctx: QCtx, options: List<LrOption>, modifier: Modifier = Modifier) {
    val e = MaterialTheme.ext
    var open by remember { mutableStateOf(false) }
    val value = ctx.value(n)
    val mark = ctx.mark(n)
    val border = ringColor(ctx, n, open)
    Box(modifier) {
        Row(
            Modifier.fillMaxSize().background(e.surface, ControlShape).border(if (open || ctx.active == n) 2.dp else 1.dp, border, ControlShape)
                .clip(ControlShape).clickable(enabled = mark == null, role = Role.DropdownList) { open = true; ctx.onFocus(n) }
                .bringIntoViewRequester(ctx.requester(n)).padding(horizontal = 10.dp)
                .semantics { contentDescription = "Question $n, ${if (value.isEmpty()) "no answer" else "answer $value"}" },
            horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(value.ifEmpty { "$n" }, style = MaterialTheme.typography.bodyLarge.merge(AppText.num), color = if (value.isEmpty()) e.muted else e.ink, fontWeight = FontWeight.Medium)
            if (mark == null) Text("  ▾", style = MaterialTheme.typography.bodySmall, color = e.muted)
        }
        DropdownMenu(open, { open = false }, containerColor = e.surface) {
            if (value.isNotEmpty()) DropdownMenuItem({ Text("Clear answer", color = e.muted, style = MaterialTheme.typography.bodyLarge) }, { ctx.set(n, ""); open = false })
            options.forEach { o ->
                DropdownMenuItem(
                    { Text(if (o.text.isBlank()) o.key else "${o.key}  ${o.text}", color = if (o.key.equals(value, true)) e.brand else e.ink, style = MaterialTheme.typography.bodyLarge) },
                    { ctx.set(n, o.key); open = false },
                    Modifier.heightIn(min = 48.dp),
                )
            }
        }
    }
}

/** Text with `{{n}}` gaps as inline fields (or dropdowns for a word box). The line grows to fit the 44sp field. */
@Composable
private fun RichText(inline: List<Inline>, ctx: QCtx, g: LrGroup, modifier: Modifier = Modifier, wordBox: Boolean = g.type == "gap" && !g.options.isNullOrEmpty()) {
    val e = MaterialTheme.ext
    val hasGap = inline.any { it is Inline.Gap }
    val text = buildAnnotatedString {
        for (p in inline) when (p) {
            is Inline.Text -> append(p.text)
            is Inline.Bold -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(p.text) }
            is Inline.Gap -> {
                appendInlineContent("q${p.n}", "${p.n}")
                val m = ctx.mark(p.n)
                if (m != null && !m.correct) withStyle(SpanStyle(color = e.goodText, fontWeight = FontWeight.SemiBold)) { append(" ${m.answer.joinToString(" / ")}") }
            }
        }
    }
    val content = inline.filterIsInstance<Inline.Gap>().associate { gap ->
        val w = if (wordBox) 80 else (96 + 9 * ctx.value(gap.n).length).coerceIn(112, 240)
        "q${gap.n}" to InlineTextContent(Placeholder(w.sp, 44.sp, PlaceholderVerticalAlign.Center)) {
            if (wordBox) ChoiceDropdown(gap.n, ctx, g.options.orEmpty(), Modifier.fillMaxSize().padding(vertical = 2.dp)) else GapField(gap.n, ctx, g.wordLimit)
        }
    }
    Text(
        text, modifier, inlineContent = content, color = e.ink,
        style = MaterialTheme.typography.bodyLarge.let {
            if (hasGap) it.copy(lineHeight = 52.sp, lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None)) else it
        },
    )
}

@Composable
private fun Content(blocks: List<Block>, ctx: QCtx, g: LrGroup) {
    val e = MaterialTheme.ext
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        blocks.forEach { b ->
            when (b) {
                is Block.P -> RichText(b.inline, ctx, g, Modifier.fillMaxWidth())
                is Block.Items -> Column(Modifier.padding(start = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    b.items.forEachIndexed { i, it ->
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(if (b.ordered) "${i + 1}." else "•", Modifier.padding(top = 14.dp), style = MaterialTheme.typography.bodyLarge.merge(AppText.num), color = e.muted)
                            RichText(it, ctx, g, Modifier.weight(1f))
                        }
                    }
                }
                is Block.Table -> Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(1.dp, e.line, RoundedCornerShape(12.dp))) {
                    val rows = (if (b.head.any { it.isNotEmpty() }) listOf(b.head) else emptyList()) + b.rows
                    rows.forEachIndexed { r, cells ->
                        val head = b.head.any { it.isNotEmpty() } && r == 0
                        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).background(if (head) e.surface2 else Color.Transparent)) {
                            cells.forEachIndexed { c, cell ->
                                Box(Modifier.weight(1f).fillMaxSize().padding(horizontal = 10.dp, vertical = 4.dp), contentAlignment = Alignment.CenterStart) {
                                    RichText(
                                        if (head) cell.map { if (it is Inline.Text) Inline.Bold(it.text) else it } else cell, ctx, g,
                                    )
                                }
                            }
                        }
                        if (r < rows.lastIndex) Box(Modifier.fillMaxWidth().height(1.dp).background(e.line))
                    }
                }
            }
        }
    }
}

// ---------- choices: mcq cards, true/false segmented, choose-N ----------

@Composable
private fun OptionCard(key: String, text: String, selected: Boolean, enabled: Boolean, right: Boolean, wrong: Boolean, multi: Boolean, onClick: () -> Unit) {
    val e = MaterialTheme.ext
    val border = when { wrong -> e.bad; right -> e.good; selected -> e.brand; else -> MaterialTheme.colorScheme.outline.copy(alpha = 0.5f) }
    val bg = when { wrong -> e.bad.copy(alpha = 0.10f); right && selected -> e.good.copy(alpha = 0.10f); selected -> e.brandSoft; else -> e.surface }
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).background(bg, RoundedCornerShape(12.dp)).border(if (selected || right) 2.dp else 1.dp, border, RoundedCornerShape(12.dp))
            .clip(RoundedCornerShape(12.dp))
            .selectable(selected, enabled, if (multi) Role.Checkbox else Role.RadioButton, onClick = onClick)
            .semantics { contentDescription = "Option $key, $text" + if (right) ", correct answer" else "" }
            .padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(28.dp).background(if (selected) e.brand else e.surface2, RoundedCornerShape(6.dp)), contentAlignment = Alignment.Center) {
            Text(key, style = MaterialTheme.typography.labelLarge, color = if (selected) e.onBrand else e.muted)
        }
        Text(text, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge, color = e.ink)
        if (right && !selected) Icon(Icons.Filled.Check, "Correct answer", Modifier.size(18.dp), tint = e.goodText)
    }
}

/** TRUE / FALSE / NOT GIVEN (or YES / NO / NOT GIVEN): three buttons in one well; tapping the chosen one again clears it. */
@Composable
private fun Trio(n: Int, keys: List<String>, ctx: QCtx) {
    val e = MaterialTheme.ext
    val value = ctx.value(n)
    val mark = ctx.mark(n)
    val correct = mark?.answer.orEmpty().map { it.uppercase() }.toSet()
    Row(
        Modifier.fillMaxWidth().background(e.surface2, ControlShape)
            .then(if (ctx.active == n) Modifier.border(2.dp, e.brand, ControlShape) else Modifier)
            .bringIntoViewRequester(ctx.requester(n)).padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        keys.forEach { k ->
            val on = value.equals(k, true)
            val right = mark != null && k in correct
            val label = if (k == "NOT GIVEN") "Not given" else k.lowercase().replaceFirstChar { it.uppercase() }
            val bg = when { mark != null && on -> if (mark.correct) e.good.copy(alpha = 0.18f) else e.bad.copy(alpha = 0.16f); on -> e.surface; else -> Color.Transparent }
            Box(
                Modifier.weight(1f).heightIn(min = 48.dp).clip(RoundedCornerShape(6.dp)).background(bg)
                    .then(if (right && !on) Modifier.border(1.5.dp, e.good, RoundedCornerShape(6.dp)) else if (on) Modifier.border(1.dp, if (mark != null) (if (mark.correct) e.good else e.bad) else e.brand, RoundedCornerShape(6.dp)) else Modifier)
                    .selectable(on, mark == null, Role.RadioButton) { ctx.set(n, if (on) "" else k); ctx.onFocus(n) }
                    .semantics { contentDescription = "Question $n, $label" + if (right) ", correct answer" else "" },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label, style = MaterialTheme.typography.labelLarge, textAlign = TextAlign.Center, maxLines = 1,
                    color = if (on) (if (mark != null) (if (mark.correct) e.goodText else e.badText) else e.ink) else e.muted,
                )
            }
        }
    }
}

@Composable
private fun Item(q: LrQuestion, ctx: QCtx, content: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().bringIntoViewRequester(ctx.requester(q.n)), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        QNum(q.n, ctx.value(q.n).isNotBlank(), ctx.mark(q.n), Modifier.padding(top = 2.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            content()
            Expected(ctx.mark(q.n))
        }
    }
}

/** The option list of a match or word-box group, shown once. Keys that carry no text (map letters) are not listed. */
@Composable
private fun OptionList(title: String, options: List<LrOption>) {
    if (options.none { it.text.isNotBlank() }) return
    val e = MaterialTheme.ext
    Column(Modifier.fillMaxWidth().background(e.surface2, RoundedCornerShape(12.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, style = MaterialTheme.typography.titleSmall, color = e.ink, modifier = Modifier.semantics { heading() })
        options.forEach { o ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(o.key, Modifier.widthIn(min = 24.dp), style = MaterialTheme.typography.bodyMedium.merge(AppText.num), color = e.brand, fontWeight = FontWeight.SemiBold)
                Text(o.text, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = e.ink)
            }
        }
    }
}

/** A map / plan / diagram. Tap to zoom (pinch, drag). The image is fetched with the app's HTTP client and shown on white, as printed. */
@Composable
private fun Figure(url: String, title: String?) {
    val e = MaterialTheme.ext
    val api = LocalApp.current.api
    val bitmap by produceState<Bitmap?>(null, url) {
        value = runCatching { api.download(url).let { BitmapFactory.decodeByteArray(it, 0, it.size) } }.getOrNull()
    }
    var zoom by remember { mutableStateOf(false) }
    val desc = title ?: "Figure for the questions below"
    val b = bitmap
    Box(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color.White).border(1.dp, e.line, RoundedCornerShape(12.dp))
            .then(if (b != null) Modifier.clickable(onClickLabel = "Zoom in") { zoom = true } else Modifier).padding(8.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (b != null) Image(b.asImageBitmap(), desc, Modifier.fillMaxWidth().heightIn(max = 360.dp), contentScale = ContentScale.Fit)
        else Text("Loading the figure...", Modifier.padding(24.dp), style = MaterialTheme.typography.bodySmall, color = Color(0xFF5B6B80))
    }
    if (zoom && b != null) {
        Dialog({ zoom = false }, DialogProperties(usePlatformDefaultWidth = false)) {
            var scale by remember { mutableFloatStateOf(1f) }
            var offX by remember { mutableFloatStateOf(0f) }
            var offY by remember { mutableFloatStateOf(0f) }
            Box(Modifier.fillMaxSize().background(Color.White)) {
                Image(
                    b.asImageBitmap(), desc,
                    Modifier.fillMaxSize().pointerInput(Unit) {
                        detectTransformGestures { _, pan, z, _ -> scale = (scale * z).coerceIn(1f, 6f); offX += pan.x; offY += pan.y }
                    }.graphicsLayer(scaleX = scale, scaleY = scale, translationX = offX, translationY = offY),
                    contentScale = ContentScale.Fit,
                )
                IconButton({ zoom = false }, Modifier.align(Alignment.TopEnd).padding(8.dp).size(48.dp)) { Icon(Icons.Filled.Close, "Close figure", tint = Color(0xFF0F172A)) }
            }
        }
    }
}

private val RANGE_PREFIX = Regex("""^Questions? [\d\s–\-and]+\.\s*""", RegexOption.IGNORE_CASE)

/** One group of questions: instructions, optional figure and option list, then the items in the shape of its type. */
@Composable
fun QuestionGroup(g: LrGroup, ctx: QCtx, modifier: Modifier = Modifier) {
    val e = MaterialTheme.ext
    val opts = g.options.orEmpty()
    val wordBox = g.type == "gap" && opts.isNotEmpty()
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                if (g.from == g.to) "Question ${g.from}" else "Questions ${g.from} to ${g.to}",
                Modifier.semantics { heading() }, style = MaterialTheme.typography.titleMedium, color = e.ink,
            )
            Text(g.instructions.replace(RANGE_PREFIX, ""), style = MaterialTheme.typography.bodySmall, color = e.muted)
            if (g.wordLimit != null && !g.instructions.uppercase().contains(g.wordLimit.uppercase())) {
                Text("Write ${g.wordLimit}.", style = MaterialTheme.typography.bodySmall, color = e.ink, fontWeight = FontWeight.Medium)
            }
        }
        g.title?.let { Text(it, style = AppText.readingSm, color = e.ink, fontWeight = FontWeight.Medium) }
        g.image?.let { key -> ctx.assets[key]?.let { Figure(it, g.title) } }
        if (g.type == "match" || wordBox) {
            val roman = opts.any { Regex("^[ivx]+$", RegexOption.IGNORE_CASE).matches(it.key) }
            OptionList(if (wordBox) "Word box" else if (roman) "List of headings" else "Options", opts)
        }
        when {
            g.type == "gap" && g.content != null -> Content(parseContent(g.content), ctx, g)
            g.type == "gap" -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                g.questions.forEach { q ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        QNum(q.n, ctx.value(q.n).isNotBlank(), ctx.mark(q.n), Modifier.padding(top = 10.dp))
                        val t = q.text.orEmpty()
                        RichText(if (t.contains("{{${q.n}}}")) parseInline(t) else parseInline(t) + Inline.Text(" ") + Inline.Gap(q.n), ctx, g, Modifier.weight(1f))
                    }
                }
            }
            g.type == "mcq" -> Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
                g.questions.forEach { q ->
                    Item(q, ctx) {
                        Text(q.text.orEmpty(), style = MaterialTheme.typography.bodyLarge, color = e.ink, fontWeight = FontWeight.Medium)
                        val m = ctx.mark(q.n)
                        val correct = m?.answer.orEmpty().map { it.uppercase() }.toSet()
                        q.options.orEmpty().forEach { o ->
                            val on = ctx.value(q.n).equals(o.key, true)
                            OptionCard(o.key, o.text, on, m == null, m != null && o.key.uppercase() in correct, m != null && on && !m.correct, false) { ctx.set(q.n, if (on) "" else o.key); ctx.onFocus(q.n) }
                        }
                    }
                }
            }
            g.type == "mcq-multi" -> {
                val picks = multiPicks(g, ctx.responses)
                val max = g.questions.size
                val correct = g.questions.firstOrNull()?.answer.orEmpty().map { it.uppercase() }.toSet()
                Column(Modifier.bringIntoViewRequester(ctx.requester(g.from)), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) { g.questions.forEach { QNum(it.n, ctx.value(it.n).isNotBlank(), ctx.mark(it.n)) } }
                        Text(g.questions.firstOrNull()?.text ?: "Choose $max answers", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge, color = e.ink, fontWeight = FontWeight.Medium)
                    }
                    if (!ctx.review) Text(
                        "Choose $max. ${picks.size} of $max selected${if (picks.size >= max) "; tap one to change" else ""}.",
                        Modifier.semantics { stateDescription = "${picks.size} of $max selected" }, style = MaterialTheme.typography.bodySmall,
                        color = if (picks.size >= max) e.brand else e.muted,
                    )
                    opts.forEach { o ->
                        val on = picks.contains(o.key)
                        val right = ctx.review && o.key.uppercase() in correct
                        OptionCard(
                            o.key, o.text, on, !ctx.review && (on || picks.size < max), right, ctx.review && on && !right, true,
                        ) { ctx.onChange(setMultiPicks(g, ctx.responses, if (on) picks - o.key else picks + o.key)); ctx.onFocus(g.from) }
                    }
                }
            }
            g.type == "tfng" || g.type == "ynng" -> Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
                val keys = if (g.type == "tfng") listOf("TRUE", "FALSE", "NOT GIVEN") else listOf("YES", "NO", "NOT GIVEN")
                g.questions.forEach { q -> Item(q, ctx) { Text(q.text.orEmpty(), style = MaterialTheme.typography.bodyLarge, color = e.ink); Trio(q.n, keys, ctx) } }
            }
            else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                g.questions.forEach { q ->
                    Item(q, ctx) {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(q.text.orEmpty(), Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge, color = e.ink)
                            ChoiceDropdown(q.n, ctx, opts, Modifier.size(width = 96.dp, height = 48.dp))
                        }
                    }
                }
            }
        }
    }
}
