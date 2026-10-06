package com.soyeb.ieltspractice.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

// Hand-written @Serializable mirror of the server contract (apps/server/src/ai/types.ts, routes/*.ts), ported 1:1 from
// apps/ios/IELTS/Core/Models.swift. Nested Swift types (ProgressData.TrendPoint, AnalysisResult.Rewrite, ...) are top-level here.
// Decode with `AppJson` (lenient). Optional Swift fields are nullable here with a `= null` default.

@Serializable data class User(
    val id: String, val email: String = "", val name: String = "", val emailVerified: Boolean = false,
    /** A guest (anonymous session): no account yet. Their `email` is empty; never show it. */
    val isAnonymous: Boolean = false,
)

@Serializable data class ModelChoices(
    val analysis: String, val examiner: String, val stt: String, val tts: String, val ttsVoice: String,
)

@Serializable data class AppSettings(
    val models: ModelChoices,
    val liveProvider: String, // "turn" | "gpt-live" | "gemini-live" (an old "openai-realtime" reads as "gpt-live", see [provider])
    val targetBand: Double,
    val writingAutoSubmit: Boolean,
    val blockPaste: Boolean,
) {
    /** The live examiner choice, with the pre-GPT-Live value migrated. */
    val provider: String get() = if (liveProvider == "openai-realtime") "gpt-live" else liveProvider
}

@Serializable data class Me(
    val user: User,
    val settings: AppSettings,
    val cambridgeAccess: Boolean = false,
    val gptLiveAvailable: Boolean? = null,
    /** Deprecated alias the server still sends for app versions from before GPT-Live. */
    val realtimeAvailable: Boolean = false,
    val geminiLiveAvailable: Boolean = false,
    // Community mode: the same fields as GET /api/quota.
    val tier: String? = null,
    val speaking: SkillQuota? = null,
    val writing: SkillQuota? = null,
    val liveProviders: List<String>? = null,
    val communityBalance: Balance? = null,
) {
    val gptLive: Boolean get() = gptLiveAvailable ?: realtimeAvailable

    /** The quota block of `/api/me`, or null from a server that predates community mode. */
    fun quota(): Quota? = tier?.let { Quota(it, speaking ?: SkillQuota(), writing ?: SkillQuota(), liveProviders.orEmpty(), communityBalance) }
}

/** An empty `{}` body (writes that return nothing useful). */
@Serializable class Empty

// MARK: - Prompts

/** One rendered examiner line; [url] is null where the line has no audio (the test then runs silently for that line). */
@Serializable data class AudioLine(val text: String, val url: String? = null)
/** Examiner audio of a generated speaking prompt: [intro] = greeting before the first Part 1 topic of a full test, [lead] = topic or part transition, [questions] align with followUps. */
@Serializable data class PromptAudio(val intro: AudioLine? = null, val lead: AudioLine? = null, val questions: List<AudioLine> = emptyList())

@Serializable data class Prompt(
    val id: String,
    val skill: String,
    val part: Int,
    val variant: String? = null,
    val type: String? = null,
    val topic: String? = null,
    val title: String,
    val body: String,
    val bullets: List<String>? = null,
    val followUps: List<String>? = null,
    /** Raw chart JSON. Use [chartSpec]: a malformed chart decodes to null instead of failing the whole prompt. */
    val chart: JsonElement? = null,
    val imageUrl: String? = null,
    val groupId: String? = null,
    val done: Boolean? = null,
    val source: String? = null,
    val audio: PromptAudio? = null,
) {
    /** Questions asked in this prompt's recording (P2: the cue card title). */
    val questions: List<String>
        get() = when {
            skill == "speaking" && part == 2 -> listOf(title)
            !followUps.isNullOrEmpty() -> followUps
            else -> listOf(body)
        }
    val chartSpec: ChartSpec? get() = chart?.let { runCatching { AppJson.decodeFromJsonElement(ChartSpec.serializer(), it) }.getOrNull() }
}

@Serializable data class SpeakingTest(val part1: List<Prompt>, val part2: Prompt, val part3: Prompt)

