package com.soyeb.ieltspractice.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.LocalDemo
import com.soyeb.ieltspractice.core.ApiError
import com.soyeb.ieltspractice.core.AppJson
import com.soyeb.ieltspractice.core.Attempt
import com.soyeb.ieltspractice.core.Band
import com.soyeb.ieltspractice.core.Empty
import com.soyeb.ieltspractice.core.fmt
import com.soyeb.ieltspractice.core.notAssessed
import com.soyeb.ieltspractice.core.resScore
import com.soyeb.ieltspractice.core.speakingSessionOverall
import com.soyeb.ieltspractice.core.writingSessionOverall
import com.soyeb.ieltspractice.ui.ScreenScaffold
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.AttemptResult
import com.soyeb.ieltspractice.ui.nav.Login
import com.soyeb.ieltspractice.ui.screens.result.AttemptResultView
import com.soyeb.ieltspractice.ui.screens.result.Busy
import com.soyeb.ieltspractice.ui.screens.result.ResUnavailable
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.ErrorLine
import com.soyeb.ieltspractice.ui.theme.PrimaryButton
import com.soyeb.ieltspractice.ui.theme.bandTextColor
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// Mirrors: iOS Views/ResultView.swift (+ FluencyView, TranscriptView), web routes/_app/speaking/result.$attemptId.tsx and
// _app/writing/result.$attemptId.tsx. The panels live in ui/screens/result/, the pure logic in core/ResultLogic.kt and core/Timeline.kt.

/** The attempt plus the two fields the shared `Attempt` model does not carry (web: `stage`, `retryable`). */
private class Fetched(val attempt: Attempt, val stage: String?, val retryable: Boolean)

/** Results for one attempt, or for a whole test (a part switcher and the test overall). Needs an account. */
@Composable
fun ResultScreen(route: AttemptResult, nav: AppNav) {
    val api = LocalApp.current.api
    val token by api.token.collectAsState()
    ScreenScaffold("Results", onBack = nav::back, scroll = false) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (token == null) {
                ResUnavailable("Sign in to continue", "Sign in to see your results.") { PrimaryButton("Sign in or create account", { nav.go(Login) }) }
            } else {
                ResultContainer(route.idList, nav)
            }
        }
    }
}

