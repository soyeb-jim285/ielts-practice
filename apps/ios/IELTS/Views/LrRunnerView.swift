import SwiftUI

/// Loads an attempt and shows the runner (in progress) or the result (submitted). A submit swaps the content in place, so back goes to the hub.
struct LrAttemptScreen: View {
    @Environment(APIClient.self) private var api
    let id: String
    @State private var attempt: LrAttempt?
    @State private var error: String?

    var body: some View {
        Group {
            if let a = attempt {
                if a.status == "submitted" {
                    LrResultView(attempt: a)
                } else {
                    LrRunnerView(attempt: a) { attempt = $0 }
                }
            } else if let error {
                ContentUnavailableView {
                    Label("Couldn't open this test", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(error)
                } actions: {
                    Button("Try again") { Task { await load() } }.primaryButton()
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.canvas)
            }
        }
        .task { if attempt == nil { await load() } }
    }

    private func load() async {
        error = nil
        do { attempt = try await api.get("/api/lr/attempts/\(id)") } catch is CancellationError {} catch { self.error = error.localizedDescription }
    }
}

struct LrRunnerView: View {
    @Environment(APIClient.self) private var api
    let attempt: LrAttempt
    let onSubmitted: (LrAttempt) -> Void
    @State private var session: LrSession?

    var body: some View {
        if let s = session {
            LrRunnerBody(session: s, onSubmitted: onSubmitted)
        } else {
            Color.canvas.ignoresSafeArea().onAppear { session = LrSession(attempt: attempt, api: api) }
        }
    }
}

private enum LrTab: Hashable { case passage, questions }

private struct LrRunnerBody: View {
    let session: LrSession
    let onSubmitted: (LrAttempt) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var sizeClass

    @State private var partIdx = 0
    @State private var current = 1
    @State private var active: Int?
    @State private var tab: LrTab = .passage
    @State private var navOpen = false
    @State private var confirmSubmit = false
    @State private var confirmLeave = false
    @State private var submitError = false
    @State private var scrollTo: Int?
    @State private var scrollStamp = 0
    @State private var playlist: LrExamPlaylist?
    @State private var practice = LrPracticePlayer()
    @State private var rate: Float = 1

    private var test: LrTest { session.test }
    private var attempt: LrAttempt { session.attempt }
    private var exam: Bool { attempt.isExam }
    private var listening: Bool { test.isListening }
    private var examListening: Bool { exam && listening }
    private var started: Bool { !examListening || (playlist?.phase ?? .idle) != .idle }
    private var section: LrSection { test.sections[min(partIdx, test.sections.count - 1)] }
    private var flat: [LrFlatQ] { test.flat }
    private var total: Int { flat.count }
    private var unanswered: Int { flat.filter { !Lr.answered(session.responses, $0.n) }.count }

    private var ctx: LrCtx {
        LrCtx(responses: session.responses,
              set: { n, v in current = n; session.set(n, v) },
              replace: { session.replace($0) },
              assets: attempt.assets, review: nil, active: active,
              onFocus: { current = $0; session.noteFocus($0) }, onBlur: { session.noteBlur($0) })
    }

