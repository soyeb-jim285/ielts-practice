import AVFoundation
import SwiftUI

/// Human recordings and IPA from Wiktionary through the Free Dictionary API (free, no key), as the web PronunciationPanel uses.
/// Names and rare forms are often missing: an empty entry.
enum PronDict {
    struct Entry: Equatable { var uk: String?; var us: String?; var ipa: String? }

    /// The API's entries array → the UK and US recordings (an unmarked one counts as US when there is no UK one) and the first IPA.
    static func parse(_ data: Data) -> Entry {
        struct Phonetic: Decodable { let text: String?; let audio: String? }
        struct E: Decodable { let phonetic: String?; let phonetics: [Phonetic]? }
        guard let entries = try? JSONDecoder().decode([E].self, from: data) else { return Entry() }
        let ph = entries.flatMap { $0.phonetics ?? [] }
        func audio(_ accent: String) -> String? { ph.first { $0.audio?.hasSuffix("-\(accent).mp3") == true }?.audio }
        let uk = audio("uk")
        let us = audio("us") ?? (uk == nil ? ph.first { !($0.audio ?? "").isEmpty }?.audio : nil)
        return Entry(uk: uk, us: us, ipa: entries.first?.phonetic ?? ph.first { $0.text != nil }?.text)
    }

    @MainActor private static var cache: [String: Entry] = [:]

    @MainActor static func lookup(_ word: String) async -> Entry {
        let key = word.lowercased()
        if let hit = cache[key] { return hit }
        guard !Demo.on, let q = key.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
              let url = URL(string: "https://api.dictionaryapi.dev/api/v2/entries/en/\(q)"),
              let r = try? await URLSession.shared.data(from: url),
              (r.1 as? HTTPURLResponse)?.statusCode == 200 else { return Entry() }
        let e = parse(r.0)
        cache[key] = e
        return e
    }

    /// How to make the expected sound, for the swaps learners make most. Keyed by espeak IPA (web TIPS).
    static let tips: [String: String] = [
        "θ": "Put your tongue lightly between your teeth and blow air out. No stop, no burst.",
        "ð": "Tongue lightly between your teeth, then add your voice so it buzzes.",
        "v": "Touch your top teeth to your bottom lip and let it buzz. Rounded lips make a /w/ instead.",
        "w": "Round your lips into a small circle, then open them. Your teeth do not touch your lip.",
        "f": "Top teeth on your bottom lip, then blow. Your lips do not close.",
        "p": "Close both lips, then release a puff of air.",
        "r": "Curl your tongue back without touching the roof of your mouth. Do not roll or tap it.",
        "ɹ": "Curl your tongue back without touching the roof of your mouth. Do not roll or tap it.",
        "l": "Press the tip of your tongue behind your top teeth and let the air pass at the sides.",
        "ɪ": "A short, relaxed sound, as in \"sit\". Do not stretch it into \"seat\".",
        "iː": "A long sound with spread lips, as in \"seat\". Hold it a little longer than \"sit\".",
        "æ": "Open your mouth wide and spread your lips, as in \"cat\". Not \"ket\".",
        "e": "Mouth half open, as in \"bed\". Less open than \"bad\".",
        "ɛ": "Mouth half open, as in \"bed\". Less open than \"bad\".",
        "ʌ": "Short and central, as in \"cup\". Your lips stay relaxed, not rounded.",
        "ɒ": "Short with rounded lips and an open mouth, as in \"hot\" (UK).",
        "ʃ": "Round your lips a little and push them forward, as in \"she\". Flat lips make an /s/.",
        "s": "Tongue close behind your top teeth, lips spread, a thin hiss.",
        "z": "The /s/ position with your voice on, so it buzzes.",
        "ʒ": "The /ʃ/ position with your voice on, as in \"measure\".",
        "dʒ": "Start with the tongue touching behind your teeth, then release into a buzzing \"zh\", as in \"job\".",
        "tʃ": "Start with the tongue touching behind your teeth, then release into \"sh\", as in \"chip\".",
        "ŋ": "Lift the back of your tongue to the soft palate and let the sound go through your nose. Do not add a /g/ at the end.",
        "h": "A light breath from the throat, as in \"hat\". Do not drop it.",
    ]
}

