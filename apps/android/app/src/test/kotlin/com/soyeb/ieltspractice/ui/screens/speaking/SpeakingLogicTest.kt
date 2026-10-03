package com.soyeb.ieltspractice.ui.screens.speaking

import com.soyeb.ieltspractice.core.DemoFixtures
import com.soyeb.ieltspractice.core.AppJson
import com.soyeb.ieltspractice.core.Prompt
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

/** Pure speaking-flow helpers: ring zones, labels, cue-card text, upload progress copy. */
class SpeakingLogicTest {
    private fun prompt(part: Int, title: String = "T", body: String = "", bullets: List<String>? = null) =
        Prompt(id = "p$part", skill = "speaking", part = part, title = title, body = body, bullets = bullets)

    @Test fun zonesFollowThePartTargets() {
        assertEquals(Zone.Brand, zoneTone(1, 10.0))
        assertEquals(Zone.Good, zoneTone(1, 15.0))
        assertEquals(Zone.Good, zoneTone(1, 40.0))
        assertEquals(Zone.Warn, zoneTone(1, 41.0))
        assertEquals(Zone.Brand, zoneTone(2, 59.0))
        assertEquals(Zone.Warn, zoneTone(2, 75.0)) // P2 is only green from 1:30
        assertEquals(Zone.Good, zoneTone(2, 100.0))
        assertEquals(Zone.Warn, zoneTone(2, 121.0))
        assertEquals(Zone.Good, zoneTone(3, 45.0))
        assertEquals(Zone.Warn, zoneTone(3, 61.0))
    }

    @Test fun hintsMatchTheZones() {
        assertEquals("Aim for 15-40 s", zoneHint(1, 3))
        assertEquals("In the target zone", zoneHint(3, 45))
        assertEquals("Time to wrap up", zoneHint(3, 70))
        assertEquals("Good. Keep going to 1:30 or more", zoneHint(2, 75))
        assertEquals("In the target zone", zoneHint(2, 100))
    }

    @Test fun partLabelsCountPart1Topics() {
        val items = listOf(prompt(1), prompt(1), prompt(2), prompt(3))
        assertEquals("Part 1, 1 of 2", partLabel(items, 0))
        assertEquals("Part 1, 2 of 2", partLabel(items, 1))
        assertEquals("Part 2", partLabel(items, 2))
        assertEquals("Speaking", partLabel(items, 9))
        assertEquals("Part 1", partLabel(listOf(prompt(1), prompt(2)), 0))
    }

    @Test fun exitMessageListsWhatIsAtRisk() {
        assertEquals("Answers already uploaded are still analysed.", exitMessage(false, false))
        assertEquals(
            "The answer you are recording now will be discarded. Recordings that have not uploaded stay on this device. Upload them from the Speaking page. Answers already uploaded are still analysed.",
            exitMessage(true, true),
        )
    }

    @Test fun uploadProgressCopy() {
        assertEquals("Uploading 1 of 3", finishProgress(3, 0, 0))
        assertEquals("Uploading 3 of 3", finishProgress(3, 2, 0))
        assertEquals("3 of 3 uploaded", finishProgress(3, 3, 0))
        assertEquals("1 of 3 uploaded, 1 failed", finishProgress(3, 1, 1))
    }

    @Test fun cueIntroDropsTheTitleAndTheLeadWhenThereAreBullets() {
        val p = prompt(2, "Describe a book", "Describe a book\nYou should say:", listOf("what it was"))
        assertEquals("", cueIntro(p))
        assertEquals("You should say:", cueIntro(p.copy(bullets = null)))
        assertEquals("Say why.", cueIntro(p.copy(body = "Describe a book\nSay why.\nYou should say:")))
    }

    @Test fun sentenceCaseOnlyFixesAllCaps() {
        assertEquals("Your hometown", sentenceCase("YOUR HOMETOWN"))
        assertEquals("Your Hometown", sentenceCase("Your Hometown"))
        assertEquals("A", sentenceCase("A"))
    }

    @Test fun isoMillisParsesServerTimestamps() {
        assertEquals(1_790_000_000_000L, isoMillis("2026-09-21T14:13:20.000Z"))
        assertEquals(null, isoMillis("not a date"))
    }

    @Test fun speakingFixturesDecodeAsPrompts() {
        val fx = DemoFixtures.parse(File("../../ios/IELTS/Demo/fixtures.json").readText())
        val p2 = AppJson.decodeFromString(Prompt.serializer(), fx.getValue("/api/prompts/random?part=2&skill=speaking"))
        assertEquals(2, p2.part)
        assertEquals(listOf(p2.title), p2.questions)
        assertEquals("and explain how it changed the way you think.", cueIntro(p2))
    }
}
