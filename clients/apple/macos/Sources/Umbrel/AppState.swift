import AppKit
import Network
import Observation
import OSLog
import ServiceManagement
import UmbrelKit
import UserNotifications

// The single source of truth. Discovery candidates, identity probes, saved config,
// auth, and share mount state are merged into one `devices` snapshot that every view
// renders from. Any mutation calls rebuild(), so the UI can never disagree with the
// backend state.
//
// Discovery model: mDNS only produces *candidates* (hosts claiming to be Umbrels).
// The device's own API is the oracle for what a host is, which Umbrel it is (stable
// discoveryId), and whether it's onboarded. Requiring system.discoveryInfo over the
// device's enrolled HTTPS identity means every device shown supports all the APIs this
// app uses and subsequent connections cannot silently substitute another host.
// Liveness for saved devices comes from these probes too, so an Umbrel that mDNS
// can't see (other VLAN, multicast-filtering network) still connects via its last
// known host.
@MainActor
@Observable
final class AppState {
	enum AddressConnectionResult {
		case device(String)
		case updateRequired(host: String)
	}

	enum LaunchAtLoginStatus {
		case disabled
		case enabled
		case requiresApproval
		case unavailable
	}

	private static let logger = Logger(subsystem: "com.umbrel.mac", category: "AppState")
	private static let launchAtLoginDefaultAppliedKey = "launchAtLoginDefaultApplied"

	// Team-prefixed App Groups protect local files even though mounting Finder shares
	// requires this app to remain outside App Sandbox. Keep this value identical to
	// the application-groups entitlement used when the app bundle is signed.
	private static let applicationGroupIdentifier = "JABS8D63XG.com.umbrel.mac"

	// The snapshot the UI renders from
	private(set) var devices: [Device] = []
	private(set) var updateRequiredDevices: [Umbreld.UpdateRequiredDevice] = []
	private(set) var configStorageIssue: Config.StorageIssue?
	// Read the service directly whenever the context menu opens so a decision made
	// in System Settings is reflected without relaunching Umbrel or caching OS state.
	var launchAtLoginStatus: LaunchAtLoginStatus {
		switch SMAppService.mainApp.status {
		case .notRegistered:
			.disabled
		case .enabled:
			.enabled
		case .requiresApproval:
			.requiresApproval
		case .notFound:
			// A missing service is still actionable: register() is system-validated and
			// either creates the main-app login item or reports the underlying error.
			.disabled
		@unknown default:
			.unavailable
		}
	}

	// Sources merged into the snapshot
	private var config: Config
	private var mdnsIdentifiedCandidates: [IdentifiedDevice] = []
	private var manuallyIdentifiedCandidates: [String: IdentifiedDevice] = [:]
	private var fallbackUpdateRequiredDevices: [Umbreld.UpdateRequiredDevice] = []
	private var fallbackDiscoveryGeneration = 0
	private var pendingNativeHosts: Set<String> = []
	private var candidateIdentificationTask: Task<Void, Never>?
	private var explicitlyClaimedDeviceIds = Set<String>()
	private var initialDiscoveryWindowElapsed = false
	private var probes: [String: ProbeRecord] = [:] // deviceId -> latest identity probe
	private var probesInFlight: Set<String> = [] // device ids
	private var connectionHosts: [String: String] = [:] // actual endpoint selected by UmbrelKit
	private var completedInitialReachabilityCheck = false
	private(set) var initialDiscoveryInProgress = true
	private var sessions: [String: Umbreld.Session] = [:] // deviceId -> native grant (memory + Keychain)
	private var unavailableSessionIds: Set<String> = []
	private struct SambaAccess {
		let accountId: String
		let enabled: Bool
		let username: String
		let homePath: String
	}
	private struct SambaCredential: Equatable {
		let username: String
		let password: String
	}
	private var sambaAccess: [String: SambaAccess] = [:]
	private var sambaCredentials: [String: SambaCredential] = [:] // memory only; umbreld remains authoritative
	private var deviceShares: [String: [Share]] = [:]
	private var expired: Set<String> = []
	private var connecting: Set<String> = []
	private var disconnecting: Set<String> = []

	private var mountsInProgress: Set<String> = [] // per-device lock: connect flow vs health check
	private var foregroundMounts: Set<String> = [] // user-initiated mounts (excludes silent health checks)
	// Exact paths returned by successful NetFS calls in this process. Unlike paths
	// recovered after launch, these retain enough provenance to manage safely when
	// their old network route is temporarily unreachable.
	private var processCreatedMountPaths: [String: Set<String>] = [:]
	private var notifiedExpired: Set<String> = []
	private var healthCheckRunning = false
	private let discovery = Discovery()
	@ObservationIgnored private var networkPathTask: Task<Void, Never>?

	private struct ProbeRecord {
		var host: String?
		var identity: Umbreld.DiscoveryInfo?
		var checkedAt: Date
	}

	// A successful probe counts as "online" for this long (covers 2+ health cycles)
	private let probeFreshness: TimeInterval = 150
	// Don't re-probe the same host more often than this
	private let probeCooldown: TimeInterval = 30

	private var identifiedCandidates: [IdentifiedDevice] {
		var byId = Dictionary(uniqueKeysWithValues: mdnsIdentifiedCandidates.map { ($0.id, $0) })
		// Prefer an explicitly checked endpoint when both sources identify the same
		// Umbrel; it may be the Tailscale route the user needs right now.
		for (id, device) in manuallyIdentifiedCandidates {
			byId[id] = device
		}
		return byId.values.sorted { $0.host < $1.host }
	}

	init() {
		let loaded: Config.LoadResult
		if Bundle.main.bundleIdentifier == "com.umbrel.mac" {
			loaded = Config.load(applicationGroupIdentifier: Self.applicationGroupIdentifier)
		} else {
			// `swift run` is an unbundled development executable and therefore has no
			// signed App Group entitlement. Production and bundled development builds
			// always use the protected container above.
			loaded = Config.load()
		}
		config = loaded.config
		configStorageIssue = loaded.issue

		// Restore sessions for saved devices from the Keychain
		for id in config.savedDevices.keys {
			switch Keychain.readSession(deviceId: id) {
			case .found(let session):
				sessions[id] = session
			case .unavailable(_, let cachedSession):
				if let cachedSession { sessions[id] = cachedSession }
				unavailableSessionIds.insert(id)
			case .missing, .invalid:
				break
			}
		}
		rebuild()

		discovery.onUpdate = { [weak self] candidates in
			self?.discoveryUpdated(candidates)
		}
		discovery.start()
		Task { await refreshFallbackDiscovery() }
		// Finder mounts outlive the app. Recover the active account's share list immediately so
		// relaunch never briefly presents "Share Home" before the first health check.
		for deviceId in sessions.keys {
			mountAllInBackground(deviceId, silent: true)
		}
		Task {
			try? await Task.sleep(for: .milliseconds(250))
			reloadUnavailableSessions()
			await self.probeSweep()
			completedInitialReachabilityCheck = true
			publishUpdateRequiredDevices()
			rebuild()
		}
		Task {
			// DNS-SD browsing is continuous and has no "finished" callback. Give its
			// initial results time to arrive before offering a manual rescan. If a
			// candidate is already being verified, that real work—not this grace
			// period—controls when the searching state ends.
			try? await Task.sleep(for: .seconds(2))
			initialDiscoveryWindowElapsed = true
			if candidateIdentificationTask == nil {
				initialDiscoveryInProgress = false
			}
			publishUpdateRequiredDevices()
		}
		startHealthLoop()
		startNetworkPathMonitor()
	}

