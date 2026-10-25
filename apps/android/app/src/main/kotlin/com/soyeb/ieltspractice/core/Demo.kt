package com.soyeb.ieltspractice.core

import android.content.Context
import android.content.Intent
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody

/**
 * Demo mode for screenshots and offline previews (port of iOS Demo.swift). Every request is answered from the bundled
 * synthetic `fixtures.json` (the same file iOS uses, copied into assets at build time); nothing hits the network.
 *
 * Launch it with intent extras:
 * `adb shell am start -n com.soyeb.ieltspractice/.MainActivity --ez demo true --es screen result-speaking --es tab Overview --es theme dark`
 * - `screen`: a name from [com.soyeb.ieltspractice.ui.nav.screenCatalog] (default: the Home tab)
 * - `tab`: a screen-specific sub-tab (the iOS `-tab` argument), read with `LocalDemo.current?.tab`
 * - `theme`: `light` | `dark` (default: follow the system)
 */
data class DemoConfig(val screen: String? = null, val tab: String? = null, val theme: String? = null) {
    val dark: Boolean? get() = when (theme) { "dark" -> true; "light" -> false; else -> null }

    companion object {
        /** Null unless the intent carries `--ez demo true`. */
        fun from(intent: Intent?): DemoConfig? {
            if (intent?.getBooleanExtra("demo", false) != true) return null
            return DemoConfig(intent.getStringExtra("screen"), intent.getStringExtra("tab"), intent.getStringExtra("theme"))
        }
    }
}

object DemoFixtures {
    /** Parses `{ "path[?sorted-query]": <json>, ... }` into path -> JSON text. */
    fun parse(text: String): Map<String, String> =
        AppJson.parseToJsonElement(text).jsonObject.mapValues { it.value.toString() }

    fun load(context: Context): Map<String, String> =
        withLrCauses(parse(context.assets.open("fixtures.json").bufferedReader().use { it.readText() }))

    /** The shared fixtures predate the lost-mark causes: derive them for submitted L/R attempts, and their totals for /api/lr/progress. */
    fun withLrCauses(fixtures: Map<String, String>): Map<String, String> {
        val out = fixtures.toMutableMap()
        val totals = linkedMapOf<Pair<String, String>, LrCauseStat>()
        for ((k, v) in fixtures) {
            if (!k.startsWith("/api/lr/attempts/")) continue
            val a = runCatching { AppJson.decodeFromString(LrAttempt.serializer(), v) }.getOrNull() ?: continue
            if (!a.submitted || a.analysis == null || a.analysis.causes.isNotEmpty()) continue
            val causes = lrCauses(a)
            val obj = AppJson.parseToJsonElement(v).jsonObject
            val an = obj["analysis"]?.jsonObject ?: continue
            out[k] = JsonObject(obj + ("analysis" to JsonObject(an + ("causes" to AppJson.encodeToJsonElement(ListSerializer(LrCause.serializer()), causes))))).toString()
            for (c in causes) {
                val key = a.test.skill to c.family
                totals[key] = LrCauseStat(a.test.skill, c.family, c.label, (totals[key]?.count ?: 0) + c.questions.size)
            }
        }
        fixtures["/api/lr/progress"]?.let { p ->
            val obj = AppJson.parseToJsonElement(p).jsonObject
            if ("causes" !in obj) {
                val list = totals.values.sortedWith(compareBy<LrCauseStat>({ it.skill }, { -it.count }))
                out["/api/lr/progress"] = JsonObject(obj + ("causes" to AppJson.encodeToJsonElement(ListSerializer(LrCauseStat.serializer()), list))).toString()
            }
        }
        return out
    }
}

private val CAUSE_COPY = linkedMapOf(
    "slip" to ("Right idea, lost the mark" to "You had the answer but lost the mark on spelling, form, wording, the word limit or the box you wrote in. These are the easiest marks to win back: check each answer as you write it."),
    "trap" to ("Picked a distractor" to "You chose something that is in the recording or passage but is not the answer. IELTS mentions wrong options on purpose: wait for the one that matches the question exactly."),
    "missed" to ("Missed the answer" to "Your answer was a different detail: a mishearing, the wrong number or item, or a statement read the wrong way. Practise finding the exact place the answer is given before you write."),
    "blank" to ("Left blank" to "No answer given. A wrong answer costs nothing, so always write your best guess."),
)
private val GAP_FAMILY = mapOf(
    "blank" to "blank", "spelling" to "slip", "plural" to "slip", "word-limit" to "slip", "article" to "slip", "extra-word" to "slip", "missing-word" to "slip",
    "number-format" to "slip", "lost-place" to "slip", "synonym" to "slip", "trap" to "trap",
)

/** Port of packages/core lr-review.ts analyseAttempt's causes from the marks and gap reasons an attempt already has: largest first. */
fun lrCauses(a: LrAttempt): List<LrCause> {
    val marks = a.marks.orEmpty().associateBy { it.n }
    val gaps = a.analysis?.gaps.orEmpty().associateBy { it.n }
    val family = linkedMapOf<Int, String>()
    for (f in a.test.flat()) {
        val m = marks[f.n]
        if (m == null || m.correct) continue
        val gap = gaps[f.n]
        family[f.n] = when {
            gap != null -> GAP_FAMILY[gap.kind] ?: "missed"
            m.given.isBlank() -> "blank"
            f.group.type == "tfng" || f.group.type == "ynng" -> "missed"
            else -> "trap"
        }
    }
    return CAUSE_COPY.map { (k, copy) -> LrCause(k, copy.first, copy.second, family.filterValues { it == k }.keys.sorted()) }
        .filter { it.questions.isNotEmpty() }
        .sortedByDescending { it.questions.size }
}

/**
 * Answers every request from the fixtures: exact "path?sorted-query" first, then the bare path. Writes succeed with `{}`.
 * Unknown GETs are 404. Every response carries `set-auth-token: demo`, like iOS.
 */
class DemoInterceptor(private val fixtures: Map<String, String>, private val assets: (String) -> ByteArray? = { null }) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request()
        var status = 200
        var body = "{}"
        // Bundled demo media: the map figure of the Listening & Reading fixtures (iOS demo-map.png).
        if (req.method == "GET" && req.url.encodedPath.startsWith("/lr-assets/") && req.url.encodedPath.endsWith(".png")) {
            assets("demo-map.png")?.let { png ->
                return Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(200).message("OK").body(png.toResponseBody("image/png".toMediaType())).build()
            }
        }
        if (req.method == "GET") {
            val url = req.url
            val query = url.queryParameterNames.sorted().mapNotNull { n -> url.queryParameter(n)?.let { "$n=$it" } }.joinToString("&")
            val path = url.encodedPath
            val hit = fixtures[if (query.isEmpty()) path else "$path?$query"] ?: fixtures[path]
            if (hit != null) body = hit else status = 404
        } else {
            fixtures["${req.method} ${req.url.encodedPath}"]?.let { body = it } // a canned answer to a write ("POST /api/lr/attempts/x/submit"); other writes succeed with {}
        }
        return Response.Builder()
            .request(req).protocol(Protocol.HTTP_1_1).code(status).message(if (status == 200) "OK" else "Not Found")
            .header("set-auth-token", "demo")
            .body(body.toResponseBody("application/json".toMediaType()))
            .build()
    }
}
