import SwiftUI

/// Sign-in sheet (web routes login and signup): sign in or create an account, then the emailed 6-digit code when the address needs verifying.
/// Shown over the tabs when a guest starts something personal; `reason` says what they were doing.
struct LoginView: View {
    @Environment(APIClient.self) private var api
    @Environment(\.dismiss) private var dismiss
    let reason: String?
    @State private var signUp: Bool
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var confirm = ""
    @State private var busy = false
    @State private var issue: Issue?
    @State private var info: String?
    @State private var verifying: String? // address that still needs its code
    @State private var showForgot = false

    private struct Issue {
        var message: String
        var exists = false // sign-up with an address that already has an account
    }

    init(reason: String? = nil, signUp: Bool = false) {
        self.reason = reason
        _signUp = State(initialValue: signUp)
    }

    private var mismatch: Bool { signUp && !confirm.isEmpty && confirm != password }

    private var canSubmit: Bool {
        !busy && !email.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty
            && (!signUp || (!name.trimmingCharacters(in: .whitespaces).isEmpty && password.count >= 8 && confirm == password))
    }

    var body: some View {
        NavigationStack {
            Group {
                if let verifying {
                    VerifyEmailView(email: verifying) { finish() }
                } else {
                    form
                }
            }
            .background(Color.canvas)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Not now") { finish() } }
            }
        }
        .sheet(isPresented: $showForgot) {
            ForgotPasswordSheet(email: email.trimmingCharacters(in: .whitespaces)) {
                info = "Password updated. Sign in with your new password."
                password = ""
            }
        }
    }

    private func finish() {
        api.signInRequest = nil
        dismiss()
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
                    Text(reason ?? (signUp ? "Timed Speaking and Writing practice with honest band feedback." : "Sign in to continue your practice."))
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
                if signUp { SecureField("Confirm password", text: $confirm).textContentType(.newPassword) }
            } footer: {
                if signUp {
                    VStack(alignment: .leading, spacing: 4) {
                        if password.count >= 8 {
                            Label("8 characters or more", systemImage: "checkmark.circle.fill").foregroundStyle(.goodText)
                        } else {
                            Text("At least 8 characters.")
                        }
                        if mismatch {
                            Label("The two passwords don't match.", systemImage: "exclamationmark.circle.fill").foregroundStyle(.bad)
                        }
                    }
                }
            }

            if let issue {
                Section {
                    ErrorLine(message: issue.message)
                    if issue.exists { Button("Sign in instead") { switchMode() } }
                }
            }
            if let info {
                Section { Label(info, systemImage: "checkmark.circle.fill").foregroundStyle(.goodText) }
            }
            if !signUp {
                Section {
                    Button("Forgot password?") { showForgot = true }
                        .frame(minHeight: 44, alignment: .leading)
                }
            }
            Section {
                Button(signUp ? "Already have an account? Sign in" : "New here? Create an account") { switchMode() }
                    .frame(minHeight: 44, alignment: .leading)
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

    // MARK: Actions

    private func switchMode() {
        signUp.toggle()
        issue = nil
        info = nil
        confirm = ""
    }

    private func submit() async {
        busy = true
        issue = nil
        info = nil
        defer { busy = false }
        let address = email.trimmingCharacters(in: .whitespaces)
        do {
            if signUp {
                let signedIn = try await api.signUp(name: name.trimmingCharacters(in: .whitespaces), email: address, password: password)
                if signedIn { finish() } else { verifying = address } // the server emailed a code
            } else {
                try await api.signIn(email: address, password: password)
                finish()
            }
        } catch is CancellationError {
        } catch let e as APIError {
            if !signUp, e.code == "EMAIL_NOT_VERIFIED" || e.status == 403 {
                try? await api.sendOTP(email: address, type: "email-verification")
                verifying = address
            } else {
                issue = describe(e)
            }
        } catch {
            issue = Issue(message: signUp ? "Could not create the account." : "Could not sign in. Try again.")
        }
    }

    /// Web login/signup error copy; connection and server problems keep the client's own wording (status 0).
    private func describe(_ e: APIError) -> Issue {
        if signUp {
            if e.status == 422 || e.message.localizedCaseInsensitiveContains("already exists") {
                return Issue(message: "An account with this email already exists.", exists: true)
            }
            return Issue(message: e.message.isEmpty ? "Could not create the account." : e.message)
        }
        if e.status == 401 { return Issue(message: "That email and password don't match.") }
        return Issue(message: e.message.isEmpty ? "Could not sign in. Try again." : e.message)
    }
}

