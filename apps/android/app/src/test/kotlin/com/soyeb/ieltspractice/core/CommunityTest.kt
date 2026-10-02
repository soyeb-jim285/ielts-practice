package com.soyeb.ieltspractice.core

import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import java.time.Instant
import java.time.ZoneId
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Community mode: quota and reset copy, the fair-use text, limit panels, own keys, and the guest session wiring against a fake server. */
class CommunityTest {
    private val now = Instant.parse("2026-10-03T18:00:00Z") // a Saturday
    private val dhaka = ZoneId.of("Asia/Dhaka")
    private val day = "2026-10-04T00:00:00.000Z"
    private val week = "2026-10-05T00:00:00.000Z"

    @AfterTest fun resetClock() { Clocks.now = { Instant.now() }; Clocks.zone = { ZoneId.systemDefault() } }

    private fun quota(tier: String, s: SkillQuota, w: SkillQuota = s, live: List<String> = emptyList(), balance: Balance? = Balance(20.0, 7.6, 12.4)) =
        Quota(tier, s, w, live, balance)

    // MARK: Copy

    @Test fun resetsInHoursUnderADayElseWeekdayInLocalTime() {
        assertEquals("Resets in 6 h", QuotaCopy.resets(day, now, dhaka))
        assertEquals("Resets in 25 min", QuotaCopy.resets("2026-10-03T18:25:00Z", now, dhaka))
        assertEquals("Resets Monday 6:00", QuotaCopy.resets(week, now, dhaka)) // 00:00 UTC is 6:00 in Dhaka
        assertEquals("Resets Monday 0:00", QuotaCopy.resets(week, now, ZoneId.of("UTC")))
        assertEquals("Resets in a moment", QuotaCopy.resets("2026-10-03T18:00:00Z", now, dhaka))
        assertEquals("Resets in a moment", QuotaCopy.resets("2026-10-03T18:01:00Z", now, dhaka)) // up to a minute, like web and iOS
        assertEquals("Resets in 2 min", QuotaCopy.resets("2026-10-03T18:01:30Z", now, dhaka))
        assertEquals("Resets in 4 h", QuotaCopy.resets("2026-10-03T22:20:00Z", now, dhaka)) // hours round to the nearest
        assertEquals("in 6 h", QuotaCopy.resetsWhen(day, now, dhaka))
        assertEquals("Monday 6:00", QuotaCopy.resetsWhen(week, now, dhaka))
        assertNull(QuotaCopy.resets(null, now, dhaka))
    }

    @Test fun testsLeftLine() {
        val daily = SkillQuota(0, 1, 1, day, "day")
        val weekly = SkillQuota(0, 1, 1, week, "week")
        assertEquals("1 test left today", QuotaCopy.left(quota("community", daily), "speaking", now, dhaka))
        assertEquals("1 test left this week", QuotaCopy.left(quota("guest", weekly), "writing", now, dhaka))
        assertEquals("No tests left. Resets Monday 6:00", QuotaCopy.left(quota("guest", SkillQuota(1, 1, 0, week, "week", Codes.QUOTA)), "speaking", now, dhaka))
        assertEquals("No tests left. Resets in 6 h", QuotaCopy.left(quota("community", SkillQuota(1, 1, 0, day, "day", Codes.QUOTA)), "speaking", now, dhaka))
        assertEquals("Unlimited with your key", QuotaCopy.left(quota("own-key", SkillQuota()), "speaking", now, dhaka))
        assertEquals("The community balance is used up for now", QuotaCopy.left(quota("community", SkillQuota(0, 1, 1, day, "day", Codes.BALANCE)), "writing", now, dhaka))
        assertEquals("2 tests left today", QuotaCopy.left(quota("community", SkillQuota(0, 2, 2, day, "day")), "speaking", now, dhaka))
    }

