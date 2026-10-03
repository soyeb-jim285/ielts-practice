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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
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
import com.soyeb.ieltspractice.core.LrMark
import com.soyeb.ieltspractice.core.accuracyBy
import com.soyeb.ieltspractice.core.flat
import com.soyeb.ieltspractice.core.fmt
import com.soyeb.ieltspractice.core.typeLabel
import com.soyeb.ieltspractice.ui.Load
import com.soyeb.ieltspractice.ui.ScreenScaffold
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.LrResult
import com.soyeb.ieltspractice.ui.nav.LrRun
import com.soyeb.ieltspractice.ui.rememberLoad
import com.soyeb.ieltspractice.ui.screens.shell.BandBar
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
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// Mirrors: web components/lr/Results.tsx, routes/_app/lr/result.$attemptId.tsx

@Composable
fun LrResultScreen(route: LrResult, nav: AppNav) {
    val api = LocalApp.current.api
    val load = rememberLoad(route.attemptId) { api.get<LrAttempt>("/api/lr/attempts/${route.attemptId}") }
    when (val s = load.state) {
        Load.Loading -> ScreenScaffold("Result", onBack = nav::back) { Box(Modifier.fillMaxWidth().padding(24.dp), Alignment.Center) { CircularProgressIndicator() } }
        is Load.Failed -> ScreenScaffold("Result", onBack = nav::back) { ErrorLine(s.message); SecondaryButton("Retry", load.reload) }
        is Load.Ready -> ScreenScaffold(s.value.test.title, onBack = nav::back) { Results(s.value, nav) }
    }
}

@Composable
private fun ratioColor(r: Double) = with(MaterialTheme.ext) { if (r >= 0.75) good else if (r >= 0.5) warn else bad }

@Composable
private fun AccuracyBlock(title: String, rows: List<Accuracy>, modifier: Modifier = Modifier) {
    val e = MaterialTheme.ext
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        SectionTitle(title)
        rows.forEach { r ->
            val ratio = if (r.total > 0) r.right.toDouble() / r.total else 0.0
            Column(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row {
                    Text(r.label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = e.ink)
                    Text("${r.right}/${r.total}", style = MaterialTheme.typography.titleSmall.merge(AppText.num), color = e.ink)
                }
                BandBar(ratio, "${r.label}: ${r.right} of ${r.total} correct", fill = ratioColor(ratio), height = 6.dp)
            }
            HorizontalDivider(color = e.line)
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
    val wide = LocalConfiguration.current.screenWidthDp >= 840
    val marks = remember(a) { (a.marks ?: emptyList()).associateBy { it.n } }
    val flat = remember(test) { test.flat() }
    var wrongOnly by remember { mutableStateOf(false) }
    val demoScreen = LocalDemo.current?.screen
    var partIdx by remember { mutableIntStateOf(if (demoScreen == "lr-result-p2") 1 else 0) }
    var active by remember { mutableStateOf<Int?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val reg = remember { QRegistry() }
    val ctx = QCtx(a.responses, {}, a.assets, marks = marks, active = active, reg = reg)
    val section = test.sections[partIdx.coerceIn(0, test.sections.lastIndex)]
    val band = a.band ?: 0.0
    val gap = target - band
    val noun = if (listening) "Part" else "Passage"
    val byPart = test.sections.map { s ->
        val qs = s.groups.flatMap { g -> g.questions.map { marks[it.n] } }
        Accuracy("$noun ${s.part}", qs.count { it?.correct == true }, qs.size)
    }
    val byType = accuracyBy(test, a.marks ?: emptyList()) { typeLabel(it.group) }

    fun jump(n: Int) {
        val f = flat.firstOrNull { it.n == n } ?: return
        partIdx = test.sections.indexOfFirst { it.part == f.part }
        active = n
        scope.launch { delay(200); ctx.reveal(n, false); delay(3000); if (active == n) active = null }
    }
    fun retake() {
        busy = true; error = null
        scope.launch {
            try {
                val r = api.send<LrAttempt>("POST", "/api/lr/tests/${a.testId}/attempts", buildJsonObject { put("mode", a.mode) })
                nav.go(LrRun(r.id))
            } catch (ex: Exception) { error = "Could not start a new attempt. Try again." }
            busy = false
        }
    }

    val time = a.elapsedS.takeIf { it > 0 }?.let { ShellDate.duration(it * 1000) }
    Text(
        "${if (listening) "Listening" else "Reading"}, ${if (test.variant == "academic") "Academic" else "General Training"}, ${a.mode} mode, ${ShellDate.date(a.submittedAt ?: a.startedAt)}${time?.let { ", $it" }.orEmpty()}",
        style = MaterialTheme.typography.bodyMedium, color = e.muted,
    )
    AppCard {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(24.dp), verticalAlignment = Alignment.Bottom) {
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
        PrimaryButton("Retake", ::retake, Modifier.fillMaxWidth(), loading = busy)
        error?.let { ErrorLine(it) }
    }

    if (wide) Row(horizontalArrangement = Arrangement.spacedBy(32.dp)) {
        AccuracyBlock("By ${noun.lowercase()}", byPart, Modifier.weight(1f))
        AccuracyBlock("By question type", byType, Modifier.weight(1f))
    } else {
        AccuracyBlock("By ${noun.lowercase()}", byPart)
        AccuracyBlock("By question type", byType)
    }

    // ---- your answers ----
    SectionTitle("Your answers")
    val wrong = flat.count { marks[it.n]?.correct != true }
    Segmented(listOf("all" to "All ${flat.size}", "wrong" to "Wrong only ($wrong)"), if (wrongOnly) "wrong" else "all", { wrongOnly = it == "wrong" })
    val rows = flat.filter { !wrongOnly || marks[it.n]?.correct != true }
    if (rows.isEmpty()) Text("Nothing wrong. Every answer was correct.", style = MaterialTheme.typography.bodyLarge, color = e.muted)
    else AppCard(padding = 0.dp) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("No.", Modifier.width(44.dp), style = MaterialTheme.typography.labelMedium, color = e.muted)
            Text("Your answer", Modifier.weight(1f), style = MaterialTheme.typography.labelMedium, color = e.muted)
            Text("Correct answer", Modifier.weight(1f), style = MaterialTheme.typography.labelMedium, color = e.muted)
            Spacer(Modifier.width(24.dp))
        }
        rows.forEach { f ->
            HorizontalDivider(color = e.line)
            AnswerRow(f.n, marks[f.n]) { jump(f.n) }
        }
    }

    // ---- in context ----
    SectionTitle(if (listening) "Transcript and questions" else "Passage and questions")
    Text("Tap a number above to jump to that question.", style = MaterialTheme.typography.bodySmall, color = e.muted)
    PrimaryTabRow(test.sections.indexOf(section), containerColor = e.bg, contentColor = e.brand, divider = { HorizontalDivider(color = e.line) }) {
        test.sections.forEachIndexed { i, s ->
            Tab(i == test.sections.indexOf(section), { partIdx = i }, Modifier.heightIn(min = 48.dp), selectedContentColor = e.brand, unselectedContentColor = e.muted) {
                Text("$noun ${s.part}", Modifier.padding(vertical = 12.dp), style = MaterialTheme.typography.labelLarge, maxLines = 1)
            }
        }
    }
    androidx.compose.runtime.key(section.part) {
        if (listening) {
            AppCard { PracticeAudio(a.assets[section.audio.orEmpty()].orEmpty(), "Part ${section.part}") }
            section.transcript?.let { Transcript(it) }
            QuestionsBlock(section, ctx)
        } else if (wide) {
            Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                AppCard(Modifier.weight(1f)) { Column(Modifier.heightIn(max = 640.dp).verticalScroll(rememberScrollState())) { SectionPassage(section) } }
                Column(Modifier.weight(1f).heightIn(max = 640.dp).verticalScroll(rememberScrollState())) { QuestionsBlock(section, ctx) }
            }
        } else {
            AppCard { Column(Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState())) { SectionPassage(section) } }
            QuestionsBlock(section, ctx)
        }
    }
}

