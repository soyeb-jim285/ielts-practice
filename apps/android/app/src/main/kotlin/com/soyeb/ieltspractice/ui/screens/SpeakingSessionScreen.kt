package com.soyeb.ieltspractice.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.LocalDemo
import com.soyeb.ieltspractice.R
import com.soyeb.ieltspractice.core.Prompt
import com.soyeb.ieltspractice.core.UploadState
import com.soyeb.ieltspractice.core.clock
import com.soyeb.ieltspractice.ui.ScreenScaffold
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.AttemptResult
import com.soyeb.ieltspractice.ui.nav.SpeakingSession
import com.soyeb.ieltspractice.ui.screens.speaking.ConfirmDialog
import com.soyeb.ieltspractice.ui.screens.speaking.CueCard
import com.soyeb.ieltspractice.ui.screens.speaking.Examiner
import com.soyeb.ieltspractice.ui.screens.speaking.ListCard
import com.soyeb.ieltspractice.ui.screens.speaking.MicAccess
import com.soyeb.ieltspractice.ui.screens.speaking.MicDeniedDialog
import com.soyeb.ieltspractice.ui.screens.speaking.P2_MAX_SECONDS
import com.soyeb.ieltspractice.ui.screens.speaking.PREP_SECONDS
import com.soyeb.ieltspractice.ui.screens.speaking.Phase
import com.soyeb.ieltspractice.ui.screens.speaking.RowDivider
import com.soyeb.ieltspractice.ui.screens.speaking.SessionModel
import com.soyeb.ieltspractice.ui.screens.speaking.TimerRing
import com.soyeb.ieltspractice.ui.screens.speaking.UploadItem
import com.soyeb.ieltspractice.ui.screens.speaking.color
import com.soyeb.ieltspractice.ui.screens.speaking.exitMessage
import com.soyeb.ieltspractice.ui.screens.speaking.finishProgress
import com.soyeb.ieltspractice.ui.screens.speaking.partLabel
import com.soyeb.ieltspractice.ui.screens.speaking.rememberMicAccess
import com.soyeb.ieltspractice.ui.screens.speaking.ringMax
import com.soyeb.ieltspractice.ui.screens.speaking.zoneHint
import com.soyeb.ieltspractice.ui.screens.speaking.zoneTone
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.Chip
import com.soyeb.ieltspractice.ui.theme.ControlShape
import com.soyeb.ieltspractice.ui.theme.ErrorLine
import com.soyeb.ieltspractice.ui.theme.Newsreader
import com.soyeb.ieltspractice.ui.theme.PrimaryButton
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.ext
import kotlin.math.min
import kotlin.math.roundToInt

// Mirrors: iOS Views/SpeakingSessionView.swift, web routes/_app/speaking/session.tsx, components/speaking/SessionFlow.tsx