    @Test fun balanceMeterText() {
        assertEquals("Community balance \$12.40 of \$20", BalanceCopy.line(Balance(20.0, 7.6, 12.4)))
        assertEquals("Community balance \$0.18 of \$20.50", BalanceCopy.line(Balance(20.5, 20.32, 0.18)))
        assertNull(BalanceCopy.line(Balance(null, null, null))) // no limit: nothing to show
        assertNull(BalanceCopy.line(Balance(20.0, null, null)))
        assertEquals(0.62f, BalanceCopy.fraction(Balance(20.0, 7.6, 12.4))!!, 0.001f)
        assertFalse(BalanceCopy.low(Balance(20.0, 7.6, 12.4)))
        assertTrue(BalanceCopy.low(Balance(20.0, 19.82, 0.18)))
        assertFalse(BalanceCopy.low(null))
    }

    @Test fun fairUseTextMatchesTheContract() {
        val q = quota("community", SkillQuota(0, 1, 1, day, "day"))
        assertEquals(
            "This test is paid from a shared balance that everyone uses. Please don't abuse it: no spamming tests and no automated use. " +
                "You have 1 speaking test left today. Want unlimited tests and the live examiner? Add your own API key in Settings.",
            FairUse.body(q, "speaking", guest = false),
        )
        val guest = quota("guest", SkillQuota(0, 1, 1, week, "week"))
        assertTrue(FairUse.body(guest, "writing", guest = true).endsWith("You have 1 writing test left this week. Create an account for 1 test a day."))
        assertEquals("You're using the community balance", FairUse.TITLE)
    }

    @Test fun acknowledgementIsPerUserAndUtcDay() {
        assertEquals("u1@2026-10-03", FairUse.ackKey("u1", now))
        assertEquals("u1@2026-10-04", FairUse.ackKey("u1", Instant.parse("2026-10-04T00:00:00Z"))) // the UTC day, not the local one
        val ack = FairUseAck()
        assertFalse(ack.has("u1@2026-10-03"))
        ack.set("u1@2026-10-03")
        assertTrue(ack.has("u1@2026-10-03"))
        assertFalse(ack.has("u2@2026-10-03"))
        assertFalse(ack.has("u1@2026-10-04"))
    }

    @Test fun limitPanels() {
        val guestQuota = GateText.copy(Codes.QUOTA, "speaking", "guest", week, now = now, zone = dhaka)
        assertEquals("You've used this week's free test", guestQuota.title)
        assertEquals("It resets Monday 6:00.", guestQuota.body)
        assertEquals("Create an account for 1 test a day" to GateAction.Account, guestQuota.primary)
        val community = GateText.copy(Codes.QUOTA, "writing", "community", day, keep = "Your essay is still here.", now = now, zone = dhaka)
        assertEquals("You've used today's free test", community.title)
        assertEquals("It resets in 6 h. Your essay is still here.", community.body)
        assertEquals("Add your own key" to GateAction.Keys, community.primary)
        val balance = GateText.copy(Codes.BALANCE, "speaking", "community", null)
        assertEquals("The community balance is used up for now", balance.title)
        assertEquals("Free tests are paid from one shared balance, and it has run out. Add your own OpenRouter key to keep practising, or try again later.", balance.body)
        assertTrue(GateText.copy(Codes.BALANCE, "speaking", "guest", null).body.contains("Create an account, then add your own OpenRouter key"))
        assertEquals("Add your own OpenRouter key" to GateAction.Keys, balance.primary)
        assertEquals("Create an account" to GateAction.Account, GateText.copy(Codes.BALANCE, "speaking", "guest", null).primary)
        val busy = GateText.copy(Codes.BUSY, "speaking", "community", null)
        assertEquals("A lot of people are practising right now", busy.title)
        assertEquals("Try again in a few minutes.", busy.body)
        assertNull(busy.primary)
        assertEquals("You're going a bit fast", GateText.copy(Codes.FAST, "speaking", "guest", null).title)
        assertEquals("Try again in a moment.", GateText.copy(Codes.FAST, "speaking", "guest", null).body)
        assertEquals(GateAction.Account, GateText.copy(Codes.LIVE, "speaking", "guest", null).primary?.second)
        val live = GateText.copy(Codes.LIVE, "speaking", "community", null, needs = "OpenAI")
        assertEquals("The live examiner runs on your own key", live.title)
        assertEquals("Add your own OpenAI key in Settings.", live.body)
        assertEquals("Add your own Gemini key in Settings.", GateText.copy(Codes.LIVE, "speaking", "community", null, needs = "Gemini").body)
        assertEquals("Add your own key in Settings: OpenRouter for the turn-based examiner, OpenAI for GPT-Live, Gemini for Gemini Live.", GateText.copy(Codes.LIVE, "speaking", "community", null).body)
    }