/**
 * A chart (writing task 1). iOS models this as an enum; here it is one flat class: switch on [kind]
 * (`line` | `bar` | `pie` | `table` | `process` | `map`) and read only that kind's fields.
 */
@Serializable data class ChartSpec(
    val kind: String,
    val title: String = "",
    val xLabel: String = "",
    val yLabel: String = "",
    val unit: String = "",
    val categories: List<String> = emptyList(), // line, bar
    val series: List<Series> = emptyList(), // line, bar
    val pies: List<Pie> = emptyList(), // pie
    val columns: List<String> = emptyList(), // table
    val rows: List<List<JsonPrimitive>> = emptyList(), // table; cells are strings or numbers, read via [rowsText]
    val steps: List<String> = emptyList(), // process
    val before: MapSide? = null, // map
    val after: MapSide? = null, // map
) {
    val isBar: Boolean get() = kind == "bar"

    /** Table cells as display text (whole numbers without a decimal point). */
    val rowsText: List<List<String>>
        get() = rows.map { row ->
            row.map { c -> if (c.isString) c.content else c.doubleOrNull?.let { fmtNum(it) } ?: c.content }
        }
}

@Serializable data class Series(val name: String, val values: List<Double>)
@Serializable data class Slice(val label: String, val value: Double)
@Serializable data class Pie(val name: String, val slices: List<Slice>)
@Serializable data class MapSide(val label: String, val features: List<String>)

// MARK: - Attempts

@Serializable data class Created(val id: String, val uploadUrl: String? = null)

@Serializable data class Attempt(
    val id: String,
    val promptId: String,
    val skill: String,
    val part: Int,
    val mode: String,
    val sessionId: String? = null,
    val parentAttemptId: String? = null,
    val audioUrl: String? = null,
    val text: String? = null,
    val plan: String? = null,
    val durationMs: Int? = null,
    val overtime: Boolean? = null,
    val status: String, // recording | analyzing | done | failed
    val error: String? = null,
    val createdAt: String,
    val analysis: AnalysisResult? = null,
    val prompt: Prompt,
) {
    val finished: Boolean get() = status == "done" || status == "failed"

    /** The essay, or the transcript for speaking. */
    val answerText: String? get() = analysis?.text ?: text ?: analysis?.words?.joinToString(" ") { it.w }
}

@Serializable data class AttemptListItem(
    val id: String,
    val promptTitle: String,
    val skill: String,
    val part: Int,
    val mode: String,
    val status: String,
    val overall: Double? = null,
    val createdAt: String,
)

@Serializable data class AttemptPage(val items: List<AttemptListItem>, val total: Int)

// MARK: - Analysis (ai/types.ts)

@Serializable data class Criterion(
    val band: Double, val range: List<Double>, val descriptor: String, val evidence: List<String>, val summary: String,
)
@Serializable data class Fix(val title: String, val why: String, val before: String, val after: String)
@Serializable data class AnalysisError(
    val id: String,
    val category: String,
    val severity: String, // minor | major
    val start: Int,
    val end: Int,
    val original: String,
    val correction: String,
    val explanation: String,
    val time: Double? = null,
)
@Serializable data class VocabUpgrade(val original: String, val better: List<String>, val note: String)
@Serializable data class Word(val w: String, val start: Double, val end: Double, val conf: Double? = null)
@Serializable data class Pause(
    val start: Double, val end: Double, val dur: Double, val kind: String, val midClause: Boolean, val voiced: Boolean,
)
@Serializable data class Filler(val word: String, val time: Double, val kind: String)
@Serializable data class Repetition(val phrase: String, val time: Double, val wordIdx: Int)
@Serializable data class SelfCorrection(val time: Double, val wordIdx: Int)
@Serializable data class Unclear(val wordIdx: Int, val w: String, val conf: Double, val tier: Int)
@Serializable data class WpmPoint(val t: Double, val wpm: Double)

/** Fused disfluency event (core `Disfluency`): [kind] is one of [DisfluencyKinds.all]; [sources] say which detectors saw it. */
@Serializable data class Disfluency(val kind: String, val start: Double, val end: Double, val sources: List<String>)