	// ── Snapshot building ──

	private func rebuild() {
		var byId: [String: Device] = [:]

		// Online devices must first answer system.discoveryInfo. TXT identity and state
		// hints never enter the rendered or persisted device model.
		for device in identifiedCandidates {
			byId[device.id] = onlineDevice(
				id: device.id,
				name: device.name,
				host: device.host,
				addresses: device.addresses,
				model: device.model,
				onboarded: device.onboarded
			)
		}

		// Online devices identified by probe: saved devices reachable without mDNS.
		for saved in config.savedDevices.values where byId[saved.id] == nil {
			guard let probe = probes[saved.id], let host = probe.host,
				let identity = probe.identity, identity.id == saved.id, isFresh(probe)
			else { continue }
			byId[identity.id] = onlineDevice(
				id: identity.id,
				name: nil,
				host: host,
				addresses: saved.addresses,
				model: identity.device,
				onboarded: identity.onboarded
			)
		}

		// Saved devices that aren't currently reachable
		for (id, saved) in config.savedDevices where byId[id] == nil {
			byId[id] = Device(
				id: id,
				name: saved.name,
				host: saved.host,
				connectionHost: nil,
				addresses: saved.addresses,
				model: saved.model,
				userName: saved.userName,
				reachability: probes[id] != nil || completedInitialReachabilityCheck
					? .offline : .unverified,
				saved: true,
				connection: connectionState(id: id),
				shares: [],
				onboarded: nil,
				dashboardUsesHTTPS: saved.dashboardUsesHTTPS == true
			)
		}

		// Saved+online first, then saved+offline, then discovered
		func priority(_ device: Device) -> Int {
			if device.saved && device.online { return 0 }
			if device.saved { return 1 }
			return 2
		}
		let newDevices = byId.values.sorted {
			priority($0) != priority($1) ? priority($0) < priority($1) : $0.name.localizedCompare($1.name) == .orderedAscending
		}
		// Skip no-op updates so observers (popup, tray label) aren't invalidated for nothing
		if newDevices != devices {
			devices = newDevices
		}
	}

	// Common construction for devices that are currently reachable, filling in
	// whatever the saved record knows that the live source doesn't
	private func onlineDevice(
		id: String,
		name: String?,
		host: String,
		addresses: [String],
		model: String?,
		onboarded: Bool?
	) -> Device {
		let saved = config.savedDevices[id]
		var seenAddresses = Set<String>()
		// The macOS detail view is an access-method directory, not just a snapshot of
		// the current mDNS browse. Keep every known address visible while reachability
		// and the selected connection endpoint are represented separately.
		let knownAddresses = ((saved?.addresses ?? []) + addresses).filter {
			!$0.isEmpty && seenAddresses.insert($0.lowercased()).inserted
		}
		return Device(
			id: id,
			name: name ?? saved?.name ?? host,
			host: saved?.host ?? host,
			connectionHost: connectionHosts[id],
			addresses: knownAddresses,
			model: model ?? saved?.model,
			userName: saved?.userName,
			reachability: .online,
			saved: saved != nil,
			connection: connectionState(id: id),
			shares: deviceShares[id] ?? [],
			onboarded: onboarded,
			dashboardUsesHTTPS: saved?.dashboardUsesHTTPS == true
		)
	}

	func setDashboardUsesHTTPS(_ enabled: Bool, deviceId: String) {
		do {
			try config.update(id: deviceId) { $0.dashboardUsesHTTPS = enabled }
			rebuild()
		} catch {
			reportConfigStorageIssue(error)
		}
	}

	func dismissConfigStorageIssue() {
		configStorageIssue = nil
	}

	private func reportConfigStorageIssue(_ error: Error) {
		configStorageIssue = (error as? Config.StorageIssue) ?? .saveFailed
	}

	private func isFresh(_ probe: ProbeRecord) -> Bool {
		Date().timeIntervalSince(probe.checkedAt) < probeFreshness
	}

	private func connectionState(id: String) -> ConnectionState {
		if connecting.contains(id) { return .connecting }
		if disconnecting.contains(id) { return .disconnecting }
		if expired.contains(id) { return .expired }
		if sessions[id] != nil { return .connected }
		if unavailableSessionIds.contains(id) { return .connecting }
		return .notAuthenticated
	}

	// ── Discovery + verification pipeline ──

	private func discoveryUpdated(_ list: [Candidate]) {
		candidateIdentificationTask?.cancel()
		pendingNativeHosts = Set(list.map { normalizedDiscoveryHost($0.host) })
		if list.isEmpty {
			candidateIdentificationTask = nil
			mdnsIdentifiedCandidates = []
			if initialDiscoveryWindowElapsed {
				initialDiscoveryInProgress = false
			}
			publishUpdateRequiredDevices()
			rebuild()
			return
		}
		publishUpdateRequiredDevices()

		candidateIdentificationTask = Task { [weak self] in
			guard let self else { return }
			let knownDeviceIds = Set(config.savedDevices.keys).union(explicitlyClaimedDeviceIds)
			var identified = await Umbreld.identify(
				candidates: list,
				knownDeviceIds: knownDeviceIds
			)
			// A first launch can overlap transient network and Keychain setup. Retry
			// this already-discovered snapshot once before asking the user to rescan;
			// every result still has to pass the same HTTPS identity verification.
			if identified.isEmpty, initialDiscoveryInProgress, !Task.isCancelled {
				try? await Task.sleep(for: .milliseconds(500))
				identified = await Umbreld.identify(
					candidates: list,
					knownDeviceIds: knownDeviceIds
				)
			}
			guard !Task.isCancelled else { return }
			candidateIdentificationTask = nil
			pendingNativeHosts = []
			mdnsIdentifiedCandidates = identified
			initialDiscoveryInProgress = false
			publishUpdateRequiredDevices()

			// A matching API response, never its TXT hint, authorizes remembering the
			// route that answered. The authenticated address API later replaces this
			// candidate list with the Umbrel's authoritative current addresses.
			for device in identified {
				guard var saved = config.savedDevices[device.id] else { continue }
				let previous = saved
				saved.mergeVerifiedDiscovery(device)
				if saved != previous {
					do {
						try config.save(saved)
					} catch {
						reportConfigStorageIssue(error)
						break
					}
				}
			}
			rebuild()
		}
	}

	// Older umbrelOS releases do not advertise the native discovery service. Keep
	// their public version responses separate from trusted devices: they can offer an
	// update link, but can never enter authentication or persistence.
	private func refreshFallbackDiscovery() async {
		fallbackDiscoveryGeneration += 1
		let generation = fallbackDiscoveryGeneration
		let devices = await Umbreld.discoverFallbackHosts()
		guard generation == fallbackDiscoveryGeneration else { return }
		fallbackUpdateRequiredDevices = devices
		publishUpdateRequiredDevices()
	}

	private func invalidateFallbackDiscovery() {
		fallbackDiscoveryGeneration += 1
		fallbackUpdateRequiredDevices = []
		updateRequiredDevices = []
	}

