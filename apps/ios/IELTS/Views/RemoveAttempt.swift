import SwiftUI

/// "Remove from history" for one attempt (web components/history/RemoveAttempt.tsx): DELETE /api/attempts/{id} or /api/lr/attempts/{id}.
/// The server hard-deletes the row, analysis and recording; the test allowance is NOT given back.
enum AttemptRemoval {
    static let message = "This permanently deletes the result, recording and analysis. It can't be undone."

    static func remove(_ api: APIClient, id: String, lr: Bool) async throws {
        let _: Empty = try await api.send("DELETE", lr ? "/api/lr/attempts/\(id)" : "/api/attempts/\(id)")
    }
}

/// What a confirm dialog is asking about.
struct RemovalTarget: Identifiable, Equatable {
    let id: String
    let title: String
    let lr: Bool
}

extension View {
    /// Confirm dialog (alert-style on every device) before a removal; `onConfirm` runs only on "Remove".
    func confirmRemoval(_ target: Binding<RemovalTarget?>, onConfirm: @escaping (RemovalTarget) -> Void) -> some View {
        confirmationDialog("Remove from history?", isPresented: Binding(get: { target.wrappedValue != nil }, set: { if !$0 { target.wrappedValue = nil } }), titleVisibility: .visible, presenting: target.wrappedValue) { t in
            Button("Remove", role: .destructive) { onConfirm(t) }
            Button("Cancel", role: .cancel) {}
        } message: { t in
            Text("\(t.title)\n\(AttemptRemoval.message)")
        }
    }
}
