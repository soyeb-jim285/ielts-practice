import SwiftUI
import UIKit

/// Demo-only auto-tour for screen recordings: `-demo -screen <name> -tour <script>` scripts taps, scrolling, typing and playback
/// with timers so a simulator video has real motion (the simulator can't be tapped from the CLI). It waits for a go signal
/// (`notifyutil -p com.soyeb.ielts.tourgo` or the file /tmp/ielts-tour-go) so recording can start first, and starts by itself after 20 s.
/// A scripted tap is "press:<id>": the control marked `.demoPress(id)` shows a touch and runs its action.
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

    /// Tour event "press:<id>": a touch shows on this control, then `action` runs (what a tap on it does), so a scripted tap reads on video.
    @ViewBuilder func demoPress(_ id: String, _ action: @escaping () -> Void = {}) -> some View {
        #if DEBUG
        if DemoTour.name != nil { modifier(DemoPress(id: id, action: action)) } else { self }
        #else
        self
        #endif
    }
}

/// During a tour, one corner pixel changes every frame: `simctl io recordVideo` only writes a frame when the screen changes, so without it
/// still moments are dropped and the clip's timing collapses. Nothing at all outside a tour.
struct DemoHeartbeat: View {
    var body: some View {
        #if DEBUG
        if DemoTour.name != nil {
            TimelineView(.animation) { ctx in
                Color.black.opacity(Int(ctx.date.timeIntervalSinceReferenceDate * 60) % 2 == 0 ? 0.02 : 0.04)
                    .frame(width: 1, height: 1)
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .ignoresSafeArea()
        }
        #endif
    }
}

#if DEBUG
/// A finger-sized touch over the control and a slight press, like the simulator's "show touches".
private struct DemoPress: ViewModifier {
    let id: String
    let action: () -> Void
    @State private var down = false

    func body(content: Content) -> some View {
        content
            .scaleEffect(down ? 0.96 : 1)
            .overlay {
                Circle()
                    .fill(Color.gray.opacity(0.4))
                    .overlay(Circle().strokeBorder(Color.white.opacity(0.85), lineWidth: 2))
                    .frame(width: 46, height: 46)
                    .scaleEffect(down ? 1 : 0.5)
                    .opacity(down ? 1 : 0)
                    .allowsHitTesting(false)
            }
            .animation(.easeOut(duration: 0.16), value: down)
            .onDemoTour { s in
                guard s == "press:\(id)" else { return }
                down = true
                Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(240))
                    action()
                    try? await Task.sleep(for: .milliseconds(160))
                    down = false
                }
            }
    }
}

enum DemoTour {
    static let note = Notification.Name("ielts.demo.tour")
    static let name: String? = Demo.on ? Demo.arg("tour") : nil
}

private enum Target { case top, bottom, by(Double) }
/// `type(prefix, text, cps)` sends the text as "<prefix><chars>" events at `cps` characters a second.
private enum Step { case send(String), scroll(Target, Double), focus, type(String, String, Double) }

@MainActor
extension DemoTour {
    private static var armed = false
    private static var started = false
    private static var scroller: Scroller?

    static func arm() {
        guard let name, !armed else { return }
        armed = true
        CFNotificationCenterAddObserver(CFNotificationCenterGetDarwinNotifyCenter(), nil, { _, _, _, _, _ in
            Task { @MainActor in if let n = DemoTour.name { DemoTour.go(n) } }
        }, "com.soyeb.ielts.tourgo" as CFString, nil, .deliverImmediately)
        Task { @MainActor in
            for _ in 0..<200 {
                if started { return }
                if FileManager.default.fileExists(atPath: "/tmp/ielts-tour-go") { go(name); return }
                try? await Task.sleep(for: .milliseconds(100))
            }
            go(name)
        }
    }

