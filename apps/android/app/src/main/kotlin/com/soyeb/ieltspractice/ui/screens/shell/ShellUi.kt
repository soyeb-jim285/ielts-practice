package com.soyeb.ieltspractice.ui.screens.shell

import androidx.annotation.DrawableRes
import com.soyeb.ieltspractice.R
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.ControlShape
import com.soyeb.ieltspractice.ui.theme.PrimaryButton
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.SectionTitle
import com.soyeb.ieltspractice.ui.theme.ext

// Small building blocks shared by the shell screens. Composition of the theme components, not new styling.

/** A segmented control: a `surface2` well, the chosen option a soft brand pill ("you are here"). Options are (value, label). */
@Composable
fun Segmented(options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
    val e = MaterialTheme.ext
    Row(modifier.fillMaxWidth().clip(ControlShape).background(e.surface2).padding(3.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        options.forEach { (value, label) ->
            val on = value == selected
            Box(
                Modifier.weight(1f).heightIn(min = 44.dp).clip(RoundedCornerShape(6.dp))
                    .background(if (on) e.brandSoft else Color.Transparent)
                    .selectable(on, role = Role.RadioButton, onClick = { onSelect(value) }),
                contentAlignment = Alignment.Center,
            ) {
                Text(label, style = MaterialTheme.typography.labelLarge, color = if (on) e.brand else e.muted, textAlign = TextAlign.Center)
            }
        }
    }
}

/** Track with a fill and an optional target tick (web ProgressBar plus marker). [value] and [marker] are 0..1. */
@Composable
fun BandBar(value: Double, label: String, modifier: Modifier = Modifier, marker: Double? = null, fill: Color = MaterialTheme.ext.brand, height: Dp = 8.dp) {
    val e = MaterialTheme.ext
    Canvas(modifier.fillMaxWidth().height(height + 8.dp).semantics { contentDescription = label }) {
        val h = height.toPx()
        val top = (size.height - h) / 2
        val r = CornerRadius(h / 2)
        drawRoundRect(e.surface2, Offset(0f, top), Size(size.width, h), r)
        val w = size.width * value.coerceIn(0.0, 1.0).toFloat()
        if (w > 0f) drawRoundRect(fill, Offset(0f, top), Size(maxOf(w, h), h), r)
        if (marker != null) {
            val x = (size.width * marker.toFloat() - 1.dp.toPx()).coerceIn(0f, maxOf(0f, size.width - 2.dp.toPx()))
            drawRoundRect(e.ink, Offset(x, 0f), Size(2.dp.toPx(), size.height), CornerRadius(1.dp.toPx()))
        }
    }
}

/** A tappable list row: leading icon, title and meta, optional chip, chevron. */
@Composable
fun NavRow(title: String, meta: String?, onClick: () -> Unit, modifier: Modifier = Modifier, @DrawableRes icon: Int? = null, badge: String? = null) {
    val e = MaterialTheme.ext
    Row(
        modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(role = Role.Button, onClick = onClick).padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) Icon(painterResource(icon), null, Modifier.size(24.dp), tint = e.muted)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, color = e.ink)
            if (meta != null) Text(meta, style = MaterialTheme.typography.bodySmall, color = e.muted)
        }
        if (badge != null) com.soyeb.ieltspractice.ui.theme.Chip(badge, color = e.brand)
        Icon(Icons.Filled.KeyboardArrowRight, null, tint = e.muted)
    }
}

/** A hairline between rows inside a card. */
@Composable fun RowDivider() = HorizontalDivider(color = MaterialTheme.ext.line)

/** A text-link style action in brand teal with a 48dp touch target. */
@Composable
fun LinkButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    TextButton(onClick, modifier.heightIn(min = 48.dp), enabled = enabled, shape = ControlShape) {
        Text(text, style = MaterialTheme.typography.labelLarge, color = if (enabled) MaterialTheme.ext.brand else MaterialTheme.ext.muted)
    }
}

/** A labelled outlined text field on our tokens (control edge = `outline`, focus = brand). */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun AppField(
    value: String, onChange: (String) -> Unit, label: String, modifier: Modifier = Modifier,
    keyboardType: KeyboardType = KeyboardType.Text, password: Boolean = false, singleLine: Boolean = true,
    placeholder: String? = null, textAlign: TextAlign = TextAlign.Start, mono: Boolean = false, isError: Boolean = false,
    contentType: ContentType? = null,
) {
    val e = MaterialTheme.ext
    var shown by remember { mutableStateOf(false) }
    OutlinedTextField(
        value, onChange, modifier.fillMaxWidth().then(if (contentType != null) Modifier.semantics { this.contentType = contentType } else Modifier),
        label = { Text(label) }, placeholder = if (placeholder != null) ({ Text(placeholder) }) else null, singleLine = singleLine, isError = isError,
        textStyle = (if (mono) MaterialTheme.typography.headlineSmall.copy(fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace) else MaterialTheme.typography.bodyLarge)
            .copy(color = e.ink, textAlign = textAlign),
        visualTransformation = if (password && !shown) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else keyboardType),
        trailingIcon = if (password) ({ TextButton({ shown = !shown }) { Text(if (shown) "Hide" else "Show", color = e.muted) } }) else null,
        shape = ControlShape,
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = e.brand, unfocusedBorderColor = MaterialTheme.colorScheme.outline, cursorColor = e.brand,
            focusedLabelColor = e.brand, unfocusedLabelColor = e.muted, errorBorderColor = e.bad, errorLabelColor = e.badText,
            focusedContainerColor = e.surface, unfocusedContainerColor = e.surface, errorContainerColor = e.surface,
            focusedTextColor = e.ink, unfocusedTextColor = e.ink, focusedPlaceholderColor = e.muted, unfocusedPlaceholderColor = e.muted,
        ),
    )
}

