import SwiftUI
import UIKit
import UmbrelKit

// The same sheet serves first-time onboarding and reconnecting a saved Umbrel.
// Like umbrelOS, multi-user devices keep account selection and credentials in
// one place; single-user devices retain the compact password-only form.
struct SignInSheet: View {
	@Environment(OnboardingModel.self) private var model
	@State private var claimedDeviceId: String?
	var onCancel: (() -> Void)?

	init(onCancel: (() -> Void)? = nil) {
		self.onCancel = onCancel
	}

	var body: some View {
		let device = model.selectedDevice
		let target = Umbreld.Target(
			deviceId: device?.id ?? "",
			hosts: device.map { [$0.host] + $0.addresses } ?? []
		)
		UmbrelSignInForm(
			title: device?.model ?? "Umbrel",
			target: target,
			browserHost: device?.host ?? "",
			preferredUserId: nil,
			onPrepare: {
				guard let device = model.selectedDevice else {
					throw SignInError.sessionStorageFailed
				}
				guard claimedDeviceId != device.id else { return }
				try await Umbreld.claimLocalHTTPSIdentity(device)
				claimedDeviceId = device.id
			},
			onCancel: {
				if let onCancel {
					onCancel()
				} else {
					model.advance(to: .deviceFound)
				}
			},
			onRemove: nil
		) { account, userId, password, totpToken in
			guard model.selectedDevice != nil else { return }
			let session = try await Umbreld.login(
				target: target,
				userId: userId,
				password: password,
				totpToken: totpToken
			)
			try Task.checkCancellation()
			try await model.completeSignIn(session: session, account: account)
		}
	}
}

struct UmbrelSignInForm: View {
	@Environment(\.openURL) private var openURL
	@Environment(\.scenePhase) private var scenePhase
	@Environment(\.dynamicTypeSize) private var dynamicTypeSize

	let title: String
	let target: Umbreld.Target
	let browserHost: String
	let preferredUserId: String?
	let onPrepare: @MainActor () async throws -> Void
	let onCancel: @MainActor () -> Void
	let onRemove: (@MainActor () async -> Void)?
	let onConnect: @MainActor (Umbreld.Account?, String, String, String?) async throws -> Void

	private enum Step {
		case loadingAccounts
		case setup
		case localNetworkDenied
		case loadFailed
		case password
		case twoFactor
	}

	private enum Field: Hashable {
		case password
		case twoFactor
	}

	@State private var step: Step = .loadingAccounts
	@State private var accounts: [Umbreld.Account] = []
	@State private var selectedAccount: Umbreld.Account?
	@State private var password = ""
	@State private var twoFactorCode = ""
	@State private var loading = false
	@State private var error: String?
	@State private var isConfirmingRemoval = false
	@State private var connectTask: Task<Void, Never>?
	@FocusState private var focusedField: Field?

	private let fieldGroup = Color(hex: 0x2C2C2E)
	private let label = Color(hex: 0x8E8E93)
	private let connectIndigo = Color(hex: 0x6155F5)

	private var hasMultipleAccounts: Bool { accounts.count > 1 }
	private var selectedUserId: String { selectedAccount?.userId ?? "0" }
	private var deviceId: String { target.deviceId }

	var body: some View {
		NavigationStack {
			Group {
				switch step {
				case .loadingAccounts:
					ProgressView()
						.tint(.white)
						.frame(maxWidth: .infinity, maxHeight: .infinity)
				case .setup:
					setup
				case .localNetworkDenied:
					localNetworkDenied
				case .loadFailed:
					loadFailed
				case .password, .twoFactor:
					credentials
				}
			}
			.navigationTitle(title)
			.navigationBarTitleDisplayMode(.inline)
			.toolbar {
				DrawerCloseToolbarItem(action: onCancel)
			}
			.toolbarBackground(Color(hex: 0x1C1C1E), for: .navigationBar)
			.toolbarBackground(.visible, for: .navigationBar)
		}
		.presentationDetents([dynamicTypeSize.isAccessibilitySize ? .large : .height(540)])
		.presentationDragIndicator(.visible)
		.presentationCornerRadius(38)
		.presentationBackground(Color(hex: 0x1C1C1E))
		.task { await loadAccounts() }
		.onChange(of: scenePhase) { _, phase in
			guard phase == .active else { return }
			// Returning from Settings or browser-based Umbrel setup is the signal to
			// re-read the authoritative account list and advance the existing sheet.
			guard step == .localNetworkDenied || step == .setup else { return }
			Task { await loadAccounts() }
		}
		.onDisappear {
			connectTask?.cancel()
			connectTask = nil
		}
		.alert("Remove this Umbrel?", isPresented: $isConfirmingRemoval) {
			Button("Remove", role: .destructive) {
				Task { await onRemove?() }
			}
			Button("Cancel", role: .cancel) {}
		} message: {
			Text("This removes the saved Umbrel from this iPhone. Any photo and video backups will remain on your Umbrel. You can add it again at any time.")
		}
	}

