import Foundation
import Observation
import Security

struct APIError: LocalizedError {
    let status: Int
    let message: String
    var errorDescription: String? { message }
}

/// Typed client for the IELTS Practice API. Auth is Better Auth's bearer plugin: the token comes back in the
/// `set-auth-token` header on sign-in, lives in the Keychain and is sent as `Authorization: Bearer`.
@MainActor @Observable
final class APIClient {
    static let defaultServer = "http://localhost:8787"

    private(set) var baseURL: String
    private(set) var token: String?
    var me: Me?
    var isSignedIn: Bool { token != nil }

    @ObservationIgnored private let session: URLSession = {
        let c = URLSessionConfiguration.default
        // Bearer only: cookies would trigger Better Auth's browser origin checks.
        c.httpShouldSetCookies = false
        c.httpCookieAcceptPolicy = .never
        c.timeoutIntervalForRequest = 60
        return URLSession(configuration: c)
    }()

    init() {
        baseURL = UserDefaults.standard.string(forKey: "serverURL") ?? Self.defaultServer
        token = Keychain.get()
    }

    func setBaseURL(_ url: String) {
        var u = url.trimmingCharacters(in: .whitespacesAndNewlines)
        while u.hasSuffix("/") { u.removeLast() }
        baseURL = u.isEmpty ? Self.defaultServer : u
        UserDefaults.standard.set(baseURL, forKey: "serverURL")
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
        guard let url = URL(string: baseURL + path) else { throw APIError(status: 0, message: "Invalid server URL. Fix it in Settings.") }
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
            throw APIError(status: 0, message: "Can't reach the server at \(baseURL). Check your connection or the server URL in Settings.")
        }
        guard let http = resp as? HTTPURLResponse else { throw APIError(status: 0, message: "No response from the server.") }
        guard (200..<300).contains(http.statusCode) else {
            struct ErrBody: Decodable { let error: String?; let message: String? }
            let b = try? JSONDecoder().decode(ErrBody.self, from: data)
            if http.statusCode == 401 && token != nil && !path.hasPrefix("/api/auth/") { signOutLocal() }
            throw APIError(status: http.statusCode, message: b?.error ?? b?.message ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode).capitalized)
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

    func requestPasswordReset(email: String) async throws {
        try await raw("POST", "/api/auth/request-password-reset", ["email": email, "redirectTo": baseURL + "/reset-password"])
    }

    private func adopt(_ http: HTTPURLResponse) async throws {
        guard let t = http.value(forHTTPHeaderField: "set-auth-token"), !t.isEmpty else {
            throw APIError(status: 0, message: "The server didn't return a session token. Is it an IELTS Practice server?")
        }
        token = t
        Keychain.set(t)
        try await loadMe()
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
