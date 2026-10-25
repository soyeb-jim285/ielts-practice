package com.soyeb.ieltspractice.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.R
import com.soyeb.ieltspractice.core.ApiClient
import com.soyeb.ieltspractice.core.Crit
import com.soyeb.ieltspractice.core.ProgressData
import com.soyeb.ieltspractice.core.TrendPoint
import com.soyeb.ieltspractice.core.categoryLabel
import com.soyeb.ieltspractice.core.fmt
import com.soyeb.ieltspractice.ui.LoadContent
import com.soyeb.ieltspractice.ui.ScreenScaffold
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.AttemptResult
import com.soyeb.ieltspractice.ui.nav.Bank
import com.soyeb.ieltspractice.ui.nav.History
import com.soyeb.ieltspractice.ui.nav.LrHub
import com.soyeb.ieltspractice.ui.nav.Mistakes
import com.soyeb.ieltspractice.ui.nav.SpeakingSession
import com.soyeb.ieltspractice.ui.nav.Tab
import com.soyeb.ieltspractice.ui.nav.WritingEditor
import com.soyeb.ieltspractice.ui.rememberLoad
import com.soyeb.ieltspractice.ui.screens.shell.BandBar
import com.soyeb.ieltspractice.ui.screens.shell.DashData
import com.soyeb.ieltspractice.ui.screens.shell.DashProgress
import com.soyeb.ieltspractice.ui.screens.shell.DueResponse
import com.soyeb.ieltspractice.ui.screens.shell.GuestHome
import com.soyeb.ieltspractice.ui.screens.shell.LinkButton
import com.soyeb.ieltspractice.ui.screens.shell.RowDivider
import com.soyeb.ieltspractice.ui.screens.shell.greeting
import com.soyeb.ieltspractice.ui.screens.shell.minutesLabel
import com.soyeb.ieltspractice.ui.screens.shell.nextUp
import com.soyeb.ieltspractice.ui.screens.shell.streakLabel
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.PrimaryButton
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.SectionTitle
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import java.time.LocalTime
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.PrimaryScrollableTabRow
import androidx.compose.material3.Tab as TabItem
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.sp
import com.soyeb.ieltspractice.LocalDemo
import com.soyeb.ieltspractice.core.LrAttempt
import com.soyeb.ieltspractice.core.LrProgress
import com.soyeb.ieltspractice.core.Mock
import com.soyeb.ieltspractice.core.MockFlow
import com.soyeb.ieltspractice.core.QuotaCopy
import com.soyeb.ieltspractice.core.mockCurrent
import com.soyeb.ieltspractice.core.mockList
import com.soyeb.ieltspractice.ui.community.rememberQuota
import com.soyeb.ieltspractice.ui.nav.LrRun
import com.soyeb.ieltspractice.ui.nav.MockHub
import com.soyeb.ieltspractice.ui.nav.MockStart
import com.soyeb.ieltspractice.ui.screens.shell.ShellDate
import com.soyeb.ieltspractice.ui.screens.shell.averageBand
import com.soyeb.ieltspractice.ui.screens.shell.changeLabel
import com.soyeb.ieltspractice.ui.screens.shell.changeSinceFirst
import com.soyeb.ieltspractice.ui.screens.shell.overallEstimate
import com.soyeb.ieltspractice.ui.screens.shell.weakestSkill
import com.soyeb.ieltspractice.ui.theme.bandColor
import com.soyeb.ieltspractice.ui.theme.bandTextColor
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

// Mirrors: iOS Views/DashboardView.swift (+ GuestDashboardView.swift), web routes/_app/index.tsx, components/dashboard/*

/** Home tab: the dashboard for a signed-in user, the product intro for a guest. */
@Composable
fun DashboardScreen(nav: AppNav) {
    val api = LocalApp.current.api
    val ready by api.ready.collectAsState()
    val account by api.hasAccount.collectAsState()
    when {
        !ready -> ScreenScaffold("Home", large = true) {} // the stored token is still being read: no guest flash
        !account -> GuestHome(nav) // no session, or a guest session (no account yet)
        else -> SignedInHome(nav)
    }
}

private suspend fun loadDash(api: ApiClient): DashData = coroutineScope {
    val p = async { api.get<DashProgress>("/api/progress") }
    val due = async { runCatching { api.get<DueResponse>("/api/cards/due") }.getOrNull() }
    val trends = listOf("speaking", "writing").map { s ->
        s to async { runCatching { api.get<ProgressData>("/api/progress", mapOf("skill" to s)).trend }.getOrNull() }
    }
    val lr = async { runCatching { api.get<LrProgress>("/api/lr/progress") }.getOrNull() }
    val mock = async { runCatching { api.mockCurrent() }.getOrNull() }
    val mocks = async { runCatching { api.mockList() }.getOrNull() }
    DashData(p.await(), due.await(), trends.associate { (s, d) -> s to (d.await() ?: emptyList()) }, lr.await(), mock.await(), mocks.await()?.firstOrNull { it.overall != null })
}

