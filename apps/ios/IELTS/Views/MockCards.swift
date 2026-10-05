import SwiftUI

/// "Full mock test" entry on the dashboard and the four skill hubs. With an open mock it becomes the way back into it.
struct MockEntryCard: View {
    @Environment(APIClient.self) private var api
    /// Inside a List the row supplies the link and its chevron, so the link hides behind the card.
    var inList = false
    @State private var current: MockExam?

    private var route: Route { current.map { Route.mockHub(id: $0.id) } ?? Route.mock }

    private var label: some View {
        HStack(spacing: 12) {
            Image(systemName: "checklist")
                .font(.body).foregroundStyle(.ink)
                .frame(width: 40, height: 40)
                .background(.surface2, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(current.map(MockFlow.continueLine) ?? "Full mock test").font(.headline).foregroundStyle(.ink).multilineTextAlignment(.leading)
                Text(current == nil ? "Listening, Reading, Writing, then Speaking, with one overall band" : "Your time so far is kept")
                    .font(.subheadline).foregroundStyle(.muted).multilineTextAlignment(.leading)
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary).accessibilityHidden(true)
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .card()
    }

    var body: some View {
        Group {
            if inList {
                ZStack {
                    label
                    NavigationLink(value: route) { EmptyView() }.opacity(0)
                }
            } else {
                NavigationLink(value: route) { label }.buttonStyle(.plain)
            }
        }
        .task(id: api.isSignedIn) {
            guard api.isSignedIn else { current = nil; return }
            current = try? await api.mockCurrent()
        }
    }
}

/// A mock test in History: variant and test, the date, and the overall band or why there is none yet.
struct MockHistoryRow: View {
    let mock: MockExam
    let target: Double

    private var title: String { "Mock test, " + (mock.variant == "academic" ? "Academic" : "General Training") }
    private var meta: String { [mock.ref, ShellDate.date(mock.startedAt)].compactMap { $0 }.joined(separator: ", ") }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "checklist").foregroundStyle(.muted).frame(width: 24).padding(.top, 2).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.body.weight(.medium)).lineLimit(2)
                if mock.isOpen { Chip(text: mock.next.map { "\(MockFlow.label($0)) next" } ?? "Open", color: .brand) }
                else if mock.status == "closed" { Chip(text: "Without Speaking", color: .warnText) }
                Text(meta).font(.caption).foregroundStyle(.muted)
            }
            Spacer(minLength: 8)
            if let o = mock.overall {
                Text(fmt(o)).font(.title3.weight(.bold).monospacedDigit()).foregroundStyle(bandTextColor(o, target))
                    .accessibilityLabel("Overall band \(fmt(o))")
            }
        }
        .padding(.vertical, 4)
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }
}