	private func publishUpdateRequiredDevices() {
		guard !initialDiscoveryInProgress, completedInitialReachabilityCheck, !scanning else {
			updateRequiredDevices = []
			return
		}
		let previouslyVisible = Set(updateRequiredDevices.map { normalizedDiscoveryHost($0.host) })
		// Keep every verified route when suppressing legacy update hints. The rendered
		// candidate prefers a manually entered endpoint for the same device id, but that
		// must not make its verified Bonjour hostname look like a second, older Umbrel.
		let allIdentifiedCandidates = mdnsIdentifiedCandidates + Array(manuallyIdentifiedCandidates.values)
		let verifiedHosts = Set((
			allIdentifiedCandidates.flatMap { [$0.host, $0.discoveryHost] + $0.addresses }
				+ probes.flatMap { deviceId, probe -> [String] in
					guard probe.identity != nil,
						isFresh(probe),
						let saved = config.savedDevices[deviceId]
					else { return [] }
					return [probe.host].compactMap { $0 } + saved.connectionHosts
				}
		).map(normalizedDiscoveryHost))
		fallbackUpdateRequiredDevices.removeAll {
			verifiedHosts.contains(normalizedDiscoveryHost($0.host))
		}
		let updatesByHost = Dictionary(
			fallbackUpdateRequiredDevices.map { (normalizedDiscoveryHost($0.host), $0) },
			uniquingKeysWith: { first, _ in first }
		)
		updateRequiredDevices = updatesByHost.values.filter {
			let host = normalizedDiscoveryHost($0.host)
			return !pendingNativeHosts.contains(host) || previouslyVisible.contains(host)
		}.sorted { $0.host < $1.host }
	}

	// Saved hosts need periodic liveness probes when no identified mDNS candidate
	// already represents them (other VLANs and multicast-filtering networks).
	private var probeTargetIds: Set<String> {
		Set(config.savedDevices.keys).subtracting(identifiedCandidates.map(\.id))
	}

	// The user-visible "rescan": restart the mDNS browse (a fresh browse re-enumerates
	// every advertiser immediately) and force-probe known hosts. `scanning` drives the
	// feedback in every view and is held long enough for browse results to arrive.
	private(set) var scanning = false

	func rescan() async {
		guard !scanning else { return }
		scanning = true
		invalidateFallbackDiscovery()
		discovery.stop()
		discovery.start()
		async let fallback: Void = refreshFallbackDiscovery()
		async let savedDeviceProbes: Void = probeSweep(force: true)
		try? await Task.sleep(for: .seconds(2))
		_ = await (fallback, savedDeviceProbes)
		scanning = false
		publishUpdateRequiredDevices()
	}

	// Connect-by-address is a navigation flow, not another discovery source. A verified
	// device may drive sign-in and later become a saved card; a legacy endpoint stays on
	// the address screen as an update message and never enters the device list.
	func connectByAddress(_ address: String) async throws -> AddressConnectionResult {
		let knownDeviceIds = Set(config.savedDevices.keys).union(explicitlyClaimedDeviceIds)
		let result = try await Umbreld.discoverManually(
			at: address,
			knownDeviceIds: knownDeviceIds
		)
		try Task.checkCancellation()
		switch result {
		case .device(let device):
			if var saved = config.savedDevices[device.id] {
				// Manual entry proves this route works, but it is not a complete discovery
				// snapshot. Preserve the saved name, primary host, and Bonjour addresses.
				saved.rememberConnectionCandidates([device.host] + device.addresses)
				do {
					try config.save(saved)
				} catch {
					reportConfigStorageIssue(error)
					throw error
				}
				manuallyIdentifiedCandidates[device.id] = nil
				probeCompleted(
					deviceId: device.id,
					host: device.host,
					identity: device.discoveryInfo
				)
			} else {
				// Keep the candidate only while it is needed to drive first sign-in.
				manuallyIdentifiedCandidates[device.id] = device
				connectionHosts[device.id] = device.host
				publishUpdateRequiredDevices()
				rebuild()
			}
			return .device(device.id)
		case .updateRequired(let device):
			return .updateRequired(host: device.host)
		}
	}

	// A device reached only through explicit address entry exists long enough to drive
	// sign-in, but it is not a list result. Cards represent Umbrels the app discovered
	// automatically or that the user successfully connected and saved.
	func isUnsavedManualOnlyDevice(_ deviceId: String) -> Bool {
		config.savedDevices[deviceId] == nil
			&& manuallyIdentifiedCandidates[deviceId] != nil
			&& !mdnsIdentifiedCandidates.contains(where: { $0.id == deviceId })
	}

	func discardUnsavedManualDevice(_ deviceId: String) {
		guard isUnsavedManualOnlyDevice(deviceId) else { return }
		manuallyIdentifiedCandidates[deviceId] = nil
		connectionHosts[deviceId] = nil
		let discardedClaim = explicitlyClaimedDeviceIds.remove(deviceId) != nil
		publishUpdateRequiredDevices()
		rebuild()
		if discardedClaim {
			Task { await Umbreld.forgetLocalHTTPSIdentity(deviceId: deviceId) }
		}
	}

	// force skips the cooldown for explicit user refreshes; in-flight probes still dedupe
	func probeSweep(force: Bool = false) async {
		await probeDevices(probeTargetIds, force: force)
	}

	private func probeDevices(_ deviceIds: Set<String>, force: Bool) async {
		let now = Date()
		let due = deviceIds.filter { deviceId in
			guard !probesInFlight.contains(deviceId) else { return false }
			guard let record = probes[deviceId] else { return true }
			return force || now.timeIntervalSince(record.checkedAt) > probeCooldown
		}
		guard !due.isEmpty else { return }
		probesInFlight.formUnion(due)

		await withTaskGroup(of: (String, String?, Umbreld.DiscoveryInfo?).self) { group in
			for deviceId in due {
				guard let saved = config.savedDevices[deviceId] else { continue }
				group.addTask {
					let result = await Self.firstReachableEndpoint(for: saved)
					return (deviceId, result?.host, result?.identity)
				}
			}
			for await (deviceId, host, identity) in group {
				probeCompleted(deviceId: deviceId, host: host, identity: identity)
			}
		}
	}

	private nonisolated static func firstReachableEndpoint(
		for saved: SavedDevice
	) async -> (host: String, identity: Umbreld.DiscoveryInfo)? {
		guard let host = try? await Umbreld.resolvedHost(for: saved.nativeTarget),
			let identity = await Umbreld.identify(host: host, expectedDeviceId: saved.id)
		else { return nil }
		return (host, identity)
	}

	private func probeCompleted(deviceId: String, host: String?, identity: Umbreld.DiscoveryInfo?) {
		probesInFlight.remove(deviceId)
		probes[deviceId] = ProbeRecord(host: host, identity: identity, checkedAt: Date())
		if let identity, let host {
			connectionHosts[deviceId] = host
			Self.logger.notice(
				"Discovery identified device: id=\(identity.id, privacy: .private(mask: .hash)) host=\(host, privacy: .private(mask: .hash))"
			)
		} else {
			connectionHosts[deviceId] = nil
		}
		publishUpdateRequiredDevices()
		rebuild()
	}

