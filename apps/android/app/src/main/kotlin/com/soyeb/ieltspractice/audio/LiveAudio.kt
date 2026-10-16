package com.soyeb.ieltspractice.audio

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

class PartRecording(val file: File, val durationMs: Int, val energy: List<Int>)

/**
 * Live-mode recording (iOS LiveAudio): LiveKit owns the microphone, and the samples it captures are fed here to become one m4a per part.
 * ponytail: like iOS, the recording pauses while the examiner speaks and during Part 2 preparation, so only the candidate is scored.
 */
class LiveAudio {
    /** Called on the capture thread with the level (0..1). */
    @Volatile var onLevel: ((Double) -> Unit)? = null
    /** False during Part 2 preparation. */
    @Volatile var capturing = true
    /** True while the examiner's voice plays (the worker's `speaking` events). */
    @Volatile var examinerSpeaking = false

    private class PartSink(val writer: AacWriter, val meter: Meter, val file: File, val rate: Int)

    private val lock = Any()
    private var part: PartSink? = null
    @Volatile private var rate = 48_000 // WebRTC's capture rate, known once the first samples arrive

    /** One 10 ms block of 16-bit native-order PCM from LiveKit's microphone sink. Only the first channel is kept. */
    fun feed(data: ByteBuffer, sampleRate: Int, channels: Int) {
        val shorts = data.duplicate().order(ByteOrder.nativeOrder()).asShortBuffer()
        val ch = channels.coerceAtLeast(1)
        val n = shorts.remaining() / ch
        if (n <= 0) return
        val pcm = ShortArray(n) { shorts.get(it * ch) }
        rate = sampleRate
        onLevel?.invoke(levelOf(rmsOf(pcm, n)))
        if (!capturing || examinerSpeaking) return
        synchronized(lock) { part?.takeIf { it.rate == sampleRate }?.let { it.writer.write(pcm, n); it.meter.feed(pcm, n) } }
    }

    fun beginPart(file: File) { synchronized(lock) { part?.writer?.finish(); part = PartSink(AacWriter(file, rate), Meter(rate), file, rate) } }

    fun endPart(): PartRecording? = synchronized(lock) {
        val p = part
        part = null
        if (p != null && p.writer.finish()) PartRecording(p.file, (p.meter.samples * 1000 / p.rate).toInt(), p.meter.energy) else null
    }

    fun stop() { synchronized(lock) { part?.writer?.finish(); part = null } }
}
