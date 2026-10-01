package com.soyeb.ieltspractice.live

import com.soyeb.ieltspractice.core.ApiError
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

// Duplex examiner transports (ports of iOS Audio/GPTLiveSocket.swift and GeminiLiveSocket.swift; the wire formats are in
// docs/live-examiner.md). Plain OkHttp WebSockets. GPT-Live goes through OUR server's relay with the user's bearer token; Gemini Live
// connects directly with a short-lived token from /api/live/gemini-token.

@Serializable data class GeminiToken(val value: String, val model: String? = null)

/** What the live exam needs from a duplex provider (GPT-Live through our relay, or Gemini Live). */
interface DuplexSocket {
    /** PCM16 mono mic audio at the rate the exam captures at. */
    fun appendAudio(pcm: ByteArray)
    /** Interrupt the examiner and give it an instruction. [key] names the script moment (GPT-Live: the server owns the wording and ignores [text]).
     *  [heard]: it should take in the candidate's audio since the last `hear(false, fresh = true)`. */
    fun cue(text: String, key: String, heard: Boolean = false)
    /** false: the examiner must stay silent (preparation, long turn); [fresh] marks where the long turn starts. */
    fun hear(on: Boolean, fresh: Boolean)
    fun close()
}

private val wsClient: OkHttpClient by lazy {
    OkHttpClient.Builder().readTimeout(0, TimeUnit.MILLISECONDS).pingInterval(20, TimeUnit.SECONDS).build()
}

private val wire = Json { ignoreUnknownKeys = true; isLenient = true }

private fun parseObject(text: String): JsonObject? = runCatching { wire.parseToJsonElement(text) as? JsonObject }.getOrNull()

