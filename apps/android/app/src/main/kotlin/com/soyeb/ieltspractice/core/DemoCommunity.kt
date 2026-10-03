package com.soyeb.ieltspractice.core

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import java.time.Instant
import java.time.ZoneId

/**
 * Demo mode for community screens: which quota, balance and keys a screenshot shows, by screen name (see ui/nav/ScreenCatalog.kt).
 * Layered over the shared fixtures (`/api/me`, `/api/quota`, `/api/keys`, `/api/community/balance`), so the iOS fixture file stays as it is.
 * Time is pinned (Sat 3 Oct 2026, 18:00 UTC, shown in Dhaka time) so "Resets in 6 h" and "Resets Monday 6:00" never change.
 */
object DemoCommunity {
    private const val DAY = "2026-10-04T00:00:00.000Z"
    private const val WEEK = "2026-10-05T00:00:00.000Z"
    private val BALANCE = Balance(20.0, 7.6, 12.4, "2026-10-03T17:59:00.000Z")
    private val LOW = Balance(20.0, 19.82, 0.18, "2026-10-03T17:59:00.000Z")

    fun pinClock() {
        Clocks.now = { Instant.parse("2026-10-03T18:00:00Z") }
        Clocks.zone = { ZoneId.of("Asia/Dhaka") }
    }

    /** Signed out (no session at all) unless it is the guest's own result page. */
    fun guest(screen: String?) = screen?.contains("guest") == true
    /** A guest session exists: the token is there, `/api/me` says anonymous. */
    fun anonymousSession(screen: String?) = screen == "guest-result" || screen?.startsWith("guest-recent") == true

    private fun spent(window: String) = SkillQuota(1, 1, 0, if (window == "week") WEEK else DAY, window, Codes.QUOTA)
    private fun open(window: String) = SkillQuota(0, 1, 1, if (window == "week") WEEK else DAY, window, null)
    private fun blocked(window: String, code: String) = SkillQuota(0, 1, 1, if (window == "week") WEEK else DAY, window, code)

    fun quota(screen: String?, tab: String? = null): Quota {
        val own = screen == "settings-own-key"
        val guest = guest(screen)
        val window = if (guest) "week" else "day"
        var speaking = open(window)
        var writing = open(window)
        var balance = BALANCE
        when (screen) {
            "quota-speaking-spent", "gate-quota-community" -> speaking = spent(window)
            "gate-quota-guest", "editor-blocked" -> writing = spent(window)
            "gate-balance" -> { balance = LOW; speaking = blocked(window, Codes.BALANCE); writing = blocked(window, Codes.BALANCE) }
            "gate-busy" -> { speaking = blocked(window, Codes.BUSY); writing = blocked(window, Codes.BUSY) }
        }
        if (own) return Quota("own-key", SkillQuota(), SkillQuota(), listOf("turn", "gpt-live"), balance)
        // The live examiner screens run as if the person had their keys (the gate before them is its own screenshot).
        if (screen?.startsWith("live") == true) return Quota("own-key", SkillQuota(), SkillQuota(), listOf("turn", "gpt-live", "gemini-live"), balance)
        return Quota(if (guest) "guest" else "community", speaking, writing, emptyList(), balance)
    }

    fun keys(screen: String?, tab: String?): List<KeyInfo> = when {
        screen == "settings-own-key" -> listOf(KeyInfo("openrouter", "k3Qa", "2026-10-01T09:00:00.000Z"), KeyInfo("openai", "x91Z", "2026-10-02T09:00:00.000Z"))
        screen == "settings-keys" && tab == "Saved" -> listOf(KeyInfo("openrouter", "k3Qa", "2026-10-01T09:00:00.000Z"))
        screen == "settings-keys" && tab == "Stopped" -> listOf(KeyInfo("openai", "x91Z", "2026-09-28T09:00:00.000Z", valid = false))
        else -> emptyList()
    }

    /** The shared fixtures plus the community answers for this screen. */
    fun overlay(fixtures: Map<String, String>, screen: String?, tab: String?): Map<String, String> {
        val q = quota(screen, tab)
        val quotaJson = AppJson.encodeToJsonElement(Quota.serializer(), q).jsonObject
        val out = fixtures.toMutableMap()
        fixtures["/api/me"]?.let { text ->
            var me = AppJson.parseToJsonElement(text).jsonObject + quotaJson
            if (anonymousSession(screen)) {
                me = me + ("user" to JsonObject(mapOf("id" to JsonPrimitive("guest-demo"), "email" to JsonPrimitive(""), "name" to JsonPrimitive("Guest"), "isAnonymous" to JsonPrimitive(true))))
            }
            out["/api/me"] = JsonObject(me).toString()
        }
        out["/api/quota"] = quotaJson.toString()
        out["/api/keys"] = AppJson.encodeToString(KeysResponse.serializer(), KeysResponse(keys(screen, tab)))
        out["/api/community/balance"] = AppJson.encodeToString(Balance.serializer(), q.communityBalance ?: BALANCE)
        return out
    }

    /** The panel a `gate-*` screenshot shows over its screen. */
    fun gate(screen: String?): Gate? {
        val q = quota(screen)
        return when (screen) {
            "gate-fairuse" -> Gate.FairUse("speaking", q, false) {}
            "gate-fairuse-guest" -> Gate.FairUse("writing", q, true) {}
            "gate-quota-guest" -> Gate.Blocked(Codes.QUOTA, "writing", "guest", WEEK, q.communityBalance)
            "gate-quota-community" -> Gate.Blocked(Codes.QUOTA, "speaking", "community", DAY, q.communityBalance)
            "gate-balance" -> Gate.Blocked(Codes.BALANCE, "speaking", "community", null, q.communityBalance)
            "gate-busy" -> Gate.Blocked(Codes.BUSY, "writing", "community", null, q.communityBalance)
            "gate-live-guest" -> Gate.Blocked(Codes.LIVE, "speaking", "guest", null, q.communityBalance)
            "gate-live-community" -> Gate.Blocked(Codes.LIVE, "speaking", "community", null, q.communityBalance, needs = "OpenRouter")
            "editor-blocked" -> Gate.Blocked(Codes.QUOTA, "writing", "community", DAY, q.communityBalance, keep = "Your essay is still here.")
            else -> null
        }
    }
}