@Composable
fun SpeakingSessionScreen(route: SpeakingSession, nav: AppNav) {
    val app = LocalApp.current
    val demo = LocalDemo.current
    val ctx = LocalContext.current
    val vm: SessionModel = viewModel(factory = object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = SessionModel(app, route, ctx, demo) as T
    })
    val access = rememberMicAccess()
    var micDenied by remember { mutableStateOf(false) }
    var exitOpen by remember { mutableStateOf(false) }
    var earlyOpen by remember { mutableStateOf(false) }

    val states by app.pending.states.collectAsState()
    fun stateOf(u: UploadItem): UploadState = vm.demoStates[u.id] ?: states[u.id] ?: UploadState.Uploading
    val doneIds = vm.uploads.mapNotNull { (stateOf(it) as? UploadState.Done)?.attemptId }
    val allDone = vm.phase == Phase.Finishing && vm.items.isNotEmpty() && vm.uploads.size == vm.items.size && doneIds.size == vm.uploads.size
    val notDone = vm.uploads.any { stateOf(it) !is UploadState.Done }
    val anyFailed = vm.uploads.any { stateOf(it) is UploadState.Failed }

    // P2 hard stop at 2:00; 15 min caps the energy timeline for any part.
    val limitHit = vm.phase == Phase.Recording && vm.hitLimit(vm.recorder.elapsed)
    LaunchedEffect(limitHit) { if (limitHit) vm.finishPart() }

    fun leave() { vm.discardLive(); nav.back() }
    fun requestExit() { if (vm.recording || vm.phase == Phase.Prep || vm.index > 0 || notDone) exitOpen = true else leave() }
    BackHandler(enabled = !allDone) { requestExit() }

    if (allDone) { ResultScreen(AttemptResult.of(*doneIds.toTypedArray()), nav); return }

    val e = MaterialTheme.ext
    val title = when (vm.phase) {
        Phase.Finishing -> "Saving your answers"
        Phase.Loading, Phase.Empty, Phase.Failed -> "Speaking"
        else -> partLabel(vm.items, vm.index)
    }
    ScreenScaffold(
        title, scroll = false,
        actions = {
            if (vm.items.size > 1 && vm.phase in listOf(Phase.Ready, Phase.Prep, Phase.Recording)) {
                Text(
                    "${vm.index + 1}/${vm.items.size}", Modifier.semantics { contentDescription = "Part ${vm.index + 1} of ${vm.items.size}" },
                    style = MaterialTheme.typography.labelLarge.merge(AppText.num), color = e.muted,
                )
            }
            TextButton(::requestExit, modifier = Modifier.heightIn(min = 48.dp)) { Text("Exit", color = e.ink) }
        },
    ) {
        val p = vm.current
        when (vm.phase) {
            Phase.Loading -> Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator()
                    Text("Loading questions", style = MaterialTheme.typography.bodyMedium, color = e.muted)
                }
            }
            Phase.Empty -> Unavailable("No questions available yet", "The prompt bank has no speaking prompts for this part. Seed the bank, then try again.") {
                SecondaryButton("Back to speaking", nav::back)
            }
            Phase.Failed -> Unavailable("Couldn't load the questions", vm.failMessage) { PrimaryButton("Try again", vm::reload) }
            Phase.Finishing -> Finishing(vm, ::stateOf, doneIds.size)
            else -> if (p != null) {
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(24.dp)) {
                    if (p.part == 2) CueCard(p) else QuestionHeader(p, vm.question, vm.index, spoken = vm.lineFor(p, p.questions.getOrNull(vm.question) ?: "")?.url != null)
                    vm.startError?.let { ErrorLine(it) }
                    when (vm.phase) {
                        Phase.Recording -> RecordingPanel(vm, p)
                        Phase.Prep -> PrepPanel(vm)
                        else -> ReadyPanel(vm, p, access) { micDenied = true }
                    }
                    if (vm.index == 0 && vm.phase == Phase.Ready) MicCheckStep(vm, access) { micDenied = true }
                    if (anyFailed) {
                        AppCard {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Filled.Warning, contentDescription = null, Modifier.size(20.dp), tint = e.warn)
                                Text("An earlier answer didn't upload", style = MaterialTheme.typography.titleMedium, color = e.warnText)
                            }
                            Text("Keep going. You can retry it at the end.", style = MaterialTheme.typography.bodyMedium, color = e.muted)
                        }
                    }
                }
                Controls(vm, p, access, onEarly = { earlyOpen = true }, onDenied = { micDenied = true })
            }
        }
    }

    if (exitOpen) {
        ConfirmDialog(
            "Leave this test?", exitMessage(vm.recording, notDone), "Leave", onConfirm = ::leave, onDismiss = { exitOpen = false },
            dismissLabel = "Keep going", destructive = true,
        )
    }
    val cur = vm.current
    if (earlyOpen && cur != null) {
        val left = cur.questions.size - vm.question - 1
        ConfirmDialog(
            "Finish with ${vm.question + 1} of ${cur.questions.size} answered?",
            "Your whole Part ${cur.part} is one recording, so finishing now ends it and skips the last $left ${if (left == 1) "question" else "questions"}.",
            "Finish now", onConfirm = vm::finishPart, onDismiss = { earlyOpen = false }, dismissLabel = "Keep going",
        )
    }
    if (micDenied) MicDeniedDialog { micDenied = false }
}

