package com.soyeb.ieltspractice.live

import com.soyeb.ieltspractice.core.AppJson
import com.soyeb.ieltspractice.core.Me
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** GPT-Live relay wire format: the messages we send and how relay messages become events (no network). Mirrors apps/ios/IELTSTests/GPTLiveTests.swift. */
class GPTLiveTest {
    private fun obj(s: String): JsonObject = Json.parseToJsonElement(s).jsonObject

    @Test fun relayUrlIsTheServerHostOverWebSocketWithTheSessionId() {
        assertEquals("wss://ielts.soyebjim.me/api/live/gpt-live/ws?sessionId=abc", GPTLive.url("https://ielts.soyebjim.me", "abc"))
        assertEquals("ws://localhost:8787/api/live/gpt-live/ws?sessionId=x", GPTLive.url("http://localhost:8787", "x"))
        assertEquals(24_000, GPTLive.RATE)
    }

    @Test fun clientMessages() {
        assertEquals(obj("""{"type":"session.input_audio.append","audio":"aGk="}"""), GPTLive.audio(byteArrayOf(104, 105)))
        assertEquals(obj("""{"type":"session.input_audio.mute"}"""), GPTLive.mute(true))
        assertEquals(obj("""{"type":"session.input_audio.unmute"}"""), GPTLive.mute(false))
        assertEquals(obj("""{"type":"app.cue","cue":"part2"}"""), GPTLive.cue("part2"))
        assertEquals(obj("""{"type":"session.close"}"""), GPTLive.close)
    }

    @Test fun events() {
        assertEquals(GPTLive.Event.Started, GPTLive.parse(obj("""{"type":"session.started","session":{"id":"s"}}""")))
        assertContentEquals(byteArrayOf(104, 105), (GPTLive.parse(obj("""{"type":"session.output_audio.delta","audio":"aGk="}""")) as GPTLive.Event.Audio).pcm)
        assertContentEquals(byteArrayOf(104, 105), (GPTLive.parse(obj("""{"type":"session.output_audio.delta","delta":"aGk="}""")) as GPTLive.Event.Audio).pcm)
        assertEquals(GPTLive.Event.OutText("Hello."), GPTLive.parse(obj("""{"type":"session.output_transcript.delta","delta":"Hello."}""")))
        assertEquals(GPTLive.Event.InText(" Sam"), GPTLive.parse(obj("""{"type":"session.input_transcript.delta","delta":" Sam"}""")))
        assertEquals(GPTLive.Event.Closed("expired"), GPTLive.parse(obj("""{"type":"session.closed","reason":"expired"}""")))
        assertEquals(GPTLive.Event.Error("bad"), GPTLive.parse(obj("""{"type":"error","error":{"message":"bad"}}""")))
        assertNull(GPTLive.parse(obj("""{"type":"session.usage.updated"}""")))
    }

    @Test fun meAcceptsBothAvailabilityFlagsAndMigratesTheOldProvider() {
        val base = """"user":{"id":"u","email":"a@b.c","name":"A"},"settings":{"models":{"analysis":"a","examiner":"e","stt":"s","tts":"t","ttsVoice":"v","audioPron":"p"},"audioPronEnabled":true,"liveProvider":"openai-realtime","targetBand":7,"writingAutoSubmit":true,"blockPaste":true}"""
        val both = AppJson.decodeFromString(Me.serializer(), "{$base,\"gptLiveAvailable\":true,\"realtimeAvailable\":true}")
        assertTrue(both.gptLive)
        assertEquals("gpt-live", both.settings.provider)
        assertTrue(AppJson.decodeFromString(Me.serializer(), "{$base,\"realtimeAvailable\":true}").gptLive) // an older server
        assertEquals(false, AppJson.decodeFromString(Me.serializer(), "{$base,\"gptLiveAvailable\":false,\"realtimeAvailable\":true}").gptLive)
    }
}