@Composable
private fun SignedInHome(nav: AppNav) {
    val api = LocalApp.current.api
    val me by api.me.collectAsState()
    val data = rememberLoad { loadDash(api) }
    val first = me?.user?.name?.trim()?.substringBefore(' ')?.takeIf { it.isNotEmpty() }
    ScreenScaffold(greeting(LocalTime.now().hour) + (first?.let { ", $it" } ?: ""), large = true) {
        LoadContent(data) { d -> Dashboard(d, me?.settings?.targetBand ?: 7.0, me?.live == true, nav) }
    }
}

private val SKILLS = listOf("listening", "reading", "writing", "speaking")

/** Per-skill average of the last up-to-5 results: speaking and writing from their trends (or the server's prediction), listening and reading from the LR trend. */
private fun skillBands(d: DashData) = SKILLS.associateWith { k ->
    when (k) {
        "speaking", "writing" -> {
            val avg = averageBand(d.trends[k].orEmpty().map { it.overall })
            avg.copy(band = (if (k == "speaking") d.progress.predicted.speaking else d.progress.predicted.writing) ?: avg.band)
        }
        else -> averageBand(d.lr?.trend.orEmpty().filter { it.skill == k }.map { it.band })
    }
}

/** One band over time for the progress charts. */
private class BandPoint(val date: String, val band: Double)

private fun skillPoints(d: DashData, k: String): List<BandPoint> =
    if (k == "speaking" || k == "writing") d.trends[k].orEmpty().map { BandPoint(it.date, it.overall) }
    else d.lr?.trend.orEmpty().filter { it.skill == k }.map { BandPoint(it.date, it.band) }

@Composable
private fun Dashboard(d: DashData, target: Double, liveReady: Boolean, nav: AppNav) {
    val e = MaterialTheme.ext
    val p = d.progress
    Header(p)
    p.lastFailed?.let { f ->
        Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp), color = e.warn.copy(alpha = 0.12f)) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                    Icon(Icons.Filled.Warning, null, Modifier.size(20.dp).padding(top = 2.dp), tint = e.warn)
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("Your last attempt couldn't be scored", style = MaterialTheme.typography.titleMedium, color = e.ink)
                        Text("Your answer is saved. Open it to retry the analysis.", style = MaterialTheme.typography.bodyMedium, color = e.muted)
                    }
                }
                SecondaryButton("Open it", { nav.go(AttemptResult.of(f.id)) })
            }
        }
    }
    YourPicture(d, target, nav)
    if (p.attempts == 0) Onboarding(nav, target) else NextUpCard(d, target, nav)
    MockPanel(d.mock, d.lastMock, continuedAbove = p.attempts > 0, nav)
    PractiseList(liveReady, nav)
    val hasProgress = p.trend.isNotEmpty() || d.trends.values.any { it.isNotEmpty() } || d.lr?.trend?.isNotEmpty() == true
    if (hasProgress) ProgressTabs(d, target, nav)
    if (p.topMistakes.isNotEmpty()) FixNext(p.topMistakes, nav)
}

@Composable
private fun Header(p: DashProgress) {
    val e = MaterialTheme.ext
    if (p.attempts > 0) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(painterResource(R.drawable.ic_flame), null, Modifier.size(18.dp), tint = if (p.streak > 0) e.warnText else e.muted)
                Text(streakLabel(p.streak), style = MaterialTheme.typography.bodyMedium, color = if (p.streak > 0) e.warnText else e.muted)
            }
            Text(minutesLabel(p.minutesThisWeek), style = MaterialTheme.typography.bodyMedium, color = e.muted)
        }
    } else {
        Text("Welcome. Here is how to get your first score.", style = MaterialTheme.typography.bodyMedium, color = e.muted)
    }
}

// ---- Your IELTS picture (web components/dashboard/YourPicture.tsx, result/SkillBandStrip.tsx) ----

private val SKILL_ICON = mapOf("listening" to R.drawable.ic_sp_headphones, "reading" to R.drawable.ic_lr_book, "writing" to R.drawable.ic_edit, "speaking" to R.drawable.ic_mic)

private fun openSkill(nav: AppNav, k: String) = when (k) {
    "speaking" -> nav.openTab(Tab.Speaking)
    "writing" -> nav.openTab(Tab.Writing)
    else -> nav.go(LrHub(k))
}

