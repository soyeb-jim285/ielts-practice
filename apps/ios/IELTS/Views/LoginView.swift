import SwiftUI

/// Sign-in sheet (web routes login, signup, forgot-password on components/layout/AuthLayout): sign in or create an account, the emailed
/// 6-digit code when the address needs verifying, and the password reset. Shown over the tabs when a guest starts something personal;
/// `reason` replaces the lede so they see what they were doing.
struct LoginView: View {
    @Environment(APIClient.self) private var api
    @Environment(\.dismiss) private var dismiss
    let reason: String?
    @State private var signUp: Bool
    @State private var step: Step = .form
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var confirm = ""
    @State private var busy = false
    @State private var error: String? // the alert at the top
    @State private var exists = false // sign-up with an address that already has an account (shown under Email)
    @State private var problems: [AuthKey: String] = [:] // why the form can't be sent (shown under each field)
    @State private var info: String?
    @State private var confirmLeft = false // the confirm field was left once: a mismatch shows from then on (web PasswordPair)
    @FocusState private var focus: AuthKey?

    private enum Step {
        case form
        case verify(email: String, token: String?)
        case forgot
    }

    init(reason: String? = nil, signUp: Bool = false) {
        self.reason = reason
        _signUp = State(initialValue: signUp)
    }

    var body: some View {
        Group {
            switch step {
            case .form: form
            case let .verify(address, token):
                AuthScreen(title: signUp ? "Check your email" : "Verify your email",
                           lede: signUp ? "One step left: verify your address." : "One step left before you can sign in.", onClose: finish) {
                    VerifyEmailView(email: address, token: token) { finish() }
                } footer: {
                    footerLink("Wrong address?", "Use a different email") { step = .form }
                }
            case .forgot:
                ForgotPasswordView(email: email.trimmingCharacters(in: .whitespaces), onClose: finish) {
                    step = .form
                } onDone: {
                    step = .form
                    password = ""
                    info = "Password updated. Sign in with your new password."
                }
            }
        }
        .inAppBrowser() // the terms and privacy links
    }

    private func finish() {
        api.signInRequest = nil
        dismiss()
    }

    // MARK: Form

    private var form: some View {
        AuthScreen(title: signUp ? "Create your account" : "Welcome back",
                   lede: reason ?? (signUp ? "Timed Speaking and Writing practice with honest band feedback." : "Sign in to continue your practice."),
                   onClose: finish) {
            VStack(alignment: .leading, spacing: 18) {
                if let error { AuthAlert(message: error) }
                if let info { AuthAlert(message: info, good: true) }
                if signUp {
                    AuthField("Name", key: .name, focus: focus, error: problems[.name]) {
                        TextField("", text: $name)
                            .textContentType(.name).textInputAutocapitalization(.words)
                            .focused($focus, equals: .name).submitLabel(.next).onSubmit { focus = .email }
                    }
                }
                AuthField("Email", key: .email, focus: focus,
                          error: exists ? "An account with this email already exists." : problems[.email],
                          action: exists ? (title: "Sign in instead", run: { switchMode() }) : nil) {
                    TextField("", text: $email)
                        .textContentType(.emailAddress).keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .focused($focus, equals: .email).submitLabel(.next).onSubmit { focus = .password }
                        .onChange(of: email) { exists = false; problems[.email] = nil }
                }
                VStack(alignment: .trailing, spacing: 6) {
                    AuthField("Password", key: .password, focus: focus, error: problems[.password],
                              hint: signUp ? AuthCheck.passwordHint(password) : nil) {
                        SecureField("", text: $password)
                            .textContentType(signUp ? .newPassword : .password)
                            .focused($focus, equals: .password).submitLabel(signUp ? .next : .go)
                            .onSubmit { if signUp { focus = .confirm } else { Task { await submit() } } }
                            .onChange(of: password) { problems[.password] = nil }
                    }
                    if !signUp {
                        Button("Forgot password?") { step = .forgot }
                            .font(.subheadline.weight(.medium))
                            .frame(minHeight: 44)
                    }
                }
                if signUp {
                    AuthField("Confirm password", key: .confirm, focus: focus,
                              error: problems[.confirm] ?? (confirmLeft ? AuthCheck.confirm(password, confirm) : nil)) {
                        SecureField("", text: $confirm)
                            .textContentType(.newPassword)
                            .focused($focus, equals: .confirm).submitLabel(.go).onSubmit { Task { await submit() } }
                            .onChange(of: confirm) { problems[.confirm] = nil }
                    }
                }
                AuthButton(title: signUp ? "Create account" : "Sign in", busy: busy) { await submit() }
                    .padding(.top, 6)
                if signUp {
                    Text(AuthCheck.termsLine)
                        .font(.caption).foregroundStyle(.muted)
                        .multilineTextAlignment(.center).frame(maxWidth: .infinity)
                }
            }
            .onChange(of: focus) { old, _ in
                if old == .confirm, !confirm.isEmpty { confirmLeft = true }
            }
        } footer: {
            if signUp {
                footerLink("Already have an account?", "Sign in") { switchMode() }
            } else {
                footerLink("New here?", "Create an account") { switchMode() }
            }
        }
    }