    var body: some View {
        VStack(spacing: 0) {
            if started { partPicker }
            content
        }
        .background(Color.canvas)
        .safeAreaInset(edge: .bottom, spacing: 0) { if started { bottomBar } }
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button { if exam { confirmLeave = true } else { dismiss() } } label: { Image(systemName: "xmark") }
                    .accessibilityLabel("Exit test")
            }
            ToolbarItem(placement: .principal) { HStack(spacing: 10) { LrSaveIndicator(session: session); clock } }
            ToolbarItem(placement: .topBarTrailing) {
                Button("Submit") { confirmSubmit = true }.disabled(!started).fontWeight(.semibold)
            }
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }
            }
        }
        .sheet(isPresented: $navOpen) {
            LrNavigatorSheet(test: test, responses: session.responses, flagged: session.flagged, current: current) { jump($0) }
                .presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $confirmSubmit) {
            LrSubmitSheet(unanswered: unanswered, flagged: session.flagged.sorted(), submitting: session.submitting,
                          onJump: { confirmSubmit = false; jump($0) }, onSubmit: { Task { await submit() } })
                .presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
        }
        .alert("Leave the test?", isPresented: $confirmLeave) {
            Button("Stay in the test", role: .cancel) {}
            Button("Leave", role: .destructive) { dismiss() }
        } message: {
            Text("Your answers are saved. You can resume this attempt from the hub, but the exam clock does not run while you are away.")
        }
        .alert("Could not submit", isPresented: $submitError) { Button("OK", role: .cancel) {} } message: { Text("Your answers are saved. Try again.") }
        .onAppear(perform: setUp)
        .onDisappear { playlist?.stop(); practice.teardown(); Task { await session.saveNow() }; session.stop() }
        .onChange(of: scenePhase) { _, p in if p != .active { Task { await session.saveNow() } } }
        .onChange(of: rate) { _, r in if !exam, Double(r) != (session.stats.audio?.rate ?? 1) { session.noteRate(r) } }
        .onChange(of: current) { _, n in session.remember(part: partIdx, n: n) }
        .onChange(of: playlist?.idx) { _, i in if examListening, let i, playlist?.phase == .audio { goPart(i) } }
        .task { await examLoop() }
        .onDemoTour { s in // demo auto-tour (Demo/DemoTour.swift): "g:<n>:<blank>:<blanks>:<chars>" types into a gap
            let p = s.split(separator: ":", maxSplits: 4, omittingEmptySubsequences: false).map(String.init)
            if p.count == 5, p[0] == "g", let n = Int(p[1]), let part = Int(p[2]), let of = Int(p[3]) {
                let v = session.value(n)
                current = n
                active = n
                session.set(n, of > 1 ? Lr.setGapPart(v, part, of, Lr.gapPart(v, part) + p[4]) : v + p[4])
            }
            if s == "lr:questions" { withAnimation { tab = .questions } }
            if s == "lr:clear" { active = nil }
        }
        .task(id: partIdx) { // pacing: one second per tick on the part on screen, while the app is in the foreground
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                if started, scenePhase == .active { session.tick(part: test.sections[min(partIdx, test.sections.count - 1)].part) }
            }
        }
    }

    // MARK: Setup and clocks

    private func setUp() {
        rate = session.audioRate
        if let pos = session.position, pos.part < test.sections.count {
            partIdx = pos.part
            current = pos.n
            scrollTo = pos.n
            scrollStamp += 1
        } else {
            current = flat.first?.n ?? 1
        }
        session.lateFrom = listening ? .infinity : Double(Lr.readingLimit(attempt.parts) - 300)
        switch Demo.screen { // demo screenshots
        case "lr-reading-questions": tab = .questions
        case "lr-reading-p2": goPart(1); tab = .questions
        case "lr-navigator": Task { try? await Task.sleep(for: .seconds(1)); navOpen = true }
        case "lr-submit": Task { try? await Task.sleep(for: .seconds(1)); session.flagged = [3, 9]; confirmSubmit = true }
        default: break
        }
        if examListening && playlist == nil {
            playlist = LrExamPlaylist(urls: test.sections.map { Lr.assetURL(attempt.assets[$0.audio ?? ""]) }, startElapsed: attempt.elapsedS)
        }
    }

    /// Exam listening: the clock is the audio position, and the review countdown ends in a submit.
    private func examLoop() async {
        guard examListening else { return }
        while !Task.isCancelled {
            try? await Task.sleep(for: .milliseconds(500))
            guard let pl = playlist, pl.phase != .idle else { continue }
            session.elapsed = pl.elapsed
            if pl.total > 0 { session.lateFrom = pl.total }
            if pl.finishedReview { await submit(); return }
        }
    }

    @ViewBuilder private var clock: some View {
        if examListening {
            if let pl = playlist, pl.phase == .review { LrReviewPill(playlist: pl) }
        } else {
            LrWallClock(session: session, countdown: exam ? Lr.readingLimit(attempt.parts) : nil) { Task { await submit() } }
        }
    }

    private func submit() async {
        do {
            let a = try await session.submit()
            playlist?.stop(); practice.teardown()
            onSubmitted(a)
        } catch is CancellationError {
        } catch {
            confirmSubmit = false
            submitError = true
        }
    }

    // MARK: Navigation

    private func goPart(_ i: Int) {
        partIdx = i
        current = test.sections[i].groups.first?.questions.first?.n ?? 1
        tab = .passage
    }

    private func jump(_ n: Int) {
        guard let si = test.section(of: n) else { return }
        partIdx = si
        current = n
        active = n
        tab = .questions
        navOpen = false
        scrollTo = n
        scrollStamp += 1
        Task { try? await Task.sleep(for: .seconds(2.5)); if active == n { active = nil } }
    }

    private var flaggedNow: Bool { session.flagged.contains(current) }
    private func toggleFlag() {
        if flaggedNow { session.flagged.remove(current) } else { session.flagged.insert(current) }
    }

    // MARK: Layout

    private var partPicker: some View {
        Picker("\(test.partNoun)", selection: Binding(get: { partIdx }, set: { goPart($0) })) {
            ForEach(Array(test.sections.enumerated()), id: \.offset) { i, s in Text("\(test.partNoun) \(s.part)").tag(i) }
        }
        .pickerStyle(.segmented)
        .disabled(examListening)
        .padding(.horizontal, 16).padding(.vertical, 8)
    }

    @ViewBuilder private var content: some View {
        if !started {
            gate
        } else if listening {
            VStack(spacing: 0) {
                audioBar.padding(.horizontal, 12).padding(.bottom, 8)
                questionsPane
            }
        } else if sizeClass == .regular {
            HStack(alignment: .top, spacing: 0) {
                passagePane
                Divider()
                questionsPane
            }
        } else {
            VStack(spacing: 0) {
                Picker("Show", selection: $tab) {
                    Text("Passage").tag(LrTab.passage)
                    Text("Questions").tag(LrTab.questions)
                }
                .pickerStyle(.segmented).padding(.horizontal, 16).padding(.bottom, 8)
                if tab == .passage { passagePane } else { questionsPane }
            }
        }
    }

    private var passagePane: some View {
        ScrollView {
            LrPassageView(section: section).padding(16).frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity)
        .id(section.part)
    }

    private var questionsPane: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 32) {
                    Text("\(test.partNoun) \(section.part): Questions \(section.groups.first?.from ?? 1) to \(section.groups.last?.to ?? 1)")
                        .font(.footnote).foregroundStyle(Color.muted)
                    ForEach(section.groups) { g in LrGroupView(group: g, ctx: ctx) }
                }
                .padding(16).padding(.bottom, 24)
                .frame(maxWidth: 720, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .task(id: scrollStamp) {
                guard let n = scrollTo else { return }
                try? await Task.sleep(for: .milliseconds(180))
                withAnimation { proxy.scrollTo(n, anchor: .center) }
            }
        }
        .id(section.part)
    }

    @ViewBuilder private var audioBar: some View {
        Group {
            if examListening, let pl = playlist {
                LrExamBar(playlist: pl, parts: attempt.parts == nil ? nil : test.sections.map(\.part))
            } else {
                LrPracticeBar(player: practice, url: Lr.assetURL(attempt.assets[section.audio ?? ""]), label: "Part \(section.part)", rate: $rate, resume: LrResume(start: session.audioStart(section.part), track: { session.noteAudio(part: section.part, pos: $0) }, persist: { session.saveAudio() }))
            }
        }
        .padding(14)
        .glassBar(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    /// "from Part 1 to Part 4", or "Part 2 only" for a single part
    private var partSpan: String {
        let ps = test.sections.map(\.part)
        return ps.count > 1 ? "from Part \(ps.first ?? 1) to Part \(ps.last ?? 4)" : "Part \(ps.first ?? 1) only"
    }

    private var gate: some View {
        VStack(alignment: .leading, spacing: 14) {
            Spacer()
            Image(systemName: "headphones").font(.system(size: 34)).foregroundStyle(Color.brand).accessibilityHidden(true)
            Text(attempt.elapsedS > 0 ? "Ready to continue?" : "Ready to listen?").font(.display(.title)).foregroundStyle(Color.ink)
            Text("The recording plays once, \(partSpan), with no pause or rewind. Questions appear as you start. You get 2 minutes at the end to check your answers, then the test submits itself.")
                .font(.body).foregroundStyle(Color.ink)
            Text("Check your volume first. Use headphones if you can.").font(.subheadline).foregroundStyle(Color.muted)
            if playlist?.error == true { ErrorLine(message: "The recording could not be loaded. Check your connection and try again.") }
            Button {
                playlist?.start()
            } label: {
                HStack { if playlist?.durations == nil && playlist?.error != true { ProgressView() }; Text(attempt.elapsedS > 0 ? "Resume test" : "Start test") }
                    .frame(maxWidth: .infinity)
            }
            .primaryButton().controlSize(.large)
            .disabled(playlist?.durations == nil)
            Button("Back") { dismiss() }.secondaryButton().controlSize(.large).frame(maxWidth: .infinity)
            Spacer()
        }
        .padding(24)
        .frame(maxWidth: 560)
        .frame(maxWidth: .infinity)
    }

    private var bottomBar: some View {
        let answeredN = total - unanswered
        return HStack(spacing: 8) {
            Button { navOpen = true } label: {
                HStack(spacing: 10) {
                    Image(systemName: "square.grid.3x3").foregroundStyle(Color.brand)
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Question \(current) of \(total)").font(.subheadline.weight(.semibold).monospacedDigit()).foregroundStyle(Color.ink).lineLimit(1).minimumScaleFactor(0.7)
                        Text("\(answeredN) answered").font(.caption.monospacedDigit()).foregroundStyle(Color.muted).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 6).frame(minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Question \(current) of \(total), \(answeredN) answered")
            .accessibilityHint("Opens the question navigator")
            Button(action: toggleFlag) {
                Image(systemName: flaggedNow ? "flag.fill" : "flag").foregroundStyle(flaggedNow ? Color.warn : Color.ink).frame(width: 30, height: 30)
            }
            .secondaryButton().buttonBorderShape(.circle).controlSize(.regular)
            .accessibilityLabel(flaggedNow ? "Remove flag from this question" : "Flag this question for review")
            .accessibilityAddTraits(flaggedNow ? .isSelected : [])
            Button { step(-1) } label: { Image(systemName: "chevron.left").frame(width: 30, height: 30) }
                .secondaryButton().buttonBorderShape(.circle).controlSize(.regular)
                .disabled(index <= 0).accessibilityLabel("Previous question")
            Button { step(1) } label: { Image(systemName: "chevron.right").frame(width: 30, height: 30) }
                .primaryButton().buttonBorderShape(.circle).controlSize(.regular)
                .disabled(index >= total - 1).accessibilityLabel("Next question")
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .glassBar(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .padding(.horizontal, 12).padding(.bottom, 4)
    }

    private var index: Int { flat.firstIndex { $0.n == current } ?? 0 }
    private func step(_ d: Int) {
        let i = index + d
        if flat.indices.contains(i) { jump(flat[i].n) }
    }
}

// MARK: Clocks

private struct LrClockPill: View {
    let seconds: Int
    let countdown: Bool
    let label: String
    var body: some View {
        let urgent = countdown && seconds <= 300
        let tone: Color = urgent ? (seconds <= 60 ? .bad : .warnText) : .ink
        HStack(spacing: 5) {
            Image(systemName: "timer").font(.footnote)
            Text(clock(seconds)).font(.subheadline.weight(.semibold).monospacedDigit())
        }
        .foregroundStyle(tone)
        .padding(.horizontal, 10).frame(minHeight: 32)
        .background(urgent ? tone.opacity(0.14) : Color.surface2, in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label): \(clock(seconds))")
        .accessibilityAddTraits(.updatesFrequently)
    }
}

/// Wall-clock seconds since the attempt began (carried over from the saved elapsed). With `countdown` it shows time left and fires `onTimeUp` once.
private struct LrWallClock: View {
    let session: LrSession
    let countdown: Int?
    let onTimeUp: () -> Void
    @State private var start = Date()
    @State private var seconds = 0
    @State private var fired = false

    var body: some View {
        LrClockPill(seconds: countdown.map { max(0, $0 - seconds) } ?? seconds, countdown: countdown != nil, label: countdown != nil ? "Time left" : "Time spent")
            .task {
                start = Date().addingTimeInterval(-session.elapsed)
                while !Task.isCancelled {
                    let e = Date().timeIntervalSince(start)
                    session.elapsed = e
                    seconds = Int(e)
                    if let c = countdown, e >= Double(c), !fired { fired = true; onTimeUp() }
                    try? await Task.sleep(for: .milliseconds(500))
                }
            }
    }
}

private struct LrReviewPill: View {
    let playlist: LrExamPlaylist
    var body: some View { LrClockPill(seconds: playlist.reviewLeft, countdown: true, label: "Review time left") }
}

private struct LrSaveIndicator: View {
    let session: LrSession
    var body: some View {
        let (icon, text, color): (String, String, Color) = switch session.save {
        case .saved: ("checkmark", "Saved", .goodText)
        case .saving: ("arrow.triangle.2.circlepath", "Saving", .muted)
        case .dirty: ("ellipsis", "Unsaved changes", .muted)
        case .error: ("icloud.slash", "Offline, retrying", .warnText)
        }
        Image(systemName: icon).font(.footnote.weight(.semibold)).foregroundStyle(color)
            .accessibilityLabel(text)
    }
}

// MARK: Audio bars

/// Exam recording bar: whole-test progress and which part is playing. No transport controls on purpose.
private struct LrExamBar: View {
    let playlist: LrExamPlaylist
    var parts: [Int]? = nil // a partial attempt plays only these parts
    private var playing: String {
        if let p = parts, !p.isEmpty { return "Part \(p[min(playlist.idx, p.count - 1)]) is playing" }
        return "Part \(playlist.idx + 1) of \(playlist.durations?.count ?? 4) is playing"
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Image(systemName: "headphones").foregroundStyle(Color.brand)
                Text(playlist.phase == .review ? "Recording finished. Check your answers." : playing)
                    .font(.subheadline.weight(.medium).monospacedDigit()).foregroundStyle(Color.ink)
                Spacer(minLength: 0)
            }
            ProgressView(value: playlist.total > 0 ? min(1, playlist.elapsed / playlist.total) : 0).tint(.brand).accessibilityLabel("Recording progress")
            if playlist.stalled && playlist.phase == .audio {
                Button("Resume audio") { playlist.resume() }.primaryButton().controlSize(.regular)
            }
        }
    }
}

/// Practice and review player: play, scrub, ±5 s, speed 0.75-1.25x, replay the part.
/// Practice runner: where this part was left (seconds) and how to report the position back to the session.
struct LrResume {
    let start: Double
    let track: (Double) -> Void
    let persist: () -> Void
}

/// One answer moment on the results scrubber.
struct LrAudioPin: Hashable { let n: Int, at: Double, correct: Bool, approx: Bool
    var label: String { "Question \(n), \(correct ? "right" : "wrong"), \(clock(Int(at)))" + (approx ? ", approximate" : "") }
}

struct LrPracticeBar: View {
    let player: LrPracticePlayer
    let url: URL?
    let label: String
    @Binding var rate: Float
    var resume: LrResume?
    var pins: [LrAudioPin] = []
    var pinned: Int?
    var showChips = true // the row of question-time chips under the scrubber
    var onPin: (Int) -> Void = { _ in }
    @State private var openGroup: Int? // first question of the crowded marker group that is open

    /// Right = circle, wrong = rounded square, approximate = dashed outline; the number is always shown.
    private func pinMark(_ p: LrAudioPin, size: CGFloat = 20) -> some View {
        let shape: AnyShape = p.correct ? AnyShape(Circle()) : AnyShape(RoundedRectangle(cornerRadius: 4))
        return Text("\(p.n)").font(.caption2.weight(.bold).monospacedDigit())
            .foregroundStyle(p.correct ? Color.goodText : Color.bad)
            .frame(minWidth: size, minHeight: size)
            .background((p.correct ? Color.good : Color.bad).opacity(0.15), in: shape)
            .overlay(shape.stroke(p.correct ? Color.good : Color.bad, style: StrokeStyle(lineWidth: pinned == p.n ? 2.5 : 1, dash: p.approx ? [2, 2] : [])))
    }

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                Button { player.toggle() } label: {
                    Image(systemName: player.playing ? "pause.fill" : "play.fill").font(.title3).frame(width: 30, height: 30)
                }
                .primaryButton().buttonBorderShape(.circle).controlSize(.large)
                .accessibilityLabel(player.playing ? "Pause" : "Play")
                .demoPress("lrplay") { player.toggle() }
                VStack(spacing: 2) {
                    if !pins.isEmpty, player.duration > 0 {
                        let groups = LrReview.clusterMoments(pins, duration: player.duration) { $0.at }
                        GeometryReader { g in
                            ForEach(groups, id: \.first!.n) { grp in
                                let x = 10 + (g.size.width - 20) * min(1, grp[0].at / player.duration)
                                if grp.count == 1, let p = grp.first {
                                    pinMark(p).position(x: x, y: 10).onTapGesture { onPin(p.n) }.accessibilityHidden(true) // the strip below is the accessible, 44 pt version
                                } else {
                                    let ns = grp.map(\.n).sorted()
                                    Text("\(ns.first!)\u{2013}\(ns.last!)").font(.caption2.weight(.bold).monospacedDigit()).foregroundStyle(Color.ink)
                                        .padding(.horizontal, 6).frame(minHeight: 20)
                                        .background(Color.surface2, in: RoundedRectangle(cornerRadius: 6))
                                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.muted, lineWidth: openGroup == ns.first ? 2.5 : 1))
                                        .position(x: x, y: 10)
                                        .onTapGesture { openGroup = openGroup == ns.first ? nil : ns.first }
                                        .accessibilityHidden(true)
                                }
                            }
                        }
                        .frame(height: 22)
                        if let og = openGroup, let grp = groups.first(where: { $0.map(\.n).min() == og }) {
                            HStack(spacing: 8) { ForEach(grp.sorted { $0.n < $1.n }, id: \.n) { p in pinMark(p, size: 32).onTapGesture { openGroup = nil; onPin(p.n) } } }
                                .frame(maxWidth: .infinity)
                                .accessibilityHidden(true)
                        }
                    }
                    Slider(value: Binding(get: { player.time }, set: { player.seek(to: $0) }), in: 0...max(player.duration, 1))
                        .tint(.brand)
                        .accessibilityLabel("\(label) position")
                        .accessibilityValue("\(clock(Int(player.time))) of \(clock(Int(player.duration)))")
                    HStack {
                        Text(clock(Int(player.time))).foregroundStyle(Color.muted)
                        Spacer()
                        if player.resumedAt > 0 { Text("Resume from \(clock(Int(player.resumedAt)))").foregroundStyle(Color.brand); Spacer() }
                        Text(player.failed ? "Could not load" : clock(Int(player.duration))).foregroundStyle(player.failed ? Color.bad : Color.muted)
                    }
                    .font(.caption.monospacedDigit())
                }
            }
            if !pins.isEmpty && showChips {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(pins.sorted { $0.at < $1.at }, id: \.n) { p in
                            Button { onPin(p.n) } label: {
                                VStack(spacing: 0) {
                                    Text("\(p.n)").font(.subheadline.weight(.bold).monospacedDigit())
                                    Text(clock(Int(p.at))).font(.caption2.monospacedDigit())
                                }
                                .foregroundStyle(p.correct ? Color.goodText : Color.bad)
                                .frame(minWidth: 52, minHeight: 44)
                                .background((p.correct ? Color.good : Color.bad).opacity(0.15), in: p.correct ? AnyShape(RoundedRectangle(cornerRadius: 22)) : AnyShape(RoundedRectangle(cornerRadius: 6)))
                                .overlay((p.correct ? AnyShape(RoundedRectangle(cornerRadius: 22)) : AnyShape(RoundedRectangle(cornerRadius: 6))).stroke(p.correct ? Color.good : Color.bad, style: StrokeStyle(lineWidth: pinned == p.n ? 2.5 : 1, dash: p.approx ? [3, 2] : [])))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(p.label)
                            .accessibilityAddTraits(pinned == p.n ? .isSelected : [])
                        }
                    }
                }
            }
            HStack(spacing: 8) {
                Button { player.skip(-5) } label: { Label("5", systemImage: "gobackward.5").labelStyle(.iconOnly).frame(width: 24, height: 24) }
                    .secondaryButton().buttonBorderShape(.circle).accessibilityLabel("Back 5 seconds")
                Button { player.skip(5) } label: { Label("5", systemImage: "goforward.5").labelStyle(.iconOnly).frame(width: 24, height: 24) }
                    .secondaryButton().buttonBorderShape(.circle).accessibilityLabel("Forward 5 seconds")
                Picker("Playback speed", selection: $rate) {
                    Text("0.75×").tag(Float(0.75))
                    Text("1×").tag(Float(1))
                    Text("1.25×").tag(Float(1.25))
                }
                .pickerStyle(.segmented)
                Button { player.replay() } label: { Image(systemName: "arrow.counterclockwise").frame(width: 24, height: 24) }
                    .secondaryButton().buttonBorderShape(.circle).accessibilityLabel("Replay \(label.lowercased())")
            }
        }
        .task(id: url) { player.load(url, resumeAt: resume?.start ?? 0, track: resume?.track, persist: resume?.persist); player.rate = rate }
        .onChange(of: rate) { _, r in player.rate = r }
        .onDisappear { player.teardown() }
    }
}

