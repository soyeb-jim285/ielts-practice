package com.soyeb.ieltspractice.ui.screens.shell

import com.soyeb.ieltspractice.core.AppJson
import com.soyeb.ieltspractice.core.DemoFixtures
import com.soyeb.ieltspractice.core.decodeList
import java.io.File
import java.time.Instant
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Plain JVM tests for the shell screens' logic and for their view-local models against the shared demo fixtures. */
class ShellLogicTest {
    private val fixtures = DemoFixtures.parse(File("../../ios/IELTS/Demo/fixtures.json").readText())
    private val utc = ZoneOffset.UTC
    private val now = Instant.parse("2026-10-01T12:00:00Z")

    @Test fun localModelsDecodeTheFixtures() {
        val p = AppJson.decodeFromString(DashProgress.serializer(), fixtures.getValue("/api/progress"))
        assertEquals(14, p.attempts)
        assertEquals("p", p.weakest?.key)
        assertNull(p.lastFailed)
        assertTrue(AppJson.decodeFromString(BankPage.serializer(), fixtures.getValue("/api/prompts")).items.isNotEmpty())
        assertTrue(AppJson.decodeFromString(BankMeta.serializer(), fixtures.getValue("/api/prompts/meta")).groups.isNotEmpty())
        assertTrue(AppJson.decodeFromString(HistoryPage.serializer(), fixtures.getValue("/api/attempts")).items.isNotEmpty())
        val due = AppJson.decodeFromString(DueResponse.serializer(), fixtures.getValue("/api/cards/due"))
        assertEquals(3, due.dueTotal) // `items` wrapper, no `total`
        assertEquals(listOf("Charon", "Puck", "Kore"), AppJson.decodeList<TtsModel>(fixtures.getValue("/api/models?capability=tts")).first().voices)
    }

    @Test fun dayBuckets() {
        fun b(s: String) = ShellDate.bucket(s, now, utc)
        assertEquals("Today", b("2026-10-01T00:30:00.000Z"))
        assertEquals("Yesterday", b("2026-09-30T23:59:00Z"))
        assertEquals("Past 7 days", b("2026-09-26T09:30:00Z"))
        assertEquals("Past 30 days", b("2026-09-10T09:30:00Z"))
        assertEquals("Older", b("2026-07-01T09:30:00Z"))
        assertEquals("Older", b("garbage"))
        assertEquals("30 Sep 2026", ShellDate.date("2026-09-30T09:30:00.000Z", utc))
    }

    @Test fun relativeTimes() {
        fun r(s: String) = ShellDate.relative(s, now, utc)
        assertEquals("now", r("2026-10-01T11:59:40Z"))
        assertEquals("5 minutes ago", r("2026-10-01T11:55:00Z"))
        assertEquals("3 hours ago", r("2026-10-01T09:00:00Z"))
        assertEquals("yesterday", r("2026-09-30T09:30:00Z"))
        assertEquals("3 days ago", r("2026-09-28T09:30:00Z"))
        assertEquals("last week", r("2026-09-22T09:30:00Z"))
        assertEquals("2 months ago", r("2026-08-01T09:30:00Z"))
    }

    @Test fun durations() {
        assertEquals("42s", ShellDate.duration(42_000))
        assertEquals("1m 35s", ShellDate.duration(95_000))
        assertEquals("2m", ShellDate.duration(120_000))
        assertEquals("1h 5m", ShellDate.duration(3_900_000))
        val speaking = HistoryItem("a", "t", "speaking", 1, "done", 6.5, "2026-09-30T09:30:00Z", durationMs = 30_000)
        assertEquals("30s", speaking.shownDuration())
        assertNull(speaking.copy(skill = "writing").shownDuration()) // a short editor session is a pasted or abandoned essay
        assertEquals("Part 1, 30 Sep 2026, 30s", speaking.meta().replace(Regex("\\d+ \\w+ \\d{4}"), "30 Sep 2026"))
    }

    @Test fun groupsRunsStayInOrder() {
        val runs = runsBy(listOf("a1", "a2", "b1", "a3")) { it.take(1) }
        assertEquals(listOf("a" to listOf("a1", "a2"), "b" to listOf("b1"), "a" to listOf("a3")), runs)
    }

