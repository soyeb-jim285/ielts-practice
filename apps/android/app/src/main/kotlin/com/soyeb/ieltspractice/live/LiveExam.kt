package com.soyeb.ieltspractice.live

import android.os.SystemClock
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import com.soyeb.ieltspractice.AppContainer
import com.soyeb.ieltspractice.audio.ExaminerVoice
import com.soyeb.ieltspractice.audio.LiveAudio
import com.soyeb.ieltspractice.audio.MicRecorder
import com.soyeb.ieltspractice.audio.PartRecording
import com.soyeb.ieltspractice.audio.Vad
import com.soyeb.ieltspractice.core.ApiError
import com.soyeb.ieltspractice.core.DemoConfig
import com.soyeb.ieltspractice.core.FinishResult
import com.soyeb.ieltspractice.core.LiveReply
import com.soyeb.ieltspractice.core.Prompt
import com.soyeb.ieltspractice.core.RealtimeToken
import com.soyeb.ieltspractice.core.SpeakingTest
import com.soyeb.ieltspractice.core.UploadTarget
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
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
import java.util.UUID

/** Which examiner runs (iOS `Examiner`). */
enum class Examiner { Turn, OpenAI, Gemini }

sealed interface LiveStage {
    data object Ready : LiveStage
    data object Running : LiveStage
    data object Uploading : LiveStage
    data class Finished(val ids: List<String>) : LiveStage
    data class Failed(val message: String) : LiveStage
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

/** Errors the Realtime provider raises when a cancel finds nothing to cancel: expected, not shown. */
fun isExpectedRealtimeError(message: String) = Regex("cancel|no active response|empty", RegexOption.IGNORE_CASE).containsMatchIn(message)

/**
 * Live examiner session (iOS LiveExam, web src/live). Turn-based: the server drives phases via /api/live/turn (examiner TTS, candidate
 * turns ended by VAD). Realtime: OpenAI Realtime or Gemini Live over WebSocket with client-timed part changes. All record one m4a per
 * part and finish with /api/live/finish. A ViewModel, so rotating the phone does not end the test.
 */
class LiveExam(private val app: AppContainer, private val cacheDir: File, private val demo: DemoConfig?) : ViewModel() {
    var stage by mutableStateOf<LiveStage>(LiveStage.Ready); private set
    var phase by mutableStateOf("intro"); private set
    var phaseStartedAt by mutableLongStateOf(SystemClock.elapsedRealtime()); private set
    var testStartedAt by mutableLongStateOf(SystemClock.elapsedRealtime()); private set
    var caption by mutableStateOf(""); private set
    var voiceError by mutableStateOf<String?>(null); private set // examiner TTS failed: captions are forced on and a banner explains why
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
    var fellBack by mutableStateOf(false); private set // the Realtime provider couldn't connect, so the turn-based examiner runs instead
    var notes by mutableStateOf("")

    val mic = MicRecorder()
    private val api get() = app.api
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var audio: LiveAudio? = null
    private val voice = ExaminerVoice()
    private var socket: DuplexSocket? = null
    private var run: kotlinx.coroutines.Job? = null
    private var vad = Vad()
    private var turnEnded: CompletableDeferred<Unit>? = null
    private var sessionId = ""
    private var test: SpeakingTest? = null
    private var currentPart: Int? = null
    private val recordings = sortedMapOf<Int, PartRecording>()
    private var ending = false
    private var micLoudSeconds = 0.0
    private var vadOn = false // turn-based turns end on silence; the Part 2 long turn never does
    private var talkTimeUp = false
    private var answeredFlag = false // the candidate finished an answer (Realtime)
    private var heardFlag = false // Gemini: the candidate spoke since the last cue or answer
    private var freshTurn = true // Gemini: the next examiner output starts a new turn

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

