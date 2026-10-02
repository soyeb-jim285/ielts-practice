package com.soyeb.ieltspractice.ui.screens

import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.LocalDemo
import com.soyeb.ieltspractice.core.ApiClient
import com.soyeb.ieltspractice.core.ApiError
import com.soyeb.ieltspractice.core.AppJson
import com.soyeb.ieltspractice.core.Created
import com.soyeb.ieltspractice.core.GateText
import com.soyeb.ieltspractice.core.Empty
import com.soyeb.ieltspractice.core.Prompt
import com.soyeb.ieltspractice.core.clock
import com.soyeb.ieltspractice.core.newSessionId
import com.soyeb.ieltspractice.ui.ScreenScaffold
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.AttemptResult
import com.soyeb.ieltspractice.ui.nav.WritingEditor
import com.soyeb.ieltspractice.ui.screens.writing.BarTint
import com.soyeb.ieltspractice.ui.screens.writing.BusyOverlay
import com.soyeb.ieltspractice.ui.screens.writing.Draft
import com.soyeb.ieltspractice.ui.screens.writing.DraftStore
import com.soyeb.ieltspractice.ui.screens.writing.ExamSession
import com.soyeb.ieltspractice.ui.screens.writing.ExamTextField
import com.soyeb.ieltspractice.ui.screens.writing.ExamToast
import com.soyeb.ieltspractice.ui.screens.writing.ModalCard
import com.soyeb.ieltspractice.ui.screens.writing.PlanHeader
import com.soyeb.ieltspractice.ui.screens.writing.PromptContent
import com.soyeb.ieltspractice.ui.screens.writing.QuestionToggle
import com.soyeb.ieltspractice.ui.screens.writing.Segmented
import com.soyeb.ieltspractice.ui.screens.writing.TaskCount
import com.soyeb.ieltspractice.ui.screens.writing.TimeEvent
import com.soyeb.ieltspractice.ui.screens.writing.TimerChip
import com.soyeb.ieltspractice.ui.screens.writing.Tone
import com.soyeb.ieltspractice.ui.screens.writing.ToastPill
import com.soyeb.ieltspractice.ui.screens.writing.WordBarCard
import com.soyeb.ieltspractice.ui.screens.writing.examSeconds
import com.soyeb.ieltspractice.ui.screens.writing.minWords
import com.soyeb.ieltspractice.ui.screens.writing.plural
import com.soyeb.ieltspractice.ui.screens.writing.rememberDraftStore
import com.soyeb.ieltspractice.ui.screens.writing.secondsLeft
import com.soyeb.ieltspractice.ui.screens.writing.submitNote
import com.soyeb.ieltspractice.ui.screens.writing.taskLabel
import com.soyeb.ieltspractice.ui.screens.writing.timeEvent
import com.soyeb.ieltspractice.ui.screens.writing.tooShort
import com.soyeb.ieltspractice.ui.screens.writing.underMinimum
import com.soyeb.ieltspractice.ui.screens.writing.wordCount
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.ErrorLine
import com.soyeb.ieltspractice.ui.theme.PrimaryButton
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.SectionTitle
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// Mirrors: iOS Views/WritingEditorView.swift, web routes/_app/writing/task.$promptId.tsx, _app/writing/full.tsx, components/writing/WritingExam.tsx
// Exam-mode writing: wall-clock countdown (amber at 5 min, rose at 1 min), notices at 5 and 1 minutes, auto-submit at 0 (setting) or overtime,
// essay and plan autosaved per prompt, paste blocked, no autocorrect or suggestions. A full test is Task 1 + Task 2 on one 60-minute clock.

