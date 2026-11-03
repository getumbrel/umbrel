import Photos
import SwiftUI
import UmbrelKit
import UserNotifications

// The Profile sheet: a settings sheet presented over the tabs — device
// card, photo-backup settings, iOS permissions, sign out and version.
enum ProfileDestination: Hashable {
	case remoteAccess
	case connection
}

struct ProfileSheet: View {
	@Environment(MainModel.self) private var model
	@Environment(\.dismiss) private var dismiss
	// Accents follow the wallpaper's brand color, like the rest of the app.
	@Environment(\.brandColor) private var brandColor
	@State private var isConfirmingSignOut = false
	@Binding var path: [ProfileDestination]

	var body: some View {
		NavigationStack(path: $path) {
			ScrollView(showsIndicators: false) {
				VStack(spacing: 0) {
					deviceCard
						.padding(.top, 20)
						.padding(.bottom, 10)
					ConnectionSection()
					PhotosSection()
					PermissionsSection()
					signOutButton
						.padding(.vertical, 10)
					footer
						.padding(.vertical, 10)
				}
				.padding(.horizontal, 20)
				.padding(.bottom, 24)
			}
			.scrollEdgeEffectStyle(.soft, for: .top)
			.navigationTitle("Profile")
			.navigationBarTitleDisplayMode(.inline)
			.toolbar {
				DrawerCloseToolbarItem(action: { dismiss() })
			}
			.navigationDestination(for: ProfileDestination.self) { destination in
				switch destination {
				case .remoteAccess:
					TailscaleSetupPage()
				case .connection:
					ConnectionDetailsPage()
				}
			}
		}
		.presentationDragIndicator(.visible)
		.presentationCornerRadius(38)
		.presentationBackground(Color(hex: 0x1C1C1E))
	}

	// Greeting, device render, model + storage, and how it's reachable.
	private var deviceCard: some View {
		VStack(spacing: 20) {
			Text("\u{1F44B} Hey, \(model.userName ?? "there")!")
				.font(.title2.weight(.semibold))
				.foregroundStyle(.white.opacity(0.9))
				.lineLimit(2)
				.truncationMode(.tail)
				.multilineTextAlignment(.center)
			VStack(spacing: 10) {
				UmbrelDeviceRender(model: model.device?.model, placement: .profile)
					.shadow(color: .black.opacity(0.16), radius: 8, y: 16)
				VStack(spacing: 4) {
					Text(deviceLine)
						.font(.subheadline.weight(.medium))
						.foregroundStyle(.white)
					if let device = model.device {
						let host = Text(device.host).foregroundStyle(brandColor)
						Text("\(host)\(addressSuffix(device))")
							.font(.footnote)
					}
				}
			}
		}
		.frame(maxWidth: .infinity)
		.padding(.horizontal, 16)
		.padding(.vertical, 24)
		.background(Color(hex: 0x2C2C2E), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
	}

	// "Umbrel Pro · 4TB" (storage appended once disk usage has loaded).
	private var deviceLine: String {
		guard let disk = model.disk else { return model.deviceLabel }
		return "\(model.deviceLabel) \u{B7} \(formatStorageSize(disk.size))"
	}

	private func addressSuffix(_ device: SavedDevice) -> Text {
		guard let address = device.addresses.first, address != device.host else { return Text("") }
		let separator = Text(" \u{B7} ").foregroundStyle(.white.opacity(0.6))
		let addressText = Text(address).foregroundStyle(brandColor)
		return Text("\(separator)\(addressText)")
	}

	private var signOutButton: some View {
		Button {
			isConfirmingSignOut = true
		} label: {
			Text("Sign out")
				.font(.footnote.weight(.semibold))
				.foregroundStyle(Theme.red)
				.padding(.horizontal, 16)
				.frame(height: 44)
				.glassControl(in: Capsule())
		}
		.buttonStyle(.plain)
		.alert("Sign out of this Umbrel?", isPresented: $isConfirmingSignOut) {
			Button("Sign Out", role: .destructive) {
				model.signOut()
			}
			Button("Cancel", role: .cancel) {}
		} message: {
			Text("Signing out pauses photo and video backups from this iPhone and any notifications until you sign in again.")
		}
	}

	// App Review requires a privacy policy link in the app. The same policy umbrelOS links to.
	// At large text sizes the link wraps to the next line whole.
	private var footer: some View {
		let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
		return Text("Umbrel, Inc. \u{B7} Version \(version) \u{B7} [Privacy\u{00A0}Policy](https://umbrel.com/legal/privacy)")
			.font(.footnote)
			.foregroundStyle(Theme.gray)
			.tint(.white.opacity(0.65))
	}
}

// MARK: - Connection

private struct ConnectionSection: View {
	@Environment(MainModel.self) private var model