    fileprivate static func go(_ name: String) {
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
            case let .type(prefix, text, cps): Task { @MainActor in await typeOut(prefix, text, cps) }
            }
        }
    }

    /// Paced by the clock, not per event: when a slow render delays an event, the next one carries the characters that are due.
    private static func typeOut(_ prefix: String, _ text: String, _ cps: Double) async {
        let chars = Array(text), t0 = Date()
        var sent = 0
        while sent < chars.count {
            try? await Task.sleep(for: .seconds(1 / cps))
            let due = min(chars.count, Int(Date().timeIntervalSince(t0) * cps) + 1)
            if due > sent { send(prefix + String(chars[sent..<due])); sent = due }
        }
    }

    private static let task2 = "In many fast-growing cities, traffic has become one of the biggest problems of daily life. Some people argue that governments should invest in public transport instead of building more roads. I completely agree with this view, because new roads only offer a short-term solution, while good public transport benefits the whole society."
    private static let task1 = "The line graph compares the share of electricity generated from renewable sources in Denmark, Spain and Japan between 2000 and 2020. Overall, all three countries relied more on renewables."
    private static let notes = "- swimming, started at 24\n- club near my office\n- breathing = hardest part\n- 5 months: first length!"

    private static func press(_ id: String) -> Step { .send("press:\(id)") }

    /// Times are seconds after the go signal. ios-video.sh keeps about `dur - 1` seconds of them, so every script settles before then.
    private static func script(_ name: String) -> [(Double, Step)] {
        switch name {
        case "scroll": return [(1.0, .scroll(.bottom, 9))]
        case "gentle": return [(1.0, .scroll(.by(700), 7))]
        // Home: next step, predicted bands, the band-by-criterion trend (speaking, then writing), Listening and Reading.
        case "dashboard":
            return [(1.0, .scroll(.by(560), 3.2)), (5.2, .send("dash:writing")), (7.2, .scroll(.by(620), 3.4))]
        // Speaking hub: questions from our own bank, then the ways to practise.
        case "speaking-hub":
            return [(1.2, .send("src:cambridge")), (3.4, .send("src:generated")), (5.0, .scroll(.by(720), 4.2))]
        // Part 1: the examiner reads each question (heard, not shown), then "Speak now", the timer, waveform and live pace.
        case "speaking-part1":
            return [(0.8, press("record")), (6.6, press("showq")), (9.0, press("next"))]
        // Part 2: cue card, a minute of preparation with notes, then the long turn.
        case "speaking-part2":
            return [(1.2, press("prep")), (2.2, .type("n:", notes, 16)), (8.4, press("speak")), (10.2, .scroll(.by(320), 1.6))]
        case "result-overview":
            return [(1.0, .scroll(.by(380), 2.6)), (4.6, .scroll(.by(520), 3.0)), (8.6, .scroll(.by(480), 3.0))]
        // Transcript: playback lights each word; pauses, fillers, repeats and restarts are marked inline.
        case "transcript":
            return [(0.6, .scroll(.by(300), 1.2)), (2.0, .send("play:4:1.4")), (2.4, .scroll(.by(330), 9.5))]
        case "fluency":
            return [(0.5, .scroll(.by(260), 1.2)), (2.0, .send("play:3:2.2")), (5.6, .scroll(.by(420), 4.0))]
        case "language-improve":
            return [(1.0, .scroll(.by(650), 4.0)), (5.6, .scroll(.top, 1.0)), (7.0, press("tab:Improve")), (8.6, .scroll(.by(420), 3.0))]
        case "live":
            return [(1.2, press("livestart")), (3.4, press("captions"))]
        case "task1":
            return [(1.0, .scroll(.by(300), 2.2)), (4.6, .scroll(.top, 1.0)), (6.0, .focus), (6.6, .type("t:", task1, 32))]
        case "task2":
            return [(1.0, .focus), (1.6, .type("t:", task2, 36))]
        case "writing-overview":
            return [(1.0, .scroll(.by(420), 2.8)), (4.6, .scroll(.by(520), 3.0)), (8.4, .scroll(.by(400), 2.4))]
        // Essay: mistakes underlined in place; one opens with its correction and reason.
        case "essay":
            return [(1.0, .scroll(.by(260), 2.0)), (4.0, .send("res:err:w1")), (8.0, .send("res:close")), (9.2, .scroll(.by(380), 2.6))]
        case "rewrite":
            return [(1.0, .scroll(.by(300), 2.2)), (4.0, .scroll(.by(420), 3.2)), (7.8, .scroll(.by(380), 2.6)), (11.0, .send("res:clean"))]
        // Listening practice: the recording plays while the form fills in, including the two-blank question 3.
        case "lr-run":
            return [(1.0, press("lrplay")), (1.8, .scroll(.by(230), 1.2)), (3.4, .type("g:2:0:1:", "Thursday", 12)), (4.8, .type("g:3:0:2:", "6.30", 8)),
                    (6.0, .type("g:3:1:2:", "8.30", 8)), (7.4, .type("g:4:0:1:", "85", 6)), (8.8, .send("lr:clear")), (9.4, .scroll(.by(360), 2.6))]
        case "lr-answers":
            return [(1.4, press("mistakes")), (3.2, .scroll(.by(260), 1.6)), (5.4, press("row:5")), (9.0, .scroll(.by(240), 2.0))]
        // Play from the moment the answer is spoken: the transcript with the evidence marked and Q pins.
        case "lr-timestamp":
            return [(1.2, press("mistakes")), (2.8, .scroll(.by(260), 1.4)), (4.8, press("ts:8")), (6.2, .send("lrr:show")), (9.4, press("qtimes"))]
        case "lr-dictation":
            return [(1.2, press("mistakes")), (2.6, .scroll(.by(420), 1.8)), (5.0, press("row:28")), (7.0, press("dictate")), (8.4, press("dplay")),
                    (9.6, .type("dt:", "record the wait of each hive every week", 22)), (12.0, press("dcheck"))]
        case "reading-run":
            return [(1.0, .scroll(.by(520), 3.4)), (5.0, .send("lr:questions")), (6.2, .scroll(.by(330), 1.4)), (8.0, press("a:4:FALSE")),
                    (9.4, press("a:5:NOT GIVEN")), (10.8, press("a:6:FALSE"))]
        // Reading result: why the answer is wrong, then where the answer is in the passage.
        case "reading-location":
            return [(1.4, press("row:5")), (5.6, press("show"))]
        // Hub: an unfinished attempt offers Continue or Start new; then Practice, Part 2 only.
        case "single-part":
            return [(1.2, press("test:lt-l2")), (3.2, press("startnew")), (4.8, press("mode:practice")), (6.2, .send("part:2")), (7.8, press("start")), (10.8, press("lrplay"))]
        case "review":
            return [(1.4, press("hear")), (3.4, press("reveal")), (5.6, press("grade:4")), (7.6, press("reveal")), (9.8, press("grade:5"))]
        case "history":
            return [(1.0, .scroll(.by(700), 4.0)), (5.6, .scroll(.top, 1.4)), (7.6, .send("hist:listening"))]
        case "bank":
            return [(1.0, .scroll(.by(520), 3.0)), (4.4, .scroll(.top, 1.2)), (6.0, .send("bank:src:generated")), (7.6, .send("bank:part:2"))]
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