    fun start(kind: Examiner) {
        mic.stop()
        val a = LiveAudio(if (kind == Examiner.Gemini) 16_000 else 24_000)
        a.onLevel = { l, dt -> scope.launch { onLevel(l, dt) } }
        if (!a.start()) { micReady = false; micError = "The microphone couldn't start. Close other apps that use it and try again."; return }
        audio = a
        testStartedAt = SystemClock.elapsedRealtime()
        stage = LiveStage.Running
        run = scope.launch { if (kind == Examiner.Turn) runTurnBased() else runDuplex(kind) }
    }

    /** "I'm done": end the candidate's turn now. */
    fun endTurn() { turnEnded?.complete(Unit); turnEnded = null }

    /** After a failure: upload and score whatever parts were recorded. */
    fun scoreRecorded() { scope.launch { finish() } }

    fun endTest() {
        ending = true
        run?.cancel()
        endTurn()
        voice.stop()
    }

    override fun onCleared() {
        run?.cancel()
        voice.stop()
        socket?.close()
        audio?.stop()
        mic.stop()
        scope.cancel()
    }

    private fun onLevel(l: Double, dt: Double) {
        level = l
        examinerTalking = voice.isPlaying || audio?.examinerSpeaking == true
        if (listening && vadOn && vad.feed(l, dt)) endTurn()
    }

    private fun enterPhase(p: String) {
        if (p != phase) phaseStartedAt = SystemClock.elapsedRealtime()
        phase = p
        val part = mapOf("p1" to 1, "p2-talk" to 2, "p2-follow" to 2, "p3" to 3)[p]
        if (part == currentPart) return
        closePart()
        if (part != null) {
            runCatching { audio?.beginPart(File(cacheDir, "live-$sessionId-p$part.m4a")) }
            currentPart = part
        }
    }

    private fun closePart() {
        currentPart?.let { p -> audio?.endPart()?.let { recordings[p] = it } }
        currentPart = null
    }

    private suspend fun uploadFile(file: File): String {
        val t: UploadTarget = api.send("POST", "/api/live/upload-url", buildJsonObject { put("sessionId", sessionId); put("audioContentType", "audio/mp4") })
        api.upload(t.uploadUrl, file, "audio/mp4")
        return t.key
    }

    // MARK: Turn-based

    private suspend fun runTurnBased() {
        try {
            var reply: LiveReply = api.send("POST", "/api/live/start", buildJsonObject {})
            sessionId = reply.sessionId.orEmpty()
            test = reply.test
            while (true) {
                enterPhase(reply.phase)
                reply.cueCard?.let { cueCard = it }
                voiceError = if (reply.audioUrl == null) reply.voiceError else null
                speak(reply.examinerText, reply.audioUrl)
                if (reply.phase == "done" || reply.phase == "closing") break
                if (reply.phase == "p2-prep") {
                    countdown(reply.prepSeconds ?: 60)
                    reply = api.send("POST", "/api/live/turn", buildJsonObject { put("sessionId", sessionId); put("skipped", true) })
                    continue
                }
                val talk = reply.phase == "p2-talk"
                val key = recordTurn(if (talk) 120.0 else 90.0, if (talk) 3.0 else 1.2)
                thinking = true
                reply = api.send("POST", "/api/live/turn", buildJsonObject {
                    put("sessionId", sessionId)
                    if (key != null) put("audioKey", key) else put("skipped", true)
                })
                thinking = false
            }
        } catch (e: CancellationException) {
            if (!ending) throw e
        } catch (e: Exception) {
            if (!ending) { stage = LiveStage.Failed(e.message ?: "Something went wrong."); return }
        }
        finish()
    }

    private suspend fun speak(text: String, audioUrl: String?) {
        caption = text
        val a = audio
        a?.capturing = false
        try {
            val bytes = audioUrl?.let { runCatching { api.download(it) }.getOrNull() }
            if (bytes != null && bytes.isNotEmpty()) {
                val f = File(cacheDir, "examiner-${UUID.randomUUID()}.mp3")
                try { withContext(Dispatchers.IO) { f.writeBytes(bytes) }; voice.playToEnd(f) } finally { f.delete() }
            } else {
                delay(2000)
            }
        } finally {
            a?.capturing = true
        }
    }