@Composable
internal fun androidx.compose.foundation.layout.ColumnScope.Unavailable(title: String, text: String, action: @Composable () -> Unit) {
    val e = MaterialTheme.ext
    Column(
        Modifier.weight(1f).fillMaxWidth().padding(horizontal = 8.dp), horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
    ) {
        Icon(painterResource(R.drawable.ic_mic), contentDescription = null, Modifier.size(32.dp), tint = e.muted)
        Text(title, Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineSmall, color = e.ink, textAlign = TextAlign.Center)
        Text(text, style = MaterialTheme.typography.bodyMedium, color = e.muted, textAlign = TextAlign.Center)
        action()
    }
}

// MARK: Question

/** Part 3 rows carry two sub-topic headings in bullets; the first half of the questions sits under the first. */
private fun subTopic(p: Prompt, question: Int): String? {
    val b = p.bullets
    return if (p.part == 3 && b != null && b.size == 2 && p.questions.isNotEmpty()) b[minOf(1, question * 2 / p.questions.size)] else null
}

@Composable
private fun QuestionHeader(p: Prompt, question: Int, part: Int, spoken: Boolean) {
    val e = MaterialTheme.ext
    val n = p.questions.size
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(subTopic(p, question) ?: p.topic ?: p.title, Modifier.weight(1f), style = MaterialTheme.typography.labelLarge, color = e.ink)
            if (n > 1) {
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Question ${question + 1} of $n", style = MaterialTheme.typography.labelMedium.merge(AppText.num), color = e.muted)
                    Row(Modifier.clearAndSetSemantics {}, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        repeat(n) { i ->
                            Box(
                                Modifier.size(20.dp, 4.dp).background(
                                    if (i < question) e.ink.copy(alpha = 0.6f) else if (i == question) e.brand else e.muted.copy(alpha = 0.35f), RoundedCornerShape(2.dp),
                                ),
                            )
                        }
                    }
                }
            }
        }
        val text = p.questions.getOrNull(question) ?: p.questions.lastOrNull() ?: p.title
        // A spoken question is heard, not read, as in the real test; the text is one tap away, for this question only.
        var shown by remember(part, question) { mutableStateOf(false) }
        if (spoken && !shown) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(
                    Modifier.clearAndSetSemantics { contentDescription = text; heading() },
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Icon(painterResource(R.drawable.ic_sp_volume), contentDescription = null, Modifier.size(28.dp), tint = e.muted)
                    Text("Listen to the examiner", style = MaterialTheme.typography.headlineMedium, color = e.muted)
                }
                TextButton({ shown = true }, Modifier.heightIn(min = 48.dp)) {
                    Text("Show the question", color = e.brand, textDecoration = TextDecoration.Underline)
                }
            }
        } else {
            Text(text, Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineMedium, color = e.ink)
        }
    }
}

// MARK: Ready

