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
import com.soyeb.ieltspractice.ui.nav.LiveExam
import com.soyeb.ieltspractice.ui.nav.Mistakes
import com.soyeb.ieltspractice.ui.nav.SpeakingSession
import com.soyeb.ieltspractice.ui.nav.Tab
import com.soyeb.ieltspractice.ui.nav.WritingEditor
import com.soyeb.ieltspractice.ui.rememberLoad
import com.soyeb.ieltspractice.ui.screens.shell.BandBar
import com.soyeb.ieltspractice.ui.screens.shell.BigNumber
import com.soyeb.ieltspractice.ui.screens.shell.DashData
import com.soyeb.ieltspractice.ui.screens.shell.DashProgress
import com.soyeb.ieltspractice.ui.screens.shell.DueResponse
import com.soyeb.ieltspractice.ui.screens.shell.GuestHome
import com.soyeb.ieltspractice.ui.screens.shell.LinkButton
import com.soyeb.ieltspractice.ui.screens.shell.NavRow
import com.soyeb.ieltspractice.ui.screens.shell.RowDivider
import com.soyeb.ieltspractice.ui.screens.shell.Segmented
import com.soyeb.ieltspractice.ui.screens.shell.TrendChart
import com.soyeb.ieltspractice.ui.screens.shell.greeting
import com.soyeb.ieltspractice.ui.screens.shell.minutesLabel
import com.soyeb.ieltspractice.ui.screens.shell.nextUp
import com.soyeb.ieltspractice.ui.screens.shell.reviewMeta
import com.soyeb.ieltspractice.ui.screens.shell.streakLabel
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.Chip
import com.soyeb.ieltspractice.ui.theme.PrimaryButton
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.SectionTitle
import com.soyeb.ieltspractice.ui.community.QuotaSummary
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import java.time.LocalTime

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
    DashData(p.await(), due.await(), trends.associate { (s, d) -> s to (d.await() ?: emptyList()) })
}

@Composable
private fun SignedInHome(nav: AppNav) {
    val api = LocalApp.current.api
    val me by api.me.collectAsState()
    val data = rememberLoad { loadDash(api) }
    val first = me?.user?.name?.trim()?.substringBefore(' ')?.takeIf { it.isNotEmpty() }
    ScreenScaffold(greeting(LocalTime.now().hour) + (first?.let { ", $it" } ?: ""), large = true) {
        LoadContent(data) { d -> Dashboard(d, me?.settings?.targetBand ?: 7.0, nav) }
    }
}

@Composable
private fun Dashboard(d: DashData, target: Double, nav: AppNav) {
    val e = MaterialTheme.ext
    val p = d.progress
    Header(p)
    QuotaSummary(nav)
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
    if (p.attempts == 0) {
        Onboarding(nav, target)
    } else {
        NextUpCard(p, target, nav)
        PredictedCard(p, target, nav)
        TrendCard(d.trends, target)
    }
    PractiseCard(d.due, nav)
    if (p.topMistakes.isNotEmpty()) MistakesCard(p.topMistakes, nav)
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
private fun NextUpCard(p: DashProgress, target: Double, nav: AppNav) {
    val e = MaterialTheme.ext
    val n = nextUp(p, target)
    HeroPanel {
        Text("Next up", style = MaterialTheme.typography.labelLarge, color = e.brand)
        Text(n.title, style = MaterialTheme.typography.titleLarge, color = e.ink)
        Text(n.body, Modifier.semantics { n.a11y?.let { contentDescription = it } }, style = MaterialTheme.typography.bodyMedium, color = e.muted)
        PrimaryButton("${n.cta}  →", {
            nav.go(
                when {
                    n.route == "speaking-full" -> SpeakingSession("full")
                    n.route.startsWith("speaking-") -> SpeakingSession("part", n.route.removePrefix("speaking-").toInt())
                    n.route == "writing-1" -> WritingEditor("task1", "academic")
                    else -> WritingEditor("task2")
                },
            )
        }, Modifier.fillMaxWidth())
    }
}

@Composable
private fun PredictedCard(p: DashProgress, target: Double, nav: AppNav) {
    AppCard {
        PredictedRow("speaking", p.predicted.speaking, p.trend.count { it.skill == "speaking" }, target) { nav.go(SpeakingSession("part", 1)) }
        RowDivider()
        PredictedRow("writing", p.predicted.writing, p.trend.count { it.skill == "writing" }, target) { nav.go(WritingEditor("task2")) }
    }
}

/** One predicted band: label, bar and target on the left, the number on the right. With no scores the row holds the invitation and its action. */
@Composable
private fun PredictedRow(skill: String, band: Double?, n: Int, target: Double, onTry: () -> Unit) {
    val e = MaterialTheme.ext
    if (band == null) {
        Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Predicted $skill band", style = MaterialTheme.typography.bodySmall, color = e.muted)
                Text("No $skill scores yet.", style = MaterialTheme.typography.bodyMedium, color = e.ink)
            }
            SecondaryButton(if (skill == "speaking") "Try Part 1" else "Try Task 2", onTry)
        }
        return
    }
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Predicted $skill band", style = MaterialTheme.typography.bodySmall, color = e.muted)
            BandBar(band / 9, "${skill.replaceFirstChar { it.uppercase() }} band ${fmt(band)} of 9, target ${fmt(target)}", marker = target / 9)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Target ${fmt(target)}", style = MaterialTheme.typography.bodySmall, color = e.muted)
                if (band >= target) Chip("On target", color = e.goodText) else Chip("${fmt(target - band)} to go")
            }
        }
        Column(horizontalAlignment = Alignment.End, modifier = Modifier.clearAndSetSemantics { contentDescription = "${fmt(band)}, ${if (n > 1) "average of last ${minOf(n, 5)}" else "latest score"}" }) {
            BigNumber(fmt(band))
            Text(if (n > 1) "Avg of last ${minOf(n, 5)}" else "Latest score", style = MaterialTheme.typography.bodySmall, color = e.muted)
        }
    }
}

