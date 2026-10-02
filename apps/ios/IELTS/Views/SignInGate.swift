import SwiftUI

/// Friendly "this needs an account" state (icon, one line, Create account over Sign in). Not an error: guests are welcome to look around.
struct SignInPrompt: View {
    @Environment(APIClient.self) private var api
    var icon = "person.crop.circle"
    var title = "Sign in to continue"
    let reason: String

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                Image(systemName: icon)
                    .font(.title)
                    .foregroundStyle(.brand)
                    .frame(width: 64, height: 64)
                    .background(Color.brandSoft, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .accessibilityHidden(true)
                VStack(spacing: 6) {
                    Text(title).font(.display(.title2, weight: .semibold)).foregroundStyle(.ink).multilineTextAlignment(.center)
                        .accessibilityAddTraits(.isHeader)
                    Text(reason).foregroundStyle(.muted).multilineTextAlignment(.center)
                }
                VStack(spacing: 12) {
                    Button { api.requestSignIn(reason, signUp: true) } label: {
                        Text("Create account").frame(maxWidth: .infinity, minHeight: 28)
                    }
                    .primaryButton().controlSize(.large)
                    Button { api.requestSignIn(reason) } label: {
                        Text("Sign in").frame(maxWidth: .infinity, minHeight: 28)
                    }
                    .secondaryButton().controlSize(.large)
                }
                .padding(.top, 4)
            }
            .frame(maxWidth: 420)
            .padding(.horizontal, 24)
            .padding(.top, 56)
            .padding(.bottom, 24)
            .frame(maxWidth: .infinity)
        }
        .background(Color.canvas)
    }
}

/// Content that needs an account. Signed out, a prompt takes its place (the sheet opens only when they tap a button); once the user signs in the real
/// content swaps in, so they land on the screen they asked for.
struct SignInGate<Content: View>: View {
    @Environment(APIClient.self) private var api
    var icon = "person.crop.circle"
    var title = "Sign in to continue"
    let reason: String
    let content: () -> Content

    init(icon: String = "person.crop.circle", title: String = "Sign in to continue", reason: String, @ViewBuilder content: @escaping () -> Content) {
        self.icon = icon
        self.title = title
        self.reason = reason
        self.content = content
    }

    var body: some View {
        if api.isSignedIn { content() } else { SignInPrompt(icon: icon, title: title, reason: reason) }
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
                CommunitySection()
                Section {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Sign in to save your results, history and settings.").foregroundStyle(.muted)
                        Button { api.requestSignIn("Create an account to save your practice.", signUp: true) } label: {
                            Text("Create account").frame(maxWidth: .infinity, minHeight: 28)
                        }
                        .primaryButton().controlSize(.large)
                        Button { api.requestSignIn("Sign in to see your settings.") } label: {
                            Text("Sign in").frame(maxWidth: .infinity, minHeight: 28)
                        }
                        .secondaryButton().controlSize(.large)
                    }
                    .padding(.vertical, 6)
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
            .task { await api.loadQuota() }
        }
    }
}