@Composable
private fun ReadyPanel(vm: SessionModel, p: Prompt, access: MicAccess, onDenied: () -> Unit) {
    val e = MaterialTheme.ext
    if (p.part == 2) {
        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(40.dp)) {
                Stat("Preparation", clock(PREP_SECONDS))
                Stat("Speaking", "up to ${clock(P2_MAX_SECONDS.toInt())}")
            }
            Text(
                "Talk for 1 to 2 minutes about the card. You get 1 minute to prepare and can make notes. Recording stops at 2:00.",
                style = MaterialTheme.typography.bodyMedium, color = e.muted,
            )
        }
    } else {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(20.dp), verticalAlignment = Alignment.CenterVertically) {
                Surface(
                    { access.ask { ok -> if (ok) vm.startRecording() else onDenied() } }, Modifier.size(88.dp).semantics { contentDescription = "Start recording" },
                    shape = CircleShape, color = e.brand, contentColor = e.onBrand,
                ) {
                    Box(contentAlignment = Alignment.Center) { Icon(painterResource(R.drawable.ic_mic), contentDescription = null, Modifier.size(36.dp)) }
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Press to start recording", style = MaterialTheme.typography.titleMedium, color = e.ink)
                    Text(
                        if (p.part == 1) "Short answers about you. The examiner reads each question aloud, then you speak. Press Next question when you have answered."
                        else "A discussion linked to Part 2. The examiner reads each question aloud. Develop each answer with reasons and examples, then press Next question.",
                        style = MaterialTheme.typography.bodySmall, color = e.muted,
                    )
                }
            }
            if (!vm.hintSeen) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Info, contentDescription = null, Modifier.size(16.dp), tint = e.brand)
                    Text("Tap to start, your whole Part ${p.part} is one recording.", style = MaterialTheme.typography.bodySmall, color = e.brand)
                }
            }
        }
    }
}

@Composable
private fun Stat(label: String, value: String) {
    val e = MaterialTheme.ext
    Column(Modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = e.muted)
        Text(value, style = MaterialTheme.typography.titleLarge.merge(AppText.num), color = e.ink)
    }
}

// MARK: Prep (Part 2)

@Composable
private fun PrepPanel(vm: SessionModel) {
    val e = MaterialTheme.ext
    val left = vm.prepLeft
    Row(horizontalArrangement = Arrangement.spacedBy(20.dp), verticalAlignment = Alignment.Top) {
        TimerRing(
            left.toDouble() / PREP_SECONDS, if (left <= 10) e.warn else e.brand, 96.dp, 6.dp,
            Modifier.clearAndSetSemantics { contentDescription = "Preparation time left ${clock(left)}" },
        ) {
            Text(clock(left), style = MaterialTheme.typography.titleLarge.merge(AppText.num), color = if (left <= 10) e.warnText else e.ink)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Notes", style = MaterialTheme.typography.titleSmall, color = e.ink)
            BasicTextField(
                vm.notes, { vm.notes = it },
                Modifier.fillMaxWidth().heightIn(min = 120.dp).background(e.surface, RoundedCornerShape(12.dp))
                    .border(1.dp, e.line, RoundedCornerShape(12.dp)).padding(12.dp).semantics { contentDescription = "Notes" },
                textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = Newsreader, color = e.ink),
                cursorBrush = SolidColor(e.brand),
                keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, imeAction = ImeAction.Default),
            )
            Text("Only you see these. Recording starts automatically when the minute is up.", style = MaterialTheme.typography.bodySmall, color = e.muted)
        }
    }
}

// MARK: Recording