/** The focal block: the overall band estimate, then the four skills as equal peers. */
@Composable
private fun YourPicture(d: DashData, target: Double, nav: AppNav) {
    val e = MaterialTheme.ext
    val bands = skillBands(d)
    val (value, count) = overallEstimate(SKILLS.map { bands.getValue(it).band })
    val weak = weakestSkill(SKILLS.map { bands.getValue(it).band })
    SectionTitle("Your IELTS picture")
    AppCard(padding = 20.dp) {
        Column(Modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Overall band estimate", style = MaterialTheme.typography.bodySmall, color = e.muted)
            if (value != null) {
                Text(fmt(value), style = AppText.band(56), color = e.ink)
                val gap = target - value
                Text(
                    buildAnnotatedString {
                        withStyle(SpanStyle(color = bandTextColor(value, target), fontWeight = FontWeight.Medium)) { append(if (gap <= 0) "At or above" else "${fmt(gap)} below") }
                        append(" your ${fmt(target)} target")
                    },
                    style = MaterialTheme.typography.bodyLarge, color = e.ink,
                )
                Text("From $count of 4 skills, average of your last results", style = MaterialTheme.typography.bodySmall, color = e.muted)
            } else {
                Text("–", style = AppText.band(56), color = e.muted)
                Text("Take two skills to see an overall estimate. Your target is ${fmt(target)}.", style = MaterialTheme.typography.bodyMedium, color = e.muted)
            }
        }
        HorizontalDivider(Modifier.padding(vertical = 8.dp), color = e.line)
        SKILLS.chunked(2).forEachIndexed { row, pair ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                pair.forEachIndexed { col, k ->
                    val b = bands.getValue(k)
                    val offer = if (b.band == null) (if (k == "listening" || k == "reading") "Take a free test" else "Take a test") else null
                    SkillCell(k, b.band, b.n, target, weak == row * 2 + col, offer, Modifier.weight(1f)) { openSkill(nav, k) }
                }
            }
        }
    }
}

@Composable
private fun SkillCell(k: String, band: Double?, n: Int, target: Double, weakest: Boolean, offer: String?, modifier: Modifier, onClick: () -> Unit) {
    val e = MaterialTheme.ext
    val name = MockFlow.name(k)
    val caption = offer ?: if (band != null) (if (n > 1) "average of last $n" else "latest") else null
    Column(
        modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button, onClick = onClick).padding(vertical = 8.dp)
            .clearAndSetSemantics {
                contentDescription = "$name: ${band?.let { "band ${fmt(it)}, target ${fmt(target)}" } ?: "not tried"}${if (weakest) ", weakest skill" else ""}${caption?.let { ", $it" }.orEmpty()}"
            },
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(painterResource(SKILL_ICON.getValue(k)), null, Modifier.size(16.dp), tint = e.muted)
            Text(name, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = e.muted)
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, Modifier.size(16.dp), tint = e.muted)
        }
        if (band != null) {
            Text(fmt(band), style = AppText.band(30), color = e.ink)
            BandBar(band / 9, "$name band", marker = target / 9, fill = bandColor(band, target), height = 6.dp)
        } else Text("Not tried", Modifier.heightIn(min = 30.dp), style = MaterialTheme.typography.bodyLarge, color = e.muted)
        if (weakest) Text("Weakest skill", style = MaterialTheme.typography.bodySmall, color = e.warnText, fontWeight = FontWeight.Medium)
        caption?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = if (offer != null) e.brand else e.muted) }
    }
}

// ---- Next up (web components/dashboard/NextUp.tsx) ----

@Composable
private fun NextUpCard(d: DashData, target: Double, nav: AppNav) {
    val e = MaterialTheme.ext
    val api = LocalApp.current.api
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    val suggested = d.lr?.suggested
    val n = nextUp(d.progress, target, d.mock, suggested)
    SectionTitle("Next up")
    HeroPanel {
        Text(n.title, style = MaterialTheme.typography.titleLarge, color = e.ink)
        Text(n.body, Modifier.semantics { n.a11y?.let { contentDescription = it } }, style = MaterialTheme.typography.bodyLarge, color = e.muted)
        PrimaryButton("${n.cta}  →", {
            when {
                n.route == "mock" -> d.mock?.let { nav.go(MockHub(it.id)) }
                n.route == "lr" && suggested != null -> {
                    busy = true
                    scope.launch {
                        try {
                            val a = api.send<LrAttempt>("POST", "/api/lr/tests/${suggested.id}/attempts", buildJsonObject { put("mode", JsonPrimitive("practice")) })
                            nav.go(LrRun(a.id))
                        } catch (x: kotlinx.coroutines.CancellationException) { throw x } catch (_: Exception) {}
                        busy = false
                    }
                }
                n.route == "speaking-full" -> nav.go(SpeakingSession("full"))
                n.route.startsWith("speaking-") -> nav.go(SpeakingSession("part", n.route.removePrefix("speaking-").toInt()))
                n.route == "writing-1" -> nav.go(WritingEditor("task1", "academic"))
                else -> nav.go(WritingEditor("task2"))
            }
        }, Modifier.fillMaxWidth(), loading = busy)
        val due = d.due?.dueTotal ?: 0
        if (due > 0) LinkButton("Review deck, $due ${if (due == 1) "card" else "cards"} due", { nav.openTab(Tab.Review) }, Modifier.offset(x = (-12).dp))
    }
}

