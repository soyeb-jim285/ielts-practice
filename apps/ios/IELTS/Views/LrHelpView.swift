import SwiftUI

/// Same six points as the web Help sheet (docs/exam-fidelity.md, feature 5).
struct LrHelpSheet: View {
    @Environment(\.dismiss) private var dismiss
    private static let items: [(String, String)] = [
        ("Navigation", "Use the question numbers at the bottom to jump; Next and Back move one question. Part tabs switch parts (in Listening exam the recording moves parts for you)."),
        ("Flag for review", "Flag a question you want to come back to. Flagged questions are marked in the navigator and listed when you submit."),
        ("Highlight and notes", "Select text and choose Highlight or Add note (long-press on touch). Tap a highlight to remove it or open its note. Notes are kept on this device and are never sent anywhere."),
        ("Settings", "Change text size and colours without affecting the timer."),
        ("Hide", "Covers the test; the clock keeps running (and the recording keeps playing in Listening)."),
        ("Submit", "You can submit early; unanswered questions are listed first."),
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ForEach(Array(Self.items.enumerated()), id: \.offset) { _, it in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(it.0).font(.headline).foregroundStyle(Color.ink).accessibilityAddTraits(.isHeader)
                            Text(it.1).font(.body).foregroundStyle(Color.ink.opacity(0.85))
                        }
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Color.canvas)
            .navigationTitle("Help")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Close") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

/// Text size and colour scheme for the test content; applied at once and remembered on the device.
struct LrSettingsSheet: View {
    let store: LrSettingsStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Text size") {
                    Picker("Text size", selection: Binding(get: { store.value.size }, set: { store.value.size = $0 })) {
                        ForEach(LrSettings.Size.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.inline).labelsHidden()
                }
                Section("Colours") {
                    Picker("Colours", selection: Binding(get: { store.value.scheme }, set: { store.value.scheme = $0 })) {
                        ForEach(LrSettings.Scheme.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.inline).labelsHidden()
                }
                Section {
                    Button("Reset to default") { store.value = LrSettings() }
                        .disabled(store.value == LrSettings())
                } footer: {
                    Text("Applies to the passage and questions only. The timer and bars stay the same.")
                }
            }
            .canvasList()
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

/// Covers the test content and part tabs. Nothing is paused: the clock and the recording carry on.
struct LrHidePanel: View {
    let listening: Bool
    let onShow: () -> Void
    @AccessibilityFocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "eye.slash").font(.largeTitle).foregroundStyle(Color.muted).accessibilityHidden(true)
            Text("Test hidden").font(.display(.title2)).foregroundStyle(Color.ink).accessibilityAddTraits(.isHeader)
            Text("The clock is still running." + (listening ? " The recording is still playing." : ""))
                .font(.body).foregroundStyle(Color.muted).multilineTextAlignment(.center)
            Button("Show", action: onShow).primaryButton().controlSize(.large).accessibilityFocused($focused)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.canvas)
        .accessibilityElement(children: .contain)
        .onAppear { focused = true }
    }
}
