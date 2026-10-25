package com.soyeb.ieltspractice.ui.screens

import android.content.res.Configuration
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.LocalDemo
import com.soyeb.ieltspractice.R
import com.soyeb.ieltspractice.core.ApiClient
import com.soyeb.ieltspractice.core.ApiError
import com.soyeb.ieltspractice.core.EmailStatus
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.screens.shell.AppField
import com.soyeb.ieltspractice.ui.screens.shell.LinkButton
import com.soyeb.ieltspractice.ui.screens.shell.demoTab
import com.soyeb.ieltspractice.ui.screens.shell.emailStatusLine
import com.soyeb.ieltspractice.ui.screens.shell.otpDigits
import com.soyeb.ieltspractice.ui.screens.shell.otpError
import com.soyeb.ieltspractice.ui.theme.ControlShape
import com.soyeb.ieltspractice.ui.theme.ErrorLine
import com.soyeb.ieltspractice.ui.theme.PrimaryButton
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// Mirrors: iOS Views/LoginView.swift, web routes/login.tsx, signup.tsx, forgot-password.tsx, components/layout/AuthLayout.tsx

private enum class Mode { SignIn, SignUp, Verify, ForgotEmail, ForgotCode }

private class Issue(val message: String, val exists: Boolean = false) // exists: sign-up with an address that already has an account

/** What is wrong with each field once the user has pressed the button (web: the form says why instead of a greyed-out button). Null = fine. */
internal data class FieldErrors(
    val name: String? = null, val email: String? = null, val password: String? = null, val confirm: String? = null, val code: String? = null,
) {
    val ok: Boolean get() = name == null && email == null && password == null && confirm == null && code == null
}

internal const val MISMATCH = "The two passwords don't match."
private val EMAIL = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")

internal fun emailError(email: String): String? = when {
    email.isBlank() -> "Enter your email."
    !EMAIL.matches(email.trim()) -> "Enter a valid email address, like name@example.com."
    else -> null
}

/** A new password: 8 to 128 characters (the server's limits). */
internal fun newPasswordError(p: String): String? = when {
    p.isEmpty() -> "Enter a password."
    p.length < 8 -> "Use at least 8 characters."
    p.length > 128 -> "Use 128 characters or fewer."
    else -> null
}

internal fun confirmError(password: String, confirm: String): String? = when {
    confirm.isEmpty() -> "Confirm your password."
    confirm != password -> MISMATCH
    else -> null
}

/** Before submitting: a confirmation that stopped being a prefix of the password is already wrong (typing a prefix is not flagged). */
internal fun liveMismatch(password: String, confirm: String): String? = if (confirm.isNotEmpty() && !password.startsWith(confirm)) MISMATCH else null

internal fun codeError(code: String): String? = if (code.length < 6) "Enter all 6 digits." else null

internal fun signInErrors(email: String, password: String) = FieldErrors(email = emailError(email), password = if (password.isEmpty()) "Enter your password." else null)

internal fun signUpErrors(name: String, email: String, password: String, confirm: String) = FieldErrors(
    name = if (name.isBlank()) "Enter your name." else null, email = emailError(email), password = newPasswordError(password), confirm = confirmError(password, confirm),
)

internal fun resetErrors(code: String, password: String, confirm: String) =
    FieldErrors(code = codeError(code), password = newPasswordError(password), confirm = confirmError(password, confirm))

/** Server codes that belong under the code boxes rather than in the alert (web forgot-password.tsx). */
internal fun isCodeError(code: String?): Boolean = code == "INVALID_OTP" || code == "OTP_EXPIRED" || code == "TOO_MANY_ATTEMPTS"

/**
 * Sign in or create an account, then the emailed 6-digit code when the address needs verifying; the password reset is the same screen.
 * A guest lands here when they start something personal ([AppNav.loginReason] says what); signing in continues that action.
 * Full-bleed like the web's AuthLayout: logo, serif title and lede, the form, then a divider and the switch link. No app bar.
 */
