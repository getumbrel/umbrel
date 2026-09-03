import Observation
import SwiftUI
import UmbrelKit

// Drives the onboarding flow and owns its shared state. Discovery and auth are wired
// through UmbrelKit (the same engine the macOS app uses) as each screen is built.
@MainActor
@Observable
final class OnboardingModel {
	// Raw values encode flow order so transitions know which direction to push.
	enum Step: Int, Comparable {
		case splash
		case welcome
		case localNetwork
		case finding
		case noDevice
		case deviceFound
		case manualAddress
		case signIn
		case connected

		static func < (lhs: Step, rhs: Step) -> Bool { lhs.rawValue < rhs.rawValue }
	}

	// First run walks the full flow; adding a device from the switcher skips the
	// splash/welcome/permission screens (already seen) and starts at the radar.
	enum Mode {
		case firstRun
		case addDevice
	}

	let mode: Mode
	var step: Step

	// Discovery is either first-run (nothing is saved yet) or entered through the
	// add-device button. Saved IDs let the latter mark known Umbrels without offering
	// to add them again.
	let savedIds: Set<String>
	private(set) var configStorageIssue: Config.StorageIssue?

	init(mode: Mode = .firstRun) {
		self.mode = mode
		step = mode == .addDevice ? .finding : .splash
		let loaded = Config.load()
		savedIds = Set(loaded.config.savedDevices.keys)
		configStorageIssue = loaded.issue
	}

	// Whether the last advance moved forward in the flow; drives the push direction
	// of the step transition (forward pushes left, backing up pushes right).
	private(set) var movingForward = true

	// Completes onboarding; RootView reads this (with the connected device id) to open
	// that device.
	var onFinished: (String) -> Void = { _ in }

	// Leaves an add-device flow without adding anything; RootView returns to the list.
	var onCancel: () -> Void = {}

	// The device the user just signed into, handed to RootView on finish.
	private var connectedDeviceId = ""

	// ── Discovery (UmbrelKit) ──
	private let discovery = Discovery()

	// Umbrel devices found through mDNS and identified by system.discoveryInfo.
	// Raw candidates never cross into the UI or persistence path.
	private(set) var devices: [IdentifiedDevice] = []
	private(set) var updateRequiredDevices: [Umbreld.UpdateRequiredDevice] = []

	enum DiscoveryResult: Identifiable {
		case device(IdentifiedDevice)
		case updateRequired(Umbreld.UpdateRequiredDevice)

		var id: String {
			switch self {
			case .device(let device): "device:\(device.id)"
			case .updateRequired(let device): "update:\(device.host)"
			}
		}
	}

	var discoveryResults: [DiscoveryResult] {
		devices.map(DiscoveryResult.device)
			+ updateRequiredDevices.map(DiscoveryResult.updateRequired)
	}

	// The device the user chose to sign in to.
	var selectedDevice: IdentifiedDevice?

	private var discoveryStarted = false
	private var identificationTask: Task<Void, Never>?
	private var fallbackDiscoveryTask: Task<Void, Never>?
	private var mdnsDevices: [IdentifiedDevice] = []
	private var fallbackUpdateRequiredDevices: [Umbreld.UpdateRequiredDevice] = []
	private var pendingNativeHosts: Set<String> = []
	private var manualAddressReturnStep: Step = .noDevice

	// ── Local Network permission ──
	// iOS exposes no query or request API for this permission: the dialog fires as a
	// side effect of the first browse, denial arrives later as a browse error, and
	// approval is only ever inferred. The pitch screen owns that whole outcome: it
	// stays put under the dialog and the radar only ever means "actually searching".
	enum LocalNetworkPermission {
		case undetermined
		case waiting
		case granted
		case denied
	}

	private(set) var localNetworkPermission: LocalNetworkPermission = .undetermined
	// The dialog pushes the scene inactive; returning to active means it was answered.
	private var sawPermissionDialog = false
	private var permissionAdvanceTask: Task<Void, Never>?

