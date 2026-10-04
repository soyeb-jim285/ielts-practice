package com.soyeb.ieltspractice.core

import android.content.Context
import android.content.Intent
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
 * - `tour` (`--ez tour true`): the video tour. Layers `tour-fixtures.json` (one student's three weeks, apps/android/scripts/gen-tour-fixtures.mjs)
 *   over the fixtures, and the demo audio clocks run: players move while playing, the examiner "speaks" for the length of a line.
 */
data class DemoConfig(val screen: String? = null, val tab: String? = null, val theme: String? = null, val tour: Boolean = false) {
    val dark: Boolean? get() = when (theme) { "dark" -> true; "light" -> false; else -> null }

    companion object {
        /** Null unless the intent carries `--ez demo true`. */
        fun from(intent: Intent?): DemoConfig? {
            if (intent?.getBooleanExtra("demo", false) != true) return null
            return DemoConfig(intent.getStringExtra("screen"), intent.getStringExtra("tab"), intent.getStringExtra("theme"), intent.getBooleanExtra("tour", false))
        }
    }
}

object DemoFixtures {
    /** Parses `{ "path[?sorted-query]": <json>, ... }` into path -> JSON text. */
    fun parse(text: String): Map<String, String> =
        AppJson.parseToJsonElement(text).jsonObject.mapValues { it.value.toString() }

    fun load(context: Context, tour: Boolean = false): Map<String, String> {
        fun read(name: String) = parse(context.assets.open(name).bufferedReader().use { it.readText() })
        return if (tour) read("fixtures.json") + read("tour-fixtures.json") else read("fixtures.json")
    }
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