/** A dropdown filter that reads like a field: muted label, current value, caret. Options are (value, label). */
@Composable
fun FilterMenu(label: String, options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
    val e = MaterialTheme.ext
    var open by remember { mutableStateOf(false) }
    val current = options.firstOrNull { it.first == selected }?.second ?: options.firstOrNull()?.second.orEmpty()
    Box(modifier) {
        Surface(
            { open = true }, Modifier.fillMaxWidth().heightIn(min = 48.dp), shape = ControlShape, color = e.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        ) {
            Row(Modifier.padding(start = 14.dp, end = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(label, style = MaterialTheme.typography.bodySmall, color = e.muted)
                Text(current, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge, color = e.ink, maxLines = 1)
                Icon(Icons.Filled.ArrowDropDown, null, tint = e.muted)
            }
        }
        DropdownMenu(open, { open = false }, containerColor = e.surface) {
            options.forEach { (v, l) ->
                DropdownMenuItem(
                    { Text(l, color = if (v == selected) e.brand else e.ink, style = MaterialTheme.typography.bodyLarge) },
                    { onSelect(v); open = false },
                )
            }
        }
    }
}

/** Friendly "this needs an account" state, not an error: icon, title, one line, Create account (primary) over Sign in (secondary). */
@Composable
fun SignInPrompt(nav: AppNav, reason: String, title: String = "Sign in to continue", @DrawableRes icon: Int = R.drawable.ic_settings, modifier: Modifier = Modifier) {
    val e = MaterialTheme.ext
    Column(modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Box(Modifier.size(64.dp).background(e.brandSoft, RoundedCornerShape(16.dp)), Alignment.Center) {
            Icon(painterResource(icon), null, Modifier.size(28.dp), tint = e.brand)
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, Modifier.semantics { heading() }, style = MaterialTheme.typography.titleLarge, color = e.ink, textAlign = TextAlign.Center)
            Text(reason, style = MaterialTheme.typography.bodyLarge, color = e.muted, textAlign = TextAlign.Center)
        }
        Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            PrimaryButton("Create account", { nav.openLogin(reason, signUp = true) }, Modifier.fillMaxWidth())
            SecondaryButton("Sign in", { nav.openLogin(reason) }, Modifier.fillMaxWidth())
        }
    }
}

/** Shown in place of personal content for a guest. Signing in swaps the real content in. */
@Composable
fun ColumnScope.SignInGate(nav: AppNav, reason: String, signedIn: Boolean, title: String = "Sign in to continue", @DrawableRes icon: Int = R.drawable.ic_settings, content: @Composable ColumnScope.() -> Unit) {
    if (signedIn) { content(); return }
    SignInPrompt(nav, reason, title, icon)
}

/** A short message pill over the bottom of the screen (an ink fill, so it reads on both themes). */
@Composable
fun Toast(text: String?, modifier: Modifier = Modifier) {
    if (text == null) return
    val e = MaterialTheme.ext
    Surface(modifier.padding(bottom = 12.dp), shape = CircleShape, color = e.ink, shadowElevation = 4.dp) {
        Text(text, Modifier.padding(horizontal = 20.dp, vertical = 12.dp), style = MaterialTheme.typography.labelLarge, color = e.bg)
    }
}

/** A tabular number in the display serif (predicted band, target). */
@Composable
fun BigNumber(text: String, modifier: Modifier = Modifier) =
    Text(text, modifier, style = MaterialTheme.typography.headlineLarge.merge(AppText.num), color = MaterialTheme.ext.ink)

/** The small heading over a card of rows ("Today", "Speaking, Part 1"). */
@Composable
fun GroupHeader(text: String, modifier: Modifier = Modifier) {
    Text(
        text, modifier.fillMaxWidth().padding(start = 4.dp, bottom = 6.dp).semantics { heading() },
        style = MaterialTheme.typography.labelLarge, color = MaterialTheme.ext.muted,
    )
}

/** Nothing to show (iOS ContentUnavailableView): a serif title, a sentence, an optional action. */
@Composable
fun EmptyState(title: String, text: String, modifier: Modifier = Modifier, action: String? = null, onAction: () -> Unit = {}, secondary: Boolean = false) {
    AppCard(modifier) {
        SectionTitle(title)
        Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.ext.muted)
        if (action != null) {
            if (secondary) com.soyeb.ieltspractice.ui.theme.SecondaryButton(action, onAction, Modifier.fillMaxWidth())
            else PrimaryButton(action, onAction, Modifier.fillMaxWidth())
        }
    }
}
