package com.soyeb.ieltspractice.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.core.CategoryCount
import com.soyeb.ieltspractice.core.Empty
import com.soyeb.ieltspractice.core.Mistake
import com.soyeb.ieltspractice.core.MistakeLog
import com.soyeb.ieltspractice.core.categoryLabel
import com.soyeb.ieltspractice.core.clock
import com.soyeb.ieltspractice.ui.ScreenScaffold
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.AttemptResult
import com.soyeb.ieltspractice.ui.nav.Mistakes
import com.soyeb.ieltspractice.ui.nav.WritingEditor
import com.soyeb.ieltspractice.ui.screens.shell.EmptyState
import com.soyeb.ieltspractice.ui.screens.shell.LinkButton
import com.soyeb.ieltspractice.ui.screens.shell.PageResult
import com.soyeb.ieltspractice.ui.screens.shell.Paged
import com.soyeb.ieltspractice.ui.screens.shell.RowDivider
import com.soyeb.ieltspractice.ui.screens.shell.ShellDate
import com.soyeb.ieltspractice.ui.screens.shell.SignInGate
import com.soyeb.ieltspractice.ui.screens.shell.Toast
import com.soyeb.ieltspractice.ui.screens.shell.runsBy
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.Chip
import com.soyeb.ieltspractice.ui.theme.ErrorLine
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// Mirrors: iOS Views/MistakesView.swift, web routes/_app/mistakes.tsx

/** Error log: every correction from results, grouped by attempt, filterable by category, 30 per page (GET /api/mistakes). */
@Composable
fun MistakesScreen(route: Mistakes, nav: AppNav) {
    val api = LocalApp.current.api
    val token by api.token.collectAsState()
    ScreenScaffold("Mistakes", onBack = nav::back, scroll = false) {
        SignInGate(nav, "Sign in to see the mistakes from your results.", token != null) { MistakeLogList(route, nav) }
    }
}

@Composable
private fun ColumnScope.MistakeLogList(route: Mistakes, nav: AppNav) {
    val api = LocalApp.current.api
    val scope = rememberCoroutineScope()
    var category by remember { mutableStateOf(route.category) }
    var groups by remember { mutableStateOf(emptyList<CategoryCount>()) }
    var toast by remember { mutableStateOf<String?>(null) }
    val paged = remember {
        Paged(scope) { page ->
            val log = api.get<MistakeLog>("/api/mistakes", mapOf("category" to category, "page" to page.toString()))
            groups = log.groups
            PageResult(log.items, log.total)
        }
    }
    LaunchedEffect(category) { paged.reset() }
    LaunchedEffect(toast) { if (toast != null) { delay(2500); toast = null } }
    val all = groups.sumOf { it.count }
    val attempts = runsBy(paged.items) { it.attemptId }

    fun add(m: Mistake) {
        scope.launch {
            toast = try {
                api.send<Empty>("POST", "/api/mistakes/${m.id}/card")
                paged.update { if (it.id == m.id) it.copy(inDeck = true) else it }
                "Added to your review deck"
            } catch (e: Exception) {
                (e as? com.soyeb.ieltspractice.core.ApiError)?.message ?: "Couldn't add the card. Try again."
            }
        }
    }

    Box(Modifier.weight(1f)) {
        LazyColumn(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Text(
                    if (all > 0) "$all ${if (all == 1) "correction" else "corrections"} from your results, grouped so patterns stand out."
                    else "Every correction from your results, grouped so patterns stand out.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.ext.muted,
                )
            }
            if (groups.isNotEmpty()) item { CategoryChips(groups, all, category) { category = it } }
            paged.error?.let { msg ->
                item { AppCard { ErrorLine(msg); SecondaryButton("Try again", { paged.reset() }) } }
            }
            if (paged.items.isEmpty() && paged.error == null) {
                item {
                    if (paged.loading) Box(Modifier.fillMaxWidth().padding(24.dp), Alignment.Center) { CircularProgressIndicator() }
                    else EmptyState(
                        "Your error log is empty",
                        "Grammar slips, word choices and cohesion issues from your results collect here, so you can spot the ones that keep coming back.",
                        action = "Write an essay", onAction = { nav.go(WritingEditor("task2")) },
                    )
                }
            }
            attempts.forEach { (_, list) ->
                item(key = list.first().id) {
                    val m = list.first()
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Column(
                            Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button) { nav.go(AttemptResult.of(m.attemptId)) },
                            verticalArrangement = Arrangement.spacedBy(2.dp),
                        ) {
                            Text(m.promptTitle, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.ext.ink)
                            Text(
                                "${if (m.skill == "speaking") "Speaking Part" else "Writing Task"} ${m.part}, ${ShellDate.relative(m.createdAt)}",
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.ext.muted,
                            )
                        }
                        AppCard(padding = 0.dp) {
                            list.forEachIndexed { i, item ->
                                if (i > 0) RowDivider()
                                MistakeRow(item, showCategory = category == null, onAdd = { add(item) })
                            }
                        }
                    }
                }
            }
            item {
                if (paged.items.isNotEmpty() && paged.loading) Box(Modifier.fillMaxWidth().padding(16.dp), Alignment.Center) { CircularProgressIndicator() }
                LaunchedEffect(paged.items.size, paged.hasMore) { paged.more() }
            }
        }
        Toast(toast, Modifier.align(Alignment.BottomCenter))
    }
}