@Composable
fun WritingEditorScreen(route: WritingEditor, nav: AppNav) {
    val api = LocalApp.current.api
    // The loaded prompts and the start time survive rotation and process death, so the task never reshuffles under a half-written essay.
    var saved by rememberSaveable { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    LaunchedEffect(attempt) {
        if (saved != null) return@LaunchedEffect
        error = null
        try {
            saved = AppJson.encodeToString(ExamSession.serializer(), loadSession(api, route))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message ?: "Something went wrong."
        }
    }
    val session = remember(saved) { saved?.let { AppJson.decodeFromString(ExamSession.serializer(), it) } }
    if (session != null) {
        ExamScreen(session, nav)
    } else {
        ScreenScaffold("Writing", onBack = nav::back) {
            val e = error
            if (e == null) {
                Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator(color = MaterialTheme.ext.brand)
                    Text("Loading task…", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.ext.muted)
                }
            } else {
                AppCard {
                    SectionTitle("Couldn't load the task")
                    ErrorLine(e)
                    PrimaryButton("Try again", { attempt++ }, Modifier.fillMaxWidth())
                }
            }
        }
    }
}

private suspend fun loadSession(api: ApiClient, r: WritingEditor): ExamSession {
    suspend fun pick(part: String, variant: String? = null): Prompt =
        api.get("/api/prompts/random", mapOf("skill" to "writing", "part" to part, "variant" to variant))
    val prompts = when (r.mode) {
        "full" -> listOf(pick("1", r.variant), pick("2"))
        "task1" -> listOf(pick("1", r.variant))
        "prompt" -> listOf(api.get<Prompt>("/api/prompts/${Uri.encode(r.promptId.orEmpty())}"))
        else -> listOf(pick("2"))
    }
    return ExamSession(prompts, System.currentTimeMillis(), newSessionId(), r.parentId)
}

private class Flags { var autoFired = false; var submitted = false }