    @Test fun keyErrorsNameTheProvider() {
        assertEquals("OpenAI didn't accept that key. Check that you copied all of it.", KeyCopy.error("openai", 400, Codes.INVALID_KEY, "x"))
        assertEquals("Couldn't reach Gemini to check the key. Try again.", KeyCopy.error("gemini", 502, Codes.KEY_CHECK, "x"))
        Clocks.zone = { ZoneId.of("UTC") }
        assertEquals("•••• ab12, added Oct 3", KeyCopy.saved(KeyInfo("openrouter", "ab12", "2026-10-03T10:15:00.000Z")))
        assertEquals("Unlimited tests", Providers.unlocks("openrouter"))
        assertEquals("OpenAI", Providers.name(Providers.keyFor("gpt-live")))
        assertEquals("OpenRouter", Providers.name(Providers.keyFor("turn")))
    }

    // MARK: Models

    @Test fun meCarriesTheQuota() {
        val me = AppJson.decodeFromString(
            Me.serializer(),
            """{"user":{"id":"u","email":"","name":"Guest","isAnonymous":true},"settings":{"models":{"analysis":"a","examiner":"b","stt":"c","tts":"d","ttsVoice":"v","audioPron":"p"},
              "audioPronEnabled":false,"liveProvider":"turn","targetBand":7,"writingAutoSubmit":true,"blockPaste":true},
              "tier":"guest","speaking":{"used":0,"limit":1,"remaining":1,"resetAt":"$week","window":"week","blocked":null},
              "writing":{"used":1,"limit":1,"remaining":0,"resetAt":"$week","window":"week","blocked":"quota_exceeded"},
              "liveProviders":[],"communityBalance":{"limit":20,"used":7.6,"remaining":12.4,"updatedAt":"x"}}""",
        )
        assertTrue(me.user.isAnonymous)
        val q = assertNotNull(me.quota())
        assertEquals("guest", q.tier)
        assertEquals(Codes.QUOTA, q.writing.blocked)
        assertNull(q.speaking.blocked)
        assertEquals(12.4, q.communityBalance?.remaining)
    }

    @Test fun anOwnKeyQuotaHasNullLimits() {
        val q = AppJson.decodeFromString(Quota.serializer(), """{"tier":"own-key","speaking":{"used":3,"limit":null,"remaining":null,"resetAt":null,"window":null,"blocked":null},"writing":{"used":0,"limit":null,"remaining":null,"resetAt":null,"window":null,"blocked":null},"liveProviders":["turn","gpt-live"],"communityBalance":{"limit":null,"used":null,"remaining":null,"updatedAt":null}}""")
        assertTrue(q.unlimited)
        assertNull(q.speaking.limit)
        assertEquals("Unlimited with your key", QuotaCopy.left(q, "speaking"))
        assertNull(BalanceCopy.line(q.communityBalance))
    }

    // MARK: Client against a fake server

    private class FakeServer : Interceptor {
        val seen = mutableListOf<Request>()
        val bodies = mutableListOf<String>()
        var respond: (Request) -> Triple<Int, String, Map<String, String>> = { Triple(200, "{}", emptyMap()) }

