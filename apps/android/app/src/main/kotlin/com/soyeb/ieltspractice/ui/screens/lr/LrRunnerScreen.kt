package com.soyeb.ieltspractice.ui.screens.lr

import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.IconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalTextToolbar
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.LocalDemo
import com.soyeb.ieltspractice.R
import com.soyeb.ieltspractice.core.LrAttempt
import com.soyeb.ieltspractice.core.partsLabel
import com.soyeb.ieltspractice.core.readingSeconds
import com.soyeb.ieltspractice.core.answeredCount
import com.soyeb.ieltspractice.core.flat
import com.soyeb.ieltspractice.core.isAnswered
import com.soyeb.ieltspractice.ui.Load
import com.soyeb.ieltspractice.ui.ScreenScaffold
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.LrResult
import com.soyeb.ieltspractice.ui.nav.LrRun
import com.soyeb.ieltspractice.ui.rememberLoad
import com.soyeb.ieltspractice.ui.screens.shell.Segmented
import com.soyeb.ieltspractice.ui.theme.ErrorLine
import com.soyeb.ieltspractice.ui.theme.PrimaryButton
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// Mirrors: web components/lr/Runner.tsx, routes/_app/lr/run.$attemptId.tsx

/** Opens an attempt: loads it, then runs it (a submitted one goes to its result). */
@Composable
fun LrRunScreen(route: LrRun, nav: AppNav) {
    val api = LocalApp.current.api
    val load = rememberLoad(route.attemptId) { api.get<LrAttempt>("/api/lr/attempts/${route.attemptId}") }
    when (val s = load.state) {
        Load.Loading -> ScreenScaffold("Loading", onBack = nav::back) { Box(Modifier.fillMaxWidth().padding(24.dp), Alignment.Center) { CircularProgressIndicator() } }
        is Load.Failed -> ScreenScaffold("Test", onBack = nav::back) { ErrorLine(s.message); SecondaryButton("Retry", load.reload) }
        is Load.Ready -> if (s.value.submitted) LaunchedEffect(Unit) { if (route.mockId != null) nav.back() else nav.replace(LrResult(s.value.id)) } else LrRunner(s.value, route.mockId, nav)
    }
}

private fun prefs(c: Context) = c.applicationContext.getSharedPreferences("lr", Context.MODE_PRIVATE)

