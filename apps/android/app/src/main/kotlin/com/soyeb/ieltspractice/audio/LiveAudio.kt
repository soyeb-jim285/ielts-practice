package com.soyeb.ieltspractice.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.media.MediaPlayer
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

class PartRecording(val file: File, val durationMs: Int, val energy: List<Int>)

/**
 * Live-mode audio (iOS LiveAudio): the microphone at [micRate] (24 kHz for OpenAI, 16 kHz for Gemini Live) feeding per-turn and
 * per-part m4a files, a PCM16 stream for the Realtime providers, and 24 kHz PCM16 playback of the examiner's voice.
 * ponytail: half-duplex like iOS. The mic is ignored while the examiner speaks (no barge-in); the examiner stops only on an app cue.
 */
class LiveAudio(private val micRate: Int) {
    /** Called on the capture thread with (level 0..1, seconds covered). */
    @Volatile var onLevel: ((Double, Double) -> Unit)? = null
    /** Called on the capture thread with little-endian PCM16 mono at [micRate]. */
    @Volatile var onPcm16: ((ByteArray) -> Unit)? = null
    /** False while a turn-based examiner line plays or during Part 2 preparation. */
    @Volatile var capturing = true

    private class Sink(val writer: AacWriter, val file: File)
    private class PartSink(val writer: AacWriter, val file: File, val meter: Meter)

    private val capture = PcmCapture(micRate)
    private val lock = Any()
    private var turn: Sink? = null
    private var part: PartSink? = null

    private val playRate = 24_000
    private var track: AudioTrack? = null
    private val playQueue = Executors.newSingleThreadExecutor()
    private val queued = AtomicLong() // frames handed to the track since the last flush
    private val generation = AtomicInteger()

    @Volatile var running = false; private set
    val examinerSpeaking: Boolean get() = track?.let { queued.get() - it.playbackHeadPosition > 0 } ?: false

    fun start(): Boolean {
        if (running) return true
        val min = AudioTrack.getMinBufferSize(playRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
        track = try {
            AudioTrack.Builder()
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(playRate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                .setBufferSizeInBytes(maxOf(min, playRate * 2))
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build().also { it.play() }
        } catch (e: Exception) { null }
        capture.onPcm = ::onChunk
        if (!capture.start()) { release(); return false }
        running = true
        return true
    }

    fun stop() {
        if (!running) return
        running = false
        capture.stop()
        capture.onPcm = null
        synchronized(lock) { turn?.writer?.finish(); turn = null; part?.writer?.finish(); part = null }
        release()
    }

    private fun release() {
        generation.incrementAndGet()
        playQueue.shutdownNow()
        track?.let { runCatching { it.pause(); it.flush(); it.release() } }
        track = null
    }

    fun beginTurn(file: File) { synchronized(lock) { turn?.writer?.finish(); turn = Sink(AacWriter(file, micRate), file) } }

    /** Closes the turn file and returns it (null when nothing was recorded). */
    fun endTurn(): File? = synchronized(lock) {
        val t = turn
        turn = null
        if (t != null && t.writer.finish()) t.file else null
    }

    fun beginPart(file: File) { synchronized(lock) { part?.writer?.finish(); part = PartSink(AacWriter(file, micRate), file, Meter(micRate)) } }

    fun endPart(): PartRecording? = synchronized(lock) {
        val p = part
        part = null
        if (p != null && p.writer.finish()) PartRecording(p.file, (p.meter.samples * 1000 / micRate).toInt(), p.meter.energy) else null
    }

    private fun onChunk(pcm: ShortArray, n: Int) {
        val dt = n.toDouble() / micRate
        onLevel?.invoke(levelOf(rmsOf(pcm, n)), dt)
        if (!(capturing && !examinerSpeaking)) return
        synchronized(lock) {
            turn?.writer?.write(pcm, n)
            part?.let { it.writer.write(pcm, n); it.meter.feed(pcm, n) }
        }
        onPcm16?.let { cb ->
            val b = ByteArray(n * 2)
            ByteBuffer.wrap(b).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().put(pcm, 0, n)
            cb(b)
        }
    }

    /** Queue PCM16 mono 24 kHz audio from the examiner. */
    fun playPcm16(data: ByteArray) {
        val t = track ?: return
        if (data.size < 2) return
        val g = generation.get()
        queued.addAndGet((data.size / 2).toLong())
        playQueue.execute { if (g == generation.get()) runCatching { t.write(data, 0, data.size) } }
    }

    /** Drop whatever the examiner has queued and silence it now. */
    fun stopPlayback() {
        generation.incrementAndGet()
        val t = track ?: return
        runCatching { t.pause(); t.flush(); t.play() }
        queued.set(0)
    }
}

/** The turn-based examiner's voice: a downloaded TTS clip played to its end (iOS Player.playToEnd). Main thread. */
class ExaminerVoice {
    private var player: MediaPlayer? = null

    val isPlaying: Boolean get() = runCatching { player?.isPlaying == true }.getOrDefault(false)

    /** Plays [file] and returns when it finishes, fails, or the coroutine is cancelled (which stops it). */
    suspend fun playToEnd(file: File) = suspendCancellableCoroutine<Unit> { c ->
        stop()
        val p = MediaPlayer()
        player = p
        fun done() { if (c.isActive) c.resume(Unit) }
        try {
            p.setDataSource(file.absolutePath)
            p.setOnCompletionListener { done() }
            p.setOnErrorListener { _, _, _ -> done(); true }
            p.setOnPreparedListener { it.start() }
            p.prepareAsync()
        } catch (e: Exception) { done() }
        c.invokeOnCancellation { stop() }
    }

    fun stop() {
        val p = player ?: return
        player = null
        runCatching { p.stop() }
        runCatching { p.release() }
    }
}