// MARK: Passage

struct LrPassageView: View {
    let section: LrSection
    /// Review: the span holding the answer (paragraph index and UTF-16 offsets into that paragraph's text).
    var evidence: LrReview.Span?

    var body: some View {
        if let p = section.passage {
            VStack(alignment: .leading, spacing: 14) {
                Text(p.title).font(.title2.weight(.semibold)).fontDesign(.serif).foregroundStyle(Color.ink).accessibilityAddTraits(.isHeader)
                if let s = p.subtitle { Text(s).font(.system(.subheadline, design: .serif).italic()).foregroundStyle(Color.muted) }
                ForEach(Array(p.paragraphs.enumerated()), id: \.offset) { pi, para in
                    if para.text.hasPrefix("### ") {
                        // "### " marks a text heading (GT reading); "• " lines are bullets
                        Text(String(para.text.dropFirst(4))).font(.headline).fontDesign(.serif).foregroundStyle(Color.ink)
                            .accessibilityAddTraits(.isHeader).padding(.top, 4)
                    } else {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        if let l = para.label {
                            Text(l).font(.subheadline.weight(.bold).monospacedDigit()).foregroundStyle(Color.brand)
                                .frame(minWidth: 22, alignment: .leading).accessibilityLabel("Paragraph \(l)")
                        }
                        if let ev = evidence, ev.p == pi {
                            Text(lrMarked(para.text, ev)).textSelection(.enabled).id("ev")
                                .font(.body).fontDesign(.serif).lineSpacing(5).foregroundStyle(Color.ink)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .accessibilityHint("Contains where the answer is")
                        } else {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(Array(para.text.components(separatedBy: "\n").enumerated()), id: \.offset) { _, line in
                                if line.hasPrefix("• ") {
                                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                                        Text("•").foregroundStyle(Color.muted)
                                        Text(String(line.dropFirst(2))).textSelection(.enabled)
                                    }
                                    .padding(.leading, 8)
                                } else {
                                    Text(line).textSelection(.enabled)
                                }
                            }
                        }
                        .font(.body).fontDesign(.serif).lineSpacing(5).foregroundStyle(Color.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    }
                }
            }
        }
    }
}