@Composable
fun LoginScreen(nav: AppNav) {
    val e = MaterialTheme.ext
    val api = LocalApp.current.api
    val scope = rememberCoroutineScope()
    val demoSub = demoTab(LocalDemo.current) // screenshots open on a sub-screen
    var mode by remember {
        mutableStateOf(
            when (demoSub) {
                "Signup" -> Mode.SignUp; "Verify" -> Mode.Verify; "Forgot" -> Mode.ForgotEmail; "Reset" -> Mode.ForgotCode
                else -> if (nav.loginSignUp) Mode.SignUp else Mode.SignIn
            },
        )
    }
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf(if (demoSub in listOf("Verify", "Forgot", "Reset")) "maya@example.com" else "") }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var tried by remember { mutableStateOf(false) } // the button was pressed: show what's wrong with each field
    var issue by remember { mutableStateOf<Issue?>(null) }
    var codeIssue by remember { mutableStateOf<String?>(null) } // a wrong or expired code, shown under the boxes
    var info by remember { mutableStateOf<String?>(null) }
    var fromSignUp by remember { mutableStateOf(false) } // Verify copy: just signed up vs signing in with an unverified address
    var address by remember { mutableStateOf(email.trim()) } // the address a code was sent to
    var token by remember { mutableStateOf<String?>(null) } // proof of the request that sent it, for the delivery status
    val demoStatus = if (demoSub in listOf("Verify", "Reset")) EmailStatus("sent", java.time.Instant.now().minusSeconds(40).toString(), "m•••@example.com", 0, false) else null

    val signUp = mode == Mode.SignUp
    val top = mode == Mode.SignIn || mode == Mode.SignUp
    val errs = if (!tried) FieldErrors() else when (mode) {
        Mode.SignIn -> signInErrors(email, password)
        Mode.SignUp -> signUpErrors(name, email, password, confirm)
        Mode.Verify -> FieldErrors(code = codeError(code))
        Mode.ForgotEmail -> FieldErrors(email = emailError(email))
        Mode.ForgotCode -> resetErrors(code, password, confirm)
    }

    fun show(m: Mode) { mode = m; issue = null; codeIssue = null; code = ""; tried = false }
    fun leave() { if (top) nav.loginFinished(false) else show(Mode.SignIn) }
    BackHandler { leave() }

    /** Code steps: [codeOnly] puts every failure under the boxes (verify); otherwise only code problems go there (reset). */
    fun attempt(codeOnly: Boolean, block: suspend () -> Unit) {
        scope.launch {
            busy = true; issue = null; codeIssue = null
            try {
                block()
            } catch (x: CancellationException) {
                throw x
            } catch (x: ApiError) {
                val m = otpError(x.status, x.code, x.message)
                if (codeOnly || isCodeError(x.code)) codeIssue = m else issue = Issue(m)
            } catch (x: Exception) {
                issue = Issue("Something went wrong. Try again.")
            }
            busy = false
        }
    }

    fun submit() {
        tried = true
        if (!(if (signUp) signUpErrors(name, email, password, confirm) else signInErrors(email, password)).ok) return
        scope.launch {
            busy = true; issue = null; info = null
            val a = email.trim()
            try {
                if (signUp) {
                    if (api.signUp(name.trim(), a, password)) nav.loginFinished(true) else { address = a; token = api.statusToken; fromSignUp = true; show(Mode.Verify) } // the server emailed a code
                } else {
                    api.signIn(a, password)
                    nav.loginFinished(true)
                }
            } catch (x: CancellationException) {
                throw x
            } catch (x: ApiError) {
                if (!signUp && (x.code == "EMAIL_NOT_VERIFIED" || x.status == 403)) {
                    token = runCatching { api.sendOtp(a, "email-verification") }.getOrNull()
                    address = a; fromSignUp = false; show(Mode.Verify)
                } else if (signUp) {
                    issue = if (x.status == 422 || x.code == "USER_ALREADY_EXISTS" || x.message.contains("already exists", true)) Issue("An account with this email already exists.", exists = true)
                    else Issue(x.message.ifEmpty { "Could not create the account." })
                } else {
                    issue = Issue(if (x.status == 401) "That email and password don't match." else x.message.ifEmpty { "Could not sign in. Try again." })
                }
            } catch (x: Exception) {
                issue = Issue(if (signUp) "Could not create the account." else "Could not sign in. Try again.")
            }
            busy = false
        }
    }

    val (title, lede) = when (mode) {
        Mode.SignIn -> "Welcome back" to (nav.loginReason ?: "Sign in to continue your practice.")
        Mode.SignUp -> "Create your account" to (nav.loginReason ?: "Timed Speaking and Writing practice with honest band feedback.")
        Mode.Verify -> if (fromSignUp) "Check your email" to "One step left: verify your address." else "Verify your email" to "One step left before you can sign in."
        Mode.ForgotEmail -> "Reset your password" to "Enter your account email and we'll send you a 6-digit code."
        Mode.ForgotCode -> "Enter your code" to "If an account exists for $address, we sent it a 6-digit code. It expires in 10 minutes."
    }
    val alert = issue?.takeUnless { it.exists }?.message

    Box(Modifier.fillMaxSize().background(e.bg).safeDrawingPadding(), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier.widthIn(max = 460.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 8.dp, end = 20.dp, top = 4.dp, bottom = 32.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(::leave) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = if (top) "Close" else "Back to sign in", tint = e.ink) }
                Logo()
            }
            Column(Modifier.padding(start = 12.dp, top = 32.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(title, Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineLarge, color = e.ink)
                    Text(lede, style = MaterialTheme.typography.bodyLarge, color = e.muted)
                }
                Spacer(Modifier.height(8.dp))
                alert?.let { Alert(it) }
                if (mode == Mode.SignIn) info?.let { Alert(it, good = true) }

                when (mode) {
                    Mode.SignIn, Mode.SignUp -> {
                        if (signUp) Field(name, { name = it }, "Name", errs.name, contentType = ContentType.PersonFullName)
                        Column {
                            Field(
                                email, { email = it; if (issue?.exists == true) issue = null }, "Email",
                                errs.email ?: issue?.takeIf { it.exists }?.message, keyboardType = KeyboardType.Email, contentType = ContentType.EmailAddress,
                            )
                            if (issue?.exists == true && errs.email == null) LinkButton("Sign in instead", { show(Mode.SignIn); confirm = "" }, Modifier.offset(x = (-12).dp))
                        }
                        if (signUp) {
                            PasswordPair(password, { password = it }, confirm, { confirm = it }, "Password", errs)
                        } else {
                            Column {
                                Field(password, { password = it }, "Password", errs.password, password = true, contentType = ContentType.Password)
                                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
                                    LinkButton("Forgot password?", { show(Mode.ForgotEmail); info = null }, Modifier.offset(x = 12.dp))
                                }
                            }
                        }
                        PrimaryButton(if (signUp) "Create account" else "Sign in", ::submit, Modifier.fillMaxWidth(), loading = busy)
                        if (signUp) TermsNote()
                        Footer(if (signUp) "Already have an account?" else "New here?", if (signUp) "Sign in" else "Create an account") {
                            show(if (signUp) Mode.SignIn else Mode.SignUp); info = null; confirm = ""
                        }
                    }

                    Mode.Verify -> {
                        Icon(Icons.Filled.Email, null, Modifier.size(28.dp), tint = e.brand)
                        Text(
                            buildAnnotatedString {
                                append("Enter the 6-digit code for ")
                                pushStyle(SpanStyle(fontWeight = FontWeight.SemiBold, color = e.ink)); append(address); pop()
                                append(". It expires in 10 minutes.")
                            },
                            style = MaterialTheme.typography.bodyLarge, color = e.muted,
                        )
                        CodeField(code, errs.code ?: codeIssue) { code = it; codeIssue = null }
                        PrimaryButton("Verify email", {
                            tried = true
                            if (codeError(code) == null) attempt(codeOnly = true) { api.verifyEmail(address, code); nav.loginFinished(true) }
                        }, Modifier.fillMaxWidth(), loading = busy)
                        CodeDelivery(token, demoStatus) { api.sendOtp(address, "email-verification") }
                    }

                    Mode.ForgotEmail -> {
                        Field(email, { email = it }, "Email", errs.email, keyboardType = KeyboardType.Email, contentType = ContentType.EmailAddress)
                        PrimaryButton("Send code", {
                            tried = true
                            if (emailError(email) == null) attempt(codeOnly = false) { val a = email.trim(); token = api.sendOtp(a, "forget-password"); address = a; show(Mode.ForgotCode) }
                        }, Modifier.fillMaxWidth(), loading = busy)
                        Footer(null, "Back to sign in") { show(Mode.SignIn) }
                    }

                    Mode.ForgotCode -> {
                        CodeField(code, errs.code ?: codeIssue) { code = it; codeIssue = null }
                        PasswordPair(password, { password = it }, confirm, { confirm = it }, "New password", errs)
                        PrimaryButton("Update password", {
                            tried = true
                            if (resetErrors(code, password, confirm).ok) attempt(codeOnly = false) {
                                api.resetPassword(address, code, password)
                                password = ""; confirm = ""; show(Mode.SignIn); info = "Password updated. Sign in with your new password."
                            }
                        }, Modifier.fillMaxWidth(), loading = busy)
                        Column {
                            CodeDelivery(token, demoStatus) { api.sendOtp(address, "forget-password") }
                            LinkButton("Use a different email", { show(Mode.ForgotEmail) }, Modifier.offset(x = (-12).dp))
                        }
                        Footer(null, "Back to sign in") { show(Mode.SignIn) }
                    }
                }
            }
        }
    }
}