@Composable
private fun RecordingPanel(vm: SessionModel, p: Prompt) {
    val e = MaterialTheme.ext
    val rec = vm.recorder
    val seconds = (if (p.part == 2) rec.elapsed else rec.elapsed - vm.questionStart).coerceAtLeast(0.0)
    val whole = seconds.toInt()
    if (vm.examiner == Examiner.Asking) {
        Text("The examiner is asking the question", Modifier.semantics { liveRegion = LiveRegionMode.Polite }, style = MaterialTheme.typography.titleMedium, color = e.brand)
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Row(Modifier.semantics(mergeDescendants = true) {}, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(10.dp).background(e.bad, CircleShape))
            Text("Recording", style = MaterialTheme.typography.titleSmall, color = e.badText)
            if (vm.examiner == Examiner.Cue) Chip("Speak now", color = e.goodText)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(20.dp), verticalAlignment = Alignment.CenterVertically) {
            TimerRing(
                seconds / ringMax(p.part), zoneTone(p.part, seconds).color(e), 112.dp, 6.dp,
                Modifier.clearAndSetSemantics { contentDescription = "Answer time ${clock(whole)}" },
            ) {
                Text(clock(whole), style = MaterialTheme.typography.headlineMedium.merge(AppText.num), color = e.ink)
            }
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(Modifier.height(40.dp).clearAndSetSemantics {}, horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically) {
                    rec.levels.takeLast(24).forEach { l -> Box(Modifier.size(3.dp, (4 + 36 * l).dp).background(e.brand.copy(alpha = 0.75f), CircleShape)) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    val wpm = rec.liveWpm
                    if (rec.elapsed < 5 || wpm == 0) Chip("Measuring pace…", color = e.ink)
                    else if (wpm in 120..170) Chip("~$wpm wpm, steady", color = e.goodText)
                    else Chip("~$wpm wpm, ${if (wpm < 120) "slow" else "fast"}", color = e.warnText)
                    if (p.part == 2) Chip("Stops at ${clock(P2_MAX_SECONDS.toInt())}", color = e.ink)
                }
            }
        }
        Text(zoneHint(p.part, whole), Modifier.semantics { liveRegion = LiveRegionMode.Polite }, style = MaterialTheme.typography.bodySmall, color = e.muted)

        // Keeps its height so the layout does not jump when it appears.
        val nudge = rec.silence >= 3
        Row(
            Modifier.alpha(if (nudge) 1f else 0f).then(if (nudge) Modifier else Modifier.clearAndSetSemantics {}),
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(painterResource(R.drawable.ic_sp_lightbulb), contentDescription = null, Modifier.size(18.dp), tint = e.brand)
            Text("Keep going. Add a reason or an example.", style = MaterialTheme.typography.titleSmall, color = e.brand)
        }

        if (p.part == 2 && vm.notes.isNotEmpty()) {
            Column(
                Modifier.fillMaxWidth().background(e.surface2, RoundedCornerShape(12.dp)).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text("Your notes", style = MaterialTheme.typography.labelMedium, color = e.muted)
                Text(vm.notes, style = MaterialTheme.typography.bodyLarge.copy(fontFamily = Newsreader), color = e.ink)
            }
        }
    }
}

// MARK: Mic check

/** Optional mic check before the first recording, on its own recorder (web MicCheck): says "clearly" only after ~1 s of speech-level input. */
@Composable
private fun MicCheckStep(vm: SessionModel, access: MicAccess, onDenied: () -> Unit) {
    val e = MaterialTheme.ext
    val mic = vm.micCheck
    if (!mic.isRecording) {
        SecondaryButton("Check your microphone first", {
            access.ask { ok ->
                if (!ok) onDenied()
                else if (!mic.start()) vm.startError = "The microphone couldn't start. Close other apps that use it and try again."
            }
        })
        return
    }
    val loud = mic.loud >= 20
    val soft = mic.soft >= 20
    val segments = 24
    val lit = (min(1.0, mic.level * 1.8) * segments).roundToInt()
    val barColor = if (loud) e.good else if (soft) e.warn else e.brand
    val (text, color) = when {
        loud -> "We can hear you clearly." to e.goodText
        soft -> "Very quiet. Move closer to the microphone or speak up." to e.warnText
        else -> "Say a few words, like your name." to e.muted
    }
    AppCard {
        Row(
            Modifier.fillMaxWidth().height(24.dp).semantics { contentDescription = "Microphone level ${(mic.level * 100).roundToInt()} percent" },
            horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.Bottom,
        ) {
            repeat(segments) { i ->
                Box(Modifier.weight(1f).height((24 * (0.4 + 0.6 * i / segments)).dp).background(if (i < lit) barColor else e.surface2, RoundedCornerShape(2.dp)))
            }
        }
        Text(text, Modifier.semantics { liveRegion = LiveRegionMode.Polite }, style = if (loud || soft) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodyMedium, color = color)
        SecondaryButton("Looks good", { mic.stop() })
    }
}

// MARK: Controls

