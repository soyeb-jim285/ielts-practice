package com.soyeb.ieltspractice.ui.screens

import androidx.annotation.DrawableRes
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.LocalDemo
import com.soyeb.ieltspractice.R
import com.soyeb.ieltspractice.core.AttemptListItem
import com.soyeb.ieltspractice.core.AttemptPage
import com.soyeb.ieltspractice.core.Band
import com.soyeb.ieltspractice.ui.ScreenScaffold
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.AttemptResult
import com.soyeb.ieltspractice.ui.nav.Bank
import com.soyeb.ieltspractice.ui.nav.History
import com.soyeb.ieltspractice.ui.nav.WritingEditor
import com.soyeb.ieltspractice.ui.community.QuotaCaption
import com.soyeb.ieltspractice.ui.screens.writing.Segmented
import com.soyeb.ieltspractice.ui.screens.writing.shortDate
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.CardShape
import com.soyeb.ieltspractice.ui.theme.Chip
import com.soyeb.ieltspractice.ui.theme.PrimaryButton
import com.soyeb.ieltspractice.ui.theme.SectionTitle
import com.soyeb.ieltspractice.ui.theme.bandTextColor
import com.soyeb.ieltspractice.ui.theme.ext

// Mirrors: iOS Views/WritingHomeView.swift, web routes/_app/writing/index.tsx
// Writing hub: full test (Academic or General), one-task practice, recent writing, prompt bank link. Guests can start a test without an account (one free test a week).

private class Kind(val id: String, val route: WritingEditor, val title: String, val blurb: String, val meta: String, @DrawableRes val icon: Int)

private val kinds = listOf(
    Kind("t1a", WritingEditor("task1", "academic"), "Task 1 Academic", "Describe a chart, table, process or map", "20 min, 150+ words", R.drawable.ic_w_chart),
    Kind("t1g", WritingEditor("task1", "general"), "Task 1 General", "Write a letter covering three points", "20 min, 150+ words", R.drawable.ic_w_mail),
    Kind("t2", WritingEditor("task2"), "Task 2", "Argue a position in an essay", "40 min, 250+ words", R.drawable.ic_w_text),
)

@Composable
fun WritingHomeScreen(nav: AppNav) {
    val api = LocalApp.current.api
    val me by api.me.collectAsState()
    val account by api.hasAccount.collectAsState()
    val target = me?.settings?.targetBand ?: 7.0
    var variant by rememberSaveable { mutableStateOf("academic") }
    // Recent writing: the last three scored or scoring attempts. Quiet on failure and for guests (they have none).
    val recent by produceState(emptyList<AttemptListItem>(), account) {
        value = if (!account) emptyList() else runCatching { api.get<AttemptPage>("/api/attempts", mapOf("skill" to "writing", "page" to "1")) }
            .getOrNull()?.items?.filter { it.status == "done" || it.status == "analyzing" }?.take(3).orEmpty()
    }
    val scroll = rememberScrollState()
    val demoTab = LocalDemo.current?.tab
    LaunchedEffect(recent.size, scroll.maxValue) { if (demoTab == "Scrolled") scroll.scrollTo(scroll.maxValue) }

    ScreenScaffold("Writing", large = true, scroll = false) {
        Column(Modifier.weight(1f).verticalScroll(scroll), verticalArrangement = Arrangement.spacedBy(24.dp)) {
            Text(
                "Timed tasks, marked against the public band descriptors with every mistake located.",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.ext.muted,
            )
            FullTest(variant, { variant = it }) { nav.startTest("writing") { nav.go(WritingEditor("full", variant)) } }
            Practise(nav)
            if (recent.isNotEmpty()) Recent(recent, target, nav)
            PromptBankLink(nav)
            Text(
                if (me?.settings?.blockPaste == false) "Exam conditions: autocorrect, spellcheck and predictions are off, and pasting is allowed (change in Settings)."
                else "Exam conditions: autocorrect, spellcheck and predictions are off, and pasting is blocked (change in Settings).",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.ext.muted,
            )
        }
    }
}

// MARK: Full test

@Composable
private fun FullTest(variant: String, onVariant: (String) -> Unit, onStart: () -> Unit) {
    val e = MaterialTheme.ext
    AppCard(padding = 16.dp) {
        SectionTitle("Full test")
        Text("Task 1 and Task 2 on one 60-minute clock, as on test day. You manage your own time.", style = MaterialTheme.typography.bodyMedium, color = e.ink)
        Text("Task 1, 20 min. Task 2, 40 min. Both answers are marked together into one writing band.", style = MaterialTheme.typography.bodySmall, color = e.muted)
        Segmented(listOf("academic" to "Academic", "general" to "General"), variant, onVariant, Modifier.padding(vertical = 4.dp))
        PrimaryButton("Start full test", onStart, Modifier.fillMaxWidth())
        QuotaCaption("writing")
    }
}