@Composable
private fun CategoryChips(groups: List<CategoryCount>, all: Int, selected: String?, onSelect: (String?) -> Unit) {
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).semantics { contentDescription = "Filter by category" },
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        FilterChip("All", all, selected == null) { onSelect(null) }
        groups.forEach { FilterChip(categoryLabel(it.category), it.count, selected == it.category) { onSelect(it.category) } }
    }
}

@Composable
private fun FilterChip(label: String, count: Int, on: Boolean, onClick: () -> Unit) {
    val e = MaterialTheme.ext
    Surface(
        Modifier.heightIn(min = 44.dp).semantics { contentDescription = "$label, $count" }.selectable(on, role = Role.RadioButton, onClick = onClick),
        shape = CircleShape, color = if (on) e.brand else e.surface,
        border = if (on) null else BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Row(Modifier.padding(horizontal = 14.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = MaterialTheme.typography.labelLarge, color = if (on) e.onBrand else e.ink)
            Text("$count", style = MaterialTheme.typography.labelLarge.merge(AppText.num), color = if (on) e.onBrand else e.muted)
        }
    }
}

/** original -> correction, explanation, time in the answer, "Add to deck". */
@Composable
private fun MistakeRow(m: Mistake, showCategory: Boolean, onAdd: () -> Unit) {
    val e = MaterialTheme.ext
    var expanded by remember { mutableStateOf(false) }
    // Nothing to diff: the explanation carries it.
    val same = m.original.trim() == m.correction.trim()
    // Off-topic spans quote whole answers: clamp them to two lines each until expanded.
    val long = !same && m.original.length + m.correction.length > 200
    val lines = if (long && !expanded) 2 else Int.MAX_VALUE
    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (showCategory || m.time != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (showCategory) Chip(categoryLabel(m.category))
                m.time?.let { Text("at ${clock(it.toInt())}", style = MaterialTheme.typography.bodySmall.merge(AppText.num), color = e.muted) }
            }
        }
        if (!same) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    buildAnnotatedString { withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { append(m.original) } },
                    style = AppText.readingSm, color = e.badText, maxLines = lines, overflow = TextOverflow.Ellipsis,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
                    Text("→", Modifier.semantics { contentDescription = "corrected to" }, style = AppText.readingSm, color = e.muted)
                    Text(m.correction, Modifier.weight(1f), style = AppText.readingSm, color = e.goodText, maxLines = lines, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        if (long) LinkButton(if (expanded) "Show less" else "Show more", { expanded = !expanded })
        Text(m.explanation, style = MaterialTheme.typography.bodyMedium, color = if (same) e.ink else e.muted)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            SecondaryButton(if (m.inDeck) "✓  In deck" else "+  Add to deck", onAdd, enabled = !m.inDeck)
        }
    }
}
