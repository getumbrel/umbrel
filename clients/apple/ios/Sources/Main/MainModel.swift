import CoreTelephony
import Observation
import OSLog
import Photos
import SwiftUI
import UIKit
import UmbrelKit

// Owns the connected session for the main app: the saved device and session persisted
// by onboarding, plus the live data the tabs render (user, apps, storage, files).
// Everything is loaded over the local network from the connected umbrelOS device.
@MainActor
@Observable
final class MainModel {
	private struct BrowserEndpoint {
		enum Kind {
			case tailscaleDNS
			case localDNS
			case tailscaleIP
			case localIP
		}

		let host: String
		let kind: Kind

		var isTailscale: Bool { kind == .tailscaleDNS || kind == .tailscaleIP }
		var isLiteralIP: Bool { kind == .tailscaleIP || kind == .localIP }
	}

	enum RefreshScope {
		case home, apps, library, profile, connection
	}

	enum ConnectionState: Equatable {
		case unverified
		case connected
		case unavailable
		case localNetworkDenied
	}

	enum ConnectionRoute: Equatable {
		case local
		case tailscale
	}

	enum PhotoBackupStatus: Equatable {
		case off
		case settingUp
		// A restored iPhone carrying on the backup of the iPhone it was set up from
		case continuing(String)
		case connecting
		case waitingForUmbrel
		case waitingForTailscale
		case waitingForWiFi
		case checkingStorage
		case paused
		case error
		case backingUp(Int?)
		case upToDate
		// Only failed items remain. The extension retries them, and until the app can list
		// them there's nothing for the user to do.
		case upToDateExceptFailures

		var text: String {
			switch self {
			case .off: "Backup off"
			case .settingUp: "Starting backup…"
			case .continuing(let name): "Continuing \u{201c}\(name)\u{201d} backup…"
			case .connecting: "Connecting to your Umbrel…"
			case .waitingForUmbrel: "Waiting for your Umbrel"
			case .waitingForTailscale: "Waiting for Tailscale"
			case .waitingForWiFi: "Waiting for Wi-Fi"
			case .checkingStorage: "Checking storage…"
			case .paused: "Backup paused"
			case .error: "Backup needs attention"
			case .backingUp(let remaining):
				remaining.map { "Backing up \u{00B7} \($0.formatted()) left" } ?? "Checking backup…"
			case .upToDate: "All backed up"
			case .upToDateExceptFailures: "Up to date"
			}
		}

		var color: Color {
			switch self {
			case .off: Theme.gray
			case .error, .paused: Theme.red
			case .upToDate, .upToDateExceptFailures: Theme.online
			case .settingUp, .continuing, .connecting, .waitingForUmbrel, .waitingForTailscale, .waitingForWiFi,
				.checkingStorage, .backingUp:
				Theme.syncing
			}
		}
	}

	enum PhotoBackupNotice: Equatable {
		case backgroundRefreshUnavailable
		case waitingForTailscale
		case awayFromUmbrel
		case tailscaleAddressChanged
		// Without Tailscale, once backup has caught up
		case backUpAnywhere
		case checkingStorage
		case insufficientStorage
		case reconnect
		case needsAttention

		enum Action: Equatable {
			case setUpTailscale
			case retryStorage
			case retryBackup
		}

		var icon: String {
			switch self {
			case .backgroundRefreshUnavailable:
				"arrow.clockwise.circle"
			case .waitingForTailscale, .tailscaleAddressChanged:
				"network"
			case .awayFromUmbrel:
				"wifi.exclamationmark"
			case .backUpAnywhere:
				"network"
			case .checkingStorage:
				"externaldrive.badge.questionmark"
			case .insufficientStorage:
				"externaldrive.badge.exclamationmark"
			case .reconnect:
				"key.horizontal"
			case .needsAttention:
				"exclamationmark.triangle"
			}
		}

		var title: String {
			switch self {
			case .backgroundRefreshUnavailable: "Background backup is off"
			case .waitingForTailscale: "Connect to Tailscale"
			case .awayFromUmbrel: "Away from your Umbrel"
			case .backUpAnywhere: "Back up from anywhere"
			case .tailscaleAddressChanged: "Reconnect background backup"
			case .checkingStorage: "Checking storage…"
			case .insufficientStorage: "Photo backup paused"
			case .reconnect: "Photo backup stopped"
			case .needsAttention: "Photo backup needs attention"
			}
		}

		var message: String {
			switch self {
			case .backgroundRefreshUnavailable:
				"Check Settings → General → Background App Refresh so iOS can also back up while this app is closed."
			case .waitingForTailscale:
				"Backup continues once this iPhone can reach your Umbrel, at home or through Tailscale."
			case .awayFromUmbrel:
				"With Tailscale, your photos back up even when you\u{2019}re away from home."
			case .backUpAnywhere:
				"With Tailscale, your photos back up even when you\u{2019}re away from home, and your Umbrel works from anywhere."
			case .tailscaleAddressChanged:
				"Tailscale was reset on your Umbrel. Backup still runs while this app is open."
			case .checkingStorage:
				"Backup will resume automatically if enough space is available."
			case .insufficientStorage:
				"Free up storage on your Umbrel, then try again."
			case .reconnect:
				"Reconnect to keep backing up, or turn it off in Profile."
			case .needsAttention:
				"Backup couldn’t continue. Try again. If this keeps happening, contact Umbrel Support."
			}
		}

		var action: Action? {
			switch self {
			case .waitingForTailscale, .awayFromUmbrel, .tailscaleAddressChanged, .backUpAnywhere: .setUpTailscale
			case .insufficientStorage: .retryStorage
			case .reconnect, .needsAttention: .retryBackup
			case .backgroundRefreshUnavailable, .checkingStorage: nil
			}
		}

		var actionLabel: String? {
			switch self {
			case .reconnect, .tailscaleAddressChanged: "Reconnect"
			case .awayFromUmbrel, .backUpAnywhere: "Set Up"
			case .insufficientStorage, .needsAttention: "Try Again"
			case .backgroundRefreshUnavailable, .waitingForTailscale, .checkingStorage: nil
			}
		}
	}

	private static let logger = Logger(subsystem: "com.umbrel.app", category: "PhotoBackup")
	// These resources have no native change-event stream. Small, foreground-only
	// refreshes keep the UI current without maintaining a background connection or
	// repeatedly fetching data that the visible tab cannot display.
	// TODO: Replace polling with native change events when umbreld exposes them.
	private static let identityRefreshInterval: TimeInterval = 15
	private static let appsRefreshInterval: TimeInterval = 15
	private static let photoReceiptRefreshInterval: TimeInterval = 15
	private static let homeRefreshInterval: TimeInterval = 60
	private static let updatesRefreshInterval: TimeInterval = 5 * 60
	private static let browserReachabilityLifetime: TimeInterval = 2 * 60
	private static let tailscalePreferenceTimeout: TimeInterval = 1

	private(set) var device: SavedDevice?
	private(set) var session: Umbreld.Session?

	private(set) var userName: String?
	private(set) var wallpaperImage: UIImage?
	private(set) var blurredWallpaper: UIImage?
	private(set) var wallpaperId: String?
	private(set) var wallpaperBrandColorHsl: String?
	@ObservationIgnored private var renderedWallpaperId: String?
	private(set) var accountRole: String?
	private(set) var backupPhotosEnabled = false
	private(set) var backupVideosEnabled = false
	private(set) var backupCellularEnabled = false
	private(set) var cellularDataRestricted = false
	// The host app does not use ordinary background fetch; PhotoKit schedules the
	// upload extension itself. iOS nevertheless gates that extension behind the
	// device's effective Background App Refresh status, so observe the system state
	// without adding an unrelated UIBackgroundModes capability.
	private(set) var backgroundRefreshStatus: UIBackgroundRefreshStatus = .available
	// PhotoKit provides one app-wide background uploader. When it is configured for
	// another saved Umbrel account, this screen says where backup goes and offers only a
	// confirmed switch, never controls that would silently move the entire iPhone library.
	private(set) var otherPhotoBackupDestinationName: String?
	private(set) var tailscaleSetupPresented = false
	private(set) var configStorageIssue: Config.StorageIssue?
	private(set) var photoBackupSetupInProgress = false
	// The backup a restored iPhone is carrying on while setup runs, for its status
	private var photoBackupContinuingName: String?
	// The identity step for files sent before uploads carried them, once per source
	@ObservationIgnored private var photoBackupIdentityTask: Task<Void, Never>?
	// This launch's Umbrel can't take identities yet, so it isn't asked again until next launch
	@ObservationIgnored private var photoBackupIdentitiesDeclinedSourceId: String?
	// The account's iPhone source names from the last check, so a new source isn't given
	// the name of an existing one
	@ObservationIgnored private var knownIPhoneSourceNames: [String] = []
	private var photoBackupSetupFailure: PhotoBackupSetupFailure?
	private(set) var photoBackupStorageRetrying = false
	private(set) var photoBackupRecoveryRetrying = false
	private(set) var apps: [Umbreld.AppSummary] = []
	private(set) var disk: Umbreld.DiskUsage?
	// The user's favorite folders (first 4), matching the umbrelOS files-favorites widget.
	private(set) var favoritePaths: [String] = []
	// Ids of installed apps with a newer version in the registry.
	private(set) var updatableApps: [String] = []
	var updateCount: Int { updatableApps.count }
	// True once the first load finishes, so empty states don't flash while loading.
	private(set) var didLoad = false
	private(set) var photoBackup = PhotoBackupStore.snapshot
	// photoBackup starts as whatever the extension last published, possibly another
	// Umbrel's, until this Umbrel's own source has been read from the Keychain
	private(set) var photoBackupSourceResolved = false
	// Receipt-cache invalidation is separate from the extension's snapshot time.
	// The host can record a live PhotoKit change in the shared ledger before the
	// extension publishes its next phase snapshot.
	private(set) var photoBackupReceiptRevision = PhotoBackupStore.snapshot.updatedAt
	let photoLibrary = PhotoLibraryModel()
	let photoBackupReceipts = PhotoBackupReceiptCache(ledgerURL: PhotoBackupStore.ledgerURL)

	// A saved session means signed in, not necessarily reachable. The first request
	// establishes the initial state; later refreshes keep the last confirmed result so
	// normal polling never flashes a transient status.
	private(set) var connectionState: ConnectionState = .unverified
	// The Umbrel answered with a different identity than the one this iPhone paired
	// with, as it does after the Umbrel or its certificate is reset. Only set while
	// connectionState is .unavailable: the user has to remove it and add it again.
	private(set) var identityChanged = false
	private(set) var connectionRoute: ConnectionRoute?
	private(set) var tailscaleAvailableOnThisPhone: Bool?
	private(set) var tailscaleAvailabilityCheckInProgress = false
	var localNetworkDenied: Bool { connectionState == .localNetworkDenied }
	@ObservationIgnored private let onConnectionCheck: (ConnectionState) -> Void
	// iOS owns the app-wide cellular permission. Observe its policy so the Profile
	// toggle can preserve intent while explaining when the system setting blocks it.
	@ObservationIgnored private let cellularData = CTCellularData()

	// PhotoKit exposes one app-global extension. Serialize setup across transient
	// MainModel instances so device switches and rapid toggle changes cannot race
	// grants, shared configuration, or enable/disable calls.
	private static var photoBackupOperationTail: Task<Void, Never>?
	@ObservationIgnored private var backupSyncTask: Task<Void, Never>?
	@ObservationIgnored private var backupSyncRevision = 0
	@ObservationIgnored private var presentationLedger: PhotoBackupLedger?
	@ObservationIgnored private var presentationLedgerSourceId: String?
	@ObservationIgnored private var presentationSnapshotDate: Date?
	// SwiftUI derives presentation from these in-memory values. The existing refresh
	// path owns the coordinated-file and PhotoKit reads that populate them.
	private var photoBackupPresentationConfiguration: PhotoBackupConfiguration?
	private var photoBackupPresentationTargetActive = false
	private var photoBackupPresentationExtensionEnabled = false
	private var configuredPhotoBackupTailscaleHost: String?
	@ObservationIgnored private var otherPhotoBackupTarget: PhotoBackupPreferenceTarget?
	@ObservationIgnored private var remoteRefreshInProgress = false
	@ObservationIgnored private var confirmedConnection = false
	@ObservationIgnored private var completedActivationRefresh = false
	@ObservationIgnored private var lastIdentityRefresh: Date?
	@ObservationIgnored private var lastAppsRefresh: Date?
	@ObservationIgnored private var lastPhotoReceiptRefresh: Date?
	@ObservationIgnored private var lastDiskRefresh: Date?
	@ObservationIgnored private var lastFavoritesRefresh: Date?
	@ObservationIgnored private var lastUpdatesRefresh: Date?
	// Normal foreground API responses populate this cache. Browser address selection
	// reuses that evidence instead of adding another periodic network probe.
	@ObservationIgnored private var recentlyReachableBrowserAddresses: [String: Date] = [:]

	// Back to the all-devices list (set by MainView).
	var onBack: () -> Void = {}
	// Sign-out clears this device's session, then returns to the all-devices list.
	var onLogOut: () -> Void = {}
	// Removes this Umbrel and goes straight to adding it again (set by MainView), for
	// when the app no longer recognizes it.
	var onReconnect: () async -> Void = {}
	// Switch the tab bar to another tab (set by MainView); used by the Home section
	// headers and the library preview card.
	var openLibrary: () -> Void = {}
	var openApps: () -> Void = {}

