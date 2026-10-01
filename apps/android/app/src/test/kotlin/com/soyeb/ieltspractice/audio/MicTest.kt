package com.soyeb.ieltspractice.audio

import kotlin.math.PI
import kotlin.math.sin
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class MicTest {
    private fun tone(n: Int, amp: Double) = ShortArray(n) { (sin(it * 2 * PI * 220 / 16000) * amp * 32767).toInt().toShort() }

    @Test fun energyIsOnTheWebScale() {
        assertEquals(0, energyByte(0.0))
        assertEquals(255, energyByte(1.0))
        assertEquals(64, energyByte(0.0625)) // sqrt(rms) * 255
        assertTrue(energyByte(0.055) > VOICE_ENERGY - 5) // the server's voice threshold sits near -25 dBFS
    }

    @Test fun levelRunsFromSilenceToFullScale() {
        assertEquals(0.0, levelOf(0.0))
        assertEquals(1.0, levelOf(1.0))
        assertEquals(0.5, levelOf(0.03162), 0.01) // -30 dBFS
    }

    @Test fun meterFramesEvery50Ms() {
        val m = Meter(16_000)
        m.feed(tone(640, 0.3), 640) // 40 ms: no frame yet
        assertEquals(0, m.energy.size)
        m.feed(tone(640, 0.3), 640) // 80 ms: one 50 ms frame
        assertEquals(1, m.energy.size)
        repeat(30) { m.feed(tone(640, 0.3), 640) }
        assertEquals(25, m.energy.size) // 32 chunks x 640 = 1.28 s = 25 frames
        assertTrue(m.loud > 20 && m.soft == 0)
        assertEquals(20480, m.samples)
    }

    @Test fun quietInputCountsAsSoftNotLoud() {
        val q = Meter(16_000)
        repeat(40) { q.feed(tone(640, 0.012), 640) } // rms 0.0085 -> energy ~23: room noise, neither
        assertEquals(0, q.loud)
        assertEquals(0, q.soft)
        val s = Meter(16_000)
        repeat(40) { s.feed(tone(640, 0.04), 640) } // rms 0.028 -> energy ~42: soft
        assertTrue(s.soft > 20 && s.loud == 0)
    }

    @Test fun paceNeedsEnoughAudio() {
        assertEquals(0, estimateWpm(List(39) { 100 }))
        // A voiced peak every 150 ms over 10 s: 66 peaks -> a fast but plausible rate.
        val energy = List(200) { if (it % 3 == 1) 120 else 20 }
        val wpm = estimateWpm(energy)
        assertEquals(264, wpm)
    }

    @Test fun vadEndsATurnAfterSilenceFollowingSpeech() {
        val v = Vad(endAfter = 1.0)
        assertFalse(v.feed(0.0, 0.5)) // silence before speech never ends a turn
        assertFalse(v.feed(0.8, 0.2))
        assertTrue(v.speaking && v.heardSpeech)
        assertFalse(v.feed(0.0, 0.6))
        assertTrue(v.feed(0.0, 0.5))
        assertFalse(v.feed(0.0, 2.0)) // fires once
        assertTrue(v.heardSpeech)
    }
}
