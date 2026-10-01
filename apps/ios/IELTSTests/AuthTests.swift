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
}