	init(
		device: SavedDevice,
		initialConnectionState: ConnectionState = .unverified,
		onConnectionCheck: @escaping (ConnectionState) -> Void = { _ in }
	) {
		self.device = device
		connectionState = initialConnectionState
		self.onConnectionCheck = onConnectionCheck
		backgroundRefreshStatus = UIApplication.shared.backgroundRefreshStatus
		session = Keychain.readSession(deviceId: device.id).session
		cellularData.cellularDataRestrictionDidUpdateNotifier = { [weak self] state in
			let isRestricted = state == .restricted
			Task { @MainActor [weak self] in
				self?.cellularDataRestricted = isRestricted
			}
		}
		if let configuration = PhotoBackupStore.configuration() {
			PhotoBackupPreferenceStore.reconcileActiveTarget(
				deviceId: configuration.deviceId,
				accountId: configuration.source.accountId
			)
		}
		if let session {
			let preference = PhotoBackupPreferenceStore.preference(
				deviceId: device.id,
				accountId: session.accountId
			)
			if PhotoBackupPreferenceStore.isActive(deviceId: device.id, accountId: session.accountId) {
				backupPhotosEnabled = preference.includesPhotos
				backupVideosEnabled = preference.includesVideos
				// Builds up to 38 kept an unanswered "new iPhone" question here, and builds
				// 38 and 39 a claim step to finish
				UserDefaults.standard.removeObject(
					forKey: "photo-backup-new-source-question:\(device.id):\(session.accountId)"
				)
				UserDefaults.standard.removeObject(
					forKey: "photo-backup-claim-pending:\(device.id):\(session.accountId)"
				)
			}
			// This remains a useful preference while backup is off, so restore it even
			// when this account does not currently own PhotoKit's single uploader.
			backupCellularEnabled = preference.allowsCellular
		}
		// App Group configuration and Keychain grants are separate stores. If a
		// previous process died during an account handoff, fail closed instead of
		// letting the old configuration read the new account's credential.
		if let configuration = PhotoBackupStore.configuration(),
			configuration.deviceId == device.id,
			configuration.source.accountId != session?.accountId
		{
			PhotoBackupAppRunner.shared.forget()
			if PHPhotoLibrary.shared().uploadJobExtensionEnabled {
				try? PHPhotoLibrary.shared().setUploadJobExtensionEnabled(false)
			}
			PhotoBackupStore.clearConfiguration()
			Keychain.deletePhotoBackupGrant(
				deviceId: configuration.deviceId,
				accountId: configuration.source.accountId
			)
		}
		// Restore the last-known identity immediately. A decoded in-memory wallpaper is
		// also available synchronously, so a screen recreated by SwiftUI does not briefly
		// render without it. Disk reads and decoding remain asynchronous; load() revalidates.
		let accountProfile = session.flatMap { device.accountProfile(for: $0.accountId) }
		userName = accountProfile?.name
		wallpaperId = accountProfile?.wallpaperId
		wallpaperBrandColorHsl = accountProfile?.wallpaperBrandColorHsl
		accountRole = accountProfile?.role ?? (session?.accountId == "0" ? "owner" : "member")
		if let id = accountProfile?.wallpaperId {
			let fullScreen = WallpaperStore.shared.memoryCached(id: id)
			wallpaperImage = fullScreen ?? WallpaperStore.shared.memoryCachedCard(id: id)
			blurredWallpaper = WallpaperStore.shared.memoryBlurred(id: id)
			if fullScreen != nil { renderedWallpaperId = id }
			Task { @MainActor [weak self] in
				let fullScreen = await WallpaperStore.shared.cached(id: id)
				let card = fullScreen == nil
					? await WallpaperStore.shared.cachedCard(id: id)
					: nil
				let blur = await WallpaperStore.shared.blurred(id: id)
				guard let self, self.wallpaperId == id else { return }
				if let image = fullScreen ?? card { wallpaperImage = image }
				if let blur { blurredWallpaper = blur }
				if fullScreen != nil { renderedWallpaperId = id }
			}
		}
		// Seed the tab data from the last-known snapshot (written by every load, and
		// prefetched during onboarding), so Home skips the skeletons entirely and the
		// network refresh just updates values in place.
		if let accountId = session?.accountId,
			let snapshot = DeviceDataStore.load(deviceId: device.id, accountId: accountId)
		{
			apps = snapshot.apps
			disk = snapshot.disk
			favoritePaths = snapshot.favoritePaths
			updatableApps = snapshot.updatableApps
			didLoad = true
		}
		photoLibrary.onObservedChanges = { [weak self] changes in
			self?.recordObservedPhotoLibraryChanges(changes)
		}
		refreshPhotoBackupPresentation()
	}

	private func confirmConnectionState(_ state: ConnectionState) {
		// Signing in starts this model as connected, so its first answer counts too
		let reconnected = state == .connected
			&& (connectionState != .connected || !confirmedConnection)
		if state == .connected { confirmedConnection = true }
		if connectionState != state {
			connectionState = state
		}
		// Setup that waited for the Umbrel goes on as soon as it answers
		if reconnected { resumeWaitingPhotoBackup() }
		if state == .connected, identityChanged {
			identityChanged = false
		}
		if state != .connected, connectionRoute != nil {
			connectionRoute = nil
		}
		// A failed native refresh has exhausted every verified host, including any
		// known Tailscale address. Reflect that same result in Remote access so Profile
		// never claims Tailscale is connected while Current connection says Offline.
		if state == .unavailable || state == .localNetworkDenied {
			tailscaleAvailableOnThisPhone = false
		}
		onConnectionCheck(state)
	}

	func refreshSavedDevice(_ device: SavedDevice) {
		guard let currentDevice = self.device,
			currentDevice.id == device.id,
			currentDevice != device
		else { return }
		self.device = device
		refreshPhotoBackupPresentation()
	}

	// NWPathMonitor is deliberately only an event source. A path change means the
	// previous endpoint winner may be stale, not that the Umbrel is offline. Keep the
	// last confirmed result on-screen while the existing authenticated resolver silently
	// re-establishes both reachability and the active route.
	func refreshAfterNetworkPathChange() async {
		guard let target = nativeTarget, session != nil else { return }
		await Umbreld.invalidateResolvedHost(for: target)
		recentlyReachableBrowserAddresses.removeAll()

		async let tailscaleRefresh: Void = refreshTailscaleAvailability()
		// An activation or timer refresh may already be finishing on the old path. Wait
		// for that one owner instead of starting overlapping requests, then always run
		// one connection-only refresh against the newly invalidated resolver.
		while remoteRefreshInProgress {
			do {
				try await Task.sleep(for: .milliseconds(100))
			} catch {
				return
			}
		}
		await refreshVisibleData(for: .connection, force: true)
		_ = await tailscaleRefresh
		resumeWaitingPhotoBackup()
	}

	private func confirmConnectionRoute(_ host: String) {
		let route: ConnectionRoute = Self.isTailscaleAddress(host) ? .tailscale : .local
		if connectionRoute != route {
			connectionRoute = route
		}
		// A successful authenticated request over the Tailscale endpoint is stronger
		// evidence than a separate reachability probe and should update Remote access.
		if route == .tailscale {
			tailscaleAvailableOnThisPhone = true
		}
	}

	var host: String? { device?.host }
	var nativeTarget: Umbreld.Target? { device?.nativeTarget }
	var hasTailscaleBrowserAddress: Bool { !tailscaleBrowserIPs.isEmpty }

	private var browserAddressOptions: [String] {
		guard let device else { return [] }
		var seen = Set<String>()
		return ([device.host] + device.addresses)
			.filter { !$0.isEmpty && seen.insert($0).inserted }
	}

	func dashboardURLForOpening(
		path: String = "",
		queryItems: [URLQueryItem] = []
	) async -> URL? {
		guard let endpoint = await browserEndpointForOpening(allowsTailscaleDNS: true) else {
			return nil
		}
		var components = URLComponents()
		components.scheme = await safariUsesHTTPS(endpoint) ? "https" : "http"
		components.host = endpoint.host
		components.path = path
		components.queryItems = queryItems.isEmpty ? nil : queryItems
		return components.url
	}

	func appURLForOpening(_ app: Umbreld.AppSummary) async -> URL? {
		let requiresHTTPS = app.requiresHttps == true
		guard let endpoint = await browserEndpointForOpening(
			// Umbrel's local certificate covers its hostnames and interface IPs, not a
			// user-controlled tailnet name. HTTPS-required apps therefore keep using a
			// certificate-covered endpoint.
			allowsTailscaleDNS: !requiresHTTPS
		) else { return nil }
		// requiresHttps is about the browser's secure-context rules, so it wins
		// everywhere, Tailscale included.
		let useHTTPS = if requiresHTTPS { true } else { await safariUsesHTTPS(endpoint) }
		return app.webURL(host: endpoint.host, scheme: useHTTPS ? "https" : "http")
	}

	// A local name uses HTTPS when this iPhone trusts the Umbrel's certificate, as it
	// does once it's installed and trusted in Settings, so Safari opens it without a
	// warning. A Tailscale name stays on HTTP: Tailscale already encrypts it, and the
	// certificate doesn't cover it. A literal IP is the last-resort route and always
	// uses Umbrel's IP-valid local certificate: Safari can let the user continue past
	// an untrusted-CA warning, while its HTTP-only mode may block an app-opened IP with
	// no recovery action at all.
	private func safariUsesHTTPS(_ endpoint: BrowserEndpoint) async -> Bool {
		switch endpoint.kind {
		case .localIP, .tailscaleIP:
			return true
		case .tailscaleDNS:
			return false
		case .localDNS:
			guard let deviceId = device?.id else { return false }
			return await Umbreld.isBrowserEndpoint(
				host: endpoint.host,
				expectedDeviceId: deviceId,
				secure: true,
				timeout: Self.tailscalePreferenceTimeout)
		}
	}

	// ── In-app browser ──
	//
	// Inside the app nobody sees or types an address, so the browser goes wherever the
	// native connection already is: an endpoint that has just proved the Umbrel's
	// pinned HTTPS identity. Every page is therefore a secure context with no
	// certificate warning, and apps that need HTTPS simply work.

	var browserHosts: [String] { browserAddressOptions }

	func browserURL(path: String = "", queryItems: [URLQueryItem] = []) async -> URL? {
		guard let host = await browserHostForOpening() else { return nil }
		var components = URLComponents()
		components.scheme = "https"
		components.host = host
		components.path = path
		components.queryItems = queryItems.isEmpty ? nil : queryItems
		return components.url
	}

	func browserURL(for app: Umbreld.AppSummary) async -> URL? {
		guard let host = await browserHostForOpening() else { return nil }
		return app.webURL(host: host, scheme: "https")
	}

	// umbrelOS and its apps use the same connection as the rest of the app.
	private func browserHostForOpening() async -> String? {
		guard let target = nativeTarget else { return nil }
		return try? await Umbreld.resolvedHost(for: target)
	}

	// Cached app tiles deliberately omit default credentials. Resolve the live app on
	// every tap so lifecycle, credential, and HTTPS decisions always use Umbrel's
	// current response rather than periodically refreshed presentation data.
	func appForLaunch(id appId: String) async -> Umbreld.AppSummary? {
		guard let target = nativeTarget, let deviceId = device?.id, let session else {
			return nil
		}
		do {
			let refreshedApps = try await Umbreld.apps(target: target, session: session)
			guard !Task.isCancelled,
				device?.id == deviceId,
				self.session?.accountId == session.accountId
			else { return nil }

			let changed = applyDeviceData(
				apps: refreshedApps,
				diskUsage: nil,
				favorites: nil,
				updateIds: nil
			)
			lastAppsRefresh = Date()
			if changed { saveDeviceData(deviceId: deviceId) }
			confirmConnectionState(.connected)
			return refreshedApps.first { $0.id == appId && $0.name != nil }
		} catch {
			return nil
		}
	}

	func dismissConfigStorageIssue() {
		configStorageIssue = nil
	}

	private func loadConfig() -> Config? {
		let loaded = Config.load()
		if let issue = loaded.issue {
			configStorageIssue = issue
			return nil
		}
		return loaded.config
	}

	@discardableResult
	private func persistConfig(_ change: (inout Config) throws -> Void) -> Bool {
		guard var config = loadConfig() else { return false }
		do {
			try change(&config)
			return true
		} catch {
			configStorageIssue = (error as? Config.StorageIssue) ?? .saveFailed
			return false
		}
	}

	// The device model label, e.g. "Umbrel Pro".
	var deviceLabel: String { device?.model ?? device?.name ?? "Umbrel" }

	// Prefixes the device label with the user's name when available (e.g. "Alex's Umbrel Pro").
	var title: String {
		if let userName, !userName.isEmpty { return "\(userName)\u{2019}s \(deviceLabel)" }
		return deviceLabel
	}

	// Installed apps that decoded cleanly (umbreld can return error stubs).
	var installedApps: [Umbreld.AppSummary] { apps.filter { $0.name != nil } }
	var tailscaleApp: Umbreld.AppSummary? { installedApps.first { $0.id == "tailscale" } }
	var tailscaleConnectionStatus: String {
		guard let tailscaleAvailableOnThisPhone else { return "Checking…" }
		return tailscaleAvailableOnThisPhone ? "Connected" : "Not connected"
	}

	// iOS does not reveal whether the separate Tailscale app is installed, signed in,
	// or switched on. A short identity probe to the Umbrel's known Tailscale address is
	// the only claim we make: whether this iPhone can reach that endpoint right now.
	func refreshTailscaleAvailability() async {
		guard let device, let host = tailscaleAvailabilityHost else {
			tailscaleAvailableOnThisPhone = false
			return
		}
		guard !tailscaleAvailabilityCheckInProgress else { return }
		tailscaleAvailabilityCheckInProgress = true
		defer { tailscaleAvailabilityCheckInProgress = false }
		let available = await Umbreld.isKnownEndpointAvailable(host: host, deviceId: device.id)
		guard !Task.isCancelled,
			self.device?.id == device.id,
			tailscaleAvailabilityHost == host
		else { return }
		if available {
			tailscaleAvailableOnThisPhone = true
			resumeWaitingPhotoBackup()
		} else {
			tailscaleAvailableOnThisPhone = false
		}
	}

	var canManageApps: Bool { accountRole == "owner" || session?.accountId == "0" }
	var photoBackupIsConfiguredElsewhere: Bool { otherPhotoBackupDestinationName != nil }
	// Backup goes to another Umbrel and this one has nothing from this iPhone. Unknown
	// totals count as something, so the Library never hides backups that are there.
	var photoBackupIsOnlyElsewhere: Bool {
		guard photoBackupIsConfiguredElsewhere, photoBackupSourceResolved else { return false }
		guard photoBackup.sourceId != nil else { return true }
		return photoBackup.statistics?.uploadedCount == 0
	}
	// The Library shows this iPhone's photos marked with this Umbrel's backups. Without
	// Full Access, or with nothing from this iPhone here while it backs up elsewhere, the
	// setup card takes its place.
	var showsPhotoLibrary: Bool { photoLibrary.canReadLibrary && !photoBackupIsOnlyElsewhere }
	// Remote-access status follows the address Umbrel currently reports. Fall back to a
	// pinned PhotoKit address only while no current address is available. A mismatch is
	// surfaced separately so general Tailscale access can remain connected while Photo
	// Backup asks for an explicit endpoint repair.
	var tailscaleAvailabilityHost: String? {
		device?.photoBackupHost ?? configuredPhotoBackupTailscaleHost
	}