@Composable
private fun Controls(vm: SessionModel, p: Prompt, access: MicAccess, onEarly: () -> Unit, onDenied: () -> Unit) {
    when (vm.phase) {
        Phase.Recording ->
            if (p.part != 2 && vm.question + 1 < p.questions.size) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SecondaryButton("Finish part early", onEarly, Modifier.weight(1f), enabled = vm.examiner != Examiner.Asking)
                    PrimaryButton("Next question", vm::nextQuestion, Modifier.weight(1f), enabled = vm.examiner != Examiner.Asking)
                }
            } else {
                PrimaryButton(if (vm.index + 1 < vm.items.size) "Finish and continue" else "Finish", vm::finishPart, Modifier.fillMaxWidth(), enabled = vm.examiner != Examiner.Asking)
            }
        Phase.Prep -> PrimaryButton("Start speaking now", vm::startRecording, Modifier.fillMaxWidth())
        Phase.Ready -> if (p.part == 2) {
            PrimaryButton("Start 1-minute preparation", { access.ask { ok -> if (ok) vm.beginPrep() else onDenied() } }, Modifier.fillMaxWidth(), enabled = vm.examiner != Examiner.Asking)
        }
        else -> {}
    }
}

// MARK: Saving your answers

@Composable
private fun androidx.compose.foundation.layout.ColumnScope.Finishing(vm: SessionModel, stateOf: (UploadItem) -> UploadState, done: Int) {
    val e = MaterialTheme.ext
    val total = vm.items.size
    val failed = vm.uploads.filter { stateOf(it) is UploadState.Failed }
    Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(24.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                if (failed.isEmpty()) "Uploading your answers" else "Some answers need another try",
                Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineMedium, color = e.ink,
            )
            Text(
                if (failed.isEmpty()) "Analysis starts as soon as each of the $total recordings arrives." else "Your recordings are still here. Retry to send them.",
                style = MaterialTheme.typography.bodyMedium, color = e.muted,
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(finishProgress(total, done, failed.size), style = MaterialTheme.typography.labelMedium.merge(AppText.num), color = e.muted)
            LinearProgressIndicator(
                { done.toFloat() / maxOf(total, 1) }, Modifier.fillMaxWidth().height(6.dp).semantics { contentDescription = "$done of $total recordings uploaded" },
                color = if (failed.isEmpty()) e.brand else e.warn, trackColor = e.surface2, drawStopIndicator = {},
            )
        }
        ListCard {
            vm.uploads.forEachIndexed { i, u ->
                if (i > 0) RowDivider()
                val state = stateOf(u)
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
                ) {
                    when (state) {
                        is UploadState.Done -> Icon(Icons.Filled.CheckCircle, contentDescription = "Uploaded", tint = e.goodText)
                        is UploadState.Failed -> Icon(Icons.Filled.Warning, contentDescription = "Failed", tint = e.badText)
                        UploadState.Uploading -> CircularProgressIndicator(Modifier.size(22.dp).semantics { contentDescription = "Uploading" }, strokeWidth = 2.dp)
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(u.label, style = MaterialTheme.typography.bodyMedium, color = e.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        if (state == UploadState.Uploading) Text("Uploading…", style = MaterialTheme.typography.bodySmall, color = e.muted)
                        if (state is UploadState.Failed) Text(state.message, style = MaterialTheme.typography.bodySmall, color = e.badText)
                    }
                    if (state is UploadState.Failed) SecondaryButton("Retry", { vm.retry(u) })
                }
            }
        }
        if (failed.isNotEmpty()) {
            AppCard {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Warning, contentDescription = null, Modifier.size(20.dp), tint = e.badText)
                    Text("Upload failed", style = MaterialTheme.typography.titleMedium, color = e.badText)
                }
                Text(
                    "Your recording is saved on this device. If it keeps failing, leave and upload it later from the Speaking page, even after a restart.",
                    style = MaterialTheme.typography.bodyMedium, color = e.muted,
                )
                PrimaryButton("Retry upload", { failed.forEach(vm::retry) })
            }
        }
    }
}