	// Persist the signed-in device + session, then move to the Connected screen. If
	// either durable store fails, roll back the new session so onboarding never claims
	// a connection that won't survive relaunch.
	func completeSignIn(session: Umbreld.Session, account: Umbreld.Account?) async throws {
		guard let device = selectedDevice else { throw SignInError.sessionStorageFailed }
		let id = device.id
		let target = Umbreld.Target(deviceId: id, hosts: [device.host] + device.addresses)
		guard Keychain.setSession(session, deviceId: id) else {
			throw SignInError.sessionStorageFailed
		}
		// Signing in saves access to this Umbrel; it never claims PhotoKit's single
		// backup destination. Only an explicit backup control may do that.
		let loaded = Config.load()
		if let issue = loaded.issue {
			Keychain.deleteSession(deviceId: id)
			try? await Umbreld.logout(target: target, session: session)
			throw issue
		}
		var config = loaded.config
		var savedDevice = SavedDevice(
			id: id,
			name: device.name,
			host: device.host,
			addresses: device.addresses,
			model: device.model,
			userName: nil,
			lastAccountId: session.accountId
		)
		if let account, account.userId == session.accountId {
			savedDevice.saveAccountProfile(
				accountId: account.userId,
				name: account.name,
				wallpaperId: account.wallpaper.id,
				wallpaperBrandColorHsl: account.wallpaper.brandColorHsl,
				role: account.userId == "0" ? "owner" : "member"
			)
		}
		do {
			try config.save(savedDevice)
		} catch {
			Keychain.deleteSession(deviceId: id)
			try? await Umbreld.logout(target: target, session: session)
			throw error
		}
		connectedDeviceId = id
		advance(to: .connected)

		// Prefetch everything Home renders while the user looks at the Connected screen
		// (identity, wallpaper, and a full data snapshot), so the very first Home frame
		// is complete even on a first connect. Best-effort: if Continue outruns this,
		// Home's skeletons cover the gap and its own load fills in.
		Task {
			let target = savedDevice.nativeTarget
			async let userInfo = try? Umbreld.user(target: target, session: session)
			async let appList = try? Umbreld.apps(target: target, session: session)
			async let usage = try? Umbreld.diskUsage(target: target, session: session)
			async let favs = try? Umbreld.favorites(target: target, session: session)
			async let updates = session.accountId == "0"
				? (try? await Umbreld.appUpdates(target: target, session: session)) : nil

			if let info = await userInfo {
				let loaded = Config.load()
				if let issue = loaded.issue {
					configStorageIssue = issue
				} else {
					var config = loaded.config
					do {
						try config.update(id: id) {
							$0.saveAccountProfile(
								accountId: info.userId,
								name: info.name,
								wallpaperId: info.wallpaper.id,
								wallpaperBrandColorHsl: info.wallpaper.brandColorHsl,
								role: info.role
							)
						}
					} catch {
						configStorageIssue = (error as? Config.StorageIssue) ?? .saveFailed
					}
				}
				_ = await WallpaperStore.shared.load(id: info.wallpaper.id, target: target)
			}
			// Only snapshot when the app list arrived; a half-failed prefetch shouldn't
			// suppress Home's skeletons with empty content.
			guard let apps = await appList else { return }
			let updatable = (await updates).map { $0.map(\.id) } ?? []
			DeviceDataStore.save(
				DeviceDataSnapshot(
					apps: apps,
					disk: await usage,
					favoritePaths: Array((await favs ?? []).prefix(4)),
					updatableApps: updatable
				),
				deviceId: id,
				accountId: session.accountId
			)
		}
	}

	func dismissConfigStorageIssue() {
		configStorageIssue = nil
	}

	func advance(to step: Step) {
		movingForward = self.step < step
		withAnimation(.easeOut(duration: 0.4)) {
			self.step = step
		}
	}

	// Starting the browse triggers the iOS Local Network prompt. Idempotent so both
	// "Enable access" and the Finding screen can call it safely.
	func startDiscoveryIfNeeded() {
		guard !discoveryStarted else { return }
		discoveryStarted = true
		discovery.onUpdate = { [weak self] candidates in
			guard let self else { return }
			// Results flowing is the definitive "allowed" signal
			if localNetworkPermission == .waiting, !candidates.isEmpty {
				advanceFromPermission()
			}
			identify(candidates)
		}
		discovery.onPermissionDenied = { [weak self] in
			guard let self, localNetworkPermission == .waiting else { return }
			permissionAdvanceTask?.cancel()
			localNetworkPermission = .denied
		}
		discovery.start()
	}

	// A browse update can arrive first with a hostname and again with resolved IPs.
	// Cancel the superseded batch so a slower, stale probe cannot overwrite newer
	// results. UmbrelKit probes and deduplicates the snapshot before it reaches the UI.
	private func identify(_ candidates: [Candidate]) {
		identificationTask?.cancel()
		pendingNativeHosts = Set(candidates.map { normalizedDiscoveryHost($0.host) })
		if candidates.isEmpty {
			mdnsDevices = []
			publishDiscoveryResults()
			return
		}
		publishDiscoveryResults()

		identificationTask = Task { [weak self] in
			let identified = await Umbreld.identify(
				candidates: candidates,
				knownDeviceIds: savedIds
			)
			guard !Task.isCancelled, let self else { return }
			pendingNativeHosts = []
			mdnsDevices = identified
			publishDiscoveryResults()
		}
	}

	// Bonjour remains the primary path. This bounded fallback starts only after Local
	// Network access is granted and checks legacy default hostnames concurrently.
	func startFallbackDiscoveryIfNeeded() {
		guard fallbackDiscoveryTask == nil else { return }
		fallbackDiscoveryTask = Task { [weak self] in
			let devices = await Umbreld.discoverFallbackHosts()
			guard !Task.isCancelled, let self else { return }
			fallbackUpdateRequiredDevices = devices
			publishDiscoveryResults()
		}
	}

