package com.soyeb.ieltspractice.ui.screens.lr

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.LocalDemo
import com.soyeb.ieltspractice.core.Accuracy
import com.soyeb.ieltspractice.core.LrAttempt
import com.soyeb.ieltspractice.core.partsLabel
import com.soyeb.ieltspractice.core.readingSeconds
import com.soyeb.ieltspractice.core.LrMark
import com.soyeb.ieltspractice.core.LrProgress
import com.soyeb.ieltspractice.core.audioWindow
import com.soyeb.ieltspractice.core.clock
import com.soyeb.ieltspractice.core.questionMoments
import com.soyeb.ieltspractice.core.evidenceSpan
import com.soyeb.ieltspractice.core.sectionParagraphs
import com.soyeb.ieltspractice.core.timingRows
import com.soyeb.ieltspractice.core.TextSpan
import com.soyeb.ieltspractice.core.accuracyBy
import com.soyeb.ieltspractice.core.flat
import com.soyeb.ieltspractice.core.fmt
import com.soyeb.ieltspractice.core.typeLabel
import com.soyeb.ieltspractice.ui.Load
import com.soyeb.ieltspractice.ui.ScreenScaffold
import com.soyeb.ieltspractice.core.ApiError
import kotlinx.coroutines.CancellationException
import com.soyeb.ieltspractice.ui.screens.shell.ConfirmRemoveDialog
import com.soyeb.ieltspractice.ui.screens.shell.RemovalTarget
import com.soyeb.ieltspractice.ui.screens.shell.RemoveMenuAction
import com.soyeb.ieltspractice.ui.screens.shell.removeAttempt
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.LrResult
import com.soyeb.ieltspractice.ui.nav.LrRun
import com.soyeb.ieltspractice.ui.rememberLoad
import com.soyeb.ieltspractice.ui.screens.shell.BandBar
import com.soyeb.ieltspractice.ui.screens.shell.LinkButton
import com.soyeb.ieltspractice.ui.screens.shell.Segmented
import com.soyeb.ieltspractice.ui.screens.shell.ShellDate
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.ErrorLine
import com.soyeb.ieltspractice.ui.theme.PrimaryButton
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.SectionTitle
import com.soyeb.ieltspractice.ui.theme.bandTextColor
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

// Mirrors: web components/lr/Results.tsx, routes/_app/lr/result.$attemptId.tsx

@Composable
fun LrResultScreen(route: LrResult, nav: AppNav) {
    val api = LocalApp.current.api
    val load = rememberLoad(route.attemptId) { api.get<LrAttempt>("/api/lr/attempts/${route.attemptId}") }
    when (val s = load.state) {
        Load.Loading -> ScreenScaffold("Result", onBack = nav::back) { Box(Modifier.fillMaxWidth().padding(24.dp), Alignment.Center) { CircularProgressIndicator() } }
        is Load.Failed -> ScreenScaffold("Result", onBack = nav::back) { ErrorLine(s.message); SecondaryButton("Retry", load.reload) }
        is Load.Ready -> {
            val scope = rememberCoroutineScope()
            var asking by remember { mutableStateOf<RemovalTarget?>(null) }
            var removeError by remember { mutableStateOf<String?>(null) }
            val t = RemovalTarget(s.value.id, s.value.test.title, true)
            ScreenScaffold(s.value.test.title, onBack = nav::back, actions = { RemoveMenuAction { asking = t } }) {
                asking?.let { a ->
                    ConfirmRemoveDialog(a, onConfirm = {
                        asking = null
                        scope.launch {
                            try { removeAttempt(api, a); nav.back() } catch (x: CancellationException) { throw x } catch (x: Exception) {
                                removeError = "Couldn't remove it: ${(x as? ApiError)?.message ?: "try again."}"
                            }
                        }
                    }, onDismiss = { asking = null })
                }
                removeError?.let { ErrorLine(it) }
                Results(s.value, nav)
            }
        }
    }
}

@Composable
private fun ratioColor(r: Double) = with(MaterialTheme.ext) { if (r >= 0.75) good else if (r >= 0.5) warn else bad }