/** NextBand wordmark. Its colours come from values(-night)/colors.xml, resolved for the app's theme (Settings > Appearance can differ from the device). */
@Composable
private fun Logo() {
    val context = LocalContext.current
    val dark = MaterialTheme.ext.isDark
    val vector = remember(context, dark) {
        val c = Configuration(context.resources.configuration)
        c.uiMode = (c.uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or (if (dark) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO)
        ImageVector.vectorResource(null, context.createConfigurationContext(c).resources, R.drawable.logo_wordmark)
    }
    Image(vector, "NextBand", Modifier.height(26.dp))
}

/** A labelled field with its error (or [hint]) underneath. The error is announced when it appears. */
@Composable
private fun Field(
    value: String, onChange: (String) -> Unit, label: String, error: String?,
    keyboardType: KeyboardType = KeyboardType.Text, password: Boolean = false, contentType: ContentType? = null, hint: (@Composable () -> Unit)? = null,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        AppField(value, onChange, label, keyboardType = keyboardType, password = password, isError = error != null, contentType = contentType)
        if (error != null) ErrorLine(error, Modifier.semantics { liveRegion = LiveRegionMode.Polite }) else hint?.invoke()
    }
}

/** New password + confirmation (web PasswordPair): "At least 8 characters" turns into a tick at 8; a mismatch shows as soon as it's certain. */
@Composable
private fun PasswordPair(password: String, onPassword: (String) -> Unit, confirm: String, onConfirm: (String) -> Unit, label: String, errs: FieldErrors) {
    Field(password, onPassword, label, errs.password, password = true, contentType = ContentType.NewPassword) {
        if (password.length >= 8) Hint("8 characters or more", good = true)
        else Text("At least 8 characters.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.ext.muted)
    }
    Field(confirm, onConfirm, "Confirm password", errs.confirm ?: liveMismatch(password, confirm), password = true, contentType = ContentType.NewPassword)
}

/** A general failure (or the "password updated" note) at the top of the form, like the web's Alert. */
@Composable
private fun Alert(text: String, good: Boolean = false) {
    val e = MaterialTheme.ext
    val tone = if (good) e.good else e.bad
    val ink = if (good) e.goodText else e.badText
    Surface(
        Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }, shape = ControlShape,
        color = tone.copy(alpha = 0.10f), border = BorderStroke(1.dp, tone.copy(alpha = 0.45f)),
    ) {
        Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
            Icon(if (good) Icons.Filled.CheckCircle else Icons.Filled.Warning, null, Modifier.size(18.dp).padding(top = 2.dp), tint = ink)
            Text(text, style = MaterialTheme.typography.bodyMedium, color = ink)
        }
    }
}

