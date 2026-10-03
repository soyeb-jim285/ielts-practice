package com.soyeb.ieltspractice.ui.screens.lr

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.LocalDemo
import com.soyeb.ieltspractice.R
import com.soyeb.ieltspractice.core.ApiError
import com.soyeb.ieltspractice.core.LrAttempt
import com.soyeb.ieltspractice.core.LrTestItem
import com.soyeb.ieltspractice.core.fmt
import com.soyeb.ieltspractice.core.lrHubGroups
import com.soyeb.ieltspractice.core.parseRef
import com.soyeb.ieltspractice.ui.Load
import com.soyeb.ieltspractice.ui.ScreenScaffold
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.LrHub
import com.soyeb.ieltspractice.ui.nav.LrRun
import com.soyeb.ieltspractice.ui.rememberLoad
import com.soyeb.ieltspractice.ui.screens.shell.BandBar
import com.soyeb.ieltspractice.ui.screens.shell.EmptyState
import com.soyeb.ieltspractice.ui.screens.shell.GroupHeader
import com.soyeb.ieltspractice.ui.screens.shell.RowDivider
import com.soyeb.ieltspractice.ui.screens.shell.Segmented
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.Chip
import com.soyeb.ieltspractice.ui.theme.ErrorLine
import com.soyeb.ieltspractice.ui.theme.PrimaryButton
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.bandTextColor
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// Mirrors: web components/lr/Hub.tsx, routes/_app/listening and reading

private fun lede(listening: Boolean) =
    if (listening) "Four recordings, 40 questions. Take it like the real computer-delivered test, or practise with replay and slow-down."
    else "Three passages, 40 questions, 60 minutes. Flag what to revisit and check your pace."

/** Listening or Reading hub: tests grouped by Cambridge book, then our own, with status and best band. Cambridge books show only for allow-listed accounts (the server filters). */
@Composable
fun LrHubScreen(route: LrHub, nav: AppNav) {
    val api = LocalApp.current.api
    val me by api.me.collectAsState()
    val listening = route.skill == "listening"
    ScreenScaffold(if (listening) "Listening" else "Reading", onBack = nav::back) {
        val m = me
        when {
            m == null -> Box(Modifier.fillMaxWidth().padding(24.dp), Alignment.Center) { CircularProgressIndicator() }
            else -> HubContent(route.skill, m.settings.targetBand, nav)
        }
    }
}

@Composable
private fun HubContent(skill: String, target: Double, nav: AppNav) {
    val api = LocalApp.current.api
    val demo = LocalDemo.current
    val listening = skill == "listening"
    val load = rememberLoad(skill) { api.getList<LrTestItem>("/api/lr/tests", mapOf("skill" to skill)) }
    var variant by remember { mutableStateOf("all") }
    var pick by remember { mutableStateOf<LrTestItem?>(null) }
    val state = load.state
    LaunchedEffect(state) { if (demo?.screen == "lr-mode" && state is Load.Ready) pick = state.value.firstOrNull { it.attemptId == null } }

    Text(lede(listening), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.ext.muted)
    when (state) {
        Load.Loading -> Box(Modifier.fillMaxWidth().padding(24.dp), Alignment.Center) { CircularProgressIndicator() }
        is Load.Failed -> AppCard { ErrorLine(state.message); SecondaryButton("Try again", load.reload) }
        is Load.Ready -> {
            val all = state.value
            if (all.isEmpty()) EmptyState("No ${skill} tests yet", "Tests appear here once they are imported.")
            else {
                if (all.map { it.variant }.toSet().size > 1) Segmented(listOf("all" to "All", "academic" to "Academic", "general" to "General Training"), variant, { variant = it })
                val items = all.filter { variant == "all" || it.variant == variant }
                lrHubGroups(items).forEach { g ->
                    Column(Modifier.fillMaxWidth()) {
                        GroupHeader(g.heading)
                        AppCard(padding = 0.dp) {
                            g.tests.forEachIndexed { i, t ->
                                if (i > 0) RowDivider()
                                TestRow(t, listening, target) { if (t.attemptId != null) nav.go(LrRun(t.attemptId)) else pick = t }
                            }
                        }
                    }
                }
            }
        }
    }
    pick?.let { t -> ModeSheet(t, nav, onClose = { pick = null }) }
}

