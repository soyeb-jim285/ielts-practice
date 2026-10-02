package com.soyeb.ieltspractice.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.LocalDemo
import com.soyeb.ieltspractice.R
import com.soyeb.ieltspractice.core.Empty
import com.soyeb.ieltspractice.ui.ScreenScaffold
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.Mistakes
import com.soyeb.ieltspractice.ui.screens.shell.DueCard
import com.soyeb.ieltspractice.ui.screens.shell.DueResponse
import com.soyeb.ieltspractice.ui.screens.shell.EmptyState
import com.soyeb.ieltspractice.ui.screens.shell.SignInGate
import com.soyeb.ieltspractice.ui.screens.shell.daysLabel
import com.soyeb.ieltspractice.ui.screens.shell.demoTab
import com.soyeb.ieltspractice.ui.screens.shell.nextInterval
import com.soyeb.ieltspractice.ui.screens.shell.reviewSourceLabel
import com.soyeb.ieltspractice.ui.screens.shell.reviewSourcePrompt
import com.soyeb.ieltspractice.ui.screens.shell.splitFixCard
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.ControlShape
import com.soyeb.ieltspractice.ui.theme.ErrorLine
import com.soyeb.ieltspractice.ui.theme.PrimaryButton
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// Mirrors: iOS Views/ReviewView.swift, web routes/_app/review.tsx

/** SM-2 flashcards: question, then Show answer, then grade Again / Hard / Good / Easy with the next interval under each. */
@Composable
fun ReviewScreen(nav: AppNav) {
    val api = LocalApp.current.api
    val account by api.hasAccount.collectAsState()
    val ready by api.ready.collectAsState()
    ScreenScaffold("Review", large = true) {
        if (ready) SignInGate(nav, "Create an account to turn your corrections into flashcards.", account, "Your review deck", R.drawable.ic_review) { ReviewBody(nav) }
    }
}

private class Grade(val grade: Int, val label: String)
private val grades = listOf(Grade(1, "Again"), Grade(3, "Hard"), Grade(4, "Good"), Grade(5, "Easy"))