@Composable
private fun LrRunner(attempt: LrAttempt, mockId: String?, nav: AppNav) {
    val e = MaterialTheme.ext
    val app = LocalApp.current
    val demo = LocalDemo.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val test = attempt.test
    val sections = test.sections
    val listening = test.listening
    val ds = demo?.screen.orEmpty() // demo screen names are the iOS ones (lr-reading, lr-navigator, ...), so both apps' shots line up
    val exam = attempt.exam || ds in setOf("lr-listening-gate", "lr-listening-review")
    val examListening = listening && exam
    val wide = LocalConfiguration.current.screenWidthDp >= 840

    val session = remember(attempt.id) {
        LrSession(attempt, app.api, app.scope,
            loadLocalAudio = { if (demo == null) prefs(context).getString("audio:${attempt.id}", null) else null },
            saveLocalAudio = { prefs(context).edit().putString("audio:${attempt.id}", it).apply() })
    }
    val flat = remember(test) { test.flat() }
    val total = flat.size
    val reg = remember { QRegistry() }
    val hl = remember(attempt.id) {
        Marks(if (demo == null) parseMarks(prefs(context).getString("marks:${attempt.id}", null)) else emptyList()) {
            if (demo == null) prefs(context).edit().putString("marks:${attempt.id}", marksJson(it)).apply()
        }
    }
    var settings by remember { mutableStateOf(if (demo == null) parseSettings(prefs(context).getString("settings", null)) else LrSettings()) }
    var notesOpen by remember { mutableStateOf(false) }
    var helpOpen by remember { mutableStateOf(false) }
    var settingsOpen by remember { mutableStateOf(false) }
    var moreOpen by remember { mutableStateOf(false) }
    var hidden by remember { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current
    val roomy = LocalConfiguration.current.screenWidthDp >= 640 // below this the buttons fold into one "More" menu and the title goes
    val baseBar = LocalTextToolbar.current
    val toolbar = remember(baseBar) { MarkToolbar(baseBar) }
    val saved = remember(attempt.id) { if (demo == null) prefs(context).getString("pos:${attempt.id}", null)?.split(",")?.mapNotNull { it.toIntOrNull() } else null }
    var partIdx by rememberSaveable { mutableIntStateOf(if (ds == "lr-reading-p2") 1 else saved?.getOrNull(0)?.coerceIn(0, sections.lastIndex) ?: 0) }
    var current by rememberSaveable { mutableIntStateOf(if (ds == "lr-reading-p2") sections.getOrNull(1)?.groups?.firstOrNull()?.from ?: 1 else saved?.getOrNull(1) ?: flat.firstOrNull()?.n ?: 1) }
    var active by remember { mutableStateOf<Int?>(null) }
    var flagged by remember(attempt.id) {
        mutableStateOf(
            if (demo != null) (if (ds == "lr-navigator") setOf(4, 9) else emptySet())
            else prefs(context).getString("flags:${attempt.id}", "").orEmpty().split(",").mapNotNull { it.toIntOrNull() }.toSet(),
        )
    }
    var tab by rememberSaveable { mutableStateOf(if (ds in setOf("lr-reading-questions", "lr-navigator", "lr-submit", "lr-reading-p2")) "questions" else "passage") }
    var navOpen by remember { mutableStateOf(ds == "lr-navigator") }
    var confirm by remember { mutableStateOf(ds == "lr-submit") }
    var leave by remember { mutableStateOf(ds == "lr-leave") }
    var submitError by remember { mutableStateOf<String?>(null) }
    val section = sections[partIdx.coerceIn(0, sections.lastIndex)]
    val responses = session.responses

    // ---- clocks ----
    val playlist = remember(attempt.id) {
        val urls = if (examListening) sections.map { attempt.assets[it.audio.orEmpty()].orEmpty() } else emptyList()
        ExamPlaylist(urls, attempt.elapsedS.toDouble(), if (demo != null && examListening) when (ds) { "lr-listening-gate" -> ExamPhase.Idle; "lr-listening-review" -> ExamPhase.Review; else -> ExamPhase.Audio } else null, test.checkEndsAt)
    }
    DisposableEffect(playlist) { if (examListening) playlist.attach(context); onDispose { playlist.release() } }
    LaunchedEffect(playlist) { if (examListening) playlist.tick() }
    var wall by remember { mutableDoubleStateOf(attempt.elapsedS.toDouble()) }
    LaunchedEffect(examListening) {
        if (examListening || demo != null) return@LaunchedEffect
        val t0 = System.nanoTime()
        val base = wall
        while (true) { delay(500); wall = base + (System.nanoTime() - t0) / 1e9; session.elapsed = wall }
    }
    LaunchedEffect(playlist.elapsed) { if (examListening && playlist.phase != ExamPhase.Idle) session.elapsed = playlist.elapsed }
    val started = !examListening || playlist.phase != ExamPhase.Idle
    val modeNote = attempt.parts?.let { ", ${partsLabel(test.skill, it)}" }.orEmpty()
    val limit = readingSeconds(attempt.parts) // 20 minutes per passage when taking only some
    val readingLeft = limit - wall.toInt()
    // only the Reading exam countdown warns (10:00 and 5:00); Listening stays neutral
    val tone = if (exam && !listening) readingTone(readingLeft, limit) else 0
    val pulse = tone > 0 && readingPulse(readingLeft, limit)
    val timeUp = demo == null && exam && (if (listening) playlist.phase == ExamPhase.Review && playlist.reviewLeft == 0 else readingLeft <= 0)
    var leaving by remember { mutableStateOf(false) }
    // pacing: late = the last 5 minutes of reading; in the exam listening, after the recordings end
    session.lateFrom = if (listening) (if (exam && playlist.total > 0) playlist.total else Double.POSITIVE_INFINITY) else limit - 300.0
    var foreground by remember { mutableStateOf(true) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { foreground = true }
    LifecycleEventEffect(Lifecycle.Event.ON_PAUSE) { foreground = false }
    val partNo = section.part
    LaunchedEffect(started, partNo) { if (started && demo == null) while (true) { delay(1000); if (foreground) session.tickPart(partNo) } }

    fun submit() {
        leaving = true
        scope.launch {
            try {
                session.submit()
                if (demo == null) prefs(context).edit().remove("marks:${attempt.id}").apply() // notes are not kept past the attempt
                if (mockId != null) nav.back() else nav.replace(LrResult(attempt.id)) // a mock test goes back to its hub
            } catch (ex: Exception) {
                leaving = false
                confirm = false
                submitError = "Could not submit. Your answers are saved; try again."
            }
        }
    }
    LaunchedEffect(timeUp) { if (timeUp) submit() }
    fun exit() { leaving = true; session.flushLater(true); nav.back() }

    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { if (demo == null) session.flushLater(true) }
    DisposableEffect(session) { onDispose { if (demo == null) session.flushLater(true) } }
    LaunchedEffect(session) { if (demo == null) while (true) { delay(15_000); session.flush(true) } }
    LaunchedEffect(partIdx, current, flagged) {
        if (demo == null) prefs(context).edit().putString("pos:${attempt.id}", "$partIdx,$current").putString("flags:${attempt.id}", flagged.joinToString(",")).apply()
    }
    BackHandler(enabled = !leaving) { if (exam) leave = true else exit() }

    // ---- moving about ----
    val ctx = QCtx(responses, session::change, attempt.assets, active = active, onFocus = { current = it }, onText = { n, on -> if (on) session.noteFocus(n) else session.noteBlur(n) }, reg = reg, hl = hl)
    fun goPart(i: Int) { partIdx = i; current = sections[i].groups.firstOrNull()?.from ?: current }
    LaunchedEffect(examListening, playlist.phase, playlist.idx) { if (examListening && playlist.phase == ExamPhase.Audio) goPart(playlist.idx.coerceIn(0, sections.lastIndex)) }
    fun jump(n: Int) {
        val f = flat.firstOrNull { it.n == n } ?: return
        partIdx = sections.indexOfFirst { it.part == f.part }
        current = n; active = n; tab = "questions"; navOpen = false
        scope.launch {
            delay(150)
            ctx.reveal(n, true)
            delay(2500)
            if (active == n) active = null
        }
    }
    fun jumpMark(m: TextMark) {
        notesOpen = false
        val q = markQuestion(m)
        if (q != null) jump(q) else {
            val i = sections.indexOfFirst { it.part == m.region.split(':').getOrNull(1)?.toIntOrNull() }
            if (i >= 0) { goPart(i); tab = "passage" }
        }
        hl.flash = m.id
        scope.launch { delay(2500); if (hl.flash == m.id) hl.flash = null }
    }
    // in the Listening exam the recording owns the part, so a mark in another part cannot be opened
    fun canJump(m: TextMark): Boolean = !examListening || markQuestion(m)?.let { q -> flat.firstOrNull { it.n == q }?.part == section.part } == true
    LaunchedEffect(started) { if (started && saved != null) { delay(250); ctx.reveal(current, false) } }

    val navParts = sections.map { s -> NavPart(s.part, "${if (listening) "Part" else "Passage"} ${s.part}", s.groups.flatMap { g -> g.questions.map { it.n } }) }
    val answered = { n: Int -> responses.isAnswered(n) }
    val unanswered = flat.count { !answered(it.n) }
    val idx = flat.indexOfFirst { it.n == current }

    CompositionLocalProvider(LocalTextToolbar provides toolbar) {
    ScreenScaffold(
        if (roomy) "${test.title}, ${if (listening) "Part" else "Passage"} ${section.part}" else "", Modifier.imePadding(), onBack = { if (exam) leave = true else exit() }, scroll = false,
        actions = {
            if (examListening) {
                if (playlist.phase == ExamPhase.Review) ClockPill(playlist.reviewLeft, true, "Review time left", tone = 1)
                else if (playlist.total > 0) ClockPill(playlist.timeLeft, true, "Time left")
            }
            else if (exam) ClockPill(readingLeft.coerceAtLeast(0), true, "Time left", tone = tone, pulse = pulse, announce = true)
            else ClockPill(wall.toInt(), false, "Time spent")
            SaveIndicator(session.state)
            if (roomy) {
                if (hl.list.isNotEmpty()) TextButton({ notesOpen = true }, Modifier.heightIn(min = 48.dp)) { Text("Notes (${hl.list.size})", color = e.ink) }
                TextButton({ helpOpen = true }, Modifier.heightIn(min = 48.dp)) { Text("Help", color = e.ink) }
                TextButton({ settingsOpen = true }, Modifier.heightIn(min = 48.dp)) { Text("Settings", color = e.ink) }
                TextButton({ focusManager.clearFocus(); hidden = true }, Modifier.heightIn(min = 48.dp), enabled = started) { Text("Hide", color = e.ink) }
            } else Box {
                IconButton({ moreOpen = true }) { Icon(Icons.Filled.MoreVert, "More: notes, help, settings, hide") }
                DropdownMenu(moreOpen, { moreOpen = false }, containerColor = e.surface) {
                    if (hl.list.isNotEmpty()) DropdownMenuItem({ Text("Notes (${hl.list.size})", color = e.ink) }, { moreOpen = false; notesOpen = true }, Modifier.heightIn(min = 48.dp))
                    DropdownMenuItem({ Text("Help", color = e.ink) }, { moreOpen = false; helpOpen = true }, Modifier.heightIn(min = 48.dp))
                    DropdownMenuItem({ Text("Settings", color = e.ink) }, { moreOpen = false; settingsOpen = true }, Modifier.heightIn(min = 48.dp))
                    if (started) DropdownMenuItem({ Text("Hide", color = e.ink) }, { moreOpen = false; focusManager.clearFocus(); hidden = true }, Modifier.heightIn(min = 48.dp))
                }
            }
            PrimaryButton("Submit", { confirm = true }, Modifier.padding(start = 6.dp, end = 8.dp), enabled = started)
        },
    ) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
            Column(Modifier.fillMaxSize().then(if (hidden) Modifier.clearAndSetSemantics {} else Modifier), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (started) {
                    PrimaryTabRow(
                        sections.indexOf(section), containerColor = e.bg, contentColor = e.brand,
                        divider = { HorizontalDivider(color = e.line) },
                    ) {
                        sections.forEachIndexed { i, s ->
                            val qs = navParts[i].questions
                            Tab(
                                i == sections.indexOf(section), { if (!examListening) goPart(i) }, Modifier.heightIn(min = 48.dp),
                                selectedContentColor = e.brand, unselectedContentColor = e.muted,
                            ) {
                                Row(Modifier.padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Text(navParts[i].label, style = MaterialTheme.typography.labelLarge, maxLines = 1)
                                    Text("${qs.count(answered)}/${qs.size}", Modifier.background(e.surface2, RoundedCornerShape(6.dp)).padding(horizontal = 5.dp, vertical = 1.dp), style = MaterialTheme.typography.labelSmall, color = e.muted)
                                }
                            }
                        }
                    }
                }
                LrContent(settings) {
                when {
                    !started -> Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(top = 16.dp)) { ExamGate(playlist, attempt.elapsedS > 0, ::exit, parts = sections.map { it.part }) }
                    listening -> {
                        Surface2 {
                            if (exam) ExamAudioBar(playlist, parts = attempt.parts?.let { sections.map { s -> s.part } })
                            else androidx.compose.runtime.key(section.audio) { PracticeAudio(attempt.assets[section.audio.orEmpty()].orEmpty(), "Part ${section.part}", resume = LrResume(session.audioStart(section.part), session.audioRate, { session.noteAudio(section.part, it) }, session::saveAudio, session::noteRate)) }
                        }
                        QuestionsPane(section, ctx, exam, true, Modifier.weight(1f).fillMaxWidth(), modeNote)
                    }
                    wide -> Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                        Column(Modifier.weight(1f).fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 8.dp)) { SectionPassage(section, hl = hl) }
                        QuestionsPane(section, ctx, exam, false, Modifier.weight(1f).fillMaxSize(), modeNote)
                    }
                    else -> {
                        Segmented(listOf("passage" to "Passage", "questions" to "Questions"), tab, { tab = it })
                        if (tab == "passage") Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(vertical = 8.dp)) {
                            SectionPassage(section, hl = hl)
                            Text("Press and hold to select text, then highlight it or add a note.", Modifier.padding(top = 16.dp, bottom = 16.dp), style = MaterialTheme.typography.bodySmall, color = e.muted)
                        } else QuestionsPane(section, ctx, exam, false, Modifier.weight(1f).fillMaxWidth(), modeNote)
                    }
                }
                }
            }
            if (hidden) HidePanel(listening, { hidden = false }, Modifier.fillMaxSize())
        }
        if (started) {
            HorizontalDivider(color = e.line)
            Row(Modifier.fillMaxWidth().padding(bottom = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                val flag = current in flagged
                Row(
                    Modifier.weight(1f).heightIn(min = 48.dp).background(e.surface2, RoundedCornerShape(8.dp)).clickable(role = Role.Button) { navOpen = true }.padding(horizontal = 12.dp)
                        .semantics { contentDescription = "Open the question navigator. Question $current of $total, ${total - unanswered} answered" },
                    horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(painterResource(R.drawable.ic_lr_grid), null, Modifier.size(20.dp), tint = e.ink)
                    Column {
                        Text("Question $current of $total", style = MaterialTheme.typography.labelLarge, color = e.ink, maxLines = 1)
                        Text("${total - unanswered} answered", style = MaterialTheme.typography.bodySmall, color = e.muted, maxLines = 1)
                    }
                }
                SquareButton(R.drawable.ic_lr_flag, if (flag) "Remove flag from question $current" else "Flag question $current for review", { flagged = if (flag) flagged - current else flagged + current }, selected = flag)
                SquareButton(null, "Previous question", { jump(flat[idx - 1].n) }, enabled = idx > 0, vector = Icons.AutoMirrored.Filled.ArrowBack)
                SquareButton(null, "Next question", { jump(flat[idx + 1].n) }, enabled = idx in 0 until total - 1, vector = Icons.AutoMirrored.Filled.ArrowForward, primary = true)
            }
        }
    }

    }
    MarkChip(toolbar, hl)
    MarkDialogs(hl)
    if (notesOpen) NotesSheet(hl, ::canJump, ::jumpMark) { notesOpen = false }
    if (helpOpen) HelpSheet { helpOpen = false }
    if (settingsOpen) SettingsSheet(settings, { settings = it; if (demo == null) prefs(context).edit().putString("settings", settingsJson(it)).apply() }) { settingsOpen = false }
    submitError?.let { msg ->
        AlertDialog(
            { submitError = null }, containerColor = e.surface, titleContentColor = e.ink, textContentColor = e.muted,
            title = { Text("Not submitted") }, text = { Text(msg) },
            confirmButton = { TextButton({ submitError = null }) { Text("OK", color = e.brand) } },
        )
    }
    if (navOpen) LrSheet({ navOpen = false }) {
        Text("Questions", style = MaterialTheme.typography.headlineSmall, color = e.ink, modifier = Modifier.semantics { contentDescription = "Questions" })
        Text(
            "${total - unanswered} of $total answered" + if (flagged.isNotEmpty()) ", ${flagged.size} flagged" else "",
            style = MaterialTheme.typography.bodyMedium, color = e.muted,
        )
        QuestionNavigator(navParts, answered, flagged, current, ::jump)
    }
    if (confirm) AlertDialog(
        { if (!session.submitting) confirm = false }, containerColor = e.surface, titleContentColor = e.ink, textContentColor = e.muted,
        title = { Text("Submit your answers?") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    (if (unanswered > 0) "$unanswered ${if (unanswered == 1) "question is" else "questions are"} unanswered. " else "Every question has an answer. ") +
                        (if (flagged.isNotEmpty()) "${flagged.size} flagged for review. " else "") + "You cannot change answers after submitting.",
                    style = MaterialTheme.typography.bodyMedium, color = if (unanswered > 0) e.warnText else e.muted,
                )
                if (flagged.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    flagged.sorted().forEach { n ->
                        Row(
                            Modifier.heightIn(min = 48.dp).background(e.surface2, RoundedCornerShape(8.dp)).clickable(role = Role.Button) { confirm = false; jump(n) }.padding(horizontal = 12.dp)
                                .semantics { contentDescription = "Go to flagged question $n" },
                            horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(painterResource(R.drawable.ic_lr_flag), null, Modifier.size(16.dp), tint = e.warn)
                            Text("$n", style = MaterialTheme.typography.labelLarge, color = e.ink)
                        }
                    }
                }
                if (session.submitting) CircularProgressIndicator(Modifier.size(24.dp), color = e.brand, strokeWidth = 2.dp)
            }
        },
        dismissButton = { TextButton({ confirm = false }, enabled = !session.submitting) { Text("Keep working", color = e.ink) } },
        confirmButton = { TextButton(::submit, enabled = !session.submitting) { Text("Submit answers", color = e.brand) } },
    )
    if (leave) AlertDialog(
        { leave = false }, containerColor = e.surface, titleContentColor = e.ink, textContentColor = e.muted,
        title = { Text("Leave the test?") },
        text = { Text("Your answers are saved. You can resume this attempt from the hub, but the exam clock does not run while you are away.") },
        dismissButton = { TextButton({ leave = false }) { Text("Stay in the test", color = e.ink) } },
        confirmButton = { TextButton({ leave = false; exit() }) { Text("Leave", color = e.badText) } },
    )
}

