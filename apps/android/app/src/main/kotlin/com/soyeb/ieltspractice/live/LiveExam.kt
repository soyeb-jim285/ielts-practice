package com.soyeb.ieltspractice.live

import android.content.Context
import android.os.SystemClock
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import com.soyeb.ieltspractice.AppContainer
import com.soyeb.ieltspractice.audio.LiveAudio
import com.soyeb.ieltspractice.audio.MicRecorder
import com.soyeb.ieltspractice.audio.PartRecording
import com.soyeb.ieltspractice.core.ApiError
import com.soyeb.ieltspractice.core.DemoConfig
import com.soyeb.ieltspractice.core.FinishResult
import com.soyeb.ieltspractice.core.GateText
import com.soyeb.ieltspractice.core.LiveStart
import com.soyeb.ieltspractice.core.Prompt
import com.soyeb.ieltspractice.core.SpeakingTest
import com.soyeb.ieltspractice.core.UploadTarget
import com.soyeb.ieltspractice.core.mockAttach
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import java.io.File
import java.util.Calendar

sealed interface LiveStage {
    data object Ready : LiveStage
    data object Running : LiveStage
    data object Uploading : LiveStage
    data class Finished(val ids: List<String>) : LiveStage
    /** [error] is set when the server refused (no tests left): the screen shows the limit panel for it. */
    data class Failed(val message: String, val error: ApiError? = null) : LiveStage
}

/** Web LiveStage PHASE_LABEL. */
fun phaseLabel(phase: String) = when (phase) {
    "intro" -> "Introduction"
    "p1" -> "Part 1: Introduction and interview"
    "p2-prep" -> "Part 2: Preparation"
    "p2-talk", "p2-follow" -> "Part 2: Long turn"
    "p3" -> "Part 3: Discussion"
    else -> "End of the test"
}

/**
 * Live examiner session (iOS LiveExam, web live/duplex.ts): the LiveKit examiner runs the script, client timers drive the part changes with
 * cues, and the app records one m4a per part and finishes with /api/live/finish. A ViewModel, so rotating the phone does not end the test.
 */
class LiveExam(private val app: AppContainer, private val context: Context, private val demo: DemoConfig?, private val mockId: String? = null) : ViewModel() {
    var stage by mutableStateOf<LiveStage>(LiveStage.Ready); private set
    var phase by mutableStateOf("intro"); private set
    var phaseStartedAt by mutableLongStateOf(SystemClock.elapsedRealtime()); private set
    var testStartedAt by mutableLongStateOf(SystemClock.elapsedRealtime()); private set
    var caption by mutableStateOf(""); private set
    var level by mutableDoubleStateOf(0.0); private set
    var listening by mutableStateOf(false); private set
    var thinking by mutableStateOf(false); private set
    var examinerTalking by mutableStateOf(false); private set
    var cueCard by mutableStateOf<Prompt?>(null); private set
    var prepLeft by mutableIntStateOf(0); private set
    var micDenied by mutableStateOf(false)
    var micReady by mutableStateOf(false); private set // the mic check is running
    var micChecking by mutableStateOf(false); private set
    var micHeard by mutableStateOf(false); private set // enough speech-level input during the check to say "we can hear you"
    var micError by mutableStateOf<String?>(null); private set
    var notes by mutableStateOf("")

    val mic = MicRecorder()
    private val api get() = app.api
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val audio = LiveAudio().also { a -> a.onLevel = { l -> scope.launch { level = l } } }
    private var examiner: LiveKitExaminer? = null
    private var run: kotlinx.coroutines.Job? = null
    private var turnEnded: CompletableDeferred<Unit>? = null
    private var sessionId = ""
    private var test: SpeakingTest? = null
    private var currentPart: Int? = null
    private val recordings = sortedMapOf<Int, PartRecording>()
    private var ending = false
    private var micLoudSeconds = 0.0
    private var talkTimeUp = false
    private var answeredFlag = false // the candidate finished an answer

    val hasRecordings get() = recordings.isNotEmpty() || currentPart != null

    init { if (demo != null) applyDemo(demo.screen) }

    /** Web LiveStage STATUS_TEXT, derived from what the examiner and the mic are doing. */
    val statusText: String
        get() = when {
            stage == LiveStage.Uploading -> "Uploading your recordings"
            thinking -> "The examiner is thinking"
            examinerTalking -> "The examiner is speaking"
            phase == "p2-prep" -> "Use this minute to prepare"
            listening -> "Your turn. Answer when you are ready"
            else -> if (caption.isEmpty()) "Connecting to your examiner" else ""
        }

    /** Mic check on the pre-screen (call once the permission is granted). Safe to call again to retry. */
    fun beginMicCheck() {
        if (micReady || micChecking) return
        micChecking = true
        micError = null
        micLoudSeconds = 0.0
        val ok = mic.start { l, dt -> scope.launch { onMicCheckLevel(l, dt) } }
        micChecking = false
        if (ok) micReady = true else micError = "The microphone couldn't start. Close other apps that use it and try again."
    }