@Composable
private fun QuestionsBlock(section: com.soyeb.ieltspractice.core.LrSection, ctx: QCtx) {
    Column(verticalArrangement = Arrangement.spacedBy(28.dp)) {
        section.groups.forEach { QuestionGroup(it, ctx) }
        Spacer(Modifier.size(16.dp))
    }
}

@Composable
private fun Transcript(text: String) {
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
                Text(text, Modifier.padding(16.dp), style = AppText.reading, color = e.ink)
            }
        }
    }
}

@Composable
private fun AnswerRow(n: Int, m: LrMark?, onClick: () -> Unit) {
    val e = MaterialTheme.ext
    val given = m?.given.orEmpty()
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 16.dp)
            .semantics(mergeDescendants = true) {
                contentDescription = "Question $n, ${if (m?.correct == true) "correct" else "wrong"}. Your answer: ${given.ifEmpty { "none" }}. Correct answer: ${m?.answer?.joinToString(" or ").orEmpty()}"
            },
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(44.dp).heightIn(min = 48.dp).clickable(role = Role.Button, onClickLabel = "Show question $n in context", onClick = onClick), contentAlignment = Alignment.CenterStart) {
            Text("$n", style = MaterialTheme.typography.titleSmall.merge(AppText.num), color = e.brand)
        }
        Text(
            given.ifEmpty { "No answer" }, Modifier.weight(1f).padding(vertical = 6.dp), style = MaterialTheme.typography.bodyMedium,
            color = if (m?.correct == true) e.ink else if (given.isEmpty()) e.muted else e.badText, fontStyle = if (given.isEmpty()) FontStyle.Italic else FontStyle.Normal,
        )
        Text(m?.answer?.joinToString(" / ").orEmpty(), Modifier.weight(1f).padding(vertical = 6.dp), style = MaterialTheme.typography.bodyMedium, color = e.ink, fontWeight = FontWeight.Medium)
        if (m?.correct == true) Icon(Icons.Filled.Check, null, Modifier.size(20.dp), tint = e.goodText) else Icon(Icons.Filled.Close, null, Modifier.size(20.dp), tint = e.badText)
    }
}