	// True while a user-initiated connect/disconnect/mount is running. The popup
	// suppresses its click-away auto-hide during these: first-mount system dialogs
	// (SMB trust, network-volume permission) briefly take key status, which would
	// otherwise read as "clicked elsewhere" and close the popup mid-flow.
	var hasForegroundActivity: Bool {
		!connecting.isEmpty || !disconnecting.isEmpty || !foregroundMounts.isEmpty
	}

	// ── Tray icon ──
	// Alert state when there are saved devices but none of them is connected

	var showsAlertIcon: Bool {
		let saved = devices.filter(\.saved)
		guard !saved.isEmpty else { return false }
		// Don't flash the alert icon during the app's first reachability check.
		guard !saved.contains(where: { $0.reachability == .unverified }) else { return false }
		return !saved.contains { $0.online && $0.connection == .connected }
	}

	// ── Actions ──

	// Log in, persist the session, save the device (only after login succeeds), then
	// fetch shares and mount them in the background. Throws on bad password/TOTP.
	func connect(
		deviceId: String,
		account: Umbreld.Account,
		password: String,
		totpToken: String?
	) async throws {
		guard let device = device(deviceId), let target = nativeTarget(for: deviceId) else { return }
		connecting.insert(deviceId)
		rebuild()
		defer {
			connecting.remove(deviceId)
			rebuild()
		}
		// A saved device has one active account. Finish tearing down any volumes
		// from the previous session before authenticating a different account.
		try await unmountAllShares(deviceId)
		try Task.checkCancellation()

		let session = try await Umbreld.login(
			target: target,
			userId: account.userId,
			password: password,
			totpToken: totpToken
		)
		// The user may have left or forgotten the device while the request was in
		// flight. Never let that completed request restore local state afterwards.
		try Task.checkCancellation()
		guard storeSession(session, deviceId: deviceId) else {
			// A login that cannot survive this process is not a successful connection.
			// Revoke the unused server grant and leave both memory and disk signed out.
			try? await Umbreld.logout(target: target, session: session)
			throw SessionStorageError()
		}
		connectionHosts[deviceId] = try? await Umbreld.resolvedHost(for: target)
		var savedDevice = config.savedDevices[deviceId]
			?? SavedDevice(
				id: deviceId,
				name: device.name,
				host: device.host,
				addresses: device.addresses,
				model: device.model
			)
		savedDevice.saveAccountProfile(
			accountId: session.accountId,
			name: account.name,
			wallpaperId: account.wallpaper.id,
			wallpaperBrandColorHsl: account.wallpaper.brandColorHsl,
			role: session.accountId == "0" ? "owner" : "member"
		)
		do {
			try config.save(savedDevice)
			explicitlyClaimedDeviceIds.remove(deviceId)
		} catch {
			clearSession(deviceId: deviceId)
			connectionHosts[deviceId] = nil
			try? await Umbreld.logout(target: target, session: session)
			throw error
		}
		// Once the device is saved, normal reachability probes own its online state.
		if let manualDevice = manuallyIdentifiedCandidates.removeValue(forKey: deviceId) {
			probeCompleted(
				deviceId: deviceId,
				host: connectionHosts[deviceId] ?? manualDevice.host,
				identity: manualDevice.discoveryInfo
			)
		}

		// Post-login work is best-effort and shouldn't hold up the "Connected" state
		syncAccountProfile(deviceId: deviceId, target: target, session: session)
		mountAllInBackground(deviceId)
	}

	// Unmount everything and drop the session, but keep the device saved. The
	// transitional state shows immediately; shares drain row by row as they unmount.
	func disconnect(deviceId: String) async throws {
		disconnecting.insert(deviceId)
		rebuild()
		defer {
			disconnecting.remove(deviceId)
			rebuild()
		}

		// Keep the session alive until Finder has safely released every share. The
		// `disconnecting` state makes background work treat this login as stale while the
		// unmounts are in flight, without claiming a failed disconnect succeeded.
		let session = sessions[deviceId]
		try await unmountAllShares(deviceId)
		clearSession(deviceId: deviceId)
		if let target = nativeTarget(for: deviceId), let session {
			// Revoking the parent session also kills any scoped upload capabilities.
			try? await Umbreld.logout(target: target, session: session)
		}
	}

	func forget(deviceId: String) async throws {
		try await disconnect(deviceId: deviceId)
		await Umbreld.forgetLocalHTTPSIdentity(deviceId: deviceId)
		explicitlyClaimedDeviceIds.remove(deviceId)
		manuallyIdentifiedCandidates[deviceId] = nil
		connectionHosts[deviceId] = nil
		try config.remove(id: deviceId)
		rebuild()
	}

	// Enable file sharing for the authenticated account's home directory, then mount it.
	func shareHome(deviceId: String) async throws {
		guard let target = nativeTarget(for: deviceId), let session = sessions[deviceId],
			let access = sambaAccess[deviceId], access.enabled,
			access.accountId == session.accountId else {
			return
		}
		do {
			try await Umbreld.addShare(target: target, session: session, path: access.homePath)
		} catch let error as Umbreld.Error where error.isConnectivityFailure {
			// The server may have committed the share before its response was lost.
			// Confirm that outcome instead of replaying a state-changing request.
			let shares = try await Umbreld.shares(target: target, session: session)
			guard shares.contains(where: { $0.path == access.homePath }) else { throw error }
		}
		guard isCurrentSession(session, deviceId: deviceId) else { return }
		mountAllInBackground(deviceId)
	}

	// ── Shared helpers ──

	private func device(_ id: String) -> Device? {
		devices.first { $0.id == id }
	}

	func nativeTarget(for deviceId: String) -> Umbreld.Target? {
		var hosts: [String] = []
		if let device = device(deviceId) {
			hosts.append(device.host)
			hosts.append(contentsOf: device.addresses)
		}
		if let saved = config.savedDevices[deviceId] {
			hosts.append(contentsOf: saved.connectionHosts)
		}
		guard !hosts.isEmpty else { return nil }
		return Umbreld.Target(deviceId: deviceId, hosts: hosts)
	}

	// Selecting an unsaved card is the user action that establishes first-use trust.
	// Remember the claim in memory immediately so later browse updates validate this
	// id with its new pin even before a successful login saves the device.
	func prepareToSignIn(deviceId: String) async throws {
		if let saved = config.savedDevices[deviceId] {
			let recovered = try await Umbreld.prepareSavedDeviceForSignIn(saved.nativeTarget)
			guard recovered else { return }
			guard let result = await Self.firstReachableEndpoint(for: saved) else {
				throw DeviceIdentityUnavailableError()
			}
			probeCompleted(deviceId: deviceId, host: result.host, identity: result.identity)
			return
		}
		guard !explicitlyClaimedDeviceIds.contains(deviceId) else { return }
		guard let discovered = identifiedCandidates.first(where: { $0.id == deviceId }) else {
			throw DeviceIdentityUnavailableError()
		}
		try await Umbreld.claimLocalHTTPSIdentity(discovered)
		explicitlyClaimedDeviceIds.insert(deviceId)
	}

	func preferredAccountId(for deviceId: String) -> String? {
		config.savedDevices[deviceId]?.lastAccountId
	}

	func canUseFinderSharing(deviceId: String) -> Bool {
		if let access = sambaAccess[deviceId] { return access.enabled }
		// The owner always has Samba access. Member access is hidden until user.get
		// confirms that the owner enabled it for this account.
		return sessions[deviceId]?.accountId == "0"
	}