// ---- Full mock test (web components/dashboard/MockPanel.tsx) ----

private val MOCK_DURATION = mapOf("listening" to "30 min plus review", "reading" to "60 min", "writing" to "60 min", "speaking" to "11-14 min")

/** What a mock is, the four steps in sitting order (state as an icon plus a word, never colour alone), one outline button, the last result. */
@Composable
private fun MockPanel(open: Mock?, last: Mock?, continuedAbove: Boolean, nav: AppNav) {
    val e = MaterialTheme.ext
    SectionTitle("Full mock test")
    AppCard {
        // Next up already offers "Continue your mock test", so an open mock shows only its steps here
        if (!(open != null && continuedAbove)) {
            Text(
                if (open != null) "Continue: ${MockFlow.continueLine(open)}" else "Listening, Reading, Writing and Speaking in one sitting, with an overall band.",
                style = MaterialTheme.typography.bodyMedium, color = e.ink,
            )
            SecondaryButton(if (open != null) "Continue  →" else "Start a mock test  →", { if (open != null) nav.go(MockHub(open.id)) else nav.go(MockStart) }, Modifier.fillMaxWidth())
        }
        MockFlow.skills.chunked(2).forEach { pair ->
            Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                pair.forEach { k ->
                    val s = open?.section(k)
                    val step = when {
                        open == null -> "todo"
                        s != null && MockFlow.isFinished(s.state) -> "done"
                        open.next == k -> "next"
                        else -> "todo"
                    }
                    val word = when (step) { "done" -> "Done"; "next" -> "Next"; else -> "To do" }
                    Column(Modifier.weight(1f).semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            StepMark(step)
                            Text(MockFlow.name(k), style = MaterialTheme.typography.titleSmall, color = if (step == "next") e.brand else e.ink)
                            if (open != null) Text(word, style = MaterialTheme.typography.bodySmall, color = e.muted)
                        }
                        Text(MOCK_DURATION.getValue(k), Modifier.padding(start = 24.dp), style = MaterialTheme.typography.bodySmall, color = e.muted)
                    }
                }
            }
        }
        last?.overall?.let { band ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Last mock: ", style = MaterialTheme.typography.bodySmall.merge(AppText.num), color = e.muted)
                LinkButton("${fmt(band)} on ${ShellDate.date(last.completedAt ?: last.startedAt)}", { nav.go(MockHub(last.id)) })
            }
        }
    }
}

@Composable
private fun StepMark(step: String) {
    val e = MaterialTheme.ext
    when (step) {
        "done" -> Icon(Icons.Filled.Check, null, Modifier.size(16.dp), tint = e.ink)
        "next" -> Box(Modifier.size(16.dp).border(1.5.dp, e.brand, CircleShape), Alignment.Center) { Box(Modifier.size(6.dp).background(e.brand, CircleShape)) }
        else -> Box(Modifier.size(16.dp).border(1.5.dp, e.muted, CircleShape))
    }
}

// ---- Practise (web components/dashboard/PractiseList.tsx) ----

/** Four skills, equal weight, one row each (bands live in the picture above). One quiet line of the other places to go. */
@Composable
private fun PractiseList(liveReady: Boolean, nav: AppNav) {
    val q = rememberQuota()
    SectionTitle("Practise")
    AppCard {
        Column {
            PractiseRow("Listening", null, "Free practice tests, 40 questions, or one part at a time", R.drawable.ic_sp_headphones) { nav.go(LrHub("listening")) }
            RowDivider()
            PractiseRow("Reading", null, "Free practice tests, 40 questions, or one passage", R.drawable.ic_lr_book) { nav.go(LrHub("reading")) }
            RowDivider()
            PractiseRow("Writing", q?.let { QuotaCopy.left(it, "writing") }, "Task 1 and Task 2, feedback by criterion. A Task 2 essay is 40 min, at least 250 words", R.drawable.ic_edit) { nav.openTab(Tab.Writing) }
            RowDivider()
            PractiseRow(
                "Speaking", q?.let { QuotaCopy.left(it, "speaking") },
                "Full test 11-14 min, or one part. Live examiner: ${if (liveReady) "a spoken conversation with an AI examiner" else "not available right now"}", R.drawable.ic_mic,
            ) { nav.openTab(Tab.Speaking) }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FooterLink("Prompt bank", R.drawable.ic_books) { nav.go(Bank("")) }
            FooterLink("Mistakes", R.drawable.ic_alert) { nav.go(Mistakes()) }
            FooterLink("Review deck", R.drawable.ic_review) { nav.openTab(Tab.Review) }
            FooterLink("All attempts", R.drawable.ic_history) { nav.go(History()) }
        }
    }
}

