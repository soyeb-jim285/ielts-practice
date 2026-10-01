import SwiftUI

/// Content that needs an account. Signed out, a prompt takes its place and the sign-in sheet opens; once the user signs in the real content
/// swaps in, so they land on the screen they asked for (the pending action continues).
struct SignInGate<Content: View>: View {
    @Environment(APIClient.self) private var api
    let reason: String
    let content: () -> Content

    init(reason: String, @ViewBuilder content: @escaping () -> Content) {
        self.reason = reason
        self.content = content
    }

    var body: some View {
        if api.isSignedIn {
            content()
        } else {
            ContentUnavailableView {
                Label("Sign in to continue", systemImage: "person.crop.circle")
            } description: {
                Text(reason)
            } actions: {
                Button("Sign in or create account") { api.requestSignIn(reason) }.primaryButton()
            }
            .background(Color.canvas)
            .onAppear { api.requestSignIn(reason) }
        }
    }
}

/// Home tab: the dashboard for a signed-in user, the product intro for a guest.
struct HomeView: View {
    @Environment(APIClient.self) private var api
    var body: some View {
        if api.isSignedIn { DashboardView() } else { GuestDashboardView() }
    }
}

/// Settings tab: settings when signed in, otherwise the way to sign in (plus the one public page, the prompt bank).
struct SettingsTab: View {
    @Environment(APIClient.self) private var api
    var body: some View {
        if api.isSignedIn {
            SettingsView()
        } else {
            Form {
                Section {
                    Text("Sign in to keep your results, history and settings in one place.").foregroundStyle(.muted)
                    Button("Sign in") { api.requestSignIn("Sign in to see your settings.") }
                        .frame(minHeight: 44, alignment: .leading)
                    Button("Create account") { api.requestSignIn("Create an account to save your practice.", signUp: true) }
                        .frame(minHeight: 44, alignment: .leading)
                } header: {
                    Text("Account")
                }
                Section {
                    NavigationLink(value: Route.bank(skill: "")) { Label("Prompt bank", systemImage: "books.vertical") }
                } header: {
                    Text("More")
                }
            }
            .canvasList()
            .demoScroll()
            .navigationTitle("Settings")
        }
    }
}