	var body: some View {
		SettingsSection("Connection") {
			NavigationLink(value: ProfileDestination.remoteAccess) {
				SettingsRow(icon: "network", title: "Remote access") {
					SettingsValue(text: model.tailscaleConnectionStatus, chevron: true)
				}
			}
			.buttonStyle(.plain)
			SettingsDivider()
			NavigationLink(value: ProfileDestination.connection) {
				SettingsRow(icon: "lock.shield", title: "Current connection") {
					SettingsValue(text: currentConnection, chevron: true)
				}
			}
			.buttonStyle(.plain)
		}
	}

	private var currentConnection: String {
		switch model.connectionState {
		case .unverified: "Checking…"
		case .connected:
			switch model.connectionRoute {
			case .local: "Local"
			case .tailscale: "Tailscale"
			case nil: "Connected"
			}
		case .unavailable, .localNetworkDenied: model.identityChanged ? "Can’t verify" : "Offline"
		}
	}
}

private struct ConnectionDetailsPage: View {
	@Environment(MainModel.self) private var model
	@Environment(\.openURL) private var openURL
	@State private var copiedAddress: String?

	var body: some View {
		ScrollView(showsIndicators: false) {
			VStack(spacing: 24) {
				hero
				stateContent
				if model.connectionState != .unverified, !knownAddresses.isEmpty {
					knownAddressesSection
				}
			}
			.padding(.horizontal, 20)
			.padding(.top, 20)
			.padding(.bottom, 32)
		}
		.scrollEdgeEffectStyle(.soft, for: .top)
		.background(Color(hex: 0x1C1C1E).ignoresSafeArea())
		.navigationTitle("Connection")
		.navigationBarTitleDisplayMode(.inline)
	}

	private var hero: some View {
		VStack(spacing: 14) {
			heroGraphic
			Text(statusTitle)
				.font(.title2.bold())
				.foregroundStyle(.white)
			Text(statusMessage)
				.font(.subheadline)
				.foregroundStyle(Theme.gray)
				.multilineTextAlignment(.center)
				.fixedSize(horizontal: false, vertical: true)
		}
		.padding(.horizontal, 12)
	}

	@ViewBuilder
	private var heroGraphic: some View {
		if case .connected = model.connectionState, model.connectionRoute == .tailscale {
			Image("TailscaleIcon")
				.resizable()
				.scaledToFit()
				.frame(width: 76, height: 76)
				.clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
		} else {
			ZStack {
				Circle().fill(Color.white.opacity(0.08))
				if isChecking {
					ProgressView()
						.controlSize(.large)
						.tint(.white)
				} else {
					Image(systemName: heroIcon)
						.font(.system(size: 34, weight: .semibold))
						.foregroundStyle(.white)
				}
			}
			.frame(width: 76, height: 76)
		}
	}

