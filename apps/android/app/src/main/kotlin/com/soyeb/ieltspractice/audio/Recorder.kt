package com.soyeb.ieltspractice.audio

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import java.io.File

/**
 * Records mono AAC in an MPEG-4 container (.m4a, content type `audio/mp4`: what the server and [com.soyeb.ieltspractice.core.PendingStore]
 * expect). Needs the RECORD_AUDIO runtime permission first (request it with `rememberLauncherForActivityResult(RequestPermission())`).
 * Main thread only. Port of iOS Audio/Recorder.swift (minus the live VAD, which the Live agent adds).
 */
class Recorder(private val context: Context) {
    private var recorder: MediaRecorder? = null
    private var startedAt = 0L

    val isRecording: Boolean get() = recorder != null

    /** Start recording into [file] (create its folder first, e.g. `PendingStore.prepare()`). */
    fun start(file: File) {
        stop()
        val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
        r.setAudioSource(MediaRecorder.AudioSource.MIC)
        r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        r.setAudioChannels(1)
        r.setAudioSamplingRate(44_100)
        r.setAudioEncodingBitRate(96_000)
        r.setOutputFile(file.absolutePath)
        r.prepare()
        r.start()
        recorder = r
        startedAt = SystemClock.elapsedRealtime()
    }

    /** Input level 0..1 since the last call. Poll ~10x a second for the level meter and the `energy` series the server wants. */
    fun level(): Float = ((recorder?.maxAmplitude ?: 0) / 32767f).coerceIn(0f, 1f)

    /** Stop and return the duration in ms (0 when nothing was recording or the recording was too short to keep). */
    fun stop(): Int {
        val r = recorder ?: return 0
        recorder = null
        val ms = (SystemClock.elapsedRealtime() - startedAt).toInt()
        return try {
            r.stop()
            ms
        } catch (e: RuntimeException) {
            0 // stop() throws if no audio was captured yet
        } finally {
            r.release()
        }
    }
}
