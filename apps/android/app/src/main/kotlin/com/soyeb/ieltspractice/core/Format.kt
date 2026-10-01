package com.soyeb.ieltspractice.core

import java.util.Locale
import java.util.UUID
import kotlin.math.abs

/** Criterion labels and order (iOS `Crit`). */
object Crit {
    val labels = mapOf(
        "fc" to "Fluency & Coherence", "lr" to "Lexical Resource", "gra" to "Grammar", "p" to "Pronunciation",
        "ta" to "Task Achievement", "cc" to "Coherence & Cohesion",
    )

    fun label(k: String): String = labels[k] ?: k.uppercase()
    fun order(skill: String): List<String> = if (skill == "speaking") listOf("fc", "lr", "gra", "p") else listOf("ta", "cc", "lr", "gra")
}

/** `m:ss`, with a leading minus for negative (overtime) values. */
fun clock(seconds: Int): String = String.format(Locale.US, "%s%d:%02d", if (seconds < 0) "-" else "", abs(seconds) / 60, abs(seconds) % 60)

/** Fixed decimals, locale independent (`fmt(6.456) == "6.5"`). */
fun fmt(x: Double, digits: Int = 1): String = String.format(Locale.US, "%.${digits}f", x)

/** A number with no trailing ".0" (table cells). */
fun fmtNum(x: Double): String = if (x % 1.0 == 0.0) x.toLong().toString() else x.toString()

private val categoryGroups = mapOf(
    "grammar" to "Grammar", "lexis" to "Vocabulary", "vocabulary" to "Vocabulary", "cohesion" to "Cohesion",
    "task" to "Task", "pronunciation" to "Pronunciation", "fluency" to "Fluency",
)

/** "grammar.article" -> "Grammar: article", "grammar.run-on" -> "Grammar: run-on" (web categoryLabel; the sub-type stays lowercase). */
fun categoryLabel(c: String): String {
    val parts = c.split('.', limit = 2)
    val g = parts.firstOrNull().orEmpty()
    if (g.isEmpty()) return c
    val name = categoryGroups[g.lowercase()] ?: (g.take(1).uppercase() + g.drop(1))
    // "verb-tense" reads "verb tense"; "run-on" keeps its hyphen.
    val sub = parts.getOrNull(1)?.lowercase().orEmpty()
    return if (sub.isEmpty()) name else "$name: ${if (sub == "run-on") sub else sub.replace('-', ' ')}"
}

fun newSessionId(): String = UUID.randomUUID().toString().lowercase()