    private fun onMicCheckLevel(l: Double, dt: Double) {
        level = l
        if (stage == LiveStage.Ready && !micHeard) {
            if (l > 0.25) micLoudSeconds += dt
            micHeard = micLoudSeconds >= 0.6
        }
    }

    /** Starts the test, or reconnects the examiner after a failure that recorded nothing (the same session when it was created). */
    fun start() {
        mic.stop()
        phase = "intro"
        caption = ""
        testStartedAt = SystemClock.elapsedRealtime()
        stage = LiveStage.Running
        run = scope.launch { runLive() }
    }

    /** "I'm done": end the Part 2 long turn now. */
    fun endTurn() { turnEnded?.complete(Unit); turnEnded = null }

    /** After a failure: upload and score whatever parts were recorded. */
    fun scoreRecorded() { scope.launch { finish() } }

    fun endTest() {
        ending = true
        run?.cancel()
        endTurn()
    }

    override fun onCleared() {
        run?.cancel()
        examiner?.close()
        audio.stop()
        mic.stop()
        scope.cancel()
    }

    private fun enterPhase(p: String) {
        if (p != phase) phaseStartedAt = SystemClock.elapsedRealtime()
        phase = p
        val part = mapOf("p1" to 1, "p2-talk" to 2, "p2-follow" to 2, "p3" to 3)[p]
        if (part == currentPart) return
        closePart()
        if (part != null) {
            runCatching { audio.beginPart(File(context.cacheDir, "live-$sessionId-p$part.m4a")) }
            currentPart = part
        }
    }

    private fun closePart() {
        currentPart?.let { p -> audio.endPart()?.let { recordings[p] = it; send(p) } }
        currentPart = null
    }

    /** Upload keys per part (an upload is never repeated), and the parts sent with /live/part while the test went on: true once its attempt exists. */
    private val keys = mutableMapOf<Int, String>()
    private val sent = mutableMapOf<Int, Deferred<Boolean>>()

    /** The /live body of one part, uploading its recording first if that has not happened yet. */
    private suspend fun partBody(part: Int, r: PartRecording): JsonObject {
        val key = keys[part] ?: uploadFile(r.file).also { keys[part] = it }
        return buildJsonObject {
            put("part", part); put("audioKey", key); put("durationMs", r.durationMs)
            putJsonArray("energy") { r.energy.take(20000).forEach { add(JsonPrimitive(it)) } }
        }
    }

    /** Sends a finished part now, so its analysis runs while the test goes on (web live/turn.ts). Best effort: a failure leaves it to [finish]. */
    private fun send(part: Int) {
        val r = recordings[part] ?: return
        if (sessionId.isEmpty() || demo != null || part in sent) return
        sent[part] = scope.async {
            try {
                val body = partBody(part, r)
                api.send<JsonObject>("POST", "/api/live/part", buildJsonObject { put("sessionId", sessionId); put("part", body) })
                true
            } catch (e: CancellationException) { throw e } catch (_: Exception) { false }
        }
    }

    private suspend fun uploadFile(file: File): String {
        val t: UploadTarget = api.send("POST", "/api/live/upload-url", buildJsonObject { put("sessionId", sessionId); put("audioContentType", "audio/mp4") })
        api.upload(t.uploadUrl, file, "audio/mp4")
        return t.key
    }

    /** A failure as the screen shows it: a refused test keeps the server's error for the limit panel. */
    private fun failed(e: Exception): LiveStage.Failed =
        if (e is ApiError && e.isLimit) LiveStage.Failed(GateText.sentence(e, "Nothing was recorded."), e) else LiveStage.Failed(e.message ?: "Something went wrong.")

    private suspend fun countdown(seconds: Int) {
        prepLeft = seconds
        audio.capturing = false
        try {
            while (prepLeft > 0) { delay(1000); prepLeft -= 1 }
        } finally {
            audio.capturing = true
        }
    }

    // MARK: The test

