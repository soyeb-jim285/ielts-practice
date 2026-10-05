package com.soyeb.ieltspractice.ui.screens

import com.soyeb.ieltspractice.ui.mock.MockCta
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.AppContainer
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.ui.screens.shell.GuestRecentSection
import com.soyeb.ieltspractice.ui.screens.shell.Segmented
import com.soyeb.ieltspractice.LocalDemo
import com.soyeb.ieltspractice.R
import com.soyeb.ieltspractice.core.AttemptListItem
import com.soyeb.ieltspractice.core.AttemptPage
import com.soyeb.ieltspractice.core.Band
import com.soyeb.ieltspractice.core.PendingRecording
import com.soyeb.ieltspractice.core.UploadState
import com.soyeb.ieltspractice.ui.Load
import com.soyeb.ieltspractice.ui.ScreenScaffold
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.AttemptResult
import com.soyeb.ieltspractice.ui.nav.Bank
import com.soyeb.ieltspractice.ui.nav.History
import com.soyeb.ieltspractice.ui.nav.LiveExam
import com.soyeb.ieltspractice.ui.nav.SpeakingSession
import com.soyeb.ieltspractice.ui.community.LiveCaption
import com.soyeb.ieltspractice.ui.community.QuotaCaption
import com.soyeb.ieltspractice.ui.rememberLoad
import com.soyeb.ieltspractice.ui.screens.speaking.ConfirmDialog
import com.soyeb.ieltspractice.ui.screens.speaking.ListCard
import com.soyeb.ieltspractice.ui.screens.speaking.RowDivider
import com.soyeb.ieltspractice.ui.screens.speaking.isoMillis
import com.soyeb.ieltspractice.ui.screens.speaking.relativeTime
import com.soyeb.ieltspractice.ui.screens.speaking.sentenceCase
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.CardShape
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.SectionTitle
import com.soyeb.ieltspractice.ui.theme.bandTextColor
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

// Mirrors: iOS Views/SpeakingHomeView.swift, web routes/_app/speaking/index.tsx
// Speaking hub: unsent recordings, the two ways to practise, single parts, recent results. Guests see it too and can start a test: no account needed (one free test a week).

private class PartInfo(val n: Int, val title: String, val desc: String, val time: String)

private val parts = listOf(
    PartInfo(1, "Interview", "Everyday questions about you, your home, work or studies.", "4-5 min"),
    PartInfo(2, "Long turn", "A cue card, one minute to prepare with notes, then up to two minutes of talking.", "3-4 min"),
    PartInfo(3, "Discussion", "Abstract follow-up questions. Develop each idea with reasons and examples.", "4-5 min"),
)

@Composable
fun SpeakingHomeScreen(nav: AppNav) {
    val app = LocalApp.current
    val api = app.api
    val demo = LocalDemo.current
    val store = app.pending
    val pending by store.items.collectAsState()
    val states by store.states.collectAsState()
    val me by api.me.collectAsState()
    val account by api.hasAccount.collectAsState()
    val target = me?.settings?.targetBand ?: 7.0
    // Guests have no history (it is account-only). The list reloads when the account changes.
    val recent = rememberLoad(account) {
        if (!account) emptyList<AttemptListItem>() else api.get<AttemptPage>("/api/attempts", mapOf("skill" to "speaking", "page" to "1")).items
    }
    val fresh = (recent.state as? Load.Ready)?.value?.isEmpty() == true
    var deleting by remember { mutableStateOf<PendingRecording?>(null) }
    val started = remember { mutableStateListOf<String>() } // uploads begun from this screen: open the result when one finishes
    val scope = rememberCoroutineScope()
    val scroll = rememberScrollState()

    LaunchedEffect(Unit) {
        if (demo == null) store.reload()
        else if (demo.tab == "Pending") {
            val now = System.currentTimeMillis()
            store.add(PendingRecording("demo-p1", "sp1", 1, "Part 1: Hometown", now - 25 * 60_000, 62_000, emptyList(), listOf(0)))
            store.add(PendingRecording("demo-p2", "sp2", 2, "Part 2: Describe a book that changed the way you think", now - 3 * 3_600_000, 118_000, emptyList(), listOf(0)))
        }
    }
    LaunchedEffect(states) {
        val id = started.firstNotNullOfOrNull { (states[it] as? UploadState.Done)?.attemptId }
        if (id != null) { started.clear(); nav.go(AttemptResult.of(id)) }
    }
    LaunchedEffect(demo?.tab, recent.state) {
        if (demo?.tab == "Scrolled" && recent.state is Load.Ready) { snapshotFlow { scroll.maxValue }.first { it > 0 }; scroll.scrollTo(scroll.maxValue) }
    }

    ScreenScaffold("Speaking", large = true, scroll = false) {
        Column(Modifier.weight(1f).verticalScroll(scroll), verticalArrangement = Arrangement.spacedBy(24.dp)) {
            Text(
                "Record your answers and get a band for each criterion, with every mistake and pause located in your transcript.",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.ext.muted,
            )
            if (me?.cambridgeAccess == true) SourcePicker(app)
            GuestRecentSection(nav, "speaking")
            MockCta(nav)
            if (fresh) PartsSection(true, nav)
            if (pending.isNotEmpty()) PendingSection(pending, states, onUpload = { p -> started.add(p.id); store.start(p, api) }, onDelete = { deleting = it })
            ModesSection(nav)
            if (!fresh) PartsSection(false, nav)
            RecentSection(recent.state, target, nav, retry = recent.reload)
            BankLink { nav.go(Bank("speaking")) }
        }
    }

    deleting?.let { p ->
        ConfirmDialog(
            "Delete this recording?", "The recording is removed from this device and can't be uploaded afterwards.", "Delete",
            onConfirm = { scope.launch { store.discard(p, api) } }, onDismiss = { deleting = null }, destructive = true,
        )
    }
}

