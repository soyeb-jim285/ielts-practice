package com.soyeb.ieltspractice.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Email
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.LocalDemo
import com.soyeb.ieltspractice.R
import com.soyeb.ieltspractice.core.ApiError
import com.soyeb.ieltspractice.ui.ScreenScaffold
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.screens.shell.AppField
import com.soyeb.ieltspractice.ui.screens.shell.LinkButton
import com.soyeb.ieltspractice.ui.screens.shell.demoTab
import com.soyeb.ieltspractice.ui.screens.shell.otpDigits
import com.soyeb.ieltspractice.ui.screens.shell.otpError
import com.soyeb.ieltspractice.ui.theme.ErrorLine
import com.soyeb.ieltspractice.ui.theme.PrimaryButton
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// Mirrors: iOS Views/LoginView.swift, web routes/login.tsx, signup.tsx, forgot-password.tsx

private enum class Mode { SignIn, SignUp, Verify, ForgotEmail, ForgotCode }

private class Issue(val message: String, val exists: Boolean = false) // exists: sign-up with an address that already has an account

/**
 * Sign in or create an account, then the emailed 6-digit code when the address needs verifying; the password reset is the same screen.
 * A guest lands here when they start something personal ([AppNav.loginReason] says what); signing in continues that action.
 */
@Composable
fun LoginScreen(nav: AppNav) {
    val e = MaterialTheme.ext
    val api = LocalApp.current.api
    val scope = rememberCoroutineScope()
    var mode by remember {
        mutableStateOf(
            when (demoTab(LocalDemo.current)) { // screenshots open on a sub-screen
                "Signup" -> Mode.SignUp; "Verify" -> Mode.Verify; "Forgot" -> Mode.ForgotEmail; "Reset" -> Mode.ForgotCode
                else -> if (nav.loginSignUp) Mode.SignUp else Mode.SignIn
            },
        )
    }
    val demoSub = demoTab(LocalDemo.current) in listOf("Verify", "Forgot", "Reset")
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf(if (demoSub) "maya@example.com" else "") }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var issue by remember { mutableStateOf<Issue?>(null) }
    var info by remember { mutableStateOf<String?>(null) }
    var address by remember { mutableStateOf(email.trim()) } // the address a code was sent to

    val signUp = mode == Mode.SignUp
    val mismatch = confirm.isNotEmpty() && confirm != password
    val canSubmit = !busy && email.isNotBlank() && password.isNotEmpty() && (!signUp || (name.isNotBlank() && password.length >= 8 && confirm == password))
    val top = mode == Mode.SignIn || mode == Mode.SignUp

    fun show(m: Mode) { mode = m; issue = null; code = "" }
    BackHandler(enabled = !top) { show(Mode.SignIn) }

    fun attempt(block: suspend () -> Unit) {
        scope.launch {
            busy = true; issue = null
            try { block() } catch (x: CancellationException) { throw x } catch (x: ApiError) { issue = Issue(otpError(x.status, x.code, x.message)) } catch (x: Exception) { issue = Issue("Something went wrong. Try again.") }
            busy = false
        }
    }

    fun submit() = scope.launch {
        busy = true; issue = null; info = null
        val a = email.trim()
        try {
            if (signUp) {
                if (api.signUp(name.trim(), a, password)) nav.loginFinished(true) else { address = a; show(Mode.Verify) } // the server emailed a code
            } else {
                api.signIn(a, password)
                nav.loginFinished(true)
            }
        } catch (x: CancellationException) {
            throw x
        } catch (x: ApiError) {
            if (!signUp && (x.code == "EMAIL_NOT_VERIFIED" || x.status == 403)) {
                runCatching { api.sendOtp(a, "email-verification") }
                address = a; show(Mode.Verify)
            } else if (signUp) {
                issue = if (x.status == 422 || x.message.contains("already exists", true)) Issue("An account with this email already exists.", exists = true)
                else Issue(x.message.ifEmpty { "Could not create the account." })
            } else {
                issue = Issue(if (x.status == 401) "That email and password don't match." else x.message.ifEmpty { "Could not sign in. Try again." })
            }
        } catch (x: Exception) {
            issue = Issue(if (signUp) "Could not create the account." else "Could not sign in. Try again.")
        }
        busy = false
    }

    val title = when (mode) {
        Mode.SignIn -> "Sign in"; Mode.SignUp -> "Create account"; Mode.Verify -> "Verify your email"
        Mode.ForgotEmail -> "Reset your password"; Mode.ForgotCode -> "Enter your code"
    }
    ScreenScaffold(title, onBack = { if (top) nav.loginFinished(false) else show(Mode.SignIn) }) {
        Column(Modifier.imePadding(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            when (mode) {
                Mode.SignIn, Mode.SignUp -> {
                    Column(Modifier.padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(48.dp).background(e.brandSoft, RoundedCornerShape(12.dp)), Alignment.Center) {
                                Icon(painterResource(R.drawable.ic_mic), null, Modifier.size(24.dp), tint = e.brand)
                            }
                            Text("IELTS Practice", style = MaterialTheme.typography.titleLarge, color = e.ink)
                        }
                        Text(if (signUp) "Create your account" else "Welcome back", style = MaterialTheme.typography.headlineMedium, color = e.ink)
                        Text(
                            nav.loginReason ?: if (signUp) "Timed Speaking and Writing practice with honest band feedback." else "Sign in to continue your practice.",
                            style = MaterialTheme.typography.bodyLarge, color = e.muted,
                        )
                    }
                    if (signUp) AppField(name, { name = it }, "Name", contentType = ContentType.PersonFullName)
                    AppField(email, { email = it; if (issue?.exists == true) issue = null }, "Email", keyboardType = KeyboardType.Email, contentType = ContentType.EmailAddress)
                    AppField(password, { password = it }, "Password", password = true, contentType = if (signUp) ContentType.NewPassword else ContentType.Password)
                    if (signUp) {
                        AppField(confirm, { confirm = it }, "Confirm password", password = true, contentType = ContentType.NewPassword)
                        PasswordHints(password, mismatch)
                    }
                    issue?.let { i ->
                        ErrorLine(i.message)
                        if (i.exists) LinkButton("Sign in instead", { show(Mode.SignIn); confirm = "" })
                    }
                    info?.let { Hint(it, good = true) }
                    PrimaryButton(if (signUp) "Create account" else "Sign in", { submit() }, Modifier.fillMaxWidth(), enabled = canSubmit, loading = busy)
                    if (!signUp) LinkButton("Forgot password?", { show(Mode.ForgotEmail); info = null })
                    LinkButton(if (signUp) "Already have an account? Sign in" else "New here? Create an account", { show(if (signUp) Mode.SignIn else Mode.SignUp); info = null; confirm = "" })
                }

                Mode.Verify -> {
                    Column(Modifier.padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Icon(Icons.Filled.Email, null, Modifier.size(40.dp), tint = e.brand)
                        Text("Verify your email", style = MaterialTheme.typography.headlineMedium, color = e.ink)
                        Text("We sent a 6-digit code to $address. It expires in 10 minutes; check spam if it doesn't show up.", style = MaterialTheme.typography.bodyLarge, color = e.muted)
                    }
                    CodeField(code) { code = it }
                    issue?.let { ErrorLine(it.message) }
                    PrimaryButton("Verify email", { attempt { api.verifyEmail(address, code); nav.loginFinished(true) } }, Modifier.fillMaxWidth(), enabled = code.length == 6, loading = busy)
                    ResendCode { api.sendOtp(address, "email-verification") }
                }

                Mode.ForgotEmail -> {
                    Text("Enter your account email and we'll send you a 6-digit code.", style = MaterialTheme.typography.bodyLarge, color = e.muted)
                    AppField(email, { email = it }, "Email", keyboardType = KeyboardType.Email, contentType = ContentType.EmailAddress)
                    issue?.let { ErrorLine(it.message) }
                    PrimaryButton("Send code", { attempt { val a = email.trim(); api.sendOtp(a, "forget-password"); address = a; show(Mode.ForgotCode) } }, Modifier.fillMaxWidth(), enabled = email.contains("@"), loading = busy)
                }

                Mode.ForgotCode -> {
                    val canReset = !busy && code.length == 6 && password.length >= 8 && confirm == password
                    Text("If an account exists for $address, we sent it a 6-digit code. It expires in 10 minutes.", style = MaterialTheme.typography.bodyLarge, color = e.muted)
                    CodeField(code) { code = it }
                    AppField(password, { password = it }, "New password", password = true, contentType = ContentType.NewPassword)
                    AppField(confirm, { confirm = it }, "Confirm password", password = true, contentType = ContentType.NewPassword)
                    PasswordHints(password, mismatch)
                    issue?.let { ErrorLine(it.message) }
                    PrimaryButton("Update password", {
                        attempt {
                            api.resetPassword(address, code, password)
                            password = ""; confirm = ""; show(Mode.SignIn); info = "Password updated. Sign in with your new password."
                        }
                    }, Modifier.fillMaxWidth(), enabled = canReset, loading = busy)
                    ResendCode { api.sendOtp(address, "forget-password") }
                    LinkButton("Use a different email", { show(Mode.ForgotEmail) })
                }
            }
        }
    }
}

