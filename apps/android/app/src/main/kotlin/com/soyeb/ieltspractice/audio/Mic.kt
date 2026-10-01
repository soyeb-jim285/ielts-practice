package com.soyeb.ieltspractice.audio

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.MediaRecorder
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

// Microphone side of the speaking flows (port of iOS Audio/Recorder.swift, LiveAudio.swift, VAD.swift). One AudioRecord pipeline
// feeds everything: an AAC .m4a file (what the server expects), a 50 ms energy timeline on the web scale, and level meters.

/** Voice threshold on the web energy scale (matches web VOICE and core computeSpeechMetrics voiceThreshold). */
const val VOICE_ENERGY = 60

/** dBFS-free energy byte on the web scale: byte = sqrt(rms) * 255. */
fun energyByte(rms: Double): Int = min(255, (sqrt(max(0.0, rms)) * 255).roundToInt())

/** Level 0..1 on a -60..0 dBFS scale (meters and the VAD). */
fun levelOf(rms: Double): Double = ((20 * log10(max(rms, 1e-6)) + 60) / 60).coerceIn(0.0, 1.0)

fun rmsOf(pcm: ShortArray, n: Int): Double {
    if (n <= 0) return 0.0
    var sum = 0.0
    for (i in 0 until n) { val s = pcm[i] / 32768.0; sum += s * s }
    return sqrt(sum / n)
}

/** Syllable-like energy peaks in the last 10 s -> rough words/min (web estimateWpm). ponytail: a pacing hint, not a measurement. */
fun estimateWpm(energy: List<Int>): Int {
    val win = energy.takeLast(200)
    if (win.size < 40) return 0
    var peaks = 0
    var last = -10
    for (i in 1 until win.size - 1) {
        if (win[i] >= VOICE_ENERGY && win[i] > win[i - 1] && win[i] >= win[i + 1] && i - last >= 3) { peaks++; last = i }
    }
    return (peaks / 1.5 * (200.0 / win.size) * 6).roundToInt()
}

/** Energy VAD: speech starts after [startAfter] s above [threshold]; the turn ends after [endAfter] s of silence following speech. */
class Vad(var threshold: Double = 0.3, var startAfter: Double = 0.15, var endAfter: Double = 1.2) {
    var speaking = false; private set
    var heardSpeech = false; private set
    private var above = 0.0
    private var below = 0.0

    /** Feed one level sample (0..1) covering [dt] seconds. Returns true exactly once when a turn ends. */
    fun feed(level: Double, dt: Double): Boolean {
        if (level > threshold) {
            above += dt; below = 0.0
            if (above >= startAfter) { speaking = true; heardSpeech = true }
        } else {
            above = 0.0
            if (!speaking) return false
            below += dt
            if (below >= endAfter) { speaking = false; below = 0.0; return true }
        }
        return false
    }
}

/** Mono PCM16 capture on its own thread, in ~40 ms chunks. Needs RECORD_AUDIO granted. [onPcm] runs on the capture thread. */
class PcmCapture(val rate: Int) {
    @Volatile var onPcm: ((ShortArray, Int) -> Unit)? = null
    @Volatile private var running = false
    private var thread: Thread? = null

    @SuppressLint("MissingPermission")
    fun start(): Boolean {
        if (running) return true
        val chunk = rate / 25
        val min = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        if (min <= 0) return false
        val rec = try {
            AudioRecord(MediaRecorder.AudioSource.MIC, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, max(min, chunk * 8))
        } catch (e: Exception) { return false }
        if (rec.state != AudioRecord.STATE_INITIALIZED) { rec.release(); return false }
        try { rec.startRecording() } catch (e: Exception) { rec.release(); return false }
        running = true
        thread = Thread({
            val buf = ShortArray(chunk)
            while (running) {
                val n = rec.read(buf, 0, buf.size)
                if (n < 0) break
                if (n > 0) onPcm?.invoke(buf, n)
            }
            running = false
            runCatching { rec.stop() }
            rec.release()
        }, "mic-capture").apply { start() }
        return true
    }

    fun stop() {
        running = false
        val t = thread ?: return
        thread = null
        if (t !== Thread.currentThread()) runCatching { t.join(500) }
    }
}

/** PCM16 mono -> AAC-LC in an MPEG-4 container (.m4a, `audio/mp4`). Thread-safe; call [finish] once. */
class AacWriter(private val file: File, private val rate: Int) {
    private val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
    private val muxer = MediaMuxer(file.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    private val info = MediaCodec.BufferInfo()
    private var track = -1
    private var muxing = false
    private var done = false

    /** PCM frames written so far. */
    var frames = 0L; private set

    init {
        file.parentFile?.mkdirs()
        val fmt = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, rate, 1).apply {
            setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            setInteger(MediaFormat.KEY_BIT_RATE, 64_000)
            setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16_384)
        }
        codec.configure(fmt, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        codec.start()
    }

    @Synchronized fun write(pcm: ShortArray, n: Int) {
        if (done || n <= 0) return
        val bytes = ByteArray(n * 2)
        ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().put(pcm, 0, n)
        var pos = 0
        while (pos < bytes.size) {
            val i = codec.dequeueInputBuffer(10_000)
            if (i < 0) { drain(); continue }
            val buf = codec.getInputBuffer(i) ?: continue
            buf.clear()
            val len = min(buf.remaining(), bytes.size - pos) and 1.inv()
            buf.put(bytes, pos, len)
            codec.queueInputBuffer(i, 0, len, frames * 1_000_000L / rate, 0)
            frames += len / 2
            pos += len
            drain()
        }
    }