@Composable
private fun TestRow(t: LrTestItem, listening: Boolean, target: Double, onClick: () -> Unit) {
    val e = MaterialTheme.ext
    val r = if (t.source == "cambridge") parseRef(t.ref) else null
    val name = r?.let { "Test ${it.second}" } ?: t.title
    val sub = when {
        t.attemptId != null -> "Resume in ${t.mode} mode"
        t.status == "submitted" -> "Retake or review"
        else -> "${t.total} questions"
    }
    val statusText = when {
        t.status == "in_progress" -> "In progress, ${t.answered} of ${t.total} answered"
        t.status == "submitted" && t.bestBand != null -> "Best band ${fmt(t.bestBand)}, ${t.attempts} ${if (t.attempts == 1) "attempt" else "attempts"}"
        else -> "Not started"
    }
    Row(
        Modifier.fillMaxWidth().heightIn(min = 64.dp).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp)
            .semantics(mergeDescendants = true) { contentDescription = "$name, ${if (t.variant == "academic") "Academic" else "General Training"}, $sub, $statusText" },
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(painterResource(if (listening) R.drawable.ic_sp_headphones else R.drawable.ic_lr_book), null, Modifier.size(22.dp), tint = e.muted)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(name, style = MaterialTheme.typography.titleSmall, color = e.ink)
            if (!listening) Chip(if (t.variant == "academic") "Academic" else "General Training", color = if (t.variant == "academic") e.muted else e.brand)
            Text(sub, style = MaterialTheme.typography.bodySmall, color = e.muted)
        }
        Column(Modifier.widthIn(min = 72.dp, max = 124.dp).clearAndSetSemantics {}, horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            when {
                t.status == "in_progress" -> {
                    Text("In progress, ${t.answered}/${t.total}", style = MaterialTheme.typography.labelMedium.merge(AppText.num), color = e.brand, textAlign = TextAlign.End)
                    BandBar(t.answered.toDouble() / t.total.coerceAtLeast(1), "${t.answered} of ${t.total} answered", height = 6.dp)
                }
                t.status == "submitted" && t.bestBand != null -> {
                    Text(fmt(t.bestBand), style = AppText.band(20), color = bandTextColor(t.bestBand, target))
                    Text("${t.attempts} ${if (t.attempts == 1) "attempt" else "attempts"}", style = MaterialTheme.typography.bodySmall, color = e.muted)
                }
                else -> Text("Not started", style = MaterialTheme.typography.bodySmall, color = e.muted)
            }
        }
    }
}

private class ModeInfo(val key: String, val label: String, val reading: String, val listening: String)

private val modes = listOf(
    ModeInfo("exam", "Exam", "60-minute countdown. Submits itself when time is up.", "The recording plays once, with no pause or rewind. Then 2 minutes to check, and it submits itself."),
    ModeInfo("practice", "Practice", "No time limit. A clock counts up so you can see your pace.", "Pause, rewind, slow down to 0.75× and replay any part. No time limit."),
)

/** Exam or Practice: a bottom sheet with the two modes and a Start button. */
@Composable
private fun ModeSheet(t: LrTestItem, nav: AppNav, onClose: () -> Unit) {
    val e = MaterialTheme.ext
    val api = LocalApp.current.api
    val scope = rememberCoroutineScope()
    var mode by remember { mutableStateOf("exam") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    fun start() {
        busy = true; error = null
        scope.launch {
            try {
                val a = api.send<LrAttempt>("POST", "/api/lr/tests/${t.id}/attempts", buildJsonObject { put("mode", mode) })
                onClose()
                nav.go(LrRun(a.id))
            } catch (ex: ApiError) {
                error = if (ex.code == "cambridge_required") "Listening and Reading are not enabled for this account." else "Could not start the test. Try again."
                busy = false
            } catch (ex: Exception) {
                error = "Could not start the test. Try again."
                busy = false
            }
        }
    }
    LrSheet(onClose) {
        Text(t.title, Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineSmall, color = e.ink)
        Text("Choose how to take this test.", style = MaterialTheme.typography.bodyMedium, color = e.muted)
        modes.forEach { m ->
            val on = mode == m.key
            Row(
                Modifier.fillMaxWidth().heightIn(min = 64.dp).background(if (on) e.brandSoft else e.surface, RoundedCornerShape(12.dp))
                    .border(if (on) 2.dp else 1.dp, if (on) e.brand else MaterialTheme.colorScheme.outline.copy(alpha = 0.5f), RoundedCornerShape(12.dp))
                    .selectable(on, role = Role.RadioButton) { mode = m.key }.padding(14.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top,
            ) {
                Box(Modifier.padding(top = 2.dp).size(20.dp).border(2.dp, if (on) e.brand else e.muted, CircleShape), contentAlignment = Alignment.Center) {
                    if (on) Box(Modifier.size(10.dp).background(e.brand, CircleShape))
                }
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(m.label, style = MaterialTheme.typography.titleSmall, color = e.ink)
                    Text(if (t.skill == "reading") m.reading else m.listening, style = MaterialTheme.typography.bodySmall, color = e.muted)
                }
            }
        }
        error?.let { ErrorLine(it) }
        PrimaryButton("Start ${mode} test", ::start, Modifier.fillMaxWidth(), loading = busy)
        SecondaryButton("Cancel", onClose, Modifier.fillMaxWidth())
    }
}