	var hasKnownTailscaleAddress: Bool { tailscaleAvailabilityHost != nil }
	var umbrelHasTailscaleAddress: Bool { device?.photoBackupHost != nil }
	var photoBackupTailscaleAddressChanged: Bool {
		guard let pinnedHost = configuredPhotoBackupTailscaleHost,
			let reportedHost = device?.photoBackupHost
		else { return false }
		return pinnedHost.caseInsensitiveCompare(reportedHost) != .orderedSame
	}

	var photoBackupStatus: PhotoBackupStatus {
		let intentEnabled = photoLibrary.canReadLibrary
			&& (backupPhotosEnabled || backupVideosEnabled)
		guard intentEnabled else { return .off }
		if photoBackupRecoveryRetrying { return .settingUp }
		let configuration = photoBackupPresentationConfiguration
		if photoBackupPresentationTargetActive,
			photoBackupPresentationConfiguration == nil,
			!photoBackupSetupInProgress,
			photoBackupSetupFailure == nil
		{
			// Enabled intent without an installed upload configuration is a durable waiting
			// state, not perpetual setup: setup couldn't reach the Umbrel, and opening the
			// app or a network change tries again.
			return .waitingForUmbrel
		}
		let mode = PhotoBackupPresentationMode.resolve(
			intentEnabled: intentEnabled,
			targetActive: photoBackupPresentationTargetActive,
			configurationMatchesTarget: configuration != nil,
			// The app route sends from the app, so PhotoKit's extension stays off
			extensionEnabled: configuration?.route == .app || photoBackupPresentationExtensionEnabled,
			snapshotMatchesSource: configuration?.source.id == photoBackup.sourceId,
			snapshotPhase: photoBackup.phase,
			setupInProgress: photoBackupSetupInProgress,
			setupFailed: photoBackupSetupFailure != nil
		)
		switch mode {
		case .off:
			return .off
		case .settingUp:
			return photoBackupContinuingName.map { .continuing($0) } ?? .settingUp
		case .failed:
			return .error
		case .active:
			if photoBackupCheckingStorage { return .checkingStorage }
			if photoBackup.issue == .insufficientStorage { return .paused }
			if photoBackup.issue == .authenticationRequired { return .error }
			if photoBackupHasRuntimeError { return .error }
			guard let remaining = photoBackupRemainingCount(configuration: configuration) else {
				return photoBackup.phase == .upToDate ? .upToDate : .backingUp(nil)
			}
			if let statistics = photoBackup.statistics,
				statistics.onlyFailuresRemain(remainingCount: remaining)
			{
				return .upToDateExceptFailures
			}
			guard remaining > 0 else { return .upToDate }
			// These screens show only while the app is open, and then it backs up itself:
			// what holds backup up is what the app sees now, not iOS's background uploads.
			switch PhotoBackupAppRunner.shared.activity {
			case .connecting:
				return .connecting
			case .waitingForUmbrel:
				return configuration?.route == .tailscale && tailscaleAvailableOnThisPhone == false
					? .waitingForTailscale
					: .waitingForUmbrel
			case .waitingForWiFi:
				return .waitingForWiFi
			case .none:
				return .backingUp(remaining)
			}
		}
	}

	// The name this device has in Photos on the Umbrel. A source registered earlier
	// keeps its saved name, which the app only knows while backup is set up.
	var photoBackupSourceName: String? {
		if let configuration = photoBackupPresentationConfiguration {
			return sourceNamesOnUmbrel[configuration.source.id] ?? configuration.source.name
		}
		return presentationLedgerSourceId == nil ? PhotoBackupSourceName.current : nil
	}

	var photoBackupNotice: PhotoBackupNotice? {
		guard photoLibrary.canReadLibrary, backupPhotosEnabled || backupVideosEnabled else {
			return nil
		}
		switch photoBackupStatus {
		case .waitingForTailscale:
			return .waitingForTailscale
		case .waitingForUmbrel:
			// With Tailscale the Umbrel itself is unreachable, which the status says
			return photoBackupRoute == .tailscale ? nil : .awayFromUmbrel
		case .checkingStorage:
			return .checkingStorage
		case .paused where photoBackupNeedsStorage:
			return .insufficientStorage
		case .error where photoBackup.issue == .authenticationRequired:
			return .reconnect
		case .error:
			return .needsAttention
		case .off, .settingUp, .continuing, .paused:
			return nil
		case .connecting, .waitingForWiFi, .backingUp, .upToDate, .upToDateExceptFailures:
			break
		}
		// Problems with backing up while the app is closed. The app still backs up while
		// it's open.
		if photoBackupRoute == .tailscale, photoBackupTailscaleAddressChanged { return .tailscaleAddressChanged }
		if photoBackupRoute != nil, photoBackupBackgroundRefreshUnavailable { return .backgroundRefreshUnavailable }
		// Caught up without Tailscale: the moment to offer what it adds
		if photoBackupRoute == .app, !backUpAnywhereOfferDismissed,
			photoBackupStatus == .upToDate || photoBackupStatus == .upToDateExceptFailures
		{
			return .backUpAnywhere
		}
		return nil
	}

	private static let backUpAnywhereOfferDismissedKey = "photo-backup-anywhere-offer-dismissed"
	private(set) var backUpAnywhereOfferDismissed = UserDefaults.standard.bool(forKey: backUpAnywhereOfferDismissedKey)

	func dismissBackUpAnywhereOffer() {
		backUpAnywhereOfferDismissed = true
		UserDefaults.standard.set(true, forKey: Self.backUpAnywhereOfferDismissedKey)
	}

	// What Photos on the Umbrel calls each of this iPhone's sources, as last read there.
	// It can be renamed there, and the backup configuration keeps the name it was set
	// up with, since changing that would set backup up again.
	private static let sourceNamesOnUmbrelKey = "photo-backup-source-names-on-umbrel"
	private var sourceNamesOnUmbrel = UserDefaults.standard.dictionary(forKey: sourceNamesOnUmbrelKey)
		as? [String: String] ?? [:]

	// When How it works opens. Listing sources totals the whole library on the Umbrel, so
	// it's only asked when someone looks.
	func refreshPhotoBackupSourceName() async {
		guard let device, let session,
			let configuration = photoBackupPresentationConfiguration,
			let name = try? await Umbreld.photoBackupSourceName(
				target: device.nativeTarget,
				session: session,
				source: configuration.source
			),
			sourceNamesOnUmbrel[configuration.source.id] != name
		else { return }
		rememberSourceNameOnUmbrel(name, sourceId: configuration.source.id)
	}

	private func rememberSourceNameOnUmbrel(_ name: String, sourceId: String) {
		guard sourceNamesOnUmbrel[sourceId] != name else { return }
		sourceNamesOnUmbrel[sourceId] = name
		UserDefaults.standard.set(sourceNamesOnUmbrel, forKey: Self.sourceNamesOnUmbrelKey)
	}

	// Nil until backup is set up. The app backs up while it's open on either route; on
	// .tailscale, PhotoKit also does while it's closed.
	var photoBackupRoute: PhotoBackupConfiguration.Route? { photoBackupPresentationConfiguration?.route }

	var photoBackupBackgroundRefreshUnavailable: Bool {
		switch backgroundRefreshStatus {
		case .denied:
			true
		case .available, .restricted:
			// Apple advises against warning for .restricted because the user
			// cannot enable Background App Refresh themselves.
			false
		@unknown default:
			false
		}
	}

	private var photoBackupHasRuntimeError: Bool {
		guard !photoBackupCheckingStorage else { return false }
		return photoBackup.issue != nil
			|| (photoBackup.phase == .needsAttention && photoBackup.lastError != nil)
	}

	var photoBackupNeedsStorage: Bool {
		photoBackup.issue == .insufficientStorage
	}

	var photoBackupCheckingStorage: Bool {
		photoBackupStorageRetrying || photoBackup.phase == .checkingStorage
	}

	private func photoBackupRemainingCount(
		configuration: PhotoBackupConfiguration?
	) -> Int? {
		guard let statistics = photoBackup.statistics else { return nil }
		let includePhotos = configuration?.includePhotos ?? true
		let includeVideos = configuration?.includeVideos ?? true
		return statistics.remainingCount(
			photoCount: photoLibrary.photoCount,
			videoCount: photoLibrary.videoCount,
			includePhotos: includePhotos,
			includeVideos: includeVideos
		)
	}

	func refreshPhotoBackupPresentation() {
		guard let deviceId = device?.id, let accountId = session?.accountId else {
			photoBackupPresentationConfiguration = nil
			photoBackupPresentationTargetActive = false
			photoBackupPresentationExtensionEnabled = false
			configuredPhotoBackupTailscaleHost = nil
			return
		}
		let savedConfiguration = PhotoBackupStore.configuration()
		refreshOtherPhotoBackupDestination(
			configuration: savedConfiguration,
			currentDeviceId: deviceId,
			currentAccountId: accountId
		)
		let configuration = savedConfiguration?.deviceId == deviceId
			&& savedConfiguration?.source.accountId == accountId
			? savedConfiguration
			: nil
		let storageRetrying = configuration.map {
			PhotoBackupStore.storageRetryRequested(for: $0.source.id)
		} ?? false
		if photoBackupStorageRetrying != storageRetrying {
			photoBackupStorageRetrying = storageRetrying
		}
		let recoveryRetrying = configuration.map {
			PhotoBackupStore.recoveryRetryRequested(for: $0.source.id)
		} ?? false
		if photoBackupRecoveryRetrying != recoveryRetrying {
			photoBackupRecoveryRetrying = recoveryRetrying
		}
		// Turning backup off removes the live extension configuration, not the record
		// of what already reached this account. Keep rendering that history from the
		// account-scoped source so disabling or removing/re-adding an Umbrel never
		// makes completed backups appear to vanish.
		let sourceId: String?
		if let configuration {
			sourceId = configuration.source.id
		} else {
			switch Self.readPhotoBackupSourceId(deviceId: deviceId, accountId: accountId) {
			case .found(let storedSourceId):
				sourceId = storedSourceId
			case .missing:
				sourceId = nil
			case .unavailable:
				// A transient Keychain failure is not proof that backup history was
				// removed. Keep the last safe presentation and retry on foreground.
				return
			}
		}
		if !photoBackupSourceResolved { photoBackupSourceResolved = true }
		photoBackupPresentationConfiguration = configuration
		photoBackupPresentationTargetActive = PhotoBackupPreferenceStore.isActive(
			deviceId: deviceId,
			accountId: accountId
		)
		let intentEnabled = photoLibrary.canReadLibrary
			&& (backupPhotosEnabled || backupVideosEnabled)
		// Keep passive screens passive. Accessing PhotoKit's background-upload state
		// before authorization can trigger the system prompt; only enabled intent may
		// cross that boundary.
		photoBackupPresentationExtensionEnabled = intentEnabled
			&& PHPhotoLibrary.shared().uploadJobExtensionEnabled
		let configuredHost: String? = configuration.flatMap { configuration in
			guard configuration.isTailscaleDestination else { return nil }
			return URL(string: configuration.uploadBaseURL)?.host
		}
		if configuredPhotoBackupTailscaleHost != configuredHost {
			configuredPhotoBackupTailscaleHost = configuredHost
		}
		let snapshot = PhotoBackupStore.snapshot
		guard presentationSnapshotDate != snapshot.updatedAt || presentationLedgerSourceId != sourceId else {
			applyPhotoBackupPresentation(presentationSnapshot(
				from: snapshot,
				configuration: configuration,
				sourceId: sourceId,
				fallbackStatistics: photoBackup.statistics
			))
			return
		}
		if presentationLedgerSourceId != sourceId {
			presentationLedger = PhotoBackupStore.ledgerURL.flatMap(PhotoBackupLedger.init(url:))
			presentationLedgerSourceId = sourceId
			presentationSnapshotDate = nil
		}
		let statistics = sourceId.flatMap { sourceId in
			// The ledger is the cross-process source of truth. Prefer its current
			// totals because the host may have recorded a live PhotoKit mutation
			// before the extension writes a new phase snapshot.
			(try? presentationLedger?.statistics(
				deviceId: sourceId,
				includePhotos: configuration?.includePhotos ?? true,
				includeVideos: configuration?.includeVideos ?? true
			)) ?? (snapshot.sourceId == sourceId ? snapshot.statistics : nil)
		}
		applyPhotoBackupPresentation(presentationSnapshot(
			from: snapshot,
			configuration: configuration,
			sourceId: sourceId,
			fallbackStatistics: statistics
		))
		// If an older snapshot has no totals and the fallback read fails, leave this
		// revision uncommitted so the lightweight poll retries it later.
		if sourceId == nil || statistics != nil {
			presentationSnapshotDate = snapshot.updatedAt
			photoBackupReceiptRevision = Date()
		}
	}

	private func recordObservedPhotoLibraryChanges(_ changes: PhotoLibraryModel.ObservedChanges) {
		guard !changes.isEmpty,
			let deviceId = device?.id,
			let accountId = session?.accountId,
			let configuration = PhotoBackupStore.configuration(),
			configuration.deviceId == deviceId,
			configuration.source.accountId == accountId
		else { return }

		if presentationLedgerSourceId != configuration.source.id {
			presentationLedger = PhotoBackupStore.ledgerURL.flatMap(PhotoBackupLedger.init(url:))
			presentationLedgerSourceId = configuration.source.id
			presentationSnapshotDate = nil
		}
		guard let presentationLedger else { return }

		func candidates(_ assets: [PHAsset]) -> [PhotoBackupLedger.AssetCandidate] {
			assets.map { asset in
				PhotoBackupLedger.AssetCandidate(
					localIdentifier: asset.localIdentifier,
					mediaType: Int64(asset.mediaType.rawValue),
					creationDate: asset.creationDate ?? .distantPast,
					modificationDate: asset.modificationDate ?? asset.creationDate ?? .distantPast
				)
			}
		}
		do {
			let backupChanged = try BackgroundTaskAssertion.perform("Record photo library changes") {
				try presentationLedger.recordObservedChanges(
					inserted: candidates(changes.inserted),
					contentChanged: candidates(changes.contentChanged),
					metadataChanged: candidates(changes.metadataChanged),
					deviceId: configuration.source.id
				)
			}
			guard backupChanged else { return }
			// A pending revision stays durable while offline. PhotoKit's extension uploads
			// it on its own schedule; the app route sends it now if the app can.
			presentationSnapshotDate = nil
			photoBackupReceiptRevision = Date()
			refreshPhotoBackupPresentation()
			PhotoBackupAppRunner.shared.run()
		} catch {
			Self.logger.error("Could not record live PhotoKit changes: \(error.localizedDescription, privacy: .public)")
		}
	}

