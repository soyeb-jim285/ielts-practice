import SwiftUI

struct LoginView: View {
    @Environment(APIClient.self) private var api
    @State private var signUp = false
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var server = ""
    @State private var busy = false
    @State private var error: String?
    @State private var info: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Image(systemName: "waveform.and.mic").font(.largeTitle).foregroundStyle(.brand)
                        Text("IELTS Practice").font(.largeTitle.bold())
                        Text("Speaking and Writing practice with honest, descriptor-based scoring.").foregroundStyle(.secondary)
                    }
                    .listRowBackground(Color.clear)
                }
                Section {
                    Picker("Mode", selection: $signUp) {
                        Text("Sign in").tag(false)
                        Text("Create account").tag(true)
                    }
                    .pickerStyle(.segmented)
                    if signUp { TextField("Name", text: $name).textContentType(.name) }
                    TextField("Email", text: $email)
                        .textContentType(.emailAddress).keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Password", text: $password).textContentType(signUp ? .newPassword : .password)
                }
                if let error { Section { ErrorLine(message: error) } }
                if let info { Section { Label(info, systemImage: "envelope.badge").foregroundStyle(.good) } }
                Section {
                    Button {
                        Task { await submit() }
                    } label: {
                        HStack { Spacer(); if busy { ProgressView() } else { Text(signUp ? "Create account" : "Sign in").bold() }; Spacer() }
                    }
                    .disabled(busy || email.isEmpty || password.count < 8 || (signUp && name.isEmpty))
                } footer: {
                    Text("Passwords need at least 8 characters.")
                }
                if !signUp {
                    Section {
                        Button("Forgot password?") { Task { await forgot() } }
                            .disabled(busy)
                    } footer: {
                        Text("We'll email you a link to set a new password.")
                    }
                }
                Section {
                    TextField("Server URL", text: $server)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .onSubmit { api.setBaseURL(server) }
                } header: {
                    Text("Server")
                } footer: {
                    Text("Self-hosting? Point the app at your server, e.g. https://ielts.example.com.")
                }
            }
            .onAppear { server = api.baseURL }
        }
    }

    private func submit() async {
        busy = true
        error = nil
        info = nil
        defer { busy = false }
        api.setBaseURL(server)
        do {
            if signUp {
                let signedIn = try await api.signUp(name: name, email: email, password: password)
                if !signedIn {
                    info = "Check your inbox to verify your email, then sign in."
                    signUp = false
                }
            } else {
                try await api.signIn(email: email, password: password)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Better Auth reset: the emailed link opens the web app's /reset-password on the same server.
    private func forgot() async {
        error = nil
        info = nil
        let email = email.trimmingCharacters(in: .whitespaces)
        guard email.contains("@") else { error = "Enter your account email above, then tap Forgot password."; return }
        busy = true
        defer { busy = false }
        api.setBaseURL(server)
        do {
            try await api.requestPasswordReset(email: email)
            info = "Check your email: if an account exists for \(email), a reset link is on its way."
        } catch {
            self.error = error.localizedDescription
        }
    }
}
