package com.soyeb.ieltspractice.core

import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.TextStyle
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

// Community mode (docs/community.md): quotas, the shared balance, own API keys and the copy for every limit. Pure Kotlin so the rules
// are unit-tested (CommunityTest). The UI is in ui/community/.

/** Where "now" and the time zone come from. Demo mode pins both so screenshots are stable. */
object Clocks {
    var now: () -> Instant = { Instant.now() }
    var zone: () -> ZoneId = { ZoneId.systemDefault() }
}

/** One counter (speaking or writing). Limit, remaining, resetAt and window are null when unlimited (own key, owner). */
@Serializable data class SkillQuota(
    val used: Int = 0,
    val limit: Int? = null,
    val remaining: Int? = null,
    val resetAt: String? = null,
    val window: String? = null, // "day" | "week"
    /** quota_exceeded | community_balance_exhausted | community_busy | null (go). */
    val blocked: String? = null,
)

/** The shared OpenRouter balance in USD. Null fields mean no spend limit or unknown (nothing is blocked then). */
@Serializable data class Balance(
    val limit: Double? = null,
    val used: Double? = null,
    val remaining: Double? = null,
    val updatedAt: String? = null,
)

/** `GET /api/quota` (and the same fields inside `GET /api/me`). */
@Serializable data class Quota(
    val tier: String = "guest", // guest | community | own-key
    val speaking: SkillQuota = SkillQuota(),
    val writing: SkillQuota = SkillQuota(),
    val liveProviders: List<String> = emptyList(), // turn | gpt-live | gemini-live
    val communityBalance: Balance? = null,
) {
    fun of(skill: String) = if (skill == "writing") writing else speaking
    val unlimited get() = tier == "own-key"
}

/** One saved key as the server returns it. The key itself never leaves the server. */
@Serializable data class KeyInfo(val provider: String, val last4: String = "", val addedAt: String? = null, val valid: Boolean = true)

@Serializable data class KeysResponse(val keys: List<KeyInfo> = emptyList())

val KEY_PROVIDERS = listOf("openrouter", "openai", "gemini")

/** What a key unlocks, and its display name (docs/community.md, Settings, Your API keys). */
object Providers {
    fun name(p: String) = when (p) { "openrouter" -> "OpenRouter"; "openai" -> "OpenAI"; "gemini" -> "Gemini"; else -> p }
    fun unlocks(p: String) = when (p) { "openrouter" -> "Unlimited tests"; "openai" -> "GPT-Live examiner"; "gemini" -> "Gemini Live examiner"; else -> "" }
    /** The key a live provider needs ("turn" = the turn-based examiner). */
    fun keyFor(live: String) = when (live) { "gpt-live" -> "openai"; "gemini-live" -> "gemini"; else -> "openrouter" }
}

/** Error codes the server answers with (body `{ error, code }`). */
object Codes {
    const val QUOTA = "quota_exceeded"
    const val BALANCE = "community_balance_exhausted"
    const val BUSY = "community_busy"
    const val FAST = "too_many_requests"
    const val LIVE = "live_requires_own_key"
    const val ACCOUNT = "account_required"
    const val INVALID_KEY = "invalid_key"
    const val KEY_CHECK = "key_check_failed"
    const val KEYS_OFF = "keys_unavailable"
    /** The codes that mean "a test can't start or finish now". */
    val limits = setOf(QUOTA, BALANCE, BUSY, FAST, LIVE)
}

// MARK: Reset time and quota labels

object QuotaCopy {
    private val timeFmt = DateTimeFormatter.ofPattern("H:mm", Locale.US)

    /** "Resets in 5 h" under a day (minutes under an hour), otherwise "Resets Monday 6:00" in local time. Null without a resetAt. */
    fun resets(resetAt: String?, now: Instant = Clocks.now(), zone: ZoneId = Clocks.zone()): String? {
        val at = parse(resetAt) ?: return null
        val minutes = (at.epochSecond - now.epochSecond + 59) / 60
        return when {
            minutes < 1 -> "Resets in a moment"
            minutes < 60 -> "Resets in $minutes min"
            minutes < 24 * 60 -> "Resets in ${(minutes / 60.0).roundToInt().coerceAtLeast(1)} h"
            else -> {
                val local = at.atZone(zone)
                "Resets ${local.dayOfWeek.getDisplayName(TextStyle.FULL, Locale.US)} ${timeFmt.format(local)}"
            }
        }
    }

    /** Same as [resets] without the leading word: "in 5 h", "Monday 6:00" (for sentences like "It resets in 5 h."). */
    fun resetsWhen(resetAt: String?, now: Instant = Clocks.now(), zone: ZoneId = Clocks.zone()): String? =
        resets(resetAt, now, zone)?.removePrefix("Resets ")?.let { if (it == "in a moment") "in a moment" else it }

