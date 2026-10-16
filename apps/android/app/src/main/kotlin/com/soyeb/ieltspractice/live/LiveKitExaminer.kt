package com.soyeb.ieltspractice.live

import android.content.Context
import com.soyeb.ieltspractice.audio.LiveAudio
import com.soyeb.ieltspractice.core.ApiError
import com.soyeb.ieltspractice.core.AppJson
import io.livekit.android.LiveKit
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import io.livekit.android.room.participant.Participant
import io.livekit.android.room.track.DataPublishReliability
import io.livekit.android.room.track.LocalAudioTrack
import io.livekit.android.room.track.Track
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import livekit.org.webrtc.AudioTrackSink

/** POST /api/live/livekit/start. */
@Serializable data class LiveKitJoin(val url: String, val token: String)

/** The cue texts the worker accepts (packages/core/src/livekit.ts CUE_TEXT): it refuses any other text, so these must match exactly. */
object Cue {
    const val PART2 = "Part 1 is over. Move to Part 2 now: give the Part 2 instructions and the topic, then stay silent while the candidate prepares."
    const val TALK = "The preparation minute is over. Ask the candidate to start speaking now, then stay silent until you are told the talk is over."
    const val FOLLOW_TIMEUP = "The two minutes are up. Say \"Thank you. That's the end of your time.\" and ask the rounding-off question."
    const val FOLLOW = "The candidate has finished their talk. Say \"Thank you.\" and ask the rounding-off question."
    const val CLOSING = "The test is over. Say the closing line now and nothing more."
}

/**
 * The LiveKit examiner (web live/livekit.ts): a private room with the examiner worker. Its voice plays through the room on its own; it reports
 * captions and turn events on `ielts.events`, and takes `start`, `configure`, `cue` and `listen` on `ielts.control`. The microphone's samples
 * also go to [audio] for the per-part recordings. Callbacks run on [scope]'s dispatcher (main).
 */
class LiveKitExaminer(private val context: Context, private val audio: LiveAudio, private val scope: CoroutineScope) {
    /** A new examiner line ([append] false) or more of the current one. */
    var onCaption: (text: String, append: Boolean) -> Unit = { _, _ -> }
    /** The candidate finished an answer (the examiner is about to reply). */
    var onAnswered: () -> Unit = {}
    /** The examiner's voice started or stopped. */
    var onSpeaking: (Boolean) -> Unit = {}
    /** The room dropped or the worker failed, for good. */
    var onLost: () -> Unit = {}

    private var room: Room? = null
    private var events: Job? = null
    private val ready = CompletableDeferred<Unit>()
    private val sink = AudioTrackSink { data, bits, rate, channels, _, _ -> if (bits == 16) audio.feed(data, rate, channels) }

    /** Joins the room, publishes the microphone, waits for the worker (30 s) and starts the test. Throws if any step fails. */
    suspend fun connect(join: LiveKitJoin) {
        val r = LiveKit.create(context.applicationContext).also { room = it }
        // Collect before connecting: the worker may say "ready" as soon as we join.
        events = scope.launch(start = CoroutineStart.UNDISPATCHED) {
            r.events.collect { ev ->
                when (ev) {
                    is RoomEvent.DataReceived -> if (ev.topic == "ielts.events" && ev.participant?.kind == Participant.Kind.AGENT) handle(ev.data)
                    is RoomEvent.Disconnected -> lost()
                    else -> {}
                }
            }
        }
        r.connect(join.url, join.token)
        if (!r.localParticipant.setMicrophoneEnabled(true)) throw ApiError(0, "The microphone couldn't start. Close other apps that use it and try again.")
        (r.localParticipant.getTrackPublication(Track.Source.MICROPHONE)?.track as? LocalAudioTrack)?.addSink(sink)
        // ponytail: withTimeout's exception is a CancellationException, which would end the test silently; a null keeps it an error.
        withTimeoutOrNull(30_000) { ready.await() } ?: throw ApiError(0, "The examiner didn't start in time. Try again.")
        send(buildJsonObject { put("type", "start") })
    }

    /** The part the worker's profile is for (sent at part boundaries, before that part's cues). */
    suspend fun configure(part: Int) = send(buildJsonObject { put("type", "configure"); put("part", part) })

    /** Interrupt the examiner and give it one of the [Cue] instructions. */
    suspend fun cue(text: String, key: String) = send(buildJsonObject { put("type", "cue"); put("text", text); put("key", key) })

    /** false: the examiner must not hear the candidate (preparation, long turn). [fresh] marks where the long turn starts. */
    suspend fun listen(on: Boolean, fresh: Boolean = false) = send(buildJsonObject { put("type", "listen"); put("on", on); put("fresh", fresh) })

    private suspend fun send(message: JsonObject) {
        val r = room ?: throw ApiError(0, "The connection to the examiner was closed.")
        r.localParticipant.publishData(message.toString().toByteArray(), DataPublishReliability.RELIABLE, topic = "ielts.control").getOrThrow()
    }

    private fun handle(data: ByteArray) {
        val e = runCatching { AppJson.parseToJsonElement(data.decodeToString()) as? JsonObject }.getOrNull() ?: return
        fun str(k: String) = (e[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull
        fun flag(k: String) = (e[k] as? JsonPrimitive)?.booleanOrNull
        when (str("type")) {
            "ready" -> ready.complete(Unit)
            "caption" -> str("text")?.takeIf { it.isNotEmpty() }?.let { onCaption(it, flag("append") == true) }
            "answered" -> onAnswered()
            "speaking" -> flag("on")?.let(onSpeaking)
            // ponytail: the worker's message is for the server logs, not the candidate.
            "error" -> lost()
        }
    }

    private fun lost() {
        if (room == null) return
        ready.completeExceptionally(ApiError(0, "The connection to the examiner dropped."))
        close()
        onLost()
    }

    fun close() {
        events?.cancel()
        events = null
        val r = room ?: return
        room = null
        runCatching { r.release() } // disconnects, stops the microphone and the examiner's voice
    }
}