    /** Records one candidate turn until VAD silence, "I'm done", or the time limit. Returns the uploaded key (null if silent). */
    private suspend fun recordTurn(maxSeconds: Double, endAfter: Double): String? {
        val a = audio ?: return null
        val file = File(cacheDir, "turn-${UUID.randomUUID()}.m4a")
        a.beginTurn(file)
        vad = Vad(endAfter = endAfter)
        vadOn = true
        listening = true
        val limit = scope.launch { delay((maxSeconds * 1000).toLong()); endTurn() }
        try {
            val d = CompletableDeferred<Unit>().also { turnEnded = it }
            d.await()
        } finally {
            limit.cancel()
            listening = false
            vadOn = false
        }
        val heard = vad.heardSpeech
        val f = a.endTurn()
        return if (f != null && heard) uploadFile(f) else null
    }

    private suspend fun countdown(seconds: Int) {
        prepLeft = seconds
        val a = audio
        a?.capturing = false
        try {
            while (prepLeft > 0) { delay(1000); prepLeft -= 1 }
        } finally {
            a?.capturing = true
        }
    }

    // MARK: Realtime (OpenAI Realtime, Gemini Live)

    private suspend fun runDuplex(kind: Examiner) {
        try {
            val s: LiveReply = api.send("POST", "/api/live/start", buildJsonObject { put("skipTts", true) })
            sessionId = s.sessionId.orEmpty()
            test = s.test
            try {
                socket = connectDuplex(kind)
            } catch (e: Exception) {
                if (ending || e is CancellationException) throw e
                // The provider couldn't connect (token, network, key): the turn-based examiner runs the same test.
                fellBack = true
                audio?.onPcm16 = null
                runTurnBased()
                return
            }
            val sock = socket ?: return

            enterPhase("p1")
            delay(270_000)

            enterPhase("p2-prep")
            cueCard = test?.part2
            sock.hear(false, false)
            cue("Part 1 is over. Move to Part 2 now: give the Part 2 instructions and the topic, then stay silent while the candidate prepares.")
            delay(8000)
            countdown(60)

            enterPhase("p2-talk")
            sock.hear(false, true)
            cue("The preparation minute is over. Ask the candidate to start speaking now, then stay silent until you are told the talk is over.")
            val timeUp = waitTalk(125.0)

            enterPhase("p2-follow")
            cue(
                if (timeUp) "The two minutes are up. Say \"Thank you. That's the end of your time.\" and ask the rounding-off question."
                else "The candidate has finished their talk. Say \"Thank you.\" and ask the rounding-off question.",
                heard = true,
            )
            sock.hear(true, false)
            waitAnswered(45_000)

            enterPhase("p3") // the examiner moves from the rounding-off answer into Part 3 by itself
            delay(270_000)

            enterPhase("closing")
            cue("The test is over. Say the closing line now and nothing more.")
            delay(8000)
        } catch (e: CancellationException) {
            if (!ending) throw e
        } catch (e: Exception) {
            if (!ending) { stage = LiveStage.Failed(e.message ?: "Something went wrong."); return }
        }
        finish()
    }

    private suspend fun connectDuplex(kind: Examiner): DuplexSocket {
        val a = audio ?: throw ApiError(0, "No microphone input available.")
        if (kind == Examiner.Gemini) {
            val token: GeminiToken = api.send("POST", "/api/live/gemini-token", buildJsonObject { put("sessionId", sessionId) })
            val sock = GeminiLiveSocket()
            sock.onEvent = { ev -> scope.launch { handleGemini(ev) } }
            sock.onLost = { scope.launch { connectionLost() } }
            a.onPcm16 = { pcm -> sock.appendAudio(pcm) }
            try {
                sock.connect(token.value, token.model ?: "gemini-3.8-live")
            } catch (e: Exception) {
                sock.close()
                throw e
            }
            sock.cue("Begin the test.") // the examiner opens with the introduction
            return sock
        }
        val token: RealtimeToken = api.send("POST", "/api/live/realtime-token", buildJsonObject { put("sessionId", sessionId) })
        val sock = RealtimeSocket()
        sock.onEvent = { type, event -> handleRealtime(type, event) }
        sock.onClose = { err -> if (err != null) scope.launch { connectionLost() } }
        a.onPcm16 = { pcm -> sock.appendAudio(pcm) }
        sock.connect(token.value, token.model ?: "gpt-realtime-2.1")
        sock.send(buildJsonObject { put("type", "response.create") }) // the examiner opens with the introduction
        return sock
    }