/** One list, worst first. Each row has the score as text and a bar; colour only repeats what the numbers say. */
@Composable
private fun AccuracyList(rows: List<Accuracy>) {
    val e = MaterialTheme.ext
    AppCard(padding = 0.dp) {
        rows.sortedBy { if (it.total > 0) it.right.toDouble() / it.total else 0.0 }.forEachIndexed { i, r ->
            val ratio = if (r.total > 0) r.right.toDouble() / r.total else 0.0
            if (i > 0) HorizontalDivider(color = e.line)
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row {
                    Text(r.label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = e.ink)
                    Text("${r.right}/${r.total}", style = MaterialTheme.typography.titleSmall.merge(AppText.num), color = e.ink)
                }
                BandBar(ratio, "${r.label}: ${r.right} of ${r.total} correct", fill = ratioColor(ratio), height = 6.dp)
            }
        }
    }
}

@Composable
private fun Results(a: LrAttempt, nav: AppNav) {
    val e = MaterialTheme.ext
    val api = LocalApp.current.api
    val me by api.me.collectAsState()
    val target = me?.settings?.targetBand ?: 7.0
    val scope = rememberCoroutineScope()
    val test = a.test
    val listening = test.listening
    val marks = remember(a) { (a.marks ?: emptyList()).associateBy { it.n } }
    val flat = remember(test) { test.flat() }
    val firstWrong = flat.firstOrNull { marks[it.n]?.correct != true }?.n
    val demoScreen = LocalDemo.current?.screen
    // demo screens open on a tab with a question selected (and the dictation sheet for lr-dictation)
    val demoSel = when (demoScreen) {
        "lr-result-detail" -> 9
        "lr-result-detail-listening", "lr-result-timestamps", "lr-dictation" -> 28
        "lr-result-answers", "lr-result-transcript" -> firstWrong
        else -> null
    }
    var tab by remember {
        mutableStateOf(when (demoScreen) {
            "lr-result-detail", "lr-result-detail-listening", "lr-dictation", "lr-result-answers" -> "answers"
            "lr-result-p2", "lr-result-timestamps", "lr-result-transcript" -> "context"
            else -> "summary"
        })
    }
    var by by remember { mutableStateOf("type") }
    var wrongOnly by remember { mutableStateOf(demoSel?.let { marks[it]?.correct != true } ?: true) }
    var partIdx by remember { mutableIntStateOf(if (demoScreen == "lr-result-p2") 1 else demoSel?.let { n -> test.sections.indexOfFirst { s -> s.groups.any { n in it.from..it.to } }.coerceAtLeast(0) } ?: 0) }
    var active by remember { mutableStateOf<Int?>(null) }
    var selected by remember { mutableStateOf(demoSel) }
    var scrollKey by remember { mutableIntStateOf(if (demoSel != null) 1 else 0) }
    var cue by remember { mutableStateOf<Pair<Int, AudioCue>?>(null) }
    var cueId by remember { mutableIntStateOf(0) }
    var dict by remember { mutableStateOf(if (demoScreen == "lr-dictation") demoSel else null) }
    val tabsReq = remember { BringIntoViewRequester() }
    val paceReq = remember { BringIntoViewRequester() }
    val audioReq = remember { BringIntoViewRequester() }
    val insights = rememberLoad { runCatching { api.get<LrProgress>("/api/lr/progress") }.getOrNull() }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val reg = remember { QRegistry() }
    val ctx = QCtx(a.responses, {}, a.assets, marks = marks, active = active, reg = reg)
    val section = test.sections[partIdx.coerceIn(0, test.sections.lastIndex)]
    val entries = remember(a) { (a.analysis?.gaps ?: emptyList()).associateBy { it.n } }
    val band = a.band ?: 0.0
    val gap = target - band
    val noun = if (listening) "Part" else "Passage"
    val byPart = test.sections.map { s ->
        val qs = s.groups.flatMap { g -> g.questions.map { marks[it.n] } }
        Accuracy("$noun ${s.part}", qs.count { it?.correct == true }, qs.size)
    }
    val byType = accuracyBy(test, a.marks ?: emptyList()) { typeLabel(it.group) }
    val wrongCount = flat.count { marks[it.n]?.correct != true }
    val blank = flat.filter { marks[it.n]?.given.isNullOrEmpty() }.map { it.n }
    val slips = (a.analysis?.gaps ?: emptyList()).count { it.kind == "spelling" || it.kind == "plural" }
    val weak = byType.filter { it.total >= 3 && it.right < it.total }.minByOrNull { it.right.toDouble() / it.total }
    val takeaways = listOfNotNull(
        weak?.let { "Weakest: ${it.label.lowercase()}, ${it.right} of ${it.total} right." },
        if (slips > 0) "$slips ${if (slips == 1) "answer was" else "answers were"} the right word with a spelling or plural slip." else null,
        if (blank.isNotEmpty()) "${blank.size} left blank. There is no penalty for guessing." else null,
        if (wrongCount == 0) "Every answer was correct." else null,
    ).take(3)

    fun go(t: String) { tab = t; scope.launch { delay(60); runCatching { tabsReq.bringIntoView() } } }
    fun focus(n: Int) {
        val f = flat.firstOrNull { it.n == n } ?: return
        partIdx = test.sections.indexOfFirst { it.part == f.part }
        selected = n
        scrollKey++
        active = n
        scope.launch { delay(3000); if (active == n) active = null }
    }
    fun toggle(n: Int) { if (selected == n) selected = null else { val f = flat.firstOrNull { it.n == n }; if (f != null) { partIdx = test.sections.indexOfFirst { it.part == f.part }; selected = n } } }
    fun play(n: Int) {
        val f = flat.firstOrNull { it.n == n } ?: return
        val s = test.sections.firstOrNull { it.part == f.part } ?: return
        val w = audioWindow(s.timingRows, f.q) ?: return
        partIdx = test.sections.indexOf(s)
        cue = s.part to AudioCue(w.from, w.to, ++cueId)
        go("context")
    }
    val sel = selected?.let { n -> flat.firstOrNull { it.n == n } }
    val selSection = sel?.let { f -> test.sections.firstOrNull { it.part == f.part } }
    val span = remember(sel, selSection) { if (sel != null && selSection != null) evidenceSpan(sectionParagraphs(selSection), sel.q, sel.group.type == "gap") else null }
    val evidence = if (span != null && selSection?.part == section.part) span else null
    val moments = remember(test) { if (listening) test.sections.flatMap { questionMoments(it.timingRows, it.groups) }.associateBy { it.n } else emptyMap() }
    val pins = remember(section, marks) { questionMoments(section.timingRows, section.groups).map { AudioPin(it.n, it.at, marks[it.n]?.correct == true, !it.exact) } }
    val tpins = remember(section, marks) {
        if (!listening || section.transcript == null) emptyList() else {
            val paras = sectionParagraphs(section)
            section.groups.flatMap { g -> g.questions.mapNotNull { q -> evidenceSpan(paras, q, g.type == "gap")?.let { QPin(it.p, it.s, q.n, marks[q.n]?.correct == true) } } }
        }
    }
    fun pick(n: Int) { focus(n); play(n) }
    LaunchedEffect(demoScreen) { if (demoScreen == "lr-result-timestamps") { delay(1500); runCatching { audioReq.bringIntoView() } } }
    LaunchedEffect(demoScreen) { if (demoScreen == "lr-result-pacing") { delay(400); runCatching { paceReq.bringIntoView() } } }
    fun retake() {
        busy = true; error = null
        scope.launch {
            try {
                val r = api.send<LrAttempt>("POST", "/api/lr/tests/${a.testId}/attempts", buildJsonObject {
                    put("mode", a.mode)
                    a.parts?.let { ps -> putJsonArray("parts") { ps.forEach { add(JsonPrimitive(it)) } } }
                })
                nav.go(LrRun(r.id))
            } catch (ex: Exception) { error = "Could not start a new attempt. Try again." }
            busy = false
        }
    }

    // ---- hero: the verdict, what to do about it, one action ----
    val time = a.elapsedS.takeIf { it > 0 }?.let { ShellDate.duration(it * 1000) }
    Text(
        "${if (listening) "Listening" else "Reading"}, ${if (test.variant == "academic") "Academic" else "General Training"}, ${a.parts?.let { "${partsLabel(test.skill, it)}, " }.orEmpty()}${a.mode} mode, ${ShellDate.date(a.submittedAt ?: a.startedAt)}${time?.let { ", $it" }.orEmpty()}",
        style = MaterialTheme.typography.bodyMedium, color = e.muted,
    )
    AppCard {
        val parts = a.parts
        // a part on its own has no band: IELTS bands only map from all 40 questions
        if (parts != null) Column(Modifier.semantics(mergeDescendants = true) {}) {
            Text("Score", style = MaterialTheme.typography.bodySmall, color = e.muted)
            Row(verticalAlignment = Alignment.Bottom) {
                Text("${a.raw ?: 0}", style = AppText.band(64), color = e.ink)
                Text("/${a.total ?: flat.size}", style = AppText.band(64), color = e.muted)
            }
            Text("${partsLabel(test.skill, parts)} only. Take the full test for a band score.", style = MaterialTheme.typography.bodyMedium, color = e.muted)
        } else Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(24.dp), verticalAlignment = Alignment.Bottom) {
            Column(Modifier.semantics(mergeDescendants = true) { contentDescription = "Band ${fmt(band)}" }) {
                Text("Band", style = MaterialTheme.typography.bodySmall, color = e.muted)
                Text(fmt(band), style = AppText.band(64), color = bandTextColor(band, target))
            }
            Column(Modifier.padding(bottom = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.Bottom) {
                    Text("${a.raw ?: 0}", style = AppText.band(30), color = e.ink)
                    Text("/${a.total ?: flat.size}", style = AppText.band(30), color = e.muted)
                    Text("  correct", Modifier.padding(bottom = 3.dp), style = MaterialTheme.typography.bodySmall, color = e.muted)
                }
                Text(
                    if (gap <= 0) "At or above your ${fmt(target)} target" else "${fmt(gap)} below your ${fmt(target)} target",
                    style = MaterialTheme.typography.bodyMedium, color = bandTextColor(band, target), fontWeight = FontWeight.Medium,
                )
            }
        }
        if (takeaways.isNotEmpty()) Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            takeaways.forEach { t ->
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(Modifier.padding(top = 9.dp).size(6.dp).background(e.brand, CircleShape))
                    Text(t, style = MaterialTheme.typography.bodyMedium, color = e.ink)
                }
            }
        }
        if (wrongCount > 0) {
            PrimaryButton("See your $wrongCount ${if (wrongCount == 1) "mistake" else "mistakes"}", { wrongOnly = true; go("answers") }, Modifier.fillMaxWidth())
            SecondaryButton("Retake", ::retake, Modifier.fillMaxWidth(), enabled = !busy)
        } else PrimaryButton("Retake", ::retake, Modifier.fillMaxWidth(), loading = busy)
        error?.let { ErrorLine(it) }
    }

    Column(Modifier.bringIntoViewRequester(tabsReq)) {
        Segmented(listOf("summary" to "Summary", "answers" to if (wrongCount > 0) "Answers ($wrongCount)" else "Answers", "context" to if (listening) "Transcript" else "Passage"), tab, { go(it) })
    }

    when (tab) {
        "summary" -> {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                SectionTitle("Where you lost marks")
            }
            Segmented(listOf("type" to "Question type", "part" to noun), by, { by = it })
            AccuracyList(if (by == "type") byType else byPart)
            val st = a.stats
            if (st != null && (st.partS.values.sum() >= 5 || st.changes.isNotEmpty())) Column(Modifier.bringIntoViewRequester(paceReq)) {
                Disclose("How you used your time", "Minutes per ${noun.lowercase()}, answers you changed, last-minute answers", initiallyOpen = demoScreen == "lr-result-pacing") {
                    PacingPanel(st, test.sections.map { s -> s.part to s.groups.flatMap { g -> g.questions.map { q -> q.n } } }, noun, if (listening) null else readingSeconds(a.parts).toDouble(), marks, blank)
                }
            }
            val tfng = a.analysis?.tfng.orEmpty()
            if (tfng.any { it.kind == "tfng" || it.kind == "ynng" }) Disclose("True / False / Not Given", "Which statements you mix up, and the rule for each") {
                TfngPanel(tfng, (insights.state as? Load.Ready)?.value?.tfng?.pattern)
            }
        }
        "answers" -> {
            Segmented(listOf("wrong" to "Wrong only ($wrongCount)", "all" to "All ${flat.size}"), if (wrongOnly) "wrong" else "all", { wrongOnly = it == "wrong" })
            val rows = flat.filter { !wrongOnly || marks[it.n]?.correct != true }
            if (rows.isEmpty()) Text("Nothing wrong. Every answer was correct.", style = MaterialTheme.typography.bodyLarge, color = e.muted)
            else AppCard(padding = 0.dp) {
                rows.forEachIndexed { i, f ->
                    if (i > 0) HorizontalDivider(color = e.line)
                    val open = selected == f.n
                    AnswerRow(f.n, marks[f.n], moments[f.n], f.part, open, { toggle(f.n) }) { pick(f.n) }
                    val sec = test.sections.firstOrNull { it.part == f.part }
                    if (open && sec != null) Column(Modifier.fillMaxWidth().background(e.surface2.copy(alpha = 0.5f)).padding(16.dp)) {
                        QuestionDetail(f, sec, marks[f.n], entries[f.n], onShow = { focus(f.n); go("context") }, onPlay = { pick(f.n) }, onDictate = { dict = f.n })
                    }
                }
            }
        }
        else -> {
            Text(
                if (listening) "Pick a question in Answers to mark where its answer is in the transcript. Tap a Q pill to open it." else "Pick a question in Answers to mark where its answer is in the passage.",
                style = MaterialTheme.typography.bodyMedium, color = e.muted,
            )
            if (sel != null) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Showing question ${sel.n}", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, color = e.ink)
                LinkButton("Clear", { selected = null })
            }
            PrimaryTabRow(test.sections.indexOf(section), containerColor = e.bg, contentColor = e.brand, divider = { HorizontalDivider(color = e.line) }) {
                test.sections.forEachIndexed { i, s ->
                    Tab(i == test.sections.indexOf(section), { partIdx = i }, Modifier.heightIn(min = 48.dp), selectedContentColor = e.brand, unselectedContentColor = e.muted) {
                        Text("$noun ${s.part}", Modifier.padding(vertical = 12.dp), style = MaterialTheme.typography.labelLarge, maxLines = 1)
                    }
                }
            }
            androidx.compose.runtime.key(section.part) {
                if (listening) {
                    AppCard(Modifier.bringIntoViewRequester(audioReq)) { PracticeAudio(a.assets[section.audio.orEmpty()].orEmpty(), "Part ${section.part}", cue = cue?.takeIf { it.first == section.part }?.second, pins = pins, pinned = selected, onPin = ::pick) }
                }
                VocabList(section.vocab.orEmpty())
                if (listening) section.transcript?.let { Transcript(it, evidence, scrollKey, tpins) { n -> selected = n; scrollKey++ } }
                else AppCard { Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) { SectionPassage(section, evidence = evidence, scrollKey = scrollKey) } }
                SectionTitle("Questions")
                QuestionsBlock(section, ctx)
            }
        }
    }
    if (dict != null && sel != null && sel.n == dict && selSection != null) DictationSheet(
        a.assets[selSection.audio.orEmpty()].orEmpty(), selSection, sel, if (demoScreen == "lr-dictation") "record the wait of each hive" else "", onClose = { dict = null },
    )
}