/** Under the form: a hairline, then "New here? Create an account" (or a lone link such as "Back to sign in"). */
@Composable
private fun Footer(lead: String?, action: String, onClick: () -> Unit) {
    val e = MaterialTheme.ext
    Column(Modifier.padding(top = 16.dp)) {
        HorizontalDivider(color = e.line)
        Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            if (lead != null) Text(lead, style = MaterialTheme.typography.bodyMedium, color = e.muted)
            LinkButton(action, onClick, Modifier.offset(x = if (lead != null) 0.dp else (-12).dp))
        }
    }
}

/** "By creating an account you agree to the terms and privacy policy." Both open the web pages. */
@Composable
private fun TermsNote() {
    val e = MaterialTheme.ext
    val link = TextLinkStyles(SpanStyle(color = e.ink, fontWeight = FontWeight.Medium, textDecoration = TextDecoration.Underline))
    Text(
        buildAnnotatedString {
            append("By creating an account you agree to the ")
            withLink(LinkAnnotation.Url("${ApiClient.SERVER}/terms", link)) { append("terms") }
            append(" and ")
            withLink(LinkAnnotation.Url("${ApiClient.SERVER}/privacy", link)) { append("privacy policy") }
            append(".")
        },
        Modifier.fillMaxWidth(), style = MaterialTheme.typography.bodySmall, color = e.muted, textAlign = TextAlign.Center,
    )
}

