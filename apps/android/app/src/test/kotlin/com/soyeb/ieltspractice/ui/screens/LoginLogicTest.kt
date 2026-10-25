package com.soyeb.ieltspractice.ui.screens

import com.soyeb.ieltspractice.ui.theme.appearanceDark
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Plain JVM: the sign-in form's "why can't I continue" messages and the appearance setting. */
class LoginLogicTest {
    @Test fun emailNeedsAnAddress() {
        assertEquals("Enter your email.", emailError("  "))
        assertEquals("Enter a valid email address, like name@example.com.", emailError("maya@example"))
        assertNull(emailError(" maya@example.com "))
    }

    @Test fun signUpSaysWhyEachFieldIsWrong() {
        val e = signUpErrors("", "maya@example.com", "short", "shorter")
        assertEquals("Enter your name.", e.name)
        assertNull(e.email)
        assertEquals("Use at least 8 characters.", e.password)
        assertEquals(MISMATCH, e.confirm)
        assertFalse(e.ok)
        assertTrue(signUpErrors("Maya", "maya@example.com", "longenough", "longenough").ok)
        assertEquals("Confirm your password.", signUpErrors("Maya", "maya@example.com", "longenough", "").confirm)
    }

    @Test fun signInOnlyNeedsSomething() {
        assertEquals("Enter your password.", signInErrors("maya@example.com", "").password)
        assertTrue(signInErrors("maya@example.com", "x").ok)
    }

    @Test fun resetNeedsSixDigitsAndAPair() {
        assertEquals("Enter all 6 digits.", resetErrors("123", "longenough", "longenough").code)
        assertTrue(resetErrors("123456", "longenough", "longenough").ok)
    }

    @Test fun liveMismatchIgnoresAPrefix() {
        assertNull(liveMismatch("password1", "pass"))
        assertNull(liveMismatch("password1", ""))
        assertEquals(MISMATCH, liveMismatch("password1", "pasx"))
    }

    @Test fun codeErrorsGoUnderTheBoxes() {
        assertTrue(isCodeError("INVALID_OTP"))
        assertTrue(isCodeError("OTP_EXPIRED"))
        assertFalse(isCodeError(null))
        assertFalse(isCodeError("too_many_requests"))
    }

    @Test fun appearanceOverridesTheDevice() {
        assertFalse(appearanceDark("light", systemDark = true))
        assertTrue(appearanceDark("dark", systemDark = false))
        assertTrue(appearanceDark("system", systemDark = true))
        assertFalse(appearanceDark("bogus", systemDark = false))
    }
}
