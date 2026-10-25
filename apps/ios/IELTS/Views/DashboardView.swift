import Charts
import SwiftUI

/// Dashboard payload (GET /api/progress). Local to this screen so it can read fields (`skill`, `part`, `lastFailed`) the shared
/// ProgressData does not carry; everything beyond the original contract is optional so older servers and demo fixtures still decode.
private struct DashProgress: Decodable {
    struct Point: Decodable {
        let attemptId: String?
        let date: String?
        let skill: String?
        let part: Int?
        let overall: Double?
        let criteria: [String: Double]
    }
    struct Weakest: Decodable { let key: String; let avg: Double; let skill: String? }
    struct Failed: Decodable { let id: String; let skill: String }
    let trend: [Point]
    let streak: Int
    let minutesThisWeek: Double
    let attempts: Int
    let weakest: Weakest?
    let topMistakes: [ProgressData.CategoryCount]
    let predicted: ProgressData.Predicted
    let lastFailed: Failed?
}

/// Where to practise each criterion when the user has no scored attempts to tell us where they are weakest (web criteria.ts PRACTICE).
private let practiceDefault: [String: (skill: String, part: Int)] = [
    "fc": ("speaking", 2), "gra": ("speaking", 2), "lr": ("speaking", 2), "p": ("speaking", 1), "ta": ("writing", 2), "cc": ("writing", 2),
]
private let criterionShort = ["fc": "Fluency", "gra": "Grammar", "lr": "Vocabulary", "p": "Pronunciation", "ta": "Task response", "cc": "Coherence"]
private let skillOrder = ["listening", "reading", "writing", "speaking"]
private let skillIcon = ["listening": "headphones", "reading": "book", "writing": "pencil.line", "speaking": "mic"]
private let mockDuration = ["listening": "30 min plus review", "reading": "60 min", "writing": "60 min", "speaking": "11-14 min"]

/// Midnight to 5am is "Hello": nobody wants "Good evening" at 3am (web greeting).
private func greeting(_ date: Date = Date()) -> String {
    let h = Calendar.current.component(.hour, from: date)
    return h < 5 ? "Hello" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"
}

/// Track with a fill and an optional target tick (web BandMeter / ProgressBar).
private struct BandBar: View {
    let value: Double // 0...1
    var marker: Double? // 0...1
    var fill: Color = .brand
    var height: CGFloat = 8
    let label: String

    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.surface2)
                Capsule().fill(fill).frame(width: max(0, min(1, value)) * g.size.width)
                if let marker {
                    Capsule().fill(Color.ink).frame(width: 2, height: height + 8)
                        .offset(x: min(max(marker * g.size.width - 1, 0), max(0, g.size.width - 2)))
                }
            }
        }
        .frame(height: height)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }
}

/// Signed-in Home (web routes/_app/index.tsx): your picture (overall estimate and the four skills), next up, the mock, practise,
/// progress in five tabs, and what to fix next.
struct DashboardView: View {
    @Environment(APIClient.self) private var api
    @State private var progress: DashProgress?
    @State private var due: DueResponse?
    @State private var lr: LrProgress?
    @State private var mock: MockExam?
    @State private var lastMock: MockExam?
    @State private var progressTab = Demo.screen == "dashboard-lr" ? "listening" : "overall"
    @State private var lrBusy = false
    @State private var lrPick: LrTestItem?
    @State private var lrStarted: String?
    @State private var error: String?
    @State private var targetDraft = 7.0

    private var target: Double { api.me?.settings.targetBand ?? 7 }

    var body: some View {
        ScrollViewReader { proxy in
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                if let p = progress {
                    header(p)
                    if let f = p.lastFailed { failedAlert(f) }
                    yourPicture(p)
                    if p.attempts == 0 { onboarding } else { nextUp(p) }
                    mockPanel(continuedAbove: p.attempts > 0)
                    practiseList
                    if !p.trend.isEmpty || !(lr?.trend.isEmpty ?? true) { progressTabs(p).id("progress") }
                    if !p.topMistakes.isEmpty { fixNext(p.topMistakes) }
                } else if let error {
                    ContentUnavailableView {
                        Label("Couldn't load your dashboard", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Try again") { Task { await load() } }.primaryButton()
                    }
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 80)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .demoScroll()
        .task(id: lr?.trend.count) { // demo: bring the Listening progress tab into view
            if Demo.screen == "dashboard-lr", lr != nil { try? await Task.sleep(for: .milliseconds(600)); proxy.scrollTo("progress", anchor: .top) }
        }
        }
        .background(Color.canvas)
        .navigationTitle("Home")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load(); await api.loadQuota(force: true) }
        .task { await load() }
        .task { await api.loadQuota() }
        .onAppear { targetDraft = target }
        .navigationDestination(item: $lrStarted) { LrAttemptScreen(id: $0) }
        .sheet(item: $lrPick) { t in
            LrModeSheet(test: t) { lrStarted = $0 }
                .presentationDetents([.height(540), .large])
                .presentationDragIndicator(.visible)
        }
    }