/// "Enter the code we emailed you": a correct code verifies the address and signs the user in.
private struct VerifyEmailView: View {
    @Environment(APIClient.self) private var api
    let email: String
    let onVerified: () -> Void
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                VStack(alignment: .leading, spacing: 12) {
                    Image(systemName: "envelope.badge").font(.largeTitle).foregroundStyle(.brand).accessibilityHidden(true)
                    Text("Verify your email").font(.display(.largeTitle, weight: .bold)).foregroundStyle(.ink).accessibilityAddTraits(.isHeader)
                    Text("We sent a 6-digit code to \(email). It expires in 10 minutes; check spam if it doesn't show up.").foregroundStyle(.muted)
                }
                .padding(.vertical, 8)
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))

            Section {
                CodeField(code: $code)
                if let error { ErrorLine(message: error) }
            }
            Section { ResendCodeButton { try await api.sendOTP(email: email, type: "email-verification") } }
        }
        .canvasList()
        .demoScroll()
        .safeAreaInset(edge: .bottom) {
            Button {
                Task { await verify() }
            } label: {
                Group {
                    if busy { ProgressView() } else { Text("Verify email") }
                }
                .frame(maxWidth: .infinity, minHeight: 28)
            }
            .primaryButton()
            .controlSize(.large)
            .disabled(busy || code.count < 6)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
    }

    private func verify() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await api.verifyEmail(email: email, otp: code)
            onVerified()
        } catch is CancellationError {
        } catch let e as APIError {
            error = AuthText.otpError(e)
        } catch {
            self.error = "Something went wrong. Try again."
        }
    }
}

/// Six-digit code entry, shown as six boxes (like the web's shadcn InputOTP). One hidden field takes the input, so the keyboard's
/// one-time-code suggestion from the email, paste and Backspace all work; the boxes only display it. Digits only.
private struct CodeField: View {
    @Binding var code: String
    @FocusState private var focused: Bool

    var body: some View {
        let chars = Array(code)
        ZStack {
            TextField("", text: $code)
                .textContentType(.oneTimeCode)
                .keyboardType(.numberPad)
                .focused($focused)
                .foregroundStyle(.clear)
                .tint(.clear)
                .opacity(0.02)
                .onChange(of: code) { _, new in
                    let digits = AuthText.otpDigits(new)
                    if digits != new { code = digits }
                }
                .accessibilityLabel("6-digit code")
            HStack(spacing: 8) {
                ForEach(0..<6, id: \.self) { i in
                    let active = focused && i == min(chars.count, 5)
                    Text(i < chars.count ? String(chars[i]) : "")
                        .font(.system(.title2, design: .monospaced).weight(.medium))
                        .foregroundStyle(.ink)
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background(.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .strokeBorder(active ? Color.brand : Color.line, lineWidth: active ? 2 : 1)
                        )
                }
            }
            .contentShape(Rectangle())
            .onTapGesture { focused = true }
            .accessibilityHidden(true)
        }
        .onAppear { focused = true }
    }
}

/// "Resend code" with a 30 s cooldown that starts now (a code was just sent); the server sends at most one email per address every 30 s.
private struct ResendCodeButton: View {
    let send: () async throws -> Void
    @State private var wait = 30
    @State private var failed = false

    var body: some View {
        Button(wait > 0 ? "Resend code in \(wait)s" : "Resend code") {
            wait = 30
            Task {
                do { try await send(); failed = false } catch is CancellationError {} catch { failed = true }
            }
        }
        .disabled(wait > 0)
        .frame(minHeight: 44, alignment: .leading)
        .task(id: wait) {
            guard wait > 0 else { return }
            try? await Task.sleep(for: .seconds(1))
            if !Task.isCancelled { wait -= 1 }
        }
        if failed { ErrorLine(message: "Could not send the code. Try again shortly.") }
    }
}