// MARK: One task

@Composable
private fun Practise(nav: AppNav) {
    val e = MaterialTheme.ext
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionTitle("Or practise one task")
        RowCard {
            kinds.forEachIndexed { i, k ->
                if (i > 0) HorizontalDivider(Modifier.padding(start = 64.dp), color = e.line)
                ListRow(
                    onClick = { nav.startTest("writing") { nav.go(k.route) } }, minHeight = 76.dp,
                    description = "${k.title}. ${k.blurb}. ${k.meta}. Starts a random prompt",
                ) {
                    IconTile(k.icon)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(k.title, style = MaterialTheme.typography.titleMedium, color = e.ink)
                        Text(k.blurb, style = MaterialTheme.typography.bodyMedium, color = e.muted)
                        Text(k.meta, style = MaterialTheme.typography.bodySmall.merge(AppText.num), color = e.muted)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(painterResource(R.drawable.ic_w_shuffle), contentDescription = null, Modifier.size(18.dp), tint = e.brand)
                        Text("Random", style = MaterialTheme.typography.labelLarge, color = e.brand, maxLines = 1)
                    }
                }
            }
        }
    }
}

// MARK: Recent writing

@Composable
private fun Recent(items: List<AttemptListItem>, target: Double, nav: AppNav) {
    val e = MaterialTheme.ext
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
            SectionTitle("Recent writing", Modifier.weight(1f))
            Box(Modifier.heightIn(min = 48.dp).clickable(role = Role.Button) { nav.go(History("writing")) }.padding(start = 12.dp), contentAlignment = Alignment.CenterEnd) {
                Text("All writing attempts", style = MaterialTheme.typography.labelLarge, color = e.brand)
            }
        }
        RowCard {
            items.forEachIndexed { i, a ->
                if (i > 0) HorizontalDivider(Modifier.padding(start = 16.dp), color = e.line)
                ListRow(onClick = { nav.go(AttemptResult.of(a.id)) }, minHeight = 56.dp, description = null) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(a.promptTitle, style = AppText.readingSm, color = e.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("Task ${a.part}, ${shortDate(a.createdAt)}", style = MaterialTheme.typography.bodySmall, color = e.muted)
                    }
                    if (a.status == "analyzing") {
                        Chip("Scoring…", color = e.brand)
                    } else a.overall?.let { o ->
                        Text(
                            Band.format(o), Modifier.semantics { contentDescription = "Band ${Band.format(o)}" },
                            style = MaterialTheme.typography.titleLarge.merge(AppText.num), color = bandTextColor(o, target),
                        )
                    }
                }
            }
        }
    }
}

// MARK: Prompt bank

@Composable
private fun PromptBankLink(nav: AppNav) {
    val e = MaterialTheme.ext
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionTitle("Choose a prompt")
        RowCard {
            ListRow(onClick = { nav.go(Bank("writing")) }, minHeight = 64.dp, description = "Prompt bank. Pick a specific task by type or topic, or search") {
                IconTile(R.drawable.ic_w_library)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("Prompt bank", style = MaterialTheme.typography.titleMedium, color = e.ink)
                    Text("Pick a specific task by type or topic, or search", style = MaterialTheme.typography.bodyMedium, color = e.muted)
                }
            }
        }
    }
}

// MARK: Shared row pieces

/** A card of tappable rows (AppCard's own spacing is for stacked content, rows want none). */
@Composable
private fun RowCard(content: @Composable ColumnScope.() -> Unit) {
    Surface(Modifier.fillMaxWidth(), shape = CardShape, color = MaterialTheme.ext.surface, border = BorderStroke(1.dp, MaterialTheme.ext.line)) {
        Column(content = content)
    }
}

@Composable
private fun ListRow(onClick: () -> Unit, minHeight: Dp, description: String?, content: @Composable RowScope.() -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = minHeight)
            .clickable(role = Role.Button, onClick = onClick)
            .then(if (description != null) Modifier.semantics(mergeDescendants = true) { contentDescription = description } else Modifier)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        content()
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, Modifier.size(20.dp), tint = MaterialTheme.ext.muted)
    }
}

@Composable
private fun IconTile(@DrawableRes icon: Int) {
    val e = MaterialTheme.ext
    Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) {
        Surface(Modifier.size(40.dp), shape = RoundedCornerShape(10.dp), color = e.surface2) {}
        Icon(painterResource(icon), contentDescription = null, Modifier.size(22.dp), tint = e.ink)
    }
}