@Composable
private fun QuestionsBlock(section: com.soyeb.ieltspractice.core.LrSection, ctx: QCtx) {
    Column(verticalArrangement = Arrangement.spacedBy(28.dp)) {
        section.groups.forEach { QuestionGroup(it, ctx) }
        Spacer(Modifier.size(16.dp))
    }
}

@Composable
private fun Transcript(text: String, evidence: TextSpan?, scrollKey: Int, pins: List<QPin>, onPin: (Int) -> Unit) {
    val e = MaterialTheme.ext
    var open by remember { mutableStateOf(true) }
    AppCard(padding = 0.dp) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button) { open = !open }.padding(horizontal = 16.dp)
                .semantics { contentDescription = if (open) "Transcript, expanded" else "Transcript, collapsed" },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Transcript", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, color = e.ink)
            Text(if (open) "Hide" else "Show", style = MaterialTheme.typography.labelLarge, color = e.brand)
        }
        if (open) {
            HorizontalDivider(color = e.line)
            androidx.compose.foundation.text.selection.SelectionContainer {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    // one paragraph per line; the evidence span's index counts every line, blank ones too
                    text.split('\n').forEachIndexed { i, line ->
                        if (line.isNotBlank()) EvidenceText(line, evidence?.takeIf { it.p == i }, AppText.reading, e.ink, scrollKey, pins = pins.filter { it.p == i }, onPin = onPin)
                    }
                }
            }
        }
    }
}