    private func footerLink(_ lead: String, _ title: String, _ action: @escaping () -> Void) -> some View {
        HStack(spacing: 4) {
            Text(lead).foregroundStyle(.muted)
            Button(title, action: action).fontWeight(.medium).frame(minHeight: 44)
        }
        .font(.subheadline)
    }

    // MARK: Actions

    private func switchMode() {
        signUp.toggle()
        error = nil
        info = nil
        exists = false
        problems = [:]
        confirm = ""
        confirmLeft = false
    }

    private func submit() async {
        guard !busy else { return }
        error = nil
        info = nil
        exists = false
        problems = AuthCheck.problems(signUp: signUp, name: name, email: email, password: password, confirm: confirm)
        if let first = AuthKey.allCases.first(where: { problems[$0] != nil }) {
            focus = first // VoiceOver lands on the field and reads why
            return
        }
        busy = true
        defer { busy = false }
        let address = email.trimmingCharacters(in: .whitespaces)
        do {
            if signUp {
                let signedIn = try await api.signUp(name: name.trimmingCharacters(in: .whitespaces), email: address, password: password)
                if signedIn { finish() } else { step = .verify(email: address, token: api.emailStatusToken) } // the server emailed a code
            } else {
                try await api.signIn(email: address, password: password)
                finish()
            }
        } catch is CancellationError {
        } catch let e as APIError {
            if !signUp, e.code == "EMAIL_NOT_VERIFIED" || e.status == 403 {
                let token = try? await api.sendOTP(email: address, type: "email-verification")
                step = .verify(email: address, token: token)
            } else if signUp, e.code == "USER_ALREADY_EXISTS" || e.status == 422 || e.message.localizedCaseInsensitiveContains("already exists") {
                exists = true
                focus = .email
            } else {
                error = describe(e)
            }
        } catch {
            self.error = signUp ? "Could not create the account." : "Could not sign in. Try again."
        }
    }

    /// Web login/signup error copy; connection and server problems keep the client's own wording (status 0).
    private func describe(_ e: APIError) -> String {
        if signUp { return e.message.isEmpty ? "Could not create the account." : e.message }
        if e.status == 401 { return "That email and password don't match." }
        return e.message.isEmpty ? "Could not sign in. Try again." : e.message
    }
}