	private func refreshOtherPhotoBackupDestination(
		configuration: PhotoBackupConfiguration?,
		currentDeviceId: String,
		currentAccountId: String
	) {
		let target: PhotoBackupPreferenceTarget?
		if let configuration {
			target = configuration.deviceId != currentDeviceId
				|| configuration.source.accountId != currentAccountId
				? PhotoBackupPreferenceTarget(
					deviceId: configuration.deviceId,
					accountId: configuration.source.accountId
				)
				: nil
		} else if let active = PhotoBackupPreferenceStore.activeTarget(),
			active.deviceId != currentDeviceId || active.accountId != currentAccountId
		{
			target = active
		} else {
			target = nil
		}
		guard target != otherPhotoBackupTarget else { return }
		otherPhotoBackupTarget = target
		guard let target else {
			otherPhotoBackupDestinationName = nil
			return
		}
		guard let config = loadConfig(),
			let savedDevice = config.savedDevices[target.deviceId]
		else {
			otherPhotoBackupDestinationName = "another Umbrel"
			return
		}
		let label = Self.photoBackupDestinationLabel(savedDevice, accountId: target.accountId)
		if let device, label == Self.photoBackupDestinationLabel(device, accountId: currentAccountId) {
			// Two Umbrels of the same model and owner read alike: name the other one by its
			// host when that differs, or say it's another account on this one
			if target.deviceId == device.id {
				otherPhotoBackupDestinationName = "another account on this Umbrel"
			} else if savedDevice.host.lowercased() != device.host.lowercased() {
				otherPhotoBackupDestinationName = savedDevice.host
			} else {
				otherPhotoBackupDestinationName = "your other \(savedDevice.model ?? savedDevice.name)"
			}
		} else {
			otherPhotoBackupDestinationName = label
		}
	}

	private static func photoBackupDestinationLabel(_ savedDevice: SavedDevice, accountId: String) -> String {
		let deviceName = savedDevice.model ?? savedDevice.name
		if let accountName = savedDevice.accountProfile(for: accountId)?.name, !accountName.isEmpty {
			return "\(accountName)\u{2019}s \(deviceName)"
		}
		return savedDevice.displayName
	}

	private func applyPhotoBackupPresentation(_ snapshot: PhotoBackupSnapshot) {
		guard photoBackup != snapshot else { return }
		photoBackup = snapshot
	}

	private func presentationSnapshot(
		from snapshot: PhotoBackupSnapshot,
		configuration: PhotoBackupConfiguration?,
		sourceId: String?,
		fallbackStatistics: PhotoBackupStatistics?
	) -> PhotoBackupSnapshot {
		let matchesSource = snapshot.sourceId == sourceId
		return PhotoBackupSnapshot(
			phase: configuration == nil ? .disabled : (matchesSource ? snapshot.phase : .waiting),
			issue: configuration == nil || !matchesSource ? nil : snapshot.issue,
			lastError: configuration == nil || !matchesSource ? nil : snapshot.lastError,
			updatedAt: snapshot.updatedAt,
			sourceId: sourceId,
			statistics: fallbackStatistics ?? (matchesSource ? snapshot.statistics : nil)
		)
	}

	func load() async {
		guard !remoteRefreshInProgress else { return }
		remoteRefreshInProgress = true
		defer {
			remoteRefreshInProgress = false
			completedActivationRefresh = true
		}
		refreshPhotoBackupPresentation()
		guard let target = nativeTarget, let id = device?.id else { return }
		switch Keychain.readSession(deviceId: id) {
		case .found(let stored):
			session = stored
		case .missing, .invalid:
			sessionInvalidated(deviceId: id)
			return
		case .unavailable:
			// Keep rendering cached data and any safe in-memory access credential.
			// A later foreground load retries the Keychain instead of routing to sign-in.
			break
		}
		guard var session else { return }

		// Ensure the app and backup engine have a usable persisted access credential.
		// Offline is not logout; only a definitive 401 removes the grant and returns
		// the user to sign-in.
		do {
			session = try await Umbreld.renewSession(target: target, session: session)
			if self.session != session { self.session = session }
		} catch {
			if (error as? Umbreld.Error)?.isAuthError == true {
				sessionInvalidated(deviceId: id)
				return
			}
		}
		let activeSession = session

		async let userInfo = try? Umbreld.user(target: target, session: activeSession)
		async let appList = try? Umbreld.apps(target: target, session: activeSession)
		async let usage = try? Umbreld.diskUsage(target: target, session: activeSession)
		async let favs = try? Umbreld.favorites(target: target, session: activeSession)
		async let addresses = try? Umbreld.ipAddresses(target: target, session: activeSession)
		async let updates = activeSession.accountId == "0"
			? (try? await Umbreld.appUpdates(target: target, session: activeSession)) : nil

		let (info, list, newUsage, newFavorites, newAddresses, newUpdates) = await
			(userInfo, appList, usage, favs, addresses, updates)
		if let info { await applyUserInfo(info, target: target, deviceId: id) }
		let snapshotChanged = applyDeviceData(
			apps: list,
			diskUsage: newUsage,
			favorites: newFavorites,
			updateIds: newUpdates?.map(\.id)
		)
		if let newAddresses { saveAvailableAddresses(newAddresses) }
		if !didLoad { didLoad = true }
		guard !Task.isCancelled else { return }
		let refreshedAt = Date()
		lastIdentityRefresh = refreshedAt
		lastAppsRefresh = refreshedAt
		lastDiskRefresh = refreshedAt
		lastFavoritesRefresh = refreshedAt
		lastUpdatesRefresh = refreshedAt

		if info != nil || list != nil || newUsage != nil || newFavorites != nil
			|| newAddresses != nil || newUpdates != nil
		{
			confirmConnectionState(.connected)
			if let resolvedHost = try? await Umbreld.resolvedHost(for: target) {
				confirmConnectionRoute(resolvedHost)
				rememberReachableBrowserAddress(resolvedHost, at: refreshedAt)
			}
		} else {
			await confirmNoResponse(target: target)
		}

		// Persist the snapshot (only when the main fetch succeeded, so a flaky refresh
		// can't wipe a good snapshot) for instant paint next time.
		if snapshotChanged { saveDeviceData(deviceId: id) }
		lastPhotoReceiptRefresh = refreshedAt
		await reconcilePhotoBackupServerReceipts(target: target, session: activeSession)
		switch Keychain.readSession(deviceId: id) {
		case .found(let stored):
			if self.session != stored { self.session = stored }
		case .missing, .invalid:
			sessionInvalidated(deviceId: id)
			return
		case .unavailable:
			break
		}

	}

	// Refresh only data that can affect the visible screen. MainView invokes this on
	// a slow foreground timer and when tabs change; timestamps keep tab changes free
	// and prevent overlapping loads from multiplying requests.
	func refreshVisibleData(for scope: RefreshScope, force: Bool = false) async {
		guard completedActivationRefresh, !remoteRefreshInProgress,
			let target = nativeTarget, let id = device?.id, let session
		else { return }

		let now = Date()
		// Pull-to-refresh forces every resource shown by that tab. Automatic calls use
		// the same path but skip anything still fresh.
		let refreshIdentity = force
			|| isDue(lastIdentityRefresh, every: Self.identityRefreshInterval, at: now)
		let refreshApps = (scope == .home || scope == .apps)
			&& (force || isDue(lastAppsRefresh, every: Self.appsRefreshInterval, at: now))
		let refreshPhotoReceipts = (scope == .home || scope == .library)
			&& (force || isDue(lastPhotoReceiptRefresh, every: Self.photoReceiptRefreshInterval, at: now))
		let refreshDisk = (scope == .home || scope == .profile)
			&& (force || isDue(lastDiskRefresh, every: Self.homeRefreshInterval, at: now))
		let refreshFavorites = scope == .home
			&& (force || isDue(lastFavoritesRefresh, every: Self.homeRefreshInterval, at: now))
		let refreshUpdates = canManageApps && (scope == .home || scope == .apps)
			&& (force || isDue(lastUpdatesRefresh, every: Self.updatesRefreshInterval, at: now))
		guard refreshIdentity || refreshApps || refreshPhotoReceipts
			|| refreshDisk || refreshFavorites || refreshUpdates
		else { return }

		remoteRefreshInProgress = true
		defer { remoteRefreshInProgress = false }

		// These independent local requests run together so even a sleeping or offline
		// Umbrel costs one timeout window rather than several in sequence.
		async let userInfo: Umbreld.UserInfo? = refreshIdentity
			? (try? await Umbreld.user(target: target, session: session)) : nil
		async let appList: [Umbreld.AppSummary]? = refreshApps
			? (try? await Umbreld.apps(target: target, session: session)) : nil
		async let usage: Umbreld.DiskUsage? = refreshDisk
			? (try? await Umbreld.diskUsage(target: target, session: session)) : nil
		async let favs: [String]? = refreshFavorites
			? (try? await Umbreld.favorites(target: target, session: session)) : nil
		async let updates: [Umbreld.AppUpdate]? = refreshUpdates
			? (try? await Umbreld.appUpdates(target: target, session: session)) : nil

		let (info, list, newUsage, newFavorites, newUpdates) = await
			(userInfo, appList, usage, favs, updates)
		guard !Task.isCancelled else { return }

		if refreshIdentity { lastIdentityRefresh = now }
		if refreshApps { lastAppsRefresh = now }
		if refreshPhotoReceipts { lastPhotoReceiptRefresh = now }
		if refreshDisk { lastDiskRefresh = now }
		if refreshFavorites { lastFavoritesRefresh = now }
		if refreshUpdates { lastUpdatesRefresh = now }

		if let info { await applyUserInfo(info, target: target, deviceId: id) }
		let snapshotChanged = applyDeviceData(
			apps: list,
			diskUsage: newUsage,
			favorites: newFavorites,
			updateIds: newUpdates?.map(\.id)
		)
		if snapshotChanged {
			saveDeviceData(deviceId: id)
		}

		let receivedResponse = info != nil || list != nil || newUsage != nil
			|| newFavorites != nil || newUpdates != nil
		if receivedResponse {
			confirmConnectionState(.connected)
			if let resolvedHost = try? await Umbreld.resolvedHost(for: target) {
				confirmConnectionRoute(resolvedHost)
				rememberReachableBrowserAddress(resolvedHost)
			}
		} else if refreshIdentity {
			await confirmNoResponse(target: target)
		}
		if refreshPhotoReceipts {
			await reconcilePhotoBackupServerReceipts(target: target, session: session)
		}

		// Requests transparently rotate native access credentials. Mirror the durable
		// result back into the model, and treat only a definitive missing credential as
		// sign-out; a transient Keychain failure remains retryable.
		switch Keychain.readSession(deviceId: id) {
		case .found(let stored):
			if self.session != stored { self.session = stored }
		case .missing, .invalid:
			sessionInvalidated(deviceId: id)
		case .unavailable:
			break
		}
	}

	// Nothing answered at all. "Your Umbrel is off", "its identity changed" and "Local
	// Network access was revoked in Settings" otherwise look identical, and each needs
	// something different from the user.
	private func confirmNoResponse(target: Umbreld.Target) async {
		async let changed = Umbreld.identityChanged(for: target)
		async let denied = LocalNetworkProbe.isDenied()
		let (identityChanged, isDenied) = await (changed, denied)
		if self.identityChanged != identityChanged { self.identityChanged = identityChanged }
		confirmConnectionState(!identityChanged && isDenied ? .localNetworkDenied : .unavailable)
	}

	// What to say when the Umbrel can't be opened.
	var unreachableTitle: String {
		identityChanged ? IdentityChange.alertTitle : "Can’t Reach Umbrel"
	}

	var unreachableMessage: String {
		identityChanged
			? IdentityChange.blockedMessage
			: "Check your connection and try again."
	}

	// PhotoKit can finish transferring a resource but defer its terminal callback until
	// a later system activation. While Home or Library is visible, ask Umbrel only about
	// the bounded set of current resources already prepared in our ledger. An exact
	// final-file receipt can update presentation immediately; PhotoKit still owns every
	// upload job and later acknowledgement.
	private func reconcilePhotoBackupServerReceipts(
		target: Umbreld.Target,
		session: Umbreld.Session
	) async {
		guard let configuration = PhotoBackupStore.configuration(),
			configuration.deviceId == target.deviceId,
			configuration.source.accountId == session.accountId
		else { return }
		if presentationLedgerSourceId != configuration.source.id {
			presentationLedger = PhotoBackupStore.ledgerURL.flatMap(PhotoBackupLedger.init(url:))
			presentationLedgerSourceId = configuration.source.id
			presentationSnapshotDate = nil
		}
		guard let presentationLedger else { return }
		startSendingPhotoBackupIdentities(configuration: configuration, target: target, session: session)

		do {
			let pending = try presentationLedger.unconfirmedResourceReceipts(
				deviceId: configuration.source.id,
				includePhotos: configuration.includePhotos,
				includeVideos: configuration.includeVideos
			)
			guard !pending.isEmpty else { return }
			let requestedKeys = Set(pending.map(\.resourceKey))
			let receipts = try await Umbreld.confirmedPhotoBackupResources(
				target: target,
				session: session,
				sourceId: configuration.source.id,
				resources: pending.map {
					.init(resourceKey: $0.resourceKey, fileExtension: $0.fileExtension)
				}
			)
			guard !Task.isCancelled,
				self.device?.id == configuration.deviceId,
				self.session?.accountId == configuration.source.accountId,
				PhotoBackupStore.configuration() == configuration
			else { return }

			let confirmed = receipts.compactMap { receipt -> PhotoBackupLedger.ResourceReceipt? in
				guard requestedKeys.contains(receipt.resourceKey),
					PhotoBackupLedger.isValidResourceByteCount(receipt.bytes)
				else { return nil }
				return .init(
					resourceKey: receipt.resourceKey,
					bytes: receipt.bytes
				)
			}
			guard !confirmed.isEmpty else { return }
			try BackgroundTaskAssertion.perform("Record confirmed photo backup resources") {
				try presentationLedger.recordConfirmedResources(confirmed)
			}
			Self.logger.notice(
				"Confirmed \(confirmed.count, privacy: .public) photo backup resources from Umbrel"
			)
			presentationSnapshotDate = nil
			refreshPhotoBackupPresentation()
		} catch is CancellationError {
			return
		} catch {
			// This is opportunistic foreground reconciliation. The extension's durable
			// queue remains authoritative when Umbrel cannot currently be reached.
			let nsError = error as NSError
			Self.logger.notice(
				"Could not reconcile server photo receipts: domain=\(nsError.domain, privacy: .public) code=\(nsError.code, privacy: .public) description=\(nsError.localizedDescription, privacy: .private)"
			)
		}
	}

