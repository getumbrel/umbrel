import SwiftUI
import UmbrelKit

// Full panel for a selected device. Renders straight from the AppState snapshot:
// login/setup for unsaved devices, reconnect for expired sessions, and access URLs +
// share mounts when connected.
struct DeviceDetailView: View {
	@Environment(AppState.self) private var state
	let deviceId: String
	let onBack: () -> Void

	@State private var accounts: [Umbreld.Account] = []
	@State private var selectedUserId = ""
	@State private var loadingAccounts = false
	@State private var accountError: String?
	@State private var requires2fa = false
	@State private var loading = false
	@State private var error: String?
	@State private var actionError: String?
	@State private var showPasswordForm = false
	@State private var page = DetailPage.overview
	@State private var isConfirmingHTTPS = false
	@State private var connectTask: Task<Void, Never>?
	@State private var accessAvailability: [AccessEndpointKey: Bool] = [:]

	private var device: Device? {
		state.devices.first { $0.id == deviceId }
	}

	var body: some View {
		if let device {
			content(device)
		} else {
			// Device disappeared from the snapshot (e.g. forgotten): back to the list
			Color.clear.frame(height: 1).onAppear(perform: onBack)
		}
	}

	private func content(_ device: Device) -> some View {
		VStack(alignment: .leading, spacing: 0) {
			VStack(alignment: .leading, spacing: 0) {
				header(device)
				Rectangle().fill(.white.opacity(0.1)).frame(height: 1)
					.padding(.top, 12)
					.padding(.bottom, 16)
				main(device)
			}
			.padding(.horizontal, 24)

			footer(device)
		}
		.padding(.top, 20)
		.overlay(alignment: .topTrailing) {
			if let badge = statusBadgeConfig(for: device) {
				StatusBadge(icon: badge.icon, ringColor: badge.ringColor)
					.id(badge.key) // re-run the entrance ripple when the state flips
			}
		}
		.task(id: AccountLoadContext(host: device.host, online: device.online, onboarded: device.onboarded)) {
			guard device.online, device.onboarded != false else { return }
			await loadAccounts(for: device)
		}

	}

	// ── Header ──

	private func header(_ device: Device) -> some View {
		VStack(alignment: .leading, spacing: 0) {
			DeviceIcon(model: device.model, width: device.isPro ? 80 : 62, height: device.isPro ? 57 : 46)

			nameText(device)
				.font(.system(size: 17, weight: .bold))
				.lineLimit(1)
				.truncationMode(.tail)
				.padding(.top, 14)
				.padding(.bottom, 4)

			StatusLine(status: statusInfo(for: device), secondaryLabel: connectionRouteLabel(for: device))
		}
	}

	private func nameText(_ device: Device) -> Text {
		if let userName = device.userName {
			return Text("\(userName)\u{2019}s ").foregroundColor(.white)
				+ Text(device.displayModel).foregroundColor(Color(hex: 0x808080))
		}
		return Text(device.displayModel).foregroundColor(.white)
	}

	// ── Main content ──

	@ViewBuilder
	private func main(_ device: Device) -> some View {
		if page == .browserSettings {
			browserSettings(device)
		} else if device.reachability == .unverified {
			ProgressView()
				.controlSize(.small)
		} else if !device.online && !(device.saved && showPasswordForm) {
			VStack(alignment: .leading, spacing: 12) {
				Text("Device is offline")
					.font(.system(size: 13))
					.foregroundStyle(.white.opacity(0.4))
				if device.saved && device.connection == .notAuthenticated {
					Button("Connect") {
						showPasswordForm = true
						Task { await loadAccounts(for: device) }
					}
					.buttonStyle(PillButtonStyle())
				}
			}
		} else if !device.saved {
			unsavedContent(device)
		} else {
			savedContent(device)
		}
	}

	@ViewBuilder
	private func unsavedContent(_ device: Device) -> some View {
		if device.onboarded == false {
			setupSection(device)
		} else {
			passwordForm("Enter your umbrelOS password to connect:", device: device)
		}
	}