	@ViewBuilder
	private var stateContent: some View {
		switch model.connectionState {
		case .connected:
			VStack(spacing: 0) {
				connectionDetails
			}
			.background(Color(hex: 0x2C2C2E), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
		case .localNetworkDenied:
			PrimaryActionButton(title: "Open Settings", action: openSettings)
		case .unavailable, .unverified:
			EmptyView()
		}
	}

	@ViewBuilder
	private var connectionDetails: some View {
		switch model.connectionRoute {
		case .tailscale:
			InfoPageRow(
				icon: "lock.fill",
				title: "End-to-end encrypted",
				message: "Traffic between this iPhone and your Umbrel is encrypted by Tailscale."
			)
			InfoPageDivider()
			InfoPageRow(
				icon: "checkmark.shield.fill",
				title: "Private access",
				message: "Only devices with access to your tailnet can reach your Umbrel this way."
			)
		case .local:
			InfoPageRow(
				icon: "lock.fill",
				title: "Encrypted with HTTPS",
				message: "Traffic between this iPhone and your Umbrel is encrypted with HTTPS."
			)
			InfoPageDivider()
			InfoPageRow(
				icon: "checkmark.shield.fill",
				title: "Verified connection",
				message: "The app verifies your Umbrel’s HTTPS certificate when establishing the connection."
			)
		case nil:
			InfoPageRow(
				icon: "lock.fill",
				title: "Encrypted connection",
				message: "Traffic between this iPhone and your Umbrel is encrypted."
			)
		}
	}

	private var knownAddressesSection: some View {
		VStack(alignment: .leading, spacing: 10) {
			Text("Known addresses")
				.font(.footnote.weight(.semibold))
				.foregroundStyle(Theme.gray)
				.padding(.horizontal, 4)
			VStack(spacing: 0) {
				ForEach(Array(knownAddresses.enumerated()), id: \.element) { index, address in
					knownAddressRow(address)
					if index < knownAddresses.count - 1 {
						InfoPageDivider()
					}
				}
			}
			.background(
				Color(hex: 0x2C2C2E),
				in: RoundedRectangle(cornerRadius: 20, style: .continuous)
			)
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}

	private func knownAddressRow(_ address: String) -> some View {
		Button {
			UIPasteboard.general.string = address
			copiedAddress = address
			Task {
				try? await Task.sleep(for: .seconds(1.5))
				if copiedAddress == address { copiedAddress = nil }
			}
		} label: {
			HStack(spacing: 14) {
				Image(systemName: SavedDevice.isTailscaleAddress(address) ? "network" : "wifi")
					.font(.system(size: 17, weight: .medium))
					.foregroundStyle(.white.opacity(0.9))
					.frame(width: 28, height: 28)
				VStack(alignment: .leading, spacing: 4) {
					Text(SavedDevice.isTailscaleAddress(address) ? "Tailscale" : "Local network")
						.font(.subheadline.weight(.semibold))
						.foregroundStyle(.white)
					Text(address)
						.font(.system(.footnote, design: .monospaced))
						.foregroundStyle(Theme.gray)
						.lineLimit(1)
						.truncationMode(.middle)
				}
				.frame(maxWidth: .infinity, alignment: .leading)
				Image(systemName: copiedAddress == address ? "checkmark" : "doc.on.doc")
					.font(.system(size: 14, weight: .medium))
					.foregroundStyle(Theme.gray)
			}
			.padding(16)
			.contentShape(Rectangle())
		}
		.buttonStyle(.plain)
		.accessibilityLabel("\(SavedDevice.isTailscaleAddress(address) ? "Tailscale" : "Local network") address, \(address)")
		.accessibilityHint("Copies the address")
	}

	private var knownAddresses: [String] {
		model.device?.connectionHosts ?? []
	}

	private var isChecking: Bool {
		if case .unverified = model.connectionState { return true }
		return false
	}

	private var heroIcon: String {
		switch model.connectionState {
		case .connected:
			switch model.connectionRoute {
			case .local: "wifi"
			case .tailscale: "network"
			case nil: "network"
			}
		case .unavailable: model.identityChanged ? "lock.trianglebadge.exclamationmark" : "wifi.exclamationmark"
		case .localNetworkDenied: "wifi.slash"
		case .unverified: "ellipsis"
		}
	}

	private var statusTitle: String {
		switch model.connectionState {
		case .connected:
			switch model.connectionRoute {
			case .local: "Connected locally"
			case .tailscale: "Connected through Tailscale"
			case nil: "Connected"
			}
		case .unavailable: model.identityChanged ? "Can’t verify" : "Not connected"
		case .localNetworkDenied: "Local Network Access Off"
		case .unverified: "Checking connection"
		}
	}

	private var statusMessage: String {
		switch model.connectionState {
		case .connected:
			switch model.connectionRoute {
			case .local: "This iPhone is connected directly to your Umbrel over your local network."
			case .tailscale: "This iPhone is connected through your private Tailscale network."
			case nil: "This iPhone is securely connected to your Umbrel."
			}
		case .unavailable where model.identityChanged:
			IdentityChange.message
		case .unavailable:
			if model.hasKnownTailscaleAddress {
				"Make sure your Umbrel is turned on. Connect this iPhone to the same local network, or turn on Tailscale."
			} else {
				"Make sure your Umbrel is turned on and this iPhone is connected to the same network."
			}
		case .localNetworkDenied:
			"Allow access in Settings to connect to your Umbrel on the local network."
		case .unverified:
			"Checking how this iPhone can reach your Umbrel."
		}
	}

	private func openSettings() {
		if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
	}
}

// MARK: - Photos

private struct PhotosSection: View {
	@Environment(MainModel.self) private var model
	@Environment(\.openURL) private var openURL
	@State private var showsInfo = false

	var body: some View {
		// The same How it works as Library
		SettingsSection("Photos", learnMore: { showsInfo = true }) {
			if let destination = model.otherPhotoBackupDestinationName {
				PhotoBackupDestinationRow(destination: destination)
			} else {
				SettingsRow(icon: "photo.stack", title: "Back up photos") {
					SettingsToggle("Back up photos", isOn: Binding(
						get: { model.backupPhotosEnabled },
						set: { model.setBackupPhotosEnabled($0) }
					))
				}
				SettingsDivider()
				SettingsRow(icon: "video", title: "Back up videos") {
					SettingsToggle("Back up videos", isOn: Binding(
						get: { model.backupVideosEnabled },
						set: { model.setBackupVideosEnabled($0) }
					))
				}
				SettingsDivider()
				cellularUploadRow
				if model.backupPhotosEnabled || model.backupVideosEnabled, let route = model.photoBackupRoute {
					SettingsDivider()
					backgroundBackupRow(route)
				}
				if let lastUploadedAt = model.photoBackup.statistics?.lastUploadedAt {
					SettingsDivider()
					SettingsRow(icon: "clock.arrow.circlepath", title: "Last backed up") {
						SettingsValue(text: Self.lastBackupText(lastUploadedAt))
					}
				}
			}
		}
		.sheet(isPresented: $showsInfo) {
			PhotoBackupInfoSheet(sourceName: model.photoBackupSourceName)
				.task { await model.refreshPhotoBackupSourceName() }
		}
	}

	// Like iCloud Backup's "Last successful backup": a date, which reads as a fact
	// rather than an age that can look like a stall after a quiet few days.
	static func lastBackupText(_ date: Date, now: Date = .now, calendar: Calendar = .current) -> String {
		let time = date.formatted(date: .omitted, time: .shortened)
		if calendar.isDateInToday(date) { return "Today at \(time)" }
		if calendar.isDateInYesterday(date) { return "Yesterday at \(time)" }
		let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: calendar.startOfDay(for: now)).day ?? 0
		if days < 7 { return "\(date.formatted(.dateTime.weekday(.wide))) at \(time)" }
		return calendar.isDate(date, equalTo: now, toGranularity: .year)
			? date.formatted(.dateTime.month(.abbreviated).day())
			: date.formatted(.dateTime.month(.abbreviated).day().year())
	}

	// The app backs up while it's open and overnight. With Tailscale, iOS also does while
	// it's closed, wherever the iPhone is.
	@ViewBuilder
	private func backgroundBackupRow(_ route: PhotoBackupConfiguration.Route) -> some View {
		if route == .tailscale, model.photoBackupBackgroundRefreshUnavailable {
			Button(action: openSettings) {
				SettingsRow(icon: "network", title: "Back up from anywhere") {
					SettingsValue(text: "Off", chevron: true)
				}
			}
			.buttonStyle(.plain)
			.accessibilityHint("Background App Refresh is off. Opens iPhone Settings")
		} else {
			NavigationLink(value: ProfileDestination.remoteAccess) {
				SettingsRow(icon: "network", title: "Back up from anywhere") {
					SettingsValue(text: route == .tailscale ? "On" : "Set Up", chevron: true)
				}
			}
			.buttonStyle(.plain)
		}
	}

	private var cellularUploadRow: some View {
		HStack(spacing: 4) {
			Image(systemName: "antenna.radiowaves.left.and.right")
				.font(.system(size: 15))
				.foregroundStyle(.white.opacity(0.9))
				.frame(width: 30)
			VStack(alignment: .leading, spacing: 4) {
				Text("Allow cellular uploads")
					.font(.subheadline.weight(.medium))
					.foregroundStyle(.white.opacity(0.9))
				if model.backupCellularEnabled, model.cellularDataRestricted {
					Button(action: openSettings) {
						HStack(spacing: 4) {
							Text("Off in iPhone Settings")
							Image(systemName: "chevron.right")
						}
						.font(.footnote.weight(.medium))
						.foregroundStyle(Theme.gray)
						.contentShape(Rectangle())
					}
					.buttonStyle(.plain)
					.accessibilityHint("Opens iPhone Settings")
				}
			}
			Spacer(minLength: 8)
			SettingsToggle("Allow cellular uploads", isOn: Binding(
				get: { model.backupCellularEnabled },
				set: { model.setBackupCellularEnabled($0) }
			))
		}
		.padding(.leading, 8)
		.padding(.trailing, 12)
		.padding(.vertical, 12)
	}

	private func openSettings() {
		guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
		openURL(url)
	}
}

private struct PhotoBackupDestinationRow: View {
	@Environment(MainModel.self) private var model
	@State private var isConfirmingSwitch = false
	let destination: String

