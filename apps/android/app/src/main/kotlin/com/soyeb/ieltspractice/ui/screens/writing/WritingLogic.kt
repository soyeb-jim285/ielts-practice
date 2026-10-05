package com.soyeb.ieltspractice.ui.screens.writing

import com.soyeb.ieltspractice.core.AppJson
import com.soyeb.ieltspractice.core.Prompt
import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.ceil

// Pure writing-exam rules shared by the hub and the editor (ports of web lib/writing.ts, WritingExam.tsx and iOS WritingEditorView.swift).
// No Compose in here so everything is covered by WritingLogicTest.

/** Below this many words a manual submit is refused (web SUBMIT_FLOOR); the server rates 20 words or fewer Band 1 anyway. */
const val SUBMIT_FLOOR = 21

/** One edit that inserts this many characters at once is a paste (typing, swipe typing and word suggestions add far fewer). */
const val PASTE_CHARS = 30

fun minWords(part: Int) = if (part == 1) 150 else 250

/** Core `countWords`: whitespace-separated tokens that contain a letter or a digit (so "75%" counts, a lone dash does not). */
fun wordCount(s: String): Int = s.split(Regex("\\s+")).count { t -> t.any { it.isLetterOrDigit() } }

fun plural(n: Int) = if (n == 1) "1 word" else "$n words"

/** Salutation Cambridge prints under a General Training letter; null for other prompts and imported ones whose body already has it (web lib/writing.ts). */
fun letterOpening(p: Prompt): String? =
    if (p.part != 1 || p.variant != "general" || p.body.contains("Begin your letter", ignoreCase = true)) null
    else if (p.type == "letter-formal") "Dear Sir or Madam," else "Dear ..............,"

fun taskLabel(p: Prompt) = if (p.part == 2) "Task 2" else "Task 1 ${if (p.variant == "general") "General" else "Academic"}"

/** WRITING_SECONDS: a full test shares one 60-minute clock, Task 1 gets 20 minutes, Task 2 gets 40. */
fun examSeconds(prompts: List<Prompt>) = if (prompts.size > 1) 3600 else if (prompts.firstOrNull()?.part == 1) 1200 else 2400

/** Seconds left on a wall-clock deadline (negative once overtime). Derived from timestamps so backgrounding can't drift it. */
fun secondsLeft(total: Int, startedAtMs: Long, nowMs: Long): Int = ceil(total - (nowMs - startedAtMs) / 1000.0).toInt()

enum class TimeEvent { Warn5, Warn1, TimeUp }

/** The notice to show when the clock crosses 5 minutes, 1 minute or zero (each fires once, as the clock passes it). */
fun timeEvent(old: Int, new: Int): TimeEvent? = when {
    old > 300 && new <= 300 && new > 60 -> TimeEvent.Warn5
    old > 60 && new <= 60 && new > 0 -> TimeEvent.Warn1
    old > 0 && new <= 0 -> TimeEvent.TimeUp
    else -> null
}

enum class Tone { Neutral, Warn, Bad }

/** Timer colour: amber at 5 minutes, rose at 1 minute and over. */
fun timerTone(left: Int) = if (left <= 60) Tone.Bad else if (left <= 300) Tone.Warn else Tone.Neutral

enum class BarTint { Muted, Warn, Good }

/** The word bar: neutral at zero, amber near the minimum, green once reached. Never red: an empty page is not an error. */
data class WordBar(val tint: BarTint, val hint: String, val progress: Float)

fun wordBar(words: Int, need: Int): WordBar {
    val under = words < need
    val tint = if (!under) BarTint.Good else if (words >= need * 0.9) BarTint.Warn else BarTint.Muted
    val hint = if (!under) "$need-word minimum reached" else if (words > 0) "${need - words} more to reach $need" else "Minimum $need words"
    return WordBar(tint, hint, minOf(words, need).toFloat() / need)
}

/** One task's state for the submit confirmation. */
data class TaskCount(val part: Int, val words: Int)

fun tooShort(tasks: List<TaskCount>) = tasks.any { it.words < SUBMIT_FLOOR }

fun underMinimum(tasks: List<TaskCount>) = tasks.firstOrNull { it.words < minWords(it.part) }

/** The line under the word counts in the submit confirmation (null when everything is fine). */
fun submitNote(tasks: List<TaskCount>, left: Int): String? {
    if (tooShort(tasks)) return "Write at least a paragraph${if (tasks.size > 1) " for each task" else ""} before submitting."
    val u = underMinimum(tasks) ?: return null
    val marks = if (u.part == 1) "Task Achievement" else "Task Response"
    val more = if (left > 0) ". You have ${com.soyeb.ieltspractice.core.clock(left)} left to add more" else ""
    return "Under ${minWords(u.part)} words costs $marks marks$more."
}

/** How many characters [new] inserted into [old] in one edit (common prefix and suffix removed; a replacement counts the new text). */
fun insertedLength(old: String, new: String): Int {
    val max = minOf(old.length, new.length)
    var p = 0
    while (p < max && old[p] == new[p]) p++
    var s = 0
    while (s < max - p && old[old.length - 1 - s] == new[new.length - 1 - s]) s++
    return new.length - p - s
}

fun looksPasted(old: String, new: String) = insertedLength(old, new) >= PASTE_CHARS

/** Essay and plan live under one key per prompt as JSON (`draft:{promptId}`, same shape as web and iOS). */
@Serializable data class Draft(val text: String = "", val plan: String = "")

fun encodeDraft(d: Draft): String = AppJson.encodeToString(Draft.serializer(), d)

/** An older plain-text draft is read as the essay. */
fun decodeDraft(raw: String?): Draft {
    if (raw == null) return Draft()
    return runCatching { AppJson.decodeFromString(Draft.serializer(), raw) }.getOrElse { Draft(text = raw) }
}

/** A running exam: the prompts and the wall-clock start, saved across configuration changes so a rotation never reshuffles the task. */
@Serializable data class ExamSession(val prompts: List<Prompt>, val startedAt: Long, val sessionId: String, val parentId: String? = null, val mockId: String? = null)

/** "28 Sep" (the device's language and format); falls back to the date part of the ISO string. */
fun shortDate(iso: String, zone: ZoneId = ZoneId.systemDefault(), locale: Locale = Locale.getDefault()): String =
    runCatching { DateTimeFormatter.ofPattern("d MMM", locale).format(Instant.parse(iso).atZone(zone)) }.getOrElse { iso.take(10) }

/** The task title unless the body already opens with it or the figure repeats it (seeded titles are the body's first sentence, cut with an ellipsis). */
fun showPromptTitle(p: Prompt, chartTitle: String?): Boolean {
    val stem = p.title.removeSuffix("…")
    return !p.body.startsWith(stem) && chartTitle != p.title
}