	// Files this iPhone sent before uploads carried their iCloud identity get it once, so
	// an iPhone that later continues this backup can claim them instead of sending them
	private func startSendingPhotoBackupIdentities(
		configuration: PhotoBackupConfiguration,
		target: Umbreld.Target,
		session: Umbreld.Session
	) {
		let sourceId = configuration.source.id
		let sentKey = "photo-backup-identities-sent:\(sourceId)"
		guard photoBackupIdentityTask == nil,
			photoBackupIdentitiesDeclinedSourceId != sourceId,
			!UserDefaults.standard.bool(forKey: sentKey),
			photoLibrary.canReadLibrary,
			case .found(let grant) = Keychain.readPhotoBackupGrant(
				deviceId: configuration.deviceId,
				accountId: configuration.source.accountId
			),
			let ledgerURL = PhotoBackupStore.ledgerURL,
			let ledger = PhotoBackupLedger(url: ledgerURL)
		else { return }
		let pass = Self.photoBackupIdentityPass(configuration: configuration, ledger: ledger, target: target, grant: grant)
		photoBackupIdentityTask = Task { [weak self] in
			// Lets go of the shared ledger before iOS suspends the app, which it would
			// otherwise end (0xdead10cc)
			let backgroundTime = BackgroundTaskAssertion(name: "Send photo backup identities") {
				pass.stop()
				ledger.stop()
			}
			let outcome = (try? await pass.run()) ?? .interrupted
			backgroundTime.end()
			guard let self else { return }
			self.photoBackupIdentityTask = nil
			switch outcome {
			case .completed: UserDefaults.standard.set(true, forKey: sentKey)
			// Asked again once the Umbrel is updated, the next time the app starts
			case .declined: self.photoBackupIdentitiesDeclinedSourceId = sourceId
			case .interrupted: break
			}
		}
	}

	private static func photoBackupIdentityPass(
		configuration: PhotoBackupConfiguration,
		ledger: PhotoBackupLedger,
		target: Umbreld.Target,
		grant: String
	) -> PhotoBackupIdentityPass {
		let sourceId = configuration.source.id
		return PhotoBackupIdentityPass(
			sourceId: sourceId,
			includePhotos: configuration.includePhotos,
			includeVideos: configuration.includeVideos,
			ledger: ledger,
			environment: .init(
				ingest: {
					switch try PhotoBackupLibraryIngest.ingest(
						ledger: ledger,
						sourceId: sourceId,
						logger: logger,
						isCancelled: { Task.isCancelled }
					) {
					case .complete: .complete
					case .moreWork: .moreWork
					case .tokenReset: .restart
					}
				},
				identify: { PhotoBackupIdentityPass.identifiedResources($0, sourceId: sourceId) },
				claim: { claims in
					try await Umbreld.claimPhotoBackupResources(target: target, grant: grant, resources: claims)
				}
			)
		)
	}

	private func isDue(_ lastRefresh: Date?, every interval: TimeInterval, at now: Date) -> Bool {
		guard let lastRefresh else { return true }
		return now.timeIntervalSince(lastRefresh) >= interval
	}

	private static func isTailscaleAddress(_ address: String) -> Bool {
		SavedDevice.isTailscaleAddress(address)
	}

	private func browserEndpointForOpening(allowsTailscaleDNS: Bool) async -> BrowserEndpoint? {
		let tailscaleHostname = allowsTailscaleDNS ? await tailscaleBrowserHostnameForOpening() : nil
		let tailscaleHostnameEndpoint = tailscaleHostname.map {
			BrowserEndpoint(host: $0, kind: .tailscaleDNS)
		}
		let localNames = localBrowserNames.map { BrowserEndpoint(host: $0, kind: .localDNS) }
		let tailscaleIPs = tailscaleBrowserIPs.map { BrowserEndpoint(host: $0, kind: .tailscaleIP) }
		let localIPs = localBrowserIPs.map { BrowserEndpoint(host: $0, kind: .localIP) }

		// Prefer stable names across network changes. Literal addresses remain useful on
		// networks without mDNS or tailnets with MagicDNS disabled, but are the browser
		// fallback rather than racing and randomly winning.
		let candidates = [tailscaleHostnameEndpoint].compactMap { $0 } + localNames + tailscaleIPs + localIPs

		return await firstReachableBrowserEndpoint(in: candidates)
	}

	private func tailscaleBrowserHostnameForOpening() async -> String? {
		guard let target = nativeTarget, let session else { return nil }
		do {
			guard let hostname = try await Umbreld.tailscaleBrowserHostname(
				target: target,
				session: session
			) else { return nil }
			// The server returns Tailscale's validated short browser hostname; the private
			// tailnet suffix never becomes general presentation data in this app.
			return hostname
		} catch {
			// Older umbrelOS releases do not expose this optional endpoint. Their saved
			// literal addresses continue through the same fallback path.
			return nil
		}
	}

	private func firstReachableBrowserEndpoint(
		in candidates: [BrowserEndpoint]
	) async -> BrowserEndpoint? {
		guard let deviceId = device?.id else { return nil }
		var seen = Set<String>()
		for endpoint in candidates where seen.insert(endpoint.host.lowercased()).inserted {
			// Re-probe the preferred tunnel name on every browser open. Tailscale can be
			// switched off without the two-minute fallback cache expiring first.
			if endpoint.kind != .tailscaleDNS, recentlyReachedBrowserAddress(endpoint.host) {
				return endpoint
			}
			let timeout = endpoint.kind == .tailscaleDNS || endpoint.kind == .localDNS
				? Self.tailscalePreferenceTimeout
				: 3
			if await Umbreld.isBrowserEndpoint(
				host: endpoint.host,
				expectedDeviceId: deviceId,
				timeout: timeout
			) {
				rememberReachableBrowserAddress(endpoint.host)
				return endpoint
			}
		}
		return nil
	}

	private func recentlyReachedBrowserAddress(_ address: String) -> Bool {
		let cutoff = Date().addingTimeInterval(-Self.browserReachabilityLifetime)
		return recentlyReachableBrowserAddresses[address, default: .distantPast] >= cutoff
	}

	private func rememberReachableBrowserAddress(_ address: String, at date: Date = Date()) {
		recentlyReachableBrowserAddresses[address] = date
	}

	private var localBrowserNames: [String] {
		browserAddressOptions.filter {
			!SavedDevice.isIPv4Address($0) && !Self.isTailscaleAddress($0)
		}
	}

	private var tailscaleBrowserIPs: [String] {
		browserAddressOptions.filter(Self.isTailscaleAddress)
	}

	private var localBrowserIPs: [String] {
		browserAddressOptions.filter {
			SavedDevice.isIPv4Address($0) && !Self.isTailscaleAddress($0)
		}
	}

	private func saveAvailableAddresses(_ addresses: [String]) {
		guard var savedDevice = device else { return }
		savedDevice.replaceAvailableAddresses(addresses)
		guard savedDevice != device else { return }
		device = savedDevice
		persistConfig {
			try $0.update(id: savedDevice.id) { $0.replaceAvailableAddresses(addresses) }
		}
	}

	private func applyUserInfo(_ info: Umbreld.UserInfo, target: Umbreld.Target, deviceId: String) async {
		guard info.userId == session?.accountId else { return }
		let identityChanged = userName != info.name
			|| wallpaperId != info.wallpaper.id
			|| wallpaperBrandColorHsl != info.wallpaper.brandColorHsl
			|| accountRole != info.role
		if userName != info.name { userName = info.name }
		if wallpaperId != info.wallpaper.id { wallpaperId = info.wallpaper.id }
		if wallpaperBrandColorHsl != info.wallpaper.brandColorHsl {
			wallpaperBrandColorHsl = info.wallpaper.brandColorHsl
		}
		if accountRole != info.role { accountRole = info.role }
		if renderedWallpaperId != info.wallpaper.id
			|| wallpaperImage == nil
			|| blurredWallpaper == nil
		{
			await loadWallpaperImages(id: info.wallpaper.id, target: target)
		}
		guard identityChanged else { return }
		// Persist identity changes so the all-devices list and next launch match.
		persistConfig {
			try $0.update(id: deviceId) {
				$0.saveAccountProfile(
					accountId: info.userId,
					name: info.name,
					wallpaperId: info.wallpaper.id,
					wallpaperBrandColorHsl: info.wallpaper.brandColorHsl,
					role: info.role
				)
			}
		}
	}

	// Apply one successful server snapshot without notifying SwiftUI or touching disk
	// when every rendered value is already current.
	private func applyDeviceData(
		apps newApps: [Umbreld.AppSummary]?,
		diskUsage newDiskUsage: Umbreld.DiskUsage?,
		favorites newFavorites: [String]?,
		updateIds newUpdateIds: [String]?
	) -> Bool {
		var changed = false
		if let newApps {
			if apps != newApps {
				apps = newApps
				changed = true
			}
		}
		if let newDiskUsage, disk != newDiskUsage {
			disk = newDiskUsage
			changed = true
		}
		if let newFavorites {
			let visibleFavorites = Array(newFavorites.prefix(4))
			if favoritePaths != visibleFavorites {
				favoritePaths = visibleFavorites
				changed = true
			}
		}
		if let newUpdateIds, updatableApps != newUpdateIds {
			updatableApps = newUpdateIds
			changed = true
		}
		return changed
	}

	private func saveDeviceData(deviceId: String) {
		guard let accountId = session?.accountId else { return }
		DeviceDataStore.save(
			DeviceDataSnapshot(
				apps: apps,
				disk: disk,
				favoritePaths: favoritePaths,
				updatableApps: updatableApps
			),
			deviceId: deviceId,
			accountId: accountId
		)
	}

	// The switches represent durable user intent, not current network availability.
	// Save "on" immediately, then let setup request Photos access and wait for Tailscale
	// when necessary. This also means a temporary Tailscale outage never flips a switch.
	func enableBackup() {
		guard !photoBackupIsConfiguredElsewhere else { return }
		backupPhotosEnabled = true
		backupVideosEnabled = true
		persistPhotoBackupPreferenceAndSync()
	}

	// Moves backup here from the Umbrel it's set up for, including one this app can no
	// longer open or an account that has signed out, so there's always a way to switch.
	// Only on the user's confirmed request: opening or signing in to another Umbrel never
	// moves it. Backups already on the other Umbrel stay there. Setup then picks which
	// backup on this Umbrel to use, as it does for any iPhone without one here.
	func backUpToThisUmbrelInstead() {
		guard let device, let accountId = session?.accountId, let other = otherPhotoBackupTarget,
			canSwitchPhotoBackupHere
		else { return }
		// Turn backup off for every other target, the configured one and the stored active
		// one, keeping their other choices such as cellular, so nothing else can claim the
		// uploader, even after a relaunch
		let current = PhotoBackupPreferenceTarget(deviceId: device.id, accountId: accountId)
		var targets = [other]
		if let active = PhotoBackupPreferenceStore.activeTarget(), active != other { targets.append(active) }
		for target in targets where target != current {
			var preference = PhotoBackupPreferenceStore.preference(deviceId: target.deviceId, accountId: target.accountId)
			preference.includesPhotos = false
			preference.includesVideos = false
			PhotoBackupPreferenceStore.save(
				preference,
				deviceId: target.deviceId,
				accountId: target.accountId,
				activate: false
			)
		}
		// Claim the uploader here before any network wait, so the screens show backup
		// starting and an interrupted switch resumes here instead of leaving it off
		backupPhotosEnabled = true
		backupVideosEnabled = true
		PhotoBackupPreferenceStore.save(
			currentPhotoBackupPreference,
			deviceId: device.id,
			accountId: accountId,
			activate: true
		)
		photoBackupPresentationTargetActive = true
		backupSyncRevision += 1
		let revision = backupSyncRevision
		photoBackupSetupInProgress = true
		photoBackupSetupFailure = nil
		enqueuePhotoBackupOperation(revision: revision) { model in
			// Stops the other Umbrel's uploader, if one is set up, and revokes its grant
			// when that Umbrel can be reached
			await model.disablePhotoBackup(revokeServerGrant: true)
			guard revision == model.backupSyncRevision else { return }
			model.enableBackup()
			if revision == model.backupSyncRevision {
				// Nothing started, as after signing out meanwhile, so nothing else would
				// clear the progress shown since the tap
				model.photoBackupSetupInProgress = false
			} else if let setup = model.backupSyncTask {
				// The setup holds this model weakly. Keep it alive until the setup finishes,
				// in case the user leaves this Umbrel meanwhile.
				Task { [model] in
					_ = model
					await setup.value
				}
			}
		}
	}

	// Switching needs Full Photos access, or the chance to ask for it. With access
	// limited or denied it would stop the other Umbrel and start nothing.
	var canSwitchPhotoBackupHere: Bool {
		switch photoLibrary.authorizationStatus {
		case .authorized, .notDetermined: true
		default: false
		}
	}

	// This iPhone's backup is named in two places. The Keychain copy stays on this phone
	// and survives reinstalling the app. The copy in the app's own preferences comes to a
	// new iPhone set up from this one, by an iCloud restore or Quick Start, where setup
	// carries on this backup (see carriedPhotoBackupSourceId).
	private static func readPhotoBackupSourceId(deviceId: String, accountId: String) -> Keychain.PhotoBackupSourceIdReadResult {
		let stored = Keychain.readPhotoBackupSourceId(deviceId: deviceId, accountId: accountId)
		if case .found(let sourceId) = stored {
			let key = photoBackupSourceKey(deviceId: deviceId, accountId: accountId)
			if UserDefaults.standard.string(forKey: key) != sourceId {
				UserDefaults.standard.set(sourceId, forKey: key)
			}
		}
		return stored
	}

	// The backup of the iPhone this one was set up from, when this phone has none of its own
	private static func carriedPhotoBackupSourceId(deviceId: String, accountId: String) -> String? {
		UserDefaults.standard.string(forKey: photoBackupSourceKey(deviceId: deviceId, accountId: accountId))
			.flatMap { UUID(uuidString: $0) != nil ? $0 : nil }
	}