	// The three login prompts differ only in their label
	private func passwordForm(_ label: String, device: Device) -> some View {
		VStack(alignment: .leading, spacing: 12) {
			if loadingAccounts && accounts.isEmpty {
				ProgressView()
					.controlSize(.small)
			} else if let accountError {
				Text(accountError)
					.font(.system(size: 12))
					.foregroundStyle(Palette.red)
				Button("Try again") {
					Task { await loadAccounts(for: device) }
				}
				.buttonStyle(PillButtonStyle(prominent: false))
			} else if let account = selectedAccount {
				if accounts.count > 1, let target = state.nativeTarget(for: device.id) {
					UmbrelAccountPicker(accounts: accounts, target: target, selectedUserId: selectedUserId) { account in
						selectedUserId = account.userId
						requires2fa = false
						error = nil
					}
					.id(accounts.map(\.userId).joined(separator: ":"))
					.disabled(loading)
				}

				PasswordForm(
					label: requires2fa
						? "Enter the code from your authenticator app"
						: (accounts.count > 1 ? "Enter the password for \(account.name):" : label),
					requiresTotp: requires2fa,
					loading: loading,
					error: error,
					onCodeEntry: { error = nil }
				) { password, totp in
					submit(device: device, account: account, password: password, totp: totp)
				}
				.id(account.userId)
			}
		}
	}

	@ViewBuilder
	private func savedContent(_ device: Device) -> some View {
		// Keep one form identity across notAuthenticated -> connecting ->
		// notAuthenticated. The first password request can discover that this account
		// needs 2FA; replacing the switch branch would discard the entered password.
		if showPasswordForm || device.connection == .expired || (device.connection == .connecting && loading) {
			passwordForm(
				device.connection == .expired
					? "Your login session has expired. Enter your password to reconnect:"
					: "Enter your password to connect:",
				device: device
			)
		} else {
			switch device.connection {
			case .notAuthenticated:
				HStack(spacing: 8) {
					Button("Forget device") {
						forget()
					}
					.buttonStyle(PillButtonStyle(prominent: false))
					Button("Connect") {
						showPasswordForm = true
					}
					.buttonStyle(PillButtonStyle())
				}
			case .expired, .connecting, .connected, .disconnecting:
				connectedContent(device)
			}
		}
	}

	private func setupSection(_ device: Device) -> some View {
		VStack(alignment: .leading, spacing: 12) {
			Text("To get started, set up your device in the browser. Once you\u{2019}re done, come back here to connect.")
				.font(.system(size: 12))
				.foregroundStyle(.white.opacity(0.5))
			accessBox(device)
		}
	}

	@ViewBuilder
	private func connectedContent(_ device: Device) -> some View {
		VStack(alignment: .leading, spacing: 0) {
			HStack {
				Text("Access umbrelOS")
					.font(.system(size: 10, weight: .semibold))
					.foregroundStyle(.white.opacity(0.85))
				Spacer()
				Button { page = .browserSettings } label: {
					Image(systemName: "gearshape")
						.font(.system(size: 11))
						.frame(width: 20, height: 20)
						.contentShape(Rectangle())
				}
					.buttonStyle(.plain)
					.foregroundStyle(Palette.gray)
					.help("Browser Settings")
			}
			.padding(.bottom, 6)
			accessBox(device)

			if state.canUseFinderSharing(deviceId: deviceId) {
				Text("File Sharing")
					.font(.system(size: 10, weight: .semibold))
					.foregroundStyle(.white.opacity(0.85))
					.padding(.top, 24)
					.padding(.bottom, 2)
				(Text("Your shared folders appear in ")
					+ Text("Finder").foregroundStyle(Palette.blue)
					+ Text(" under Locations"))
					.font(.system(size: 10))
					.foregroundStyle(Palette.gray)
					.padding(.bottom, 10)

				if !state.hasLoadedFinderShares(deviceId: deviceId) {
					HStack(spacing: 6) {
						ProgressView().controlSize(.mini)
						Text("Checking shared folders…")
					}
					.font(.system(size: 10))
					.foregroundStyle(Palette.gray)
				} else if device.shares.isEmpty {
					ShareHomePrompt(deviceId: deviceId)
				} else {
					SectionBox {
						ForEach(Array(device.shares.enumerated()), id: \.element.id) { index, share in
							ShareRow(
								share: share,
								hasDivider: index > 0,
								onReconnect: { state.mountAllInBackground(deviceId) }
							)
						}
					}
				}
			}
		}
	}