/** A row with the tests left next to the title ("2 tests left today"; amber when none are left). */
@Composable
private fun PractiseRow(title: String, left: String?, meta: String, icon: Int, onClick: () -> Unit) {
    val e = MaterialTheme.ext
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(role = Role.Button, onClick = onClick).padding(vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(painterResource(icon), null, Modifier.size(24.dp), tint = e.muted)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.Center) {
                Text(title, style = MaterialTheme.typography.bodyLarge, color = e.ink)
                if (left != null) Text(
                    left, Modifier.align(Alignment.CenterVertically), style = MaterialTheme.typography.bodySmall.merge(AppText.num),
                    color = if (left.startsWith("No tests left")) e.warnText else e.muted,
                )
            }
            Text(meta, style = MaterialTheme.typography.bodySmall, color = e.muted)
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = e.muted)
    }
}

// ---- Progress (web components/dashboard/ProgressTabs.tsx, BandTrend.tsx, LrInsights.tsx) ----

private val PROGRESS_TABS = listOf("overall" to "Overall", "listening" to "Listening", "reading" to "Reading", "writing" to "Writing", "speaking" to "Speaking")

/** One Progress section, five tabs: the skills side by side, then each skill's trend and what to work on. */
@Composable
private fun ProgressTabs(d: DashData, target: Double, nav: AppNav) {
    val e = MaterialTheme.ext
    val demoLr = LocalDemo.current?.tab == "LR"
    var tab by remember { mutableStateOf(if (demoLr) "listening" else "overall") }
    val req = remember { BringIntoViewRequester() }
    // screenshots: the `LR` demo tab scrolls to Listening progress
    if (demoLr) LaunchedEffect(Unit) { kotlinx.coroutines.delay(500); runCatching { req.bringIntoView() } }
    Column(Modifier.bringIntoViewRequester(req), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionTitle("Progress")
        val i = PROGRESS_TABS.indexOfFirst { it.first == tab }
        PrimaryScrollableTabRow(selectedTabIndex = i, containerColor = e.bg, contentColor = e.brand, edgePadding = 0.dp, divider = { HorizontalDivider(color = e.line) }) {
            PROGRESS_TABS.forEachIndexed { j, (k, label) ->
                TabItem(j == i, { tab = k }, Modifier.heightIn(min = 48.dp), selectedContentColor = e.brand, unselectedContentColor = e.muted) {
                    Text(label, Modifier.padding(vertical = 12.dp), style = MaterialTheme.typography.labelLarge, maxLines = 1)
                }
            }
        }
        when (tab) {
            "overall" -> OverallPanel(d, target)
            "speaking", "writing" -> CriteriaPanel(tab, d.trends[tab].orEmpty(), target)
            else -> LrPanel(tab, d.lr, target, nav)
        }
    }
}

/** Four skill cards, 2 by 2: the latest band, a sparkline against the target, the average and how far you have come. */
@Composable
private fun OverallPanel(d: DashData, target: Double) {
    val e = MaterialTheme.ext
    val bands = skillBands(d)
    SKILLS.chunked(2).forEach { pair ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            pair.forEach { k ->
                val pts = skillPoints(d, k)
                val latest = pts.lastOrNull()?.band
                val name = MockFlow.name(k)
                AppCard(Modifier.weight(1f)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                        Text(name, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, color = e.ink)
                        Text(latest?.let { fmt(it) } ?: "–", style = AppText.band(30), color = e.ink)
                    }
                    if (pts.isEmpty()) Text("No scored ${name.lowercase()} test yet.", style = MaterialTheme.typography.bodySmall, color = e.muted)
                    else {
                        Text(
                            "Average ${bands.getValue(k).band?.let { fmt(it) } ?: "–"} · ${pts.size} ${if (pts.size == 1) "attempt" else "attempts"}",
                            style = MaterialTheme.typography.bodySmall.merge(AppText.num), color = e.muted,
                        )
                        if (pts.size > 1) BandTrend(pts, target, "$name band over ${pts.size} attempts, latest ${fmt(latest ?: 0.0)}, target ${fmt(target)}", chartHeight = 48.dp, compact = true)
                        else BandBar((latest ?: 0.0) / 9, "$name band ${fmt(latest ?: 0.0)} of 9", marker = target / 9, fill = bandColor(latest ?: 0.0, target), height = 6.dp)
                        ChangeText(pts.map { it.band })
                    }
                }
            }
        }
    }
}

/** "+1.0 since your first" in the status tone, or "Same as your first"; nothing with one attempt. */
@Composable
private fun ChangeText(bands: List<Double>) {
    val e = MaterialTheme.ext
    val label = changeLabel(bands) ?: return
    val dv = changeSinceFirst(bands) ?: 0.0
    Text(label, style = MaterialTheme.typography.bodySmall.merge(AppText.num), color = if (dv > 0) e.goodText else if (dv < 0) e.badText else e.muted)
}