    private suspend fun runLive() {
        try {
            if (sessionId.isEmpty()) {
                val s: LiveStart = api.send("POST", "/api/live/start", buildJsonObject { app.speakingSourceParam()?.let { put("source", it) }; mockId?.let { put("mockId", it) }; put("localHour", Calendar.getInstance().get(Calendar.HOUR_OF_DAY)) })
                sessionId = s.sessionId
                test = s.test
            }
            val join: LiveKitJoin = api.send("POST", "/api/live/livekit/start", buildJsonObject { put("sessionId", sessionId) })
            val x = LiveKitExaminer(context, audio, scope).also { examiner = it }
            x.onCaption = { text, append -> caption = if (append) "$caption $text" else text }
            x.onAnswered = { answeredFlag = true; if (phase != "p2-talk") thinking = true }
            x.onSpeaking = { on -> examinerTalking = on; audio.examinerSpeaking = on; if (on) thinking = false }
            x.onLost = ::lost
            x.connect(join) // the examiner opens with the introduction

            enterPhase("p1") // the examiner moves from the introduction into Part 1 by itself
            delay(270_000)

            x.configure(2)
            enterPhase("p2-prep")
            cueCard = test?.part2
            x.listen(false)
            x.cue(Cue.PART2, "part2")
            delay(8000)
            countdown(60)

            enterPhase("p2-talk")
            x.listen(false, fresh = true)
            x.cue(Cue.TALK, "talk")
            val timeUp = waitTalk(125.0)

            enterPhase("p2-follow")
            if (timeUp) x.cue(Cue.FOLLOW_TIMEUP, "follow-timeup") else x.cue(Cue.FOLLOW, "follow")
            x.listen(true)
            waitAnswered(45_000)

            x.configure(3)
            enterPhase("p3") // the examiner moves from the rounding-off answer into Part 3 by itself
            delay(270_000)

            enterPhase("closing")
            x.cue(Cue.CLOSING, "closing")
            delay(8000)
        } catch (e: CancellationException) {
            if (!ending) throw e
        } catch (e: Exception) {
            if (!ending) { examiner?.close(); stage = failed(e); return }
        }
        finish()
    }

    /** The room dropped or the worker failed. There is no other examiner to fall back to: score what was recorded, or reconnect. */
    private fun lost() {
        if (stage != LiveStage.Running || ending) return
        run?.cancel()
        turnEnded = null
        listening = false
        thinking = false
        examinerTalking = false
        audio.examinerSpeaking = false
        stage = LiveStage.Failed("The connection to the examiner dropped." + if (hasRecordings) " The parts you recorded are safe." else "")
    }

    /** The Part 2 long turn: ends at the time limit or on "I'm done", never on a pause. True if the time ran out. */
    private suspend fun waitTalk(seconds: Double): Boolean {
        talkTimeUp = false
        listening = true
        val limit = scope.launch { delay((seconds * 1000).toLong()); talkTimeUp = true; endTurn() }
        try {
            val d = CompletableDeferred<Unit>().also { turnEnded = it }
            d.await()
        } finally {
            limit.cancel()
            listening = false
        }
        return talkTimeUp
    }

    /** Waits for the candidate to finish answering the rounding-off question (or the timeout). */
    private suspend fun waitAnswered(timeoutMs: Long) {
        answeredFlag = false
        val end = SystemClock.elapsedRealtime() + timeoutMs
        while (!answeredFlag && SystemClock.elapsedRealtime() < end) delay(250)
    }

    // MARK: Finish

    private suspend fun finish() = withContext(NonCancellable) {
        closePart()
        examiner?.close()
        audio.stop()
        stage = LiveStage.Uploading
        try {
            if (recordings.isEmpty()) { stage = LiveStage.Failed("Nothing was recorded, so there's nothing to score."); return@withContext }
            // parts already sent during the test are not sent again (their analysis is running); a failed send is retried here
            val done = sent.filter { (_, job) -> runCatching { job.await() }.getOrDefault(false) }.keys
            val parts = ArrayList<JsonObject>()
            for ((part, r) in recordings) if (part !in done) parts += partBody(part, r)
            val res: FinishResult = api.send("POST", "/api/live/finish", buildJsonObject {
                put("sessionId", sessionId)
                put("parts", buildJsonArray { parts.forEach { add(it) } })
            })
            // A mock test: link the finished session to it (a second try covers a dropped connection) before the screen returns to the hub.
            if (mockId != null) {
                var attached = false
                repeat(2) { if (!attached) attached = runCatching { api.mockAttach(mockId, sessionId) }.isSuccess }
            }
            stage = LiveStage.Finished(res.attemptIds)
        } catch (e: Exception) {
            stage = failed(e)
        }
    }

    // MARK: Screenshots

    /** Demo mode: show a state without a microphone or a session. [screen] is the screenshot name (`live`, `live-heard`, `live-intro`, `live-prep`, `live-talk`, `live-failed`). */
    private fun applyDemo(screen: String?) {
        micReady = true
        level = 0.35
        micHeard = screen == "live-heard"
        if (screen == null || screen == "live" || screen == "live-heard") return
        stage = if (screen == "live-failed") LiveStage.Failed("The connection to the examiner was lost.") else LiveStage.Running
        phase = when (screen) { "live-prep" -> "p2-prep"; "live-talk" -> "p2-talk"; else -> "p1" }
        testStartedAt = SystemClock.elapsedRealtime() - 95_000
        phaseStartedAt = SystemClock.elapsedRealtime() - 47_000
        caption = "Let's talk about where you grew up. Where is your hometown?"
        examinerTalking = screen == "live-intro"
        listening = screen == "live-talk"
        prepLeft = 38
        if (screen == "live-prep" || screen == "live-talk") {
            scope.launch { runCatching { api.get<SpeakingTest>("/api/speaking/test") }.getOrNull()?.let { cueCard = it.part2 } }
        }
    }
}
