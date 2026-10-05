package com.soyeb.ieltspractice.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.R
import com.soyeb.ieltspractice.core.ApiClient
import com.soyeb.ieltspractice.core.ApiError
import com.soyeb.ieltspractice.core.Band
import com.soyeb.ieltspractice.core.Mock
import com.soyeb.ieltspractice.core.MockFlow
import com.soyeb.ieltspractice.core.MockSection
import com.soyeb.ieltspractice.core.MockTone
import com.soyeb.ieltspractice.core.mockAbandon
import com.soyeb.ieltspractice.core.mockChoose
import com.soyeb.ieltspractice.core.mockClose
import com.soyeb.ieltspractice.core.mockGet
import com.soyeb.ieltspractice.core.mockStartSection
import com.soyeb.ieltspractice.ui.ScreenScaffold
import com.soyeb.ieltspractice.ui.community.QuotaCaption
import com.soyeb.ieltspractice.ui.community.rememberQuota
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.AttemptResult
import com.soyeb.ieltspractice.ui.nav.LrResult
import com.soyeb.ieltspractice.ui.nav.LrRun
import com.soyeb.ieltspractice.ui.nav.MockHub
import com.soyeb.ieltspractice.ui.nav.MockLive
import com.soyeb.ieltspractice.ui.nav.SpeakingSession
import com.soyeb.ieltspractice.ui.nav.Tab
import com.soyeb.ieltspractice.ui.nav.WritingEditor
import com.soyeb.ieltspractice.ui.screens.shell.HistoryPage
import com.soyeb.ieltspractice.ui.screens.shell.HistoryItem
import com.soyeb.ieltspractice.ui.screens.speaking.ConfirmDialog
import com.soyeb.ieltspractice.ui.screens.speaking.RowDivider
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.CardShape
import com.soyeb.ieltspractice.ui.theme.Chip
import com.soyeb.ieltspractice.ui.theme.ChipRow
import com.soyeb.ieltspractice.ui.theme.ErrorLine
import com.soyeb.ieltspractice.ui.theme.PrimaryButton
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.bandTextColor
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// Mirrors: web routes/_app/mock/$id.tsx, components/mock/{Transition,SpeakingChoice,MockResult,SectionList}.tsx (docs/mock-exam.md).
// One screen for the whole run: the transition between sections, the Speaking choice, and (once nothing is left to take) the result.
// Sections open the existing runners; each returns here when it ends, and this screen loads the mock again.

/** All attempt ids of a writing or speaking session in the order they were taken (the history list is the only place the app can find them); falls back to the section's first attempt. */
fun sessionAttemptIds(items: List<HistoryItem>, sessionId: String?, fallback: String): List<String> {
    val ids = if (sessionId == null) emptyList() else items.filter { it.sessionId == sessionId }.sortedBy { it.createdAt }.map { it.id }
    return ids.ifEmpty { listOf(fallback) }
}

@Composable
fun MockHubScreen(route: MockHub, nav: AppNav) {
    val api = LocalApp.current.api
    val me by api.me.collectAsState()
    val target = me?.settings?.targetBand ?: 7.0
    val scope = rememberCoroutineScope()
    var mock by remember { mutableStateOf<Mock?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf<String?>(null) } // "close" | "abandon"

    suspend fun load() {
        try {
            mock = api.mockGet(route.id)
            failure = null
        } catch (x: CancellationException) {
            throw x
        } catch (x: Exception) {
            if (mock == null) failure = (x as? ApiError)?.message ?: x.message ?: "Something went wrong."
        }
    }
    LaunchedEffect(route.id, attempt) { load() }
    // Marking runs in the background: keep looking while any section is still being marked.
    val marking = mock?.marking == true
    LaunchedEffect(marking) { while (marking) { delay(5000); load() } }

    val m = mock
    ScreenScaffold(if (m == null || m.open) "Full mock test" else "Mock result", onBack = nav::back) {
        when {
            m != null -> HubBody(m, target, busy, error, nav, scope,
                act = { block ->
                    busy = true
                    error = null
                    scope.launch {
                        try { block() } catch (x: CancellationException) { throw x } catch (x: Exception) {
                            error = (x as? ApiError)?.message ?: x.message ?: "Something went wrong."
                        } finally { busy = false }
                    }
                },
                onConfirm = { confirm = it })
            failure != null -> {
                ErrorLine(failure.orEmpty())
                SecondaryButton("Try again", { attempt++ })
                SecondaryButton("Back", nav::back)
            }
            else -> Box(Modifier.fillMaxWidth().padding(24.dp), Alignment.Center) { CircularProgressIndicator() }
        }
    }

    if (confirm == "close") {
        ConfirmDialog(
            "Finish without Speaking?", "The mock closes with Speaking skipped and no overall band. Your other sections stay in your history.", "Finish",
            onConfirm = { scope.launch { try { mock = api.mockClose(route.id) } catch (x: CancellationException) { throw x } catch (x: Exception) { error = (x as? ApiError)?.message ?: x.message } } },
            onDismiss = { confirm = null }, dismissLabel = "Keep going",
        )
    }
    if (confirm == "abandon") {
        ConfirmDialog(
            "Abandon this mock test?", "The mock is removed. Sections you already took stay in your history as normal practice.", "Abandon",
            onConfirm = { scope.launch { try { api.mockAbandon(route.id); nav.back() } catch (x: CancellationException) { throw x } catch (x: Exception) { error = (x as? ApiError)?.message ?: x.message } } },
            onDismiss = { confirm = null }, dismissLabel = "Keep it", destructive = true,
        )
    }
}