	private func browserSettings(_ device: Device) -> some View {
		VStack(alignment: .leading, spacing: 0) {
			Text("Browser Settings")
				.font(.system(size: 10, weight: .semibold))
				.foregroundStyle(.white.opacity(0.85))
				.padding(.bottom, 6)

			SectionBox {
				HStack(spacing: 12) {
					Text("Always Use HTTPS Locally")
						.font(.system(size: 11, weight: .medium))
						.foregroundStyle(.white.opacity(0.85))
					Spacer()
					Toggle(
						"",
						isOn: Binding(
							get: { device.dashboardUsesHTTPS },
							set: { enabled in
								if enabled {
									isConfirmingHTTPS = true
								} else {
									state.setDashboardUsesHTTPS(false, deviceId: device.id)
								}
							}
						)
					)
					.labelsHidden()
					.toggleStyle(.switch)
					.controlSize(.small)
				}
				.padding(10)
			}

			Text(
				"Some apps need HTTPS in the browser to work correctly. HTTPS is for browser compatibility, not private access. For private access, use Tailscale."
			)
			.font(.system(size: 10))
			.foregroundStyle(Palette.gray)
			.fixedSize(horizontal: false, vertical: true)
			.padding(.top, 8)
		}
		.alert("Always Use HTTPS Locally?", isPresented: $isConfirmingHTTPS) {
			Button("Cancel", role: .cancel) {}
			Button("Use HTTPS Locally") {
				state.setDashboardUsesHTTPS(true, deviceId: device.id)
			}
		} message: {
			Text(
				"Your browser may show a privacy warning. If it does, open the details and choose the option to continue to your Umbrel. Only do this for your Umbrel and its installed apps."
			)
		}
	}

	private func accessBox(_ device: Device) -> some View {
		let methods = accessMethods(for: device)
		return SectionBox {
			ForEach(Array(methods.enumerated()), id: \.element.address) { index, method in
				let key = AccessEndpointKey(deviceId: device.id, address: method.address)
				let isActive = device.connectionHost?.caseInsensitiveCompare(method.address) == .orderedSame
				AccessRow(
					url: method.url,
					label: method.address,
					accessType: method.type,
					isAvailable: accessAvailability[key] ?? (isActive ? true : nil),
					hasDivider: index > 0
				)
			}
		}
		.task(id: AccessAvailabilityContext(deviceId: device.id, saved: device.saved, addresses: methods.map(\.address))) {
			guard device.saved else { return }
			let results = await withTaskGroup(of: (String, Bool).self) { group in
				for method in methods {
					group.addTask {
						let available = await Umbreld.isKnownEndpointAvailable(
							host: method.address,
							deviceId: device.id
						)
						return (method.address, available)
					}
				}
				var availability: [String: Bool] = [:]
				for await (address, available) in group {
					availability[address] = available
				}
				return availability
			}
			guard !Task.isCancelled else { return }
			for (address, available) in results {
				accessAvailability[AccessEndpointKey(deviceId: device.id, address: address)] = available
			}
		}
	}

	private func accessMethods(for device: Device) -> [AccessMethod] {
		var seen = Set<String>()
		return ([device.host] + device.addresses)
			.filter { SavedDevice.isValidLocalEndpointHost($0) && seen.insert($0.lowercased()).inserted }
			.compactMap { address in
				guard let url = browserURL(for: address, device: device) else { return nil }
				return AccessMethod(
					address: address,
					type: Self.isTailscaleAddress(address) ? "Tailscale" : nil,
					url: url
				)
			}
	}

