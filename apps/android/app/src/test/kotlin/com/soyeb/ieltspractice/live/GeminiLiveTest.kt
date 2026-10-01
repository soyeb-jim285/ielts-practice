package com.soyeb.ieltspractice.live

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The Gemini Live wire format (docs/live-examiner.md) . Mirrors apps/ios/IELTSTests/GeminiLiveTests.swift. */
class GeminiLiveTest {
    private fun obj(s: String) = Json.parseToJsonElement(s).jsonObject

    @Test fun urlUsesTheConstrainedEndpointWithTheToken() {
        val u = GeminiLive.url("auth_tokens/abc+1")
        assertTrue(u.startsWith("wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token="))
        assertTrue(u.endsWith("auth_tokens%2Fabc%2B1"))
    }

    @Test fun setupOnlyCarriesTheModelAndResumption() {
        assertEquals(obj("""{"setup":{"model":"models/gemini-3.8-live","sessionResumption":{}}}"""), GeminiLive.setup("gemini-3.8-live", null))
        assertEquals(
            obj("""{"setup":{"model":"models/m","sessionResumption":{"handle":"h1"}}}"""), GeminiLive.setup("m", "h1"),
        )
    }

    @Test fun audioIsBase64Pcm16At16k() {
        val m = GeminiLive.audio(byteArrayOf(1, 0, 2, 0))
        val a = m["realtimeInput"]!!.jsonObject["audio"]!!.jsonObject
        assertEquals("AQACAA==", a["data"]!!.jsonPrimitive.content)
        assertEquals("audio/pcm;rate=16000", a["mimeType"]!!.jsonPrimitive.content)
    }

    @Test fun cuesAreTaggedAndCompleteTheTurn() {
        val c = GeminiLive.cue("Begin the test.")
        assertEquals(
            obj("""{"clientContent":{"turns":[{"role":"user","parts":[{"text":"[APP CUE] Begin the test."}]}],"turnComplete":true}}"""), c,
        )
        assertEquals(obj("""{"realtimeInput":{"audioStreamEnd":true}}"""), GeminiLive.audioEnd)
    }

    @Test fun parseOrdersAnInterruptionBeforeTheNewAudio() {
        val m = obj(
            """{"serverContent":{"interrupted":true,"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AQACAA=="}},{"text":"ignored"}]},
               "outputTranscription":{"text":"Hello"},"inputTranscription":{"text":"hi"},"generationComplete":true,"turnComplete":true}}""",
        )
        val ev = GeminiLive.parse(m)
        assertEquals(GeminiLive.Event.Interrupted, ev[0])
        assertEquals(GeminiLive.Event.InText("hi"), ev[1])
        assertContentEquals(byteArrayOf(1, 0, 2, 0), (ev[2] as GeminiLive.Event.Audio).pcm)
        assertEquals(listOf<Any>(GeminiLive.Event.OutText("Hello"), GeminiLive.Event.GenerationComplete, GeminiLive.Event.TurnComplete), ev.drop(3))
    }

    @Test fun parseSetupGoAwayAndResumption() {
        assertEquals(listOf<Any>(GeminiLive.Event.SetupComplete), GeminiLive.parse(obj("""{"setupComplete":{}}""")))
        assertEquals(listOf<Any>(GeminiLive.Event.GoAway(1.5)), GeminiLive.parse(obj("""{"goAway":{"timeLeft":"1.5s"}}""")))
        assertEquals(
            listOf<Any>(GeminiLive.Event.Resume("h2")),
            GeminiLive.parse(obj("""{"sessionResumptionUpdate":{"newHandle":"h2","resumable":true}}""")),
        )
        assertEquals(emptyList<GeminiLive.Event>(), GeminiLive.parse(obj("""{"sessionResumptionUpdate":{"newHandle":"h3","resumable":false}}""")))
        assertEquals(emptyList<GeminiLive.Event>(), GeminiLive.parse(JsonObject(emptyMap())))
    }

    @Test fun phaseLabelsMatchTheWeb() {
        assertEquals("Part 2: Long turn", phaseLabel("p2-follow"))
        assertEquals("Part 1: Introduction and interview", phaseLabel("p1"))
        assertEquals("End of the test", phaseLabel("closing"))
    }
}
