import Foundation

/// Demo mode for screenshots and offline previews. Launch with `-demo` (and optionally `-screen <name>`, `-tab <name>`):
/// every request is answered from the bundled synthetic `fixtures.json` (scripts/gen-demo-fixtures.mjs), nothing hits the network.
enum Demo {
    static let args = ProcessInfo.processInfo.arguments
    static let on = args.contains("-demo")
    static func arg(_ name: String) -> String? {
        guard let i = args.firstIndex(of: "-\(name)"), i + 1 < args.count else { return nil }
        return args[i + 1]
    }
    static var screen: String? { on ? arg("screen") : nil }
    /// Signed-out states: `login`, and every `guest-*` screen (guest-home, guest-speaking, guest-writing, guest-review, guest-settings, guest-session, guest-signin-sheet).
    static var isGuest: Bool { screen == "login" || screen?.hasPrefix("guest") == true }
    /// A guest who already has a session (and a result to look at); the other guest screens have none until they start a test.
    static var hasGuestSession: Bool { screen == "guest-result" || screen?.hasPrefix("guest-recent") == true }

    /// `-screen` → which tab opens, and what is pushed onto the Home stack.
    static var initialTab: Int { ["speaking": 1, "writing": 2, "review": 3, "settings": 4, "guest-speaking": 1, "guest-writing": 2, "guest-recent-writing": 2, "guest-recent-speaking": 1, "guest-review": 3, "guest-settings": 4, "keys-settings": 4][screen ?? ""] ?? 0 }
    @MainActor static var initialPath: [Route] {
        switch screen {
        case "bank": [.bank(skill: "speaking")]
        case "history": [.history(skill: nil)]
        case "mistakes", "mistakes-spelling": [.mistakes(category: nil)]
        case "result-speaking": [.result(["as1"])]
        case "result-writing": [.result(["aw1"])]
        case "result-session": [.result(["as1", "as2"])]
        case "result-analysing": [.result(["as3"])]
        case "result-failed": [.result(["as4"])]
        case "result-nospeech": [.result(["as5"])]
        case "session", "guest-session": [.speaking(.part(2))]
        case "session-p1": [.speaking(.part(1))]
        case "editor": [.writing(.task2)]
        case "editor-t1": [.writing(.task1(variant: "academic"))]
        case "editor-full": [.writing(.full(variant: "academic"))]
        case "live", "live-locked", "guest-live-locked": [.live]
        case "fair-use", "guest-fair-use", "quota-exhausted", "guest-quota-exhausted", "balance-exhausted": [.speaking(.full)]
        case "writing-quota-exhausted": [.writing(.task2)]
        case "guest-result": [.result(["as1"])]
        case "guest-recent-lr": [.lrHub(skill: "reading")]
        case "lr-hub", "lr-mode", "lr-hub-todo": [.lrHub(skill: "reading")]
        case "lr-hub-listening": [.lrHub(skill: "listening")]
        case "lr-reading", "lr-reading-questions", "lr-reading-p2", "lr-navigator", "lr-submit": [.lrAttempt(id: "lra-r")]
        case "lr-listening": [.lrAttempt(id: "lra-l")]
        case "lr-listening-exam": [.lrAttempt(id: "lra-le")]
        case "lr-result", "lr-result-p2", "lr-result-detail", "lr-result-evidence", "lr-result-pacing", "lr-result-answers", "lr-result-passage": [.lrAttempt(id: "lra-rs")]
        case "lr-result-listening", "lr-result-detail-listening", "lr-result-transcript", "lr-result-timestamps", "lr-dictation": [.lrAttempt(id: "lra-ls")]
        default: []
        }
    }

    static let fixtures: [String: Data] = {
        guard let url = Bundle.main.url(forResource: "fixtures", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return dict.compactMapValues { try? JSONSerialization.data(withJSONObject: $0, options: [.fragmentsAllowed]) }
    }()
}

/// Answers every request from `Demo.fixtures`: exact "path?sorted-query" first, then the bare path. Writes succeed with `{}`.
final class DemoURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let url = request.url!
        var status = 200
        var body = Data("{}".utf8)
        if request.httpMethod == "GET" || request.httpMethod == nil {
            let items = (URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []).sorted { $0.name < $1.name }
            let query = items.compactMap { i in i.value.map { "\(i.name)=\($0)" } }.joined(separator: "&")
            // Screen-specific answers first ("/api/quota#quota-exhausted", "#guest" for every guest-* screen), then the plain one.
            let full = query.isEmpty ? url.path : "\(url.path)?\(query)"
            let screen = Demo.screen ?? ""
            let keys = ["\(full)#\(screen)", "\(url.path)#\(screen)"] + (Demo.isGuest ? ["\(url.path)#guest"] : []) + [full, url.path]
            if let d = keys.lazy.compactMap({ Demo.fixtures[$0] }).first { body = Self.fillDates(d) } else { status = 404 }
        } else if let d = Demo.fixtures["\(request.httpMethod ?? "") \(url.path)"] {
            body = d // mutations with a canned answer ("POST /api/lr/attempts/x/submit"); every other write succeeds with {}
        }
        let resp = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json", "set-auth-token": "demo"])!
        client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    /// Quota resets move with the clock: "@@DAY@@" is the next 00:00 UTC, "@@WEEK@@" the next Monday 00:00 UTC.
    static func fillDates(_ data: Data) -> Data {
        guard var s = String(data: data, encoding: .utf8), s.contains("@@") else { return data }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let now = Date()
        let day = cal.nextDate(after: now, matching: DateComponents(hour: 0, minute: 0), matchingPolicy: .nextTime)!
        let week = cal.nextDate(after: now, matching: DateComponents(hour: 0, minute: 0, weekday: 2), matchingPolicy: .nextTime)!
        let f = ISO8601DateFormatter()
        s = s.replacingOccurrences(of: "@@DAY@@", with: f.string(from: day)).replacingOccurrences(of: "@@WEEK@@", with: f.string(from: week))
        return Data(s.utf8)
    }
}