        override fun intercept(chain: Interceptor.Chain): Response {
            val req = chain.request()
            seen += req
            bodies += req.body?.let { b -> okio.Buffer().also { b.writeTo(it) }.readUtf8() }.orEmpty()
            val (code, body, headers) = respond(req)
            return Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(code).message("x")
                .apply { headers.forEach { (k, v) -> header(k, v) } }
                .body(body.toResponseBody("application/json".toMediaType())).build()
        }

        fun auth(path: String) = seen.last { it.url.encodedPath == path }.header("Authorization")
    }

    private fun me(anonymous: Boolean, tier: String) =
        """{"user":{"id":"${if (anonymous) "g1" else "u1"}","email":"${if (anonymous) "" else "a@b.c"}","name":"N","isAnonymous":$anonymous},
          "settings":{"models":{"analysis":"a","examiner":"b","stt":"c","tts":"d","ttsVoice":"v","audioPron":"p"},"audioPronEnabled":false,"liveProvider":"turn","targetBand":7,"writingAutoSubmit":true,"blockPaste":true},
          "tier":"$tier","speaking":{"used":0,"limit":1,"remaining":1,"resetAt":"$day","window":"day","blocked":null},
          "writing":{"used":0,"limit":1,"remaining":1,"resetAt":"$day","window":"day","blocked":null},"liveProviders":[],"communityBalance":null}"""

    @Test fun guestSessionUsesTheBearerHeaderAndLinksOnVerify() = runBlocking {
        val server = FakeServer()
        server.respond = { r ->
            when (r.url.encodedPath) {
                "/api/auth/sign-in/anonymous" -> Triple(200, """{"token":"raw-json-token","user":{"id":"g1"}}""", mapOf("set-auth-token" to "guest-bearer"))
                "/api/auth/email-otp/verify-email" -> Triple(200, "{}", mapOf("set-auth-token" to "account-bearer"))
                "/api/me" -> Triple(200, me(anonymous = r.header("Authorization") == "Bearer guest-bearer", tier = if (r.header("Authorization") == "Bearer guest-bearer") "guest" else "community"), emptyMap())
                else -> Triple(200, "{}", emptyMap())
            }
        }
        val store = MemoryTokenStore()
        val api = ApiClient("https://t.test", store, server)
        assertFalse(api.isSignedIn)
        assertEquals(0, server.seen.size) // nothing happens on launch: the guest session starts at the first test, not before

        api.ensureSession()
        assertEquals("guest-bearer", api.token.value) // the header, not the JSON `token`
        assertEquals("""{}""", server.bodies.first())
        assertFalse(api.hasAccount.value)
        assertTrue(store.loadGuest())
        assertEquals("guest", api.quota.value?.tier)
        api.ensureSession() // a second test start reuses it
        assertEquals(1, server.seen.count { it.url.encodedPath == "/api/auth/sign-in/anonymous" })

        // Verify-email goes out with the guest's credentials; the account's token then replaces them.
        api.verifyEmail("a@b.c", "123456")
        assertEquals("Bearer guest-bearer", server.auth("/api/auth/email-otp/verify-email"))
        assertEquals("account-bearer", api.token.value)
        assertTrue(api.hasAccount.value)
        assertFalse(store.loadGuest())
        assertEquals("Bearer account-bearer", server.auth("/api/me"))
        assertEquals("community", api.quota.value?.tier)
    }

