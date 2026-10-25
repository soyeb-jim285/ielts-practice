import SwiftUI

struct SettingsView: View {
    @Environment(APIClient.self) private var api
    @State private var s: AppSettings?
    @State private var targetDraft = 7.0
    @State private var error: String?
    @State private var showDelete = false

    var body: some View {
        Form {
            if let error { Section { ErrorLine(message: error) } }
            CommunitySection()
            Section {
                NavigationLink(value: Route.lrHub(skill: "listening")) { Label("Listening", systemImage: "headphones") }
                NavigationLink(value: Route.lrHub(skill: "reading")) { Label("Reading", systemImage: "book") }
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
            HelpSection()
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
        .inAppBrowser()
        .navigationTitle("Settings")
        .onAppear {
            s = api.me?.settings
            targetDraft = s?.targetBand ?? 7
        }
        .onChange(of: s) { old, new in
            guard let new, old != nil, new != api.me?.settings else { return }
            Task {
                do { try await api.saveSettings(new); error = nil } catch is CancellationError {} catch { self.error = error.localizedDescription }
            }
        }
        .sheet(isPresented: $showDelete) { DeleteAccountSheet() }
        .task { await api.loadQuota() }
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

    @ViewBuilder
    private var settingsSections: some View {
        let b = binding
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