/** Small multiples, one per criterion, on a shared band scale (four lines on one chart overlap). Under three attempts: the latest bands. */
@Composable
private fun CriteriaPanel(skill: String, rows: List<TrendPoint>, target: Double) {
    val e = MaterialTheme.ext
    val keys = Crit.order(skill)
    when {
        rows.isEmpty() -> Text("Your $skill criteria appear after your first scored attempt.", style = MaterialTheme.typography.bodyLarge, color = e.muted)
        rows.size < 3 -> AppCard {
            Text("Band by criterion", Modifier.semantics { heading() }, style = MaterialTheme.typography.titleSmall, color = e.ink)
            Text(
                "From your latest $skill attempt; the marker is your ${fmt(target)} target. Each criterion's trend appears after three scored attempts.",
                style = MaterialTheme.typography.bodySmall, color = e.muted,
            )
            val latest = rows.last().criteria
            keys.forEach { k ->
                Column(
                    Modifier.padding(top = 4.dp).clearAndSetSemantics { contentDescription = "${Crit.label(k)} band ${latest[k]?.let { fmt(it) } ?: "none"} of 9" },
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(Crit.label(k), style = MaterialTheme.typography.bodyMedium, color = e.ink)
                        Text(latest[k]?.let { fmt(it) } ?: "–", style = AppText.band(24), color = e.ink)
                    }
                    BandBar((latest[k] ?: 0.0) / 9, Crit.label(k), marker = target / 9, fill = bandColor(latest[k] ?: 0.0, target), height = 6.dp)
                }
            }
        }
        else -> {
            Text("Band by criterion", Modifier.semantics { heading() }, style = MaterialTheme.typography.titleSmall, color = e.ink)
            Text(
                "Your last ${rows.size} $skill attempts, oldest on the left. The dashed line is your ${fmt(target)} target.",
                style = MaterialTheme.typography.bodySmall, color = e.muted,
            )
            val all = rows.flatMap { r -> keys.mapNotNull { r.criteria[it] } }
            val lo = maxOf(0.0, Math.floor(minOf(all.minOrNull() ?: target, target)) - 1)
            keys.forEach { k ->
                val pts = rows.mapNotNull { r -> r.criteria[k]?.let { BandPoint(r.date, it) } }
                val latest = rows.last().criteria[k]
                AppCard {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(Crit.label(k), style = MaterialTheme.typography.titleSmall, color = e.ink)
                            ChangeText(pts.map { it.band })
                        }
                        Text(latest?.let { fmt(it) } ?: "–", style = AppText.band(30), color = e.ink)
                    }
                    BandTrend(pts, target, "${Crit.label(k)} over ${pts.size} $skill attempts, latest ${latest?.let { fmt(it) } ?: "none"}, target ${fmt(target)}", lo = lo, chartHeight = 120.dp)
                }
            }
        }
    }
}

/** Listening or Reading: the band over attempts, accuracy on your weakest question types of this skill, and one test to practise them on. */
@Composable
private fun LrPanel(skill: String, lr: LrProgress?, target: Double, nav: AppNav) {
    val e = MaterialTheme.ext
    val api = LocalApp.current.api
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    val name = MockFlow.name(skill)
    val rows = lr?.trend.orEmpty().filter { it.skill == skill }
    val last = rows.lastOrNull()
    AppCard {
        if (last != null) {
            Text("$name, latest of ${rows.size}", style = MaterialTheme.typography.bodySmall.merge(AppText.num), color = e.muted)
            Text(fmt(last.band), style = AppText.band(30), color = e.ink)
            changeSinceFirst(rows.map { it.band })?.let { dv ->
                Text(if (dv == 0.0) "Same as your first" else "${if (dv > 0) "Up" else "Down"} ${fmt(kotlin.math.abs(dv))} from your first", style = MaterialTheme.typography.bodyMedium.merge(AppText.num), color = e.ink)
            }
            if (rows.size > 1) BandTrend(rows.map { BandPoint(it.date, it.band) }, target, "$name band over ${rows.size} attempts, latest ${fmt(last.band)}, target ${fmt(target)}", chartHeight = 150.dp)
        } else Text("Your $name band trend appears after your first scored whole test.", style = MaterialTheme.typography.bodyLarge, color = e.muted)
    }
    val weakest = lr?.weakest.orEmpty().filter { it.skill == skill }
    AppCard {
        Text("Weakest question types", Modifier.semantics { heading() }, style = MaterialTheme.typography.titleSmall, color = e.ink)
        if (weakest.isEmpty()) Text("Your weak spots appear after a few more answered questions.", style = MaterialTheme.typography.bodyMedium, color = e.muted)
        weakest.forEach { w ->
            val r = if (w.total > 0) w.right.toDouble() / w.total else 0.0
            Column(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(w.label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = e.ink)
                    Text("${Math.round(r * 100)}%", style = MaterialTheme.typography.titleSmall.merge(AppText.num), color = if (r < 0.5) e.badText else e.warnText)
                }
                BandBar(r, "${w.label}: ${w.right} of ${w.total} correct", fill = if (r >= 0.75) e.good else if (r >= 0.5) e.warn else e.bad, height = 6.dp)
            }
        }
        lr?.suggested?.takeIf { it.skill == skill }?.let { sg ->
            Text("Suggested next test", Modifier.padding(top = 8.dp), style = MaterialTheme.typography.bodySmall, color = e.muted)
            Text("${sg.title} has ${sg.count} ${sg.label.lowercase()} questions", style = MaterialTheme.typography.bodyLarge, color = e.ink)
            PrimaryButton("Practise", {
                busy = true
                scope.launch {
                    try {
                        val a = api.send<LrAttempt>("POST", "/api/lr/tests/${sg.id}/attempts", buildJsonObject { put("mode", JsonPrimitive("practice")) })
                        nav.go(LrRun(a.id))
                    } catch (x: kotlinx.coroutines.CancellationException) { throw x } catch (_: Exception) {}
                    busy = false
                }
            }, Modifier.fillMaxWidth(), loading = busy)
        }
    }
}

