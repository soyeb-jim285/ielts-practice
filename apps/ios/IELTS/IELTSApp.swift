import SwiftUI

@main
struct IELTSApp: App {
    @State private var api = APIClient()

    init() {
        // Serif large and inline titles (New York), matching the web's Newsreader headings.
        func serif(_ style: UIFont.TextStyle, _ weight: UIFont.Weight) -> UIFont {
            let base = UIFont.preferredFont(forTextStyle: style)
            let d = base.fontDescriptor.withDesign(.serif)?.addingAttributes([.traits: [UIFontDescriptor.TraitKey.weight: weight]]) ?? base.fontDescriptor
            return UIFont(descriptor: d, size: base.pointSize)
        }
        let nav = UINavigationBar.appearance()
        nav.largeTitleTextAttributes = [.font: serif(.largeTitle, .semibold)]
        nav.titleTextAttributes = [.font: serif(.headline, .semibold)]
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(api)
                .tint(.brand)
                .fontDesign(.default)
        }
    }
}

enum SpeakingMode: Hashable {
    case full
    case part(Int)
    case prompt(id: String, parent: String?)
}

enum WritingMode: Hashable {
    case full(variant: String) // academic | general
    case task1(variant: String) // academic | general
    case task2
    case prompt(id: String, parent: String?)
}

enum Route: Hashable {
    case speaking(SpeakingMode)
    case live
    case writing(WritingMode)
    case result([String])
    case bank(skill: String)
    case history(skill: String?)
    case mistakes(category: String?)
    case review
}

extension View {
    /// Guests can open the prompt bank; every other destination needs an account (a sign-in prompt stands in until they sign in).
    func appRoutes() -> some View {
        navigationDestination(for: Route.self) { route in
            switch route {
            case let .speaking(mode): SignInGate(icon: "mic", title: "Sign in to take a test", reason: "Sign in to take a test and save your results.") { SpeakingSessionView(mode: mode) }
            case .live: SignInGate(icon: "bubble.left.and.bubble.right", title: "Sign in to talk to the examiner", reason: "Sign in to take a test and save your results.") { LiveExamView() }
            case let .writing(mode): SignInGate(icon: "pencil.line", title: "Sign in to take a test", reason: "Sign in to take a test and save your results.") { WritingEditorView(mode: mode) }
            case let .result(ids): SignInGate(icon: "chart.bar", title: "Your results", reason: "Sign in to see your results and the mistakes behind them.") { ResultView(ids: ids) }
            case let .bank(skill): BankView(skill: skill)
            case let .history(skill): SignInGate(icon: "clock.arrow.circlepath", title: "Your history", reason: "Sign in to see every attempt and its band.") { HistoryView(skill: skill ?? "") }
            case let .mistakes(category): SignInGate(icon: "exclamationmark.triangle", title: "Your mistake log", reason: "Sign in to see the errors you repeat, grouped by type.") { MistakesView(category: category) }
            case .review: SignInGate(icon: "rectangle.on.rectangle.angled", title: "Your review deck", reason: "Sign in to turn your corrections into flashcards.") { ReviewView() }
            }
        }
    }
}

struct RootView: View {
    @Environment(APIClient.self) private var api
    @State private var error: String?

    var body: some View {
        Group {
            if !api.isSignedIn || api.me != nil || api.signingIn {
                MainTabs() // guests browse; personal screens ask them to sign in
            } else if let error {
                ContentUnavailableView {
                    Label("Can't load your account", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(error)
                } actions: {
                    Button("Retry") { Task { await load() } }.primaryButton()
                    Button("Sign out", role: .destructive) { api.signOutLocal() }
                }
            } else {
                ProgressView().task { await load() }
            }
        }
    }

    private func load() async {
        error = nil
        do { try await api.loadMe() } catch { self.error = error.localizedDescription }
    }
}

struct MainTabs: View {
    @Environment(APIClient.self) private var api
    @State private var tab = Demo.initialTab
    @State private var homePath = Demo.initialPath

    var body: some View {
        Group {
            // The system tab bar is Liquid Glass on iOS 26; on 26 it also tucks away while scrolling down.
            if #available(iOS 26.0, *) {
                tabs.tabBarMinimizeBehavior(.onScrollDown)
            } else {
                tabs
            }
        }
        .sheet(item: Binding(get: { api.signInRequest }, set: { api.signInRequest = $0 })) { LoginView(reason: $0.reason, signUp: $0.signUp) }
        .onAppear { if Demo.screen == "login" || Demo.screen == "guest-signin-sheet" { api.requestSignIn("Sign in to start a speaking test.") } }
    }

    private var tabs: some View {
        TabView(selection: $tab) {
            NavigationStack(path: $homePath) { HomeView().appRoutes() }
                .tabItem { Label("Home", systemImage: "house") }.tag(0)
            NavigationStack { SpeakingHomeView().appRoutes() }
                .tabItem { Label("Speaking", systemImage: "mic") }.tag(1)
            NavigationStack { WritingHomeView().appRoutes() }
                .tabItem { Label("Writing", systemImage: "pencil.line") }.tag(2)
            NavigationStack { SignInGate(icon: "rectangle.on.rectangle.angled", title: "Your review deck", reason: "Sign in to turn your corrections into flashcards.") { ReviewView() }.appRoutes() }
                .tabItem { Label("Review", systemImage: "rectangle.on.rectangle.angled") }.tag(3)
            NavigationStack { SettingsTab().appRoutes() }
                .tabItem { Label("Settings", systemImage: "gearshape") }.tag(4)
        }
    }
}