/** Server `disfluencyProfile`: per-type count and rates. Absent on older analyses. */
@Serializable data class DisfluencyProfile(val byKind: Map<String, DisfluencyRate>)
@Serializable data class DisfluencyRate(val n: Int, val perMin: Double, val per100w: Double)
@Serializable data class FluencyDetail(val events: List<Disfluency>, val profile: DisfluencyProfile? = null)

@Serializable data class SpeechMetrics(
    val durationS: Double,
    val wordCount: Int,
    val speechRate: Double,
    val articulationRate: Double,
    val phonationRatio: Double,
    val pauseRatio: Double,
    val mlr: Double,
    val pauses: List<Pause>,
    val longPauses: Int,
    val midClausePauses: Int,
    val fillers: List<Filler>,
    val fillersPerMin: Double,
    val repetitions: List<Repetition>,
    val selfCorrections: List<SelfCorrection>,
    val unclear: List<Unclear>,
    val wpmSeries: List<WpmPoint>,
    val wpmStdDev: Double,
    val fluency: FluencyDetail? = null, // absent on analyses stored before disfluency fusion
)

@Serializable data class Linker(val word: String, val count: Int, val overused: Boolean)
/** `forms`: every surface form grouped under `word`; absent on analyses stored before grouping existed. */
@Serializable data class Repeated(val word: String, val count: Int, val forms: List<String>? = null)
@Serializable data class TextMetrics(
    val words: Int,
    val sentences: Int,
    val paragraphs: Int,
    val avgSentenceLen: Double,
    val mtld: Double,
    val ttr: Double,
    val linkers: List<Linker>,
    val repeated: List<Repeated>,
)

@Serializable data class PronWord(val word: String, val time: Double, val issue: String, val tip: String)
@Serializable data class PronunciationLlm(val words: List<PronWord>, val prosody: String, val band: Double)

@Serializable data class StructParagraph(val role: String, val topicSentence: String, val ok: Boolean, val note: String)
@Serializable data class StructOverview(val present: Boolean, val mainTrends: Boolean, val noData: Boolean, val note: String)
@Serializable data class StructPosition(val clear: Boolean, val consistent: Boolean, val note: String)
@Serializable data class StructPlan(val followed: Boolean, val note: String)
@Serializable data class WritingStructure(
    val paragraphs: List<StructParagraph>,
    val overview: StructOverview? = null,
    val position: StructPosition? = null,
    val planFollowed: StructPlan? = null,
)

@Serializable data class Rewrite(val text: String, val note: String)
@Serializable data class AnalysisQuestion(val text: String, val startWord: Int)
@Serializable data class Pronunciation(val unclear: List<Unclear>, val llm: PronunciationLlm? = null)
@Serializable data class Relevance(val questionIdx: Int, val onTopic: Boolean, val note: String)
@Serializable data class Comparison(val parentAttemptId: String, val parentOverall: Double, val deltas: Map<String, Double>)

@Serializable data class AnalysisResult(
    val skill: String,
    val part: Int? = null,
    val overall: Double,
    val overallRaw: Double,
    val range: List<Double>,
    val calibrated: Boolean? = null, // false: unvalidated model, range ±1 band; absent on older analyses
    val criteria: Map<String, Criterion>,
    val topFixes: List<Fix>,
    val errors: List<AnalysisError>,
    val vocabUpgrades: List<VocabUpgrade>? = null,
    val rewrite: Rewrite,
    // speaking
    val words: List<Word>? = null,
    val metrics: SpeechMetrics? = null,
    val questions: List<AnalysisQuestion>? = null,
    val pronunciation: Pronunciation? = null,
    val relevance: List<Relevance>? = null,
    val noSpeech: Boolean? = null,
    // writing
    val text: String? = null,
    val structure: WritingStructure? = null,
    val textMetrics: TextMetrics? = null,
    val tooShort: Boolean? = null,
    val comparison: Comparison? = null,
)

/** Mirrors core DisfluencyKind (apps/ios/scripts/check-models.mjs keeps the keys in sync). `rate` = [good, warn] events per minute; the copy mirrors web GUIDE. */
data class DisfluencyKind(
    val key: String, val label: String, val what: String, val normal: String, val harmful: String,
    val rate: List<Double>,
    /** Always listed (a zero is good news); cut-offs and held sounds only when present. */
    val core: Boolean,
)

