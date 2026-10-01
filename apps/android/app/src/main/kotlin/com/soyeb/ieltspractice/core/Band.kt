package com.soyeb.ieltspractice.core

import kotlin.math.abs
import kotlin.math.floor

/** Port of packages/core/src/band.ts (and iOS Band.swift). Keep the three in sync; BandTest mirrors band.test.ts. */
object Band {
    /** IELTS rounding: frac < .25 -> floor, < .75 -> .5, else next whole band. */
    fun round(x: Double): Double {
        val f = floor(x + 1e-9)
        val frac = x - f + 1e-9
        return if (frac < 0.25) f else if (frac < 0.75) f + 0.5 else f + 1
    }

    data class Overall(val raw: Double, val band: Double)

    fun speakingOverall(fc: Double, lr: Double, gra: Double, p: Double): Overall {
        val raw = (fc + lr + gra + p) / 4
        return Overall(raw, round(raw))
    }

    /** Task 2 counts double; a null task (not attempted) leaves the other alone. */
    fun writingOverall(t1: Double?, t2: Double?): Overall {
        val raw = when {
            t1 != null && t2 != null -> (t1 + 2 * t2) / 3
            t1 != null -> t1
            t2 != null -> t2
            else -> 0.0
        }
        return Overall(raw, round(raw))
    }

    /** "7" for whole bands, "6.5" otherwise. */
    fun format(b: Double): String = if (abs(b - Math.rint(b)) < 1e-9) b.toInt().toString() else String.format(java.util.Locale.US, "%.1f", b)
}