/// Pronunciation tab (web components/speaking/PronunciationPanel): the phoneme model's findings, each word with your clip and a correct recording.
struct PronunciationPanel: View {
    let pron: PronunciationAudio
    let player: Player
    @State private var dict: [String: PronDict.Entry] = [:]
    @State private var looked = false
    @State private var clip: AVPlayer?
    @State private var speech = AVSpeechSynthesizer()

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 8) {
                SectionTitle("Summary")
                Text("A phoneme model listened to your recording and compared each sound with US and UK English, counting whichever is closer. It does not change your band yet.")
                    .font(.footnote).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 12) {
                    stat("Sounds said as expected", pron.accuracy.map { "\(Int($0.rounded())) / 100" } ?? "n/a")
                    stat("Words to practise", "\(pron.words.count)")
                }
            }
            if !pron.confusions.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    SectionTitle("Sounds you mix up most")
                    Text("Only sounds you swapped more than once. A single slip is not a pattern, and an accent is not an error.").font(.footnote).foregroundStyle(.muted)
                    FlowLayout(spacing: 8, lineSpacing: 8) {
                        ForEach(Array(pron.confusions.enumerated()), id: \.offset) { _, c in
                            (Text("/\(c.expected)/ → ").foregroundStyle(Color.ink) + Text("/\(c.heard)/").foregroundStyle(Color.bad) + Text("  \(c.count) times").font(.caption).foregroundStyle(Color.muted))
                                .font(.callout)
                                .padding(.horizontal, 12).padding(.vertical, 6)
                                .background(Color.surface, in: Capsule())
                                .overlay(Capsule().strokeBorder(Color.line))
                                .accessibilityLabel("\(c.expected) said as \(c.heard), \(c.count) times")
                        }
                    }
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                SectionTitle("Words to practise")
                if pron.words.isEmpty {
                    Text("No word stood out. Every content word was close to US or UK English.").font(.body).foregroundStyle(.ink)
                } else {
                    Text("Worst first. Play your version, then the correct one, and say it again.").font(.footnote).foregroundStyle(.muted)
                    VStack(spacing: 0) {
                        ForEach(Array(pron.words.enumerated()), id: \.offset) { i, w in
                            if i > 0 { Divider() }
                            row(w).padding(16)
                        }
                    }
                    .card(padding: 0)
                }
            }
        }
        .task {
            // Look every word up when the tab opens, so the recordings are ready by the first tap.
            await withTaskGroup(of: (String, PronDict.Entry).self) { g in
                for w in pron.words { g.addTask { await (w.word.lowercased(), PronDict.lookup(w.word)) } }
                for await (k, e) in g { dict[k] = e }
            }
            looked = true
        }
        .onDisappear { clip?.pause() }
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.display(.title2).monospacedDigit()).foregroundStyle(.ink)
            Text(label).font(.caption).foregroundStyle(.muted)
        }
        .card(padding: 14)
        .accessibilityElement(children: .combine)
    }

    /// The phones between slashes, the ones that differ in colour (green expected, red heard) and bold, so it is not colour alone.
    private func phones(_ w: PronunciationAudio.Word, expected: Bool) -> Text {
        w.phones.reduce(Text("/")) { t, p in
            let s = Text(expected ? p.expected : p.heard)
            return t + (p.ok ? s.foregroundStyle(Color.ink) : s.bold().foregroundStyle(expected ? Color.goodText : Color.bad))
        } + Text("/")
    }

    private func row(_ w: PronunciationAudio.Word) -> some View {
        let d = dict[w.word.lowercased()]
        let first = w.accent == "us" ? "us" : "gb" // the accent the model found closer plays first
        let recs = (first == "gb" ? ["gb", "us"] : ["us", "gb"]).compactMap { a in (a == "gb" ? d?.uk : d?.us).map { (accent: a, url: $0) } }
        let tip = w.phones.first { !$0.ok && PronDict.tips[$0.expected] != nil }.flatMap { PronDict.tips[$0.expected] }
        return VStack(alignment: .leading, spacing: 10) {
            Text(w.word).font(.headline).foregroundStyle(.ink)
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 4) {
                GridRow {
                    Text("Correct").font(.caption).foregroundStyle(.muted)
                    (phones(w, expected: true) + Text(d?.ipa.map { "   dictionary \($0)" } ?? "").font(.caption).foregroundStyle(Color.muted)).font(.body)
                }
                GridRow {
                    Text("You said").font(.caption).foregroundStyle(.muted)
                    phones(w, expected: false).font(.body)
                }
            }
            if let tip { Text(tip).font(.subheadline).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true) }
            FlowLayout(spacing: 8, lineSpacing: 8) {
                Button { playMine(w) } label: { Label("Your version", systemImage: "play.fill").frame(minHeight: 32) }
                    .secondaryButton().disabled(!player.isLoaded)
                ForEach(recs, id: \.accent) { r in
                    Button { playClip(r.url, word: w.word, accent: r.accent) } label: { Label("Correct · \(r.accent == "gb" ? "UK" : "US")", systemImage: "speaker.wave.2.fill").frame(minHeight: 32) }
                        .secondaryButton()
                }
                if looked && recs.isEmpty {
                    Button { speak(w.word, accent: first) } label: { Label("Device voice", systemImage: "speaker.wave.2.fill").frame(minHeight: 32) }
                        .secondaryButton()
                }
            }
            Text(!looked ? "Looking up…" : recs.isEmpty ? "No dictionary recording" : "Recording: Wiktionary").font(.caption).foregroundStyle(.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The word in the candidate's own recording, with 0.3 s after it.
    private func playMine(_ w: PronunciationAudio.Word) {
        clip?.pause()
        player.seek(to: w.start)
        let stopAt = w.end + 0.3
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(max(0.2, stopAt - w.start)))
            if player.isPlaying, player.currentTime >= stopAt - 0.15 { player.pause() }
        }
    }

    private func playClip(_ url: String, word: String, accent: String) {
        guard let u = URL(string: url) else { return speak(word, accent: accent) }
        if player.isPlaying { player.pause() }
        try? Recorder.configureSession()
        let p = AVPlayer(url: u)
        clip = p
        p.play()
    }

    private func speak(_ word: String, accent: String) {
        let u = AVSpeechUtterance(string: word)
        u.voice = AVSpeechSynthesisVoice(language: accent == "gb" ? "en-GB" : "en-US")
        u.rate = AVSpeechUtteranceDefaultSpeechRate * 0.85
        speech.stopSpeaking(at: .immediate)
        speech.speak(u)
    }
}
