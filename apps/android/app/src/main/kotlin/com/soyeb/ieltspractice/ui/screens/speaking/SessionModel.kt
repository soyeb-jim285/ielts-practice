package com.soyeb.ieltspractice.ui.screens.speaking

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import com.soyeb.ieltspractice.AppContainer
import com.soyeb.ieltspractice.audio.AudioPlayer
import com.soyeb.ieltspractice.audio.MicRecorder
import com.soyeb.ieltspractice.core.AnswerWindow
import com.soyeb.ieltspractice.core.AudioLine
import com.soyeb.ieltspractice.core.ApiError
import com.soyeb.ieltspractice.core.DemoConfig
import com.soyeb.ieltspractice.core.PendingRecording
import com.soyeb.ieltspractice.core.Prompt
import com.soyeb.ieltspractice.core.SpeakingTest
import com.soyeb.ieltspractice.core.UploadState
import com.soyeb.ieltspractice.core.newSessionId
import com.soyeb.ieltspractice.ui.nav.SpeakingSession
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.launch
import kotlin.math.ceil
import kotlin.math.max

enum class Phase { Loading, Ready, Prep, Recording, Finishing, Empty, Failed }

/** The examiner reading a question (microphone held), then the "Speak now" cue. */
enum class Examiner { Idle, Asking, Cue }

class UploadItem(val id: String, val label: String)

/**
 * The practice flow (web SessionFlow.tsx, iOS SpeakingSessionView): one recording per prompt (P1 topic / P2 card / P3 set) with "Next question"
 * marks, P2 one minute of prep then a 2 min talk with a hard stop. Each recording is kept on disk (PendingStore), uploaded in the background
 * while you continue, and becomes an attempt sharing a session id. A ViewModel, so rotating the phone does not lose a recording.
 */