	private static func setPhotoBackupSourceId(_ sourceId: String, deviceId: String, accountId: String) -> Bool {
		guard Keychain.setPhotoBackupSourceId(sourceId, deviceId: deviceId, accountId: accountId) else { return false }
		UserDefaults.standard.set(sourceId, forKey: photoBackupSourceKey(deviceId: deviceId, accountId: accountId))
		return true
	}

	private static func photoBackupSourceKey(deviceId: String, accountId: String) -> String {
		"photo-backup-source:\(deviceId):\(accountId)"
	}

	// The backup this iPhone took over from another, which its first upload grant renames
	// after this iPhone so it isn't mistaken for the old one's and removed. Not set when
	// the app is installed again, so a name the user chose stays.
	private static func photoBackupRenamePendingSourceId(deviceId: String, accountId: String) -> String? {
		UserDefaults.standard.string(forKey: photoBackupRenamePendingKey(deviceId: deviceId, accountId: accountId))
	}

	private static func setPhotoBackupRenamePending(_ sourceId: String?, deviceId: String, accountId: String) {
		let key = photoBackupRenamePendingKey(deviceId: deviceId, accountId: accountId)
		if let sourceId {
			UserDefaults.standard.set(sourceId, forKey: key)
		} else {
			UserDefaults.standard.removeObject(forKey: key)
		}
	}

	private static func photoBackupRenamePendingKey(deviceId: String, accountId: String) -> String {
		"photo-backup-rename-pending:\(deviceId):\(accountId)"
	}

	// Which backup this iPhone uses on this Umbrel, chosen without asking before setup asks
	// for access. It keeps its own while the Umbrel still has it. Otherwise it carries on
	// the backup of the iPhone it was restored from by iCloud or Quick Start, or starts its
	// own, as it always does on umbrelOS that can't continue a backup. Answers with the
	// account's backups when it read them.
	private func choosePhotoBackupSource(
		device: SavedDevice,
		session: Umbreld.Session,
		previousConfiguration: PhotoBackupConfiguration?,
		isCurrent: () -> Bool
	) async throws -> Umbreld.PhotoBackupSources? {
		photoBackupContinuingName = nil
		let stored: String?
		switch Self.readPhotoBackupSourceId(deviceId: device.id, accountId: session.accountId) {
		case .found(let sourceId): stored = sourceId
		case .missing: stored = nil
		case .unavailable: throw PhotoBackupSetupError.sourceStorageUnavailable
		}
		// Setup keeps the access it already has, so there's nothing to decide
		if let stored, let previousConfiguration,
			previousConfiguration.deviceId == device.id,
			previousConfiguration.source.accountId == session.accountId,
			previousConfiguration.source.id == stored,
			case .found = Keychain.readPhotoBackupGrant(deviceId: device.id, accountId: session.accountId)
		{
			return nil
		}
		let listed: Umbreld.PhotoBackupSources?
		if stored == nil {
			listed = try await Umbreld.photoBackupSources(target: device.nativeTarget, session: session)
		} else {
			// Only an answer shows this iPhone's backup was removed. Without one it carries on
			// with its own, as it always has.
			listed = try? await Umbreld.photoBackupSources(target: device.nativeTarget, session: session)
		}
		guard isCurrent() else { throw CancellationError() }
		guard let sources = listed, sources.canContinueSource else { return nil }
		knownIPhoneSourceNames = sources.sources.map(\.name)

		if let stored, sources.sources.contains(where: { $0.id == stored }) { return sources }

		let carried = Self.carriedPhotoBackupSourceId(deviceId: device.id, accountId: session.accountId)
		let continued = carried.flatMap { sources.canContinue(sourceId: $0) ? $0 : nil }
		let sourceId = continued ?? UUID().uuidString.lowercased()
		guard Self.setPhotoBackupSourceId(sourceId, deviceId: device.id, accountId: session.accountId) else {
			throw PhotoBackupSetupError.sourceStorageFailed
		}
		Self.setPhotoBackupRenamePending(continued, deviceId: device.id, accountId: session.accountId)
		photoBackupContinuingName = continued.flatMap { id in sources.sources.first { $0.id == id }?.name }
		return sources
	}

	func dismissTailscaleSetup() {
		tailscaleSetupPresented = false
	}

	func presentTailscaleSetup() {
		tailscaleSetupPresented = true
	}

	// Setup that waited for the Umbrel tries again, and backup without Tailscale adds
	// PhotoKit's background uploads once Tailscale reaches the Umbrel.
	private func resumeWaitingPhotoBackup() {
		guard let device, let accountId = session?.accountId,
			photoLibrary.canReadLibrary,
			backupPhotosEnabled || backupVideosEnabled,
			PhotoBackupPreferenceStore.isActive(deviceId: device.id, accountId: accountId),
			!photoBackupSetupInProgress,
			photoBackupSetupFailure == nil
		else { return }
		let configuration = PhotoBackupStore.configuration()
		let configurationMatchesTarget = configuration?.deviceId == device.id
			&& configuration?.source.accountId == accountId
		guard !configurationMatchesTarget || configuration?.route == .app else {
			// The Umbrel answering again cuts the app's retry wait short
			PhotoBackupAppRunner.shared.run()
			return
		}
		tailscaleSetupPresented = false
		syncBackup()
	}

	// Tailscale node addresses are stable unless the node is reset, removed, or manually
	// reassigned. Never rewrite PhotoKit's destination from discovery alone; when such a
	// change is detected, this explicit action ends the old configuration and verifies a
	// fresh one so the extension can cancel obsolete jobs and requeue their resources.
	func reconnectPhotoBackupToTailscale() {
		guard let device, let accountId = session?.accountId,
			photoLibrary.canReadLibrary,
			backupPhotosEnabled || backupVideosEnabled,
			PhotoBackupPreferenceStore.isActive(deviceId: device.id, accountId: accountId),
			photoBackupTailscaleAddressChanged,
			!photoBackupSetupInProgress
		else { return }

		let includePhotos = backupPhotosEnabled
		let includeVideos = backupVideosEnabled
		let allowsCellularAccess = backupCellularEnabled
		backupSyncRevision += 1
		let revision = backupSyncRevision
		photoBackupSetupInProgress = true
		photoBackupSetupFailure = nil
		enqueuePhotoBackupOperation(revision: revision) { model in
			await model.disablePhotoBackup(revokeServerGrant: true)
			guard model.backupSetupIsCurrent(
				revision: revision,
				deviceId: device.id,
				accountId: accountId
			) else { return }
			await model.applyPhotoBackupConfiguration(
				device: device,
				includePhotos: includePhotos,
				includeVideos: includeVideos,
				allowsCellularAccess: allowsCellularAccess,
				revision: revision
			)
		}
	}

	// Storage exhaustion is not a transient network failure: automatically retrying
	// can resend PhotoKit's entire in-flight batch to a still-full Umbrel. Retry only
	// after an explicit user action; one failed attempt returns to the paused state.
	func retryPhotoBackupAfterInsufficientStorage() {
		guard let configuration = PhotoBackupStore.configuration(),
			PhotoBackupStore.snapshot.sourceId == configuration.source.id,
			PhotoBackupStore.snapshot.issue == .insufficientStorage,
			PhotoBackupPreferenceStore.isActive(
				deviceId: configuration.deviceId,
				accountId: configuration.source.accountId
			)
		else { return }

		if configuration.route == .app {
			// The app's next pass sends one failed file as the capacity probe
			guard PhotoBackupStore.requestStorageRetry(sourceId: configuration.source.id) else {
				Self.logger.error("Could not save the photo backup storage retry request")
				return
			}
			photoBackupStorageRetrying = true
			refreshPhotoBackupPresentation()
			PhotoBackupAppRunner.shared.run()
			return
		}
		let library = PHPhotoLibrary.shared()
		let wasEnabled = library.uploadJobExtensionEnabled
		do {
			// Apple documents false as stopping background processing and true as
			// enabling it. Restarting here gives PhotoKit an explicit activation after
			// the user retries; calling true while already enabled has no documented
			// wake-up guarantee.
			if wasEnabled {
				try library.setUploadJobExtensionEnabled(false)
			}
			guard PhotoBackupStore.requestStorageRetry(sourceId: configuration.source.id) else {
				if wasEnabled { try? library.setUploadJobExtensionEnabled(true) }
				Self.logger.error("Could not save the photo backup storage retry request")
				return
			}
			photoBackupStorageRetrying = true
			try library.setUploadJobExtensionEnabled(true)
			refreshPhotoBackupPresentation()
			// Whichever uploader runs first sends the probe, and the app runs now
			PhotoBackupAppRunner.shared.run()
		} catch {
			// The extension clears the one-shot request only after requeue succeeds. If
			// enabling fails, leave the pause intact and safely retry on the next tap.
			if wasEnabled, !library.uploadJobExtensionEnabled {
				try? library.setUploadJobExtensionEnabled(true)
			}
			PhotoBackupStore.clearStorageRetryRequest()
			photoBackupStorageRetrying = false
			refreshPhotoBackupPresentation()
			let nsError = error as NSError
			Self.logger.error(
				"Could not retry photo backup after insufficient storage: domain=\(nsError.domain, privacy: .public) code=\(nsError.code, privacy: .public) description=\(nsError.localizedDescription, privacy: .private)"
			)
		}
	}

	func retryPhotoBackupAfterError() {
		guard photoBackupStatus == .error, let device, let session else { return }
		let setupHadFailed = photoBackupSetupFailure != nil
		photoBackupSetupFailure = nil

		guard let configuration = PhotoBackupStore.configuration(),
			configuration.deviceId == device.id,
			configuration.source.accountId == session.accountId
		else {
			// Setup failures have no PhotoKit jobs to repair. Re-run the serialized
			// setup path, which preserves the user's choices and reports a typed state.
			syncBackup()
			return
		}

		guard !setupHadFailed else {
			syncBackup()
			return
		}

		requestPhotoBackupRecovery(
			for: configuration,
			renewGrant: photoBackup.issue == .authenticationRequired
		)
	}

	private func requestPhotoBackupRecovery(
		for configuration: PhotoBackupConfiguration,
		renewGrant: Bool
	) {
		if configuration.route == .app {
			guard PhotoBackupStore.requestRecoveryRetry(sourceId: configuration.source.id) else {
				Self.logger.error("Could not save the photo backup retry request")
				return
			}
			photoBackupRecoveryRetrying = true
			if renewGrant {
				// Setup issues a fresh scoped grant, then starts the app's next pass
				Keychain.deletePhotoBackupGrant(
					deviceId: configuration.deviceId,
					accountId: configuration.source.accountId
				)
				syncBackup()
			} else {
				refreshPhotoBackupPresentation()
				PhotoBackupAppRunner.shared.run()
			}
			return
		}
		let library = PHPhotoLibrary.shared()
		let wasEnabled = library.uploadJobExtensionEnabled
		do {
			if wasEnabled {
				try library.setUploadJobExtensionEnabled(false)
			}
			guard PhotoBackupStore.requestRecoveryRetry(sourceId: configuration.source.id) else {
				throw PhotoBackupSetupError.sharedStorageFailed
			}
			photoBackupRecoveryRetrying = true
			if renewGrant {
				// The upload capability is separate from the signed-in app session. Setup
				// issues a fresh scoped grant before it enables PhotoKit again.
				Keychain.deletePhotoBackupGrant(
					deviceId: configuration.deviceId,
					accountId: configuration.source.accountId
				)
				syncBackup()
			} else {
				try library.setUploadJobExtensionEnabled(true)
				refreshPhotoBackupPresentation()
				PhotoBackupAppRunner.shared.run()
			}
		} catch {
			PhotoBackupStore.clearRecoveryRetryRequest(for: configuration.source.id)
			photoBackupRecoveryRetrying = false
			if wasEnabled, !library.uploadJobExtensionEnabled {
				try? library.setUploadJobExtensionEnabled(true)
			}
			let nsError = error as NSError
			Self.logger.error(
				"Could not retry photo backup: domain=\(nsError.domain, privacy: .public) code=\(nsError.code, privacy: .public) description=\(nsError.localizedDescription, privacy: .private)"
			)
			refreshPhotoBackupPresentation()
		}
	}

	private func restartPhotoBackupExtension() throws {
		let library = PHPhotoLibrary.shared()
		if library.uploadJobExtensionEnabled {
			try library.setUploadJobExtensionEnabled(false)
		}
		try library.setUploadJobExtensionEnabled(true)
		guard library.uploadJobExtensionEnabled else {
			throw PhotoBackupSetupError.extensionNotEnabled
		}
	}

	func setBackupPhotosEnabled(_ enabled: Bool) {
		guard !enabled || !photoBackupIsConfiguredElsewhere else { return }
		guard backupPhotosEnabled != enabled else { return }
		backupPhotosEnabled = enabled
		persistPhotoBackupPreferenceAndSync()
	}

	func setBackupVideosEnabled(_ enabled: Bool) {
		guard !enabled || !photoBackupIsConfiguredElsewhere else { return }
		guard backupVideosEnabled != enabled else { return }
		backupVideosEnabled = enabled
		persistPhotoBackupPreferenceAndSync()
	}

	func setBackupCellularEnabled(_ enabled: Bool) {
		guard !enabled || !photoBackupIsConfiguredElsewhere else { return }
		backupCellularEnabled = enabled
		persistPhotoBackupPreferenceAndSync()
	}

	private var currentPhotoBackupPreference: PhotoBackupPreference {
		PhotoBackupPreference(
			includesPhotos: backupPhotosEnabled,
			includesVideos: backupVideosEnabled,
			allowsCellular: backupCellularEnabled
		)
	}

	private func persistPhotoBackupPreferenceAndSync() {
		guard let device, let session, !photoBackupIsConfiguredElsewhere else { return }
		PhotoBackupPreferenceStore.save(
			currentPhotoBackupPreference,
			deviceId: device.id,
			accountId: session.accountId,
			activate: true
		)
		photoBackupPresentationTargetActive = currentPhotoBackupPreference.isEnabled
		syncBackup()
	}

