import SwiftUI

/// Mirrors DEFAULT_SETTINGS.models in apps/server/src/settings.ts (and the web's DEFAULT_MODELS).
private enum DefaultModels {
    static let analysis = "openai/gpt-6-luna"
    static let examiner = "openai/gpt-6-luna"
    static let stt = "openai/whisper-large-v3"
    static let tts = "google/gemini-3.8-flash-tts"
    static let audioPron = "google/gemini-2.5-flash"
}

private func shortModel(_ id: String) -> String { id.split(separator: "/").last.map(String.init) ?? id }

/// A TTS model with the voices it supports (GET /api/models?capability=tts). Local: the shared ModelInfo has no `voices`.
private struct TtsModel: Decodable {
    let id: String
    let voices: [String]?
}

struct SettingsView: View {
    @Environment(APIClient.self) private var api
    @State private var s: AppSettings?
    @State private var targetDraft = 7.0
    @State private var voices: [String: [String]] = [:]
    @State private var error: String?
    @State private var showDelete = false

    var body: some View {
        Form {
            if let error { Section { ErrorLine(message: error) } }
            Section {
                NavigationLink(value: Route.history(skill: nil)) { Label("Past attempts", systemImage: "clock.arrow.circlepath") }
                NavigationLink(value: Route.mistakes(category: nil)) { Label("Mistakes", systemImage: "exclamationmark.triangle") }
                NavigationLink(value: Route.bank(skill: "")) { Label("Prompt bank", systemImage: "books.vertical") }
            } header: {
                Text("More")
            }
            if s != nil { settingsSections }
            Section {
                LabeledContent("Signed in as", value: api.me?.user.email ?? "")
                Button("Sign out") { Task { await api.signOut() } }
            } header: {
                Text("Account")
            }
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Delete account")
                    Text("Removes your recordings, essays, results and review cards. This can't be undone.").font(.caption).foregroundStyle(.muted)
                }
                Button("Delete account", role: .destructive) { showDelete = true }
            } header: {
                Text("Danger zone")
            }
        }
        .canvasList()
        .demoScroll()
        .navigationTitle("Settings")
        .onAppear {
            s = api.me?.settings
            targetDraft = s?.targetBand ?? 7
        }
        .task {
            if let list: ListOf<TtsModel> = try? await api.get("/api/models", query: ["capability": "tts"]) {
                voices = Dictionary(list.items.compactMap { m in m.voices.map { (m.id, $0) } }, uniquingKeysWith: { a, _ in a })
            }
        }
        .onChange(of: s) { old, new in
            guard let new, old != nil, new != api.me?.settings else { return }
            Task {
                do { try await api.saveSettings(new); error = nil } catch is CancellationError {} catch { self.error = error.localizedDescription }
            }
        }
        // A new voice model may not offer the current voice: switch to its first one (web pickVoice).
        .onChange(of: s?.models.tts) { _, new in
            guard let new, let list = voices[new], let first = list.first, let cur = s?.models.ttsVoice, !list.contains(cur) else { return }
            s?.models.ttsVoice = first
        }
        .sheet(isPresented: $showDelete) { DeleteAccountSheet() }
    }

    private var binding: Binding<AppSettings> {
        Binding(get: { s ?? api.me!.settings }, set: { s = $0 })
    }

    private func toggle(_ title: String, _ description: String, _ isOn: Binding<Bool>) -> some View {
        Toggle(isOn: isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                Text(description).font(.caption).foregroundStyle(.muted)
            }
        }
    }

    /// One conversation-mode choice as a full-width radio row.
    private func providerRow(_ value: String, _ title: String, _ description: String, current: String, enabled: Bool = true, set: @escaping () -> Void) -> some View {
        Button(action: set) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).foregroundStyle(.ink)
                    Text(description).font(.caption).foregroundStyle(.muted).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 8)
                Image(systemName: current == value ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(current == value ? Color.brand : Color.muted)
                    .accessibilityHidden(true)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.5)
        .accessibilityAddTraits(current == value ? .isSelected : [])
    }

    @ViewBuilder
    private var settingsSections: some View {
        let b = binding
        let gptLiveOK = api.me?.gptLiveAvailable == true
        let geminiOK = api.me?.geminiLiveAvailable == true
        let natural = "Talk back and forth as in the real test. You can interrupt each other."
        Section {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Target band")
                    Spacer()
                    Text(Band.format(targetDraft)).font(.display(.title3).monospacedDigit()).foregroundStyle(.ink)
                }
                Slider(value: $targetDraft, in: 4...9, step: 0.5) { editing in
                    if !editing { s?.targetBand = targetDraft }
                }
                .accessibilityLabel("Target band")
                .accessibilityValue(Band.format(targetDraft))
                HStack {
                    ForEach([4, 5, 6, 7, 8, 9], id: \.self) { n in
                        Text("\(n)")
                        if n < 9 { Spacer() }
                    }
                }
                .font(.caption.monospacedDigit()).foregroundStyle(.muted).accessibilityHidden(true)
                Text("Most universities ask for 6.5-7.0 overall.").font(.caption).foregroundStyle(.muted)
            }
        } header: {
            Text("Goal")
        } footer: {
            Text("Scores at or above your target show green; up to one band below, amber; further below, red.")
        }
        Section {
            toggle("Submit when time runs out", "Off: the timer keeps counting as overtime and the result is flagged.", b.writingAutoSubmit)
            toggle("Block pasting", "Matches the real test, where you type every word.", b.blockPaste)
        } header: {
            Text("Writing")
        } footer: {
            Text("How the timed essay editor behaves.")
        }
        Section {
            providerRow("turn", "Examiner waits for you to finish", "The examiner asks a question, then listens until you pause.", current: b.wrappedValue.liveProvider) {
                s?.liveProvider = "turn"
            }
            providerRow("gpt-live", "Natural conversation (GPT-Live)", gptLiveOK ? natural : "Not available right now.",
                        current: b.wrappedValue.liveProvider, enabled: gptLiveOK) {
                s?.liveProvider = "gpt-live"
            }
            providerRow("gemini-live", "Natural conversation (Gemini)", geminiOK ? natural : "Not available right now.",
                        current: b.wrappedValue.liveProvider, enabled: geminiOK) {
                s?.liveProvider = "gemini-live"
            }
        } header: {
            Text("Live examiner")
        } footer: {
            Text("How the live speaking test talks to you.")
        }
        Section {
            DisclosureGroup {
                Text("Any OpenRouter model works. Costs are rough estimates for scoring one essay or spoken answer.").font(.caption).foregroundStyle(.muted)
                ModelRow(title: "Scoring and feedback", capability: "text", hint: nil, defaultID: DefaultModels.analysis, value: b.models.analysis)
                ModelRow(title: "Examiner", capability: "text", hint: "Asks the questions when the examiner waits for you to finish.", defaultID: DefaultModels.examiner, value: b.models.examiner)
                ModelRow(title: "Speech to text", capability: "stt", hint: "Needs word timestamps for fluency metrics.", defaultID: DefaultModels.stt, value: b.models.stt)
                ModelRow(title: "Examiner voice model", capability: "tts", hint: nil, defaultID: DefaultModels.tts, value: b.models.tts)
                Picker("Voice", selection: b.models.ttsVoice) {
                    let list = voices[b.wrappedValue.models.tts] ?? []
                    ForEach(list.contains(b.wrappedValue.models.ttsVoice) ? list : [b.wrappedValue.models.ttsVoice] + list, id: \.self) { Text($0).tag($0) }
                }
                toggle("Audio pronunciation check", "Sends your recording to an audio model for prosody and pronunciation notes. Slower and costs more.", b.audioPronEnabled)
                if b.wrappedValue.audioPronEnabled {
                    ModelRow(title: "Pronunciation model", capability: "audio-in", hint: "Must accept audio input.", defaultID: DefaultModels.audioPron, value: b.models.audioPron)
                }
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Customise models")
                    Text("Scoring: \(shortModel(b.wrappedValue.models.analysis))").font(.caption).foregroundStyle(.muted)
                }
            }
        } header: {
            Text("AI models")
        } footer: {
            Text("The models that score your work and play the examiner. The defaults suit most people.")
        }
    }
}