/// Client-side checks before a sign-in, sign-up or reset is sent (web: the browser's required / type=email checks plus PasswordPair).
/// The button stays enabled; pressing it shows why the form can't go yet under each field.
enum AuthCheck {
    static func email(_ raw: String) -> String? {
        let s = raw.trimmingCharacters(in: .whitespaces)
        if s.isEmpty { return "Enter your email address." }
        let parts = s.split(separator: "@", omittingEmptySubsequences: false)
        let ok = parts.count == 2 && !parts[0].isEmpty && !s.contains(" ")
            && parts[1].contains(".") && !parts[1].hasPrefix(".") && !parts[1].hasSuffix(".")
        return ok ? nil : "Enter a valid email address, like name@example.com."
    }

    /// A new password (sign-up, reset): 8 to 128 characters, like the server.
    static func newPassword(_ p: String) -> String? {
        if p.isEmpty { return "Choose a password of at least 8 characters." }
        if p.count < 8 { return "Use at least 8 characters. This one has \(p.count)." }
        if p.count > 128 { return "Use 128 characters or fewer." }
        return nil
    }

    static func confirm(_ password: String, _ confirm: String) -> String? {
        if confirm.isEmpty { return password.isEmpty ? nil : "Type the password again." }
        return confirm == password ? nil : "The two passwords don't match."
    }

    static func problems(signUp: Bool, name: String, email: String, password: String, confirm: String) -> [AuthKey: String] {
        var out: [AuthKey: String] = [:]
        if signUp, name.trimmingCharacters(in: .whitespaces).isEmpty { out[.name] = "Enter your name." }
        out[.email] = self.email(email)
        if signUp {
            out[.password] = newPassword(password)
            out[.confirm] = self.confirm(password, confirm)
        } else if password.isEmpty {
            out[.password] = "Enter your password."
        }
        return out
    }

    /// Under a new password: the rule, then a check mark once it is met (web PasswordPair).
    static func passwordHint(_ p: String) -> AuthHint {
        p.count >= 8 ? AuthHint(text: "8 characters or more", met: true) : AuthHint(text: "At least 8 characters.", met: false)
    }

    @MainActor static var termsLine: AttributedString {
        let s = APIClient.server
        let plain = "By creating an account you agree to the terms and privacy policy."
        return (try? AttributedString(markdown: "By creating an account you agree to the [terms](\(s)/terms) and [privacy policy](\(s)/privacy).")) ?? AttributedString(plain)
    }
}

/// Signed-out page frame (web AuthLayout): logo, serif title and lede, the form, then a hairline and the footer link. Full-bleed on the canvas,
/// no navigation bar; "Not now" closes the sheet.
private struct AuthScreen<Content: View, Footer: View>: View {
    let title: String
    let lede: String
    let onClose: () -> Void
    let content: Content
    let footer: Footer

    init(title: String, lede: String, onClose: @escaping () -> Void, @ViewBuilder content: () -> Content, @ViewBuilder footer: () -> Footer) {
        self.title = title
        self.lede = lede
        self.onClose = onClose
        self.content = content()
        self.footer = footer()
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    // NextBand logo (Assets.xcassets, light/dark vector)
                    Image("Logo").resizable().scaledToFit().frame(height: 28).accessibilityLabel("NextBand")
                    Spacer()
                    Button("Not now", action: onClose).font(.body.weight(.medium)).frame(minHeight: 44)
                }
                Text(title)
                    .font(.display(.largeTitle, weight: .semibold))
                    .foregroundStyle(.ink)
                    .accessibilityAddTraits(.isHeader)
                    .padding(.top, 36)
                Text(lede)
                    .font(.title3)
                    .foregroundStyle(.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 8)
                content.padding(.top, 28)
                Rectangle().fill(Color.line).frame(height: 1).padding(.top, 28).accessibilityHidden(true)
                footer.padding(.top, 14)
            }
            .frame(maxWidth: 420, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 32)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .demoScroll()
        .background(Color.canvas.ignoresSafeArea())
    }
}

enum AuthKey: CaseIterable { case name, email, password, confirm }
struct AuthHint { let text: String; let met: Bool }