    @Test fun bankFilters() {
        val meta = listOf(
            BankGroup("speaking", 1, listOf("Hometown", null), listOf("p1-topic")),
            BankGroup("writing", 1, listOf("Energy"), listOf("line", "letter-formal")),
            BankGroup("writing", 2, listOf("Technology"), listOf("opinion")),
        )
        assertEquals(emptyList(), bankTypes(meta, "writing", "all")) // types only once a part is picked
        assertEquals(listOf("line"), bankTypes(meta, "writing", "1-academic")) // letters are General
        assertEquals(listOf("letter-formal"), bankTypes(meta, "writing", "1-general"))
        assertEquals(listOf("Energy", "Technology"), bankTopics(meta, "writing", "all"))
        assertEquals(listOf("Hometown"), bankTopics(meta, "speaking", "all")) // nulls dropped
        assertEquals(1, partNum("1-general"))
        assertEquals("general", partVariant("1-general"))
        assertNull(partNum("all"))
        assertNull(partVariant("2"))
        assertEquals("Line graph", bankTypeLabel("line"))
        assertEquals("Letter complaint", bankTypeLabel("letter-complaint"))
        assertEquals("Grammar and more", pretty("grammar-and-more"))
    }

    @Test fun bankRowSecondLine() {
        val p1 = BankPrompt("1", "speaking", 1, title = "Hometown", body = "x\ny", followUps = listOf("Where is it?"))
        assertEquals("Where is it?", bankQuestion(p1))
        assertEquals("Say what it was", bankQuestion(p1.copy(part = 2, bullets = listOf("what it was"))))
        assertEquals("Line graph", bankQuestion(BankPrompt("2", "writing", 1, "line", "Energy")))
        assertEquals("Writing, Task 1 Academic", bankGroupLabel(BankPrompt("2", "writing", 1, "line", "Energy"), "1-academic"))
        assertEquals("Speaking, Part 3", bankGroupLabel(p1.copy(part = 3), "all"))
    }

    @Test fun nextUpPicksTheWeakestCriterion() {
        val progress = AppJson.decodeFromString(DashProgress.serializer(), fixtures.getValue("/api/progress"))
        val n = nextUp(progress, 7.0)
        assertEquals("Pronunciation is holding your band back", n.title)
        assertEquals("speaking-1", n.route) // default part for pronunciation (the fixture trend has no skill/part)
        assertEquals("Practise Part 1 (Pronunciation)", n.cta)
        assertTrue(n.body.startsWith("You average 6.0 here, 1.0 below your 7.0 target, and your lowest scores came in Part 1."))
        val none = nextUp(progress.copy(weakest = null), 7.0)
        assertEquals("speaking-full", none.route)
        assertEquals("Start a full speaking test", none.cta)
    }

    @Test fun practiceTargetUsesYourLowestPart() {
        val trend = listOf(
            DashPoint("speaking", 1, mapOf("fc" to 6.5)), DashPoint("speaking", 3, mapOf("fc" to 5.5)),
            DashPoint("speaking", 3, mapOf("fc" to 6.0)), DashPoint("writing", 2, mapOf("fc" to 4.0)),
        )
        assertEquals("speaking" to 3, practiceTarget("fc", trend))
        assertEquals("speaking" to 2, practiceTarget("fc", emptyList())) // the default
        assertEquals("writing" to 2, practiceTarget("ta", trend))
        assertNull(practiceTarget("nope", trend))
    }

    @Test fun greetingsAndLabels() {
        assertEquals("Good evening", greeting(3))
        assertEquals("Good morning", greeting(9))
        assertEquals("Good afternoon", greeting(14))
        assertEquals("Good evening", greeting(20))
        assertEquals("1 day in a row", streakLabel(1))
        assertEquals("Practise today to start a streak", streakLabel(0))
        assertEquals("<1 min practised this week", minutesLabel(0.4))
        assertEquals("1 minute practised this week", minutesLabel(1.9))
        assertEquals("Add corrections from Mistakes to start your deck", reviewMeta(DueResponse(items = emptyList(), deck = 0)))
        assertEquals("All caught up for today", reviewMeta(DueResponse(items = emptyList(), deck = 4)))
        assertEquals("A few minutes keeps corrections from slipping", reviewMeta(DueResponse(items = listOf(DueCard("1", "a", "b")))))
    }

    @Test fun trendAxis() {
        val (lo, ticks) = trendTicks(listOf(5.0, 6.5), 7.0)
        assertEquals(4.5, lo)
        assertEquals((5..9).toList(), ticks)
        assertEquals(0.0, trendTicks(emptyList(), 7.0).first)
    }

