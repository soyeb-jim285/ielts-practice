package com.soyeb.ieltspractice.ui.screens.result

import android.speech.tts.TextToSpeech
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.LocalDemo
import com.soyeb.ieltspractice.audio.AudioPlayer
import com.soyeb.ieltspractice.core.AppJson
import com.soyeb.ieltspractice.core.PronAudioWord
import com.soyeb.ieltspractice.core.PronunciationAudio
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.SectionTitle
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.URLEncoder
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.roundToInt

// Mirrors: web components/speaking/PronunciationPanel.tsx

/** Human recordings and IPA from Wiktionary, through the Free Dictionary API (free, no key). Names and rare forms are often missing. */
data class DictEntry(val uk: String? = null, val us: String? = null, val ipa: String? = null)

/** The Free Dictionary API answer to a [DictEntry]: the -uk / -us recordings (any recording counts as US when there is no UK one), the first IPA. */
fun parseDictionary(json: String): DictEntry {
    val entries = runCatching { AppJson.parseToJsonElement(json).jsonArray.map { it.jsonObject } }.getOrNull() ?: return DictEntry()
    val ph = entries.flatMap { e -> e["phonetics"]?.let { runCatching { it.jsonArray.map { p -> p.jsonObject } }.getOrNull() }.orEmpty() }
    fun str(o: Map<String, kotlinx.serialization.json.JsonElement>, k: String) = runCatching { o[k]?.jsonPrimitive?.contentOrNull }.getOrNull()?.takeIf { it.isNotEmpty() }
    fun audio(accent: String) = ph.firstNotNullOfOrNull { p -> str(p, "audio")?.takeIf { it.endsWith("-$accent.mp3") } }
    val uk = audio("uk")
    val us = audio("us") ?: if (uk != null) null else ph.firstNotNullOfOrNull { str(it, "audio") }
    val ipa = entries.firstOrNull()?.let { str(it, "phonetic") } ?: ph.firstNotNullOfOrNull { str(it, "text") }
    return DictEntry(uk, us, ipa)
}

private val dictHttp by lazy { OkHttpClient() }
private val dictCache = ConcurrentHashMap<String, DictEntry>()

private suspend fun lookupWord(word: String): DictEntry {
    val key = word.lowercase()
    dictCache[key]?.let { return it }
    val d = withContext(Dispatchers.IO) {
        runCatching {
            val req = Request.Builder().url("https://api.dictionaryapi.dev/api/v2/entries/en/" + URLEncoder.encode(key, "UTF-8").replace("+", "%20")).build()
            dictHttp.newCall(req).execute().use { r -> if (r.isSuccessful) parseDictionary(r.body?.string().orEmpty()) else DictEntry() }
        }.getOrDefault(DictEntry())
    }
    dictCache[key] = d
    return d
}

/** How to make the sound that was expected, for the swaps learners make most. Keyed by espeak IPA. */
private val TIPS = mapOf(
    "θ" to "Put your tongue lightly between your teeth and blow air out. No stop, no burst.",
    "ð" to "Tongue lightly between your teeth, then add your voice so it buzzes.",
    "v" to "Touch your top teeth to your bottom lip and let it buzz. Rounded lips make a /w/ instead.",
    "w" to "Round your lips into a small circle, then open them. Your teeth do not touch your lip.",
    "f" to "Top teeth on your bottom lip, then blow. Your lips do not close.",
    "p" to "Close both lips, then release a puff of air.",
    "r" to "Curl your tongue back without touching the roof of your mouth. Do not roll or tap it.",
    "ɹ" to "Curl your tongue back without touching the roof of your mouth. Do not roll or tap it.",
    "l" to "Press the tip of your tongue behind your top teeth and let the air pass at the sides.",
    "ɪ" to "A short, relaxed sound, as in \"sit\". Do not stretch it into \"seat\".",
    "iː" to "A long sound with spread lips, as in \"seat\". Hold it a little longer than \"sit\".",
    "æ" to "Open your mouth wide and spread your lips, as in \"cat\". Not \"ket\".",
    "e" to "Mouth half open, as in \"bed\". Less open than \"bad\".",
    "ɛ" to "Mouth half open, as in \"bed\". Less open than \"bad\".",
    "ʌ" to "Short and central, as in \"cup\". Your lips stay relaxed, not rounded.",
    "ɒ" to "Short with rounded lips and an open mouth, as in \"hot\" (UK).",
    "ʃ" to "Round your lips a little and push them forward, as in \"she\". Flat lips make an /s/.",
    "s" to "Tongue close behind your top teeth, lips spread, a thin hiss.",
    "z" to "The /s/ position with your voice on, so it buzzes.",
    "ʒ" to "The /ʃ/ position with your voice on, as in \"measure\".",
    "dʒ" to "Start with the tongue touching behind your teeth, then release into a buzzing \"zh\", as in \"job\".",
    "tʃ" to "Start with the tongue touching behind your teeth, then release into \"sh\", as in \"chip\".",
    "ŋ" to "Lift the back of your tongue to the soft palate and let the sound go through your nose. Do not add a /g/ at the end.",
    "h" to "A light breath from the throat, as in \"hat\". Do not drop it.",
)

/** The tip for the first wrong sound that has one. */
fun pronTip(w: PronAudioWord): String? = w.phones.firstOrNull { !it.ok && TIPS[it.expected] != null }?.let { TIPS[it.expected] }