	private var credentials: some View {
		VStack(spacing: 0) {
			if hasMultipleAccounts {
				UmbrelAccountPicker(
					accounts: accounts,
					target: target,
					selectedUserId: selectedAccount?.userId,
					onSelectionChange: selectAccount
				)
				.frame(height: dynamicTypeSize.isAccessibilitySize ? 224 : 196)
				.padding(.top, 4)
				.disabled(loading)
			}

			VStack(alignment: .leading, spacing: 16) {
				if !hasMultipleAccounts || step == .twoFactor {
					Text(prompt)
						.font(.subheadline.weight(.medium))
						.foregroundStyle(label)
				}

				if step == .twoFactor {
					twoFactorField
				} else {
					passwordField
				}

				if let error {
					Text(error)
						.font(.footnote)
						.foregroundStyle(.red)
				}
			}
			.padding(.horizontal, 20)
			.padding(.top, hasMultipleAccounts ? 24 : 20)

			Spacer(minLength: 20)
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.safeAreaInset(edge: .bottom, spacing: 0) { actions }
	}

	private var setup: some View {
		message(
			title: "Set up your Umbrel",
			description: "This Umbrel hasn\u{2019}t been set up yet. Open it to create an account, then return here to sign in.",
			actionTitle: "Open Umbrel",
			showsUmbrelMark: true
		) {
			guard let url = URL(string: "http://\(browserHost)") else { return }
			openURL(url)
		}
	}

	private var loadFailed: some View {
		message(
			title: "Couldn\u{2019}t connect",
			description: "Make sure your Umbrel is online and your iPhone can reach it, then try again.",
			actionTitle: "Try again"
		) {
			Task { await loadAccounts() }
		}
	}

	private var localNetworkDenied: some View {
		message(
			title: "Local Network Access Off",
			description: "Allow access in Settings to sign in to this Umbrel.",
			actionTitle: "Open Settings"
		) {
			guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
			openURL(url)
		}
	}

	private func message(
		title: String,
		description: String,
		actionTitle: String,
		showsUmbrelMark: Bool = false,
		action: @escaping () -> Void
	) -> some View {
		VStack(spacing: 12) {
			Spacer()

			if showsUmbrelMark {
				Image("UmbrelMark")
					.resizable()
					.scaledToFit()
					.frame(width: 52)
					.padding(.bottom, 8)
					.accessibilityHidden(true)
			}

			Text(title)
				.font(.title3.weight(.semibold))
				.foregroundStyle(.white)

			Text(description)
				.font(.subheadline.weight(.medium))
				.foregroundStyle(label)
				.multilineTextAlignment(.center)
				.fixedSize(horizontal: false, vertical: true)

			Spacer()
		}
		.padding(.horizontal, 32)
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.safeAreaInset(edge: .bottom, spacing: 0) {
			VStack(spacing: 4) {
				Button(actionTitle, action: action)
					.buttonStyle(.plain)
					.font(.headline)
					.foregroundStyle(.white)
					.frame(maxWidth: .infinity, minHeight: 48)
					.background(connectIndigo, in: .capsule)

				removeButton
			}
			.padding(.horizontal, 13)
			.padding(.bottom, 12)
		}
	}

	private var actions: some View {
		VStack(spacing: 4) {
			Button(action: connect) {
				Group {
					if loading { ProgressView().tint(.white) } else { Text("Sign in") }
				}
				.font(.headline)
				.foregroundStyle(.white)
				.frame(maxWidth: .infinity, minHeight: 48)
				.background(connectIndigo, in: .capsule)
			}
			.buttonStyle(.plain)
			.disabled(connectDisabled)

			removeButton
		}
		.padding(.horizontal, 13)
		.padding(.bottom, 12)
	}

	@ViewBuilder
	private var removeButton: some View {
		if onRemove != nil {
			Button("Remove from this iPhone") {
				isConfirmingRemoval = true
			}
			.buttonStyle(.plain)
			.font(.footnote.weight(.semibold))
			.foregroundStyle(label)
			.frame(minHeight: 40)
			.disabled(loading)
		}
	}

	private var prompt: String {
		if step == .twoFactor {
			return "Enter the code from your authenticator app"
		}
		if let name = selectedAccount?.name, hasMultipleAccounts {
			return "Log in as " + name
		}
		return "Log in to your Umbrel"
	}

	private var passwordField: some View {
		HStack {
			Text("Password")
				.foregroundStyle(label)
			Spacer(minLength: 8)
			SecureField("", text: $password)
				.focused($focusedField, equals: .password)
				.foregroundStyle(.white.opacity(0.9))
				.multilineTextAlignment(.trailing)
				.textContentType(.password)
				.submitLabel(.go)
				.onSubmit(connect)
		}
		.font(.subheadline.weight(.medium))
		.padding(12)
		.frame(minHeight: 50)
		.background(fieldGroup, in: .rect(cornerRadius: 20))
		.contentShape(.rect)
		.onTapGesture { focusedField = .password }
		.disabled(loading)
	}

	private var twoFactorField: some View {
		ZStack {
			TextField("", text: $twoFactorCode)
				.focused($focusedField, equals: .twoFactor)
				.keyboardType(.numberPad)
				.textContentType(.oneTimeCode)
				.submitLabel(.go)
				.onSubmit(connect)
				.onChange(of: twoFactorCode) {
					let code = String(twoFactorCode.filter { "0123456789".contains($0) }.prefix(6))
					if twoFactorCode != code {
						twoFactorCode = code
					}
					if error != nil, !code.isEmpty {
						error = nil
					}
					if code.count == 6 {
						connect()
					}
				}
				.foregroundStyle(.clear)
				.tint(.clear)
				.frame(width: 268, height: 50)
				.accessibilityLabel("Verification code")
				.onAppear {
					Task { @MainActor in
						await Task.yield()
						focusedField = .twoFactor
					}
				}

			HStack(spacing: 8) {
				ForEach(0..<6, id: \.self) { index in
					// These slots are a fixed-size visual rendering of the accessible
					// TextField above, so they intentionally do not scale independently.
					Text(twoFactorDigit(at: index))
						.font(.system(size: 18, weight: .semibold, design: .monospaced))
						.foregroundStyle(.white.opacity(0.9))
						.frame(width: 38, height: 50)
						.background(fieldGroup, in: .rect(cornerRadius: 12))
						.overlay {
							RoundedRectangle(cornerRadius: 12)
								.stroke(twoFactorSlotBorder(at: index), lineWidth: 1)
						}
				}
			}
			.allowsHitTesting(false)
			.accessibilityHidden(true)
		}
		.frame(maxWidth: .infinity)
		.contentShape(.rect)
		.onTapGesture { focusedField = .twoFactor }
		.disabled(loading)
	}

	private func twoFactorDigit(at index: Int) -> String {
		guard index < twoFactorCode.count else { return "" }
		let position = twoFactorCode.index(twoFactorCode.startIndex, offsetBy: index)
		return String(twoFactorCode[position])
	}

	private func twoFactorSlotBorder(at index: Int) -> Color {
		if error != nil {
			return .red
		}
		let activeIndex = min(twoFactorCode.count, 5)
		if focusedField == .twoFactor, index == activeIndex {
			return .white.opacity(0.4)
		}
		return .white.opacity(0.1)
	}

	private var connectDisabled: Bool {
		loading || password.isEmpty || (step == .twoFactor && twoFactorCode.count != 6)
	}

	private func loadAccounts() async {
		step = .loadingAccounts
		do {
			try await onPrepare()
			accounts = try await Umbreld.listAccounts(target: target)
		} catch {
			step = await LocalNetworkProbe.isDenied() ? .localNetworkDenied : .loadFailed
			return
		}
		guard !accounts.isEmpty else {
			step = .setup
			return
		}

		selectedAccount = accounts.first(where: { $0.userId == preferredUserId })
			?? accounts.first(where: { $0.userId == "0" })
			?? accounts.first
		step = .password
		if !hasMultipleAccounts {
			focusedField = .password
		}
	}

	private func selectAccount(_ account: Umbreld.Account) {
		if selectedAccount?.userId != account.userId {
			selectedAccount = account
			password = ""
			twoFactorCode = ""
			error = nil
			step = .password
		}
	}

	private func connect() {
		guard !connectDisabled else { return }
		let account = selectedAccount
		let userId = selectedUserId
		let submittedPassword = password
		let submittedTwoFactorCode = step == .twoFactor ? twoFactorCode : nil
		loading = true
		error = nil
		connectTask = Task {
			defer {
				loading = false
				connectTask = nil
			}
			do {
				try await onConnect(
					account,
					userId,
					submittedPassword,
					submittedTwoFactorCode
				)
			} catch let umbrelError as Umbreld.Error where umbrelError.requiresTwoFactorAuthentication {
				guard !Task.isCancelled else { return }
				step = .twoFactor
				twoFactorCode = ""
				focusedField = .twoFactor
			} catch {
				guard !Task.isCancelled else { return }
				if (error as? Umbreld.Error)?.status == 0, await LocalNetworkProbe.isDenied() {
					focusedField = nil
					step = .localNetworkDenied
				} else {
					self.error = error.localizedDescription
					if step == .twoFactor {
						twoFactorCode = ""
						focusedField = .twoFactor
					}
				}
			}
		}
	}
}

enum SignInError: LocalizedError {
	case sessionStorageFailed

	var errorDescription: String? {
		"Couldn\u{2019}t save your session. Please try again."
	}
}
