package com.soyeb.ieltspractice.ui.screens.speaking

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import com.soyeb.ieltspractice.AppContainer
import com.soyeb.ieltspractice.audio.MicRecorder
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
import kotlinx.coroutines.launch
import kotlin.math.ceil
import kotlin.math.max

enum class Phase { Loading, Ready, Prep, Recording, Finishing, Empty, Failed }

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
    var prepLeft by mutableIntStateOf(PREP_SECONDS); private set
    var notes by mutableStateOf("")
    var uploads by mutableStateOf<List<UploadItem>>(emptyList()); private set
    var startError by mutableStateOf<String?>(null)
    var demoStates by mutableStateOf<Map<String, UploadState>>(emptyMap()); private set

    val recorder = MicRecorder()
    val micCheck = MicRecorder()

    private val api get() = app.api
    private val store get() = app.pending
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val prefs = context.applicationContext.getSharedPreferences("ielts", Context.MODE_PRIVATE)
    private var marks = mutableListOf(0)
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
                "full" -> { val t: SpeakingTest = api.get("/api/speaking/test"); items = t.part1 + t.part2 + t.part3 }
                "part" -> items = listOf(api.get<Prompt>("/api/prompts/random", mapOf("skill" to "speaking", "part" to route.part.toString())))
                else -> { items = listOf(api.get<Prompt>("/api/prompts/${route.promptId}")); parent = route.parentId }
            }
            phase = Phase.Ready
            if (demo != null) applyDemo(demo.screen)
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiError) {
            if (e.status == 404) phase = Phase.Empty else { failMessage = e.message; phase = Phase.Failed }
        } catch (e: Exception) {
            failMessage = e.message ?: "Something went wrong."; phase = Phase.Failed
        }
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
        val ok = recorder.start(store.audioFile(recId))
        starting = false
        if (!ok) {
            startError = "Couldn't start recording. Is another app using the microphone?"
            phase = Phase.Ready
            return
        }
        runCatching { prefs.edit().putBoolean("micHintSeen", true).apply() }
        hintSeen = true
        marks = mutableListOf(0)
        question = 0
        questionStart = 0.0
        phase = Phase.Recording
    }

    /** True when the recording must stop now: P2 hard stop at 2:00, the 15 min cap for any part. */
    fun hitLimit(elapsed: Double): Boolean {
        val p = current ?: return false
        return (p.part == 2 && elapsed >= P2_MAX_SECONDS) || elapsed >= MAX_RECORDING_SECONDS
    }

    fun nextQuestion() {
        marks.add((recorder.elapsed * 1000).toInt())
        questionStart = recorder.elapsed
        question += 1
    }

    /** Stops, keeps the recording on disk, uploads it in the background and moves on. */
    fun finishPart() {
        if (phase != Phase.Recording) return
        val p = current ?: return
        val r = recorder.stop()
        if (!store.audioFile(recId).exists()) {
            startError = "Nothing was recorded. Check your microphone and try again."
            phase = Phase.Ready
            return
        }
        val rec = PendingRecording(
            id = recId, promptId = p.id, part = p.part, label = "${partLabel(items, index)}: ${p.topic ?: p.title}",
            createdAt = System.currentTimeMillis(), durationMs = r.durationMs, energy = r.energy.take(20000), marks = marks.take(200),
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
        if (recorder.isRecording) {
            recorder.stop()
            store.audioFile(recId).delete()
        }
        micCheck.stop()
    }

    override fun onCleared() {
        discardLive()
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
