import SwiftUI

/// Settings → "Your API keys" (signed-in users). The key is sent once, checked by the server with a free call and stored encrypted there;
/// the app only ever sees { provider, last4, addedAt, valid } back. Nothing is logged or kept on the device.
struct ApiKeysSection: View {
    @Environment(APIClient.self) private var api
    @State private var keys: [String: ApiKeyInfo] = [:]

    struct Provider: Identifiable {
        let id: String // openrouter | openai | gemini
        let name: String
        let unlocks: String
    }

    static let providers = [
        Provider(id: "openrouter", name: "OpenRouter", unlocks: "Unlimited tests"),
        Provider(id: "openai", name: "OpenAI", unlocks: "GPT-Live examiner"),
        Provider(id: "gemini", name: "Gemini", unlocks: "Gemini Live examiner"),
    ]

    var body: some View {
        Section {
            ForEach(Self.providers) { p in
                KeyRow(provider: p, info: keys[p.id]) { info in
                    keys[p.id] = info
                    Task { await refresh() }
                }
            }
        } header: {
            Text("Your API keys")
        } footer: {
            Text("Your key is stored encrypted on our server and only used for your tests. Remove it any time.")
        }
        .task { await load() }
    }

    private func load() async {
        guard let list: [String: [ApiKeyInfo]] = try? await api.get("/api/keys") else { return }
        keys = Dictionary((list["keys"] ?? []).map { ($0.provider, $0) }, uniquingKeysWith: { a, _ in a })
    }

    /// Keys change the tier and the live examiners: refetch both.
    private func refresh() async {
        await api.loadQuota(force: true)
        try? await api.loadMe()
    }
}

private struct KeyRow: View {
    @Environment(APIClient.self) private var api
    let provider: ApiKeysSection.Provider
    let info: ApiKeyInfo?
    let onChange: (ApiKeyInfo?) -> Void

    @State private var draft = ""
    @State private var replacing = false
    @State private var busy = false
    @State private var error: String?
    @State private var confirmRemove = false

    private var showsField: Bool { info == nil || info?.valid == false || replacing }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(provider.name).font(.headline).foregroundStyle(.ink)
                Text(provider.unlocks).font(.caption).foregroundStyle(.muted)
            }
            if let info, info.valid == false {
                Label("This key stopped working. Enter a new one.", systemImage: "exclamationmark.triangle.fill")
                    .font(.callout).foregroundStyle(Color.warnText)
            }
            if let info, !replacing, info.valid {
                saved(info)
            }
            if showsField { entry }
            if let error { ErrorLine(message: error) }
        }
        .padding(.vertical, 4)
        .confirmationDialog("Remove your \(provider.name) key?", isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("Remove key", role: .destructive) { Task { await remove() } }
            Button("Keep it", role: .cancel) {}
        } message: {
            Text(provider.id == "openrouter" ? "You'll go back to the community balance and 1 test a day." : "The \(provider.unlocks) will be locked again.")
        }
    }

    private func saved(_ info: ApiKeyInfo) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("\u{2022}\u{2022}\u{2022}\u{2022} \(info.last4)").font(.body.monospaced()).foregroundStyle(.ink)
                if let d = CommunityText.date(info.addedAt) {
                    Text("Added \(d.formatted(.dateTime.month(.abbreviated).day()))").font(.caption).foregroundStyle(.muted)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(provider.name) key ending \(info.last4)")
            Spacer(minLength: 8)
            Button("Replace") { replacing = true; error = nil }.buttonStyle(.borderless).frame(minHeight: 44)
            Button("Remove", role: .destructive) { confirmRemove = true }.buttonStyle(.borderless).frame(minHeight: 44)
        }
    }

    private var entry: some View {
        VStack(alignment: .leading, spacing: 10) {
            SecureField("Paste your \(provider.name) key", text: $draft)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
                .background(Color.surface2, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .disabled(busy)
                .accessibilityLabel("\(provider.name) API key")
            HStack(spacing: 12) {
                Button {
                    Task { await save() }
                } label: {
                    if busy { ProgressView() } else { Text("Save key").frame(minWidth: 72) }
                }
                .primaryButton()
                .disabled(busy || cleaned.count < 8)
                if replacing && !busy {
                    Button("Cancel") { replacing = false; draft = ""; error = nil }.buttonStyle(.borderless).frame(minHeight: 44)
                }
                if busy { Text("Checking your key\u{2026}").font(.subheadline).foregroundStyle(.muted) }
            }
        }
    }

    /// Keys have no spaces; a paste often brings a trailing newline.
    private var cleaned: String { draft.filter { !$0.isWhitespace } }

    private func save() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            let saved: ApiKeyInfo = try await api.send("PUT", "/api/keys/\(provider.id)", ["key": cleaned])
            draft = ""
            replacing = false
            onChange(saved)
        } catch is CancellationError {
        } catch let e as APIError {
            error = describe(e)
        } catch {
            self.error = "Couldn't save the key. Try again."
        }
    }

    private func remove() async {
        do {
            let _: Empty = try await api.send("DELETE", "/api/keys/\(provider.id)")
            error = nil
            onChange(nil)
        } catch is CancellationError {
        } catch {
            self.error = "Couldn't remove the key. Try again."
        }
    }

    /// Never shows the server text for a key problem: it could echo input.
    private func describe(_ e: APIError) -> String {
        switch e.code {
        case "invalid_key": return "\(provider.name) didn't accept that key. Check that you copied all of it."
        case "key_check_failed": return "Couldn't reach \(provider.name) to check the key. Try again."
        case "keys_unavailable": return "Saving keys isn't available right now. Try again later."
        default: return e.status == 429 ? "Too many tries. Wait a minute, then try again." : "Couldn't save the key. Try again."
        }
    }
}