    /** The inline line under a Start button: "1 test left today", "No tests left. Resets Monday 6:00", "Unlimited with your key". */
    fun left(q: Quota, skill: String, now: Instant = Clocks.now(), zone: ZoneId = Clocks.zone()): String {
        val s = q.of(skill)
        if (q.unlimited || s.limit == null) return "Unlimited with your key"
        when (s.blocked) {
            Codes.BALANCE -> return "The community balance is used up for now"
            Codes.BUSY -> return "Busy right now. Try again in a few minutes"
        }
        val remaining = s.remaining ?: (s.limit - s.used).coerceAtLeast(0)
        val whenText = if (s.window == "week") "this week" else "today"
        if (remaining <= 0) return listOfNotNull("No tests left.", resets(s.resetAt, now, zone)).joinToString(" ")
        return "$remaining test${if (remaining == 1) "" else "s"} left $whenText"
    }

    /** Short form for a chip or summary row: "1 left today". */
    fun leftShort(q: Quota, skill: String): String {
        val s = q.of(skill)
        if (q.unlimited || s.limit == null) return "Unlimited"
        val remaining = s.remaining ?: (s.limit - s.used).coerceAtLeast(0)
        return if (remaining <= 0) "None left" else "$remaining left ${if (s.window == "week") "this week" else "today"}"
    }

    private fun parse(iso: String?): Instant? = iso?.let { runCatching { Instant.parse(it) }.getOrNull() }

    /** "Oct 3" for a key's addedAt. */
    fun shortDate(iso: String?, zone: ZoneId = Clocks.zone()): String? =
        parse(iso)?.atZone(zone)?.let { "${it.month.getDisplayName(TextStyle.SHORT, Locale.US)} ${it.dayOfMonth}" }
}

// MARK: Balance

object BalanceCopy {
    /** "$12.40" for amounts, "$20" for whole limits. */
    fun usd(x: Double, whole: Boolean = false): String =
        if (whole && x % 1.0 == 0.0) "$" + x.toLong() else "$" + String.format(Locale.US, "%.2f", x)

    /** "Community balance $12.40 of $20", or null when there is nothing to show (no limit or unknown). */
    fun line(b: Balance?): String? {
        val limit = b?.limit ?: return null
        val remaining = b.remaining ?: return null
        return "Community balance ${usd(remaining)} of ${usd(limit, whole = true)}"
    }

    /** 0..1 share left. */
    fun fraction(b: Balance?): Float? {
        val limit = b?.limit?.takeIf { it > 0 } ?: return null
        val remaining = b.remaining ?: return null
        return (remaining / limit).toFloat().coerceIn(0f, 1f)
    }

    /** Under 10 % left: the meter turns to the warning tone. */
    fun low(b: Balance?): Boolean = (fraction(b) ?: 1f) < 0.10f
}

// MARK: The fair-use acknowledgement (once per user per UTC day)

object FairUse {
    /** `userKey` is the user id, or "guest" for a guest session (per device). */
    fun ackKey(userKey: String, now: Instant = Clocks.now()): String = userKey + "@" + now.atOffset(ZoneOffset.UTC).toLocalDate()

    const val TITLE = "You're using the community balance"

    /** The dialog text as three short paragraphs (one string when joined with a space: the same words on every platform). */
    fun paragraphs(q: Quota, skill: String, guest: Boolean): List<String> {
        val s = q.of(skill)
        val n = s.remaining ?: 0
        val whenText = if (s.window == "week") "this week" else "today"
        val left = "You have $n $skill test${if (n == 1) "" else "s"} left $whenText."
        val money = q.communityBalance?.remaining?.let { " The community balance has ${BalanceCopy.usd(it)} left." }.orEmpty()
        return listOf(
            "This test is paid from a shared balance that everyone uses. Please don't abuse it: no spamming tests and no automated use.",
            left + money,
            if (guest) "Create an account for 1 test a day." else "Want unlimited tests and the live examiner? Add your own API key in Settings.",
        )
    }

    fun body(q: Quota, skill: String, guest: Boolean): String = paragraphs(q, skill, guest).joinToString(" ")
}

// MARK: The limit panels

enum class GateAction { Account, Keys, Close }

/** The text and buttons of a "you can't start this test" panel. [primary] is the one teal button. */
data class GateCopy(val title: String, val body: String, val primary: Pair<String, GateAction>?, val secondary: Pair<String, GateAction>)

object GateText {
    private fun skillName(skill: String) = if (skill == "writing") "writing" else "speaking"