/// Labelled input (web ui/Input): label above, the field on a surface with a hairline (brand while focused, rose with an error),
/// then the error (with an optional action, "Sign in instead") or the hint. The visible label is for sight; VoiceOver gets it on the field.
struct AuthField<Input: View>: View {
    let label: String
    let focused: Bool
    let error: String?
    let hint: AuthHint?
    let action: (title: String, run: () -> Void)?
    let input: Input

    init(_ label: String, key: AuthKey? = nil, focus: AuthKey? = nil, error: String? = nil, hint: AuthHint? = nil,
         action: (title: String, run: () -> Void)? = nil, @ViewBuilder input: () -> Input) {
        self.label = label
        self.focused = key != nil && key == focus
        self.error = error
        self.hint = hint
        self.action = action
        self.input = input()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.subheadline.weight(.medium)).foregroundStyle(.ink).accessibilityHidden(true)
            input
                .foregroundStyle(.ink)
                .padding(.horizontal, 12)
                .frame(minHeight: 48)
                .background(.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(error != nil ? Color.bad : focused ? Color.brand : Color.line, lineWidth: error != nil || focused ? 2 : 1)
                )
                .accessibilityLabel(label)
                .accessibilityHint(error ?? hint?.text ?? "")
            if let error {
                VStack(alignment: .leading, spacing: 0) {
                    Label(error, systemImage: "exclamationmark.circle.fill")
                        .font(.footnote).foregroundStyle(.bad)
                        .fixedSize(horizontal: false, vertical: true)
                    if let action { Button(action.title, action: action.run).font(.footnote.weight(.semibold)).frame(minHeight: 44) }
                }
            } else if let hint {
                if hint.met {
                    Label(hint.text, systemImage: "checkmark.circle.fill").font(.footnote).foregroundStyle(.goodText)
                } else {
                    Text(hint.text).font(.footnote).foregroundStyle(.muted)
                }
            }
        }
    }
}

/// The general error (or a success note) at the top of a form (web ui/Alert).
private struct AuthAlert: View {
    let message: String
    var good = false

    var body: some View {
        let tone = good ? Color.goodText : Color.bad
        Label(message, systemImage: good ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
            .font(.callout)
            .foregroundStyle(tone)
            .fixedSize(horizontal: false, vertical: true)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(tone.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(tone.opacity(0.35)))
            .accessibilityElement(children: .combine)
    }
}

/// Full-width primary action; a spinner while it runs. Never disabled for an incomplete form: pressing it says what is missing.
private struct AuthButton: View {
    let title: String
    let busy: Bool
    let action: () async -> Void

