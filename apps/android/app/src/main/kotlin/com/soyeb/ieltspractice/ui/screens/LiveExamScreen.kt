package com.soyeb.ieltspractice.ui.screens

import android.os.SystemClock
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.LocalDemo
import com.soyeb.ieltspractice.R
import com.soyeb.ieltspractice.core.Providers
import com.soyeb.ieltspractice.core.clock
import com.soyeb.ieltspractice.live.Examiner
import com.soyeb.ieltspractice.live.LiveExam
import com.soyeb.ieltspractice.live.LiveStage
import com.soyeb.ieltspractice.live.phaseLabel
import com.soyeb.ieltspractice.ui.ScreenScaffold
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.AttemptResult
import com.soyeb.ieltspractice.ui.nav.SettingsTab
import com.soyeb.ieltspractice.ui.screens.speaking.ConfirmDialog
import com.soyeb.ieltspractice.ui.screens.speaking.CueCard
import com.soyeb.ieltspractice.ui.screens.speaking.ListCard
import com.soyeb.ieltspractice.ui.screens.speaking.MicDeniedDialog
import com.soyeb.ieltspractice.ui.screens.speaking.Notice
import com.soyeb.ieltspractice.ui.screens.speaking.RowDivider
import com.soyeb.ieltspractice.ui.screens.speaking.animationsEnabled
import com.soyeb.ieltspractice.ui.screens.speaking.rememberMicAccess
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.ErrorLine
import com.soyeb.ieltspractice.ui.theme.Newsreader
import com.soyeb.ieltspractice.ui.theme.PrimaryButton
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.SectionTitle
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.delay
import kotlin.math.abs
import kotlin.math.sin

// Mirrors: iOS Views/LiveExamView.swift, web routes/_app/speaking/live.tsx, components/live/{PreScreen,LiveStage}.tsx, live/*
// The live examiner: pre-screen (mic check, how it runs, examiner style), then the stage. All three examiners (turn-based, GPT-Live,
// Gemini Live) share it; the state machine is live/LiveExam.kt.

private class Step(val part: Int, val time: String, val text: String)

private val steps = listOf(
    Step(1, "4-5 min", "Questions about you and familiar topics."),
    Step(2, "3-4 min", "One minute to prepare from a cue card, then speak for up to two minutes."),
    Step(3, "4-5 min", "A discussion of broader ideas linked to Part 2."),
)

