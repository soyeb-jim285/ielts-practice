package com.soyeb.ieltspractice.audio

import android.content.Context
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Plays an audio URL (presigned attempt audio, examiner TTS) or a local file with Media3 ExoPlayer. Main thread only; call
 * [release] when the screen leaves (`DisposableEffect`). Poll [positionMs] from a `LaunchedEffect` loop while [playing].
 * Port of iOS Audio/Player.swift.
 */
class AudioPlayer(context: Context) {
    private val player = ExoPlayer.Builder(context.applicationContext).build()

    private val _playing = MutableStateFlow(false)
    val playing: StateFlow<Boolean> = _playing.asStateFlow()

    /** True once the current item played to its end. */
    private val _ended = MutableStateFlow(false)
    val ended: StateFlow<Boolean> = _ended.asStateFlow()

    init {
        player.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) { _playing.value = isPlaying }
            override fun onPlaybackStateChanged(state: Int) { _ended.value = state == Player.STATE_ENDED }
        })
    }

    val positionMs: Long get() = player.currentPosition
    val durationMs: Long get() = player.duration.takeIf { it >= 0 } ?: 0L

    fun load(uri: String) {
        player.setMediaItem(MediaItem.fromUri(uri))
        player.prepare()
    }

    fun play() { if (player.playbackState == Player.STATE_ENDED) player.seekTo(0); player.play() }
    fun pause() = player.pause()
    fun seekTo(ms: Long) = player.seekTo(ms)
    fun setSpeed(speed: Float) = player.setPlaybackSpeed(speed)
    fun release() = player.release()
}