@Composable
private fun ColumnScope.ReviewBody(nav: AppNav) {
    val api = LocalApp.current.api
    val scope = rememberCoroutineScope()
    val revealOnLoad = demoTab(LocalDemo.current) == "Revealed" // screenshots only
    // The session queue: the due batch, plus every card graded Again re-queued at the end (a learning step, like Anki's).
    var queue by remember { mutableStateOf(emptyList<DueCard>()) }
    var index by remember { mutableIntStateOf(0) }
    var dueTotal by remember { mutableIntStateOf(0) }
    var batchSize by remember { mutableIntStateOf(0) }
    var deck by remember { mutableStateOf<Int?>(null) }
    var reviewed by remember { mutableIntStateOf(0) } // graded this visit, so the end state can say so after the refetch empties the queue
    var revealed by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    var grading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var gradeError by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        try {
            val r = api.get<DueResponse>("/api/cards/due")
            queue = r.list; batchSize = r.list.size; dueTotal = r.dueTotal; deck = r.deck
            index = 0; revealed = revealOnLoad; error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message ?: "Something went wrong."
        }
        loading = false
    }
    LaunchedEffect(Unit) { load() }

    fun grade(card: DueCard, g: Int) {
        scope.launch {
            grading = true
            gradeError = null
            try {
                api.send<Empty>("POST", "/api/cards/${card.id}/review", buildJsonObject { put("grade", g) })
                revealed = false; reviewed++; index++
                if (g == 1) queue = queue + card else if (index >= queue.size) load()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                gradeError = e.message ?: "Something went wrong."
            }
            grading = false
        }
    }

    val card = queue.getOrNull(index)
    val total = maxOf(1, dueTotal + queue.size - batchSize)
    val e = MaterialTheme.ext
    when {
        loading && card == null -> Box(Modifier.fillMaxWidth().padding(top = 80.dp), Alignment.Center) { CircularProgressIndicator() }
        error != null && card == null -> EmptyState("Couldn't load cards", error.orEmpty(), action = "Try again", onAction = { loading = true; scope.launch { load() } })
        card != null -> {
            val (label, front) = splitFixCard(card)
            val left = maxOf(0, total - index)
            Text("$left ${if (left == 1) "card" else "cards"} left today", style = MaterialTheme.typography.bodyMedium, color = e.muted)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                LinearProgressIndicator(
                    { minOf(1f, index.toFloat() / total) }, Modifier.weight(1f).semantics { contentDescription = "Session progress" },
                    color = e.brand, trackColor = e.surface2, gapSize = 0.dp, drawStopIndicator = {},
                )
                Text("$index / $total", Modifier.clearAndSetSemantics {}, style = MaterialTheme.typography.bodySmall.merge(AppText.num), color = e.muted)
            }
            AppCard(Modifier.heightIn(min = 260.dp), padding = 20.dp) {
                Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    reviewSourceLabel[card.source]?.let {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(painterResource(R.drawable.ic_review), null, Modifier.size(16.dp), tint = e.muted)
                            Text(it, style = MaterialTheme.typography.bodySmall, color = e.muted)
                        }
                    }
                    if (!revealed) reviewSourcePrompt[card.source]?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = e.muted) }
                    label?.let { Text(it, style = MaterialTheme.typography.titleSmall, color = e.brand) }
                    Text(front, style = MaterialTheme.typography.headlineSmall, color = e.ink)
                    if (revealed) {
                        HorizontalDivider(color = e.line)
                        Text(card.back, style = AppText.reading, color = e.ink)
                    }
                }
            }
            gradeError?.let { ErrorLine("Couldn't save that grade: $it") }
            if (revealed) {
                Column(Modifier.semantics { contentDescription = "How well did you remember?" }, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        grades.forEach { g ->
                            val next = if (g.grade == 1) "This session" else daysLabel(nextInterval(card, g.grade))
                            val tone = when (g.grade) { 1 -> e.badText; 3 -> e.warnText; 4 -> e.goodText; else -> e.brand }
                            GradeButton(g.label, next, tone, !grading, Modifier.weight(1f)) { grade(card, g.grade) }
                        }
                    }
                }
            } else {
                PrimaryButton("Show answer", { revealed = true }, Modifier.fillMaxWidth())
            }
            Text(
                "Grade honestly: cards you find hard come back sooner. Again shows the card once more before you finish.",
                style = MaterialTheme.typography.bodySmall, color = e.muted,
            )
        }
        else -> {
            val noCards = reviewed == 0 && deck == 0
            val title = if (reviewed > 0) "Session complete" else if (noCards) "No cards yet" else if ((deck ?: 0) > 0) "All caught up" else "Nothing due right now"
            val text = when {
                reviewed > 0 -> "You reviewed $reviewed ${if (reviewed == 1) "card" else "cards"}. Each one comes back when it is due, so a short session tomorrow keeps them fresh."
                noCards -> "Your deck is empty. Open Mistakes and press Add to deck on the corrections you want to remember; they come back here on a spaced schedule."
                (deck ?: 0) > 0 -> "Your cards come back here when they're due. Add more mistakes and fixes from your results any time."
                else -> "Cards come back here on a spaced schedule. Add mistakes and fixes from your results to build your deck."
            }
            EmptyState(title, text, action = if (noCards) "Go to Mistakes and add cards" else "Browse your mistakes", onAction = { nav.go(Mistakes()) })
        }
    }
}

/** One of the four grades: the label in its tone, the next interval under it. A 56dp neutral button, not teal. */
@Composable
private fun GradeButton(label: String, next: String, tone: Color, enabled: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val e = MaterialTheme.ext
    Surface(
        onClick, modifier.heightIn(min = 56.dp).semantics { contentDescription = "$label, next review ${next.lowercase()}" }, enabled = enabled,
        shape = ControlShape, color = e.surface2,
    ) {
        Column(Modifier.padding(vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Text(label, style = MaterialTheme.typography.labelLarge, color = tone, maxLines = 1)
            Text(next, style = MaterialTheme.typography.bodySmall.merge(AppText.num), color = e.muted, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
    }
}