@Composable
private fun Hint(text: String, good: Boolean) {
    val e = MaterialTheme.ext
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Filled.CheckCircle, null, Modifier.size(18.dp), tint = if (good) e.goodText else e.muted)
        Text(text, style = MaterialTheme.typography.bodySmall, color = if (good) e.goodText else e.muted)
    }
}

/**
 * Six-digit code entry shown as six boxes (like the web's shadcn InputOTP). One BasicTextField holds the value, so the keyboard,
 * paste, Backspace and the SMS/email one-time-code autofill all work; the decoration draws the boxes. Digits only.
 */
@Composable
private fun CodeField(code: String, error: String?, onChange: (String) -> Unit) {
    val e = MaterialTheme.ext
    val focus = remember { androidx.compose.ui.focus.FocusRequester() }
    var focused by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        androidx.compose.foundation.text.BasicTextField(
            value = code,
            onValueChange = { onChange(otpDigits(it)) },
            singleLine = true,
            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            cursorBrush = androidx.compose.ui.graphics.SolidColor(androidx.compose.ui.graphics.Color.Transparent),
            textStyle = androidx.compose.ui.text.TextStyle(color = androidx.compose.ui.graphics.Color.Transparent),
            modifier = Modifier
                .fillMaxWidth()
                .focusRequester(focus)
                .onFocusChanged { focused = it.isFocused }
                .semantics { contentType = ContentType.SmsOtpCode; contentDescription = "6-digit code" },
            decorationBox = { inner ->
                Box {
                    Box(Modifier.size(1.dp)) { inner() } // the real (invisible) field; the boxes below show its value
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        repeat(6) { i ->
                            val active = focused && i == minOf(code.length, 5)
                            Box(
                                Modifier
                                    .weight(1f)
                                    .height(56.dp)
                                    .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(10.dp))
                                    .border(if (active || error != null) 2.dp else 1.dp, if (error != null) e.bad else if (active) MaterialTheme.colorScheme.primary else e.line, RoundedCornerShape(10.dp)),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(code.getOrNull(i)?.toString() ?: "", style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.onSurface)
                            }
                        }
                    }
                }
            },
        )
        if (error != null) ErrorLine(error, Modifier.semantics { liveRegion = LiveRegionMode.Polite })
    }
}

/**
 * Delivery status plus "Resend code" with a live countdown. [first] is the status token of the request that sent the first code (null when that call failed);
 * the status is polled every 2 s for 20 s after each send so a late failure shows up. [demo] (screenshots) is shown as is, with no network.
 */
@Composable
private fun CodeDelivery(first: String?, demo: EmailStatus?, send: suspend () -> String?) {
    val api = LocalApp.current.api
    val e = MaterialTheme.ext
    var token by remember { mutableStateOf(first) }
    var status by remember { mutableStateOf(demo) }
    var wait by remember { mutableIntStateOf(demo?.resendAvailableIn ?: 0) }
    var sendFailed by remember { mutableStateOf(first == null && demo == null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(token) {
        val t = token ?: return@LaunchedEffect
        if (demo != null) return@LaunchedEffect
        repeat(10) {
            runCatching { api.emailStatus(t) }.getOrNull()?.let { status = it; wait = it.resendAvailableIn }
            delay(2000)
        }
    }
    LaunchedEffect(wait) { if (wait > 0) { delay(1000); wait-- } }
    val shown = if (sendFailed) EmailStatus("failed", error = "network") else status?.copy(resendAvailableIn = wait)
    val (line, bad) = emailStatusLine(shown, System.currentTimeMillis())
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Top) {
        Icon(if (bad) Icons.Filled.Warning else Icons.Filled.CheckCircle, null, Modifier.size(18.dp), tint = if (bad) e.bad else if (shown?.status == "sent") e.goodText else e.muted)
        Text(line, style = MaterialTheme.typography.bodySmall, color = if (bad) e.bad else e.muted)
    }
    LinkButton(if (wait > 0) "Resend code in ${wait}s" else "Resend code", {
        scope.launch {
            sendFailed = false
            val t = try { send() } catch (x: CancellationException) { throw x } catch (x: Exception) { null }
            if (t == null) sendFailed = true else { status = null; token = t }
        }
    }, enabled = wait == 0)
}