    @Test fun srsIntervalsMatchTheCoreScheduler() {
        val fresh = DueCard("1", "a", "b")
        assertEquals(1, nextInterval(fresh, 1)) // Again
        assertEquals(1, nextInterval(fresh, 4)) // first success: 1 day
        assertEquals(6, nextInterval(fresh.copy(reps = 1), 4)) // second: 6 days
        // third: interval * ease, where Good keeps 2.5 and Easy raises it (+0.1)
        assertEquals(25, nextInterval(fresh.copy(reps = 2, interval = 10.0, ease = 2.5), 4))
        assertEquals(26, nextInterval(fresh.copy(reps = 2, interval = 10.0, ease = 2.5), 5))
        assertEquals(24, nextInterval(fresh.copy(reps = 2, interval = 10.0, ease = 2.5), 3)) // Hard lowers it (-0.14: 10 * 2.36)
        assertEquals("1 day", daysLabel(1))
        assertEquals("12 days", daysLabel(12))
        assertEquals("2 mo", daysLabel(55))
    }

    @Test fun fixCardsSplitTitleFromSentence() {
        assertEquals("Use a stronger verb" to "He did a mistake.", splitFixCard(DueCard("1", "Use a stronger verb\n\nHe did a mistake.", "b", source = "fix")))
        assertEquals(null to "a\n\nb", splitFixCard(DueCard("1", "a\n\nb", "b", source = "mistake")))
    }

    @Test fun listeningCardsSpeakTheFirstLineOfTheBack() {
        assertEquals("speech", heardWord(DueCard("1", "🎧 Listening · spell the word you heard: 's____h' (6 letters)", " speech \nYou wrote: speach")))
        assertNull(heardWord(DueCard("1", "🎧 Listening · spell the word you heard", "\nYou wrote: x")))
        assertNull(heardWord(DueCard("1", "Vocabulary", "speech")))
    }

    @Test fun historyBadges() {
        assertEquals("Scoring" to "brand", historyStatus("analyzing"))
        assertNull(historyStatus("done"))
        assertEquals("Under length", historyFlag("tooShort"))
        assertNull(historyFlag(null))
    }

    @Test fun otpWording() {
        assertEquals("That code isn't right. Check it and try again.", otpError(400, "INVALID_OTP", ""))
        assertEquals("That code has expired. Request a new one.", otpError(400, "OTP_EXPIRED", ""))
        assertEquals("Too many wrong tries. Request a new code.", otpError(400, "TOO_MANY_ATTEMPTS", ""))
        assertEquals("Too many requests. Wait a minute, then try again.", otpError(429, null, "x"))
        assertEquals("Too many wrong codes. Try again in 12 minutes.", otpError(429, "otp_locked", "Too many wrong codes. Try again in 12 minutes."))
        assertEquals("Offline", otpError(0, null, "Offline"))
        assertEquals("Something went wrong. Try again.", otpError(500, null, ""))
        assertEquals("123456", otpDigits("12 34-56 78"))
    }

    @Test fun emailStatusWording() {
        val z = ZoneOffset.UTC
        val sent = com.soyeb.ieltspractice.core.EmailStatus("sent", "2026-01-01T12:01:00Z", "j•••@gmail.com", 0, false)
        val now = Instant.parse("2026-01-01T12:01:20Z").toEpochMilli()
        assertEquals("Code sent to j•••@gmail.com at 12:01. Check your spam folder if it doesn't show up." to false, emailStatusLine(sent, now, z))
        assertEquals("Code already sent 20 s ago to j•••@gmail.com; it is still valid. Check spam; you can resend in 10 s." to false, emailStatusLine(sent.copy(alreadySent = true, resendAvailableIn = 10), now, z))
        assertEquals("We couldn't send the email (the email service is busy). Try again." to true, emailStatusLine(sent.copy(status = "failed", error = "rate_limited"), now, z))
        assertEquals("Sending the code…" to false, emailStatusLine(null, now, z))
    }

    @Test fun modelLabels() {
        assertEquals("gpt-6-luna", shortModel("openai/gpt-6-luna"))
        assertEquals("\$0.10 in · \$0.50 out per 1M tokens", modelPrice("1e-7", "5e-7"))
        assertNull(modelPrice("0", "0"))
        assertNull(modelPrice(null, "1"))
    }
}