/// Password reset (web forgot-password): the address, then the emailed 6-digit code with the new password. The answer never says whether the address has an account.
private struct ForgotPasswordSheet: View {
    @Environment(APIClient.self) private var api
    @Environment(\.dismiss) private var dismiss
    let onDone: () -> Void
    @State private var email: String
    @State private var sentTo: String?
    @State private var code = ""
    @State private var password = ""
    @State private var confirm = ""
    @State private var busy = false
    @State private var error: String?

    init(email: String, onDone: @escaping () -> Void) {
        _email = State(initialValue: email)
        self.onDone = onDone
    }

    private var mismatch: Bool { !confirm.isEmpty && confirm != password }
    private var canReset: Bool { !busy && code.count == 6 && password.count >= 8 && confirm == password }

    var body: some View {
        NavigationStack {
            Group {
                if let sentTo { codeForm(sentTo) } else { emailForm }
            }
            .background(Color.canvas)
            .navigationTitle(sentTo == nil ? "Reset your password" : "Enter your code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
        .presentationDetents([.large])
    }

    private var emailForm: some View {
        Form {
            Section {
                TextField("Email", text: $email)
                    .textContentType(.emailAddress).keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
            } footer: {
                Text("Enter your account email and we'll send you a 6-digit code.")
            }
            if let error { Section { ErrorLine(message: error) } }
        }
        .canvasList()
        .safeAreaInset(edge: .bottom) { bottomButton("Send code", enabled: !busy && email.contains("@")) { await sendCode() } }
    }

    private func codeForm(_ address: String) -> some View {
        Form {
            Section {
                CodeField(code: $code)
            } header: {
                Text("If an account exists for \(address), we sent it a 6-digit code. It expires in 10 minutes.").textCase(nil)
            }
            Section {
                SecureField("New password", text: $password).textContentType(.newPassword)
                SecureField("Confirm password", text: $confirm).textContentType(.newPassword)
            } footer: {
                VStack(alignment: .leading, spacing: 4) {
                    if password.count >= 8 {
                        Label("8 characters or more", systemImage: "checkmark.circle.fill").foregroundStyle(.goodText)
                    } else {
                        Text("At least 8 characters.")
                    }
                    if mismatch { Label("The two passwords don't match.", systemImage: "exclamationmark.circle.fill").foregroundStyle(.bad) }
                }
            }
            if let error { Section { ErrorLine(message: error) } }
            Section {
                ResendCodeButton { try await api.sendOTP(email: address, type: "forget-password") }
                Button("Use a different email") {
                    sentTo = nil
                    code = ""
                    error = nil
                }
                .frame(minHeight: 44, alignment: .leading)
            }
        }
        .canvasList()
        .safeAreaInset(edge: .bottom) { bottomButton("Update password", enabled: canReset) { await reset(address) } }
    }

    private func bottomButton(_ title: String, enabled: Bool, action: @escaping () async -> Void) -> some View {
        Button {
            Task { await action() }
        } label: {
            Group {
                if busy { ProgressView() } else { Text(title) }
            }
            .frame(maxWidth: .infinity, minHeight: 28)
        }
        .primaryButton()
        .controlSize(.large)
        .disabled(!enabled)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    private func sendCode() async {
        busy = true
        error = nil
        defer { busy = false }
        let address = email.trimmingCharacters(in: .whitespaces)
        do {
            try await api.sendOTP(email: address, type: "forget-password")
            sentTo = address
        } catch is CancellationError {
        } catch let e as APIError {
            error = AuthText.otpError(e)
        } catch {
            self.error = "Could not send the code. Try again."
        }
    }

    private func reset(_ address: String) async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await api.resetPassword(email: address, otp: code, password: password)
            onDone()
            dismiss()
        } catch is CancellationError {
        } catch let e as APIError {
            error = AuthText.otpError(e)
        } catch {
            self.error = "Could not reset the password. Try again."
        }
    }
}