@Composable
fun LiveExamScreen(nav: AppNav) {
    val app = LocalApp.current
    val demo = LocalDemo.current
    val ctx = LocalContext.current
    val me by app.api.me.collectAsState()
    val quota by app.api.quota.collectAsState()
    val exam: LiveExam = viewModel(factory = object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = LiveExam(app, ctx.cacheDir, demo) as T
    })
    val access = rememberMicAccess()
    var confirmEnd by remember { mutableStateOf(false) }
    var captions by remember { mutableStateOf(false) }

    val provider = me?.settings?.provider ?: "turn"
    // The examiners this person may use come from their own keys (OpenRouter: turn-based, OpenAI: GPT-Live, Gemini: Gemini Live).
    val allowed = quota?.liveProviders ?: app.api.liveProviders
    // The examiner that runs: the chosen one when allowed, else turn-based, else whichever natural-conversation one they have a key for.
    val examiner = when {
        provider == "gpt-live" && "gpt-live" in allowed -> Examiner.GptLive
        provider == "gemini-live" && "gemini-live" in allowed -> Examiner.Gemini
        "turn" in allowed || allowed.isEmpty() -> Examiner.Turn
        "gpt-live" in allowed -> Examiner.GptLive
        else -> Examiner.Gemini
    }
    // Natural conversation is selected but the server can't offer it: the turn-based examiner runs instead.
    val fallback = provider != "turn" && examiner == Examiner.Turn

    fun checkMic() { access.ask { ok -> if (ok) exam.beginMicCheck() else exam.micDenied = true } }
    // Ask for the microphone on entry so the level meter is already running.
    LaunchedEffect(Unit) { if (demo == null) checkMic() }

    val stage = exam.stage
    // The server refused (live needs a key, no tests left): the same panel as before the test, over the failure message.
    LaunchedEffect(stage) {
        (stage as? LiveStage.Failed)?.error?.let { nav.reportBlocked(it, "speaking", needs = Providers.name(Providers.keyFor(provider))) }
    }
    if (stage is LiveStage.Finished) { ResultScreen(AttemptResult.of(*stage.ids.toTypedArray()), nav); return }

    val running = stage == LiveStage.Running
    BackHandler(enabled = running || stage == LiveStage.Uploading) { if (running) confirmEnd = true }

    val now by produceNow(running)
    val e = MaterialTheme.ext
    ScreenScaffold(
        "Live examiner", scroll = false,
        onBack = if (stage == LiveStage.Ready || stage is LiveStage.Failed) nav::back else null,
        actions = {
            if (running) {
                val elapsed = clock(((now - exam.testStartedAt) / 1000).toInt().coerceAtLeast(0))
                Text(elapsed, Modifier.padding(end = 16.dp).semantics { contentDescription = "Elapsed $elapsed" }, style = MaterialTheme.typography.labelLarge.merge(AppText.num), color = e.ink)
            }
        },
    ) {
        when (stage) {
            LiveStage.Ready -> {
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(24.dp)) {
                    PreScreen(exam, examiner, fallback, onChange = { nav.go(SettingsTab) }, onCheck = ::checkMic)
                }
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    // Always enabled: before the mic is ready a press retries the permission check instead of starting.
                    if (!exam.micReady && !exam.micChecking) {
                        Text("Allow microphone access, then press again to begin.", style = MaterialTheme.typography.bodySmall, color = e.muted)
                    }
                    PrimaryButton(
                        if (exam.micReady) "Start test" else "Check microphone and start",
                        { if (exam.micReady) exam.start(examiner) else checkMic() },
                        Modifier.fillMaxWidth(), enabled = !exam.micChecking,
                    )
                }
            }
            LiveStage.Running -> Stage(exam, now, captions, onCaptions = { captions = it }, onEnd = { confirmEnd = true })
            LiveStage.Uploading -> Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator()
                    Text("Uploading your recordings", style = MaterialTheme.typography.bodyMedium, color = e.muted)
                }
            }
            is LiveStage.Failed -> Unavailable("The test stopped", stage.message) {
                if (exam.hasRecordings) PrimaryButton("Score what was recorded", exam::scoreRecorded)
            }
            is LiveStage.Finished -> {}
        }
    }

    if (confirmEnd) {
        ConfirmDialog(
            "End the test now?", "The parts you've already recorded will be scored. You can't resume this test.", "End test",
            onConfirm = exam::endTest, onDismiss = { confirmEnd = false }, dismissLabel = "Keep going", destructive = true,
        )
    }
    if (exam.micDenied) MicDeniedDialog { exam.micDenied = false }
}

/** Elapsed-realtime clock that ticks each second while [on] (the elapsed timer and the long-turn timer). */
@Composable
private fun produceNow(on: Boolean) = androidx.compose.runtime.produceState(SystemClock.elapsedRealtime(), on) {
    value = SystemClock.elapsedRealtime()
    while (on) { delay(1000); value = SystemClock.elapsedRealtime() }
}

// MARK: Pre-screen

