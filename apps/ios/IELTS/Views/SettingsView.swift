import SwiftUI

struct SettingsView: View {
    @Environment(APIClient.self) private var api
    @State private var s: AppSettings?
    @State private var server = ""
    @State private var error: String?
    @State private var confirmDelete = false

    private static let voices = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"]

    var body: some View {
        Form {
            if let error { Section { ErrorLine(message: error) } }
            if s != nil { settingsSections }
            Section {
                TextField("Server URL", text: $server)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .onSubmit { saveServer() }
                if server != api.baseURL { Button("Use this server") { saveServer() } }
            } header: {
                Text("Server")
            } footer: {
                Text("Changing the server signs you out.")
            }
            Section("Account") {
                LabeledContent("Email", value: api.me?.user.email ?? "")
                Button("Sign out") { Task { await api.signOut() } }
                Button("Delete account", role: .destructive) { confirmDelete = true }
            }
        }
        .navigationTitle("Settings")
        .onAppear {
            s = api.me?.settings
            server = api.baseURL
        }
        .onChange(of: s) { old, new in
            guard let new, old != nil, new != api.me?.settings else { return }
            Task {
                do { try await api.saveSettings(new); error = nil } catch { self.error = error.localizedDescription }
            }
        }
        .confirmationDialog("Delete your account?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete account and all data", role: .destructive) {
                Task { do { try await api.deleteAccount() } catch { self.error = error.localizedDescription } }
            }
        } message: {
            Text("All attempts, recordings, scores and review cards are permanently deleted.")
        }
    }

    private func saveServer() {
        guard server != api.baseURL else { return }
        api.signOutLocal()
        api.setBaseURL(server)
    }

    private var binding: Binding<AppSettings> {
        Binding(get: { s ?? api.me!.settings }, set: { s = $0 })
    }

    @ViewBuilder
    private var settingsSections: some View {
        let b = binding
        Section("Goal") {
            Stepper(value: b.targetBand, in: 4...9, step: 0.5) {
                LabeledContent("Target band", value: Band.format(b.wrappedValue.targetBand))
            }
        }
        Section {
            Toggle("Auto-submit when time runs out", isOn: b.writingAutoSubmit)
            Toggle("Block pasting into answers", isOn: b.blockPaste)
        } header: {
            Text("Writing")
        }
        Section {
            Picker("Examiner", selection: b.liveProvider) {
                Text("Turn-based (OpenRouter)").tag("turn")
                Text("OpenAI Realtime").tag("openai-realtime")
            }
            .disabled(api.me?.realtimeAvailable != true)
        } header: {
            Text("Live examiner")
        } footer: {
            if api.me?.realtimeAvailable != true { Text("OpenAI Realtime needs OPENAI_API_KEY on the server.") }
        }
        Section {
            modelRow("Analysis", "text", b.models.analysis)
            modelRow("Examiner", "text", b.models.examiner)
            modelRow("Speech to text", "stt", b.models.stt)
            modelRow("Text to speech", "tts", b.models.tts)
            Picker("Examiner voice", selection: b.models.ttsVoice) {
                ForEach(Self.voices.contains(b.wrappedValue.models.ttsVoice) ? Self.voices : Self.voices + [b.wrappedValue.models.ttsVoice], id: \.self) {
                    Text($0.capitalized).tag($0)
                }
            }
            Toggle("Audio pronunciation check", isOn: b.audioPronEnabled)
            if b.wrappedValue.audioPronEnabled { modelRow("Pronunciation model", "audio-in", b.models.audioPron) }
        } header: {
            Text("AI models")
        } footer: {
            Text("Models run through OpenRouter. The audio pronunciation check sends your recording to an audio-capable model for extra pronunciation hints.")
        }
    }

    private func modelRow(_ title: String, _ capability: String, _ value: Binding<String>) -> some View {
        NavigationLink {
            ModelPickerView(title: title, capability: capability, selection: value)
        } label: {
            LabeledContent(title, value: value.wrappedValue)
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
                            Text(m.id).font(.caption.monospaced()).foregroundStyle(.secondary)
                            if let p = price(m) { Text(p).font(.caption).foregroundStyle(.secondary) }
                        }
                        Spacer()
                        if m.id == selection { Image(systemName: "checkmark").foregroundStyle(.brand) }
                    }
                }
            }
        }
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