    var body: some View {
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
        .disabled(busy)
    }
}

/// "Enter the code we emailed you": a correct code verifies the address and signs the user in.
private struct VerifyEmailView: View {
    @Environment(APIClient.self) private var api
    let email: String
    let token: String?
    let onVerified: () -> Void
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Image(systemName: "envelope.badge").font(.title2).foregroundStyle(.brand).accessibilityHidden(true)
            Text("Enter the 6-digit code for \(Text(email).fontWeight(.semibold)). It expires in 10 minutes.")
                .foregroundStyle(.ink)
            VStack(alignment: .leading, spacing: 6) {
                CodeField(code: $code, invalid: error != nil)
                    .onChange(of: code) { error = nil }
                if let error {
                    Label(error, systemImage: "exclamationmark.circle.fill").font(.footnote).foregroundStyle(.bad)
                }
            }
            AuthButton(title: "Verify email", busy: busy) { await verify() }
            VStack(alignment: .leading, spacing: 0) {
                CodeDelivery(token: token) { try await api.sendOTP(email: email, type: "email-verification") }
            }
        }
    }

    private func verify() async {
        if code.count < 6 { error = "Enter all 6 digits."; return }
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
    var invalid = false
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
                                .strokeBorder(invalid ? Color.bad : active ? Color.brand : Color.line, lineWidth: active || invalid ? 2 : 1)
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

/// Delivery status plus "Resend code" with a live countdown. `token` is the status token of the request that sent the first code (nil when that call failed);
/// the status is polled every 2 s for 20 s after each send so a late failure shows up. Screenshots (demo) show a sample and never poll.
private struct CodeDelivery: View {
    @Environment(APIClient.self) private var api
    let send: () async throws -> String?
    @State private var token: String?
    @State private var status: EmailStatus?
    @State private var wait = 0
    @State private var sendFailed: Bool

    init(token: String?, send: @escaping () async throws -> String?) {
        self.send = send
        _token = State(initialValue: token)
        _sendFailed = State(initialValue: token == nil && !Demo.on)
        if Demo.on {
            _status = State(initialValue: EmailStatus(status: "sent", sentAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-40)), maskedEmail: "m•••@example.com"))
        }
    }

    private var shown: EmailStatus? {
        if sendFailed { return EmailStatus(status: "failed", error: "network") }
        guard var s = status else { return nil }
        s.resendAvailableIn = wait
        return s
    }

    var body: some View {
        let line = AuthText.statusLine(shown)
        Label {
            Text(line.text)
        } icon: {
            Image(systemName: line.failed ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
        }
        .font(.footnote)
        .foregroundStyle(line.failed ? Color.bad : (shown?.status == "sent" ? Color.goodText : Color.muted))
        .accessibilityElement(children: .combine)
        Button(wait > 0 ? "Resend code in \(wait)s" : "Resend code") {
            Task {
                sendFailed = false
                do {
                    if let t = try await send() { status = nil; token = t } else { sendFailed = true }
                } catch is CancellationError {} catch { sendFailed = true }
            }
        }
        .disabled(wait > 0)
        .frame(minHeight: 44, alignment: .leading)
        .task(id: token) {
            guard !Demo.on, let token else { return }
            for _ in 0..<10 {
                if let s = try? await api.emailStatus(token: token) {
                    status = s
                    wait = s.resendAvailableIn
                }
                try? await Task.sleep(for: .seconds(2))
                if Task.isCancelled { return }
            }
        }
        .task(id: wait) {
            guard wait > 0 else { return }
            try? await Task.sleep(for: .seconds(1))
            if !Task.isCancelled { wait -= 1 }
        }
    }
}

/// Password reset (web forgot-password): the address, then the emailed 6-digit code with the new password, in the same sign-in frame.
/// The answer never says whether the address has an account.
private struct ForgotPasswordView: View {
    @Environment(APIClient.self) private var api
    let onClose: () -> Void
    let onBack: () -> Void
    let onDone: () -> Void
    @State private var email: String
    @State private var sentTo: String?
    @State private var statusToken: String?
    @State private var code = ""
    @State private var password = ""
    @State private var confirm = ""
    @State private var busy = false
    @State private var error: String? // the alert at the top
    @State private var codeError: String? // wrong, expired or incomplete code (under the boxes)
    @State private var problems: [AuthKey: String] = [:]
    @State private var confirmLeft = false
    @FocusState private var focus: AuthKey?

    init(email: String, onClose: @escaping () -> Void, onBack: @escaping () -> Void, onDone: @escaping () -> Void) {
        _email = State(initialValue: email)
        self.onClose = onClose
        self.onBack = onBack
        self.onDone = onDone
    }

    var body: some View {
        if let sentTo {
            AuthScreen(title: "Enter your code", lede: "If an account exists for \(sentTo), we sent it a 6-digit code. It expires in 10 minutes.", onClose: onClose) {
                codeForm(sentTo)
            } footer: { back }
        } else {
            AuthScreen(title: "Reset your password", lede: "Enter your account email and we'll send you a 6-digit code.", onClose: onClose) {
                emailForm
            } footer: { back }
        }
    }

    private var back: some View {
        Button("Back to sign in", action: onBack).font(.subheadline.weight(.medium)).frame(minHeight: 44)
    }

