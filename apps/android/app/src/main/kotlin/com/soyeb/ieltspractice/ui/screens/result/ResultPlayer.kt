package com.soyeb.ieltspractice.ui.screens.result

import android.content.Context
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.soyeb.ieltspractice.audio.AudioPlayer
import kotlinx.coroutines.delay
import kotlin.math.max
import kotlin.math.min

/**
 * What the result screens need from the recording: observable [isLoaded] / [isPlaying] / [currentTime] / [duration] (seconds) and
 * seek/toggle. Wraps the Media3 [AudioPlayer]; call [load] once (main thread), run [poll] from a LaunchedEffect, [release] on dispose.
 * In demo mode ([demoDuration] set) there is no engine: it looks loaded and playing at a fixed spot, so screenshots show the audio bar,
 * the playhead and the word playing now without any audio or looping animation.
 */
@Stable
class ResultPlayer(private val demoDuration: Double? = null) {
    var isLoaded by mutableStateOf(demoDuration != null)
        private set
    var isPlaying by mutableStateOf(demoDuration != null)
        private set
    var currentTime by mutableDoubleStateOf(demoDuration?.let { it * 0.38 } ?: 0.0)
        private set
    var duration by mutableDoubleStateOf(demoDuration ?: 0.0)
        private set
    var failed by mutableStateOf(false)
        private set
    var speed by mutableFloatStateOf(1f)
        private set

    private var engine: AudioPlayer? = null

    fun load(context: Context, url: String) {
        if (demoDuration != null || engine != null) return
        engine = AudioPlayer(context).also { it.load(url) }
    }

    /** Mirror the engine into the observable state until the screen leaves (about 10 times a second while playing). */
    suspend fun poll() {
        val e = engine ?: return
        var waited = 0
        while (true) {
            isPlaying = e.playing.value
            currentTime = e.positionMs / 1000.0
            val d = e.durationMs / 1000.0
            if (d > 0) { duration = d; isLoaded = true } else if (!isLoaded && ++waited > 60) failed = true
            delay(if (isPlaying) 100 else 250)
        }
    }

    fun play() { engine?.play(); if (engine != null) isPlaying = true }
    fun pause() { engine?.pause(); isPlaying = false }
    fun toggle() = if (isPlaying) pause() else play()

    /** Jump to [t] seconds and (by default) play from there. */
    fun seek(t: Double, play: Boolean = true) {
        val clamped = max(0.0, min(t, if (duration > 0) duration else t))
        currentTime = clamped
        engine?.seekTo((clamped * 1000).toLong())
        if (play) play()
    }

    /** 1x and 0.75x (web AudioBar). */
    fun toggleSpeed() {
        speed = if (speed == 1f) 0.75f else 1f
        engine?.setSpeed(speed)
    }

    fun release() {
        engine?.release()
        engine = null
    }
}