@Composable
private fun Hint(text: String, good: Boolean) {
    val e = MaterialTheme.ext
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Filled.CheckCircle, null, Modifier.size(18.dp), tint = if (good) e.goodText else e.muted)
        Text(text, style = MaterialTheme.typography.bodySmall, color = if (good) e.goodText else e.muted)
    }
}

/** "8 characters or more" turns into a green tick; a mismatch is an error line. */
@Composable
private fun PasswordHints(password: String, mismatch: Boolean) {
    if (password.length >= 8) Hint("8 characters or more", good = true)
    else Text("At least 8 characters.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.ext.muted)
    if (mismatch) ErrorLine("The two passwords don't match.")
}

/** Six-digit code entry: numeric keypad, digits only, big and centred. */
@Composable
private fun CodeField(code: String, onChange: (String) -> Unit) {
    AppField(code, { onChange(otpDigits(it)) }, "6-digit code", keyboardType = KeyboardType.Number, textAlign = TextAlign.Center, mono = true, contentType = ContentType.SmsOtpCode)
}

/** "Resend code" with a 30 s cooldown that starts now (a code was just sent); the server sends at most one email per address every 30 s. */
@Composable
private fun ResendCode(send: suspend () -> Unit) {
    var wait by remember { mutableIntStateOf(30) }
    var failed by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(wait) { if (wait > 0) { delay(1000); wait-- } }
    LinkButton(if (wait > 0) "Resend code in ${wait}s" else "Resend code", {
        wait = 30
        scope.launch { failed = try { send(); false } catch (x: CancellationException) { throw x } catch (x: Exception) { true } }
    }, enabled = wait == 0)
    if (failed) ErrorLine("Could not send the code. Try again shortly.")
}