	// `nil` means shares have not been fetched; an empty array is the authoritative
	// "no shares" result and is the only state where the setup button should appear.
	func hasLoadedFinderShares(deviceId: String) -> Bool {
		deviceShares[deviceId] != nil
	}

	// The in-memory session cache and the Keychain must stay in sync
	@discardableResult
	private func storeSession(_ session: Umbreld.Session, deviceId: String) -> Bool {
		guard Keychain.setSession(session, deviceId: deviceId) else { return false }
		sessions[deviceId] = session
		unavailableSessionIds.remove(deviceId)
		sambaAccess[deviceId] = nil
		sambaCredentials[deviceId] = nil
		expired.remove(deviceId)
		notifiedExpired.remove(deviceId)
		return true
	}

	private func isCurrentSession(_ expected: Umbreld.Session, deviceId: String) -> Bool {
		!disconnecting.contains(deviceId)
			&& sessions[deviceId]?.belongsToSameLogin(as: expected) == true
	}

	private func knownHosts(for deviceId: String) -> Set<String> {
		var hosts = Set<String>()
		if let device = device(deviceId) {
			hosts.insert(device.host)
			hosts.formUnion(device.addresses)
		}
		if let saved = config.savedDevices[deviceId] {
			hosts.insert(saved.host)
			hosts.formUnion(saved.addresses)
		}
		return hosts.filter(SavedDevice.isValidLocalEndpointHost)
	}

	// A server-reported address is only a candidate. Before treating a Finder
	// volume as this Umbrel's, its SMB remount host must prove the same pinned
	// device identity or already be the endpoint verified during this process.
	private func verifiedMountedShares(
		for deviceId: String,
		additionallyTrusting additionalHosts: Set<String> = []
	) async throws -> [Mounter.MountedShare] {
		try Task.checkCancellation()
		let candidates = await Mounter.mountedShares(hosts: knownHosts(for: deviceId))
		try Task.checkCancellation()
		guard !candidates.isEmpty else { return [] }

		var trustedHosts = additionalHosts
		if let connectionHost = connectionHosts[deviceId] {
			trustedHosts.insert(connectionHost)
		}
		var verifiedHostKeys = Set(
			candidates.compactMap { share in
				trustedHosts.contains(where: { Mounter.hostsMatch($0, share.host) })
					? Self.mountHostKey(share.host) : nil
			}
		)
		let hostsToVerify = Dictionary(
			candidates.map { (Self.mountHostKey($0.host), $0.host) },
			uniquingKeysWith: { first, _ in first }
		).filter { !verifiedHostKeys.contains($0.key) }

		let newlyVerified = await withTaskGroup(of: (String, Bool).self) { group in
			for (key, host) in hostsToVerify {
				group.addTask {
					(key, await Umbreld.isKnownEndpointAvailable(host: host, deviceId: deviceId))
				}
			}
			var verified = Set<String>()
			for await (key, isVerified) in group where isVerified {
				verified.insert(key)
			}
			return verified
		}
		verifiedHostKeys.formUnion(newlyVerified)
		try Task.checkCancellation()
		return Mounter.shares(
			candidates,
			ownedByHosts: verifiedHostKeys,
			orCreatedPaths: processCreatedMountPaths[deviceId] ?? []
		)
	}

	private nonisolated static func mountHostKey(_ host: String) -> String {
		host.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
	}

	private func clearSession(deviceId: String) {
		sessions[deviceId] = nil
		connectionHosts[deviceId] = nil
		unavailableSessionIds.remove(deviceId)
		sambaAccess[deviceId] = nil
		sambaCredentials[deviceId] = nil
		expired.remove(deviceId)
		Keychain.deleteSession(deviceId: deviceId)
	}

	private func unmountAllShares(_ deviceId: String) async throws {
		let shares = deviceShares[deviceId] ?? []
		let ownedMounts = try await verifiedMountedShares(for: deviceId)
		let mountedPaths = Array(Set(ownedMounts.map(\.path))).sorted()
		let ownedPaths = Set(mountedPaths)
		let unresolvedTrackedPaths = Set(
			shares.compactMap(\.mountPath).filter {
				Mounter.isMounted(at: $0) && !ownedPaths.contains($0)
			}
		)

		// Mark the whole batch first because unmounts run sequentially.
		deviceShares[deviceId] = shares.map { share in
			var updated = share
			if let path = share.mountPath, ownedPaths.contains(path) {
				updated.status = .unmounting
			}
			return updated
		}
		rebuild()

		var failedPaths = [String]()
		for path in mountedPaths {
			do {
				try await Mounter.unmount(path: path)
				if !Mounter.isMounted(at: path) {
					processCreatedMountPaths[deviceId]?.remove(path)
				}
			} catch {
				// The system call is synchronous, but verify the kernel mount table before
				// reporting failure in case the volume disappeared concurrently.
				if Mounter.isMounted(at: path) {
					failedPaths.append(path)
					let nsError = error as NSError
					Self.logger.error(
						"Unmount failed: path=\(path, privacy: .private(mask: .hash)) domain=\(nsError.domain, privacy: .public) code=\(nsError.code, privacy: .public) description=\(nsError.localizedDescription, privacy: .private)"
					)
				}
			}
		}

		let updatedShares = shares.map { share in
			var updated = share
			if let path = share.mountPath, Mounter.isMounted(at: path) {
				updated.status = .mounted
			} else {
				updated.mountPath = nil
				updated.status = .unmounted
			}
			return updated
		}
		deviceShares[deviceId] = failedPaths.isEmpty && unresolvedTrackedPaths.isEmpty
			? nil : updatedShares
		rebuild()

		if !failedPaths.isEmpty || !unresolvedTrackedPaths.isEmpty {
			throw ShareUnmountError()
		}
	}

	// Refresh the selected account's presentation metadata (non-blocking, best-effort).
	private func syncAccountProfile(deviceId: String, target: Umbreld.Target, session: Umbreld.Session) {
		Task {
			async let userInfo = try? Umbreld.user(target: target, session: session)
			async let addresses = try? Umbreld.ipAddresses(target: target, session: session)
			guard let info = await userInfo,
				isCurrentSession(session, deviceId: deviceId)
			else { return }
			sambaAccess[deviceId] = SambaAccess(
				accountId: info.userId,
				enabled: info.sambaEnabled,
				username: info.sambaUsername,
				homePath: info.homePath
			)
			let refreshedAddresses = await addresses
			do {
				try config.update(id: deviceId) {
					$0.saveAccountProfile(
						accountId: info.userId,
						name: info.name,
						wallpaperId: info.wallpaper.id,
						wallpaperBrandColorHsl: info.wallpaper.brandColorHsl,
						role: info.role
					)
					if let refreshedAddresses {
						$0.replaceAvailableAddresses(refreshedAddresses)
					}
				}
			} catch {
				reportConfigStorageIssue(error)
			}
			rebuild()
		}
	}

