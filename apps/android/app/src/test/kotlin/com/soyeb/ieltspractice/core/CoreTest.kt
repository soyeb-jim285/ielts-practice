package com.soyeb.ieltspractice.core

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.KSerializer
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Plain JVM tests (no Robolectric): models vs the shared fixtures, the API client against the demo interceptor, helpers. */
class CoreTest {
    // The cwd of a unit test is the module dir (apps/android/app).
    private val fixtures = DemoFixtures.parse(File("../../ios/IELTS/Demo/fixtures.json").readText())

    private fun <T> decode(s: KSerializer<T>, key: String): T = AppJson.decodeFromString(s, fixtures.getValue(key))

    @Test fun meDecodes() {
        val me = decode(Me.serializer(), "/api/me")
        assertEquals("Maya Rahman", me.user.name)
        assertEquals(7.0, me.settings.targetBand)
    }

    @Test fun everyAttemptFixtureDecodes() {
        val keys = fixtures.keys.filter { Regex("^/api/attempts/[a-z0-9]+$").matches(it) }
        assertTrue(keys.size >= 7, "expected the attempt fixtures, found $keys")
        keys.forEach { decode(Attempt.serializer(), it) }
        val speaking = decode(Attempt.serializer(), "/api/attempts/as1")
        assertNotNull(speaking.analysis?.metrics)
        assertNotNull(speaking.answerText)
        assertEquals(setOf("fc", "lr", "gra", "p"), speaking.analysis!!.criteria.keys)
    }

    @Test fun progressListsAndPages() {
        fixtures.keys.filter { it.startsWith("/api/progress") }.forEach { decode(ProgressData.serializer(), it) }
        fixtures.keys.filter { it.startsWith("/api/attempts") && !it.matches(Regex("^/api/attempts/.+")) }.forEach { decode(AttemptPage.serializer(), it) }
        assertTrue(decode(MistakeLog.serializer(), "/api/mistakes").items.isNotEmpty())
        fixtures.keys.filter { it.startsWith("/api/prompts/random") }.forEach { decode(Prompt.serializer(), it) }
        decode(SpeakingTest.serializer(), "/api/speaking/test")
        decode(LiveReply.serializer(), "/api/live/start")
    }

    @Test fun listsAcceptWrappers() {
        assertTrue(AppJson.decodeList<ReviewCard>(fixtures.getValue("/api/cards/due")).isNotEmpty()) // { items }
        assertTrue(AppJson.decodeList<ModelInfo>(fixtures.getValue("/api/models")).isNotEmpty()) // { models }
        assertEquals(2, AppJson.decodeList<ReviewCard>("""[{"id":"1","front":"a","back":"b"},{"id":"2","front":"c","back":"d"}]""").size) // bare
        assertEquals(1, AppJson.decodeList<ReviewCard>("""{"cards":[{"id":"1","front":"a","back":"b"}]}""").size)
        assertEquals(1, AppJson.decodeList<ReviewCard>("""{"data":[{"id":"1","front":"a","back":"b"}]}""").size)
        assertFailsWith<Exception> { AppJson.decodeList<ReviewCard>("""{"nope":1}""") }
    }

    @Test fun lenientDecoding() {
        // unknown keys ignored, null falls back to the default, a malformed chart does not fail the prompt
        val p = AppJson.decodeFromString(
            Prompt.serializer(),
            """{"id":"p","skill":"writing","part":1,"title":"t","body":"b","extra":1,"done":null,"chart":{"kind":"bar","categories":"oops"}}""",
        )
        assertNull(p.chartSpec)
        assertEquals(listOf("b"), p.questions)
        val c = AppJson.decodeFromString(
            ChartSpec.serializer(),
            """{"kind":"table","title":"T","columns":["a","b"],"rows":[["x",3],["y",4.5]]}""",
        )
        assertEquals(listOf(listOf("x", "3"), listOf("y", "4.5")), c.rowsText)
    }

    @Test fun demoClientSignsInAndReads() = runBlocking {
        val api = ApiClient("https://demo.ielts.local", MemoryTokenStore(), DemoInterceptor(fixtures))
        assertTrue(!api.isSignedIn)
        api.signIn("maya@example.com", "password1") // the demo interceptor answers with set-auth-token: demo
        assertTrue(api.isSignedIn)
        assertEquals("demo", api.token.value)
        assertEquals("Maya Rahman", api.me.value?.user?.name)
        val page: AttemptPage = api.get("/api/attempts", mapOf("skill" to "speaking", "page" to "1")) // query keys are sorted to match the fixture key
        assertTrue(page.items.isNotEmpty())
        assertTrue(api.getList<ReviewCard>("/api/cards/due").isNotEmpty())
        val e = assertFailsWith<ApiError> { api.get<Me>("/api/nope") }
        assertEquals(404, e.status)
        assertEquals(0, api.inflight.get())
    }

    @Test fun bandRounding() {
        listOf(6.0 to 6.0, 6.1 to 6.0, 6.25 to 6.5, 6.4 to 6.5, 6.5 to 6.5, 6.74 to 6.5, 6.75 to 7.0, 6.9 to 7.0, 8.875 to 9.0)
            .forEach { (x, y) -> assertEquals(y, Band.round(x), "round($x)") }
        assertEquals(Band.Overall(6.25, 6.5), Band.speakingOverall(7.0, 6.0, 6.0, 6.0))
        assertEquals(6.5, Band.writingOverall(6.0, 7.0).band) // task 2 counts double: (6 + 14) / 3 = 6.67 -> 6.5
        assertEquals("7", Band.format(7.0))
        assertEquals("6.5", Band.format(6.5))
    }

    @Test fun formatting() {
        assertEquals("Grammar: article", categoryLabel("grammar.article"))
        assertEquals("Grammar: run-on", categoryLabel("grammar.run-on"))
        assertEquals("Vocabulary: word choice", categoryLabel("lexis.word-choice"))
        assertEquals("1:05", clock(65))
        assertEquals("-0:03", clock(-3))
        assertEquals("6.5", fmt(6.456))
    }
}
