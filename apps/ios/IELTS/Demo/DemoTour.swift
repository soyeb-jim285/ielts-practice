import SwiftUI
import UIKit
import Darwin

/// Demo-only auto-tour for screen recordings: `-demo -screen <name> -tour <script>` scripts scrolling, tab switches, typing and playback
/// with timers so a simulator video has real motion (the simulator can't be tapped from the CLI). It waits for a go signal
/// (`notifyutil -p com.soyeb.ielts.tourgo` or the file /tmp/ielts-tour-go) so recording can start first, and starts by itself after 20 s.
/// DEBUG builds only: a Release build compiles the stubs at the bottom and never runs a tour.
extension View {
    /// Runs `handle` for each tour event. Events are only ever posted by `DemoTour`, so this is inert for real users.
    func onDemoTour(_ handle: @escaping (String) -> Void) -> some View {
        #if DEBUG
        return onReceive(NotificationCenter.default.publisher(for: DemoTour.note)) { n in
            if let s = n.object as? String { handle(s) }
        }
        #else
        return self
        #endif
    }
}

#if DEBUG
enum DemoTour {
    static let note = Notification.Name("ielts.demo.tour")
    static let name: String? = Demo.on ? Demo.arg("tour") : nil
}

private enum Target { case top, bottom, by(Double) }
private enum Step { case send(String), scroll(Target, Double), focus, type(String, String) }

@MainActor
extension DemoTour {
    private static var armed = false
    private static var started = false
    private static var scroller: Scroller?

    static func arm() {
        guard let name, !armed else { return }
        armed = true
        var token: Int32 = 0
        notify_register_dispatch("com.soyeb.ielts.tourgo", &token, .main) { _ in Task { @MainActor in go(name) } }
        Task { @MainActor in
            for _ in 0..<200 {
                if started { return }
                if FileManager.default.fileExists(atPath: "/tmp/ielts-tour-go") { go(name); return }
                try? await Task.sleep(for: .milliseconds(100))
            }
            go(name)
        }
    }

    private static func go(_ name: String) {
        guard !started else { return }
        started = true
        Task { @MainActor in await run(script(name)) }
    }

    static func send(_ s: String) { NotificationCenter.default.post(name: note, object: s) }

    private static func run(_ steps: [(Double, Step)]) async {
        let t0 = Date()
        for (at, step) in steps {
            let wait = at - Date().timeIntervalSince(t0)
            if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
            switch step {
            case let .send(s): send(s)
            case let .scroll(to, dur): scroll(to, dur)
            case .focus: focusEditor()
            case let .type(prefix, text): Task { @MainActor in await typeOut(prefix, text) }
            }
        }
    }

    /// Two characters every 50 ms (about 40 characters a second), as `<prefix><chars>` events.
    private static func typeOut(_ prefix: String, _ text: String) async {
        var i = text.startIndex
        while i < text.endIndex {
            let j = text.index(i, offsetBy: 2, limitedBy: text.endIndex) ?? text.endIndex
            send(prefix + String(text[i..<j]))
            i = j
            try? await Task.sleep(for: .milliseconds(50))
        }
    }

    private static let essay = "In my opinion, working from home benefits both sides, provided it is organised well. Employees gain flexibility: they can plan the day around their own energy and save the hours lost in traffic. Employers, in turn, often see steadier output and lower office costs. However, remote work can be lonely, and junior staff learn more slowly when they cannot watch colleagues at work. For this reason, I believe a hybrid pattern, with two or three days together in the office, is the most sensible compromise."
    private static let notes = "- a novel I read at university\n- about the history of humankind\n- changed how I see progress\n- still recommend it to friends"

    private static func script(_ name: String) -> [(Double, Step)] {
        switch name {
        case "scroll":
            return [(1.0, .scroll(.bottom, 9))]
        case "gentle":
            return [(1.0, .scroll(.by(700), 7))]
        case "tabs":
            var s: [(Double, Step)] = [(0.6, .scroll(.by(450), 1.8))]
            for k in 0..<4 {
                let t = 2.8 + Double(k) * 2.6
                s.append((t, .send("tab:next")))
                s.append((t + 0.15, .scroll(.top, 0)))
                s.append((t + 0.5, .scroll(.by(450), 1.9)))
            }
            return s
        case "karaoke":
            return [(0.4, .scroll(.by(380), 1.2)), (1.8, .send("play:4:1.6")), (2.2, .scroll(.by(300), 9))]
        case "fluency":
            return [(0.4, .scroll(.by(260), 1.2)), (1.8, .send("play:3:2.2"))]
        case "typing":
            return [(1.0, .focus), (1.6, .type("t:", essay))]
        case "session":
            return [(1.0, .send("prep")), (1.8, .type("n:", notes)), (7.5, .send("record"))]
        case "session1":
            return [(1.0, .send("record")), (9.0, .send("next"))]
        case "fairuse":
            return [(3.5, .send("start"))]
        default:
            return []
        }
    }