@Composable
private fun HubBody(
    m: Mock, target: Double, busy: Boolean, error: String?, nav: AppNav, scope: kotlinx.coroutines.CoroutineScope,
    act: (suspend () -> Unit) -> Unit, onConfirm: (String) -> Unit,
) {
    val e = MaterialTheme.ext
    val api = LocalApp.current.api
    val next = m.next
    ChipRow(listOfNotNull(if (m.variant == "academic") "Academic" else "General Training", m.ref, if (m.status == "closed") "Finished without Speaking" else null))

    if (m.open && next != null) {
        if (next == "speaking") {
            SpeakingChoice(m, error, busy, nav, act)
        } else {
            val copy = MockFlow.transition(next)
            val resuming = m.section(next)?.state == "in_progress"
            AppCard {
                Text("Full mock test", style = MaterialTheme.typography.labelLarge, color = e.brand)
                Text(copy?.first.orEmpty(), style = MaterialTheme.typography.titleLarge, color = e.ink)
                Text(
                    if (resuming) "${MockFlow.name(next)} is already under way. You resume with the time you have used." else copy?.second.orEmpty(),
                    style = MaterialTheme.typography.bodyMedium, color = e.muted,
                )
                error?.let { ErrorLine(it) }
                PrimaryButton("${if (resuming) "Continue" else "Start"} ${MockFlow.name(next)}", {
                    act {
                        when (next) {
                            "listening", "reading" -> nav.go(LrRun(api.mockStartSection(m.id, next), m.id))
                            else -> nav.go(WritingEditor(mode = "mock", mockId = m.id))
                        }
                    }
                }, Modifier.fillMaxWidth(), loading = busy)
            }
        }
    }
    if (!m.open || next == null) Overall(m, target)

    Column {
        com.soyeb.ieltspractice.ui.screens.shell.GroupHeader("Your sections")
        Surface(Modifier.fillMaxWidth(), shape = CardShape, color = e.surface, border = BorderStroke(1.dp, e.line)) {
            Column {
                m.sections.forEachIndexed { i, s ->
                    if (i > 0) RowDivider()
                    SectionRow(s, target) { openResult(s, api, nav, scope) }
                }
            }
        }
        if (m.marking) Text("Marking runs in the background. This page updates by itself.", Modifier.padding(top = 8.dp), style = MaterialTheme.typography.bodySmall, color = e.muted)
    }

    if (m.open) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (next == "speaking") TextButton({ onConfirm("close") }, Modifier.heightIn(min = 48.dp)) { Text("Finish without Speaking", color = e.brand) }
            TextButton({ onConfirm("abandon") }, Modifier.heightIn(min = 48.dp)) { Text("Abandon this mock test", color = e.muted) }
        }
    }
}

/** The normal result page of a finished section: Listening and Reading by attempt, Writing and Speaking with every attempt of their session. */
private fun openResult(s: MockSection, api: ApiClient, nav: AppNav, scope: kotlinx.coroutines.CoroutineScope) {
    val id = s.attemptId ?: return
    if (!MockFlow.isFinished(s.state)) return
    if (s.skill == "listening" || s.skill == "reading") { nav.go(LrResult(id)); return }
    // Needs the history list to find the rest of the session; a failure still opens the first attempt.
    scope.launch {
        val items = runCatching { api.get<HistoryPage>("/api/attempts", mapOf("skill" to s.skill, "page" to "1")).items }.getOrDefault(emptyList())
        nav.go(AttemptResult.of(*sessionAttemptIds(items, s.sessionId, id).toTypedArray()))
    }
}