	func performLaunchAtLoginAction() {
		let enabled: Bool
		switch launchAtLoginStatus {
		case .disabled:
			enabled = true
		case .enabled:
			enabled = false
		case .requiresApproval:
			// Apple provides this API specifically for directing someone who has
			// declined or revoked a login item to the relevant Settings pane.
			SMAppService.openSystemSettingsLoginItems()
			return
		case .unavailable:
			return
		}

		do {
			if enabled {
				try SMAppService.mainApp.register()
			} else {
				try SMAppService.mainApp.unregister()
			}
		} catch {
			let nsError = error as NSError
			Self.logger.error(
				"Launch at login change failed: domain=\(nsError.domain, privacy: .public) code=\(nsError.code, privacy: .public) description=\(nsError.localizedDescription, privacy: .private)"
			)
		}
	}

	func registerLaunchAtLoginByDefaultIfNeeded() {
		let defaults = UserDefaults.standard
		guard !defaults.bool(forKey: Self.launchAtLoginDefaultAppliedKey) else { return }

		switch SMAppService.mainApp.status {
		case .enabled, .requiresApproval:
			defaults.set(true, forKey: Self.launchAtLoginDefaultAppliedKey)
			return
		case .notRegistered, .notFound:
			break
		@unknown default:
			return
		}

		do {
			try SMAppService.mainApp.register()
			defaults.set(true, forKey: Self.launchAtLoginDefaultAppliedKey)
		} catch {
			let nsError = error as NSError
			// Retry only failures Apple defines as transient. Every other outcome is a
			// final system or user decision; remembering it prevents us from repeatedly
			// trying to override an opt-out on future launches.
			let retryable = nsError.code == kSMErrorInternalFailure
				|| nsError.code == kSMErrorServiceUnavailable
			if !retryable {
				defaults.set(true, forKey: Self.launchAtLoginDefaultAppliedKey)
			}
			Self.logger.error(
				"Default launch at login registration failed: domain=\(nsError.domain, privacy: .public) code=\(nsError.code, privacy: .public) description=\(nsError.localizedDescription, privacy: .private)"
			)
		}
	}

	// ── Mounting ──

	func mountAllInBackground(_ deviceId: String, silent: Bool = false) {
		Task {
			await mountAll(deviceId, silent: silent)
		}
	}

	// Refreshes the share list, unmounts orphans (shares removed/renamed on the Umbrel),
	// and mounts anything unmounted. Share status flows into the snapshot live, so the
	// UI shows "Mounting..." per share as this progresses.
	private func mountAll(
		_ deviceId: String,
		silent: Bool,
		userInfo providedUserInfo: Umbreld.UserInfo? = nil
	) async {
		guard let target = nativeTarget(for: deviceId), let session = sessions[deviceId] else {
			return
		}
		guard !mountsInProgress.contains(deviceId) else { return }
		mountsInProgress.insert(deviceId)
		if !silent { foregroundMounts.insert(deviceId) }
		defer {
			mountsInProgress.remove(deviceId)
			foregroundMounts.remove(deviceId)
			// A new account may have signed in while this mount pass was awaiting I/O.
			// The new pass was deduplicated above, so start it once the stale pass exits.
			if let current = sessions[deviceId],
				!current.belongsToSameLogin(as: session) {
				mountAllInBackground(deviceId, silent: true)
			}
		}

		let userInfo: Umbreld.UserInfo
		do {
			if let providedUserInfo, providedUserInfo.userId == session.accountId {
				userInfo = providedUserInfo
			} else {
				userInfo = try await Umbreld.user(target: target, session: session)
			}
		} catch {
			await handleAuthErrorIfNeeded(error, deviceId: deviceId, session: session)
			return
		}
		guard isCurrentSession(session, deviceId: deviceId) else { return }
		let access = SambaAccess(
			accountId: userInfo.userId,
			enabled: userInfo.sambaEnabled,
			username: userInfo.sambaUsername,
			homePath: userInfo.homePath
		)
		sambaAccess[deviceId] = access
		if !access.enabled {
			do {
				try await unmountAllShares(deviceId)
			} catch {
				let nsError = error as NSError
				Self.logger.error(
					"Disabled-account unmount failed: device=\(deviceId, privacy: .private(mask: .hash)) domain=\(nsError.domain, privacy: .public) code=\(nsError.code, privacy: .public) description=\(nsError.localizedDescription, privacy: .private)"
				)
			}
			sambaCredentials[deviceId] = nil
			rebuild()
			return
		}

		let apiShares: [Umbreld.Share]
		do {
			apiShares = try await Umbreld.shares(target: target, session: session)
		} catch {
			await handleAuthErrorIfNeeded(error, deviceId: deviceId, session: session)
			return
		}
		guard isCurrentSession(session, deviceId: deviceId) else { return }

		let sharePassword: String
		do {
			sharePassword = try await Umbreld.sharePassword(target: target, session: session)
		} catch {
			await handleAuthErrorIfNeeded(error, deviceId: deviceId, session: session)
			return
		}
		guard isCurrentSession(session, deviceId: deviceId) else { return }
		let credential = SambaCredential(username: access.username, password: sharePassword)
		if let previous = sambaCredentials[deviceId], previous != credential {
			// umbreld terminates the old authenticated SMB session when credentials
			// rotate. Gracefully release its Finder volumes before creating the new one.
			do {
				try await unmountAllShares(deviceId)
			} catch {
				return
			}
		}
		sambaCredentials[deviceId] = credential

		let connectionHost: String
		do {
			// API calls may have moved from a stale LAN route to Tailscale (or vice
			// versa). Resolve after them so Finder mounts the same verified endpoint.
			connectionHost = try await Umbreld.resolvedHost(for: target)
			connectionHosts[deviceId] = connectionHost
		} catch {
			return
		}
		guard isCurrentSession(session, deviceId: deviceId) else { return }

		var mountedShares: [Mounter.MountedShare]
		do {
			mountedShares = try await verifiedMountedShares(
				for: deviceId,
				additionallyTrusting: [connectionHost]
			)
		} catch {
			return
		}
		guard isCurrentSession(session, deviceId: deviceId) else { return }

		// Finder mounts survive an app relaunch. Reconcile only mounts whose current
		// remount host proved this Umbrel's identity; unverifiable candidates may be
		// unrelated NAS volumes and are deliberately left untouched.
		let currentSharenames = Set(apiShares.map(\.sharename))
		for share in mountedShares where !currentSharenames.contains(share.sharename) {
			do {
				try await Mounter.unmount(path: share.path)
				if !Mounter.isMounted(at: share.path) {
					processCreatedMountPaths[deviceId]?.remove(share.path)
				}
			} catch {
				let nsError = error as NSError
				Self.logger.error(
					"Orphan unmount failed: path=\(share.path, privacy: .private(mask: .hash)) domain=\(nsError.domain, privacy: .public) code=\(nsError.code, privacy: .public) description=\(nsError.localizedDescription, privacy: .private)"
				)
			}
			guard isCurrentSession(session, deviceId: deviceId) else { return }
		}
		mountedShares.removeAll { !Mounter.isMounted(at: $0.path) }

		// A route change may make a mount's original host unverifiable even though the
		// Umbrel is now reachable elsewhere. Only mounts created by this process retain
		// enough provenance to release in that state; inherited Finder mounts remain
		// untouched unless their host can still prove the pinned device identity.
		let createdPaths = processCreatedMountPaths[deviceId] ?? []
		let alternateCreatedHosts = Set(
			mountedShares.compactMap { share in
				createdPaths.contains(share.path)
					&& !Mounter.hostsMatch(share.host, connectionHost) ? share.host : nil
			}
		)
		var unavailableCreatedHosts = Set<String>()
		for host in alternateCreatedHosts {
			let available = await Umbreld.isKnownEndpointAvailable(host: host, deviceId: deviceId)
			guard isCurrentSession(session, deviceId: deviceId) else { return }
			if !available { unavailableCreatedHosts.insert(host) }
		}
		for share in mountedShares where createdPaths.contains(share.path)
			&& unavailableCreatedHosts.contains(share.host) {
			do {
				try await Mounter.unmount(path: share.path)
				if !Mounter.isMounted(at: share.path) {
					processCreatedMountPaths[deviceId]?.remove(share.path)
				}
			} catch {
				if Mounter.isMounted(at: share.path) {
					let nsError = error as NSError
					Self.logger.error(
						"Route-change unmount failed: path=\(share.path, privacy: .private(mask: .hash)) domain=\(nsError.domain, privacy: .public) code=\(nsError.code, privacy: .public) description=\(nsError.localizedDescription, privacy: .private)"
					)
				}
			}
			guard isCurrentSession(session, deviceId: deviceId) else { return }
		}
		mountedShares.removeAll { !Mounter.isMounted(at: $0.path) }
		mergeShares(deviceId, apiShares, mountedShares: mountedShares)
		rebuild()

		// The mounts below run sequentially, so mark every pending share as mounting up
		// front: rows shouldn't read "Not mounted" while they're just queued behind the
		// first mount's SMB session setup.
		for share in deviceShares[deviceId] ?? [] where share.status != .mounted {
			setShare(deviceId, share.sharename, path: share.mountPath, status: .mounting)
		}

		// Mount sequentially: parallel NetFSMountURLSync calls have caused silent failures
		var needsFreshSession = mountedShares.isEmpty
		for share in deviceShares[deviceId] ?? [] {
			if let path = share.mountPath, Mounter.isMounted(at: path) {
				setShare(deviceId, share.sharename, path: path, status: .mounted)
				continue
			}
			setShare(deviceId, share.sharename, path: share.mountPath, status: .mounting)
			do {
				let path = try await Mounter.mount(
					host: connectionHost,
					sharename: share.sharename,
					username: credential.username,
					password: sharePassword,
					forceNewSession: needsFreshSession,
					silent: silent
				)
				processCreatedMountPaths[deviceId, default: []].insert(path)
				needsFreshSession = false
				guard isCurrentSession(session, deviceId: deviceId) else {
					// This mount completed for an account that is no longer active.
					try? await Mounter.unmount(path: path)
					if !Mounter.isMounted(at: path) {
						processCreatedMountPaths[deviceId]?.remove(path)
					}
					return
				}
				setShare(deviceId, share.sharename, path: path, status: .mounted)
			} catch {
				guard isCurrentSession(session, deviceId: deviceId) else { return }
				setShare(deviceId, share.sharename, path: nil, status: .unmounted)
				let nsError = error as NSError
				Self.logger.error(
					"Mount failed: share=\(share.sharename, privacy: .private(mask: .hash)) domain=\(nsError.domain, privacy: .public) code=\(nsError.code, privacy: .public) description=\(nsError.localizedDescription, privacy: .private)"
				)
			}
		}

		if !silent, isCurrentSession(session, deviceId: deviceId),
			let path = (deviceShares[deviceId] ?? []).first(where: { $0.status == .mounted })?.mountPath {
			await primeNetworkVolumeAccess(path: path)
		}
	}