@Composable
private fun TrendCard(trends: Map<String, List<TrendPoint>>, target: Double) {
    val e = MaterialTheme.ext
    // Open on the skill that has a line to show (web: needs three scored attempts).
    val has = { s: String -> (trends[s]?.size ?: 0) >= 3 }
    var skill by remember { mutableStateOf(if (has("speaking") || !has("writing")) "speaking" else "writing") }
    val rows = trends[skill].orEmpty()
    val keys = Crit.order(skill)
    AppCard {
        SectionTitle("Band by criterion")
        Segmented(listOf("speaking" to "Speaking", "writing" to "Writing"), skill, { skill = it })
        when {
            rows.isEmpty() -> Text("Your $skill criteria appear after your first scored attempt.", Modifier.padding(vertical = 12.dp), style = MaterialTheme.typography.bodyMedium, color = e.muted)
            rows.size < 3 -> {
                // A line needs three points to say anything: until then show the latest attempt's bands side by side.
                val latest = rows.last().criteria
                keys.forEach { k ->
                    Column(
                        Modifier.padding(top = 4.dp).clearAndSetSemantics { contentDescription = "${Crit.label(k)} band ${latest[k]?.let { fmt(it) } ?: "none"} of 9" },
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(Crit.label(k), style = MaterialTheme.typography.bodyMedium, color = e.ink)
                            Text(latest[k]?.let { fmt(it) } ?: "–", style = MaterialTheme.typography.titleMedium, color = e.ink)
                        }
                        BandBar((latest[k] ?: 0.0) / 9, Crit.label(k), marker = target / 9)
                    }
                }
                Text(
                    "From your latest $skill attempt; the marker is your ${fmt(target)} target. The trend line appears after three scored attempts.",
                    style = MaterialTheme.typography.bodySmall, color = e.muted,
                )
            }
            else -> TrendChart(rows, keys, target)
        }
    }
}

@Composable
private fun PractiseCard(due: DueResponse?, nav: AppNav) {
    val e = MaterialTheme.ext
    AppCard {
        SectionTitle("Practise")
        Column {
            NavRow("Full speaking test", "11-14 min, all three parts", { nav.go(SpeakingSession("full")) }, icon = R.drawable.ic_mic)
            RowDivider()
            NavRow("Live examiner", "A spoken conversation with an AI examiner", { nav.go(LiveExam) }, icon = R.drawable.ic_chat)
            RowDivider()
            NavRow("Task 2 essay", "40 min, at least 250 words", { nav.go(WritingEditor("task2")) }, icon = R.drawable.ic_edit)
            RowDivider()
            if (LocalApp.current.api.me.collectAsState().value?.cambridgeAccess == true) { // Listening and Reading: Cambridge-allow-listed accounts only
                NavRow("Listening", "Four recordings, 40 questions", { nav.go(LrHub("listening")) }, icon = R.drawable.ic_sp_headphones)
                RowDivider()
                NavRow("Reading", "Three passages, 60 minutes", { nav.go(LrHub("reading")) }, icon = R.drawable.ic_lr_book)
                RowDivider()
            }
            NavRow(
                "Review deck", reviewMeta(due), { nav.openTab(Tab.Review) }, icon = R.drawable.ic_review,
                badge = due?.dueTotal?.takeIf { it > 0 }?.let { "$it due" },
            )
            RowDivider()
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FooterLink("Prompt bank", R.drawable.ic_books) { nav.go(Bank("")) }
            FooterLink("Past attempts", R.drawable.ic_history) { nav.go(History()) }
            FooterLink("Mistakes", R.drawable.ic_alert) { nav.go(Mistakes()) }
        }
    }
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

@Composable
private fun MistakesCard(m: List<com.soyeb.ieltspractice.core.CategoryCount>, nav: AppNav) {
    val e = MaterialTheme.ext
    val most = (m.maxOfOrNull { it.count } ?: 1).coerceAtLeast(1).toDouble()
    AppCard {
        SectionTitle("Recurring mistakes")
        Text("Last 30 days", style = MaterialTheme.typography.bodySmall, color = e.muted)
        m.forEach { c ->
            Column(
                Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button) { nav.go(Mistakes(c.category)) }.padding(vertical = 8.dp)
                    .clearAndSetSemantics { contentDescription = "${categoryLabel(c.category)}: ${c.count}" },
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
                    Text(categoryLabel(c.category), Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge, color = e.ink)
                    Text("${c.count}", style = MaterialTheme.typography.bodyMedium, color = e.muted)
                }
                BandBar(c.count / most, categoryLabel(c.category), fill = e.muted, height = 4.dp)
            }
        }
        LinkButton("Open error log  →", { nav.go(Mistakes()) })
    }
}