// MARK: Question source

/** Cambridge-allowlisted accounts only: which bank the full test, single parts and the live examiner draw from (web: QuestionSourcePicker). */
@Composable
private fun SourcePicker(app: AppContainer) {
    val e = MaterialTheme.ext
    var source by remember { mutableStateOf(app.speakingSource) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Questions", style = MaterialTheme.typography.bodySmall, color = e.muted)
        Segmented(listOf("any" to "Mixed", "cambridge" to "Cambridge books", "generated" to "Our own"), source, { source = it; app.speakingSource = it })
        if (source == "cambridge") {
            Text(
                "Cambridge questions have no recorded examiner voice, so the practice test shows them on screen. The live examiner still asks them aloud.",
                style = MaterialTheme.typography.bodySmall, color = e.muted,
            )
        }
    }
}

// MARK: Pending uploads

/** Recordings that never finished uploading (kept on this device). */
@Composable
private fun PendingSection(
    items: List<PendingRecording>, states: Map<String, UploadState>, onUpload: (PendingRecording) -> Unit, onDelete: (PendingRecording) -> Unit,
) {
    val e = MaterialTheme.ext
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Surface(Modifier.fillMaxWidth(), shape = CardShape, color = e.surface, border = BorderStroke(1.dp, e.line)) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Warning, contentDescription = null, Modifier.size(20.dp), tint = e.warn)
                    Text(
                        if (items.size == 1) "A recording was not uploaded" else "${items.size} recordings were not uploaded",
                        style = MaterialTheme.typography.titleMedium, color = e.warnText,
                    )
                }
                Text("They are still saved on this device. Upload them to get your band, or delete them.", style = MaterialTheme.typography.bodyMedium, color = e.muted)
            }
        }
        ListCard {
            items.forEachIndexed { i, p ->
                if (i > 0) RowDivider()
                val state = states[p.id]
                val uploading = state == UploadState.Uploading
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(p.label, style = MaterialTheme.typography.titleSmall, color = e.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text("Recorded ${relativeTime(p.createdAt)}", style = MaterialTheme.typography.bodySmall, color = e.muted)
                        if (state is UploadState.Failed) Text(state.message, style = MaterialTheme.typography.bodySmall, color = e.badText)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        SecondaryButton(if (uploading) "Uploading..." else "Upload now", { onUpload(p) }, enabled = !uploading)
                        TextButton({ onDelete(p) }, enabled = !uploading, modifier = Modifier.heightIn(min = 48.dp)) { Text("Delete", color = e.badText) }
                    }
                }
            }
        }
    }
}

// MARK: Modes

@Composable
private fun ModesSection(nav: AppNav) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        ModeCard(
            R.drawable.ic_sp_numbered, "Practice test, at your own pace", "Full practice test",
            "All three parts in order, like test day. You read each question, record your answer, and every part is scored plus an overall band.",
            "11-14 min, recorded", "Start full test", live = false, caption = { QuotaCaption("speaking") },
        ) { nav.startTest("speaking") { nav.go(SpeakingSession("full")) } }
        ModeCard(
            R.drawable.ic_sp_waveform, "Live, spoken conversation", "Live examiner",
            "An AI examiner asks the questions aloud, listens, and follows up on what you say, like the real interview. The whole test is scored at the end.",
            "11-14 min, needs a microphone", "Talk to the examiner", live = true, caption = { LiveCaption() },
        ) { nav.startLive { nav.go(LiveExam) } }
    }
}

