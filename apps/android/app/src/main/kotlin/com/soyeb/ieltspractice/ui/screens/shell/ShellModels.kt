package com.soyeb.ieltspractice.ui.screens.shell

import com.soyeb.ieltspractice.core.CategoryCount
import com.soyeb.ieltspractice.core.Predicted
import com.soyeb.ieltspractice.core.TrendPoint
import com.soyeb.ieltspractice.core.Weakest
import kotlinx.serialization.Serializable

// View-local response types for the shell screens (iOS keeps these private in the views; they carry fields the shared models do not).

/** GET /api/progress for the dashboard. Everything beyond the original contract is optional, so older servers and fixtures still decode. */
@Serializable data class DashProgress(
    val trend: List<DashPoint>,
    val streak: Int,
    val minutesThisWeek: Double,
    val attempts: Int,
    val weakest: Weakest? = null,
    val topMistakes: List<CategoryCount>,
    val predicted: Predicted,
    val lastFailed: DashFailed? = null,
)
@Serializable data class DashPoint(val skill: String? = null, val part: Int? = null, val criteria: Map<String, Double> = emptyMap())
@Serializable data class DashFailed(val id: String, val skill: String)

/** Everything the dashboard shows, fetched together: the per-skill trends and the due count may fail without hiding the rest. */
data class DashData(val progress: DashProgress, val due: DueResponse?, val trends: Map<String, List<TrendPoint>>)

/** A row of GET /api/prompts. Local so it can read `sourceRef`. */
@Serializable data class BankPrompt(
    val id: String,
    val skill: String,
    val part: Int,
    val type: String? = null,
    val title: String,
    val body: String = "",
    val source: String? = null,
    val sourceRef: String? = null,
    val bullets: List<String>? = null,
    val followUps: List<String>? = null,
    val done: Boolean? = null,
)
@Serializable data class BankPage(val items: List<BankPrompt>, val total: Int)

/** GET /api/prompts/meta: the distinct topics and types per skill and part (null entries tolerated). */
@Serializable data class BankMeta(val groups: List<BankGroup>)
@Serializable data class BankGroup(
    val skill: String, val part: Int, val topics: List<String?> = emptyList(), val types: List<String?> = emptyList(),
)

/** One row of GET /api/attempts. Local so it can read `durationMs` and `flag`. */
@Serializable data class HistoryItem(
    val id: String,
    val promptTitle: String,
    val skill: String,
    val part: Int,
    val status: String, // recording | analyzing | done | failed
    val overall: Double? = null,
    val createdAt: String,
    val durationMs: Int? = null,
    val flag: String? = null, // offTopic | tooShort
)
@Serializable data class HistoryPage(val items: List<HistoryItem>, val total: Int)

/** A card as GET /api/cards/due returns it. The scheduling fields are optional so older payloads and fixtures still decode. */
@Serializable data class DueCard(
    val id: String,
    val front: String,
    val back: String,
    val source: String? = null, // mistake | vocab | fix
    val ease: Double? = null,
    val interval: Double? = null, // days
    val reps: Int? = null,
)

/** `{ cards, total, deck }` (also accepts `{ items }`): the due batch, how many are due in all, and the whole deck size. */
@Serializable data class DueResponse(
    val cards: List<DueCard>? = null,
    val items: List<DueCard>? = null,
    val total: Int? = null,
    val deck: Int? = null,
) {
    val list: List<DueCard> get() = cards ?: items ?: emptyList()
    val dueTotal: Int get() = total ?: list.size
}

/** A TTS model with the voices it supports (GET /api/models?capability=tts). */
@Serializable data class TtsModel(val id: String, val voices: List<String>? = null)
