package com.soyeb.ieltspractice.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.serializer
import okhttp3.Call
import okhttp3.Callback
import okhttp3.CookieJar
import okhttp3.Headers
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** A failed request. [status] is 0 for client-side failures (offline, bad response). [message] is safe to show the user. [code] is Better Auth's error code (INVALID_OTP, ...). */
class ApiError(
    val status: Int, override val message: String, val code: String? = null,
    /** quota_exceeded extras (docs/community.md): when the window resets (ISO), which skill, and the caller's tier. */
    val resetAt: String? = null, val skill: String? = null, val tier: String? = null,
) : Exception(message) {
    /** One of the "you can't start or finish a test now" codes (quota, balance, busy, too fast, live needs a key). */
    val isLimit: Boolean get() = code in Codes.limits
}

class ApiResponse(val status: Int, val body: String, val headers: Headers)

private val JSON_MEDIA = "application/json".toMediaType()

/**
 * Typed client for the IELTS Practice API (port of iOS APIClient.swift). Auth is Better Auth's bearer plugin: the token comes
 * back in the `set-auth-token` header on sign-in, lives in [TokenStore] and is sent as `Authorization: Bearer`.
 *
 * Reads: `api.get<Progress>("/api/progress")`, `api.getList<Prompt>("/api/prompts")` (accepts a bare list or `{items|cards|models|data}`).
 * Writes: `api.send<Created>("POST", "/api/attempts", buildJsonObject { put("promptId", id) })`.
 * Observe [token] / [me] / [isSignedIn] from Compose with `collectAsState()`.
 *
 * [interceptor] is how demo mode answers from fixtures (see Demo.kt); [initialToken] pre-signs-in the demo.
 */