// MARK: Sheets

private struct LrNavigatorSheet: View {
    let test: LrTest
    let responses: [String: String]
    let flagged: Set<Int>
    let current: Int
    let onJump: (Int) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let answered = test.flat.filter { Lr.answered(responses, $0.n) }.count
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("\(answered) of \(test.total) answered" + (flagged.isEmpty ? "" : ", \(flagged.count) flagged")).font(.subheadline).foregroundStyle(Color.muted)
                    ForEach(test.sections) { s in
                        let qs = s.groups.flatMap { $0.questions.map(\.n) }
                        VStack(alignment: .leading, spacing: 10) {
                            HStack(alignment: .firstTextBaseline) {
                                Text("\(test.partNoun) \(s.part)").font(.headline).foregroundStyle(Color.ink)
                                Text("\(qs.filter { Lr.answered(responses, $0) }.count) of \(qs.count) answered").font(.caption).foregroundStyle(Color.muted)
                            }
                            .accessibilityAddTraits(.isHeader)
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 52), spacing: 8)], spacing: 8) {
                                ForEach(qs, id: \.self) { n in cell(n) }
                            }
                        }
                    }
                }
                .padding(16)
            }
            .background(Color.canvas)
            .navigationTitle("Questions")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    private func cell(_ n: Int) -> some View {
        let done = Lr.answered(responses, n), isCur = n == current, flag = flagged.contains(n)
        return Button { onJump(n) } label: {
            Text("\(n)").font(.body.weight(.semibold).monospacedDigit())
                .foregroundStyle(done ? Color.brand : Color.ink)
                .frame(maxWidth: .infinity, minHeight: 46)
                .background(done ? Color.brandSoft : Color.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(isCur ? Color.brand : Color.line, lineWidth: isCur ? 2 : 1))
                .overlay(alignment: .topTrailing) { if flag { Image(systemName: "flag.fill").font(.caption2).foregroundStyle(Color.warn).padding(4) } }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Question \(n), \(done ? "answered" : "not answered")\(flag ? ", flagged" : "")")
    }
}