	// macOS asks for "files on a network volume" permission the first time we touch a
	// mounted share, and without this that happens at unmount, so the prompt appears
	// while the user is disconnecting. Reading the volume once right after a mount
	// moves the one-time prompt to the moment the user just asked for their files.
	// The read blocks until the prompt is answered, and awaiting it keeps the
	// foreground-activity window open so the popup doesn't auto-hide under the dialog.
	private var networkVolumeAccessPrimed = false
	private func primeNetworkVolumeAccess(path: String) async {
		guard !networkVolumeAccessPrimed else { return }
		networkVolumeAccessPrimed = true
		await Mounter.primeNetworkVolumeAccess(path: path)
	}

	// Map API shares into Share state, preserving known mount paths. The kernel mount
	// table is authoritative: never carry an old `.unmounted` status forward once its
	// volume is present.
	private func mergeShares(
		_ deviceId: String,
		_ apiShares: [Umbreld.Share],
		mountedShares: [Mounter.MountedShare]
	) {
		let existing = deviceShares[deviceId] ?? []
		deviceShares[deviceId] = apiShares.map { api in
			let old = existing.first { $0.sharename == api.sharename }
			if let old, let path = old.mountPath, Mounter.isMounted(at: path) {
				return Share(
					name: api.name,
					path: api.path,
					sharename: api.sharename,
					mountPath: old.mountPath,
					status: .mounted
				)
			}
			// Recover the exact path from the SMB remount URL. A path-only check can
			// mistake an unrelated volume with the same Finder name for this Umbrel.
			if let mounted = mountedShares.first(where: { $0.sharename == api.sharename }) {
				return Share(
					name: api.name,
					path: api.path,
					sharename: api.sharename,
					mountPath: mounted.path,
					status: .mounted
				)
			}
			return Share(
				name: api.name,
				path: api.path,
				sharename: api.sharename,
				mountPath: nil,
				status: .unmounted
			)
		}
	}

	private func setShare(_ deviceId: String, _ sharename: String, path: String?, status: MountStatus) {
		guard var shares = deviceShares[deviceId],
			let index = shares.firstIndex(where: { $0.sharename == sharename })
		else { return }
		shares[index].mountPath = path
		shares[index].status = status
		deviceShares[deviceId] = shares
		rebuild()
	}

	// ── Health check ──
	// Runs every 60s and 5s after wake from sleep. First a probe sweep refreshes
	// liveness (and discovers newly reachable devices), then for each saved online
	// device: remount dropped shares, refresh native access before expiry, detect
	// expired sessions. The share password cache is cleared each cycle so rotations
	// on the Umbrel are picked up.

	private func startNetworkPathMonitor() {
		networkPathTask = Task { [weak self] in
			var receivedInitialPath = false
			for await _ in NWPathMonitor() {
				if !receivedInitialPath {
					receivedInitialPath = true
					continue
				}
				guard let self else { return }
				await refreshAfterNetworkPathChange()
			}
		}
	}

	// A path event says that Wi-Fi, Ethernet, or a VPN route changed; it does not say
	// whether an Umbrel is reachable. Keep the current UI stable while any old probe
	// finishes, then discard each cached endpoint winner and verify every saved device
	// again. Owner accounts then reconcile Finder mounts against the verified route.
	// This lets a Mac move cleanly between a local address and Tailscale.
	private func refreshAfterNetworkPathChange() async {
		// DNSServiceBrowse is continuous across interface changes and publishes real
		// add/remove events itself. Restarting it here first publishes an empty snapshot,
		// which makes every unsaved native device disappear during ordinary route churn
		// (for example when Tailscale updates its routes). Likewise, keep the last bounded
		// fallback snapshot visible until the replacement probe completes instead of
		// briefly clearing every legacy device. The generation check in
		// refreshFallbackDiscovery ensures only the newest path refresh can publish.
		async let fallback: Void = refreshFallbackDiscovery()
		let savedDevices = Array(config.savedDevices.values)
		let deviceIds = Set(savedDevices.map(\.id))
		guard !deviceIds.isEmpty else {
			await fallback
			return
		}

		while !probesInFlight.isDisjoint(with: deviceIds) {
			do {
				try await Task.sleep(for: .milliseconds(100))
			} catch {
				return
			}
		}
		for device in savedDevices {
			await Umbreld.invalidateResolvedHost(for: device.nativeTarget)
		}
		await probeDevices(deviceIds, force: true)
		for deviceId in deviceIds where sessions[deviceId] != nil {
			mountAllInBackground(deviceId, silent: true)
		}
		await fallback
	}

