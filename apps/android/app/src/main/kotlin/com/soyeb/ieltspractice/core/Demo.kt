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
        parse(context.assets.open("fixtures.json").bufferedReader().use { it.readText() })
}

/**
 * Answers every request from the fixtures: exact "path?sorted-query" first, then the bare path. Writes succeed with `{}`.
 * Unknown GETs are 404. Every response carries `set-auth-token: demo`, like iOS.
 */
class DemoInterceptor(private val fixtures: Map<String, String>) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request()
        var status = 200
        var body = "{}"
        if (req.method == "GET") {
            val url = req.url
            val query = url.queryParameterNames.sorted().mapNotNull { n -> url.queryParameter(n)?.let { "$n=$it" } }.joinToString("&")
            val path = url.encodedPath
            val hit = fixtures[if (query.isEmpty()) path else "$path?$query"] ?: fixtures[path]
            if (hit != null) body = hit else status = 404
        }
        return Response.Builder()
            .request(req).protocol(Protocol.HTTP_1_1).code(status).message(if (status == 200) "OK" else "Not Found")
            .header("set-auth-token", "demo")
            .body(body.toResponseBody("application/json".toMediaType()))
            .build()
    }
}
