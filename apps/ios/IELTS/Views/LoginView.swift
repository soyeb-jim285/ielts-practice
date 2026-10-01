import SwiftUI

/// Sign in and create account (web routes login and signup), with verification resend and a separate password reset sheet.
struct LoginView: View {
    @Environment(APIClient.self) private var api
    @State private var signUp = false
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var server = ""
    @State private var busy = false
    @State private var issue: Issue?
    @State private var info: String?
    @State private var sentTo: String? // sign-up needs email verification: "Check your email"
    @State private var showForgot = false

    private struct Issue {
        var message: String
        var unverified: String? // the email to resend verification to
        var exists = false // sign-up with an address that already has an account
    }

    private var canSubmit: Bool {
        !busy && !email.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty && (!signUp || (!name.trimmingCharacters(in: .whitespaces).isEmpty && password.count >= 8))
    }

    var body: some View {
        NavigationStack {
            Group {
                if let sentTo { checkEmail(sentTo) } else { form }
            }
            .background(Color.canvas)
            .navigationBarTitleDisplayMode(.inline)
        }
        .onAppear { server = api.baseURL }
        .sheet(isPresented: $showForgot) { ForgotPasswordSheet(email: email.trimmingCharacters(in: .whitespaces)) }
    }

    // MARK: Form

    private var form: some View {
        Form {
            Section {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 12) {
                        Image(systemName: "waveform.and.mic")
                            .font(.title2)
                            .foregroundStyle(.brand)
                            .frame(width: 48, height: 48)
                            .background(Color.brandSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .accessibilityHidden(true)
                        Text("IELTS Practice").font(.display(.title3))
                    }
                    Text(signUp ? "Create your account" : "Welcome back")
                        .font(.display(.largeTitle, weight: .bold))
                        .foregroundStyle(.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text(signUp ? "Timed Speaking and Writing practice with honest band feedback." : "Sign in to continue your practice.")
                        .foregroundStyle(.muted)
                }
                .padding(.vertical, 8)
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))

            Section {
                if signUp { TextField("Name", text: $name).textContentType(.name) }
                TextField("Email", text: $email)
                    .textContentType(.emailAddress).keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .onChange(of: email) { if issue?.exists == true { issue = nil } }
                SecureField("Password", text: $password).textContentType(signUp ? .newPassword : .password)
            } footer: {
                if signUp {
                    if password.count >= 8 {
                        Label("8 characters or more", systemImage: "checkmark.circle.fill").foregroundStyle(.goodText)
                    } else {
                        Text("At least 8 characters.")
                    }
                }
            }

            if let issue {
                Section {
                    ErrorLine(message: issue.message)
                    if let e = issue.unverified { Button("Resend verification email") { Task { await resend(e) } } }
                    if issue.exists { Button("Sign in instead") { switchMode() } }
                }
            }
            if let info {
                Section { Label(info, systemImage: "checkmark.circle.fill").foregroundStyle(.goodText) }
            }
            if !signUp {
                Section {
                    Button("Forgot password?") {
                        api.setBaseURL(server)
                        showForgot = true
                    }
                    .frame(minHeight: 44, alignment: .leading)
                }
            }
            Section {
                Button(signUp ? "Already have an account? Sign in" : "New here? Create an account") { switchMode() }
                    .frame(minHeight: 44, alignment: .leading)
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
        .canvasList()
        .demoScroll()
        .safeAreaInset(edge: .bottom) {
            Button {
                Task { await submit() }
            } label: {
                Group {
                    if busy { ProgressView() } else { Text(signUp ? "Create account" : "Sign in") }
                }
                .frame(maxWidth: .infinity, minHeight: 28)
            }
            .primaryButton()
            .controlSize(.large)
            .disabled(!canSubmit)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
    }

    // MARK: Check your email (after sign-up)

    private func checkEmail(_ address: String) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Image(systemName: "envelope.badge").font(.largeTitle).foregroundStyle(.brand).accessibilityHidden(true)
                Text("Check your email").font(.display(.largeTitle, weight: .bold)).foregroundStyle(.ink).accessibilityAddTraits(.isHeader)
                Text("One step left: verify your address.").foregroundStyle(.muted)
                Text("We sent a link to \(address). Open it on this device to continue. It can take a minute; check spam if it doesn't show up.")
                if let info { Label(info, systemImage: "checkmark.circle.fill").foregroundStyle(.goodText) }
                if let issue { ErrorLine(message: issue.message) }
                Button("Resend email") { Task { await resend(address) } }.secondaryButton().controlSize(.large)
                Button("Back to sign in") {
                    sentTo = nil
                    info = nil
                    issue = nil
                }
                .frame(minHeight: 44)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
        }
        .demoScroll()
    }