	var body: some View {
		HStack(alignment: .top, spacing: 4) {
			Image(systemName: "photo.stack")
				.font(.system(size: 15))
				.foregroundStyle(.white.opacity(0.9))
				.frame(width: 30)
			VStack(alignment: .leading, spacing: 4) {
				Text("Photo Backup is on for \(destination)")
					.font(.subheadline.weight(.medium))
					.foregroundStyle(.white.opacity(0.9))
				Text("This iPhone can back up to one Umbrel at a time.")
					.font(.footnote.weight(.medium))
					.foregroundStyle(Theme.gray)
					.fixedSize(horizontal: false, vertical: true)
				if !model.canSwitchPhotoBackupHere {
					Text("Allow Full Photos access to back up to this Umbrel instead.")
						.font(.footnote.weight(.medium))
						.foregroundStyle(Theme.gray)
						.fixedSize(horizontal: false, vertical: true)
				} else {
					PillButton(
						title: model.photoBackupSetupInProgress ? "Switching backup\u{2026}" : "Back Up to This Umbrel",
						isLoading: model.photoBackupSetupInProgress
					) { isConfirmingSwitch = true }
				}
			}
			.frame(maxWidth: .infinity, alignment: .leading)
		}
		.padding(.leading, 8)
		.padding(.trailing, 12)
		.padding(.top, 12)
		// PillButton keeps a 7pt margin under its capsule for its 44pt tap target
		.padding(.bottom, model.canSwitchPhotoBackupHere ? 5 : 12)
		.photoBackupSwitchConfirmation(isPresented: $isConfirmingSwitch, destination: destination)
	}
}

// MARK: - Permissions

private struct PermissionsSection: View {
	@Environment(MainModel.self) private var model
	@Environment(\.openURL) private var openURL
	@Environment(\.scenePhase) private var scenePhase