	private func publishDiscoveryResults() {
		devices = mdnsDevices.sorted { $0.host < $1.host }
		let previouslyVisible = Set(updateRequiredDevices.map { normalizedDiscoveryHost($0.host) })
		let verifiedLocations = Set(
			devices.flatMap { [$0.host, $0.discoveryHost] + $0.addresses }.map(normalizedDiscoveryHost)
		)
		// Once a host proves the current native identity, consume its fallback hint so a
		// later Bonjour loss cannot mislabel the now-offline device as needing an update.
		fallbackUpdateRequiredDevices.removeAll {
			verifiedLocations.contains(normalizedDiscoveryHost($0.host))
		}
		let updatesByHost = Dictionary(
			fallbackUpdateRequiredDevices.map { (normalizedDiscoveryHost($0.host), $0) },
			uniquingKeysWith: { first, _ in first }
		)
		updateRequiredDevices = updatesByHost.values.filter {
			let host = normalizedDiscoveryHost($0.host)
			// Hide a newly found fallback while its Bonjour candidate is being verified,
			// but keep an already-visible update card through the post-update handoff.
			return !pendingNativeHosts.contains(host)
				|| (step == .deviceFound && previouslyVisible.contains(host))
		}.sorted { $0.host < $1.host }
	}

	// Keep an explicitly checked address out of scan results. The dedicated route
	// proceeds straight to sign-in and persistence still happens only after login.
	func discoverManually(at address: String) async throws -> DiscoveryResult {
		let result = try await Umbreld.discoverManually(at: address, knownDeviceIds: savedIds)
		try Task.checkCancellation()
		return switch result {
		case .device(let device): .device(device)
		case .updateRequired(let device): .updateRequired(device)
		}
	}

	func showManualAddress() {
		manualAddressReturnStep = step
		advance(to: .manualAddress)
	}

	func leaveManualAddress() {
		let destination = manualAddressReturnStep == .noDevice && !discoveryResults.isEmpty
			? Step.deviceFound : manualAddressReturnStep
		advance(to: destination)
	}

	// "Enable access": starts the browse (summoning the permission dialog) but stays
	// on the pitch screen until the outcome is known, so the dialog lands over the
	// screen that asked for it.
	func enableLocalNetworkAndScan() {
		guard localNetworkPermission == .undetermined || localNetworkPermission == .denied else { return }
		localNetworkPermission = .waiting
		sawPermissionDialog = false
		startDiscoveryIfNeeded()
		// Already granted on a previous run (or the simulator, which never shows the
		// dialog): nothing will interrupt us, so advance after a short quiet period.
		// Cancelled the moment a dialog actually appears.
		scheduleAdvance(after: 1.5)
	}

	// Wired from the pitch screen's scenePhase: the permission dialog pushes the app
	// inactive, so inactive-then-active while waiting means the user answered it.
	func scenePhaseChanged(active: Bool) {
		guard step == .localNetwork else { return }
		if localNetworkPermission == .waiting {
			if !active {
				sawPermissionDialog = true
				permissionAdvanceTask?.cancel()
			} else if sawPermissionDialog {
				// Answered. A denial lands as a browse error within moments; advance
				// after a grace period unless it does.
				scheduleAdvance(after: 0.7)
			}
		} else if localNetworkPermission == .denied, active {
			// Back from Settings. iOS does not relaunch the app when this permission
			// flips, so re-probe by restarting the browse: still denied and the error
			// flips us straight back here, granted and we advance.
			localNetworkPermission = .waiting
			sawPermissionDialog = true
			discovery.stop()
			discovery.start()
			scheduleAdvance(after: 1.0)
		}
	}

	private func scheduleAdvance(after seconds: Double) {
		permissionAdvanceTask?.cancel()
		permissionAdvanceTask = Task { [weak self] in
			try? await Task.sleep(for: .seconds(seconds))
			guard !Task.isCancelled, let self, self.localNetworkPermission == .waiting else { return }
			self.advanceFromPermission()
		}
	}

	private func advanceFromPermission() {
		permissionAdvanceTask?.cancel()
		localNetworkPermission = .granted
		advance(to: .finding)
	}

	// "Scan again" on the no-device screen: restart the browse so it re-enumerates
	// every advertiser instead of just navigating back to the radar.
	func scanAgain() {
		identificationTask?.cancel()
		fallbackDiscoveryTask?.cancel()
		fallbackDiscoveryTask = nil
		mdnsDevices = []
		fallbackUpdateRequiredDevices = []
		pendingNativeHosts = []
		devices = []
		updateRequiredDevices = []
		discovery.stop()
		discovery.start()
		advance(to: .finding)
	}

	func finish() {
		identificationTask?.cancel()
		fallbackDiscoveryTask?.cancel()
		discovery.stop()
		onFinished(connectedDeviceId)
	}
}

private func normalizedDiscoveryHost(_ host: String) -> String {
	let withoutTrailingDot = host.hasSuffix(".") ? String(host.dropLast()) : host
	return withoutTrailingDot.lowercased()
}
