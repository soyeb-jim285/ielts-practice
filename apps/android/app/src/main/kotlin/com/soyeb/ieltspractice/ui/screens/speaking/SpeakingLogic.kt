package com.soyeb.ieltspractice.ui.screens.speaking

import com.soyeb.ieltspractice.core.Prompt
import java.time.Instant

// Pure helpers for the speaking screens (no Android types, unit-tested in SpeakingLogicTest). Mirrors the logic in iOS
// SpeakingSessionView / SpeakingHomeView and web components/speaking/SessionFlow.tsx.

const val PREP_SECONDS = 60
const val P2_MAX_SECONDS = 120.0
/** 15 min caps the energy timeline (20k x 50 ms) for any part. */
const val MAX_RECORDING_SECONDS = 900.0

enum class Zone { Brand, Warn, Good }

/** Ring colour by the part's target zone (web zoneTone; P2 is only green from 1:30). Teal = keep going, green = in zone, amber = long. */
fun zoneTone(part: Int, s: Double): Zone = when (part) {
    2 -> if (s < 60) Zone.Brand else if (s < 90) Zone.Warn else if (s <= 120) Zone.Good else Zone.Warn
    3 -> if (s < 30) Zone.Brand else if (s <= 60) Zone.Good else Zone.Warn
    else -> if (s < 15) Zone.Brand else if (s <= 40) Zone.Good else Zone.Warn
}

fun zoneHint(part: Int, s: Int): String {
    val lo = if (part == 2) 60 else if (part == 3) 30 else 15
    val hi = if (part == 2) 120 else if (part == 3) 60 else 40
    if (s < lo) return "Aim for $lo-$hi s"
    if (part == 2 && s < 90) return "Good. Keep going to 1:30 or more"
    return if (s <= hi) "In the target zone" else "Time to wrap up"
}

/** The ring's full circle: P2 2:00, P3 1:00, P1 0:40. */
fun ringMax(part: Int): Double = if (part == 2) P2_MAX_SECONDS else if (part == 3) 60.0 else 40.0

/** "Part 1, 2 of 3" for a Part 1 topic in a multi-topic test, else "Part N". */
fun partLabel(items: List<Prompt>, i: Int): String {
    val p = items.getOrNull(i) ?: return "Speaking"
    val p1Count = items.count { it.part == 1 }
    if (p.part == 1 && p1Count > 1) return "Part 1, ${items.take(i + 1).count { it.part == 1 }} of $p1Count"
    return "Part ${p.part}"
}

fun exitMessage(recording: Boolean, notDone: Boolean): String = listOfNotNull(
    if (recording) "The answer you are recording now will be discarded." else null,
    if (notDone) "Recordings that have not uploaded stay on this device. Upload them from the Speaking page." else null,
    "Answers already uploaded are still analysed.",
).joinToString(" ")

fun finishProgress(total: Int, done: Int, failed: Int): String = when {
    failed > 0 -> "$done of $total uploaded, $failed failed"
    done == total -> "$total of $total uploaded"
    else -> "Uploading ${minOf(done + 1, total)} of $total"
}

/** The server's cue-card body repeats the title and ends with a "You should say:" lead; the bullets get their own heading, so drop both. */
fun cueIntro(p: Prompt): String {
    val bullets = p.bullets.orEmpty()
    var text = p.body
    if (text.startsWith(p.title)) text = text.removePrefix(p.title)
    return text.split('\n').map { it.trim() }.filter { it.isNotEmpty() }
        .filter { line -> bullets.isEmpty() || line.lowercase().trim(':', ' ') != "you should say" }
        .joinToString("\n")
}

/** ALL-CAPS prompt titles from the bank read as sentences. */
fun sentenceCase(t: String): String {
    if (t != t.uppercase() || !Regex("[A-Z]{2}").containsMatchIn(t)) return t
    return t.take(1) + t.drop(1).lowercase()
}

/** Epoch millis of an ISO-8601 timestamp, or null. */
fun isoMillis(iso: String): Long? = runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull()