/// A model choice: opens the searchable list, with the web's hint and "Reset to default" under it.
private struct ModelRow: View {
    let title: String
    let capability: String
    let hint: String?
    let defaultID: String
    @Binding var value: String

    var body: some View {
        NavigationLink {
            ModelPickerView(title: title, capability: capability, selection: $value)
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                LabeledContent(title, value: shortModel(value))
                if let hint { Text(hint).font(.caption).foregroundStyle(.muted) }
            }
        }
        if value != defaultID {
            Button("Reset to default (\(shortModel(defaultID)))") { value = defaultID }.font(.subheadline)
        }
    }
}

/// Deleting needs the account password, like the web dialog (Better Auth delete-user).
private struct DeleteAccountSheet: View {
    @Environment(APIClient.self) private var api
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("Confirm with your password", text: $password).textContentType(.password)
                } footer: {
                    Text("Everything you've recorded and written will be permanently deleted.")
                }
                if let error { Section { ErrorLine(message: error) } }
            }
            .canvasList()
            .navigationTitle("Delete your account?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Keep account") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Delete forever", role: .destructive) { Task { await delete() } }.disabled(password.isEmpty || busy)
                }
            }
        }
        .interactiveDismissDisabled(busy)
    }

    private func delete() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await api.raw("POST", "/api/auth/delete-user", ["password": password])
            api.signOutLocal()
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct ModelPickerView: View {
    let title: String
    let capability: String
    @Binding var selection: String

    @Environment(APIClient.self) private var api
    @Environment(\.dismiss) private var dismiss
    @State private var models: [ModelInfo] = []
    @State private var query = ""
    @State private var error: String?
    @State private var loading = true

    private var filtered: [ModelInfo] {
        query.isEmpty ? models : models.filter { $0.id.localizedCaseInsensitiveContains(query) || ($0.name ?? "").localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        List {
            if let error { ErrorLine(message: error) }
            if loading { ProgressView() }
            ForEach(filtered) { m in
                Button {
                    selection = m.id
                    dismiss()
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(m.name ?? m.id).foregroundStyle(.primary)
                            Text(m.id).font(.caption.monospaced()).foregroundStyle(.muted)
                            if let p = price(m) { Text(p).font(.caption).foregroundStyle(.muted) }
                        }
                        Spacer()
                        if m.id == selection { Image(systemName: "checkmark").foregroundStyle(.brand) }
                    }
                }
            }
        }
        .canvasList()
        .demoScroll()
        .navigationTitle(title)
        .searchable(text: $query, prompt: "Search models")
        .task {
            do {
                let list: ListOf<ModelInfo> = try await api.get("/api/models", query: ["capability": capability])
                models = list.items
            } catch {
                self.error = error.localizedDescription
            }
            loading = false
        }
    }

    /// OpenRouter prices are USD per token (as strings) → per 1M tokens.
    private func price(_ m: ModelInfo) -> String? {
        guard let p = m.pricing, let i = Double(p.prompt ?? ""), let o = Double(p.completion ?? ""), i > 0 || o > 0 else { return nil }
        return String(format: "$%.2f in · $%.2f out per 1M tokens", i * 1e6, o * 1e6)
    }
}