@Composable
private fun ExamScreen(session: ExamSession, nav: AppNav) {
    val e = MaterialTheme.ext
    val api = LocalApp.current.api
    val demo = LocalDemo.current
    val variant = demo?.tab // demo only: which state the screenshot shows (see ScreenCatalog)
    val me by api.me.collectAsState()
    val blockPaste = me?.settings?.blockPaste ?: true
    val autoSubmit = me?.settings?.writingAutoSubmit != false
    val prompts = session.prompts
    val multi = prompts.size > 1
    val seconds = examSeconds(prompts)
    val store = rememberDraftStore()
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    val flags = remember { Flags() }
    val created = remember { mutableMapOf<String, String>() } // promptId to attemptId, so a retried submit never duplicates attempts

    // Drafts: essay and plan per prompt, read once when the exam opens.
    val texts = remember { mutableStateMapOf<String, String>() }
    val plans = remember { mutableStateMapOf<String, String>() }
    remember {
        prompts.forEachIndexed { i, p ->
            val d = if (demo != null) demoDraft(variant, if (i == 0) p.part else 0) else store.load(p.id)
            texts[p.id] = d.text
            plans[p.id] = d.plan
        }
    }
    var task by rememberSaveable { mutableIntStateOf(0) }
    val p = prompts[task.coerceIn(prompts.indices)]
    var showPlan by remember { mutableStateOf(prompts.any { plans[it.id].orEmpty().isNotEmpty() }) } // the plan opens by itself when it has content
    var showPrompt by remember { mutableStateOf(texts[prompts[0].id].orEmpty().isEmpty()) } // an answer already under way starts with the question folded
    var showSubmit by remember { mutableStateOf(variant == "Submit" || variant == "Short") }
    var showExit by remember { mutableStateOf(variant == "Exit") }
    var submitting by remember { mutableStateOf(false) }
    var submitError by remember { mutableStateOf(if (variant == "Error") "Can't reach IELTS Practice. Check your internet connection and try again." else null) }
    var toastCount by remember { mutableIntStateOf(0) }
    var toast by remember { mutableStateOf(demoToast(variant)) }
    fun show(text: String, tone: Tone, paste: Boolean = false) { toast = ExamToast(text, tone, ++toastCount, paste) }

    // Wall clock, not ticks: the deadline is startedAt + seconds, so backgrounding or a throttled loop can't drift it.
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(session) { if (demo == null) while (true) { now = System.currentTimeMillis(); delay(250) } }
    val left by remember(session) { derivedStateOf { secondsLeft(seconds, session.startedAt, if (demo == null) now else session.startedAt + demoElapsed(variant, seconds) * 1000L) } }
    val previous = remember { intArrayOf(left) }
    LaunchedEffect(left) {
        val event = timeEvent(previous[0], left)
        previous[0] = left
        when (event) {
            TimeEvent.Warn5 -> show("5 minutes left", Tone.Warn)
            TimeEvent.Warn1 -> show("1 minute left", Tone.Bad)
            TimeEvent.TimeUp -> if (autoSubmit) {
                if (!flags.autoFired) {
                    flags.autoFired = true
                    showSubmit = false
                    show("Time is up. Submitting your answer…", Tone.Bad)
                    submit(api, prompts, texts, plans, session, created, left, seconds, scope, flags, store, nav, { submitting = it }, { submitError = it })
                }
            } else {
                show("Time is up. You can keep writing; the result will be marked overtime.", Tone.Bad)
            }
            null -> {}
        }
    }
    LaunchedEffect(toast) { if (toast != null && demo == null) { delay(3500); toast = null } }

    // Autosave: a moment after typing stops, whenever the app goes to the background, and when the screen closes.
    fun persist() {
        if (flags.submitted || demo != null) return
        prompts.forEach { store.save(it.id, Draft(texts[it.id].orEmpty(), plans[it.id].orEmpty())) }
    }
    LaunchedEffect(session) { snapshotFlow { prompts.map { texts[it.id] to plans[it.id] } }.collectLatest { delay(800); persist() } }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { persist() }
    DisposableEffect(Unit) { onDispose { persist() } }

    LaunchedEffect(showSubmit, showExit) { if (showSubmit || showExit) focus.clearFocus() }
    BackHandler { if (!submitting) showExit = true }

    val counts = prompts.map { TaskCount(it.part, wordCount(texts[it.id].orEmpty())) }
    val label = if (multi) "Writing, full test" else "Writing, ${taskLabel(p)}"
    val modal = showSubmit || showExit || submitting
    val scroll = rememberScrollState()
    LaunchedEffect(scroll.maxValue) { if (variant == "Scrolled") scroll.scrollTo(scroll.maxValue) }

    Box(Modifier.fillMaxSize()) {
        Scaffold(
            if (modal) Modifier.clearAndSetSemantics { } else Modifier, // a modal is open: hide everything behind it from TalkBack
            containerColor = e.bg,
            topBar = {
                TopAppBar(
                    title = {
                        Column {
                            Text(label, style = MaterialTheme.typography.labelMedium, color = e.muted, maxLines = 1)
                            TimerChip(left)
                        }
                    },
                    navigationIcon = { IconButton({ showExit = true }, enabled = !submitting) { Icon(Icons.Filled.Close, contentDescription = "Exit") } },
                    actions = { PrimaryButton("Submit", { showSubmit = true }, Modifier.padding(end = 8.dp), enabled = !submitting) },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = e.bg, scrolledContainerColor = e.bg, titleContentColor = e.ink, navigationIconContentColor = e.ink),
                )
            },
        ) { pad ->
            Box(Modifier.padding(pad).consumeWindowInsets(pad).imePadding().fillMaxSize()) {
                Column(Modifier.fillMaxSize()) {
                    Column(Modifier.padding(horizontal = 16.dp).padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        if (multi) {
                            Segmented(
                                prompts.mapIndexed { i, q -> i.toString() to "${if (q.part == 1) "Task 1" else "Task 2"}, ${plural(counts[i].words)}" },
                                task.toString(),
                                { i -> task = i.toInt(); showPrompt = texts[prompts[task].id].orEmpty().isEmpty() },
                            )
                        }
                        if (!showPrompt) AppCard(padding = 12.dp) { QuestionToggle(p, false) { showPrompt = true } } // folded: stays pinned above the answer
                        submitError?.let { msg ->
                            AppCard(padding = 12.dp) {
                                Text("Submit failed", style = MaterialTheme.typography.titleSmall, color = e.ink)
                                ErrorLine(msg)
                            }
                        }
                    }
                    Column(Modifier.weight(1f).verticalScroll(scroll).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        if (showPrompt) {
                            AppCard {
                                QuestionToggle(p, true) { showPrompt = false }
                                PromptContent(p)
                            }
                        }
                        if (p.part == 2) {
                            AppCard {
                                PlanHeader(showPlan) { showPlan = !showPlan }
                                if (showPlan) {
                                    key("plan-${p.id}") {
                                        ExamTextField(
                                            plans[p.id].orEmpty(), { plans[p.id] = it }, blockPaste, { show(PASTE_NOTICE, Tone.Bad, paste = true) },
                                            label = "Essay plan", placeholder = PLAN_PLACEHOLDER, minLines = 5,
                                        )
                                    }
                                }
                            }
                        }
                        key(p.id) {
                            AppCard(padding = 16.dp) {
                                ExamTextField(
                                    texts[p.id].orEmpty(),
                                    { v -> if (texts[p.id].orEmpty().isEmpty() && v.isNotEmpty() && showPrompt) showPrompt = false; texts[p.id] = v }, // first keystroke: fold the question
                                    blockPaste, { show(PASTE_NOTICE, Tone.Bad, paste = true) },
                                    label = "Your answer to ${if (p.part == 1) "Task 1" else "Task 2"}", placeholder = ANSWER_PLACEHOLDER, minLines = 14,
                                )
                            }
                        }
                    }
                    WordBarCard(counts[prompts.indexOf(p)].words, minWords(p.part), Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                }
                toast?.let { ToastPill(it, Modifier.align(Alignment.TopCenter).padding(top = 8.dp)) }
            }
        }

        if (showSubmit) {
            val note = submitNote(counts, left)
            val short = tooShort(counts)
            val under = underMinimum(counts) != null
            ModalCard(if (multi) "Submit both tasks?" else "Submit your answer?", { showSubmit = false }) {
                Text("You can't edit after submitting. Analysis takes about a minute.", style = MaterialTheme.typography.bodyMedium, color = e.muted)
                Surface(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.medium, color = e.surface2) {
                    Column(Modifier.padding(horizontal = 16.dp)) {
                        prompts.forEachIndexed { i, q ->
                            if (i > 0) HorizontalDivider(color = e.line)
                            val c = counts[i]
                            Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(taskLabel(q), style = MaterialTheme.typography.titleSmall, color = e.ink)
                                val low = c.words < minWords(q.part)
                                Text(
                                    plural(c.words) + if (low) ", under ${minWords(q.part)}" else "",
                                    style = MaterialTheme.typography.bodyMedium.merge(AppText.num), color = if (low) e.warnText else e.goodText,
                                )
                            }
                        }
                    }
                }
                note?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = if (short) e.muted else e.warnText) }
                val go = { showSubmit = false; submit(api, prompts, texts, plans, session, created, left, seconds, scope, flags, store, nav, { submitting = it }, { submitError = it }) }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    // Under the minimum the safe move (keep writing) is the emphasised one; otherwise Submit is.
                    if (under) PrimaryButton("Keep writing", { showSubmit = false }, Modifier.weight(1f)) else SecondaryButton("Keep writing", { showSubmit = false }, Modifier.weight(1f))
                    if (under) SecondaryButton("Submit", go, Modifier.weight(1f), enabled = !short) else PrimaryButton("Submit", go, Modifier.weight(1f), enabled = !short)
                }
            }
        }
        if (showExit) {
            ModalCard("Leave this test?", { showExit = false }) {
                Text("Your draft stays saved on this device. The timer restarts when you come back.", style = MaterialTheme.typography.bodyMedium, color = e.muted)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    TextButton({ showExit = false; nav.back() }, Modifier.weight(1f), colors = ButtonDefaults.textButtonColors(contentColor = e.badText)) { Text("Leave") }
                    PrimaryButton("Stay", { showExit = false }, Modifier.weight(1f))
                }
            }
        }
        if (submitting) BusyOverlay("Submitting…")
    }
}