class SessionModel(
    private val app: AppContainer, private val route: SpeakingSession, context: Context, private val demo: DemoConfig?,
) : ViewModel() {
    var phase by mutableStateOf(Phase.Loading); private set
    var failMessage by mutableStateOf(""); private set
    var items by mutableStateOf<List<Prompt>>(emptyList()); private set
    var index by mutableIntStateOf(0); private set
    var question by mutableIntStateOf(0); private set
    var questionStart by mutableDoubleStateOf(0.0); private set
    var examiner by mutableStateOf(Examiner.Idle); private set
    var prepLeft by mutableIntStateOf(PREP_SECONDS); private set
    var notes by mutableStateOf("")
    var uploads by mutableStateOf<List<UploadItem>>(emptyList()); private set
    var startError by mutableStateOf<String?>(null)
    var demoStates by mutableStateOf<Map<String, UploadState>>(emptyMap()); private set

    // Demo mode has no microphone to rely on (screenshots, the emulator): a synthetic voice feeds the same pipeline.
    val recorder = MicRecorder(synthetic = demo != null)
    val micCheck = MicRecorder(synthetic = demo != null)

    private val api get() = app.api
    private val store get() = app.pending
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val prefs = context.applicationContext.getSharedPreferences("ielts", Context.MODE_PRIVATE)
    /** Answer window of each question on the recording clock. */
    private var windows = mutableListOf<AnswerWindow>()
    private val player by lazy { AudioPlayer(context.applicationContext) }
    private var askJob: Job? = null
    private var introduced = -1
    private var recId = newSessionId()
    private val sessionId = newSessionId()
    private var parent: String? = null
    private var prepEnd = 0L
    private var prepJob: Job? = null
    private var starting = false

    /** The "tap to start" tip shows until the first recording has been made on this device. */
    var hintSeen by mutableStateOf(runCatching { prefs.getBoolean("micHintSeen", false) }.getOrDefault(false)); private set

    val current: Prompt? get() = items.getOrNull(index)
    val isFull get() = route.mode == "full"
    val recording get() = phase == Phase.Recording

    init { reload() }

    fun reload() {
        scope.launch { load() }
    }

    private suspend fun load() {
        phase = Phase.Loading
        try {
            when (route.mode) {
                "full" -> { val t: SpeakingTest = api.get("/api/speaking/test", mapOf("source" to app.speakingSourceParam())); items = t.part1 + t.part2 + t.part3 }
                "part" -> items = listOf(api.get<Prompt>("/api/prompts/random", mapOf("skill" to "speaking", "part" to route.part.toString(), "source" to app.speakingSourceParam())))
                else -> { items = listOf(api.get<Prompt>("/api/prompts/${route.promptId}")); parent = route.parentId }
            }
            phase = Phase.Ready
            if (demo != null) applyDemo(demo.screen) else introduce()
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiError) {
            if (e.status == 404) phase = Phase.Empty else { failMessage = e.message; phase = Phase.Failed }
        } catch (e: Exception) {
            failMessage = e.message ?: "Something went wrong."; phase = Phase.Failed
        }
    }

    // MARK: Examiner

    fun lineFor(p: Prompt, text: String) = p.audio?.questions?.firstOrNull { it.text == text }

    /**
     * The examiner reads [lines] (microphone held meanwhile, so the recording holds only the candidate), then the answer window opens
     * with a "Speak now" cue. No pause, seek or speed. A line without audio, a bad URL or a stalled load never blocks the test.
     */
    private fun ask(lines: List<AudioLine?>, resume: Boolean = true) {
        askJob?.cancel()
        askJob = scope.launch {
            val spoken = lines.filterNotNull().filter { it.url != null }
            if (spoken.isNotEmpty()) {
                examiner = Examiner.Asking
                recorder.paused = true
                for (l in spoken) {
                    // ponytail: demo mode has no examiner audio, so the line "plays" for about as long as it takes to say
                    if (demo != null) { delay(600L + 280L * l.text.split(' ').size); continue }
                    player.load(l.url!!); player.play()
                    withTimeoutOrNull(60_000) { player.ended.first { it } }
                }
            }
            if (!resume) { examiner = Examiner.Idle; return@launch }
            recorder.paused = false
            questionStart = recorder.elapsed
            examiner = Examiner.Cue
            delay(2500)
            if (examiner == Examiner.Cue) examiner = Examiner.Idle
        }
    }

    /** P2: the examiner introduces the card while the screen waits for the preparation tap. Part 1 and 3 after the first start by themselves (the mic permission is already granted). */
    private fun introduce() {
        val p = current ?: return
        if (introduced == index || (index == 0 && p.part != 2)) return
        introduced = index
        if (p.part == 2) ask(listOf(p.audio?.lead, lineFor(p, p.questions[0])), resume = false) else startRecording()
    }

    // MARK: Actions

    /** Part 2: one minute of preparation, then recording starts by itself. Wall clock, so a backgrounded app still ends prep on time. */
    fun beginPrep() {
        if (phase != Phase.Ready) return
        startError = null
        prepLeft = PREP_SECONDS
        prepEnd = android.os.SystemClock.elapsedRealtime() + PREP_SECONDS * 1000L
        phase = Phase.Prep
        prepJob = scope.launch {
            while (phase == Phase.Prep) {
                prepLeft = max(0, ceil((prepEnd - android.os.SystemClock.elapsedRealtime()) / 1000.0).toInt())
                if (prepLeft == 0) { startRecording(); return@launch }
                delay(250)
            }
        }
    }

    /** Needs the microphone permission already granted (the screen asks first). */
    fun startRecording() {
        if ((phase != Phase.Ready && phase != Phase.Prep) || starting) return
        starting = true
        startError = null
        prepJob?.cancel()
        micCheck.stop()
        store.prepare()
        val ok = recorder.start(store.audioFile(recId), startPaused = current?.part != 2)
        starting = false
        if (!ok) {
            startError = "Couldn't start recording. Is another app using the microphone?"
            phase = Phase.Ready
            return
        }
        runCatching { prefs.edit().putBoolean("micHintSeen", true).apply() }
        hintSeen = true
        windows = mutableListOf()
        question = 0
        questionStart = 0.0
        phase = Phase.Recording
        val p = current ?: return
        if (p.part == 2) {
            examiner = Examiner.Cue // the card was introduced before the preparation minute
            askJob?.cancel()
            askJob = scope.launch { delay(2500); if (examiner == Examiner.Cue) examiner = Examiner.Idle }
        } else {
            ask(listOf(if (index == 0 && p.part == 1 && items.size > 1) p.audio?.intro else null, p.audio?.lead, lineFor(p, p.questions[0])))
        }
    }

    /** True when the recording must stop now: P2 hard stop at 2:00, the 15 min cap for any part. */
    fun hitLimit(elapsed: Double): Boolean {
        val p = current ?: return false
        return (p.part == 2 && elapsed >= P2_MAX_SECONDS) || elapsed >= MAX_RECORDING_SECONDS
    }

    fun nextQuestion() {
        if (examiner == Examiner.Asking) return
        windows.add(AnswerWindow(question, (questionStart * 1000).toInt(), (recorder.elapsed * 1000).toInt()))
        question += 1
        current?.let { p -> ask(listOf(lineFor(p, p.questions[question]))) }
    }

    /** Stops, keeps the recording on disk, uploads it in the background and moves on. */
    fun finishPart() {
        if (phase != Phase.Recording) return
        val p = current ?: return
        if (examiner == Examiner.Asking) return
        windows.add(AnswerWindow(question, (questionStart * 1000).toInt(), (recorder.elapsed * 1000).toInt()))
        askJob?.cancel()
        examiner = Examiner.Idle
        val r = recorder.stop()
        if (!store.audioFile(recId).exists()) {
            startError = "Nothing was recorded. Check your microphone and try again."
            phase = Phase.Ready
            return
        }
        val rec = PendingRecording(
            id = recId, promptId = p.id, part = p.part, label = "${partLabel(items, index)}: ${p.topic ?: p.title}",
            createdAt = System.currentTimeMillis(), durationMs = r.durationMs, energy = r.energy.take(20000), marks = windows.map { it.startMs }.take(200), segments = windows.take(200),
            sessionId = if (isFull) sessionId else null, parentAttemptId = parent,
        )
        store.add(rec)
        uploads = uploads + UploadItem(rec.id, rec.label)
        store.start(rec, api)
        if (index + 1 < items.size) {
            index += 1
            question = 0
            notes = ""
            recId = newSessionId()
            phase = Phase.Ready
            introduce()
        } else {
            phase = Phase.Finishing
        }
    }

    fun retry(u: UploadItem) {
        store.items.value.firstOrNull { it.id == u.id }?.let { store.start(it, api) }
    }

    /** Drop a recording in progress (it was never kept) and the mic test. */
    fun discardLive() {
        prepJob?.cancel()
        askJob?.cancel()
        runCatching { player.pause() }
        examiner = Examiner.Idle
        if (recorder.isRecording) {
            recorder.stop()
            store.audioFile(recId).delete()
        }
        micCheck.stop()
    }

    override fun onCleared() {
        discardLive()
        runCatching { player.release() }
        scope.cancel()
    }

    // MARK: Screenshots

    /** Demo mode: show a state without a microphone. [screen] is the screenshot name (`session-prep`, `session-recording`, ...). */
    private fun applyDemo(screen: String?) {
        val part = current?.part ?: 1
        when {
            screen == "session-prep" -> { prepLeft = 38; phase = Phase.Prep }
            screen?.startsWith("session-recording") == true -> {
                recorder.demo(elapsed = if (part == 2) 78.0 else 24.0, wpm = 146)
                notes = "books, change my mind, teacher gave it, 2019, empathy"
                question = if (part == 2) 0 else 1
                questionStart = 12.0
                phase = Phase.Recording
            }
            screen == "session-mic" -> micCheck.demo(3.0, loud = 25)
            screen == "session-saving" -> {
                uploads = items.mapIndexed { i, p -> UploadItem("demo-$i", "${partLabel(items, i)}: ${p.topic ?: p.title}") }
                demoStates = mapOf("demo-0" to UploadState.Done("as1"), "demo-2" to UploadState.Failed("Audio upload failed. Check your connection and retry."))
                phase = Phase.Finishing
            }
        }
    }
}