	private func browserURL(for address: String, device: Device) -> URL? {
		// Tailscale already encrypts the connection. This preference only affects
		// browser compatibility when opening Umbrel on the local network.
		var components = URLComponents()
		components.scheme = device.dashboardUsesHTTPS && !Self.isTailscaleAddress(address) ? "https" : "http"
		components.host = address
		return components.url
	}

	private static func isTailscaleAddress(_ address: String) -> Bool {
		SavedDevice.isTailscaleAddress(address)
	}

	// ── Footer ──

	private func footer(_ device: Device) -> some View {
		VStack(alignment: .leading, spacing: 8) {
			if let actionError {
				Text(actionError)
					.foregroundStyle(Palette.red)
					.fixedSize(horizontal: false, vertical: true)
			}
			HStack {
				Button {
					if page == .browserSettings {
						page = .overview
					} else {
						connectTask?.cancel()
						onBack()
					}
				} label: {
					HStack(spacing: 2) {
						Image(systemName: "chevron.left").font(.system(size: 9, weight: .semibold))
						Text(page == .browserSettings ? "Back" : "All devices")
					}
				}
				.buttonStyle(.plain)
				.foregroundStyle(Palette.gray)
				Spacer()
				// Forget is always reachable for saved devices unless the main content already
				// offers it (the Forget/Connect button pair for online, not-authenticated devices)
				let mainContentHasForget = device.online && device.connection == .notAuthenticated && !showPasswordForm
				if page == .overview && device.saved && !mainContentHasForget {
					HStack(spacing: 6) {
						if device.connection == .disconnecting {
							Text("Disconnecting\u{2026}").foregroundStyle(Palette.gray.opacity(0.6))
							Text("\u{00B7}")
						} else if device.connection == .connected {
							Button("Disconnect") {
								actionError = nil
								Task {
									do {
										try await state.disconnect(deviceId: deviceId)
									} catch {
										actionError = error.localizedDescription
									}
								}
							}
							.buttonStyle(.plain)
							Text("\u{00B7}")
						}
						Button("Forget Device") {
							forget()
						}
						.buttonStyle(.plain)
					}
					.foregroundStyle(Palette.gray)
				}
			}
		}
		.font(.system(size: 10, weight: .medium))
		.padding(.horizontal, 24)
		.padding(.vertical, 14)
	}

	// ── Actions ──

	// No confirmation dialog: sheets can't present on this non-activating panel, and
	// forgetting is cheap to undo (the device is rediscovered instantly; one password
	// restores it). The view stays up during the disconnect drain, then returns.
	private func forget() {
		connectTask?.cancel()
		actionError = nil
		Task {
			do {
				try await state.forget(deviceId: deviceId)
				onBack()
			} catch {
				actionError = error.localizedDescription
			}
		}
	}

	private var selectedAccount: Umbreld.Account? {
		accounts.first { $0.userId == selectedUserId }
	}

	private func loadAccounts(for device: Device) async {
		guard !loadingAccounts else { return }
		loadingAccounts = true
		accountError = nil
		defer { loadingAccounts = false }

		do {
			try await state.prepareToSignIn(deviceId: device.id)
			guard let target = state.nativeTarget(for: device.id) else {
				accountError = "Couldn\u{2019}t load accounts."
				return
			}
			let loaded = try await Umbreld.listAccounts(target: target)
			guard !loaded.isEmpty else {
				accountError = "No accounts are available on this Umbrel."
				return
			}
			accounts = loaded
			let preferred = state.preferredAccountId(for: device.id)
			selectedUserId = loaded.first(where: { $0.userId == preferred })?.userId
				?? loaded.first(where: { $0.userId == "0" })?.userId
				?? loaded[0].userId
			requires2fa = false
			error = nil
		} catch {
			accountError = "Couldn\u{2019}t load accounts."
		}
	}