	@State private var photosStatus: PHAuthorizationStatus = .notDetermined
	// Read asynchronously, so nothing shows until it's known
	@State private var notificationStatus: UNAuthorizationStatus?

	var body: some View {
		SettingsSection("Permissions") {
			SettingsRow(icon: "photo", title: "Photo Library Access") { photosAccessory }
			SettingsDivider()
			// iOS has no general Local Network status API. Only show Off after a real
			// connection reports localNetworkDenied; otherwise avoid claiming access.
			SettingsRow(icon: "network", title: "Local Network Access") {
				localNetworkAccessory
			}
			SettingsDivider()
			SettingsRow(icon: "bell", title: "Notifications") { notificationsAccessory }
		}
		.onAppear(perform: refreshStatus)
		.onChange(of: scenePhase) { _, phase in
			guard phase == .active else { return }
			refreshStatus()
		}
	}

	private func refreshStatus() {
		photosStatus = PHPhotoLibrary.authorizationStatus(for: .readWrite)
		Task { notificationStatus = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus }
	}

	// Before the first request, show Apple's permission prompt because Settings doesn't
	// list Photos yet. After that, Settings is where access changes. Limited access
	// can't run automatic background backup, so it isn't presented as an enabled state.
	@ViewBuilder
	private var photosAccessory: some View {
		switch photosStatus {
		case .authorized:
			accessButton("Full Access") { openSettings() }
		case .limited:
			accessButton("Limited") { openSettings() }
		case .notDetermined:
			accessButton("Set Up") {
				Task { photosStatus = await PHPhotoLibrary.requestAuthorization(for: .readWrite) }
			}
		default:
			accessButton("Off") { openSettings() }
		}
	}

	// The photo backup reminder uses these. As with Photos, Settings doesn't list
	// notifications before the first request, so that's asked here.
	@ViewBuilder
	private var notificationsAccessory: some View {
		switch notificationStatus {
		case nil:
			EmptyView()
		case .authorized, .provisional, .ephemeral:
			accessButton("On") { openSettings() }
		case .notDetermined:
			accessButton("Set Up") {
				Task {
					_ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
					refreshStatus()
				}
			}
		default:
			accessButton("Off") { openSettings() }
		}
	}

	private func accessButton(_ title: String, action: @escaping () -> Void) -> some View {
		Button(action: action) {
			SettingsValue(text: title, chevron: true)
		}
		.buttonStyle(.plain)
	}

	private var localNetworkAccessory: some View {
		Button(action: openSettings) {
			SettingsValue(text: model.localNetworkDenied ? "Off" : "Settings", chevron: true)
		}
		.buttonStyle(.plain)
	}

	private func openSettings() {
		if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
	}
}
