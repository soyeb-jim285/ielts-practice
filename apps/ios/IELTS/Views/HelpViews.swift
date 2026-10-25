import SafariServices
import SwiftUI

/// The web's own pages (privacy, terms, contact) on the production server; they open in the in-app browser (see `inAppBrowser`).
@MainActor enum SitePage {
    static func url(_ path: String) -> URL { URL(string: APIClient.server + path)! }
}

/// SFSafariViewController: the in-app browser, so legal pages open without leaving the app.
struct SafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}

private struct BrowserPage: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

private struct InAppBrowser: ViewModifier {
    @State private var page: BrowserPage?

    func body(content: Content) -> some View {
        content
            .environment(\.openURL, OpenURLAction { url in
                guard url.scheme == "https" || url.scheme == "http" else { return .systemAction }
                page = BrowserPage(url: url)
                return .handled
            })
            .sheet(item: $page) { SafariView(url: $0.url).ignoresSafeArea() }
    }
}

extension View {
    /// Web links inside this view (`Link`, markdown links in `Text`) open in an in-app Safari sheet instead of the Safari app.
    func inAppBrowser() -> some View { modifier(InAppBrowser()) }
}

/// Settings (signed in or not): report a problem, and the privacy, terms and contact pages (web settings Account rows and the site footer).
struct HelpSection: View {
    @State private var reporting = false

    var body: some View {
        Section {
            Button { reporting = true } label: { Label("Report a problem", systemImage: "exclamationmark.bubble") }
                .sheet(isPresented: $reporting) { FeedbackSheet() }
            Link(destination: SitePage.url("/privacy")) { Label("Privacy policy", systemImage: "hand.raised") }
            Link(destination: SitePage.url("/terms")) { Label("Terms and refunds", systemImage: "doc.text") }
            Link(destination: SitePage.url("/contact")) { Label("Contact us", systemImage: "envelope") }
        } header: {
            Text("Help and legal")
        } footer: {
            Text("The privacy policy says what we collect, including session recording, and how long we keep it.")
        }
    }
}

/// "Report a problem" (web components/layout/FeedbackButton.tsx): POST /api/feedback with the message and where it was sent from. Works without an account.
struct FeedbackSheet: View {
    @Environment(APIClient.self) private var api
    @Environment(\.dismiss) private var dismiss
    var page = "/settings (iOS app)"
    @State private var message = ""
    @State private var busy = false
    @State private var error: String?
    @State private var sent = false
    private let limit = 2000

    private var text: String { message.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            Form {
                if sent {
                    Section {
                        Label("Thanks, we got it.", systemImage: "checkmark.circle.fill").foregroundStyle(.goodText)
                    }
                } else {
                    Section {
                        TextEditor(text: $message)
                            .frame(minHeight: 160)
                            .accessibilityLabel("What happened?")
                            .onChange(of: message) { if message.count > limit { message = String(message.prefix(limit)) } }
                    } header: {
                        Text("What happened?")
                    } footer: {
                        HStack(alignment: .firstTextBaseline) {
                            Text("Tell us what went wrong.")
                            Spacer(minLength: 8)
                            Text("\(message.count)/\(limit)").monospacedDigit()
                        }
                    }
                    if let error { Section { ErrorLine(message: error) } }
                }
            }
            .canvasList()
            .navigationTitle("Report a problem")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if sent {
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                } else {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Send") { Task { await send() } }.disabled(busy || text.isEmpty)
                    }
                }
            }
        }
        .interactiveDismissDisabled(busy)
    }

    private func send() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await api.raw("POST", "/api/feedback", ["message": text, "page": page])
            sent = true
        } catch is CancellationError {
        } catch let e as APIError where e.status == 429 {
            error = "You have sent a few already. Try again in a while."
        } catch {
            self.error = "Couldn't send that. Try again."
        }
    }
}
