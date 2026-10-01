import Foundation
import Observation
import Security

struct APIError: LocalizedError {
    let status: Int
    let message: String
    var code: String? = nil // Better Auth error code, e.g. INVALID_OTP
    var errorDescription: String? { message }
}

/// Guest tried something that needs an account: the sign-in sheet is shown with `reason` above the form.
struct SignInRequest: Identifiable {
    let id = UUID()
    let reason: String
    var signUp = false
}

/// Typed client for the IELTS Practice API. Auth is Better Auth's bearer plugin: the token comes back in the
/// `set-auth-token` header on sign-in, lives in the Keychain and is sent as `Authorization: Bearer`.
@MainActor @Observable
final class APIClient {
    /// The production server. Fixed in the app; there is no user-facing server setting.
    static let server = "https://ielts.soyebjim.me"

    let baseURL: String
    private(set) var token: String?
    var me: Me?
    var isSignedIn: Bool { token != nil }
    /// Non-nil while the sign-in sheet should be up (see `requestSignIn`).
    var signInRequest: SignInRequest?
    private(set) var signingIn = false

    @ObservationIgnored private let session: URLSession = {
        let c = URLSessionConfiguration.default
        // Bearer only: cookies would trigger Better Auth's browser origin checks.
        c.httpShouldSetCookies = false
        c.httpCookieAcceptPolicy = .never
        c.timeoutIntervalForRequest = 60
        if Demo.on { c.protocolClasses = [DemoURLProtocol.self] }
        return URLSession(configuration: c)
    }()

    init() {
        baseURL = Demo.on ? "https://demo.ielts.local" : Self.server
        token = Demo.on ? (Demo.screen == "login" || Demo.screen == "guest" ? nil : "demo") : Keychain.get()
    }

    // MARK: Requests

