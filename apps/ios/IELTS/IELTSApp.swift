import SwiftUI

@main
struct IELTSApp: App {
    @State private var api = APIClient()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(api)
                .tint(.brand)
        }
    }
}

enum SpeakingMode: Hashable {
    case full
    case part(Int)
    case prompt(id: String, parent: String?)
}

enum WritingMode: Hashable {
    case full
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
    case history
    case mistakes(category: String?)
}

extension View {
    func appRoutes() -> some View {
        navigationDestination(for: Route.self) { route in
            switch route {
            case let .speaking(mode): SpeakingSessionView(mode: mode)
            case .live: LiveExamView()
            case let .writing(mode): WritingEditorView(mode: mode)
            case let .result(ids): ResultView(ids: ids)
            case let .bank(skill): BankView(skill: skill)
            case .history: HistoryView()
            case let .mistakes(category): MistakesView(category: category)
            }
        }
    }
}

struct RootView: View {
    @Environment(APIClient.self) private var api
    @State private var error: String?

    var body: some View {
        Group {
            if !api.isSignedIn {
                LoginView()
            } else if api.me != nil {
                MainTabs()
            } else if let error {
                ContentUnavailableView {
                    Label("Can't load your account", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(error)
                } actions: {
                    Button("Retry") { Task { await load() } }.buttonStyle(.borderedProminent)
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
    var body: some View {
        TabView {
            NavigationStack { DashboardView().appRoutes() }
                .tabItem { Label("Home", systemImage: "house") }
            NavigationStack { SpeakingHomeView().appRoutes() }
                .tabItem { Label("Speaking", systemImage: "mic") }
            NavigationStack { WritingHomeView().appRoutes() }
                .tabItem { Label("Writing", systemImage: "pencil.line") }
            NavigationStack { ReviewView().appRoutes() }
                .tabItem { Label("Review", systemImage: "rectangle.on.rectangle.angled") }
            NavigationStack { SettingsView().appRoutes() }
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
    }
}