	// Full Photos access is the single boundary for this feature. When a user
	// revokes or limits access in Settings, immediately make backup off as well;
	// restoring access later reveals the Library but never restarts uploads by itself.
	func reconcilePhotoLibraryAccess() {
		let currentBackgroundRefreshStatus = UIApplication.shared.backgroundRefreshStatus
		if backgroundRefreshStatus != currentBackgroundRefreshStatus {
			backgroundRefreshStatus = currentBackgroundRefreshStatus
		}
		photoLibrary.refresh()
		guard !photoLibrary.canReadLibrary else {
			// Setup that waited for the Umbrel goes on when the Umbrel answers or the
			// network changes, not as a "Starting backup" flash on every foreground
			if let device, let accountId = session?.accountId,
				backupPhotosEnabled || backupVideosEnabled,
				PhotoBackupPreferenceStore.isActive(deviceId: device.id, accountId: accountId),
				PhotoBackupStore.configuration() == nil
			{
				return
			}
			syncBackup()
			return
		}

		guard backupPhotosEnabled
			|| backupVideosEnabled
			|| PhotoBackupStore.configuration() != nil
		else { return }

		backupPhotosEnabled = false
		backupVideosEnabled = false
		if let device, let session {
			PhotoBackupPreferenceStore.save(
				currentPhotoBackupPreference,
				deviceId: device.id,
				accountId: session.accountId,
				activate: false
			)
		}
		syncBackup()
	}

	// Start or stop PhotoKit backup to match the Profile toggles. Backup follows
	// the device it was enabled on, never the device screen that happens to be open:
	// viewing another Umbrel must not retarget an entire photo library at it.
	func syncBackup() {
		guard let device, let accountId = session?.accountId else { return }
		let photos = backupPhotosEnabled
		let videos = backupVideosEnabled
		let cellular = backupCellularEnabled
		let currentConfiguration = PhotoBackupStore.configuration()
		let configurationBelongsToAccount = currentConfiguration?.deviceId == device.id
			&& currentConfiguration?.source.accountId == accountId
		// Connecting or signing in to another Umbrel is never permission to move the
		// iPhone's backup destination. Only the user's confirmed switch moves it
		// (backUpToThisUmbrelInstead), by turning the configured target off first.
		guard currentConfiguration == nil || configurationBelongsToAccount else {
			photoBackupSetupInProgress = false
			photoBackupSetupFailure = nil
			refreshPhotoBackupPresentation()
			return
		}
		guard PhotoBackupPreferenceStore.isActive(deviceId: device.id, accountId: accountId) else {
			photoBackupSetupInProgress = false
			photoBackupSetupFailure = nil
			tailscaleSetupPresented = false
			if configurationBelongsToAccount {
				// Not after whatever setup is queued ahead of turning it off
				PhotoBackupAppRunner.shared.stop()
				backupSyncRevision += 1
				let revision = backupSyncRevision
				enqueuePhotoBackupOperation(revision: revision) { model in
					await model.disablePhotoBackup(revokeServerGrant: true)
				}
			} else {
				refreshPhotoBackupPresentation()
			}
			return
		}
		let storedSourceId = Self.readPhotoBackupSourceId(
			deviceId: device.id,
			accountId: accountId
		).id
		let desired: PhotoBackupConfiguration? = currentConfiguration.flatMap { configuration in
			guard configuration.deviceId == device.id,
				configuration.source.accountId == accountId,
				configuration.source.id == storedSourceId,
				configuration.hasValidRoute
			else { return nil }
			return PhotoBackupConfiguration(
				deviceId: device.id,
				route: configuration.route,
				uploadBaseURL: configuration.uploadBaseURL,
				source: configuration.source,
				includePhotos: photos,
				includeVideos: videos,
				allowsCellularAccess: cellular
			)
		}
		if let desired,
			currentConfiguration == desired,
			PhotoBackupStore.snapshot.phase != .disabled,
			PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized,
			// PhotoKit's extension uploads only on the Tailscale route
			PHPhotoLibrary.shared().uploadJobExtensionEnabled == (desired.route == .tailscale),
			!photoBackupCanMoveToTailscale(desired, device: device),
			case .found = Keychain.readPhotoBackupGrant(deviceId: device.id, accountId: accountId)
		{
			photoBackupSetupInProgress = false
			photoBackupSetupFailure = nil
			tailscaleSetupPresented = false
			refreshPhotoBackupPresentation()
			PhotoBackupAppRunner.shared.run()
			return
		}

		backupSyncRevision += 1
		let revision = backupSyncRevision
		photoBackupSetupInProgress = true
		photoBackupSetupFailure = nil
		enqueuePhotoBackupOperation(revision: revision) { model in
			await model.applyPhotoBackupConfiguration(
				device: device,
				includePhotos: photos,
				includeVideos: videos,
				allowsCellularAccess: cellular,
				revision: revision
			)
		}
	}

	private func enqueuePhotoBackupOperation(
		revision: Int,
		operation: @escaping @MainActor (MainModel) async -> Void
	) {
		let previous = Self.photoBackupOperationTail
		let task = Task { @MainActor [weak self] in
			await previous?.value
			guard let self, revision == self.backupSyncRevision else { return }
			await operation(self)
			if revision == self.backupSyncRevision {
				self.backupSyncTask = nil
			}
		}
		Self.photoBackupOperationTail = task
		backupSyncTask = task
	}

	private func backupSetupIsCurrent(
		revision: Int,
		deviceId: String,
		accountId: String
	) -> Bool {
		revision == backupSyncRevision
			&& device?.id == deviceId
			&& session?.accountId == accountId
			&& PhotoBackupPreferenceStore.isActive(deviceId: deviceId, accountId: accountId)
			&& (backupPhotosEnabled || backupVideosEnabled)
	}

	private func applyPhotoBackupConfiguration(
		device: SavedDevice,
		includePhotos: Bool,
		includeVideos: Bool,
		allowsCellularAccess: Bool,
		revision: Int
	) async {
		guard revision == backupSyncRevision else { return }
		if !includePhotos && !includeVideos {
			await disablePhotoBackup(revokeServerGrant: true)
			return
		}

		guard let session else {
			photoBackupFailed(.unexpected("Sign in to resume backup"), revision: revision)
			return
		}
		guard backupSetupIsCurrent(
			revision: revision,
			deviceId: device.id,
			accountId: session.accountId
		) else { return }
		// Photos access is the first and most direct consequence of the user's action.
		// Ask for it before introducing a networking prerequisite. Once granted, the
		// enabled preference can wait safely for Tailscale without reading any assets.
		let authorization = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
		guard backupSetupIsCurrent(
			revision: revision,
			deviceId: device.id,
			accountId: session.accountId
		) else { return }
		photoLibrary.refresh()
		guard authorization == .authorized else {
			// iOS has explicitly prohibited access, so unlike a temporary Tailscale
			// outage this cannot remain represented as an enabled backup preference.
			backupPhotosEnabled = false
			backupVideosEnabled = false
			photoBackupSetupInProgress = false
			photoBackupSetupFailure = nil
			tailscaleSetupPresented = false
			PhotoBackupPreferenceStore.save(
				currentPhotoBackupPreference,
				deviceId: device.id,
				accountId: session.accountId,
				activate: false
			)
			await disablePhotoBackup(revokeServerGrant: true)
			return
		}

		var previousConfiguration = PhotoBackupStore.configuration()
		if let active = previousConfiguration,
			active.deviceId != device.id
				|| active.source.accountId != session.accountId
		{
			// PhotoKit exposes one uploader per app. Stop another target before
			// installing this account's configuration.
			await disablePhotoBackup(revokeServerGrant: true)
			guard backupSetupIsCurrent(
				revision: revision,
				deviceId: device.id,
				accountId: session.accountId
			) else { return }
			previousConfiguration = nil
		}
		let route: PhotoBackupConfiguration.Route
		let uploadBaseURL: String
		if let previousConfiguration,
			previousConfiguration.deviceId == device.id,
			previousConfiguration.source.accountId == session.accountId,
			previousConfiguration.hasValidRoute,
			!photoBackupCanMoveToTailscale(previousConfiguration, device: device)
		{
			// Preference changes reuse the exact route verified during setup.
			route = previousConfiguration.route
			uploadBaseURL = previousConfiguration.uploadBaseURL
		} else if let photoBackupHost = device.photoBackupHost,
			await Umbreld.isKnownEndpointAvailable(host: photoBackupHost, deviceId: device.id)
		{
			// `resolvedHost` deliberately caches a previous winner for normal API traffic,
			// so it cannot prove that Tailscale is reachable now. The probe above checks
			// this exact endpoint without the resolver cache before pinning it for PhotoKit.
			guard backupSetupIsCurrent(
				revision: revision,
				deviceId: device.id,
				accountId: session.accountId
			) else { return }
			// PhotoKit owns the upload request and exposes no server-trust callback for
			// Umbrel's app-pinned local CA. Restrict the HTTP destination to this verified
			// Tailscale address; the scoped grant authorizes the account and source.
			route = .tailscale
			uploadBaseURL = "http://\(photoBackupHost)"
		} else {
			guard backupSetupIsCurrent(
				revision: revision,
				deviceId: device.id,
				accountId: session.accountId
			) else { return }
			// Setup's own uncached check is newer evidence than a foreground probe
			if device.photoBackupHost != nil { tailscaleAvailableOnThisPhone = false }
			// Without Tailscale on this iPhone, only the app backs up, while it's open
			route = .app
			uploadBaseURL = ""
		}
		var issuedGrant = false
		var shouldRevokeIssuedGrant = false
		var canRestorePreviousConfiguration = true
		var configurationCommitted = false
		do {
			let accountBackups = try await choosePhotoBackupSource(
				device: device,
				session: session,
				previousConfiguration: previousConfiguration,
				isCurrent: {
					self.backupSetupIsCurrent(revision: revision, deviceId: device.id, accountId: session.accountId)
				}
			)
			guard backupSetupIsCurrent(
				revision: revision,
				deviceId: device.id,
				accountId: session.accountId
			) else { return }
			let wasExtensionEnabled = PHPhotoLibrary.shared().uploadJobExtensionEnabled

			let sourceId: String
			switch Self.readPhotoBackupSourceId(deviceId: device.id, accountId: session.accountId) {
			case .found(let storedSourceId):
				sourceId = storedSourceId
			case .missing:
				// umbrelOS that can't continue a backup: a new one
				sourceId = UUID().uuidString.lowercased()
				guard Self.setPhotoBackupSourceId(
					sourceId,
					deviceId: device.id,
					accountId: session.accountId
				) else {
					throw PhotoBackupSetupError.sourceStorageFailed
				}
			case .unavailable:
				throw PhotoBackupSetupError.sourceStorageUnavailable
			}

			let storedGrant: String?
			switch Keychain.readPhotoBackupGrant(deviceId: device.id, accountId: session.accountId) {
			case .found(let token):
				storedGrant = token
			case .missing:
				storedGrant = nil
			case .unavailable:
				throw PhotoBackupSetupError.credentialStorageUnavailable
			}
			let source: PhotoBackupSource
			let grantToken: String
			if let previousConfiguration,
				previousConfiguration.deviceId == device.id,
				previousConfiguration.source.accountId == session.accountId,
				previousConfiguration.source.id == sourceId,
				let storedGrant {
				// Preference changes only alter the request template consumed by the
				// extension. Keep the existing account/source capability intact.
				source = previousConfiguration.source
				grantToken = storedGrant
			} else {
				let continuing = Self.photoBackupRenamePendingSourceId(
					deviceId: device.id,
					accountId: session.accountId
				) == sourceId
				var takenNames = knownIPhoneSourceNames
				if continuing {
					// Unique among the account's other backups, so an iPhone named like the
					// one it replaced keeps that name
					var sources = accountBackups
					if sources == nil {
						sources = try await Umbreld.photoBackupSources(target: device.nativeTarget, session: session)
						guard backupSetupIsCurrent(
							revision: revision,
							deviceId: device.id,
							accountId: session.accountId
						) else { return }
					}
					if let sources {
						takenNames = sources.sources.filter { $0.id != sourceId }.map(\.name)
					}
				} else if knownIPhoneSourceNames.isEmpty,
					let sources = try? await Umbreld.photoSources(target: device.nativeTarget, session: session)
				{
					// Nothing has read the account's backups yet, as on umbrelOS that can't
					// continue one. umbrelOS keeps the name of a source it already has.
					knownIPhoneSourceNames = sources.filter { $0.type == "iphone" }.map(\.name)
					takenNames = knownIPhoneSourceNames
					guard backupSetupIsCurrent(
						revision: revision,
						deviceId: device.id,
						accountId: session.accountId
					) else { return }
				}
				let grant = try await Umbreld.createPhotoBackupGrant(
					target: device.nativeTarget,
					session: session,
					sourceId: sourceId,
					suggestedName: PhotoBackupSourceName.unique(PhotoBackupSourceName.current, among: takenNames),
					continuing: continuing
				)
				// umbrelOS has renamed it, even if setup stops after this
				if continuing {
					Self.setPhotoBackupRenamePending(nil, deviceId: device.id, accountId: session.accountId)
				}
				issuedGrant = true
				shouldRevokeIssuedGrant = storedGrant == nil
				source = grant.source
				// The Umbrel's name for it now, which may be newer than one read for How it works
				rememberSourceNameOnUmbrel(grant.source.name, sourceId: grant.source.id)
				grantToken = grant.token
				if let storedGrant, storedGrant != grant.token {
					// A replacement server capability invalidates the old one. If setup
					// subsequently fails, the old extension config is no longer usable.
					shouldRevokeIssuedGrant = true
					canRestorePreviousConfiguration = false
				}
			}
			guard source.accountId == session.accountId else {
				// Treat an account mismatch as a protocol failure, not a recoverable UI
				// error. Revoke the session-bound upload capability before discarding it.
				Keychain.deletePhotoBackupGrant(deviceId: device.id, accountId: session.accountId)
				try? await Umbreld.revokePhotoBackupGrant(target: device.nativeTarget, session: session)
				issuedGrant = false
				throw PhotoBackupSetupError.sourceAccountMismatch
			}
			if storedGrant != grantToken {
				// Persist an issued replacement before checking whether this settings
				// revision is stale. Setup operations are serialized, so the newer operation
				// can safely reuse—or disable—the server's authoritative capability.
				guard Keychain.setPhotoBackupGrant(
					grantToken,
					deviceId: device.id,
					accountId: session.accountId
				) else {
					if issuedGrant, storedGrant == nil {
						try? await Umbreld.revokePhotoBackupGrant(target: device.nativeTarget, session: session)
					}
					throw PhotoBackupSetupError.credentialStorageFailed
				}
			}
			guard backupSetupIsCurrent(
				revision: revision,
				deviceId: device.id,
				accountId: session.accountId
			) else {
				let newerSetupForSameTarget = photoBackupSetupInProgress
					&& self.device?.id == device.id
					&& self.session?.accountId == session.accountId
					&& PhotoBackupPreferenceStore.isActive(
						deviceId: device.id,
						accountId: session.accountId
					)
					&& (backupPhotosEnabled || backupVideosEnabled)
				if issuedGrant, !newerSetupForSameTarget {
					Keychain.deletePhotoBackupGrant(deviceId: device.id, accountId: session.accountId)
					try? await Umbreld.revokePhotoBackupGrant(target: device.nativeTarget, session: session)
				}
				return
			}

			let configuration = PhotoBackupConfiguration(
				deviceId: device.id,
				route: route,
				uploadBaseURL: uploadBaseURL,
				source: source,
				includePhotos: includePhotos,
				includeVideos: includeVideos,
				allowsCellularAccess: allowsCellularAccess
			)
			guard let ledgerURL = PhotoBackupStore.ledgerURL,
				let ledger = PhotoBackupLedger(url: ledgerURL)
			else { throw PhotoBackupSetupError.sharedStorageFailed }
			let previousSnapshot = PhotoBackupStore.snapshot
			let storagePaused = previousSnapshot.sourceId == configuration.source.id
				&& previousSnapshot.issue == .insufficientStorage
			if previousConfiguration != configuration, !storagePaused {
				try BackgroundTaskAssertion.perform("Requeue failed photo backup assets") {
					try ledger.requeueFailedAssets(
						deviceId: source.id,
						includePhotos: includePhotos,
						includeVideos: includeVideos
					)
				}
			}
			guard backupSetupIsCurrent(
				revision: revision,
				deviceId: device.id,
				accountId: session.accountId
			) else { return }
			guard PhotoBackupStore.save(configuration: configuration) else {
				throw PhotoBackupSetupError.sharedStorageFailed
			}
			configurationCommitted = true
			let systemPhotoLibrary = PHPhotoLibrary.shared()
			let repaired = previousSnapshot.phase == .needsAttention
				&& previousSnapshot.issue != .insufficientStorage
			let shouldRestartAfterRepair = route == .tailscale && wasExtensionEnabled && repaired
			if route == .app {
				if systemPhotoLibrary.uploadJobExtensionEnabled {
					try systemPhotoLibrary.setUploadJobExtensionEnabled(false)
				}
			} else if shouldRestartAfterRepair {
				try restartPhotoBackupExtension()
			} else if !systemPhotoLibrary.uploadJobExtensionEnabled {
				try systemPhotoLibrary.setUploadJobExtensionEnabled(true)
			}
			guard systemPhotoLibrary.uploadJobExtensionEnabled == (route == .tailscale) else {
				throw PhotoBackupSetupError.extensionNotEnabled
			}
			// An idempotent foreground refresh must not overwrite the uploader's
			// transfer phase. Publish a new waiting snapshot only when setup changed.
			if previousConfiguration != configuration
				|| (route == .tailscale && !wasExtensionEnabled)
				|| previousSnapshot.phase == .disabled
				|| shouldRestartAfterRepair
				|| (route == .app && repaired)
			{
				PhotoBackupStore.publish(PhotoBackupSnapshot(
					phase: storagePaused ? .needsAttention : .waiting,
					issue: storagePaused ? .insufficientStorage : nil,
					sourceId: configuration.source.id,
					statistics: previousSnapshot.sourceId == configuration.source.id
						? previousSnapshot.statistics
						: nil
				))
			}
			photoBackupSetupInProgress = false
			photoBackupSetupFailure = nil
			tailscaleSetupPresented = false
			refreshPhotoBackupPresentation()
			// A pass already running read the previous configuration
			if previousConfiguration != configuration {
				PhotoBackupAppRunner.shared.restart()
			} else {
				PhotoBackupAppRunner.shared.run()
			}
			// So backup never stops without anyone knowing
			Task { await PhotoBackupReminder.requestPermissionIfNeeded() }
		} catch is CancellationError {
			return
		} catch let error as URLError where error.code == .cancelled {
			return
		} catch {
			if configurationCommitted {
				if canRestorePreviousConfiguration, let previousConfiguration {
					_ = PhotoBackupStore.save(configuration: previousConfiguration)
				} else {
					PhotoBackupStore.clearConfiguration()
				}
			} else if !canRestorePreviousConfiguration {
				PhotoBackupStore.clearConfiguration()
			}
			if issuedGrant, shouldRevokeIssuedGrant {
				Keychain.deletePhotoBackupGrant(deviceId: device.id, accountId: session.accountId)
				try? await Umbreld.revokePhotoBackupGrant(target: device.nativeTarget, session: session)
			}
			guard backupSetupIsCurrent(
				revision: revision,
				deviceId: device.id,
				accountId: session.accountId
			) else { return }
			// First setup waits for the Umbrel. A repair keeps its Try Again.
			if previousConfiguration == nil, (error as? Umbreld.Error)?.isConnectivityFailure == true {
				photoBackupWaitsForUmbrel(revision: revision)
				return
			}
			photoBackupFailed(
				.unexpected(photoBackupFailureDescription(error)),
				revision: revision
			)
		}
	}