    private func load() async {
        do {
            async let p: DashProgress = api.get("/api/progress")
            async let d: DueResponse = api.get("/api/cards/due")
            async let l: LrProgress = api.get("/api/lr/progress")
            async let open = api.mockCurrent()
            async let mocks = api.mockList()
            progress = try await p
            due = try? await d
            lr = try? await l
            mock = try? await open
            lastMock = (try? await mocks)?.first { $0.overall != nil }
            error = nil
        } catch is CancellationError {
        } catch {
            if progress == nil { self.error = error.localizedDescription }
        }
    }

    /// The suggested Listening or Reading test opens the same Exam/Practice and part choice as the hub; it starts practice directly
    /// only if the test is no longer listed.
    private func startLr(_ s: LrProgress.Suggested) async {
        lrBusy = true
        defer { lrBusy = false }
        struct R: Decodable { let items: [LrTestItem] }
        if let r: R = try? await api.get("/api/lr/tests", query: ["skill": s.skill]), let t = r.items.first(where: { $0.id == s.id }) {
            lrPick = t
        } else if let a: LrAttempt = try? await api.send("POST", "/api/lr/tests/\(s.id)/attempts", ["mode": "practice"]) {
            lrStarted = a.id
        }
    }

    // MARK: Header

    private func header(_ p: DashProgress) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            let first = api.me?.user.name.split(separator: " ").first.map(String.init)
            Text(greeting() + (first.map { ", \($0)" } ?? ""))
                .font(.display(.largeTitle, weight: .bold))
                .foregroundStyle(.ink)
                .accessibilityAddTraits(.isHeader)
            if p.attempts > 0 {
                HStack(spacing: 16) {
                    Label(p.streak > 0 ? "\(p.streak) \(p.streak == 1 ? "day" : "days") in a row" : "Practise today to start a streak", systemImage: "flame.fill")
                        .foregroundStyle(p.streak > 0 ? Color.warnText : Color.muted)
                    Text(p.minutesThisWeek < 1 ? "<1 min practised this week" : "\(Int(p.minutesThisWeek)) \(Int(p.minutesThisWeek) == 1 ? "minute" : "minutes") practised this week")
                }
                .font(.subheadline)
                .foregroundStyle(.muted)
            } else {
                Text("Welcome. Here is how to get your first score.").font(.subheadline).foregroundStyle(.muted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func failedAlert(_ f: DashProgress.Failed) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Your last attempt couldn't be scored").font(.headline).foregroundStyle(.ink)
                    Text("Your answer is saved. Open it to retry the analysis.").font(.subheadline).foregroundStyle(.muted)
                }
            } icon: {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.warn)
            }
            NavigationLink(value: Route.result([f.id])) { Text("Open it").frame(minHeight: 28) }
                .secondaryButton()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.warn.opacity(0.12), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    // MARK: Your picture (web YourPicture + SkillBandStrip)

    /// Band points per skill, oldest first: speaking and writing from the progress trend, listening and reading from the L/R trend.
    private func points(_ p: DashProgress, _ skill: String) -> [Double] {
        skill == "speaking" || skill == "writing"
            ? p.trend.filter { $0.skill == skill }.compactMap(\.overall)
            : (lr?.trend ?? []).filter { $0.skill == skill }.map(\.band)
    }

    /// Per-skill average of the last up to 5 results; speaking and writing use the server's predicted band when it has one.
    private func skillBand(_ p: DashProgress, _ skill: String) -> (band: Double?, n: Int) {
        let avg = DashboardMath.averageBand(points(p, skill))
        switch skill {
        case "speaking": return (p.predicted.speaking ?? avg.band, avg.n)
        case "writing": return (p.predicted.writing ?? avg.band, avg.n)
        default: return avg
        }
    }

    private func yourPicture(_ p: DashProgress) -> some View {
        let bands = skillOrder.map { skillBand(p, $0) }
        let overall = DashboardMath.overallEstimate(bands.map(\.band))
        let weak = DashboardMath.weakestSkill(bands.map(\.band))
        return VStack(alignment: .leading, spacing: 16) {
            SectionTitle("Your IELTS picture")
            HStack(alignment: .center, spacing: 20) {
                Text(overall.value.map { fmt($0) } ?? "–")
                    .font(.system(size: 64, weight: .bold, design: .serif).monospacedDigit())
                    .foregroundStyle(overall.value.map { bandTextColor($0, target) } ?? Color.muted)
                    .accessibilityLabel(overall.value.map { "Overall band estimate \(fmt($0))" } ?? "No overall band estimate yet")
                VStack(alignment: .leading, spacing: 4) {
                    Text("Overall band estimate").font(.subheadline).foregroundStyle(.muted)
                    if let v = overall.value {
                        (Text(v >= target ? "At or above" : "\(fmt(target - v)) below").fontWeight(.medium).foregroundStyle(bandTextColor(v, target))
                            + Text(" your \(fmt(target)) target").foregroundStyle(Color.ink))
                            .font(.subheadline)
                        Text("From \(overall.count) of 4 skills, average of your last results").font(.caption).foregroundStyle(.muted)
                    } else {
                        Text("Take two skills to see an overall estimate. Your target is \(fmt(target)).").font(.subheadline).foregroundStyle(.ink)
                    }
                }
            }
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12, alignment: .top), GridItem(.flexible(), spacing: 12, alignment: .top)], spacing: 12) {
                ForEach(Array(skillOrder.enumerated()), id: \.offset) { i, k in
                    skillLink(k) { skillCell(k, bands[i], weakest: weak == i) }
                }
            }
        }
    }

    private func skillCell(_ skill: String, _ b: (band: Double?, n: Int), weakest: Bool) -> some View {
        let name = MockFlow.label(skill)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: skillIcon[skill] ?? "circle").accessibilityHidden(true)
                Text(name)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary).accessibilityHidden(true)
            }
            .font(.subheadline).foregroundStyle(.muted)
            if let band = b.band {
                Text(fmt(band)).font(.system(size: 30, weight: .bold, design: .serif).monospacedDigit()).foregroundStyle(.ink)
                BandBar(value: band / 9, marker: target / 9, fill: bandColor(band, target), height: 6, label: "\(name) band \(fmt(band)), target \(fmt(target))")
            } else {
                Text("Not tried").font(.body).foregroundStyle(.muted).frame(minHeight: 36, alignment: .leading)
            }
            VStack(alignment: .leading, spacing: 2) {
                if weakest { Text("Weakest skill").font(.caption.weight(.medium)).foregroundStyle(Color.warnText) }
                if b.band == nil {
                    Text(skill == "listening" || skill == "reading" ? "Take a free test" : "Take a test").font(.caption).foregroundStyle(Color.brand)
                } else {
                    Text(b.n > 1 ? "average of last \(b.n)" : "latest").font(.caption).foregroundStyle(.muted)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 14)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens \(name)")
    }

    /// Each skill's home: the Listening/Reading hub, or the Speaking/Writing home pushed on this stack (not a tab switch).
    @ViewBuilder private func skillLink<L: View>(_ skill: String, @ViewBuilder _ label: () -> L) -> some View {
        switch skill {
        case "speaking": NavigationLink { SpeakingHomeView() } label: { label() }.buttonStyle(.plain)
        case "writing": NavigationLink { WritingHomeView() } label: { label() }.buttonStyle(.plain)
        default: NavigationLink(value: Route.lrHub(skill: skill)) { label() }.buttonStyle(.plain)
        }
    }

    // MARK: Onboarding (no scored attempts yet)

    private var onboarding: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Get your first band")
            Text("Answer once and every criterion is scored against the public IELTS band descriptors, with each mistake marked where you made it.")
                .font(.subheadline).foregroundStyle(.muted)
            VStack(alignment: .leading, spacing: 12) {
                Image(systemName: "mic.fill").foregroundStyle(.brand).accessibilityHidden(true)
                Text("Speak for four minutes").font(.display(.title2))
                Text("Part 1 is everyday questions. You get fluency, vocabulary, grammar and pronunciation feedback, with your pauses timed.")
                    .font(.subheadline).foregroundStyle(.muted)
                NavigationLink(value: Route.speaking(.part(1))) {
                    Text("Start Speaking Part 1").frame(maxWidth: .infinity, minHeight: 28)
                }
                .primaryButton()
                .controlSize(.large)
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.brandSoft, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            VStack(alignment: .leading, spacing: 12) {
                Image(systemName: "pencil.line").foregroundStyle(.muted).accessibilityHidden(true)
                Text("Or write an essay").font(.display(.title3))
                Text("Task 2, 40 minutes, at least 250 words. Every mistake is underlined in your text with a correction.")
                    .font(.subheadline).foregroundStyle(.muted)
                NavigationLink(value: Route.writing(.task2)) {
                    Text("Start Writing Task 2").frame(maxWidth: .infinity, minHeight: 28)
                }
                .secondaryButton()
                .controlSize(.large)
            }
            .card(padding: 20)
            NavigationLink(value: Route.lrHub(skill: "listening")) {
                Text("Or take a free Listening or Reading test").font(.subheadline.weight(.medium)).foregroundStyle(.brand).underline().frame(minHeight: 44)
            }
            .buttonStyle(.plain)
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Target band").font(.subheadline.weight(.medium))
                    Spacer()
                    Text(fmt(targetDraft)).font(.display(.title3).monospacedDigit()).foregroundStyle(.ink)
                }
                Slider(value: $targetDraft, in: 4...9, step: 0.5) { editing in
                    if !editing { Task { await saveTarget() } }
                }
                .accessibilityLabel("Target band")
                .accessibilityValue(fmt(targetDraft))
                Text("Scores at or above your target band show green. You can change it any time in Settings.")
                    .font(.caption).foregroundStyle(.muted)
            }
            .card()
        }
    }

    private func saveTarget() async {
        guard var s = api.me?.settings, s.targetBand != targetDraft else { return }
        s.targetBand = targetDraft
        do { try await api.saveSettings(s); error = nil } catch is CancellationError {} catch { self.error = error.localizedDescription }
    }

    // MARK: Next up (web NextUp)

    /// The one action the page asks for. Priority: an open mock, then the weakest criterion, then a suggested Listening or Reading test, then a full speaking test.
    private func nextUp(_ p: DashProgress) -> some View {
        let weakest: DashProgress.Weakest? = p.weakest.flatMap { practiceDefault[$0.key] == nil ? nil : $0 }
        let practice = weakest.flatMap { practiceTarget($0.key, p.trend, judgedIn: $0.skill) }
        let partLabel = practice.map { ($0.skill == "speaking" ? "Part " : "Task ") + String($0.part) }
        let avg = weakest.map { ($0.avg * 2).rounded() / 2 } ?? 0
        let suggested = weakest == nil ? lr?.suggested : nil
        let headline: String, lede: String
        if let mock {
            headline = "Continue your mock test"
            lede = "\(nextLine(mock, "Open")). Pick up where you stopped."
        } else if let weakest, let partLabel {
            headline = "\(Crit.label(weakest.key)) is holding your band back"
            lede = "You average \(fmt(avg)) here\(avg < target ? ", \(fmt(target - avg)) below your \(fmt(target)) target" : ""), and your lowest scores came in \(partLabel). Focused practice there moves it fastest."
        } else if let s = suggested {
            headline = "\(s.label) is your weakest question type"
            lede = "\(s.title) has \(s.count) \(s.label.lowercased()) questions. Practising them is the fastest way up."
        } else {
            headline = "Ready for another round?"
            lede = "A full test gives the most complete picture of your band."
        }
        return VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Next up")
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(headline).font(.display(.title2)).foregroundStyle(.ink)
                    Text(lede).font(.subheadline).foregroundStyle(.muted)
                }
                Group {
                    if let mock {
                        NavigationLink(value: Route.mockHub(id: mock.id)) { ctaLabel("Continue") }
                    } else if let weakest, let practice, let partLabel {
                        let route: Route = practice.skill == "writing" ? (practice.part == 1 ? .writing(.task1(variant: "academic")) : .writing(.task2)) : .speaking(.part(practice.part))
                        NavigationLink(value: route) { ctaLabel("Practise \(partLabel) \((criterionShort[weakest.key] ?? "").lowercased())") }
                    } else if let s = suggested {
                        Button { Task { await startLr(s) } } label: {
                            HStack { if lrBusy { ProgressView() }; Text("Practise \(s.label.lowercased())"); Image(systemName: "arrow.right").accessibilityHidden(true) }
                                .frame(maxWidth: .infinity, minHeight: 28)
                        }
                        .disabled(lrBusy)
                    } else {
                        NavigationLink(value: Route.speaking(.full)) { ctaLabel("Start a full speaking test") }
                    }
                }
                .primaryButton()
                .controlSize(.large)
                if let n = due?.dueTotal, n > 0 {
                    NavigationLink(value: Route.review) {
                        Text("Review deck, \(n) \(n == 1 ? "card" : "cards") due").font(.subheadline.weight(.medium)).foregroundStyle(.brand).underline().frame(minHeight: 44)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.brandSoft, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
    }

    private func ctaLabel(_ text: String) -> some View {
        HStack { Text(text); Image(systemName: "arrow.right").accessibilityHidden(true) }.frame(maxWidth: .infinity, minHeight: 28)
    }

    /// Skill, and the part/task where the user's own scores on `key` are lowest (web practiceTarget); `judgedIn` is the skill the criterion came from.
    private func practiceTarget(_ key: String, _ trend: [DashProgress.Point], judgedIn: String?) -> (skill: String, part: Int)? {
        guard let usual = practiceDefault[key] else { return nil }
        let skill = judgedIn ?? usual.skill
        let fallback = skill == usual.skill ? usual.part : skill == "speaking" ? 1 : 2
        var byPart: [Int: [Double]] = [:]
        for t in trend where t.skill == skill {
            if let v = t.criteria[key], let part = t.part { byPart[part, default: []].append(v) }
        }
        let mean = { (a: [Double]) in a.reduce(0, +) / Double(max(1, a.count)) }
        let best = byPart.min { a, b in
            let (ma, mb) = (mean(a.value), mean(b.value))
            return ma != mb ? ma < mb : a.key < b.key
        }
        return (skill, best?.key ?? fallback)
    }

    // MARK: Full mock test (web MockPanel)

    /// What the mock is, the four steps, one button. With an open mock that Next up already continues, only the steps.
    private func mockPanel(continuedAbove: Bool) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionTitle("Full mock test")
            if !(mock != nil && continuedAbove) {
                Text(mock.map { "Continue: \(nextLine($0, "open")). Pick up where you stopped." } ?? "Listening, Reading, Writing and Speaking in one sitting, with an overall band.")
                    .font(.subheadline).foregroundStyle(.ink)
                NavigationLink(value: mock.map { Route.mockHub(id: $0.id) } ?? Route.mock) {
                    HStack { Text(mock == nil ? "Start a mock test" : "Continue"); Image(systemName: "arrow.right").accessibilityHidden(true) }.frame(maxWidth: .infinity, minHeight: 28)
                }
                .secondaryButton().controlSize(.large)
            }
            LazyVGrid(columns: [GridItem(.flexible(), alignment: .topLeading), GridItem(.flexible(), alignment: .topLeading)], alignment: .leading, spacing: 14) {
                ForEach(skillOrder, id: \.self) { k in mockStep(k) }
            }
            if let last = lastMock, let band = last.overall {
                NavigationLink(value: Route.mockHub(id: last.id)) {
                    (Text("Last mock: ").foregroundStyle(.muted) + Text("\(fmt(band)) on \(ShellDate.date(last.completedAt ?? last.startedAt))").fontWeight(.medium).foregroundStyle(Color.brand))
                        .font(.subheadline.monospacedDigit()).frame(minHeight: 44)
                }
                .buttonStyle(.plain)
            }
        }
        .card()
    }

    /// "Writing next", or `fallback` when the server names no next section.
    private func nextLine(_ m: MockExam, _ fallback: String) -> String { m.next.map { "\(MockFlow.label($0)) next" } ?? fallback }

    private func mockStep(_ skill: String) -> some View {
        let s = mock?.section(skill)
        let step = mock == nil ? "todo" : s.map(MockFlow.isFinished) == true ? "done" : mock?.next == skill ? "next" : "todo"
        let word = ["done": "Done", "next": "Next", "todo": "To do"][step] ?? ""
        return VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Image(systemName: step == "done" ? "checkmark.circle.fill" : step == "next" ? "smallcircle.filled.circle" : "circle").accessibilityHidden(true)
                Text(MockFlow.label(skill)).font(.headline)
                if mock != nil { Text(word).font(.caption).foregroundStyle(.muted) }
            }
            .foregroundStyle(step == "next" ? Color.brand : Color.ink)
            Text(mockDuration[skill] ?? "").font(.caption).foregroundStyle(.muted).padding(.leading, 24)
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: Practise (web PractiseList)

    private var practiseList: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionTitle("Practise").padding(.bottom, 4)
            practiseRow("Listening", "Free practice tests, 40 questions, or one part at a time", "headphones", left: nil) { l in NavigationLink(value: Route.lrHub(skill: "listening")) { l } }
            Divider()
            practiseRow("Reading", "Free practice tests, 40 questions, or one passage", "book", left: nil) { l in NavigationLink(value: Route.lrHub(skill: "reading")) { l } }
            Divider()
            practiseRow("Writing", "Task 1 and Task 2, feedback by criterion. A Task 2 essay is 40 min, at least 250 words", "pencil.line", left: api.quota?.writing) { l in NavigationLink { WritingHomeView() } label: { l } }
            Divider()
            practiseRow("Speaking", "Full test 11-14 min, or one part. Live examiner: \(api.quota?.live == false ? "not available right now" : "a spoken conversation with an AI examiner")", "mic", left: api.quota?.speaking) { l in NavigationLink { SpeakingHomeView() } label: { l } }
            Divider().padding(.bottom, 4)
            // One row when it fits without wrapping; a vertical list on narrow or large-text screens.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 16) { footerLinks }
                VStack(alignment: .leading, spacing: 0) { footerLinks }
            }
        }
        .card()
    }

    @ViewBuilder private var footerLinks: some View {
        footerLink("Prompt bank", "books.vertical", .bank(skill: ""))
        footerLink("Mistakes", "exclamationmark.triangle", .mistakes(category: nil))
        footerLink("Review deck", "rectangle.on.rectangle.angled", .review)
        footerLink("All attempts", "clock.arrow.circlepath", .history(skill: nil))
    }

    private func practiseRow<L: View>(_ title: String, _ meta: String, _ icon: String, left: SkillQuota?, link: (AnyView) -> L) -> some View {
        let label = HStack(spacing: 12) {
            Image(systemName: icon).font(.body).foregroundStyle(.muted).frame(width: 28).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(title).font(.body).foregroundStyle(.ink)
                    if let q = left {
                        let out = q.blocked != nil || q.remaining == 0
                        Text(CommunityText.left(q)).font(.caption.monospacedDigit()).foregroundStyle(out ? Color.warnText : Color.muted)
                    }
                }
                Text(meta).font(.caption).foregroundStyle(.muted).multilineTextAlignment(.leading)
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary).accessibilityHidden(true)
        }
        .frame(minHeight: 52)
        .contentShape(Rectangle())
        return link(AnyView(label)).buttonStyle(.plain)
    }

    private func footerLink(_ title: String, _ icon: String, _ route: Route) -> some View {
        NavigationLink(value: route) {
            Label(title, systemImage: icon).font(.subheadline.weight(.medium)).foregroundStyle(.brand).lineLimit(1).fixedSize(horizontal: true, vertical: false).frame(minHeight: 44)
        }
        .buttonStyle(.plain)
    }

    // MARK: Progress (web ProgressTabs)

    private func progressTabs(_ p: DashProgress) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionTitle("Progress")
            Picker("Progress", selection: $progressTab) {
                Text("Overall").tag("overall")
                ForEach(skillOrder, id: \.self) { Text(MockFlow.label($0)).tag($0) }
            }
            .pickerStyle(.segmented)
            switch progressTab {
            case "speaking", "writing": criteriaPanel(p, progressTab)
            case "listening", "reading": lrPanel(progressTab)
            default: overallPanel(p)
            }
        }
    }

    /// Four skill cards: the latest band, a sparkline against the target (a meter with one result), the average and the change since the first.
    private func overallPanel(_ p: DashProgress) -> some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12, alignment: .top), GridItem(.flexible(), spacing: 12, alignment: .top)], spacing: 12) {
            ForEach(skillOrder, id: \.self) { k in
                let pts = points(p, k)
                let name = MockFlow.label(k)
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(name).font(.headline).foregroundStyle(.ink)
                        Spacer(minLength: 4)
                        Text(pts.last.map { fmt($0) } ?? "–").font(.system(size: 26, weight: .bold, design: .serif).monospacedDigit()).foregroundStyle(.ink)
                    }
                    if let latest = pts.last {
                        Text("Average \(skillBand(p, k).band.map { fmt($0) } ?? "–") · \(pts.count) \(pts.count == 1 ? "attempt" : "attempts")").font(.caption.monospacedDigit()).foregroundStyle(.muted)
                        if pts.count > 1 {
                            bandChart(pts, domain: 0...9, height: 48, compact: true, label: "\(name) band over \(pts.count) attempts, latest \(fmt(latest)), target \(fmt(target))")
                        } else {
                            BandBar(value: latest / 9, marker: target / 9, fill: bandColor(latest, target), height: 6, label: "\(name) band \(fmt(latest)) of 9")
                        }
                        changeLine(pts)
                    } else {
                        Text("No scored \(name.lowercased()) test yet.").font(.caption).foregroundStyle(.muted)
                    }
                }
                .card(padding: 14)
            }
        }
    }

    @ViewBuilder private func changeLine(_ pts: [Double]) -> some View {
        if let t = DashboardMath.changeText(pts), let d = DashboardMath.changeSinceFirst(pts) {
            Text(t).font(.caption.monospacedDigit()).foregroundStyle(d > 0 ? Color.goodText : d < 0 ? Color.bad : Color.muted)
        }
    }

    /// One small chart per criterion on a shared band scale (four lines on one chart overlap); latest bands as meters until there are three attempts.
    @ViewBuilder private func criteriaPanel(_ p: DashProgress, _ skill: String) -> some View {
        let rows = p.trend.filter { $0.skill == skill }
        let keys = Crit.order(skill)
        let latest = rows.last?.criteria ?? [:]
        if rows.isEmpty {
            Text("Your \(skill) criteria appear after your first scored attempt.").font(.subheadline).foregroundStyle(.muted)
        } else if rows.count < 3 {
            VStack(alignment: .leading, spacing: 14) {
                Text("From your latest \(skill) attempt; the marker is your \(fmt(target)) target. Each criterion's trend appears after three scored attempts.")
                    .font(.caption).foregroundStyle(.muted)
                ForEach(keys, id: \.self) { k in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(Crit.label(k)).font(.subheadline)
                            Spacer()
                            Text(latest[k].map { fmt($0) } ?? "–").font(.display(.title3).monospacedDigit())
                        }
                        BandBar(value: (latest[k] ?? 0) / 9, marker: target / 9, fill: latest[k].map { bandColor($0, target) } ?? .brand, height: 6, label: "\(Crit.label(k)) band \(latest[k].map { fmt($0) } ?? "none") of 9")
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .card()
        } else {
            let all = rows.flatMap { r in keys.compactMap { r.criteria[$0] } }
            let lo = max(0, floor(min(all.min() ?? target, target)) - 1)
            VStack(alignment: .leading, spacing: 12) {
                Text("Your last \(rows.count) \(skill) attempts, oldest on the left. The dashed line is your \(fmt(target)) target.").font(.caption).foregroundStyle(.muted)
                ForEach(keys, id: \.self) { k in
                    let pts = rows.compactMap { $0.criteria[k] }
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(Crit.label(k)).font(.headline).foregroundStyle(.ink)
                                changeLine(pts)
                            }
                            Spacer(minLength: 8)
                            Text(latest[k].map { fmt($0) } ?? "–").font(.system(size: 26, weight: .bold, design: .serif).monospacedDigit()).foregroundStyle(.ink)
                        }
                        bandChart(pts, domain: lo...9, height: 120, compact: false, label: "\(Crit.label(k)) over \(pts.count) \(skill) attempts, latest \(latest[k].map { fmt($0) } ?? "none"), target \(fmt(target))")
                    }
                    .card(padding: 14)
                }
            }
        }
    }

    /// Listening or Reading: the band over attempts, the weakest question types of this skill, and one test to practise them on (web LrPanel).
    @ViewBuilder private func lrPanel(_ skill: String) -> some View {
        let name = MockFlow.label(skill)
        let rows = (lr?.trend ?? []).filter { $0.skill == skill }
        let weakest = (lr?.weakest ?? []).filter { $0.skill == skill }
        VStack(alignment: .leading, spacing: 16) {
            if let last = rows.last {
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(name), latest of \(rows.count)").font(.caption).foregroundStyle(.muted)
                    Text(fmt(last.band)).font(.system(size: 34, weight: .bold, design: .serif).monospacedDigit()).foregroundStyle(.ink)
                    if let d = DashboardMath.changeSinceFirst(rows.map(\.band)) {
                        Text(d == 0 ? "Same as your first" : "\(d > 0 ? "Up" : "Down") \(fmt(abs(d))) from your first").font(.subheadline).foregroundStyle(.ink)
                    }
                    if rows.count > 1 {
                        bandChart(rows.map(\.band), domain: 0...9, height: 150, compact: false, label: "\(name) band over \(rows.count) attempts, latest \(fmt(last.band)), target \(fmt(target))")
                    }
                }
            } else {
                Text("Your \(name) band trend appears after your first scored whole test.").font(.subheadline).foregroundStyle(.muted)
            }
            Divider().overlay(Color.line)
            Text("Weakest question types").font(.headline).foregroundStyle(.ink).accessibilityAddTraits(.isHeader)
            if weakest.isEmpty {
                Text("Your weak spots appear after a few more answered questions.").font(.subheadline).foregroundStyle(.muted)
            } else {
                ForEach(weakest) { w in
                    let r = Double(w.right) / Double(max(1, w.total))
                    VStack(spacing: 6) {
                        HStack {
                            Text(w.label).font(.body).foregroundStyle(.ink)
                            Spacer(minLength: 8)
                            Text("\(Int((r * 100).rounded()))%").font(.subheadline.weight(.semibold).monospacedDigit()).foregroundStyle(r < 0.5 ? Color.bad : Color.warnText)
                        }
                        ProgressView(value: r).tint(r >= 0.75 ? .good : r >= 0.5 ? .warn : .bad)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(w.label): \(w.right) of \(w.total) correct")
                }
            }
            if let sg = lr?.suggested, sg.skill == skill {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Suggested next test").font(.caption).foregroundStyle(.muted)
                        Text(sg.title).font(.body.weight(.medium)).foregroundStyle(.ink)
                        Text("has \(sg.count) \(sg.label.lowercased()) questions").font(.caption).foregroundStyle(.muted)
                    }
                    Spacer(minLength: 8)
                    Button { Task { await startLr(sg) } } label: { if lrBusy { ProgressView() } else { Text("Practise") } }
                        .primaryButton().controlSize(.large).disabled(lrBusy)
                        .accessibilityLabel("Practise \(sg.title)")
                }
                .padding(12)
                .background(Color.surface2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
        .card()
    }

    /// Band line, oldest first, with the target as a dashed rule (web BandTrend).
    private func bandChart(_ pts: [Double], domain: ClosedRange<Double>, height: CGFloat, compact: Bool, label: String) -> some View {
        Chart {
            RuleMark(y: .value("Target", target)).foregroundStyle(Color.muted).lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 4]))
            ForEach(Array(pts.enumerated()), id: \.offset) { i, b in
                LineMark(x: .value("Attempt", i + 1), y: .value("Band", b)).foregroundStyle(Color.brand).interpolationMethod(.monotone)
                PointMark(x: .value("Attempt", i + 1), y: .value("Band", b)).foregroundStyle(Color.brand).symbolSize(i == pts.count - 1 ? 40 : 14)
            }
        }
        .chartYScale(domain: domain)
        .chartXAxis(.hidden)
        .chartYAxis(compact ? .hidden : .automatic)
        .frame(height: height)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }

    // MARK: Fix next (web FixNext)

    private func fixNext(_ m: [ProgressData.CategoryCount]) -> some View {
        let most = Double(max(1, m.map(\.count).max() ?? 1))
        return VStack(alignment: .leading, spacing: 4) {
            SectionTitle("Fix next")
            Text("Recurring mistakes, last 30 days").font(.caption).foregroundStyle(.muted).padding(.bottom, 8)
            ForEach(m, id: \.category) { c in
                NavigationLink(value: Route.mistakes(category: c.category)) {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(shellCategoryLabel(c.category)).font(.body).foregroundStyle(.ink).multilineTextAlignment(.leading)
                            Spacer(minLength: 8)
                            Text("\(c.count)").font(.subheadline.monospacedDigit()).foregroundStyle(.muted)
                        }
                        BandBar(value: Double(c.count) / most, fill: .muted, height: 4, label: "\(shellCategoryLabel(c.category)): \(c.count)")
                    }
                    .padding(.vertical, 8)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            NavigationLink(value: Route.mistakes(category: nil)) {
                Label("Open error log", systemImage: "arrow.right").font(.subheadline.weight(.medium)).foregroundStyle(.brand).frame(minHeight: 44)
            }
            .buttonStyle(.plain)
        }
        .card()
    }
}