@Composable
private fun PreScreen(exam: LiveExam, examiner: Examiner, fallback: Boolean, onChange: () -> Unit, onCheck: () -> Unit) {
    val e = MaterialTheme.ext
    Text("A full speaking test with a voice examiner. About 11-14 minutes, like the real thing.", style = MaterialTheme.typography.bodyMedium, color = e.muted)

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionTitle("Microphone check")
        AppCard {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                    Icon(painterResource(R.drawable.ic_sp_headphones), contentDescription = null, Modifier.size(22.dp), tint = e.muted)
                    Text(
                        "Headphones work best, so the examiner's voice doesn't reach your microphone. Find a quiet room.",
                        style = MaterialTheme.typography.bodyMedium, color = e.ink,
                    )
                }
                if (exam.micReady) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        LinearProgressIndicator(
                            { (exam.level * 1.8).coerceIn(0.0, 1.0).toFloat() },
                            Modifier.fillMaxWidth().height(6.dp).semantics { contentDescription = "Microphone level" },
                            color = if (exam.micHeard) e.good else e.brand, trackColor = e.surface2, drawStopIndicator = {},
                        )
                        Text(
                            if (exam.micHeard) "We can hear you clearly." else "Say a few words, like your name.",
                            style = if (exam.micHeard) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodyMedium,
                            color = if (exam.micHeard) e.goodText else e.muted,
                        )
                    }
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        SecondaryButton(if (exam.micChecking) "Checking..." else "Test microphone", onCheck, enabled = !exam.micChecking)
                        exam.micError?.let { ErrorLine(it) }
                    }
                }
            }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionTitle("How it runs")
        ListCard {
            steps.forEachIndexed { i, s ->
                if (i > 0) RowDivider()
                Column(Modifier.fillMaxWidth().padding(16.dp).semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Part ${s.part}", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, color = e.ink)
                        Text(s.time, style = MaterialTheme.typography.labelMedium.merge(AppText.num), color = e.muted)
                    }
                    Text(s.text, style = MaterialTheme.typography.bodyMedium, color = e.muted)
                }
            }
        }
        // Same labels as Settings, Live examiner.
        val style = when (examiner) {
            Examiner.Turn -> "Examiner waits for you to finish"
            Examiner.GptLive -> "Natural conversation (GPT-Live)"
            Examiner.Gemini -> "Natural conversation (Gemini)"
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Examiner style: $style.", Modifier.weight(1f, fill = false), style = MaterialTheme.typography.bodyMedium, color = e.muted)
            TextButton(onChange, modifier = Modifier.heightIn(min = 48.dp)) { Text("Change", color = e.brand) }
        }
        if (fallback) {
            Notice("Natural conversation isn't available right now", "Your examiner will wait for you to finish each answer instead. It runs the same test.")
        }
    }
}

// MARK: Stage

@Composable
private fun androidx.compose.foundation.layout.ColumnScope.Stage(exam: LiveExam, now: Long, captions: Boolean, onCaptions: (Boolean) -> Unit, onEnd: () -> Unit) {
    val e = MaterialTheme.ext
    val part2 = exam.phase == "p2-prep" || exam.phase == "p2-talk"
    val card = exam.cueCard
    Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(phaseLabel(exam.phase), Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineSmall, color = e.ink)

        AppCard(padding = 24.dp) {
            Column(
                Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                VoiceBars(exam.examinerTalking, exam.listening, exam.level)
                Text(exam.statusText.ifEmpty { " " }, style = MaterialTheme.typography.titleMedium, color = e.ink, textAlign = TextAlign.Center)
            }
        }

        if (exam.fellBack) Notice("Natural conversation couldn't connect", "Your examiner will wait for you to finish each answer instead. It runs the same test.")
        if (exam.voiceError != null) {
            // ponytail: the server's detail (model id, Settings hint) is for logs, not the candidate.
            Notice("The examiner's voice isn't available right now", "Questions will appear as text below. The test carries on as normal.")
        }
        if ((captions || exam.voiceError != null) && exam.caption.isNotEmpty()) {
            Text(
                exam.caption, Modifier.fillMaxWidth().background(e.surface2, RoundedCornerShape(16.dp)).padding(16.dp),
                style = MaterialTheme.typography.bodyLarge.copy(fontFamily = Newsreader), color = e.ink,
            )
        }

        if (part2 && card != null) {
            CueCard(card)
            if (exam.phase == "p2-prep") PrepTimer(exam.prepLeft)
            else if (exam.listening) TalkTimer(((now - exam.phaseStartedAt) / 1000).toInt().coerceIn(0, 120))
            NotesField(exam)
        }
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        IconToggleButton(
            captions, onCaptions, Modifier.size(48.dp).semantics { contentDescription = if (captions) "Hide captions" else "Show captions" },
            colors = IconButtonDefaults.iconToggleButtonColors(
                containerColor = e.surface2, contentColor = e.ink, checkedContainerColor = e.brandSoft, checkedContentColor = e.brand,
            ),
        ) { Icon(painterResource(R.drawable.ic_sp_captions), contentDescription = null) }
        if (exam.listening) PrimaryButton("I'm done", exam::endTurn, Modifier.weight(1f)) else Box(Modifier.weight(1f))
        SecondaryButton("End test", onEnd)
    }
}

