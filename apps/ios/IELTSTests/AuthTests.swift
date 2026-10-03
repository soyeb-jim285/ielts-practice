import XCTest
@testable import IELTS

final class AuthTests: XCTestCase {
    func testOtpDigitsKeepsDigitsAndCapsAtSix() {
        XCTAssertEqual(AuthText.otpDigits("12-34 56 78"), "123456")
        XCTAssertEqual(AuthText.otpDigits("abc"), "")
        XCTAssertEqual(AuthText.otpDigits("٣٤٥"), "") // non-ASCII digits are not accepted
    }

    func testOtpErrorWording() {
        XCTAssertTrue(AuthText.otpError(APIError(status: 400, message: "Invalid OTP", code: "INVALID_OTP")).contains("isn't right"))
        XCTAssertTrue(AuthText.otpError(APIError(status: 400, message: "", code: "OTP_EXPIRED")).contains("expired"))
        XCTAssertTrue(AuthText.otpError(APIError(status: 403, message: "", code: "TOO_MANY_ATTEMPTS")).contains("new code"))
        XCTAssertTrue(AuthText.otpError(APIError(status: 429, message: "slow down")).contains("Too many requests"))
        XCTAssertEqual(AuthText.otpError(APIError(status: 500, message: "Boom")), "Boom")
    }

    func testStatusLineWording() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let now = ISO8601DateFormatter().date(from: "2026-01-01T12:01:20Z")!
        let sent = EmailStatus(status: "sent", sentAt: "2026-01-01T12:01:00Z", maskedEmail: "j•••@gmail.com")
        XCTAssertEqual(AuthText.statusLine(sent, now: now, calendar: cal, locale: Locale(identifier: "en_US_POSIX")).text, "Code sent to j•••@gmail.com at 12:01. Check your spam folder if it doesn't show up.")
        var again = sent
        again.alreadySent = true
        again.resendAvailableIn = 10
        XCTAssertEqual(AuthText.statusLine(again, now: now, calendar: cal).text, "Code already sent 20 s ago to j•••@gmail.com; it is still valid. Check spam; you can resend in 10 s.")
        let failed = AuthText.statusLine(EmailStatus(status: "failed", error: "rate_limited"), now: now)
        XCTAssertEqual(failed.text, "We couldn't send the email (the email service is busy). Try again.")
        XCTAssertTrue(failed.failed)
        XCTAssertEqual(AuthText.statusLine(nil).text, "Sending the code…")
    }
}