    /// Plays a silent track of the answer's length through the real `Player` so the karaoke highlight, the audio bar and the chart playhead move.
    /// `arg` is "start:speed" (answer seconds, playback speed). The clock is driven by seeks, so it also advances on a runner with no audio device.
    static func playback(_ player: Player, end: Double, arg: String) {
        let p = arg.split(separator: ":").compactMap { Double($0) }
        let start = p.first ?? 0, speed = p.count > 1 ? p[1] : 1
        guard (try? player.load(silence(seconds: end + 2))) != nil else { return }
        player.seek(to: start, play: true)
        Task { @MainActor in
            let t0 = Date()
            while true {
                let t = start + Date().timeIntervalSince(t0) * speed
                if t >= end { player.pause(); return }
                player.seek(to: t, play: false)
                try? await Task.sleep(for: .milliseconds(100))
            }
        }
    }

    private static func silence(seconds: Double) -> Data {
        let rate = 8000, n = Int(seconds * Double(rate))
        var d = Data()
        func u32(_ v: Int) { var x = UInt32(v).littleEndian; d.append(Data(bytes: &x, count: 4)) }
        func u16(_ v: Int) { var x = UInt16(v).littleEndian; d.append(Data(bytes: &x, count: 2)) }
        d.append(Data("RIFF".utf8)); u32(36 + n * 2); d.append(Data("WAVEfmt ".utf8)); u32(16); u16(1); u16(1); u32(rate); u32(rate * 2); u16(2); u16(16)
        d.append(Data("data".utf8)); u32(n * 2); d.append(Data(count: n * 2))
        return d
    }

    // MARK: UIKit helpers (the SwiftUI scroll views and the exam editor are UIScrollView / UITextView underneath)

    private static func topView() -> UIView? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first,
              let window = scene.windows.first(where: \.isKeyWindow) ?? scene.windows.first,
              var vc = window.rootViewController else { return nil }
        while let p = vc.presentedViewController { vc = p } // a sheet, when one is up
        return vc.view
    }

    private static func mainScrollView() -> UIScrollView? {
        guard let root = topView() else { return nil }
        var best: UIScrollView?
        var area: CGFloat = 0
        func walk(_ v: UIView) {
            if v.isHidden || v.alpha < 0.01 { return }
            if let s = v as? UIScrollView, s.isScrollEnabled, s.window != nil, s.contentSize.height > s.bounds.height + 1,
               s.contentSize.width <= s.bounds.width + 1, s.bounds.width * s.bounds.height > area {
                best = s
                area = s.bounds.width * s.bounds.height
            }
            v.subviews.forEach(walk)
        }
        walk(root)
        return best
    }

    private static func scroll(_ to: Target, _ dur: Double) {
        guard let sv = mainScrollView() else { return }
        scroller?.stop()
        scroller = Scroller(sv, to, dur)
    }

    private static func focusEditor() {
        guard let root = topView() else { return }
        func find(_ v: UIView) -> UITextView? {
            if let t = v as? UITextView, t.isEditable, !v.isHidden, t.window != nil { return t }
            for s in v.subviews { if let f = find(s) { return f } }
            return nil
        }
        _ = find(root)?.becomeFirstResponder()
    }

    /// Eased scroll, one step per display frame; the end is re-read each frame because lazy content grows as it scrolls.
    @MainActor
    private final class Scroller: NSObject {
        private let sv: UIScrollView
        private let to: Target
        private let dur: Double
        private let from: CGFloat
        private let t0 = CACurrentMediaTime()
        private var link: CADisplayLink?

        init(_ sv: UIScrollView, _ to: Target, _ dur: Double) {
            self.sv = sv
            self.to = to
            self.dur = dur
            from = sv.contentOffset.y
            super.init()
            if dur <= 0 {
                apply(1)
            } else {
                link = CADisplayLink(target: self, selector: #selector(tick))
                link?.add(to: .main, forMode: .common)
            }
        }

        @objc private func tick() {
            let p = min(1, (CACurrentMediaTime() - t0) / dur)
            apply(p)
            if p >= 1 { stop() }
        }

        func stop() {
            link?.invalidate()
            link = nil
        }

        private func apply(_ p: Double) {
            let e = CGFloat(p * p * (3 - 2 * p))
            let lo = -sv.adjustedContentInset.top
            let hi = max(lo, sv.contentSize.height - sv.bounds.height + sv.adjustedContentInset.bottom)
            let end: CGFloat
            switch to {
            case .top: end = lo
            case .bottom: end = hi
            case let .by(dy): end = min(max(from + CGFloat(dy), lo), hi)
            }
            sv.contentOffset.y = from + (end - from) * e
        }
    }
}
#else
enum DemoTour {
    static let name: String? = nil
    static func arm() {}
    @MainActor static func playback(_ player: Player, end: Double, arg: String) {}
}
#endif