/** Polls every attempt until its analysis finishes, then shows the selected one. */
@Composable
private fun ResultContainer(ids: List<String>, nav: AppNav) {
    val api = LocalApp.current.api
    val demo = LocalDemo.current != null
    val scope = rememberCoroutineScope()
    val fetched = remember(ids) { mutableStateMapOf<String, Fetched>() }
    var selected by rememberSaveable { mutableIntStateOf(0) }
    var poll by remember { mutableIntStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    val me by api.me.collectAsState()
    val target = me?.settings?.targetBand ?: 7.0

    LaunchedEffect(ids, poll) {
        while (true) {
            for (id in ids) if (fetched[id]?.attempt?.finished != true) {
                try {
                    val text = api.raw("GET", "/api/attempts/$id").body
                    val obj = AppJson.parseToJsonElement(text).jsonObject
                    fetched[id] = Fetched(
                        AppJson.decodeFromString(Attempt.serializer(), text), obj.str("stage"),
                        (obj["retryable"] as? JsonPrimitive)?.booleanOrNull ?: true,
                    )
                    error = null
                } catch (x: ApiError) {
                    error = x.message
                } catch (x: kotlinx.serialization.SerializationException) {
                    error = "Unexpected response from the server."
                }
            }
            // A screenshot test must go idle, so demo mode fetches once instead of polling.
            if (demo || ids.all { fetched[it]?.attempt?.finished == true }) return@LaunchedEffect
            delay(2000)
        }
    }

    fun retry(id: String) {
        scope.launch {
            try {
                api.send<Empty>("POST", "/api/attempts/$id/submit", buildJsonObject {})
                fetched.remove(id)
                poll++
            } catch (x: ApiError) {
                error = x.message
            }
        }
    }

    /** Parts in part order (web sorts the same way), once every part has loaded; the given order until then. */
    val parts = ids.map { fetched[it]?.attempt?.part }
    val ordered = if (parts.all { it != null }) ids.withIndex().sortedWith(compareBy({ parts[it.index] }, { it.index })).map { it.value } else ids
    val index = selected.coerceIn(0, (ids.size - 1).coerceAtLeast(0))

    when {
        ids.isEmpty() -> ResUnavailable("Nothing to score", "No answers were recorded.")
        error != null && fetched[ordered[index]] == null -> Column(Modifier.fillMaxWidth().padding(top = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            ErrorLine(error ?: "")
            PrimaryButton("Try again", { poll++ })
        }
        else -> {
            val f = fetched[ordered[index]]
            if (f == null) {
                Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Busy(32.dp)
                    Text("Loading result", Modifier.padding(top = 12.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.ext.muted)
                }
            } else {
                val attempts = ids.mapNotNull { fetched[it]?.attempt }
                androidx.compose.runtime.key(f.attempt.id) {
                    AttemptResultView(
                        f.attempt, f.stage, f.retryable, nav, { retry(f.attempt.id) },
                        extras = if (ids.size > 1) ({ SessionHeader(ordered, fetched, attempts, index, target) { selected = it } }) else null,
                    )
                }
            }
        }
    }
}

private fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.contentOrNull

// MARK: Session header (part switcher, test overall)

@Composable
private fun SessionHeader(ordered: List<String>, fetched: Map<String, Fetched>, attempts: List<Attempt>, index: Int, target: Double, onSelect: (Int) -> Unit) {
    val e = MaterialTheme.ext
    val writing = attempts.firstOrNull()?.skill == "writing"
    val p1Total = attempts.count { it.skill == "speaking" && it.part == 1 }
    var p1 = 0
    val items = ordered.mapIndexed { i, id ->
        val a = fetched[id]?.attempt
        var label = "Part ${i + 1}"
        var band: Double? = null
        var busy = true
        if (a != null) {
            label = if (a.skill == "writing") "Task ${a.part}" else if (a.part == 1 && p1Total > 1) "Part 1.${++p1}" else "Part ${a.part}"
            busy = !a.finished
            a.analysis?.takeIf { !notAssessed(it) }?.let { band = resScore(it).overall }
        }
        SwitcherItem(label, band, busy)
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Switcher(items, index, onSelect)
        if (writing) {
            writingSessionOverall(attempts)?.let { combined ->
                AppCard {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.semantics(mergeDescendants = true) {}) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text("Writing band for this test", style = MaterialTheme.typography.titleMedium, color = e.ink)
                            Text("Task 2 counts twice as much as Task 1.", style = MaterialTheme.typography.bodySmall, color = e.muted)
                        }
                        Text(fmt(combined), style = AppText.band(34), color = bandTextColor(combined, target))
                    }
                }
            }
        } else {
            speakingSessionOverall(attempts)?.let { (band, scored) ->
                Text(
                    "Test overall ${fmt(band)}${if (scored < ordered.size) ", $scored of ${ordered.size} parts scored" else ""}",
                    style = MaterialTheme.typography.titleSmall, color = e.ink,
                )
            }
        }
    }
}

private class SwitcherItem(val label: String, val band: Double?, val busy: Boolean)

/** Part / task switcher with the band per part. Scrolls sideways if the parts do not fit. */
@Composable
private fun Switcher(items: List<SwitcherItem>, selected: Int, onSelect: (Int) -> Unit) {
    val e = MaterialTheme.ext
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(e.surface2).horizontalScroll(rememberScrollState()).padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        items.forEachIndexed { i, item ->
            val on = i == selected
            val spoken = if (item.busy) "${item.label}, analysing" else if (item.band != null) "${item.label}, band ${fmt(item.band)}" else "${item.label}, no score"
            Surface(
                { onSelect(i) }, Modifier.widthIn(min = 78.dp).heightIn(min = 48.dp).semantics { this.selected = on; contentDescription = spoken },
                shape = RoundedCornerShape(10.dp), color = if (on) e.surface else androidx.compose.ui.graphics.Color.Transparent,
                border = BorderStroke(1.dp, if (on) e.line else androidx.compose.ui.graphics.Color.Transparent),
            ) {
                Column(Modifier.padding(horizontal = 14.dp, vertical = 4.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    val tint = if (on) e.brand else e.muted
                    Text(item.label, style = MaterialTheme.typography.titleSmall, color = tint, maxLines = 1)
                    if (item.busy) Busy(14.dp, tint)
                    else if (item.band != null) Text(fmt(item.band), style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum"), color = tint)
                    else Text("No score", style = MaterialTheme.typography.labelMedium, color = tint)
                }
            }
        }
    }
}