private val SHORT_DATE = java.time.format.DateTimeFormatter.ofPattern("d MMM", java.util.Locale.ENGLISH)

/**
 * One band over time (web BandTrend): a 2dp line with an end marker, whole-band gridlines, the target as a dashed rule labelled at its end,
 * first and last dates. [lo] is shared by small multiples so their heights compare; [compact] drops the axes for a sparkline in a card.
 */
@Composable
private fun BandTrend(points: List<BandPoint>, target: Double, label: String, modifier: Modifier = Modifier, lo: Double? = null, chartHeight: androidx.compose.ui.unit.Dp = 140.dp, compact: Boolean = false) {
    val e = MaterialTheme.ext
    val measurer = rememberTextMeasurer()
    val style = MaterialTheme.typography.bodySmall.merge(AppText.num).copy(color = e.muted, fontSize = 11.sp, lineHeight = 14.sp)
    val min = lo ?: maxOf(0.0, Math.floor(minOf(points.minOfOrNull { it.band } ?: target, target)) - 1)
    val dates = points.firstOrNull()?.let { f -> listOfNotNull(f.date, points.last().date.takeIf { points.size > 1 }).map { d -> ShellDate.parse(d)?.let { SHORT_DATE.format(it.atZone(java.time.ZoneId.systemDefault())) } ?: d.take(10) } }.orEmpty()
    Canvas(modifier.fillMaxWidth().height(chartHeight).semantics { contentDescription = label }) {
        val l = if (compact) 6.dp.toPx() else 26.dp.toPx()
        val r = if (compact) 6.dp.toPx() else 56.dp.toPx()
        val t = if (compact) 6.dp.toPx() else 10.dp.toPx()
        val b = if (compact) 6.dp.toPx() else 24.dp.toPx()
        val iw = size.width - l - r
        val ih = size.height - t - b
        val n = points.size
        fun x(i: Int) = l + if (n > 1) i * iw / (n - 1) else iw / 2
        fun y(v: Double) = t + (1 - ((v.coerceIn(min, 9.0) - min) / (9 - min).coerceAtLeast(0.5))).toFloat() * ih
        if (!compact) for (k in Math.ceil(min).toInt()..9) {
            drawLine(e.line, Offset(l, y(k.toDouble())), Offset(l + iw, y(k.toDouble())), 1.dp.toPx())
            val m = measurer.measure("$k", style)
            drawText(m, topLeft = Offset(l - 8.dp.toPx() - m.size.width, y(k.toDouble()) - m.size.height / 2f))
        }
        drawLine(e.muted, Offset(l, y(target)), Offset(l + iw, y(target)), 1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 4.dp.toPx())))
        if (!compact) {
            val m = measurer.measure("Target ${fmt(target)}", style)
            drawText(m, topLeft = Offset(l + iw + 6.dp.toPx(), y(target) - m.size.height / 2f))
        }
        if (n > 1) {
            val path = Path()
            points.forEachIndexed { i, p -> if (i == 0) path.moveTo(x(i), y(p.band)) else path.lineTo(x(i), y(p.band)) }
            drawPath(path, e.brand, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
        points.forEachIndexed { i, p ->
            val end = i == n - 1
            if (end || (!compact && n <= 12)) {
                if (end) drawCircle(e.surface, 6.dp.toPx(), Offset(x(i), y(p.band)))
                drawCircle(e.brand, if (end) 4.dp.toPx() else 2.5.dp.toPx(), Offset(x(i), y(p.band)))
            }
        }
        if (!compact && dates.isNotEmpty()) {
            val first = measurer.measure(dates[0], style)
            drawText(first, topLeft = Offset(if (n > 1) x(0) else x(0) - first.size.width / 2f, size.height - first.size.height))
            dates.getOrNull(1)?.let { s ->
                val m = measurer.measure(s, style)
                drawText(m, topLeft = Offset(x(n - 1) - m.size.width, size.height - m.size.height))
            }
        }
    }
}

// ---- Fix next (web components/dashboard/FixNext.tsx) ----