/** Create the attempt(s) and submit them (web `submit`, iOS `submit`); lands on the result. Text stays in the editor and the saved draft on failure. */
private fun submit(
    api: ApiClient, prompts: List<Prompt>, texts: Map<String, String>, plans: Map<String, String>, session: ExamSession,
    created: MutableMap<String, String>, left: Int, seconds: Int, scope: CoroutineScope, flags: Flags,
    store: DraftStore, nav: AppNav, setBusy: (Boolean) -> Unit, setError: (String?) -> Unit,
) {
    setBusy(true)
    setError(null)
    val multi = prompts.size > 1
    val overtime = left < 0
    // Editor time, split across the tasks of a full test so weekly minutes don't count it twice.
    val durationMs = (maxOf(0, seconds - left) * 1000L / prompts.size).toInt()
    scope.launch {
        try {
            val ids = mutableListOf<String>()
            for (p in prompts) {
                val text = texts[p.id].orEmpty()
                val plan = plans[p.id].orEmpty()
                val id = created[p.id] ?: api.send<Created>("POST", "/api/attempts", buildJsonObject {
                    put("promptId", p.id); put("skill", "writing"); put("part", p.part); put("mode", if (multi) "exam" else "practice"); put("text", text)
                    if (multi) put("sessionId", session.sessionId)
                    session.parentId?.let { put("parentAttemptId", it) }
                }).id.also { created[p.id] = it }
                try {
                    api.send<Empty>("POST", "/api/attempts/$id/submit", buildJsonObject {
                        put("text", text); put("overtime", overtime); put("durationMs", durationMs)
                        if (p.part == 2 && plan.isNotBlank()) put("plan", plan)
                    })
                } catch (e: ApiError) {
                    if (e.status != 409) throw e // 409: already submitted on an earlier try
                }
                ids += id
            }
            flags.submitted = true
            store.clear(prompts.map { it.id })
            nav.back() // the test is over: back from the result lands on the hub, not on a new random task
            nav.go(AttemptResult.of(*ids.toTypedArray()))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Out of tests (another tab used it, the window moved, the balance ran out): the draft stays and a panel says what to do.
            val blocked = e is ApiError && nav.reportBlocked(e, "writing", "Your essay is still here.")
            setError(if (blocked) GateText.sentence(e as ApiError, "Your essay is still here.") else e.message ?: "Could not submit. Your answer is still here; try again.")
            setBusy(false)
        }
    }
}