/** Pronunciation tab: the phoneme model's findings, each word with your clip and a correct recording. */
@Composable
fun PronunciationPanel(pron: PronunciationAudio, player: ResultPlayer) {
    val e = MaterialTheme.ext
    val context = LocalContext.current
    // one dictionary-clip player and one device voice for the whole tab, released when it closes
    val clip = remember { AudioPlayer(context) }
    val tts = remember { arrayOfNulls<TextToSpeech>(1) }
    DisposableEffect(Unit) { onDispose { clip.release(); tts[0]?.shutdown() } }
    fun speak(word: String, accent: String) {
        fun say(t: TextToSpeech) {
            t.setLanguage(if (accent == "us") Locale.US else Locale.UK)
            t.setSpeechRate(0.85f)
            t.speak(word, TextToSpeech.QUEUE_FLUSH, null, word)
        }
        val t = tts[0]
        if (t != null) { say(t); return }
        tts[0] = TextToSpeech(context.applicationContext) { status -> if (status == TextToSpeech.SUCCESS) tts[0]?.let { say(it) } }
    }
    fun playUrl(url: String) { clip.load(url); clip.play() }

    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        SectionTitle("Summary")
        Text(
            "A phoneme model listened to your recording and compared each sound with US and UK English, counting whichever is closer. It does not change your band yet.",
            style = MaterialTheme.typography.bodySmall, color = e.muted,
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Stat("Sounds said as expected", pron.accuracy?.let { "${it.roundToInt()} / 100" } ?: "n/a", Modifier.weight(1f))
            Stat("Words to practise", "${pron.words.size}", Modifier.weight(1f))
        }
        if (pron.confusions.isNotEmpty()) {
            SectionTitle("Sounds you mix up most")
            Text("Only sounds you swapped more than once. A single slip is not a pattern, and an accent is not an error.", style = MaterialTheme.typography.bodySmall, color = e.muted)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                pron.confusions.forEach { c ->
                    Text(
                        buildAnnotatedString {
                            append("/${c.expected}/ → ")
                            withStyle(SpanStyle(color = e.badText)) { append("/${c.heard}/") }
                            withStyle(SpanStyle(color = e.muted)) { append("  ${c.count} times") }
                        },
                        Modifier.border(1.dp, e.line, CircleShape).background(e.surface, CircleShape).padding(horizontal = 12.dp, vertical = 6.dp)
                            .semantics { contentDescription = "${c.expected} said as ${c.heard}, ${c.count} times" },
                        style = MaterialTheme.typography.bodyMedium, color = e.ink,
                    )
                }
            }
        }
        SectionTitle("Words to practise")
        if (pron.words.isEmpty()) Text("No word stood out. Every content word was close to US or UK English.", style = MaterialTheme.typography.bodyMedium, color = e.ink)
        else {
            Text("Worst first. Play your version, then the correct one, and say it again.", style = MaterialTheme.typography.bodySmall, color = e.muted)
            pron.words.forEach { w -> WordCard(w, player, ::playUrl, ::speak) }
        }
    }
}

@Composable
private fun Stat(label: String, value: String, modifier: Modifier) {
    val e = MaterialTheme.ext
    AppCard(modifier) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = e.muted)
        Text(value, style = MaterialTheme.typography.titleLarge.merge(com.soyeb.ieltspractice.ui.theme.AppText.num), color = e.ink)
    }
}

/** The word's phones, with the ones that went wrong marked: green for the expected sound, red for what was heard. */
@Composable
private fun phones(w: PronAudioWord, expected: Boolean): AnnotatedString {
    val e = MaterialTheme.ext
    return buildAnnotatedString {
        append("/")
        w.phones.forEach { p ->
            val s = if (expected) p.expected else p.heard
            if (p.ok) append(s) else withStyle(SpanStyle(color = if (expected) e.goodText else e.badText, background = (if (expected) e.good else e.bad).copy(alpha = 0.14f))) { append(s) }
        }
        append("/")
    }
}

@Composable
private fun WordCard(w: PronAudioWord, player: ResultPlayer, playUrl: (String) -> Unit, speak: (String, String) -> Unit) {
    val e = MaterialTheme.ext
    val scope = rememberCoroutineScope()
    val demo = LocalDemo.current != null
    // null while looking up; demo mode has no network
    val dict by produceState<DictEntry?>(if (demo) DictEntry() else null, w.word) { if (!demo) value = lookupWord(w.word) }
    val first = if (w.accent == "us") "us" else "gb" // the accent the model found closer plays first
    val recordings = (if (first == "gb") listOf("gb", "us") else listOf("us", "gb")).mapNotNull { a -> dict?.let { d -> if (a == "gb") d.uk else d.us }?.let { a to it } }
    AppCard {
        Text(w.word, style = MaterialTheme.typography.titleMedium, color = e.ink)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Correct", Modifier.width(72.dp), style = MaterialTheme.typography.bodySmall, color = e.muted)
            Text(phones(w, true), style = MaterialTheme.typography.bodyLarge, color = e.ink)
        }
        dict?.ipa?.let { Text("Dictionary $it", Modifier.padding(start = 84.dp), style = MaterialTheme.typography.bodySmall, color = e.muted) }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("You said", Modifier.width(72.dp), style = MaterialTheme.typography.bodySmall, color = e.muted)
            Text(phones(w, false), style = MaterialTheme.typography.bodyLarge, color = e.ink)
        }
        pronTip(w)?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = e.muted) }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (player.isLoaded) SecondaryButton("Your version", { scope.launch { player.playSpan(w.start, w.end + 0.3) } })
            recordings.forEach { (a, url) -> SecondaryButton("Correct · ${if (a == "gb") "UK" else "US"}", { player.pause(); playUrl(url) }) }
            if (dict != null && recordings.isEmpty()) SecondaryButton("Device voice", { player.pause(); speak(w.word, first) })
        }
        Text(
            when { dict == null -> "Looking up…"; recordings.isNotEmpty() -> "Recording: Wiktionary"; else -> "No dictionary recording" },
            style = MaterialTheme.typography.bodySmall, color = e.muted,
        )
    }
}