@Composable
private fun SectionRow(s: MockSection, target: Double, onOpen: () -> Unit) {
    val e = MaterialTheme.ext
    val linked = s.attemptId != null && MockFlow.isFinished(s.state)
    val (text, tone) = MockFlow.stateLabel(s.skill, s.state)
    val color = when (tone) { MockTone.Good -> e.goodText; MockTone.Bad -> e.badText; MockTone.Warn -> e.warnText; MockTone.Accent -> e.brand; MockTone.Neutral -> e.muted }
    val icon = when (s.skill) { "listening" -> R.drawable.ic_sp_headphones; "reading" -> R.drawable.ic_lr_book; "writing" -> R.drawable.ic_edit; else -> R.drawable.ic_mic }
    val band = s.band
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp)
            .then(if (linked) Modifier.clickable(role = Role.Button, onClick = onOpen) else Modifier)
            .semantics(mergeDescendants = true) { contentDescription = "${MockFlow.name(s.skill)}, $text" + (band?.let { ", band ${Band.format(it)}" } ?: "") }
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(painterResource(icon), contentDescription = null, Modifier.size(20.dp), tint = e.muted)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(MockFlow.name(s.skill), style = MaterialTheme.typography.titleSmall, color = e.ink)
            MockFlow.meta(s)?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = e.muted) }
            Chip(text, color = color)
        }
        Text(
            band?.let { Band.format(it) } ?: "-", Modifier.width(40.dp).clearAndSetSemantics { },
            style = AppText.band(20), color = if (band != null) bandTextColor(band, target) else e.muted, textAlign = androidx.compose.ui.text.style.TextAlign.End,
        )
        if (linked) Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, Modifier.size(20.dp), tint = e.muted)
    }
}

@Composable
private fun Overall(m: Mock, target: Double) {
    val e = MaterialTheme.ext
    val o = m.overall
    AppCard {
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Overall band", style = MaterialTheme.typography.labelLarge, color = e.brand)
                Text(MockFlow.overallNote(m, target), style = MaterialTheme.typography.bodyMedium, color = e.muted)
            }
            Text(
                o?.let { Band.format(it) } ?: "-",
                Modifier.semantics { contentDescription = if (o != null) "Overall band ${Band.format(o)}" else "No overall band yet" },
                style = AppText.band(56), color = if (o != null) bandTextColor(o, target) else e.muted,
            )
        }
    }
}

/** The last step: how to do Speaking. Recorded and live are the existing speaking runners; "later" leaves the mock open. */
@Composable
private fun SpeakingChoice(m: Mock, error: String?, busy: Boolean, nav: AppNav, act: (suspend () -> Unit) -> Unit) {
    val e = MaterialTheme.ext
    val api = LocalApp.current.api
    val quota = rememberQuota()
    val live = (quota?.liveProviders ?: api.liveProviders).isNotEmpty()
    AppCard {
        Text("Last section", style = MaterialTheme.typography.labelLarge, color = e.brand)
        Text("Writing finished. Choose how to do Speaking.", style = MaterialTheme.typography.titleLarge, color = e.ink)
        Text("Speaking has no countdown, so you can take it now or later this week. Your overall band appears once it is marked.", style = MaterialTheme.typography.bodyMedium, color = e.muted)
        error?.let { ErrorLine(it) }
    }
    AppCard {
        Text("Recorded test", style = MaterialTheme.typography.titleMedium, color = e.ink)
        Text("11 to 14 min, recorded. The examiner reads the questions. You record each answer at your own pace.", style = MaterialTheme.typography.bodyMedium, color = e.muted)
        PrimaryButton("Start recorded test", {
            nav.startTest("speaking") {
                act {
                    try { api.mockChoose(m.id, "recorded") } catch (x: ApiError) { if (nav.reportBlocked(x, "speaking")) return@act else throw x }
                    nav.go(SpeakingSession(mode = "mock", mockId = m.id))
                }
            }
        }, Modifier.fillMaxWidth(), loading = busy)
        QuotaCaption("speaking")
    }
    AppCard {
        Text("Live examiner", style = MaterialTheme.typography.titleMedium, color = if (live) e.ink else e.muted)
        Text("11 to 14 min, spoken. An AI examiner asks the questions aloud and follows up on what you say.", style = MaterialTheme.typography.bodyMedium, color = e.muted)
        if (live) {
            SecondaryButton("Start live examiner", {
                nav.startLive {
                    act {
                        try { api.mockChoose(m.id, "live") } catch (x: ApiError) { if (nav.reportBlocked(x, "speaking")) return@act else throw x }
                        nav.go(MockLive(m.id))
                    }
                }
            }, Modifier.fillMaxWidth(), enabled = !busy)
        } else {
            Text("Needs your own OpenAI or Gemini key.", style = MaterialTheme.typography.bodySmall, color = e.muted)
            SecondaryButton("Add your own key", { nav.openTab(Tab.Settings) }, Modifier.fillMaxWidth())
        }
    }
    AppCard {
        Text("Do it later", style = MaterialTheme.typography.titleMedium, color = e.ink)
        Text("Within 7 days. Your mock stays open. Come back from Home when you are ready.", style = MaterialTheme.typography.bodyMedium, color = e.muted)
        SecondaryButton("Back to Home", { nav.openTab(Tab.Home) }, Modifier.fillMaxWidth())
    }
}