/** What you keep getting wrong: the top mistake categories of the last 30 days, then the error log. */
@Composable
private fun FixNext(m: List<com.soyeb.ieltspractice.core.CategoryCount>, nav: AppNav) {
    val e = MaterialTheme.ext
    val most = (m.maxOfOrNull { it.count } ?: 1).coerceAtLeast(1).toDouble()
    SectionTitle("Fix next")
    Text("Recurring mistakes, last 30 days", style = MaterialTheme.typography.bodyMedium, color = e.muted)
    AppCard {
        m.forEachIndexed { i, c ->
            if (i > 0) RowDivider()
            Column(
                Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button) { nav.go(Mistakes(c.category)) }.padding(vertical = 8.dp)
                    .clearAndSetSemantics { contentDescription = "${categoryLabel(c.category)}: ${c.count}" },
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
                    Text(categoryLabel(c.category), Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge, color = e.ink)
                    Text("${c.count}", style = MaterialTheme.typography.bodyMedium.merge(AppText.num), color = e.muted)
                }
                BandBar(c.count / most, categoryLabel(c.category), fill = e.muted, height = 4.dp)
            }
        }
        LinkButton("Open error log  →", { nav.go(Mistakes()) }, Modifier.offset(x = (-12).dp))
    }
}

/** The big soft-teal panel (iOS: brandSoft, 20pt corners). */
@Composable
private fun HeroPanel(content: @Composable ColumnScope.() -> Unit) {
    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), color = MaterialTheme.ext.brandSoft) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
    }
}

@Composable
private fun Onboarding(nav: AppNav, target: Double) {
    val e = MaterialTheme.ext
    val api = LocalApp.current.api
    val scope = rememberCoroutineScope()
    var draft by remember { mutableStateOf(target) }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionTitle("Get your first band")
        Text(
            "Answer once and every criterion is scored against the public IELTS band descriptors, with each mistake marked where you made it.",
            style = MaterialTheme.typography.bodyMedium, color = e.muted,
        )
    }
    HeroPanel {
        Icon(painterResource(R.drawable.ic_mic), null, Modifier.size(24.dp), tint = e.brand)
        Text("Speak for four minutes", style = MaterialTheme.typography.titleLarge, color = e.ink)
        Text(
            "Part 1 is everyday questions. You get fluency, vocabulary, grammar and pronunciation feedback, with your pauses timed.",
            style = MaterialTheme.typography.bodyMedium, color = e.muted,
        )
        PrimaryButton("Start Speaking Part 1", { nav.go(SpeakingSession("part", 1)) }, Modifier.fillMaxWidth())
    }
    AppCard(padding = 20.dp) {
        Icon(painterResource(R.drawable.ic_edit), null, Modifier.size(24.dp), tint = e.muted)
        Text("Or write an essay", style = MaterialTheme.typography.titleLarge, color = e.ink)
        Text("Task 2, 40 minutes, at least 250 words. Every mistake is underlined in your text with a correction.", style = MaterialTheme.typography.bodyMedium, color = e.muted)
        SecondaryButton("Start Writing Task 2", { nav.go(WritingEditor("task2")) }, Modifier.fillMaxWidth())
    }
    AppCard {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Target band", style = MaterialTheme.typography.titleSmall, color = e.ink)
            Text(fmt(draft), style = MaterialTheme.typography.titleLarge, color = e.ink)
        }
        TargetSlider(draft, { draft = it }) {
            val s = api.me.value?.settings
            if (s != null && s.targetBand != draft) scope.launch { runCatching { api.saveSettings(s.copy(targetBand = draft)) } }
        }
        Text("Scores at or above your target band show green. You can change it any time in Settings.", style = MaterialTheme.typography.bodySmall, color = e.muted)
    }
}

/** The 4 to 9 target slider in half-band steps (shared with Settings). */
@Composable
fun TargetSlider(value: Double, onChange: (Double) -> Unit, modifier: Modifier = Modifier, onFinished: () -> Unit) {
    val e = MaterialTheme.ext
    Slider(
        value.toFloat(), { onChange(it.toDouble()) }, modifier.semantics { contentDescription = "Target band"; stateDescription = fmt(value) },
        valueRange = 4f..9f, steps = 9, onValueChangeFinished = onFinished,
        colors = SliderDefaults.colors(
            thumbColor = e.brand, activeTrackColor = e.brand, inactiveTrackColor = e.surface2,
            activeTickColor = e.onBrand, inactiveTickColor = e.muted,
        ),
    )
}

@Composable
private fun FooterLink(text: String, icon: Int, onClick: () -> Unit) {
    val e = MaterialTheme.ext
    Row(
        Modifier.heightIn(min = 48.dp).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(painterResource(icon), null, Modifier.size(18.dp), tint = e.brand)
        Text(text, style = MaterialTheme.typography.labelLarge, color = e.brand, maxLines = 1)
    }
}