class ApiClient(
    val baseUrl: String = SERVER,
    private val store: TokenStore,
    interceptor: Interceptor? = null,
    initialToken: String? = null,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
) {
    companion object {
        /** The production server. Fixed in the app; there is no user-facing server setting (matches iOS). */
        const val SERVER = "https://ielts.soyebjim.me"
    }

    private val http = OkHttpClient.Builder()
        .cookieJar(CookieJar.NO_COOKIES) // bearer only: cookies would trigger Better Auth's browser origin checks
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .apply { interceptor?.let { addInterceptor(it) } }
        .build()

    private val _token = MutableStateFlow(initialToken)
    /** The bearer token: an account's, or a guest's (see [hasAccount]). */
    val token: StateFlow<String?> = _token.asStateFlow()
    /** A session exists (guest or account). Tests need one; it is created on the first test start ([ensureSession]). */
    val isSignedIn: Boolean get() = _token.value != null

    private val _account = MutableStateFlow(initialToken != null)
    /** True only for a real account. False for no session and for a guest session: History, Mistakes, Review and keys are account-only. */
    val hasAccount: StateFlow<Boolean> = _account.asStateFlow()
    private var guest = false

    private fun setSession(token: String?, isGuest: Boolean) {
        guest = isGuest
        _token.value = token
        _account.value = token != null && !isGuest
    }

    private val _quota = MutableStateFlow<Quota?>(null)
    /** Tests left, the community balance and the live providers this person may use. Null until first loaded. */
    val quota: StateFlow<Quota?> = _quota.asStateFlow()
    private var quotaAt = 0L
    private val sessionLock = Mutex()

    /** False until the stored token has been read at launch, so the UI doesn't flash the guest state for a signed-in user. */
    private val _ready = MutableStateFlow(initialToken != null)
    val ready: StateFlow<Boolean> = _ready.asStateFlow()

    private val _me = MutableStateFlow<Me?>(null)
    val me: StateFlow<Me?> = _me.asStateFlow()

    /** Requests in flight. Screenshot tests wait for 0 before capturing. */
    val inflight = AtomicInteger(0)

    /** Load the stored token and the account (call once at launch). A guest simply stays signed out. */
    suspend fun restoreSession() {
        if (_token.value == null) store.load()?.let { setSession(it, store.loadGuest()) }
        _ready.value = true
        if (_token.value != null && _me.value == null) runCatching { loadMe() }
    }

    // MARK: Requests

    suspend fun raw(method: String, path: String, body: JsonElement? = null): ApiResponse {
        val payload = when {
            body != null -> AppJson.encodeToString(JsonElement.serializer(), body).toRequestBody(JSON_MEDIA)
            method == "GET" || method == "HEAD" || method == "DELETE" -> null
            else -> "{}".toRequestBody(JSON_MEDIA)
        }
        val req = Request.Builder().url(baseUrl + path).method(method, payload)
            .apply { _token.value?.let { header("Authorization", "Bearer $it") } }
            .build()
        val (status, text, headers) = execute(req, "Can't reach IELTS Practice. Check your internet connection and try again.")
        if (status !in 200..299) {
            val err = runCatching { AppJson.parseToJsonElement(text) as? JsonObject }.getOrNull()
            fun field(k: String) = (err?.get(k) as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull
            if (status == 401 && _token.value != null && !path.startsWith("/api/auth/")) signOutLocal()
            // A guest on an account-only endpoint is not an expired session: flip the UI to its "Create an account" gates.
            if (status == 403 && field("code") == Codes.ACCOUNT && _token.value != null && _account.value) { _account.value = false; guest = true }
            throw ApiError(status, field("error") ?: field("message") ?: httpReason(status), field("code"), field("resetAt"), field("skill"), field("tier"))
        }
        return ApiResponse(status, text, headers)
    }

    suspend fun <T> request(method: String, path: String, body: JsonElement?, serializer: KSerializer<T>): T {
        val text = raw(method, path, body).body
        return try {
            AppJson.decodeFromString(serializer, text)
        } catch (e: SerializationException) {
            throw ApiError(0, "Unexpected response from the server ($path).")
        } catch (e: IllegalArgumentException) {
            throw ApiError(0, "Unexpected response from the server ($path).")
        }
    }

    suspend inline fun <reified T> send(method: String, path: String, body: JsonElement? = null): T =
        request(method, path, body, serializer<T>())

    suspend inline fun <reified T> get(path: String, query: Map<String, String?> = emptyMap()): T =
        request("GET", path + queryString(query), null, serializer<T>())

    /** A list endpoint: accepts a bare array or `{items|cards|models|data: [...]}`. */
    suspend inline fun <reified T> getList(path: String, query: Map<String, String?> = emptyMap()): List<T> {
        val text = raw("GET", path + queryString(query)).body
        return decodeListOrThrow(serializer<T>(), text, path)
    }

    @PublishedApi internal fun <T> decodeListOrThrow(s: KSerializer<T>, text: String, path: String): List<T> = try {
        AppJson.decodeList(s, text)
    } catch (e: SerializationException) {
        throw ApiError(0, "Unexpected response from the server ($path).")
    } catch (e: IllegalArgumentException) {
        throw ApiError(0, "Unexpected response from the server ($path).")
    }

    /** `?a=1&b=2` with keys sorted (so demo fixtures can match them) and null values dropped. */
    fun queryString(query: Map<String, String?>): String {
        val b = okhttp3.HttpUrl.Builder().scheme("https").host("x")
        query.entries.sortedBy { it.key }.forEach { (k, v) -> if (v != null) b.addQueryParameter(k, v) }
        return b.build().encodedQuery?.let { "?$it" }.orEmpty()
    }

    /** PUT a file to a presigned URL (no bearer token: it is a signed storage URL). */
    suspend fun upload(url: String, file: File, contentType: String) {
        val req = Request.Builder().url(url).put(file.asRequestBody(contentType.toMediaType())).build()
        val (status, _, _) = execute(req, "Audio upload failed. Check your connection and retry.")
        if (status !in 200..299) throw ApiError(status, "Audio upload failed. Check your connection and retry.")
    }

    suspend fun download(url: String): ByteArray {
        inflight.incrementAndGet()
        try {
            return withContext(Dispatchers.IO) {
                try {
                    http.newCall(Request.Builder().url(url).build()).await().use { it.body?.bytes() ?: ByteArray(0) }
                } catch (e: IOException) {
                    throw ApiError(0, "Couldn't download the audio.")
                }
            }
        } finally {
            inflight.decrementAndGet()
        }
    }

    // The counter moves on the caller's thread (not inside withContext) so a test that just ran its composition sees it at once.
    private suspend fun execute(req: Request, offline: String): Triple<Int, String, Headers> {
        inflight.incrementAndGet()
        try {
            return withContext(Dispatchers.IO) {
                try {
                    http.newCall(req).await().use { Triple(it.code, it.body?.string().orEmpty(), it.headers) }
                } catch (e: IOException) {
                    throw ApiError(0, offline)
                }
            }
        } finally {
            inflight.decrementAndGet()
        }
    }

    private fun httpReason(status: Int) = when (status) {
        400 -> "Bad request"
        401 -> "Please sign in"
        403 -> "Not allowed"
        404 -> "Not found"
        409 -> "Conflict"
        429 -> "Too many requests. Try again in a moment."
        in 500..599 -> "The server had a problem. Try again."
        else -> "Request failed ($status)"
    }

    // MARK: Auth

    suspend fun signIn(email: String, password: String) {
        val r = raw("POST", "/api/auth/sign-in/email", buildJsonObject { put("email", email); put("password", password) })
        adopt(r)
    }

    /** Returns false when the server requires email verification before signing in. */
    suspend fun signUp(name: String, email: String, password: String): Boolean {
        val r = raw("POST", "/api/auth/sign-up/email", buildJsonObject { put("name", name); put("email", email); put("password", password) })
        if (r.headers["set-auth-token"].isNullOrEmpty()) return false
        adopt(r)
        return true
    }
    // A guest token, when there is one, is sent on sign-up, sign-in and verify-email (see [raw]): the server moves the guest's tests to the
    // new account and answers with the account's token, which replaces the guest's here. Until then the guest session keeps working.

    suspend fun resendVerification(email: String) {
        raw("POST", "/api/auth/send-verification-email", buildJsonObject { put("email", email); put("callbackURL", "$baseUrl/") })
    }

    suspend fun requestPasswordReset(email: String) {
        raw("POST", "/api/auth/request-password-reset", buildJsonObject { put("email", email); put("redirectTo", "$baseUrl/reset-password") })
    }

    /** Emails a 6-digit code (Better Auth emailOTP): [type] is "email-verification" or "forget-password". The answer is the same whether or not the address has an account. */
    suspend fun sendOtp(email: String, type: String) {
        raw("POST", "/api/auth/email-otp/send-verification-otp", buildJsonObject { put("email", email); put("type", type) })
    }

    /** Verifies the address with the emailed code and signs the user in. */
    suspend fun verifyEmail(email: String, otp: String) {
        adopt(raw("POST", "/api/auth/email-otp/verify-email", buildJsonObject { put("email", email); put("otp", otp) }))
    }

    suspend fun resetPassword(email: String, otp: String, password: String) {
        raw("POST", "/api/auth/email-otp/reset-password", buildJsonObject { put("email", email); put("otp", otp); put("password", password) })
    }

    private suspend fun adopt(r: ApiResponse) {
        val t = r.headers["set-auth-token"]
        if (t.isNullOrEmpty()) throw ApiError(0, "Sign-in didn't complete. Please try again.")
        setSession(t, false)
        store.save(t, false)
        loadMe()
    }

    /** Start an anonymous guest session (the first test start, never a page view). The bearer token is the `set-auth-token` header, not the JSON `token`. */
    suspend fun signInAnonymously() {
        val r = raw("POST", "/api/auth/sign-in/anonymous", buildJsonObject {})
        val t = r.headers["set-auth-token"]
        if (t.isNullOrEmpty()) throw ApiError(0, "Couldn't start a guest session. Please try again.")
        setSession(t, true)
        store.save(t, true)
        loadMe()
    }

    /** A session for the test about to start: the guest session is created here when there is none. */
    suspend fun ensureSession() = sessionLock.withLock { if (_token.value == null) signInAnonymously() }

    suspend fun loadMe() {
        val m = get<Me>("/api/me")
        _me.value = m
        m.quota()?.let { _quota.value = it; quotaAt = System.currentTimeMillis() }
        if (_token.value != null && m.user.isAnonymous != guest) {
            val t = _token.value
            setSession(t, m.user.isAnonymous)
            if (t != null) store.save(t, m.user.isAnonymous)
        }
    }

    /** GET /api/quota: works without a session (answers for a guest by IP). A stale token is dropped and asked again as a guest. */
    suspend fun refreshQuota(): Quota {
        val q = try {
            get<Quota>("/api/quota")
        } catch (e: ApiError) {
            if (e.status == 401) get<Quota>("/api/quota") else throw e
        }
        _quota.value = q
        quotaAt = System.currentTimeMillis()
        return q
    }

    /** For screens that show the labels: refreshes at most once a minute and stays quiet on failure. */
    suspend fun refreshQuotaIfStale() {
        if (quotaBusy || (_quota.value != null && System.currentTimeMillis() - quotaAt < 60_000)) return
        quotaBusy = true
        try { runCatching { refreshQuota() } } finally { quotaBusy = false }
    }
    @Volatile private var quotaBusy = false

    // MARK: Own API keys (account only)

    suspend fun loadKeys(): List<KeyInfo> = get<KeysResponse>("/api/keys").keys

    /** Validates the key with the provider, then saves it encrypted. The key is sent once and never kept or logged here. */
    suspend fun saveKey(provider: String, key: String): KeyInfo {
        val info: KeyInfo = send("PUT", "/api/keys/$provider", buildJsonObject { put("key", key.trim()) })
        loadMe() // tier, live providers and unlimited tests may have changed
        return info
    }

    suspend fun removeKey(provider: String) {
        raw("DELETE", "/api/keys/$provider")
        loadMe()
    }

    /** The live examiners this person may start (docs/community.md): turn, gpt-live, gemini-live. */
    val liveProviders: List<String>
        get() = _quota.value?.liveProviders ?: _me.value?.let { m -> listOfNotNull(if (m.gptLive) "gpt-live" else null, if (m.geminiLiveAvailable) "gemini-live" else null) }.orEmpty()

    suspend fun signOut() {
        runCatching { raw("POST", "/api/auth/sign-out") }
        signOutLocal()
    }

    /** Deleting needs the account password (Better Auth delete-user), like the web dialog. */
    suspend fun deleteAccount(password: String? = null) {
        raw("POST", "/api/auth/delete-user", password?.let { buildJsonObject { put("password", it) } })
        signOutLocal()
    }

    fun signOutLocal() {
        setSession(null, false)
        _me.value = null
        _quota.value = null
        scope.launch { store.clear() }
    }

    // MARK: Shared flows

    suspend fun saveSettings(s: AppSettings) {
        val saved: AppSettings = send("PUT", "/api/settings", AppJson.encodeToJsonElement(AppSettings.serializer(), s))
        _me.value = _me.value?.copy(settings = saved)
    }

    /** Create a speaking attempt, upload the m4a and start analysis. Returns the attempt id. */
    suspend fun submitSpeaking(
        prompt: Prompt, mode: String = "practice", sessionId: String, parentAttemptId: String?, file: File,
        durationMs: Int, energy: List<Int>, marks: List<Int>,
    ): String {
        val created: Created = send("POST", "/api/attempts", buildJsonObject {
            put("promptId", prompt.id); put("skill", "speaking"); put("part", prompt.part); put("mode", mode)
            put("sessionId", sessionId); put("audioContentType", "audio/mp4")
            parentAttemptId?.let { put("parentAttemptId", it) }
        })
        val url = created.uploadUrl ?: throw ApiError(0, "The server didn't return an upload URL.")
        upload(url, file, "audio/mp4")
        raw("POST", "/api/attempts/${created.id}/submit", submitBody(durationMs, energy, marks))
        return created.id
    }

    suspend fun addCard(front: String, back: String, source: String) {
        raw("POST", "/api/cards", buildJsonObject { put("front", front); put("back", back); put("source", source) })
    }
}

/** The body of `POST /api/attempts/{id}/submit` (energy and marks are capped like the server expects). */
fun submitBody(durationMs: Int, energy: List<Int>, marks: List<Int>): JsonObject = buildJsonObject {
    put("durationMs", durationMs)
    putJsonArray("energy") { energy.take(20000).forEach { add(JsonPrimitive(it)) } }
    putJsonArray("marks") { marks.take(200).forEach { add(JsonPrimitive(it)) } }
}

private suspend fun Call.await(): Response = suspendCancellableCoroutine { c ->
    c.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) { if (c.isActive) c.resumeWithException(e) }
        override fun onResponse(call: Call, response: Response) { c.resume(response) { response.close() } }
    })
}
