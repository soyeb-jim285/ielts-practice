package com.soyeb.ieltspractice.ui.screens.lr

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.soyeb.ieltspractice.core.ApiClient
import com.soyeb.ieltspractice.core.LrAttempt
import com.soyeb.ieltspractice.core.LrSaved
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.put

enum class SaveState(val label: String) { Saved("Saved"), Dirty("Unsaved changes"), Saving("Saving"), Error("Offline, retrying") }

/**
 * The answers of an in-progress attempt (web useLrSession): local state, debounced autosave (~1 s), a flush when the screen stops,
 * a keep-alive save of the clock every 15 s, and submit. Saves run on the app [scope] so a flush survives the screen leaving.
 * [elapsed] is the clock in seconds, written by the screen; it is never state, so the clock does not recompose this.
 */
class LrSession(
    val attempt: LrAttempt,
    private val api: ApiClient,
    private val scope: CoroutineScope,
    private val loadLocalAudio: () -> String? = { null },
    private val saveLocalAudio: (String) -> Unit = {},
) {
    var responses by mutableStateOf(attempt.responses)
        private set
    var state by mutableStateOf(SaveState.Saved)
        private set
    var submitting by mutableStateOf(false)
        private set
    @Volatile var elapsed: Double = attempt.elapsedS.toDouble()

    // Pacing (web useLrSession): seconds per part (the runner ticks it), answer changes per question, questions answered late.
    /** Elapsed seconds after which an answer counts as late: reading 3300, exam listening the end of the recordings, otherwise never. */
    @Volatile var lateFrom: Double = Double.POSITIVE_INFINITY
    private val partS = HashMap<String, Double>(attempt.stats?.partS.orEmpty())
    private val changes = HashMap<String, Int>(attempt.stats?.changes.orEmpty())
    private val late = LinkedHashSet<Int>(attempt.stats?.late.orEmpty())
    // Practice listening position: noteAudio is hot (every player tick, memory only); saveAudio stores it on the device and queues a server save.
    @Volatile private var audio: LrAudioState? = LrAudioState.pick(loadLocalAudio(), attempt.stats?.audio)
    fun audioStart(part: Int): Double = audio?.pos?.get(part.toString()) ?: 0.0
    val audioRate: Float get() = (audio?.rate ?: 1.0).toFloat()
    fun noteAudio(part: Int, pos: Double) { val a = audio ?: LrAudioState(); audio = a.copy(pos = a.pos + (part.toString() to pos)) }
    fun noteRate(rate: Float) { audio = (audio ?: LrAudioState()).copy(rate = rate.toDouble()); saveAudio() }
    fun saveAudio() {
        val a = audio ?: return
        if (done) return
        saveLocalAudio(a.encode())
        dirty = true
        flushLater()
    }
    private val focusVal = HashMap<Int, String>()
    private var textField: Int? = null

    fun tickPart(part: Int) { partS[part.toString()] = (partS[part.toString()] ?: 0.0) + 1 }

    /** A text gap got the cursor: remember its value so the change counts once per visit (on [noteBlur]). */
    fun noteFocus(n: Int) { focusVal[n] = responses[n.toString()].orEmpty(); textField = n }
    fun noteBlur(n: Int) {
        val before = focusVal.remove(n)
        if (!before.isNullOrEmpty() && responses[n.toString()].orEmpty() != before) changes[n.toString()] = (changes[n.toString()] ?: 0) + 1
        if (textField == n) textField = null
    }

    private var dirty = false
    private var done = false
    private var debounce: Job? = null
    private val lock = Mutex()

    fun change(next: Map<String, String>) {
        val prev = responses
        for (k in prev.keys + next.keys) {
            if (prev[k].orEmpty() == next[k].orEmpty()) continue
            // typing in a text gap counts once per visit (noteBlur); choosing or switching an option counts each time
            if (!prev[k].isNullOrEmpty() && textField?.toString() != k) changes[k] = (changes[k] ?: 0) + 1
            val n = k.toIntOrNull()
            if (!next[k].isNullOrEmpty() && n != null && elapsed >= lateFrom) late.add(n)
        }
        responses = next
        dirty = true
        state = SaveState.Dirty
        debounce?.cancel()
        debounce = scope.launch { delay(1000); flush() }
    }

    /** Persist now when something changed (or [force], for the clock). Failures retry every 5 s. */
    suspend fun flush(force: Boolean = false) {
        if (done || (!dirty && !force)) return
        lock.withLock {
            if (done) return
            dirty = false
            state = SaveState.Saving
            try {
                api.send<LrSaved>("PUT", "/api/lr/attempts/${attempt.id}", body())
                state = if (dirty) SaveState.Dirty else SaveState.Saved
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                dirty = true
                state = SaveState.Error
                debounce?.cancel()
                debounce = scope.launch { delay(5000); flush() }
            }
        }
    }

    /** Fire-and-forget [flush] for lifecycle callbacks (ON_STOP, leaving the screen). */
    fun flushLater(force: Boolean = false) { scope.launch { flush(force) } }

    private fun body(): JsonObject = buildJsonObject {
        put("responses", JsonObject(responses.mapValues { JsonPrimitive(it.value) }))
        put("elapsedS", elapsed.toInt())
        put("stats", buildJsonObject {
            put("partS", JsonObject(partS.mapValues { JsonPrimitive(it.value.toInt()) }))
            put("changes", JsonObject(changes.filterValues { it > 0 }.mapValues { JsonPrimitive(it.value) }))
            put("late", buildJsonArray { late.forEach { add(it) } })
            audio?.cleaned()?.let { a ->
                put("audio", buildJsonObject {
                    put("pos", JsonObject(a.pos.mapValues { JsonPrimitive(it.value) }))
                    a.rate?.let { put("rate", it) }
                })
            }
        })
    }

    /** Scores the attempt. Throws the ApiError on failure (the answers stay saved and the caller may try again). */
    suspend fun submit(): LrAttempt {
        if (done) error("already submitting")
        done = true
        debounce?.cancel()
        submitting = true
        try {
            return lock.withLock { api.send<LrAttempt>("POST", "/api/lr/attempts/${attempt.id}/submit", body()) }
        } catch (e: Throwable) {
            done = false
            throw e
        } finally {
            submitting = false
        }
    }
}