    private var emailForm: some View {
        VStack(alignment: .leading, spacing: 18) {
            if let error { AuthAlert(message: error) }
            AuthField("Email", key: .email, focus: focus, error: problems[.email]) {
                TextField("", text: $email)
                    .textContentType(.emailAddress).keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .focused($focus, equals: .email).submitLabel(.send).onSubmit { Task { await sendCode() } }
                    .onChange(of: email) { problems[.email] = nil }
            }
            AuthButton(title: "Send code", busy: busy) { await sendCode() }.padding(.top, 6)
        }
    }

    private func codeForm(_ address: String) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            if let error { AuthAlert(message: error) }
            VStack(alignment: .leading, spacing: 6) {
                CodeField(code: $code, invalid: codeError != nil)
                    .onChange(of: code) { codeError = nil }
                if let codeError {
                    Label(codeError, systemImage: "exclamationmark.circle.fill").font(.footnote).foregroundStyle(.bad)
                }
            }
            AuthField("New password", key: .password, focus: focus, error: problems[.password], hint: AuthCheck.passwordHint(password)) {
                SecureField("", text: $password)
                    .textContentType(.newPassword)
                    .focused($focus, equals: .password).submitLabel(.next).onSubmit { focus = .confirm }
                    .onChange(of: password) { problems[.password] = nil }
            }
            AuthField("Confirm password", key: .confirm, focus: focus,
                      error: problems[.confirm] ?? (confirmLeft ? AuthCheck.confirm(password, confirm) : nil)) {
                SecureField("", text: $confirm)
                    .textContentType(.newPassword)
                    .focused($focus, equals: .confirm).submitLabel(.go).onSubmit { Task { await reset(address) } }
                    .onChange(of: confirm) { problems[.confirm] = nil }
            }
            AuthButton(title: "Update password", busy: busy) { await reset(address) }.padding(.top, 6)
            VStack(alignment: .leading, spacing: 0) {
                CodeDelivery(token: statusToken) { try await api.sendOTP(email: address, type: "forget-password") }
                Button("Use a different email") {
                    sentTo = nil
                    code = ""
                    error = nil
                    codeError = nil
                }
                .frame(minHeight: 44, alignment: .leading)
            }
        }
        .onChange(of: focus) { old, _ in
            if old == .confirm, !confirm.isEmpty { confirmLeft = true }
        }
    }

    private func sendCode() async {
        guard !busy else { return }
        error = nil
        problems = [:]
        if let why = AuthCheck.email(email) {
            problems[.email] = why
            focus = .email
            return
        }
        busy = true
        defer { busy = false }
        let address = email.trimmingCharacters(in: .whitespaces)
        do {
            statusToken = try await api.sendOTP(email: address, type: "forget-password")
            sentTo = address
        } catch is CancellationError {
        } catch let e as APIError {
            error = AuthText.otpError(e)
        } catch {
            self.error = "Could not send the code. Try again."
        }
    }

    private func reset(_ address: String) async {
        guard !busy else { return }
        error = nil
        if code.count < 6 { codeError = "Enter all 6 digits." }
        problems = [:]
        problems[.password] = AuthCheck.newPassword(password)
        problems[.confirm] = AuthCheck.confirm(password, confirm)
        if codeError != nil { return }
        if let first = AuthKey.allCases.first(where: { problems[$0] != nil }) {
            focus = first
            return
        }
        busy = true
        defer { busy = false }
        do {
            try await api.resetPassword(email: address, otp: code, password: password)
            onDone()
        } catch is CancellationError {
        } catch let e as APIError {
            if ["INVALID_OTP", "OTP_EXPIRED", "TOO_MANY_ATTEMPTS"].contains(e.code ?? "") { codeError = AuthText.otpError(e) } else { error = AuthText.otpError(e) }
        } catch {
            self.error = "Could not reset the password. Try again."
        }
    }
}