private const val PASTE_NOTICE = "Pasting is disabled in exam mode"
private const val PLAN_PLACEHOLDER = "Position: …\nBody 1: idea + example\nBody 2: idea + example\nConclusion: …"
private const val ANSWER_PLACEHOLDER = "Start writing here. Your draft saves on this device as you type."

// MARK: Demo states (screenshots only: `LocalDemo.current?.tab`)

private const val DEMO_PARA = "Many people argue that working from home brings real benefits to both employees and employers. Workers save the time and money they would spend commuting, and they can arrange their day around their own energy. Companies, in turn, spend less on office space and often find that staff are more satisfied. "

private fun demoDraft(variant: String?, part: Int): Draft = when {
    part == 0 || variant == null || variant == "Empty" || variant == "Top" || variant == "Scrolled" -> Draft()
    variant == "Short" -> Draft("I think remote work is good for most people.")
    variant == "Plan" -> Draft(DEMO_PARA.trim(), "Position: both views, but I lean towards flexible work\nBody 1: benefits for staff (commute, wellbeing)\nBody 2: risks (isolation, teamwork)\nConclusion: hybrid is best")
    variant == "Typing" -> Draft((DEMO_PARA.repeat(3)).trim())
    variant == "Paste" -> Draft(DEMO_PARA.trim())
    else -> Draft(DEMO_PARA.repeat(2).trim())
}

private fun demoElapsed(variant: String?, seconds: Int): Int = when (variant) {
    "Warning" -> seconds - 290
    "Final" -> seconds - 45
    "Overtime" -> seconds + 75
    else -> 0
}

private fun demoToast(variant: String?): ExamToast? = when (variant) {
    "Warning" -> ExamToast("5 minutes left", Tone.Warn, 1)
    "Final" -> ExamToast("1 minute left", Tone.Bad, 1)
    "Overtime" -> ExamToast("Time is up. You can keep writing; the result will be marked overtime.", Tone.Bad, 1)
    "Paste" -> ExamToast("Pasting is disabled in exam mode", Tone.Bad, 1, paste = true)
    else -> null
}