    @Test fun errorsCarryTheCodeAndResetTime() = runBlocking {
        val server = FakeServer()
        server.respond = { Triple(429, """{"error":"No test left","code":"quota_exceeded","skill":"writing","resetAt":"$week","tier":"guest"}""", emptyMap()) }
        val api = ApiClient("https://t.test", MemoryTokenStore(), server)
        val e = assertFailsWith<ApiError> { api.raw("POST", "/api/attempts", null) }
        assertEquals(429, e.status)
        assertEquals(Codes.QUOTA, e.code)
        assertEquals("writing", e.skill)
        assertEquals(week, e.resetAt)
        assertEquals("guest", e.tier)
        assertTrue(e.isLimit)
        Clocks.zone = { dhaka }; Clocks.now = { now }
        assertEquals("You've used this week's free test. It resets Monday 6:00. Your recording is saved on this device.", GateText.sentence(e, "Your recording is saved on this device."))
    }

    @Test fun aGuestOnAnAccountOnlyEndpointIsNotSignedOut() = runBlocking {
        val server = FakeServer()
        server.respond = { r -> if (r.url.encodedPath == "/api/attempts") Triple(403, """{"error":"Create an account","code":"account_required"}""", emptyMap()) else Triple(200, "{}", emptyMap()) }
        val api = ApiClient("https://t.test", MemoryTokenStore(), server, initialToken = "g")
        assertTrue(api.hasAccount.value) // until told otherwise (the next /api/me says anonymous)
        val e = assertFailsWith<ApiError> { api.raw("GET", "/api/attempts") }
        assertEquals(Codes.ACCOUNT, e.code)
        assertEquals("g", api.token.value) // still the same session: not an expired one
        assertFalse(api.hasAccount.value) // the UI flips to its "Create an account" gate
    }

    @Test fun keysAreSentOnceAndOnlyTheLast4ComeBack() = runBlocking {
        val server = FakeServer()
        server.respond = { r ->
            when {
                r.method == "PUT" && r.url.encodedPath == "/api/keys/openai" -> Triple(200, """{"provider":"openai","last4":"cdef","addedAt":"2026-10-03T10:15:00.000Z","valid":true}""", emptyMap())
                r.url.encodedPath == "/api/me" -> Triple(200, me(false, "community"), emptyMap())
                else -> Triple(200, "{}", emptyMap())
            }
        }
        val api = ApiClient("https://t.test", MemoryTokenStore(), server, initialToken = "t")
        val info = api.saveKey("openai", "  sk-abcdef  ")
        assertEquals("cdef", info.last4)
        assertEquals("""{"key":"sk-abcdef"}""", server.bodies.first()) // trimmed, sent once
        assertTrue(server.seen.first().url.toString().endsWith("/api/keys/openai"))
        assertFalse(info.toString().contains("sk-abcdef"))
        server.respond = { Triple(400, """{"error":"Invalid key","code":"invalid_key"}""", emptyMap()) }
        val bad = assertFailsWith<ApiError> { api.saveKey("openai", "sk-wrong-key") }
        assertEquals("OpenAI didn't accept that key. Check that you copied all of it.", KeyCopy.error("openai", bad.status, bad.code, bad.message))
    }

    @Test fun demoOverlayBuildsTheCommunityStates() {
        DemoCommunity.pinClock()
        val base = mapOf("/api/me" to me(false, "x"))
        val spent = DemoCommunity.overlay(base, "gate-quota-community", null)
        val q = AppJson.decodeFromString(Quota.serializer(), spent.getValue("/api/quota"))
        assertEquals(Codes.QUOTA, q.speaking.blocked)
        assertNull(q.writing.blocked)
        assertEquals("community", AppJson.decodeFromString(Me.serializer(), spent.getValue("/api/me")).tier)
        val guest = DemoCommunity.overlay(base, "guest-result", null)
        assertTrue(AppJson.decodeFromString(Me.serializer(), guest.getValue("/api/me")).user.isAnonymous)
        assertEquals("OpenAI", Providers.name(DemoCommunity.keys("settings-own-key", null)[1].provider))
        assertTrue(DemoCommunity.guest("gate-live-guest"))
        assertFalse(DemoCommunity.anonymousSession("gate-live-guest"))
    }
}