private fun JsonObject.obj(k: String) = this[k] as? JsonObject
private fun JsonObject.str(k: String) = (this[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull
private fun JsonObject.flag(k: String) = (this[k] as? JsonPrimitive)?.let { runCatching { it.boolean }.getOrNull() } == true

// MARK: GPT-Live (through our relay)

/**
 * GPT-Live relay wire format (docs/live-examiner.md, "Native relay"; port of iOS `GPTLive`). Pure builders and a parser, so they are
 * unit-tested without a network. Audio is PCM16 mono little-endian at 24 kHz in both directions.
 */
object GPTLive {
    const val RATE = 24_000

    /** wss://<server>/api/live/gpt-live/ws?sessionId=...; the bearer token goes in the Authorization header. */
    fun url(base: String, sessionId: String): String =
        "ws" + base.removePrefix("http").trimEnd('/') + "/api/live/gpt-live/ws?sessionId=" + java.net.URLEncoder.encode(sessionId, "UTF-8") // http(s) -> ws(s)

    fun audio(pcm: ByteArray): JsonObject = buildJsonObject { put("type", "session.input_audio.append"); put("audio", java.util.Base64.getEncoder().encodeToString(pcm)) }
    fun mute(on: Boolean): JsonObject = buildJsonObject { put("type", if (on) "session.input_audio.mute" else "session.input_audio.unmute") }
    /** begin | part2 | talk | follow | follow-timeup | closing. The server owns the wording. */
    fun cue(key: String): JsonObject = buildJsonObject { put("type", "app.cue"); put("cue", key) }
    val close: JsonObject = buildJsonObject { put("type", "session.close") }

    sealed interface Event {
        data object Started : Event
        class Audio(val pcm: ByteArray) : Event // PCM16 24 kHz
        data class InText(val text: String) : Event
        data class OutText(val text: String) : Event
        data class Closed(val reason: String) : Event
        data class Error(val message: String) : Event
    }

    /** One relay message -> an event (null: nothing the app acts on). */
    fun parse(m: JsonObject): Event? = when (m.str("type")) {
        "session.started" -> Event.Started
        "session.output_audio.delta" -> (m.str("audio") ?: m.str("delta"))
            ?.let { runCatching { java.util.Base64.getDecoder().decode(it) }.getOrNull() }?.let { Event.Audio(it) }
        "session.input_transcript.delta" -> m.str("delta")?.let { Event.InText(it) }
        "session.output_transcript.delta" -> m.str("delta")?.let { Event.OutText(it) }
        "session.closed" -> Event.Closed(m.str("reason").orEmpty())
        "error" -> Event.Error(m.obj("error")?.str("message").orEmpty())
        else -> null
    }
}

/** GPT-Live over OUR relay: the OpenAI key, model, voice and instructions stay on the server. OkHttp WebSocket with the bearer header. */
class GPTLiveSocket : DuplexSocket {
    /** Called on a background thread. */
    var onEvent: ((GPTLive.Event) -> Unit)? = null
    /** Called on a background thread when the socket drops without being asked to close. */
    var onLost: (() -> Unit)? = null

    private val lock = Any()
    private var ws: WebSocket? = null
    private var started = false
    private var closed = false
    private var startup: CompletableDeferred<Unit>? = null

    /** Resolves when the relay reports session.started; throws if the socket fails first (401/400/404/429 arrive as plain HTTP) or nothing happens in 15 s. */
    suspend fun connect(base: String, token: String, sessionId: String) {
        val d = CompletableDeferred<Unit>()
        val req = Request.Builder().url(GPTLive.url(base, sessionId)).header("Authorization", "Bearer $token").build()
        synchronized(lock) { startup = d; ws = wsClient.newWebSocket(req, listener()) }
        try {
            withTimeout(15_000) { d.await() }
        } catch (e: kotlinx.coroutines.TimeoutCancellationException) {
            throw ApiError(0, "The GPT-Live examiner did not answer.")
        }
        send(GPTLive.cue("begin")) // the examiner opens with the introduction
    }

    override fun appendAudio(pcm: ByteArray) { if (synchronized(lock) { started }) send(GPTLive.audio(pcm)) }
    override fun cue(text: String, key: String, heard: Boolean) { send(GPTLive.cue(key)) }
    /** GPT-Live is muted only for the preparation minute: it hears the long turn and is told to stay silent. */
    override fun hear(on: Boolean, fresh: Boolean) { send(GPTLive.mute(!on && !fresh)) }

    override fun close() {
        val w = synchronized(lock) { closed = true; started = false; ws.also { ws = null } } ?: return
        w.send(GPTLive.close.toString())
        w.close(1000, null) // OkHttp flushes the queued message before the close frame
    }

    private fun send(m: JsonObject) { synchronized(lock) { ws }?.send(m.toString()) }

    private fun listener() = object : WebSocketListener() {
        override fun onMessage(webSocket: WebSocket, text: String) {
            if (synchronized(lock) { ws !== webSocket }) return
            val ev = parseObject(text)?.let(GPTLive::parse) ?: return
            if (ev == GPTLive.Event.Started) {
                val d = synchronized(lock) { started = true; startup.also { startup = null } }
                d?.complete(Unit)
            }
            onEvent?.invoke(ev)
        }
        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { dropped(webSocket, response?.code?.let { ApiError(it, "The GPT-Live examiner is not available ($it).") } ?: t) }
        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { dropped(webSocket, ApiError(0, "The connection closed.")) }
    }

    private fun dropped(w: WebSocket, error: Throwable) {
        val (pending, wasClosed) = synchronized(lock) {
            if (ws !== w) return
            started = false
            Pair(startup.also { startup = null }, closed)
        }
        if (pending != null) pending.completeExceptionally(error) else if (!wasClosed) onLost?.invoke()
    }
}

// MARK: Gemini Live

/** Gemini Live wire format (ai.google.dev/api/live). Pure builders and a parser, so they can be unit-tested without a network. */
object GeminiLive {
    /** Same prefix the server's instructions tell the model to treat as an app cue (ai/examiner.ts CUE_PREFIX). */
    const val CUE_PREFIX = "[APP CUE] "

    /** Ephemeral tokens connect to the "Constrained" endpoint, on v1beta, with the token as access_token. */
    fun url(token: String): String =
        "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=" +
            java.net.URLEncoder.encode(token, "UTF-8")

    /** First message. Model, voice, instructions, VAD, transcription and compression are locked into the token; only resumption is ours. */
    fun setup(model: String, handle: String?): JsonObject = buildJsonObject {
        putJsonObject("setup") {
            put("model", "models/$model")
            putJsonObject("sessionResumption") { if (handle != null) put("handle", handle) }
        }
    }

    /** PCM16 little-endian mono at 16 kHz. */
    fun audio(pcm: ByteArray): JsonObject = buildJsonObject {
        putJsonObject("realtimeInput") {
            putJsonObject("audio") { put("data", java.util.Base64.getEncoder().encodeToString(pcm)); put("mimeType", "audio/pcm;rate=16000") }
        }
    }

    /** Flushes audio the server still holds when the mic stops streaming. */
    val audioEnd: JsonObject = buildJsonObject { putJsonObject("realtimeInput") { put("audioStreamEnd", true) } }

    /** An instruction from the app. turnComplete interrupts whatever the examiner is saying and makes it answer now (Gemini 3.8 Live). */
    fun cue(text: String): JsonObject = buildJsonObject {
        putJsonObject("clientContent") {
            putJsonArray("turns") {
                add(buildJsonObject {
                    put("role", "user")
                    putJsonArray("parts") { add(buildJsonObject { put("text", CUE_PREFIX + text) }) }
                })
            }
            put("turnComplete", true)
        }
    }

    sealed interface Event {
        data object SetupComplete : Event
        data object Interrupted : Event
        data object GenerationComplete : Event
        data object TurnComplete : Event
        class Audio(val pcm: ByteArray) : Event // PCM16 24 kHz
        data class OutText(val text: String) : Event
        data class InText(val text: String) : Event
        data class GoAway(val seconds: Double) : Event
        data class Resume(val handle: String) : Event
    }

    /** One server message -> events, in the order the app should act on them (an interruption first, so audio after it is the new answer). */
    fun parse(m: JsonObject, decode: (String) -> ByteArray? = { runCatching { java.util.Base64.getDecoder().decode(it) }.getOrNull() }): List<Event> {
        val out = ArrayList<Event>()
        if (m["setupComplete"] != null) out += Event.SetupComplete
        m.obj("serverContent")?.let { c ->
            if (c.flag("interrupted")) out += Event.Interrupted
            c.obj("inputTranscription")?.str("text")?.takeIf { it.isNotEmpty() }?.let { out += Event.InText(it) }
            val parts = (c.obj("modelTurn")?.get("parts") as? JsonArray).orEmpty()
            for (p in parts) {
                val d = (p as? JsonObject)?.obj("inlineData") ?: continue
                val b64 = d.str("data") ?: continue
                if (!(d.str("mimeType") ?: "audio/").startsWith("audio/")) continue
                decode(b64)?.let { out += Event.Audio(it) }
            }
            c.obj("outputTranscription")?.str("text")?.takeIf { it.isNotEmpty() }?.let { out += Event.OutText(it) }
            if (c.flag("generationComplete")) out += Event.GenerationComplete
            if (c.flag("turnComplete")) out += Event.TurnComplete
        }
        m.obj("goAway")?.let { g ->
            // protobuf Duration JSON: "50s", "1.5s"
            out += Event.GoAway((g.str("timeLeft") ?: "0s").trimEnd('s').toDoubleOrNull() ?: 0.0)
        }
        m.obj("sessionResumptionUpdate")?.let { r ->
            val h = r.str("newHandle")
            if (r.flag("resumable") && !h.isNullOrEmpty()) out += Event.Resume(h)
        }
        return out
    }
}

/**
 * Gemini Live over a WebSocket. A connection lives ~10 minutes; session resumption carries the test across it, so a dropped socket
 * reconnects with the latest handle (up to 3 failed attempts in a row, then [onLost]).
 */
class GeminiLiveSocket : DuplexSocket {
    /** Called on a background thread (everything except the setup handshake). */
    var onEvent: ((GeminiLive.Event) -> Unit)? = null
    var onLost: (() -> Unit)? = null

    private val lock = Any()
    private var ws: WebSocket? = null
    private var token = ""
    private var model = ""
    private var resumeHandle: String? = null
    private var ready = false
    private var closed = false
    private var hearing = true
    private var failures = 0
    private var queuedCue: String? = null
    private var setup: CompletableDeferred<Unit>? = null

    /** Returns when the server has accepted the setup (setupComplete); throws if the socket closes first or nothing happens in 15 s. */
    suspend fun connect(token: String, model: String) {
        this.token = token
        this.model = model
        val d = CompletableDeferred<Unit>()
        synchronized(lock) { setup = d }
        open()
        try {
            withTimeout(15_000) { d.await() }
        } catch (e: kotlinx.coroutines.TimeoutCancellationException) {
            throw ApiError(0, "The Gemini examiner did not answer.")
        }
    }

    override fun appendAudio(pcm: ByteArray) { if (synchronized(lock) { ready && hearing }) send(GeminiLive.audio(pcm)) }

    override fun cue(text: String, key: String, heard: Boolean) {
        if (synchronized(lock) { ready }) send(GeminiLive.cue(text)) else synchronized(lock) { queuedCue = text }
    }

    override fun hear(on: Boolean, fresh: Boolean) {
        synchronized(lock) { hearing = on }
        if (!on) send(GeminiLive.audioEnd)
    }

    override fun close() {
        val w = synchronized(lock) { closed = true; ws.also { ws = null } }
        w?.close(1000, null)
    }

    private fun send(m: JsonObject) { synchronized(lock) { ws }?.send(m.toString()) }

    private fun open() {
        synchronized(lock) {
            ready = false
            ws = wsClient.newWebSocket(Request.Builder().url(GeminiLive.url(token)).build(), listener())
        }
    }

    private fun listener() = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            // The setup must be the first message.
            webSocket.send(GeminiLive.setup(model, synchronized(lock) { resumeHandle }).toString())
        }

        override fun onMessage(webSocket: WebSocket, text: String) { handle(webSocket, text) }
        override fun onMessage(webSocket: WebSocket, bytes: okio.ByteString) { handle(webSocket, bytes.utf8()) }
        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { dropped(webSocket, t) }
        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { dropped(webSocket, ApiError(0, "The connection closed.")) }
    }

    private fun handle(w: WebSocket, text: String) {
        if (synchronized(lock) { ws !== w }) return
        val o = parseObject(text) ?: return
        for (ev in GeminiLive.parse(o)) process(ev)
    }

    private fun process(ev: GeminiLive.Event) {
        when (ev) {
            GeminiLive.Event.SetupComplete -> {
                val (cue, done) = synchronized(lock) {
                    ready = true; failures = 0
                    Pair(queuedCue, setup).also { queuedCue = null; setup = null }
                }
                done?.complete(Unit)
                if (cue != null) send(GeminiLive.cue(cue))
            }
            is GeminiLive.Event.Resume -> synchronized(lock) { resumeHandle = ev.handle }
            else -> onEvent?.invoke(ev)
        }
    }

    private fun dropped(w: WebSocket, error: Throwable) {
        var pending: CompletableDeferred<Unit>? = null
        var retry = false
        var lost = false
        var delayMs = 0L
        synchronized(lock) {
            if (ws !== w) return
            ready = false
            if (closed) return
            val s = setup
            if (s != null) { setup = null; pending = s; return@synchronized } // never got going: connect() throws
            failures++
            retry = failures <= 3 && resumeHandle != null
            lost = !retry
            delayMs = 500L * failures
        }
        pending?.completeExceptionally(if (error is ApiError) error else ApiError(0, "The Gemini examiner did not answer."))
        if (retry) Thread { Thread.sleep(delayMs); if (!synchronized(lock) { closed }) open() }.start()
        if (lost) onLost?.invoke()
    }
}
