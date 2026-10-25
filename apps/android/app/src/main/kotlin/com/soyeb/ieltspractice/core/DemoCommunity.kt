package com.soyeb.ieltspractice.core

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import java.time.Instant
import java.time.ZoneId

/**
 * Demo mode for plan and limit screens: which quota a screenshot shows, by screen name (see ui/nav/ScreenCatalog.kt).
 * Layered over the shared fixtures (`/api/me`, `/api/quota`), so the iOS fixture file stays as it is.
 * Time is pinned (Sat 3 Oct 2026, 18:00 UTC, shown in Dhaka time) so "Resets in 6 h" and "Resets Monday 6:00" never change.
 */
object DemoCommunity {
    private const val DAY = "2026-10-04T00:00:00.000Z"
    private const val WEEK = "2026-10-05T00:00:00.000Z"

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
        val guest = guest(screen)
        val window = if (guest) "week" else "day"
        var speaking = open(window)
        var writing = open(window)
        when (screen) {
            "quota-speaking-spent", "gate-quota-community" -> speaking = spent(window)
            "gate-quota-guest", "editor-blocked" -> writing = spent(window)
            "gate-balance" -> { speaking = blocked(window, Codes.BALANCE); writing = blocked(window, Codes.BALANCE) }
            "gate-busy" -> { speaking = blocked(window, Codes.BUSY); writing = blocked(window, Codes.BUSY) }
        }
        // The live examiner screens run with no limits (the gates before them are their own screenshots).
        if (screen?.startsWith("live") == true) return Quota("unlimited", SkillQuota(), SkillQuota(), SkillQuota(), true)
        return Quota(if (guest) "guest" else "community", speaking, writing, open(window), screen != "gate-live")
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
        return out
    }

    /** The panel a `gate-*` screenshot shows over its screen. */
    fun gate(screen: String?): Gate? {
        val q = quota(screen)
        return when (screen) {
            "gate-fairuse" -> Gate.FairUse("speaking", q, false) {}
            "gate-fairuse-guest" -> Gate.FairUse("writing", q, true) {}
            "gate-quota-guest" -> Gate.Blocked(Codes.QUOTA, "writing", "guest", WEEK)
            "gate-quota-community" -> Gate.Blocked(Codes.QUOTA, "speaking", "community", DAY)
            "gate-balance" -> Gate.Blocked(Codes.BALANCE, "speaking", "community", null)
            "gate-busy" -> Gate.Blocked(Codes.BUSY, "writing", "community", null)
            "gate-live" -> Gate.Blocked(Codes.LIVE, "speaking", "community", null)
            "editor-blocked" -> Gate.Blocked(Codes.QUOTA, "writing", "community", DAY, keep = "Your essay is still here.")
            else -> null
        }
    }
}
