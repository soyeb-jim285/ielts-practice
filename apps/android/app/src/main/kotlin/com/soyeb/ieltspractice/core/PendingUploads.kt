package com.soyeb.ieltspractice.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File

/**
 * A finished speaking recording that has not reached the server yet. The m4a and this metadata live in app storage from the
 * moment recording stops until the upload is confirmed, so a failed upload, a relaunch or a killed app never loses it
 * (port of iOS PendingUploads.swift; web: hooks/pendingRecordings.ts).
 */
/** When one question's answer window ran, in ms on the recording clock (which stands still while the examiner talks). */
@Serializable data class AnswerWindow(val q: Int, val startMs: Int, val endMs: Int)

@Serializable data class PendingRecording(
    val id: String,
    val promptId: String,
    val part: Int,
    val label: String,
    val createdAt: Long, // epoch millis
    val durationMs: Int,
    val energy: List<Int>,
    val marks: List<Int>,
    val segments: List<AnswerWindow> = emptyList(),
    val sessionId: String? = null,
    val parentAttemptId: String? = null,
    /** Full mock test: sent with the attempt so the server links it to the mock (its Speaking session id is [sessionId]). */
    val mockId: String? = null,
    // Upload progress, so a retry resumes at the step that failed.
    val attemptId: String? = null,
    val uploadUrl: String? = null,
    val uploaded: Boolean = false,
)

sealed interface UploadState {
    data object Uploading : UploadState
    data class Failed(val message: String) : UploadState
    data class Done(val attemptId: String) : UploadState
}

/**
 * Owns the pending recordings and their uploads. Uploads run on [scope] (the app scope), so leaving a screen never cancels them.
 * Wiring: `PendingStore(File(context.filesDir, "PendingRecordings"), appScope)` (see AppContainer).
 */
class PendingStore(private val dir: File, private val scope: CoroutineScope) {
    private val _items = MutableStateFlow<List<PendingRecording>>(emptyList())
    val items: StateFlow<List<PendingRecording>> = _items.asStateFlow()

    /** Upload state per recording id for this launch (a recording with no entry has not been tried yet). */
    private val _states = MutableStateFlow<Map<String, UploadState>>(emptyMap())
    val states: StateFlow<Map<String, UploadState>> = _states.asStateFlow()

    init { reload() }

    fun audioFile(id: String) = File(dir, "$id.m4a")
    private fun metaFile(id: String) = File(dir, "$id.json")

    /** Call before recording into [audioFile]. */
    fun prepare() { dir.mkdirs() }

    /**
     * Re-read the disk (the hub calls this when it appears).
     * ponytail: an m4a with no metadata (app killed mid-recording) is left behind; sweep them if storage ever matters.
     */
    fun reload() {
        _items.value = (dir.listFiles().orEmpty())
            .filter { it.extension == "json" }
            .mapNotNull { runCatching { AppJson.decodeFromString(PendingRecording.serializer(), it.readText()) }.getOrNull() }
            .filter { audioFile(it.id).exists() }
            .sortedByDescending { it.createdAt }
    }

    /** Keep a finished recording (its m4a is already at [audioFile]). */
    fun add(p: PendingRecording) = write(p)

    private fun write(p: PendingRecording) {
        dir.mkdirs()
        runCatching { metaFile(p.id).writeText(AppJson.encodeToString(PendingRecording.serializer(), p)) }
        _items.update { list -> if (list.any { it.id == p.id }) list.map { if (it.id == p.id) p else it } else listOf(p) + list }
    }

    fun remove(id: String) {
        audioFile(id).delete()
        metaFile(id).delete()
        _items.update { l -> l.filterNot { it.id == id } }
    }

    /** Delete the local copy and the half-created attempt on the server. */
    suspend fun discard(p: PendingRecording, api: ApiClient) {
        p.attemptId?.let { runCatching { api.raw("DELETE", "/api/attempts/$it") } }
        remove(p.id)
        _states.update { it - p.id }
    }

    /** Fire and forget; watch [states]. */
    fun start(p: PendingRecording, api: ApiClient) { scope.launch { upload(p, api) } }

    /**
     * Create the attempt, PUT the audio, submit. Progress is saved after each step so a retry resumes where it failed.
     * Returns the attempt id on success (the local copy is then removed), null on failure or when already uploading.
     */
    suspend fun upload(rec: PendingRecording, api: ApiClient): String? {
        var busy = false
        _states.update { s -> if (s[rec.id] is UploadState.Uploading) { busy = true; s } else { busy = false; s + (rec.id to UploadState.Uploading) } }
        if (busy) return null
        var p = _items.value.firstOrNull { it.id == rec.id } ?: rec
        return try {
            if (p.attemptId == null) {
                val created: Created = api.send("POST", "/api/attempts", buildJsonObject {
                    put("promptId", p.promptId); put("skill", "speaking"); put("part", p.part); put("mode", "practice")
                    put("audioContentType", "audio/mp4")
                    p.sessionId?.let { put("sessionId", it) }
                    p.mockId?.let { put("mockId", it) }
                    p.parentAttemptId?.let { put("parentAttemptId", it) }
                })
                val url = created.uploadUrl ?: throw ApiError(0, "The server didn't return an upload URL.")
                p = p.copy(attemptId = created.id, uploadUrl = url).also(::write)
            }
            val attemptId = p.attemptId ?: throw ApiError(0, "Couldn't start the upload.")
            if (!p.uploaded) {
                val url = p.uploadUrl ?: throw ApiError(0, "The server didn't return an upload URL.")
                api.upload(url, audioFile(p.id), "audio/mp4")
                p = p.copy(uploaded = true).also(::write)
            }
            try {
                api.raw("POST", "/api/attempts/$attemptId/submit", submitBody(p.durationMs, p.energy, p.marks, p.segments))
            } catch (e: ApiError) {
                // 409: an earlier submit already went through and only its response was lost.
                if (e.status != 409) throw e
            }
            remove(p.id)
            _states.update { it + (p.id to UploadState.Done(attemptId)) }
            attemptId
        } catch (e: CancellationException) {
            _states.update { it - p.id }
            throw e
        } catch (e: Exception) {
            // A refused test (no tests left, balance used up) says so and that the recording is safe; the retry button works once there is room.
            val msg = if (e is ApiError && e.isLimit) GateText.sentence(e, "Your recording is saved on this device.") else e.message ?: "Upload failed."
            _states.update { it + (p.id to UploadState.Failed(msg)) }
            null
        }
    }
}