/** One answer: icon plus number (never colour alone), what you wrote, the answer when wrong, an optional listen chip, and a chevron that opens the explanation. */
@Composable
private fun AnswerRow(n: Int, m: LrMark?, moment: com.soyeb.ieltspractice.core.QuestionMoment?, part: Int, open: Boolean, onClick: () -> Unit, onPlay: () -> Unit) {
    val e = MaterialTheme.ext
    val given = m?.given.orEmpty()
    val right = m?.correct == true
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(
            Modifier.weight(1f).heightIn(min = 56.dp).clickable(role = Role.Button, onClickLabel = if (open) "Hide explanation" else "Explain question $n", onClick = onClick)
                .padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp)
                .semantics(mergeDescendants = true) {
                    contentDescription = "Question $n, ${if (right) "correct" else "wrong"}. Your answer: ${given.ifEmpty { "none" }}." + (if (right) "" else " Correct answer: ${m?.answer?.joinToString(" or ").orEmpty()}.") + (if (open) " Expanded" else " Collapsed")
                },
            horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            if (right) Icon(Icons.Filled.Check, null, Modifier.size(20.dp), tint = e.goodText) else Icon(Icons.Filled.Close, null, Modifier.size(20.dp), tint = e.badText)
            Text("$n", Modifier.width(28.dp), style = MaterialTheme.typography.titleSmall.merge(AppText.num), color = e.ink)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    given.ifEmpty { "No answer" }, style = MaterialTheme.typography.bodyMedium,
                    color = if (given.isEmpty()) e.muted else e.ink, fontStyle = if (given.isEmpty()) FontStyle.Italic else FontStyle.Normal,
                )
                if (!right) Text("Answer: ${m?.answer?.joinToString(" / ").orEmpty()}", style = MaterialTheme.typography.bodySmall, color = e.goodText, fontWeight = FontWeight.Medium)
            }
            Icon(if (open) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown, null, tint = e.muted)
        }
        if (moment != null) Box(
            Modifier.heightIn(min = 48.dp).widthIn(min = 56.dp).clickable(role = Role.Button, onClick = onPlay)
                .semantics { contentDescription = "Question $n: listen from Part $part at ${clock(moment.at.toInt())}${if (moment.exact) "" else ", approximate"}" },
            contentAlignment = Alignment.Center,
        ) {
            Text("${if (moment.exact) "" else "~"}${clock(moment.at.toInt())}", Modifier.background(e.surface2, RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 4.dp), style = MaterialTheme.typography.labelMedium.merge(AppText.num), color = e.brand)
        }
        Spacer(Modifier.width(8.dp))
    }
}
