package com.soyeb.ieltspractice.ui.screens.shell

import com.soyeb.ieltspractice.core.Crit
import com.soyeb.ieltspractice.core.fmt
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

// Pure logic for the shell screens (dashboard, bank, history, mistakes, review, settings, auth). No Compose, no Android: unit-tested in ShellLogicTest.

/** Date helpers (iOS `ShellDate`, web lib/format.ts and components/bank/group.ts). */
object ShellDate {
    fun parse(s: String): Instant? = runCatching { OffsetDateTime.parse(s).toInstant() }.getOrNull()

    private val short = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH) // fixed locale: en-GB renders "Sept" on newer JDKs

    /** "30 Sep 2026". */
    fun date(s: String, zone: ZoneId = ZoneId.systemDefault()): String =
        parse(s)?.let { short.format(it.atZone(zone)) } ?: s.take(10)

    /** Recency bucket for newest-first lists: Today, Yesterday, Past 7 days, Past 30 days, Older. */
    fun bucket(s: String, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String {
        val d = parse(s) ?: return "Older"
        val days = ChronoUnit.DAYS.between(LocalDate.ofInstant(d, zone), LocalDate.ofInstant(now, zone))
        return when { days <= 0 -> "Today"; days == 1L -> "Yesterday"; days < 7 -> "Past 7 days"; days < 30 -> "Past 30 days"; else -> "Older" }
    }

    /** "now", "5 minutes ago", "yesterday", "3 days ago", "last week" (the named style of the iOS relative formatter). */
    fun relative(s: String, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String {
        val d = parse(s) ?: return s.take(10)
        val secs = Duration.between(d, now).seconds
        fun ago(n: Long, unit: String) = "$n $unit${if (n == 1L) "" else "s"} ago"
        if (secs < 60) return "now"
        if (secs < 3600) return ago(secs / 60, "minute")
        if (secs < 86400 && LocalDate.ofInstant(d, zone) == LocalDate.ofInstant(now, zone)) return ago(secs / 3600, "hour")
        val days = ChronoUnit.DAYS.between(LocalDate.ofInstant(d, zone), LocalDate.ofInstant(now, zone))
        return when {
            days <= 0 -> ago(secs / 3600, "hour")
            days == 1L -> "yesterday"
            days < 7 -> "$days days ago"
            days < 14 -> "last week"
            days < 30 -> "${days / 7} weeks ago"
            days < 60 -> "last month"
            days < 365 -> "${days / 30} months ago"
            days < 730 -> "last year"
            else -> "${days / 365} years ago"
        }
    }

    /** 95_000 ms -> "1m 35s", 42_000 -> "42s", 3_900_000 -> "1h 5m". */
    fun duration(ms: Int): String {
        val s = (ms / 1000.0).roundToInt()
        if (s < 60) return "${s}s"
        val h = s / 3600
        val m = s % 3600 / 60
        if (h > 0) return "${h}h" + if (m > 0) " ${m}m" else ""
        return "${m}m" + if (s % 60 > 0) " ${s % 60}s" else ""
    }
}

/** Consecutive runs that share a key, so a page boundary never splits a heading. */
fun <T> runsBy(items: List<T>, key: (T) -> String): List<Pair<String, List<T>>> {
    val out = mutableListOf<Pair<String, MutableList<T>>>()
    for (i in items) {
        val k = key(i)
        if (out.lastOrNull()?.first == k) out.last().second.add(i) else out.add(k to mutableListOf(i))
    }
    return out
}

// MARK: Bank

private val typeLabels = mapOf(
    "adv-disadv" to "Advantages & disadvantages", "problem-solution" to "Problem & solution", "two-part" to "Two-part question",
    "letter-formal" to "Formal letter", "letter-semi" to "Semi-formal letter", "letter-informal" to "Informal letter",
    "line" to "Line graph", "bar" to "Bar chart", "pie" to "Pie chart", "mixed" to "Mixed charts",
    "p1-topic" to "Part 1 topic", "cue-card" to "Cue card", "p3-linked" to "Part 3 (linked to cue card)", "p3-discussion" to "Part 3 discussion",
)

/** Web lib/writing.ts typeLabel. */
fun bankTypeLabel(t: String): String = typeLabels[t] ?: pretty(t)

/** "grammar-and-more" -> "Grammar and more" (web bank `pretty`). */
fun pretty(s: String): String = (s.take(1).uppercase() + s.drop(1)).replace('-', ' ').replace('_', ' ')

class PartOption(val id: String, val label: String)

fun partOptions(skill: String): List<PartOption> =
    if (skill == "speaking") listOf(PartOption("all", "All"), PartOption("1", "Part 1"), PartOption("2", "Part 2"), PartOption("3", "Part 3"))
    else listOf(PartOption("all", "All"), PartOption("1-academic", "T1 Academic"), PartOption("1-general", "T1 General"), PartOption("2", "Task 2"))

/** `partKey` is all | 1 | 2 | 3 | 1-academic | 1-general. */
fun partNum(partKey: String): Int? = if (partKey == "all") null else partKey.take(1).toIntOrNull()
fun partVariant(partKey: String): String? = partKey.substringAfter('-', "").ifEmpty { null }

private fun scoped(meta: List<BankGroup>, skill: String, partKey: String) =
    meta.filter { (skill.isEmpty() || it.skill == skill) && (partNum(partKey) == null || it.part == partNum(partKey)) }

/** Types only once a part is picked, and then just that part's (Task 1 letters are General, the rest Academic). */
fun bankTypes(meta: List<BankGroup>, skill: String, partKey: String): List<String> {
    if (partNum(partKey) == null) return emptyList()
    val variant = partVariant(partKey)
    return scoped(meta, skill, partKey).flatMap { it.types.filterNotNull() }
        .filter { variant == null || (variant == "general") == it.startsWith("letter") }.toSortedSet().toList()
}

fun bankTopics(meta: List<BankGroup>, skill: String, partKey: String): List<String> =
    scoped(meta, skill, partKey).flatMap { it.topics.filterNotNull() }.toSortedSet().toList()

/** The section heading over a run of bank rows: "Speaking, Part 1", "Writing, Task 1 Academic". */
fun bankGroupLabel(p: BankPrompt, partKey: String): String {
    val part = if (p.skill == "speaking") "Part ${p.part}" else "Task ${p.part}"
    val v = if (p.skill == "writing") partVariant(partKey)?.let { " " + pretty(it) }.orEmpty() else ""
    return "${pretty(p.skill)}, $part$v"
}

/** The second line of a bank row: Speaking Part 1 and 3 titles are just the topic, so show the first question; writing shows the task type. */
fun bankQuestion(p: BankPrompt): String? =
    if (p.skill == "speaking") {
        if (p.part == 2) p.bullets?.firstOrNull()?.let { "Say $it" }
        else p.followUps?.firstOrNull() ?: p.body.lineSequence().firstOrNull()?.takeIf { it.isNotEmpty() }
    } else p.type?.let(::bankTypeLabel)

// MARK: Dashboard

/** Where to practise each criterion when the user has no scored attempts to tell us where they are weakest (web criteria.ts PRACTICE). */
val practiceDefault = mapOf(
    "fc" to ("speaking" to 2), "gra" to ("speaking" to 2), "lr" to ("speaking" to 2), "p" to ("speaking" to 1), "ta" to ("writing" to 2), "cc" to ("writing" to 2),
)
val criterionShort = mapOf("fc" to "Fluency", "gra" to "Grammar", "lr" to "Vocabulary", "p" to "Pronunciation", "ta" to "Task response", "cc" to "Coherence")

fun greeting(hour: Int): String = if (hour < 5) "Good evening" else if (hour < 12) "Good morning" else if (hour < 18) "Good afternoon" else "Good evening"

/** Skill, and the part/task where the user's own scores on [key] are lowest (web practiceTarget); null for an unknown criterion. */
fun practiceTarget(key: String, trend: List<DashPoint>): Pair<String, Int>? {
    val d = practiceDefault[key] ?: return null
    val byPart = mutableMapOf<Int, MutableList<Double>>()
    for (t in trend) if (t.skill == d.first) {
        val v = t.criteria[key]
        val part = t.part
        if (v != null && part != null) byPart.getOrPut(part) { mutableListOf() }.add(v)
    }
    val best = byPart.entries.minWithOrNull(compareBy<Map.Entry<Int, MutableList<Double>>>({ it.value.average() }, { it.key }))
    return d.first to (best?.key ?: d.second)
}

/** The "Next up" hero's content. [route] is "speaking-full", "speaking-<part>", "writing-1" or "writing-2". */
class NextUp(val title: String, val body: String, val cta: String, val route: String, val a11y: String?)

fun nextUp(p: DashProgress, target: Double): NextUp {
    val weakest = p.weakest?.takeIf { practiceDefault[it.key] != null }
    val practice = weakest?.let { practiceTarget(it.key, p.trend) }
    val partLabel = practice?.let { (if (it.first == "speaking") "Part " else "Task ") + it.second }
    val route = when {
        practice == null -> "speaking-full"
        practice.first == "writing" -> "writing-${practice.second}"
        else -> "speaking-${practice.second}"
    }
    if (weakest == null || partLabel == null) {
        return NextUp("Ready for another round?", "A full test gives the most complete picture of your band.", "Start a full speaking test", route, null)
    }
    val avg = Math.round(weakest.avg * 2) / 2.0
    val below = if (avg < target) ", ${fmt(target - avg)} below your ${fmt(target)} target" else ""
    return NextUp(
        "${Crit.label(weakest.key)} is holding your band back",
        "You average ${fmt(avg)} here$below, and your lowest scores came in $partLabel. Focused practice there moves it fastest.",
        "Practise $partLabel (${criterionShort[weakest.key].orEmpty()})", route,
        "Weakest criterion ${Crit.label(weakest.key)}. You average ${fmt(avg)} here.",
    )
}

fun minutesLabel(m: Double): String = if (m < 1) "<1 min practised this week" else m.toInt().let { "$it ${if (it == 1) "minute" else "minutes"} practised this week" }

fun streakLabel(streak: Int): String = if (streak > 0) "$streak ${if (streak == 1) "day" else "days"} in a row" else "Practise today to start a streak"

fun reviewMeta(due: DueResponse?): String {
    if (due == null) return "Nothing due today"
    if (due.dueTotal > 0) return "A few minutes keeps corrections from slipping"
    if (due.deck == 0) return "Add corrections from Mistakes to start your deck"
    return if (due.deck != null) "All caught up for today" else "Nothing due today"
}

/** The y-axis of the trend chart: lowest tick, then whole bands up to 9. */
fun trendTicks(all: List<Double>, target: Double): Pair<Double, List<Int>> {
    val lo = maxOf(0.0, minOf(Math.floor(all.minOrNull() ?: 0.0), target) - 0.5)
    return lo to (Math.ceil(lo).toInt()..9).toList()
}

// MARK: Review (SM-2)

/** Port of packages/core srs.ts `review`: the interval in days the card would get for grade [g] (1 Again, 3 Hard, 4 Good, 5 Easy). */
fun nextInterval(c: DueCard, g: Int): Int {
    if (g < 3) return 1
    val d = (5 - g).toDouble()
    val ease = maxOf(1.3, (c.ease ?: 2.5) + (0.1 - d * (0.08 + d * 0.02)))
    val reps = (c.reps ?: 0) + 1
    return if (reps == 1) 1 else if (reps == 2) 6 else Math.round((c.interval ?: 0.0) * ease).toInt()
}

fun daysLabel(n: Int): String = if (n == 1) "1 day" else if (n < 30) "$n days" else "${(n / 30.0).roundToInt()} mo"

/** Fix cards are "title\n\nsentence" (server fixCard): the title is a label, only the sentence is the thing to improve. */
fun splitFixCard(card: DueCard): Pair<String?, String> {
    val i = card.front.indexOf("\n\n")
    return if (card.source == "fix" && i > 0) card.front.substring(0, i) to card.front.substring(i + 2) else null to card.front
}

val reviewSourceLabel = mapOf("mistake" to "From your mistakes", "vocab" to "Vocabulary", "fix" to "Fix to practise")
val reviewSourcePrompt = mapOf(
    "mistake" to "How would you correct this? Say or write it, then reveal the answer.",
    "vocab" to "Recall the meaning and use it in a sentence, then reveal the answer.",
    "fix" to "How would you improve this sentence? Say or write it, then reveal the answer.",
)

// MARK: History

fun historyStatus(status: String): Pair<String, String>? = when (status) { // label to tone (warn | brand | bad)
    "recording" -> "Not submitted" to "warn"
    "analyzing" -> "Scoring" to "brand"
    "failed" -> "Scoring failed" to "bad"
    else -> null
}

fun historyFlag(flag: String?): String? = when (flag) { "offTopic" -> "Off topic"; "tooShort" -> "Under length"; else -> null }

/** Editor time under a minute is a pasted or abandoned essay, not a meaningful duration; speaking recordings are short by design. */
fun HistoryItem.shownDuration(): String? = durationMs?.takeIf { it > 0 && (skill == "speaking" || it >= 60_000) }?.let(ShellDate::duration)

fun HistoryItem.meta(): String =
    listOfNotNull("${if (skill == "speaking") "Part" else "Task"} $part", ShellDate.date(createdAt), shownDuration()).joinToString(", ")

// MARK: Auth (web lib/auth.ts, iOS AuthText)

/** Digits only, at most six: what a code field keeps from typing or paste. */
fun otpDigits(s: String): String = s.filter { it in '0'..'9' }.take(6)

/** Wording for the 6-digit code flow. */
fun otpError(status: Int, code: String?, message: String): String = when {
    code == "INVALID_OTP" -> "That code isn't right. Check it and try again."
    code == "OTP_EXPIRED" -> "That code has expired. Request a new one."
    code == "TOO_MANY_ATTEMPTS" -> "Too many wrong tries. Request a new code."
    status == 429 -> "Too many requests. Wait a minute, then try again."
    else -> message.ifEmpty { "Something went wrong. Try again." }
}

/** Short model id for display ("openai/gpt-6-luna" -> "gpt-6-luna"). */
fun shortModel(id: String): String = id.substringAfterLast('/')

/** OpenRouter prices are USD per token (as strings): "$0.10 in · $0.50 out per 1M tokens"; null when free or unknown. */
fun modelPrice(prompt: String?, completion: String?): String? {
    val i = prompt?.toDoubleOrNull() ?: return null
    val o = completion?.toDoubleOrNull() ?: return null
    if (i <= 0 && o <= 0) return null
    return String.format(Locale.US, "\$%.2f in · \$%.2f out per 1M tokens", i * 1e6, o * 1e6)
}

/** Mirrors DEFAULT_SETTINGS.models in apps/server/src/settings.ts (and the web's DEFAULT_MODELS). */
object DefaultModels {
    const val ANALYSIS = "openai/gpt-6-luna"
    const val EXAMINER = "openai/gpt-6-luna"
    const val STT = "openai/whisper-large-v3"
    const val TTS = "google/gemini-3.8-flash-tts"
    const val AUDIO_PRON = "google/gemini-2.5-flash"
}


/** The demo `tab` argument without the "+end" suffix (which only asks ScreenScaffold to start scrolled to the bottom). */
fun demoTab(d: com.soyeb.ieltspractice.core.DemoConfig?): String? = d?.tab?.removeSuffix("+end")
