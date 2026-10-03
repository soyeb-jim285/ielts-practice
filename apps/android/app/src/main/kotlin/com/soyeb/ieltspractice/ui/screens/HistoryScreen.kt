package com.soyeb.ieltspractice.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.R
import com.soyeb.ieltspractice.core.fmt
import com.soyeb.ieltspractice.ui.ScreenScaffold
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.AttemptResult
import com.soyeb.ieltspractice.ui.nav.History
import com.soyeb.ieltspractice.ui.nav.LrHub
import com.soyeb.ieltspractice.ui.nav.LrResult
import com.soyeb.ieltspractice.ui.nav.LrRun
import com.soyeb.ieltspractice.core.LrAttemptItem
import com.soyeb.ieltspractice.ui.Load
import com.soyeb.ieltspractice.ui.rememberLoad
import com.soyeb.ieltspractice.ui.nav.SpeakingSession
import com.soyeb.ieltspractice.ui.nav.WritingEditor
import com.soyeb.ieltspractice.ui.screens.shell.EmptyState
import com.soyeb.ieltspractice.ui.screens.shell.GroupHeader
import com.soyeb.ieltspractice.ui.screens.shell.HistoryItem
import com.soyeb.ieltspractice.ui.screens.shell.HistoryPage
import com.soyeb.ieltspractice.ui.screens.shell.PageResult
import com.soyeb.ieltspractice.ui.screens.shell.Paged
import com.soyeb.ieltspractice.ui.screens.shell.RowDivider
import com.soyeb.ieltspractice.ui.screens.shell.Segmented
import com.soyeb.ieltspractice.ui.screens.shell.ShellDate
import com.soyeb.ieltspractice.ui.screens.shell.SignInGate
import com.soyeb.ieltspractice.ui.screens.shell.historyFlag
import com.soyeb.ieltspractice.ui.screens.shell.historyStatus
import com.soyeb.ieltspractice.ui.screens.shell.meta
import com.soyeb.ieltspractice.ui.screens.shell.runsBy
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.Chip
import com.soyeb.ieltspractice.ui.theme.ErrorLine
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.bandTextColor
import com.soyeb.ieltspractice.ui.theme.ext

// Mirrors: iOS Views/HistoryView.swift, web routes/_app/history.tsx

/** Every attempt, newest first, grouped by day bucket, 30 per page (GET /api/attempts). */
@Composable
fun HistoryScreen(route: History, nav: AppNav) {
    val api = LocalApp.current.api
    val account by api.hasAccount.collectAsState()
    ScreenScaffold("History", onBack = nav::back, scroll = false) {
        SignInGate(nav, "Create an account to see your history.", account, "Your history", R.drawable.ic_history) { HistoryList(route, nav) }
    }
}