	private func startHealthLoop() {
		Task { [weak self] in
			try? await Task.sleep(for: .seconds(10))
			while true {
				await self?.healthCheck()
				try? await Task.sleep(for: .seconds(60))
			}
		}
		NSWorkspace.shared.notificationCenter.addObserver(
			forName: NSWorkspace.didWakeNotification, object: nil, queue: .main
		) { [weak self] _ in
			Task { @MainActor [weak self] in
				try? await Task.sleep(for: .seconds(5))
				await self?.healthCheck()
			}
		}
	}

	private func healthCheck() async {
		guard !healthCheckRunning else { return } // interval and wake can overlap
		healthCheckRunning = true
		defer { healthCheckRunning = false }
		reloadUnavailableSessions()

		// Refresh liveness first so the loop below sees accurate online state
		await probeSweep()

		for device in devices where device.saved && device.online {
			guard let session = sessions[device.id], let target = nativeTarget(for: device.id) else { continue }
			var validatedUser: Umbreld.UserInfo?
			var refreshedAddresses: [String]?

			// Refresh the device grant when needed under the shared coordinator. A
			// network failure stays offline; a definitive auth rejection clears it.
			do {
				let renewed = try await Umbreld.renewSession(target: target, session: session)
				guard isCurrentSession(session, deviceId: device.id) else { continue }
				// Access can be locally unexpired but revoked server-side. This cheap
				// authenticated read keeps "Connected" tied to server truth every cycle.
				async let userInfo = Umbreld.user(target: target, session: renewed)
				async let addresses = try? Umbreld.ipAddresses(target: target, session: renewed)
				validatedUser = try await userInfo
				refreshedAddresses = await addresses
				guard isCurrentSession(session, deviceId: device.id) else { continue }
				// The authenticated read may itself refresh through the shared coordinator.
				// Update only the memory cache here: that coordinator already persisted the
				// authoritative session, and writing `renewed` could put an older token back.
				switch Keychain.readSession(deviceId: device.id) {
				case .found(let current) where current.belongsToSameLogin(as: session):
					sessions[device.id] = current
					unavailableSessionIds.remove(device.id)
				case .found:
					continue
				case .unavailable:
					sessions[device.id] = renewed
					unavailableSessionIds.insert(device.id)
				case .missing, .invalid:
					sessions[device.id] = renewed
				}
				expired.remove(device.id)
				notifiedExpired.remove(device.id)
			} catch {
				if (error as? Umbreld.Error)?.isAuthError == true {
					await sessionExpired(device.id, session: session)
					continue
				}
				// Network blip: retry next cycle
			}
			guard isCurrentSession(session, deviceId: device.id) else { continue }

			await mountAll(device.id, silent: true, userInfo: validatedUser)

			if let validatedUser, isCurrentSession(session, deviceId: device.id) {
				connectionHosts[device.id] = try? await Umbreld.resolvedHost(for: target)
				do {
					try config.update(id: device.id) {
						$0.saveAccountProfile(
							accountId: validatedUser.userId,
							name: validatedUser.name,
							wallpaperId: validatedUser.wallpaper.id,
							wallpaperBrandColorHsl: validatedUser.wallpaper.brandColorHsl,
							role: validatedUser.role
						)
						if let refreshedAddresses {
							$0.replaceAvailableAddresses(refreshedAddresses)
						}
					}
				} catch {
					reportConfigStorageIssue(error)
				}
			}
		}
		rebuild()
	}

	private func reloadUnavailableSessions() {
		guard !unavailableSessionIds.isEmpty else { return }
		for id in Array(unavailableSessionIds) {
			switch Keychain.readSession(deviceId: id) {
			case .found(let session):
				sessions[id] = session
				unavailableSessionIds.remove(id)
			case .missing, .invalid:
				sessions[id] = nil
				unavailableSessionIds.remove(id)
			case .unavailable(_, let cachedSession):
				if let cachedSession { sessions[id] = cachedSession }
				break
			}
		}
		rebuild()
	}

	// ── Session expiry ──

	private func handleAuthErrorIfNeeded(
		_ error: Error,
		deviceId: String,
		session: Umbreld.Session
	) async {
		if (error as? Umbreld.Error)?.isAuthError == true {
			await sessionExpired(deviceId, session: session)
		}
	}

	private func sessionExpired(_ deviceId: String, session: Umbreld.Session) async {
		guard isCurrentSession(session, deviceId: deviceId) else { return }
		clearSession(deviceId: deviceId)
		expired.insert(deviceId)
		rebuild()
		do {
			try await unmountAllShares(deviceId)
		} catch {
			// The expired session cannot remain active, but a busy Finder volume must
			// still be left mounted rather than forcibly detached.
			let nsError = error as NSError
			Self.logger.error(
				"Expired-session unmount failed: device=\(deviceId, privacy: .private(mask: .hash)) domain=\(nsError.domain, privacy: .public) code=\(nsError.code, privacy: .public) description=\(nsError.localizedDescription, privacy: .private)"
			)
		}
		await notifySessionExpired(deviceId)
	}

	private func notifySessionExpired(_ deviceId: String) async {
		guard !notifiedExpired.contains(deviceId) else { return }
		notifiedExpired.insert(deviceId)
		// Notifications need a real app bundle; skip under bare `swift run`
		guard Bundle.main.bundleIdentifier != nil else { return }
		let center = UNUserNotificationCenter.current()
		// Permission is requested here, at first use, so the system prompt appears
		// alongside an actual notification rather than context-free at launch.
		guard (try? await center.requestAuthorization(options: [.alert])) == true else { return }

		let deviceName = config.savedDevices[deviceId]?.displayName
		let content = UNMutableNotificationContent()
		content.title = "Session expired"
		content.body = "Your login session for \(deviceName ?? "your device") has expired. Open Umbrel to reconnect."
		let request = UNNotificationRequest(identifier: "expired-\(deviceId)", content: content, trigger: nil)
		try? await center.add(request)
	}
}

private func normalizedDiscoveryHost(_ host: String) -> String {
	let withoutTrailingDot = host.hasSuffix(".") ? String(host.dropLast()) : host
	return withoutTrailingDot.lowercased()
}

private struct SessionStorageError: LocalizedError {
	var errorDescription: String? {
		"Couldn\u{2019}t securely save your login. Please try again."
	}
}

private struct ShareUnmountError: LocalizedError {
	var errorDescription: String? {
		"Some shared folders couldn’t be disconnected. Close any files open from this Umbrel, then try again."
	}
}

private struct DeviceIdentityUnavailableError: LocalizedError {
	var errorDescription: String? {
		"Couldn’t verify this Umbrel. Scan the network and try again."
	}
}