@Composable
private fun PrepTimer(left: Int) {
    val e = MaterialTheme.ext
    val low = left <= 10
    AppCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Preparation time", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = e.ink)
            Text(clock(maxOf(0, left)), style = MaterialTheme.typography.titleLarge.merge(AppText.num), color = if (low) e.warnText else e.ink)
        }
        LinearProgressIndicator(
            { (60 - left).coerceIn(0, 60) / 60f }, Modifier.fillMaxWidth().height(6.dp).semantics { contentDescription = "Preparation time" },
            color = if (low) e.warn else e.brand, trackColor = e.surface2, drawStopIndicator = {},
        )
        Text("Preparation. The examiner will ask you to start when the minute is up.", style = MaterialTheme.typography.bodySmall, color = e.muted)
    }
}

@Composable
private fun TalkTimer(seconds: Int) {
    val e = MaterialTheme.ext
    AppCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Long turn", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = e.ink)
            Text("${clock(seconds)} of 2:00", style = MaterialTheme.typography.titleLarge.merge(AppText.num), color = e.ink)
        }
        LinearProgressIndicator(
            { seconds / 120f }, Modifier.fillMaxWidth().height(6.dp).semantics { contentDescription = "Speaking time" },
            color = e.brand, trackColor = e.surface2, drawStopIndicator = {},
        )
    }
}

/** Notes are editable during preparation and read-only once the long turn starts. */
@Composable
private fun NotesField(exam: LiveExam) {
    val e = MaterialTheme.ext
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Notes", style = MaterialTheme.typography.titleSmall, color = e.ink)
        Box(Modifier.fillMaxWidth().heightIn(min = 140.dp).background(e.surface2, RoundedCornerShape(12.dp)).padding(12.dp)) {
            BasicTextField(
                exam.notes, { exam.notes = it }, Modifier.fillMaxWidth().semantics { contentDescription = "Notes" },
                enabled = exam.phase == "p2-prep",
                textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = Newsreader, color = e.ink),
                cursorBrush = SolidColor(e.brand),
                keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, imeAction = ImeAction.Default),
            )
            if (exam.notes.isEmpty()) Text("Key words, examples", style = MaterialTheme.typography.bodyLarge.copy(fontFamily = Newsreader), color = e.muted)
        }
        Text("Only you see these.", style = MaterialTheme.typography.bodySmall, color = e.muted)
    }
}

/**
 * Examiner presence as a row of bars: they move while the examiner speaks, follow your voice while you answer and rest at a low line
 * otherwise. With animations off in system settings the speaking state is a still, raised shape.
 */
@Composable
private fun VoiceBars(speaking: Boolean, listening: Boolean, level: Double) {
    val e = MaterialTheme.ext
    val animate = animationsEnabled(LocalContext.current)
    var t by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    LaunchedEffect(speaking, animate) { while (speaking && animate) { delay(160); t = SystemClock.elapsedRealtime() } }
    val bars = 13
    Row(Modifier.height(72.dp).clearAndSetSemantics {}, horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        repeat(bars) { i ->
            val half = (bars - 1) / 2.0
            val mid = 1 - abs(i - half) / half // 0 at the edges, 1 in the middle
            val rest = 0.1 + 0.08 * mid
            val scale = when {
                listening -> minOf(1.0, rest + level * (0.7 + 1.1 * mid))
                speaking -> if (animate) 0.18 + 0.82 * mid * abs(sin(t / 1000.0 * 5.6 + i * 1.7)) else 0.3 + 0.4 * mid
                else -> rest
            }
            Box(Modifier.width(6.dp).height((8 + 64 * scale).dp).background(if (listening) e.ink.copy(alpha = 0.7f) else e.brand, CircleShape))
        }
    }
}