    /// `body` is any Encodable, or a JSON dictionary/array.
    func send<T: Decodable>(_ method: String, _ path: String, _ body: Any? = nil) async throws -> T {
        let (data, _) = try await raw(method, path, body)
        if T.self == Empty.self, let e = Empty() as? T { return e }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError(status: 0, message: "Unexpected response from the server (\(path)).")
        }
    }

    func get<T: Decodable>(_ path: String, query: [String: String?] = [:]) async throws -> T {
        var c = URLComponents()
        c.queryItems = query.compactMap { k, v in v.map { URLQueryItem(name: k, value: $0) } }.sorted { $0.name < $1.name }
        let q = c.queryItems?.isEmpty == false ? "?" + (c.percentEncodedQuery ?? "") : ""
        return try await send("GET", path + q)
    }

    @discardableResult
    func raw(_ method: String, _ path: String, _ body: Any? = nil) async throws -> (Data, HTTPURLResponse) {
        guard let url = URL(string: baseURL + path) else { throw APIError(status: 0, message: "Invalid request URL.") }
        var req = URLRequest(url: url)
        req.httpMethod = method
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if let e = body as? Encodable { req.httpBody = try JSONEncoder().encode(e) } else { req.httpBody = try JSONSerialization.data(withJSONObject: body) }
        }
        let data: Data, resp: URLResponse
        do {
            (data, resp) = try await session.data(for: req)
        } catch is CancellationError {
            throw CancellationError()
        } catch let e as URLError where e.code == .cancelled {
            throw CancellationError()
        } catch {
            throw APIError(status: 0, message: "Can't reach IELTS Practice. Check your internet connection and try again.")
        }
        guard let http = resp as? HTTPURLResponse else { throw APIError(status: 0, message: "No response from the server.") }
        guard (200..<300).contains(http.statusCode) else {
            struct ErrBody: Decodable { let error: String?; let message: String?; let code: String? }
            let b = try? JSONDecoder().decode(ErrBody.self, from: data)
            if http.statusCode == 401 && token != nil && !path.hasPrefix("/api/auth/") { signOutLocal() }
            throw APIError(status: http.statusCode, message: b?.error ?? b?.message ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode).capitalized, code: b?.code)
        }
        return (data, http)
    }

    /// PUT a file to a presigned URL.
    func upload(_ urlString: String, file: URL, contentType: String) async throws {
        guard let url = URL(string: urlString) else { throw APIError(status: 0, message: "Invalid upload URL") }
        var req = URLRequest(url: url)
        req.httpMethod = "PUT"
        req.setValue(contentType, forHTTPHeaderField: "Content-Type")
        let (_, resp) = try await session.upload(for: req, fromFile: file)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError(status: (resp as? HTTPURLResponse)?.statusCode ?? 0, message: "Audio upload failed. Check your connection and retry.")
        }
    }

    func download(_ urlString: String) async throws -> Data {
        guard let url = URL(string: urlString) else { throw APIError(status: 0, message: "Invalid audio URL") }
        return try await session.data(from: url).0
    }

    // MARK: Auth

    func signIn(email: String, password: String) async throws {
        let (_, http) = try await raw("POST", "/api/auth/sign-in/email", ["email": email, "password": password])
        try await adopt(http)
    }

    /// Returns false when the server requires email verification before signing in.
    func signUp(name: String, email: String, password: String) async throws -> Bool {
        let (_, http) = try await raw("POST", "/api/auth/sign-up/email", ["name": name, "email": email, "password": password])
        guard http.value(forHTTPHeaderField: "set-auth-token") != nil else { return false }
        try await adopt(http)
        return true
    }

    /// Guests browse freely; call this when they start something personal. The sheet signs them in or up (the pending screen or action is simply
    /// the one they were on, which swaps in once `isSignedIn` turns true).
    func requestSignIn(_ reason: String, signUp: Bool = false) {
        guard !isSignedIn, signInRequest == nil else { return }
        signInRequest = SignInRequest(reason: reason, signUp: signUp)
    }

    /// Emails a 6-digit code (Better Auth emailOTP). The answer is the same whether or not the address has an account.
    func sendOTP(email: String, type: String) async throws {
        try await raw("POST", "/api/auth/email-otp/send-verification-otp", ["email": email, "type": type])
    }

    /// Verifies the address with the emailed code and signs the user in.
    func verifyEmail(email: String, otp: String) async throws {
        let (_, http) = try await raw("POST", "/api/auth/email-otp/verify-email", ["email": email, "otp": otp])
        try await adopt(http)
    }

    func resetPassword(email: String, otp: String, password: String) async throws {
        try await raw("POST", "/api/auth/email-otp/reset-password", ["email": email, "otp": otp, "password": password])
    }

    private func adopt(_ http: HTTPURLResponse) async throws {
        guard let t = http.value(forHTTPHeaderField: "set-auth-token"), !t.isEmpty else {
            throw APIError(status: 0, message: "Sign-in didn't complete. Please try again.")
        }
        token = t
        Keychain.set(t)
        signingIn = true // keeps the tabs (and the sign-in sheet) on screen until /api/me arrives
        defer { signingIn = false }
        do { try await loadMe() } catch {
            signOutLocal()
            throw error
        }
    }

    func loadMe() async throws { me = try await send("GET", "/api/me") }

    func signOut() async {
        _ = try? await raw("POST", "/api/auth/sign-out", [String: String]())
        signOutLocal()
    }

    func deleteAccount() async throws {
        try await raw("POST", "/api/auth/delete-user", [String: String]())
        signOutLocal()
    }

    func signOutLocal() {
        token = nil
        me = nil
        Keychain.delete()
    }

    // MARK: Shared flows

    func saveSettings(_ s: AppSettings) async throws {
        let saved: AppSettings = try await send("PUT", "/api/settings", s)
        me?.settings = saved
    }

    /// Create a speaking attempt, upload the m4a and start analysis. Returns the attempt id.
    func submitSpeaking(prompt: Prompt, mode: String = "practice", sessionId: String, parentAttemptId: String?, file: URL,
                        durationMs: Int, energy: [Int], marks: [Int]) async throws -> String {
        var body: [String: Any] = ["promptId": prompt.id, "skill": "speaking", "part": prompt.part, "mode": mode,
                                   "sessionId": sessionId, "audioContentType": "audio/mp4"]
        if let parentAttemptId { body["parentAttemptId"] = parentAttemptId }
        let created: Created = try await send("POST", "/api/attempts", body)
        guard let uploadUrl = created.uploadUrl else { throw APIError(status: 0, message: "The server didn't return an upload URL.") }
        try await upload(uploadUrl, file: file, contentType: "audio/mp4")
        let _: Empty = try await send("POST", "/api/attempts/\(created.id)/submit",
                                      ["durationMs": durationMs, "energy": Array(energy.prefix(20000)), "marks": Array(marks.prefix(200))] as [String: Any])
        return created.id
    }

    func addCard(front: String, back: String, source: String) async throws {
        let _: Empty = try await send("POST", "/api/cards", ["front": front, "back": back, "source": source])
    }
}

/// Wording for the 6-digit code flow (web lib/auth.ts otpError).
enum AuthText {
    /// Digits only, at most six: what a code field keeps from typing, paste or the keyboard's one-time-code suggestion.
    static func otpDigits(_ s: String) -> String { String(s.filter(\.isASCII).filter(\.isNumber).prefix(6)) }

    static func otpError(_ e: APIError) -> String {
        if e.code == "INVALID_OTP" { return "That code isn't right. Check it and try again." }
        if e.code == "OTP_EXPIRED" { return "That code has expired. Request a new one." }
        if e.code == "TOO_MANY_ATTEMPTS" { return "Too many wrong tries. Request a new code." }
        if e.status == 429 { return "Too many requests. Wait a minute, then try again." }
        return e.message.isEmpty ? "Something went wrong. Try again." : e.message
    }
}

enum Keychain {
    private static let base: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "com.soyeb.ieltspractice",
        kSecAttrAccount as String: "session-token",
    ]

    static func get() -> String? {
        var q = base
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }

    static func set(_ value: String) {
        delete()
        var q = base
        q[kSecValueData as String] = Data(value.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }

    static func delete() { SecItemDelete(base as CFDictionary) }
}