    // MARK: Actions

    private func switchMode() {
        signUp.toggle()
        issue = nil
        info = nil
    }

    private func submit() async {
        busy = true
        issue = nil
        info = nil
        defer { busy = false }
        api.setBaseURL(server)
        let address = email.trimmingCharacters(in: .whitespaces)
        do {
            if signUp {
                let signedIn = try await api.signUp(name: name.trimmingCharacters(in: .whitespaces), email: address, password: password)
                if !signedIn { sentTo = address }
            } else {
                try await api.signIn(email: address, password: password)
            }
        } catch is CancellationError {
        } catch let e as APIError {
            issue = describe(e, address)
        } catch {
            issue = Issue(message: signUp ? "Could not create the account." : "Could not sign in. Try again.")
        }
    }

    /// Web login/signup error copy; connection and server-URL problems keep the client's own wording (status 0).
    private func describe(_ e: APIError, _ address: String) -> Issue {
        if signUp {
            if e.status == 422 || e.message.localizedCaseInsensitiveContains("already exists") {
                return Issue(message: "An account with this email already exists.", exists: true)
            }
            return Issue(message: e.message.isEmpty ? "Could not create the account." : e.message)
        }
        if e.status == 403 || e.message.localizedCaseInsensitiveContains("not verified") {
            return Issue(message: "Please verify your email first. Check your inbox for the link.", unverified: address)
        }
        if e.status == 401 { return Issue(message: "That email and password don't match.") }
        return Issue(message: e.message.isEmpty ? "Could not sign in. Try again." : e.message)
    }

    private func resend(_ address: String) async {
        do {
            try await api.raw("POST", "/api/auth/send-verification-email", ["email": address, "callbackURL": api.baseURL + "/"])
            info = signUp || sentTo != nil ? "Sent again" : "Verification link sent to \(address)"
            issue = nil
        } catch is CancellationError {
        } catch {
            issue = Issue(message: "Could not send the email. Try again shortly.")
        }
    }
}

/// Password reset (web forgot-password): "Reset your password", then "Check your email". The emailed link opens the web app's reset page.
private struct ForgotPasswordSheet: View {
    @Environment(APIClient.self) private var api
    @Environment(\.dismiss) private var dismiss
    @State private var email: String
    @State private var busy = false
    @State private var error: String?
    @State private var sentTo: String?

    init(email: String) { _email = State(initialValue: email) }

    var body: some View {
        NavigationStack {
            Group {
                if let sentTo {
                    VStack(alignment: .leading, spacing: 16) {
                        Image(systemName: "envelope.badge").font(.largeTitle).foregroundStyle(.brand).accessibilityHidden(true)
                        Text("If an account exists for that address, a reset link is on its way.").foregroundStyle(.muted)
                        Text("We sent a link to \(sentTo). Open it on this device to continue. It can take a minute; check spam if it doesn't show up.")
                        Spacer(minLength: 0)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
                } else {
                    Form {
                        Section {
                            TextField("Email", text: $email)
                                .textContentType(.emailAddress).keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never).autocorrectionDisabled()
                        } footer: {
                            Text("Enter your account email and we'll send you a link.")
                        }
                        if let error { Section { ErrorLine(message: error) } }
                    }
                    .canvasList()
                    .safeAreaInset(edge: .bottom) {
                        Button {
                            Task { await send() }
                        } label: {
                            Group {
                                if busy { ProgressView() } else { Text("Send reset link") }
                            }
                            .frame(maxWidth: .infinity, minHeight: 28)
                        }
                        .primaryButton()
                        .controlSize(.large)
                        .disabled(busy || !email.contains("@"))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                    }
                }
            }
            .background(Color.canvas)
            .navigationTitle(sentTo == nil ? "Reset your password" : "Check your email")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(sentTo == nil ? "Cancel" : "Done") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func send() async {
        busy = true
        error = nil
        defer { busy = false }
        let address = email.trimmingCharacters(in: .whitespaces)
        do {
            try await api.requestPasswordReset(email: address)
            sentTo = address
        } catch is CancellationError {
        } catch {
            self.error = "Could not send the reset email. Try again."
        }
    }
}
