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

    /// `-screen` → which tab opens, and what is pushed onto the Home stack.
    static var initialTab: Int { ["speaking": 1, "writing": 2, "review": 3, "settings": 4, "guest-speaking": 1, "guest-writing": 2, "guest-review": 3, "guest-settings": 4][screen ?? ""] ?? 0 }
    @MainActor static var initialPath: [Route] {
        switch screen {
        case "bank": [.bank(skill: "speaking")]
        case "history": [.history(skill: nil)]
        case "mistakes": [.mistakes(category: nil)]
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
        case "live": [.live]
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
            if let d = Demo.fixtures[query.isEmpty ? url.path : "\(url.path)?\(query)"] ?? Demo.fixtures[url.path] { body = d } else { status = 404 }
        }
        let resp = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json", "set-auth-token": "demo"])!
        client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