private struct LrSubmitSheet: View {
    let unanswered: Int
    let flagged: [Int]
    let submitting: Bool
    let onJump: (Int) -> Void
    let onSubmit: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Submit your answers?").font(.display(.title2)).foregroundStyle(Color.ink)
            Group {
                if unanswered > 0 {
                    Text("\(unanswered) \(unanswered == 1 ? "question" : "questions") unanswered.").fontWeight(.semibold).foregroundStyle(Color.warnText)
                } else {
                    Text("Every question has an answer.").foregroundStyle(Color.ink)
                }
            }
            if !flagged.isEmpty {
                Text("\(flagged.count) \(flagged.count == 1 ? "question" : "questions") flagged for review.").foregroundStyle(Color.ink)
                FlowLayout(spacing: 8, lineSpacing: 8) {
                    ForEach(flagged, id: \.self) { n in
                        Button { onJump(n) } label: { Label("\(n)", systemImage: "flag.fill").font(.subheadline.weight(.semibold).monospacedDigit()).foregroundStyle(Color.ink) }
                            .secondaryButton().accessibilityLabel("Go to flagged question \(n)")
                    }
                }
            }
            Text("You cannot change answers after submitting.").font(.subheadline).foregroundStyle(Color.muted)
            Spacer(minLength: 0)
            HStack(spacing: 12) {
                Button("Keep working") { dismiss() }.secondaryButton().controlSize(.large)
                Button(action: onSubmit) {
                    HStack { if submitting { ProgressView() }; Text("Submit answers") }.frame(maxWidth: .infinity)
                }
                .primaryButton().controlSize(.large).disabled(submitting)
            }
        }
        .font(.body)
        .padding(20)
        .background(Color.canvas)
    }
}