@Composable
private fun androidx.compose.foundation.layout.ColumnScope.HistoryList(route: History, nav: AppNav) {
    val api = LocalApp.current.api
    val scope = rememberCoroutineScope()
    val me by api.me.collectAsState()
    val target = me?.settings?.targetBand ?: 7.0
    var skill by remember { mutableStateOf(route.skill.orEmpty()) } // "" = all
    // Listening & Reading attempts (cambridge accounts only) come from their own list and sit above the speaking and writing ones.
    val lrOn = me?.cambridgeAccess == true
    val isLr = skill == "listening" || skill == "reading"
    val lrLoad = rememberLoad(lrOn) { if (lrOn) api.getList<LrAttemptItem>("/api/lr/attempts") else emptyList() }
    val lr = ((lrLoad.state as? Load.Ready)?.value ?: emptyList()).filter { !isLr || it.skill == skill }
    val paged = remember {
        Paged(scope) { page ->
            if (skill == "listening" || skill == "reading") return@Paged PageResult(emptyList(), 0)
            val r = api.get<HistoryPage>("/api/attempts", mapOf("skill" to skill.ifEmpty { null }, "page" to page.toString()))
            PageResult(r.items, r.total)
        }
    }
    LaunchedEffect(skill) { paged.reset() }
    val groups = runsBy(paged.items) { ShellDate.bucket(it.createdAt) }
    val total = paged.total ?: 0

    LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            AppCard {
                Segmented(
                    listOf("" to "All", "speaking" to "Speaking", "writing" to "Writing") + if (lrOn) listOf("listening" to "Listening", "reading" to "Reading") else emptyList(),
                    skill, { skill = it },
                )
                Text(
                    if (total > 0) "$total ${if (total == 1) "attempt" else "attempts"}, newest first" else "Every answer you record and essay you submit.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.ext.muted,
                )
            }
        }
        paged.error?.let { msg ->
            item { AppCard { ErrorLine(msg); SecondaryButton("Try again", { paged.reset() }) } }
        }
        if (lrOn && lr.isNotEmpty()) item(key = "lr") {
            Column {
                GroupHeader("Listening and Reading")
                AppCard(padding = 0.dp) {
                    lr.take(if (isLr) lr.size else 5).forEachIndexed { i, a ->
                        if (i > 0) RowDivider()
                        LrHistoryRow(a, target) { nav.go(if (a.status == "submitted") LrResult(a.id) else LrRun(a.id)) }
                    }
                }
            }
        }
        if (isLr && lr.isEmpty() && lrLoad.state is Load.Ready) item {
            EmptyState("No $skill attempts yet", "Every $skill test you take is listed here with its band.", action = "Start a test", onAction = { nav.go(LrHub(skill)) })
        }
        if (!isLr && !(lrOn && lr.isNotEmpty()) && paged.items.isEmpty() && paged.error == null) {
            item {
                if (paged.loading) Box(Modifier.fillMaxWidth().padding(24.dp), Alignment.Center) { CircularProgressIndicator() }
                else EmptyState(
                    if (skill.isEmpty()) "Nothing practised yet" else "No $skill attempts yet",
                    "Each answer you record and essay you submit is listed here with its band, newest first, so you can see the trend.",
                    action = "Start practising",
                    onAction = { nav.go(if (skill == "writing") WritingEditor("task2") else SpeakingSession("full")) },
                )
            }
        }
        groups.forEach { (bucket, list) ->
            item(key = bucket + list.first().id) {
                Column {
                    GroupHeader(bucket)
                    AppCard(padding = 0.dp) {
                        list.forEachIndexed { i, a ->
                            if (i > 0) RowDivider()
                            HistoryRow(a, target) { nav.go(AttemptResult.of(a.id)) }
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
}

/** One Listening or Reading attempt: skill icon, title, mode and date (or "In progress"), then the band. */
@Composable
private fun LrHistoryRow(a: LrAttemptItem, target: Double, onClick: () -> Unit) {
    val e = MaterialTheme.ext
    val done = a.status == "submitted"
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top,
    ) {
        Icon(painterResource(if (a.skill == "listening") R.drawable.ic_sp_headphones else R.drawable.ic_lr_book), null, Modifier.padding(top = 2.dp).size(20.dp), tint = e.muted)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(a.title, style = MaterialTheme.typography.titleSmall, color = e.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (!done) Chip("In progress", color = e.warnText)
            Text(
                "${if (a.mode == "exam") "Exam" else "Practice"}, ${ShellDate.date(a.startedAt)}" + if (done) ", ${a.raw}/${a.total}" else "",
                style = MaterialTheme.typography.bodySmall, color = e.muted,
            )
        }
        val b = a.band
        if (done && b != null) Text(fmt(b), Modifier.clearAndSetSemantics { contentDescription = "Band ${fmt(b)}" }, style = AppText.band(20), color = bandTextColor(b, target))
    }
}

/** One attempt: skill icon, prompt, status or flag badge, part, date and duration, then the band. */
@Composable
private fun HistoryRow(a: HistoryItem, target: Double, onClick: () -> Unit) {
    val e = MaterialTheme.ext
    val status = historyStatus(a.status)
    val flag = historyFlag(a.flag)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top,
    ) {
        Icon(painterResource(if (a.skill == "speaking") R.drawable.ic_mic else R.drawable.ic_edit), null, Modifier.padding(top = 2.dp).size(20.dp), tint = e.muted)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(a.promptTitle, style = MaterialTheme.typography.titleSmall, color = e.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (status != null) {
                Chip(status.first, color = when (status.second) { "warn" -> e.warnText; "bad" -> e.badText; else -> e.brand })
            } else if (flag != null) {
                Chip(flag, color = e.warnText)
            }
            Text(a.meta(), style = MaterialTheme.typography.bodySmall, color = e.muted)
        }
        val o = a.overall
        if (status == null && o != null) {
            if (o == 0.0) Text("No speech", style = MaterialTheme.typography.bodySmall, color = e.muted)
            else Text(
                fmt(o), Modifier.clearAndSetSemantics { contentDescription = "Band ${fmt(o)}" },
                style = AppText.band(20), color = bandTextColor(o, target),
            )
        }
    }
}