	private func photoBackupFailureDescription(_ error: Error) -> String {
#if DEBUG
		let error = error as NSError
		let identifiers = error.userInfo[PHLocalIdentifiersErrorKey] ?? "none"
		let diagnostic = "\(error.localizedDescription) [\(error.domain) \(error.code); identifiers=\(identifiers); enabled=\(PHPhotoLibrary.shared().uploadJobExtensionEnabled)]"
		Self.logger.error("Photo backup setup failed: \(diagnostic, privacy: .private)")
		return diagnostic
#else
		return error.localizedDescription
#endif
	}

	private func disablePhotoBackup(revokeServerGrant: Bool) async {
		PhotoBackupAppRunner.shared.forget()
		let configuration = PhotoBackupStore.configuration()
		let boundDevice = configuration.flatMap { configuration in
			loadConfig()?.savedDevices[configuration.deviceId]
		}
		let boundSession = configuration.flatMap { configuration in
			Keychain.readSession(deviceId: configuration.deviceId).session.flatMap { session in
				session.accountId == configuration.source.accountId ? session : nil
			}
		}
		let photoLibrary = PHPhotoLibrary.shared()
		if photoLibrary.uploadJobExtensionEnabled {
			try? photoLibrary.setUploadJobExtensionEnabled(false)
		}
		PhotoBackupStore.clearConfiguration()
		if let configuration {
			Keychain.deletePhotoBackupGrant(
				deviceId: configuration.deviceId,
				accountId: configuration.source.accountId
			)
		}
		if revokeServerGrant, let boundDevice, let boundSession {
			try? await Umbreld.revokePhotoBackupGrant(target: boundDevice.nativeTarget, session: boundSession)
		}
		refreshPhotoBackupPresentation()
	}

	private func disablePhotoBackupLocally(deviceId: String) {
		let configuration = PhotoBackupStore.configuration()
		guard configuration == nil || configuration?.deviceId == deviceId else { return }
		PhotoBackupAppRunner.shared.forget()
		let photoLibrary = PHPhotoLibrary.shared()
		if photoLibrary.uploadJobExtensionEnabled {
			try? photoLibrary.setUploadJobExtensionEnabled(false)
		}
		PhotoBackupStore.clearConfiguration()
		if let configuration {
			Keychain.deletePhotoBackupGrant(
				deviceId: configuration.deviceId,
				accountId: configuration.source.accountId
			)
		}
		refreshPhotoBackupPresentation()
	}

	private func photoBackupFailed(_ failure: PhotoBackupSetupFailure, revision: Int) {
		guard revision == backupSyncRevision else { return }
		photoBackupSetupInProgress = false
		photoBackupSetupFailure = failure
		if let configuration = PhotoBackupStore.configuration() {
			PhotoBackupStore.clearRecoveryRetryRequest(for: configuration.source.id)
			photoBackupRecoveryRetrying = false
		}
		Self.logger.error("Photo backup setup failed: \(failure.message, privacy: .private)")
	}

	private func photoBackupWaitsForUmbrel(revision: Int) {
		guard revision == backupSyncRevision else { return }
		photoBackupSetupInProgress = false
		photoBackupSetupFailure = nil
		refreshPhotoBackupPresentation()
	}

	// The app backs up only while it's open. Once Tailscale reaches the Umbrel from
	// this iPhone, PhotoKit can also back up while it's closed.
	private func photoBackupCanMoveToTailscale(_ configuration: PhotoBackupConfiguration, device: SavedDevice) -> Bool {
		configuration.route == .app
			&& tailscaleAvailableOnThisPhone == true
			&& device.photoBackupHost != nil
	}

	// Load the wallpaper (from the shared cache, or fetched once and cached), plus its
	// blurred companion used to frost the cards. Both come from the same image so the
	// frosted cards align with the sharp backdrop; both are cached on disk, so this only
	// does work the very first time a wallpaper is ever seen.
	private func loadWallpaperImages(id: String, target: Umbreld.Target) async {
		guard let image = await WallpaperStore.shared.load(id: id, target: target)
		else { return }
		let blur = await WallpaperStore.shared.blurred(id: id)
		guard wallpaperId == id else { return }
		wallpaperImage = image
		blurredWallpaper = blur
		renderedWallpaperId = id
	}

	func signOut() {
		let sessionToRevoke = session
		let targetToRevoke = nativeTarget
		if let id = device?.id {
			backupSyncRevision += 1
			photoBackupSetupInProgress = false
			photoBackupSetupFailure = nil
			if PhotoBackupStore.configuration()?.deviceId == id {
				disablePhotoBackupLocally(deviceId: id)
			}
			Keychain.deleteSession(deviceId: id)
			self.session = nil
		}
		onLogOut()

		if let targetToRevoke {
			let accountId = sessionToRevoke?.accountId
			Task { await BrowserContext.signOut(target: targetToRevoke, accountId: accountId) }
		}
		guard let targetToRevoke, let sessionToRevoke else { return }
		// Local sign-out must not wait for a reachable Umbrel. Server revocation is
		// attempted afterward without reading or writing Keychain state, so a quick
		// subsequent sign-in is independent from this best-effort cleanup.
		Task {
			do {
				try await Umbreld.logout(target: targetToRevoke, session: sessionToRevoke)
			} catch {
				Self.logger.error("Server session revocation after sign-out failed: \(error.localizedDescription, privacy: .private)")
			}
		}
	}

	// Removing is intentionally stronger than signing out: credentials, the saved
	// connection, and backup intent are cleared. The non-secret, account-scoped source
	// id and local receipts remain dormant so an explicit future enable can resume the
	// same server folder without duplicating the library.
	static func removeSavedDevice(_ device: SavedDevice) async throws {
		let loaded = Config.load()
		if let issue = loaded.issue { throw issue }
		var config = loaded.config
		try config.remove(id: device.id)

		let configuration = PhotoBackupStore.configuration()
		if configuration?.deviceId == device.id {
			PhotoBackupAppRunner.shared.forget()
			let photoLibrary = PHPhotoLibrary.shared()
			if photoLibrary.uploadJobExtensionEnabled {
				try? photoLibrary.setUploadJobExtensionEnabled(false)
			}
			PhotoBackupStore.clearConfiguration()
			if let configuration {
				Keychain.deletePhotoBackupGrant(
					deviceId: configuration.deviceId,
					accountId: configuration.source.accountId
				)
			}
		}
		PhotoBackupPreferenceStore.removeDevice(device.id)

		let session = Keychain.readSession(deviceId: device.id).session
		// Before the pinned CA is forgotten below: ending the browser session needs it.
		await BrowserContext.signOut(target: device.nativeTarget, accountId: session?.accountId)
		if let session {
			try? await Umbreld.logout(target: device.nativeTarget, session: session)
		}
		Keychain.deleteSession(deviceId: device.id)
		await Umbreld.forgetLocalHTTPSIdentity(deviceId: device.id)
		DeviceDataStore.delete(deviceId: device.id)
	}

	private func sessionInvalidated(deviceId: String) {
		backupSyncRevision += 1
		photoBackupSetupInProgress = false
		photoBackupSetupFailure = nil
		if PhotoBackupStore.configuration()?.deviceId == deviceId {
			disablePhotoBackupLocally(deviceId: deviceId)
		}
		if let target = nativeTarget {
			let accountId = session?.accountId
			Task { await BrowserContext.signOut(target: target, accountId: accountId) }
		}
		Keychain.deleteSession(deviceId: deviceId)
		session = nil
		// Preserve the user's backup preference so a deliberate re-login resumes it,
		// but never enqueue new work without a valid native grant.
		onLogOut()
	}

	private enum PhotoBackupSetupFailure: Equatable {
		case unexpected(String)

		var message: String {
			switch self {
			case .unexpected(let message):
				message
			}
		}
	}

	private enum PhotoBackupSetupError: LocalizedError {
		case credentialStorageFailed
		case credentialStorageUnavailable
		case sourceStorageFailed
		case sourceStorageUnavailable
		case sourceAccountMismatch
		case sharedStorageFailed
		case extensionNotEnabled

		var errorDescription: String? {
			switch self {
			case .credentialStorageFailed:
				return "The upload grant could not be saved to the shared Keychain"
			case .credentialStorageUnavailable:
				return "The shared Keychain is temporarily unavailable"
			case .sourceStorageFailed:
				return "The photo backup identity could not be saved to the Keychain"
			case .sourceStorageUnavailable:
				return "The photo backup identity is temporarily unavailable"
			case .sourceAccountMismatch:
				return "The photo backup identity belongs to a different Umbrel account"
			case .sharedStorageFailed:
				return "The extension configuration could not be saved to the App Group"
			case .extensionNotEnabled:
				return "iOS did not enable background photo backup"
			}
		}
	}
}

// Reachability is intentionally process-local. Sharing the last confirmed result
// between Card and Home prevents navigation from restarting the same loading state,
// while never carrying a potentially stale network claim into a future app launch.
struct DeviceConnectionSnapshot: Equatable {
	static let unverified = DeviceConnectionSnapshot(state: .unverified, checkedAt: nil)
	static let freshnessInterval: TimeInterval = 15

	var state: MainModel.ConnectionState
	var checkedAt: Date?

	func isFresh(at now: Date = Date()) -> Bool {
		guard state != .unverified, let checkedAt else { return false }
		return now.timeIntervalSince(checkedAt) < Self.freshnessInterval
	}
}