    /** Flush the encoder and close the file. False when nothing was written (the file is deleted). */
    @Synchronized fun finish(): Boolean {
        if (done) return false
        done = true
        var ok = false
        try {
            if (frames > 0) {
                var i = codec.dequeueInputBuffer(1_000_000)
                if (i >= 0) codec.queueInputBuffer(i, 0, 0, frames * 1_000_000L / rate, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                var tries = 0
                while (!drain() && tries++ < 200) Thread.sleep(10)
                ok = muxing
            }
        } catch (e: Exception) {
            ok = false
        } finally {
            runCatching { codec.stop() }
            codec.release()
            runCatching { if (muxing) muxer.stop() }
            runCatching { muxer.release() }
        }
        if (!ok) file.delete()
        return ok
    }

    /** Move encoded output to the muxer. True once the end of stream was reached. */
    private fun drain(): Boolean {
        while (true) {
            val o = codec.dequeueOutputBuffer(info, 0)
            when {
                o == MediaCodec.INFO_TRY_AGAIN_LATER -> return false
                o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> { track = muxer.addTrack(codec.outputFormat); muxer.start(); muxing = true }
                o >= 0 -> {
                    val out = codec.getOutputBuffer(o)
                    if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
                    if (out != null && info.size > 0 && muxing) {
                        out.position(info.offset); out.limit(info.offset + info.size)
                        muxer.writeSampleData(track, out, info)
                    }
                    codec.releaseOutputBuffer(o, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return true
                }
            }
        }
    }
}

/** 50 ms energy frames, level and pace for a stream of PCM chunks. Fed from the capture thread; read [energy] only after the stream ends. */
class Meter(private val rate: Int) {
    val energy = ArrayList<Int>()
    @Volatile var level = 0.0; private set
    @Volatile var liveWpm = 0; private set
    /** Frames above / just below the voice threshold (the mic check's "we can hear you"). */
    @Volatile var loud = 0; private set
    @Volatile var soft = 0; private set
    var samples = 0L; private set

    private val frame = max(1, rate / 20)
    private var acc = 0.0
    private var cnt = 0

    fun feed(pcm: ShortArray, n: Int) {
        var chunk = 0.0
        for (i in 0 until n) {
            val s = pcm[i] / 32768.0
            chunk += s * s; acc += s * s
            if (++cnt == frame) {
                val e = energyByte(sqrt(acc / cnt))
                energy.add(e)
                if (e > VOICE_ENERGY) loud++ else if (e > 30) soft++
                acc = 0.0; cnt = 0
            }
        }
        samples += n
        level = levelOf(sqrt(chunk / max(n, 1)))
        liveWpm = estimateWpm(energy)
    }
}

class RecordResult(val durationMs: Int, val energy: List<Int>)

/**
 * The practice recorder (iOS Recorder): 16 kHz mono AAC m4a to [start]'s file, plus the observable state the UI shows. With a null file it
 * only meters (the mic check). Observable fields are Compose state, updated from the capture thread. Main thread starts and stops it.
 */
class MicRecorder {
    private val rate = 16_000
    private val capture = PcmCapture(rate)
    private var meter = Meter(rate)
    private var writer: AacWriter? = null
    private var onLevel: ((Double, Double) -> Unit)? = null

    var isRecording by mutableStateOf(false); private set
    var elapsed by mutableDoubleStateOf(0.0); private set
    var level by mutableDoubleStateOf(0.0); private set
    var silence by mutableDoubleStateOf(0.0); private set
    var levels by mutableStateOf(List(48) { 0.0 }); private set
    var liveWpm by mutableIntStateOf(0); private set
    var loud by mutableIntStateOf(0); private set
    var soft by mutableIntStateOf(0); private set

    /** Start metering (and recording into [file] when given). False when the microphone could not start. [dt] callback gets (level, seconds). */
    fun start(file: File? = null, onLevel: ((Double, Double) -> Unit)? = null): Boolean {
        stop()
        meter = Meter(rate)
        writer = file?.let { runCatching { AacWriter(it, rate) }.getOrNull() ?: return false }
        this.onLevel = onLevel
        elapsed = 0.0; silence = 0.0; liveWpm = 0; loud = 0; soft = 0; level = 0.0
        levels = List(48) { 0.0 }
        capture.onPcm = { pcm, n ->
            writer?.write(pcm, n)
            meter.feed(pcm, n)
            val dt = n.toDouble() / rate
            val l = meter.level
            level = l
            elapsed = meter.samples.toDouble() / rate
            silence = if (l < 0.3) silence + dt else 0.0
            levels = levels.drop(1) + l
            liveWpm = meter.liveWpm
            loud = meter.loud; soft = meter.soft
            this.onLevel?.invoke(l, dt)
        }
        if (!capture.start()) { writer?.finish(); writer = null; return false }
        isRecording = true
        return true
    }

    /** Stops; the duration and energy timeline (the file, if any, is closed and complete). */
    fun stop(): RecordResult {
        if (!isRecording) return RecordResult(0, emptyList())
        capture.stop()
        capture.onPcm = null
        isRecording = false
        level = 0.0
        writer?.finish()
        writer = null
        return RecordResult((meter.samples * 1000 / rate).toInt(), meter.energy)
    }

    /** Screenshots: show a recording in progress without touching the microphone. */
    fun demo(elapsed: Double, wpm: Int = 0, loud: Int = 0, soft: Int = 0) {
        isRecording = true
        this.elapsed = elapsed
        liveWpm = wpm
        this.loud = loud; this.soft = soft
        level = 0.5
        levels = List(48) { i -> 0.15 + 0.7 * kotlin.math.abs(kotlin.math.sin(i * 0.7)) }
    }
}