object DisfluencyKinds {
    val all = listOf(
        DisfluencyKind("filled", "Filled pauses", "\"um\", \"uh\", \"er\" while searching for a word.",
            "A couple a minute is natural, even for native speakers.",
            "More than about 4 a minute, or several in a row, sounds unsure. Pause silently instead.", listOf(2.0, 4.0), true),
        DisfluencyKind("repetition", "Repetitions", "A word or phrase said twice, like \"I I think\".",
            "An occasional repeat while you plan the next word is fine.",
            "Frequent repeats signal word-searching. Plan the first few words before you start.", listOf(1.0, 2.0), true),
        DisfluencyKind("repair", "Self-corrections", "You restart and change the wording, like \"he go… he goes\".",
            "Fixing a real mistake shows self-monitoring; band 7 allows some.",
            "Many restarts make the listener lose the idea. Correct only what matters.", listOf(1.0, 2.0), true),
        DisfluencyKind("false_start", "False starts", "A sentence you abandon and begin again.",
            "One now and then is normal in unplanned speech.",
            "Often abandoning sentences hurts coherence. Start with a short, safe clause.", listOf(1.0, 2.0), true),
        DisfluencyKind("partial", "Cut-off words", "A word you cut off and restart, like \"sh- she\".",
            "Occasional cut-offs happen when you change your mind about a word.",
            "Many cut-offs suggest reaching for words you are unsure of. Choose a simpler word.", listOf(1.0, 2.0), false),
        DisfluencyKind("prolongation", "Held sounds", "A sound held while you think, like \"sooo\".",
            "An occasional stretched word buys thinking time.",
            "Frequent stretching slows the answer and sounds hesitant. Try a short pause.", listOf(2.0, 4.0), false),
    )
}

// MARK: - Progress, cards, models, live

@Serializable data class TrendPoint(val date: String, val overall: Double, val criteria: Map<String, Double>)
@Serializable data class Weakest(val key: String, val avg: Double)
@Serializable data class CategoryCount(val category: String, val count: Int)
@Serializable data class Predicted(val speaking: Double? = null, val writing: Double? = null)

@Serializable data class ProgressData(
    val trend: List<TrendPoint>,
    val streak: Int,
    val minutesThisWeek: Double,
    val attempts: Int,
    val weakest: Weakest? = null,
    val topMistakes: List<CategoryCount>,
    val predicted: Predicted,
)

@Serializable data class ReviewCard(val id: String, val front: String, val back: String)

@Serializable data class Mistake(
    val id: String,
    val attemptId: String,
    val skill: String,
    val part: Int,
    val promptTitle: String,
    val category: String,
    val original: String,
    val correction: String,
    val explanation: String,
    val time: Double? = null,
    val inDeck: Boolean = false,
    val createdAt: String,
)

@Serializable data class MistakeLog(val groups: List<CategoryCount>, val items: List<Mistake>, val total: Int)

@Serializable data class Pricing(val prompt: String? = null, val completion: String? = null)
@Serializable data class ModelInfo(val id: String, val name: String? = null, val pricing: Pricing? = null, val voices: List<String>? = null)

@Serializable data class LiveReply(
    val sessionId: String? = null,
    val examinerText: String,
    val audioUrl: String? = null,
    val voiceError: String? = null, // why audioUrl is null (TTS failed): the test continues with captions
    val phase: String,
    val prepSeconds: Int? = null,
    val cueCard: Prompt? = null,
    val test: SpeakingTest? = null,
)
@Serializable data class UploadTarget(val key: String, val uploadUrl: String)
@Serializable data class FinishResult(val attemptIds: List<String>)

/** GET /api/auth-email/status: what happened to the code email. [error] is a short kind (rate_limited, rejected, network, unavailable), never provider text. */
@Serializable data class EmailStatus(
    val status: String = "none", val sentAt: String? = null, val maskedEmail: String? = null,
    val resendAvailableIn: Int = 0, val alreadySent: Boolean = false, val error: String? = null,
)