    /**
     * [code] is the server's code, [tier] guest/community/own-key, [needs] the provider a live test needs ("OpenRouter", "OpenAI", "Gemini").
     * [keep] is a note for a test that was already under way ("Your essay is still here.").
     */
    fun copy(code: String, skill: String, tier: String, resetAt: String?, needs: String? = null, keep: String? = null,
             now: Instant = Clocks.now(), zone: ZoneId = Clocks.zone()): GateCopy {
        val guest = tier == "guest"
        fun withKeep(s: String) = if (keep == null) s else "$s $keep"
        val whenText = QuotaCopy.resetsWhen(resetAt, now, zone)
        return when (code) {
            Codes.QUOTA -> GateCopy(
                "No ${skillName(skill)} tests left",
                withKeep(
                    if (guest) "You've used this week's free test." + (whenText?.let { " It resets $it." } ?: "")
                    else "You've used today's free test." + (whenText?.let { " It resets $it." } ?: ""),
                ),
                if (guest) "Create an account for 1 test a day" to GateAction.Account else "Add your own key" to GateAction.Keys,
                (if (guest) "Not now" else "Wait for the reset") to GateAction.Close,
            )
            Codes.BALANCE -> GateCopy(
                "Community tests are paused",
                withKeep("The community balance is used up for now."),
                if (guest) "Create an account" to GateAction.Account else "Add your own OpenRouter key" to GateAction.Keys,
                "Not now" to GateAction.Close,
            )
            Codes.BUSY -> GateCopy(
                "It's busy right now",
                withKeep("A lot of people are practising right now. Try again in a few minutes."),
                null, "Close" to GateAction.Close,
            )
            Codes.LIVE -> GateCopy(
                "The live examiner needs your key",
                if (guest) "The live examiner runs on your own key. Create an account, then add a key in Settings."
                else "The live examiner runs on your own key. Add ${needs?.let { "${article(it)} $it key" } ?: "a key"} in Settings, under Your API keys.",
                if (guest) "Create an account" to GateAction.Account else "Add your own key" to GateAction.Keys,
                "Not now" to GateAction.Close,
            )
            else -> GateCopy(
                "You're going a bit fast",
                withKeep("You're going a bit fast. Try again in a moment."),
                null, "Close" to GateAction.Close,
            )
        }
    }

    /** One sentence for a place with no panel (an upload that was refused): why, when it resets, and what was kept. */
    fun sentence(e: ApiError, keep: String): String {
        val c = copy(e.code.orEmpty(), e.skill ?: "speaking", e.tier ?: "community", e.resetAt)
        return "${c.body} $keep"
    }

    /** Which key a live test is blocked on, as the sentence names it ("an OpenAI key" / "a Gemini key"). */
    fun article(provider: String) = if (provider.first() in "AEIOUaeiou") "an" else "a"
}

// MARK: Own keys

object KeyCopy {
    fun checking() = "Checking your key..."

    /** The line under a field after a failed save. */
    fun error(provider: String, status: Int, code: String?, message: String): String = when (code) {
        Codes.INVALID_KEY -> "${Providers.name(provider)} didn't accept that key. Check that you copied all of it."
        Codes.KEY_CHECK -> "Couldn't reach ${Providers.name(provider)} to check the key. Try again."
        Codes.KEYS_OFF -> "Saving keys isn't available right now. Try again later."
        Codes.FAST -> "You're going a bit fast. Try again in a moment."
        else -> if (status == 0) message else "Couldn't save the key. Try again."
    }

    fun saved(k: KeyInfo): String = "•••• ${k.last4}" + (QuotaCopy.shortDate(k.addedAt)?.let { ", added $it" } ?: "")

    const val STORED = "Your key is stored encrypted on our server and only used for your tests. Remove it any time."
    const val STOPPED = "This key stopped working. Enter a new one."
    const val MODELS_NOTE = "Custom models apply only with your own OpenRouter key. Community tests always use the default models."
}

// MARK: Panels in flight (what AppNav shows over the current screen)

sealed interface Gate {
    /** A test can't start (or finish) now. [needs] names the provider key a live test needs; [keep] says what was kept ("Your essay is still here."). */
    data class Blocked(
        val code: String, val skill: String, val tier: String, val resetAt: String?, val balance: Balance?,
        val needs: String? = null, val keep: String? = null,
    ) : Gate

    /** The "You're using the community balance" dialog. [onStart] continues into the test. */
    data class FairUse(val skill: String, val quota: Quota, val guest: Boolean, val onStart: () -> Unit) : Gate

    /** Anything else worth a sentence (offline while checking, a guest session that couldn't start). */
    data class Message(val title: String, val body: String) : Gate
}

/** Remembers "I've read the fair-use note" for one user and one UTC day. [prefs] null (demo, tests) keeps it in memory. */
class FairUseAck(private val prefs: android.content.SharedPreferences? = null) {
    private var memory: String? = null

    fun has(key: String): Boolean = memory == key || runCatching { prefs?.getString("fairUseAck", null) == key }.getOrDefault(false)

    fun set(key: String) {
        memory = key
        runCatching { prefs?.edit()?.putString("fairUseAck", key)?.apply() }
    }
}