/** Static card; the button is the only interactive part. The live examiner sits on a soft teal wash, the self-paced test on the plain surface. */
@Composable
private fun ModeCard(icon: Int, kind: String, title: String, text: String, meta: String, cta: String, live: Boolean, caption: @Composable () -> Unit, onClick: () -> Unit) {
    val e = MaterialTheme.ext
    Surface(
        Modifier.fillMaxWidth(), shape = CardShape, color = e.surface,
        border = BorderStroke(1.dp, if (live) e.brand.copy(alpha = 0.25f) else e.line),
    ) {
        Column(
            Modifier.background(if (live) e.brandSoft.copy(alpha = 0.7f) else Color.Transparent).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(painterResource(icon), contentDescription = null, Modifier.size(16.dp), tint = if (live) e.brand else e.ink)
                    Text(kind, style = MaterialTheme.typography.labelMedium, color = e.muted)
                }
                Text(title, style = MaterialTheme.typography.headlineSmall, color = e.ink)
                Text(text, style = MaterialTheme.typography.bodyMedium, color = e.muted)
            }
            HorizontalDivider(color = if (live) e.brand.copy(alpha = 0.2f) else e.line)
            Text(meta, style = MaterialTheme.typography.labelMedium.merge(AppText.num), color = e.muted)
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SecondaryButton(cta, onClick, Modifier.fillMaxWidth())
                caption()
            }
        }
    }
}

// MARK: Parts

@Composable
private fun PartsSection(fresh: Boolean, nav: AppNav) {
    val e = MaterialTheme.ext
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionTitle(if (fresh) "Start with one part" else "Or practise one part")
        ListCard {
            parts.forEachIndexed { i, p ->
                if (i > 0) RowDivider()
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 76.dp)
                        .clickable(role = Role.Button) { nav.startTest("speaking") { nav.go(SpeakingSession("part", p.n)) } }.padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("${p.n}", Modifier.width(28.dp), style = MaterialTheme.typography.headlineSmall, color = e.muted)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("Part ${p.n}: ${p.title}", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, color = e.ink)
                            Text(p.time, Modifier.padding(top = 2.dp), style = MaterialTheme.typography.labelMedium.merge(AppText.num), color = e.muted)
                        }
                        Text(p.desc, style = MaterialTheme.typography.bodyMedium, color = e.muted)
                    }
                    Icon(Icons.Filled.KeyboardArrowRight, contentDescription = null, tint = e.muted)
                }
            }
        }
    }
}

// MARK: Recent results

/** Last few speaking results. Hidden once loaded with none. */
@Composable
private fun RecentSection(state: Load<List<AttemptListItem>>, target: Double, nav: AppNav, retry: () -> Unit) {
    val e = MaterialTheme.ext
    when (state) {
        is Load.Ready -> if (state.value.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    SectionTitle("Recent results", Modifier.weight(1f))
                    TextButton({ nav.go(History("speaking")) }, modifier = Modifier.heightIn(min = 48.dp)) { Text("View all", color = e.brand) }
                }
                ListCard {
                    state.value.take(5).forEachIndexed { i, a ->
                        if (i > 0) RowDivider()
                        AttemptRow(a, target) { nav.go(AttemptResult.of(a.id)) }
                    }
                }
            }
        }
        else -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SectionTitle("Recent results")
            if (state is Load.Failed) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Couldn't load your results.", style = MaterialTheme.typography.bodyMedium, color = e.muted)
                    TextButton(retry, modifier = Modifier.heightIn(min = 48.dp)) { Text("Try again", color = e.brand) }
                }
            } else {
                Row(Modifier.fillMaxWidth().padding(vertical = 24.dp), horizontalArrangement = Arrangement.Center) {
                    CircularProgressIndicator(Modifier.semantics { contentDescription = "Loading recent results" })
                }
            }
        }
    }
}

@Composable
private fun AttemptRow(a: AttemptListItem, target: Double, onClick: () -> Unit) {
    val e = MaterialTheme.ext
    val whenText = isoMillis(a.createdAt)?.let { relativeTime(it) }.orEmpty()
    Row(
        Modifier.fillMaxWidth().heightIn(min = 60.dp).clickable(role = Role.Button, onClick = onClick).padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(sentenceCase(a.promptTitle), style = MaterialTheme.typography.titleMedium, color = e.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(if (whenText.isEmpty()) "Part ${a.part}" else "Part ${a.part}, $whenText", style = MaterialTheme.typography.bodyMedium, color = e.muted)
        }
        val overall = a.overall
        when {
            a.status == "done" && overall != null ->
                Text(Band.format(overall), Modifier.semantics { contentDescription = "Band ${Band.format(overall)}" }, style = AppText.band(22), color = bandTextColor(overall, target))
            a.status == "failed" -> Text("Failed", style = MaterialTheme.typography.labelMedium, color = e.badText)
            else -> Text(if (a.status == "analyzing") "Scoring" else "Not submitted", style = MaterialTheme.typography.labelMedium, color = e.muted)
        }
        Icon(Icons.Filled.KeyboardArrowRight, contentDescription = null, tint = e.muted)
    }
}

@Composable
private fun BankLink(onClick: () -> Unit) {
    val e = MaterialTheme.ext
    ListCard {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 60.dp).clickable(role = Role.Button, onClick = onClick).padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Prompt bank", style = MaterialTheme.typography.titleMedium, color = e.ink)
                Text("Search every topic and cue card", style = MaterialTheme.typography.bodyMedium, color = e.muted)
            }
            Icon(Icons.Filled.KeyboardArrowRight, contentDescription = null, tint = e.muted)
        }
    }
}