/** A bordered card for the sticky audio bar. */
@Composable
private fun Surface2(content: @Composable ColumnScope.() -> Unit) {
    val e = MaterialTheme.ext
    Column(
        Modifier.fillMaxWidth().background(e.surface, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp), content = content,
    )
}

/** The groups of one section, scrolling. Keyed by part so every part keeps its own scroll position. */
@Composable
private fun QuestionsPane(section: com.soyeb.ieltspractice.core.LrSection, ctx: QCtx, exam: Boolean, listening: Boolean, modifier: Modifier, note: String = "") {
    val e = MaterialTheme.ext
    androidx.compose.runtime.key(section.part) {
        Column(modifier.verticalScroll(rememberScrollState()).padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(28.dp)) {
            Text(
                "${if (listening) "Part" else "Passage"} ${section.part}: Questions ${section.groups.firstOrNull()?.from} to ${section.groups.lastOrNull()?.to}  ·  ${if (exam) "Exam" else "Practice"} mode$note",
                style = MaterialTheme.typography.bodySmall, color = e.muted,
            )
            section.groups.forEach { QuestionGroup(it, ctx) }
            Spacer(Modifier.size(24.dp))
        }
    }
}

/** 48dp icon button; [selected] is a toggled state (the flag), [primary] the solid next-question button. */
@Composable
private fun SquareButton(
    @androidx.annotation.DrawableRes icon: Int?, label: String, onClick: () -> Unit, enabled: Boolean = true, selected: Boolean = false,
    primary: Boolean = false, vector: androidx.compose.ui.graphics.vector.ImageVector? = null,
) {
    val e = MaterialTheme.ext
    val bg = when { !enabled -> e.surface2; primary -> e.brand; selected -> e.warn.copy(alpha = 0.18f); else -> e.surface2 }
    val fg = when { !enabled -> e.muted.copy(alpha = 0.6f); primary -> e.onBrand; selected -> e.warnText; else -> e.ink }
    Box(
        Modifier.size(48.dp).background(bg, RoundedCornerShape(8.dp)).clickable(enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label; if (icon != null) stateDescription = if (selected) "Flagged" else "Not flagged" },
        contentAlignment = Alignment.Center,
    ) {
        if (icon != null) Icon(painterResource(icon), null, Modifier.size(22.dp), tint = fg) else if (vector != null) Icon(vector, null, Modifier.size(22.dp), tint = fg)
    }
}