    private fun connectionLost() {
        if (stage == LiveStage.Running && !ending) caption = "The connection to the examiner was lost. End the test to score what you have recorded."
    }

    /** Cuts the examiner off locally (the provider interrupts its own generation) and gives it an instruction. */
    private fun cue(text: String, heard: Boolean = false) {
        audio?.stopPlayback()
        heardFlag = false
        freshTurn = true
        socket?.cue(text, heard)
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

    /** OpenAI Realtime events (called on the socket's thread: audio goes straight to the player, state hops to the main thread). */
    private fun handleRealtime(type: String, event: JsonObject) {
        when (type) {
            "response.output_audio.delta", "response.audio.delta" -> {
                val b = (event["delta"] as? JsonPrimitive)?.content?.let { runCatching { java.util.Base64.getDecoder().decode(it) }.getOrNull() }
                if (b != null) audio?.playPcm16(b)
            }
            "response.created" -> scope.launch { caption = "" }
            "response.output_audio_transcript.delta", "response.audio_transcript.delta" -> {
                val t = (event["delta"] as? JsonPrimitive)?.content
                if (t != null) scope.launch { caption += t }
            }
            "input_audio_buffer.speech_stopped" -> scope.launch { answeredFlag = true }
            "error" -> {
                // Cancelling when nothing is playing is expected. ponytail: the provider's detail is for logs, not the candidate.
                val msg = ((event["error"] as? JsonObject)?.get("message") as? JsonPrimitive)?.content.orEmpty()
                if (!isExpectedRealtimeError(msg)) {
                    scope.launch { caption = "The examiner had trouble responding. Wait a moment, or end the test to score what you have recorded." }
                }
            }
        }
    }

    /** Gemini Live: examiner audio and captions arrive per turn; a new turn after the candidate spoke is the examiner replying to an answer. */
    private fun handleGemini(ev: GeminiLive.Event) {
        when (ev) {
            is GeminiLive.Event.Audio -> { geminiTurn(); audio?.playPcm16(ev.pcm) }
            is GeminiLive.Event.OutText -> { geminiTurn(); caption += ev.text }
            is GeminiLive.Event.InText -> heardFlag = true
            GeminiLive.Event.Interrupted -> { audio?.stopPlayback(); freshTurn = true }
            GeminiLive.Event.TurnComplete -> freshTurn = true
            else -> {}
        }
    }

    private fun geminiTurn() {
        if (!freshTurn) return
        freshTurn = false
        caption = ""
        if (heardFlag) { heardFlag = false; answeredFlag = true }
    }

    // MARK: Finish

    private suspend fun finish() = withContext(NonCancellable) {
        closePart()
        socket?.close()
        audio?.stop()
        voice.stop()
        stage = LiveStage.Uploading
        try {
            val parts = ArrayList<JsonObject>()
            for ((part, r) in recordings) {
                val key = uploadFile(r.file)
                parts += buildJsonObject {
                    put("part", part); put("audioKey", key); put("durationMs", r.durationMs)
                    putJsonArray("energy") { r.energy.take(20000).forEach { add(JsonPrimitive(it)) } }
                }
            }
            if (parts.isEmpty()) { stage = LiveStage.Failed("Nothing was recorded, so there's nothing to score."); return@withContext }
            val res: FinishResult = api.send("POST", "/api/live/finish", buildJsonObject {
                put("sessionId", sessionId)
                put("parts", buildJsonArray { parts.forEach { add(it) } })
            })
            stage = LiveStage.Finished(res.attemptIds)
        } catch (e: Exception) {
            stage = LiveStage.Failed(e.message ?: "Something went wrong.")
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