	private func submit(device: Device, account: Umbreld.Account, password: String, totp: String?) {
		guard !loading else { return }
		loading = true
		error = nil
		connectTask = Task {
			defer {
				loading = false
				connectTask = nil
			}
			do {
				try await state.connect(
					deviceId: deviceId,
					account: account,
					password: password,
					totpToken: totp
				)
				requires2fa = false
				showPasswordForm = false
			} catch let umbrelError as Umbreld.Error where umbrelError.requiresTwoFactorAuthentication {
				guard !Task.isCancelled else { return }
				requires2fa = true
			} catch {
				guard !Task.isCancelled else { return }
				self.error = error.localizedDescription
			}
		}
	}
}

private enum DetailPage {
	case overview
	case browserSettings
}

private struct AccountLoadContext: Hashable {
	let host: String
	let online: Bool
	let onboarded: Bool?
}

private struct AccessMethod {
	let address: String
	let type: String?
	let url: URL
}

private struct AccessAvailabilityContext: Hashable {
	let deviceId: String
	let saved: Bool
	let addresses: [String]
}

private struct AccessEndpointKey: Hashable {
	let deviceId: String
	let address: String
}

// ── Share row ──

private struct ShareRow: View {
	let share: Share
	var hasDivider = false
	let onReconnect: () -> Void

	@State private var hovered = false

	var body: some View {
		Group {
			switch share.status {
			case .mounted:
				if let path = share.mountPath {
					Button {
						NSWorkspace.shared.open(URL(fileURLWithPath: path))
					} label: {
						content
					}
					.buttonStyle(.plain)
					.accessibilityLabel("View \(share.sharename) in Finder")
				} else {
					Button(action: onReconnect) {
						content
					}
					.buttonStyle(.plain)
					.accessibilityLabel("Reconnect \(share.sharename)")
				}
			case .unmounted:
				Button(action: onReconnect) {
					content
				}
				.buttonStyle(.plain)
				.accessibilityLabel("Reconnect \(share.sharename)")
			case .mounting, .unmounting:
				content
			}
		}
		.onHover { hovered = $0 }
	}

	private var content: some View {
		HStack(spacing: 6) {
			Image(nsImage: Assets.folder)
				.resizable()
				.scaledToFit()
				.frame(width: 13, height: 12)
			Text(share.sharename).foregroundStyle(.white.opacity(0.85))
			Spacer()
			switch share.status {
			case .mounting, .unmounting:
				HStack(spacing: 4) {
					ProgressView().controlSize(.mini)
					Text(share.status == .mounting ? "Mounting\u{2026}" : "Unmounting\u{2026}")
				}
				.font(.system(size: 9, weight: .medium))
				.foregroundStyle(Palette.gray)
			case .mounted:
				Text("View in Finder \u{203A}")
					.font(.system(size: 9, weight: .medium))
					.foregroundStyle(Palette.gray)
			case .unmounted:
				Text("Reconnect \u{203A}")
					.font(.system(size: 9, weight: .medium))
					.foregroundStyle(Palette.gray)
			}
		}
		.font(.system(size: 11, weight: .medium))
		.padding(10)
		.background(
			(share.status == .mounted || share.status == .unmounted) && hovered
				? Color.white.opacity(0.06) : .clear
		)
		.overlay(alignment: .top) {
			if hasDivider {
				Rectangle().fill(.white.opacity(0.06)).frame(height: 0.5)
			}
		}
		.contentShape(Rectangle())
	}
}

// ── Share Home prompt (no shares yet: one-click enable) ──

private struct ShareHomePrompt: View {
	@Environment(AppState.self) private var state
	let deviceId: String

	@State private var loading = false
	@State private var error: String?

	var body: some View {
		VStack(alignment: .leading, spacing: 8) {
			Button(loading ? "Sharing\u{2026}" : "Share your entire Home folder") {
				loading = true
				error = nil
				Task {
					do {
						try await state.shareHome(deviceId: deviceId)
					} catch {
						self.error = error.localizedDescription
					}
					loading = false
				}
			}
			.buttonStyle(PillButtonStyle())
			.disabled(loading)

			if let error {
				Text(error).font(.system(size: 10)).foregroundStyle(Palette.red)
			}
		}
	}
}
