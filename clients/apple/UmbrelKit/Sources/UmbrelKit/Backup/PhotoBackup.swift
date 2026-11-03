import CryptoKit
import Foundation

// A photo library's stable identity on one Umbrel. The id is deliberately random
// rather than derived from Apple device information; the readable name is
// presentation metadata, not storage identity.
public struct PhotoBackupSource: Codable, Equatable, Sendable {
	public let id: String
	public let accountId: String
	public let name: String

	public init(id: String, accountId: String, name: String) {
		self.id = id
		self.accountId = accountId
		self.name = name
	}

	// The id Photos on the Umbrel lists this source under
	public var libraryId: String {
		let digest = SHA256.hash(data: Data("\(accountId)\u{0}\(id)".utf8))
		return "iphone:" + digest.map { String(format: "%02x", $0) }.joined()
	}
}

// Configuration and presentation state shared by the host app and PhotoKit's
// system-owned background upload extension. Durable queue state lives in the
// App Group SQLite ledger; small operational values use coordinated JSON files.
public struct PhotoBackupConfiguration: Codable, Equatable, Sendable {
	// Whether PhotoKit's extension also uploads while the app is closed. It can't check
	// the Umbrel's certificate, so it may only send plain HTTP to a Tailscale address.
	// The app itself backs up over the pinned connection whenever it's open, on either.
	public enum Route: String, Codable, Sendable {
		case tailscale
		case app
	}

	public let deviceId: String
	public let route: Route
	// The Tailscale address PhotoKit's jobs go to. Empty on the app route, which
	// finds the Umbrel on any route for each upload.
	public let uploadBaseURL: String
	public let source: PhotoBackupSource
	public let includePhotos: Bool
	public let includeVideos: Bool
	public let allowsCellularAccess: Bool

	public init(
		deviceId: String,
		route: Route = .tailscale,
		uploadBaseURL: String,
		source: PhotoBackupSource,
		includePhotos: Bool,
		includeVideos: Bool,
		allowsCellularAccess: Bool = false
	) {
		self.deviceId = deviceId
		self.route = route
		self.uploadBaseURL = uploadBaseURL
		self.source = source
		self.includePhotos = includePhotos
		self.includeVideos = includeVideos
		self.allowsCellularAccess = allowsCellularAccess
	}

	public init(from decoder: Decoder) throws {
		let container = try decoder.container(keyedBy: CodingKeys.self)
		deviceId = try container.decode(String.self, forKey: .deviceId)
		// Saved before the app route existed
		route = try container.decodeIfPresent(Route.self, forKey: .route) ?? .tailscale
		uploadBaseURL = try container.decode(String.self, forKey: .uploadBaseURL)
		source = try container.decode(PhotoBackupSource.self, forKey: .source)
		includePhotos = try container.decode(Bool.self, forKey: .includePhotos)
		includeVideos = try container.decode(Bool.self, forKey: .includeVideos)
		allowsCellularAccess = try container.decode(Bool.self, forKey: .allowsCellularAccess)
	}

	public var hasValidRoute: Bool {
		switch route {
		case .tailscale: isTailscaleDestination
		case .app: uploadBaseURL.isEmpty
		}
	}

	// HTTP is permitted only when its destination is in Tailscale's CGNAT range.
	// Both the host app and extension enforce this before enabling or creating jobs.
	// This is a destination policy, not route attestation: the client cannot
	// cryptographically prove which route iOS used to reach that address.
	public var isTailscaleDestination: Bool {
		guard route == .tailscale,
			let url = URL(string: uploadBaseURL),
			url.scheme?.lowercased() == "http",
			let host = url.host
		else { return false }
		return SavedDevice.isTailscaleAddress(host)
	}

	public func matchesUploadDestination(_ request: URLRequest, grant: String) -> Bool {
		// PhotoKit persists this complete request with each job. A rotated grant
		// makes an otherwise-current destination obsolete, so recreate that job.
		guard isTailscaleDestination,
			let originalURL = request.url,
			request.allowsCellularAccess == allowsCellularAccess,
			request.value(forHTTPHeaderField: "Authorization") == "Bearer \(grant)",
			let expected = URL(string: uploadBaseURL),
			Self.sameOrigin(originalURL, expected)
		else { return false }
		return true
	}

	public func retargetUploadDestination(_ request: URLRequest) -> URLRequest? {
		guard isTailscaleDestination,
			let originalURL = request.url,
			let baseURL = URL(string: uploadBaseURL),
			var destination = URLComponents(url: originalURL, resolvingAgainstBaseURL: false),
			let base = URLComponents(url: baseURL, resolvingAgainstBaseURL: false),
			let scheme = base.scheme,
			let host = base.host
		else { return nil }
		destination.scheme = scheme
		destination.host = host
		destination.port = base.port
		guard let url = destination.url else { return nil }
		var retargeted = request
		retargeted.url = url
		retargeted.allowsCellularAccess = allowsCellularAccess
		return retargeted
	}

	private static func sameOrigin(_ lhs: URL, _ rhs: URL) -> Bool {
		guard let lhsScheme = lhs.scheme?.lowercased(),
			let rhsScheme = rhs.scheme?.lowercased(),
			let lhsHost = lhs.host?.lowercased(),
			let rhsHost = rhs.host?.lowercased()
		else { return false }
		func port(_ url: URL, scheme: String) -> Int? {
			url.port ?? (scheme == "http" ? 80 : scheme == "https" ? 443 : nil)
		}
		return lhsScheme == rhsScheme
			&& lhsHost == rhsHost
			&& port(lhs, scheme: lhsScheme) == port(rhs, scheme: rhsScheme)
	}
}

public enum PhotoBackupPhase: String, Codable, Equatable, Sendable {
	case disabled
	case waiting
	case waitingForUmbrel
	case uploading
	case checkingStorage
	case upToDate
	case needsAttention
}

// The host app has four independent inputs: remembered intent, which target owns
// that intent, Umbrel's shared configuration, and PhotoKit's own enabled state.
// Reduce them once so UI text and color can never disagree about whether backup
// is off, still being installed, active, or failed during setup.
public enum PhotoBackupPresentationMode: Equatable, Sendable {
	case off
	case settingUp
	case active
	case failed

	public static func resolve(
		intentEnabled: Bool,
		targetActive: Bool,
		configurationMatchesTarget: Bool,
		extensionEnabled: Bool,
		snapshotMatchesSource: Bool,
		snapshotPhase: PhotoBackupPhase,
		setupInProgress: Bool,
		setupFailed: Bool
	) -> Self {
		guard intentEnabled, targetActive else { return .off }
		if setupFailed { return .failed }
		if setupInProgress { return .settingUp }
		guard configurationMatchesTarget,
			extensionEnabled,
			snapshotMatchesSource,
			snapshotPhase != .disabled
		else { return .settingUp }
		return .active
	}
}

// PhotoKit reports network failures through NSURLErrorDomain. Only errors that
// mean the destination is temporarily unreachable belong in the automatic
// recovery loop; trust, authentication, server, and data errors need their own
// handling and must never be hidden as ordinary time away from home.
public enum PhotoBackupTransportFailure {
	public static func isConnectivityFailure(_ error: Error?) -> Bool {
		guard let error else { return false }
		let nsError = error as NSError
		guard nsError.domain == NSURLErrorDomain else { return false }
		switch URLError.Code(rawValue: nsError.code) {
		case .timedOut,
			.cannotFindHost,
			.cannotConnectToHost,
			.networkConnectionLost,
			.dnsLookupFailed,
			.notConnectedToInternet,
			.internationalRoamingOff,
			.callIsActive,
			.dataNotAllowed,
			.cannotLoadFromNetwork,
			.backgroundSessionWasDisconnected:
			return true
		default:
			return false
		}
	}
}

public enum PhotoBackupStorageProbeOutcome: Equatable, Sendable {
	case succeeded
	case connectivityFailure
	case insufficientStorage
	case permanentFailure
}

// PhotoKit may terminate an extension pass at any point and activate it again
// later. Keep the small amount of source-level recovery state derivable from the
// persisted snapshot so a fresh process cannot accidentally reopen the full job
// queue while the upload destination is unavailable.
public struct PhotoBackupRecoveryState: Equatable, Sendable {
	public private(set) var storageRetryRequested: Bool
	public private(set) var storageProbing: Bool
	public private(set) var storagePaused: Bool
	public private(set) var connectivityRecovering: Bool

	public init(
		snapshot: PhotoBackupSnapshot,
		sourceId: String,
		storageRetryRequested: Bool
	) {
		let belongsToSource = snapshot.sourceId == sourceId
		let validStorageRetry = belongsToSource
			&& storageRetryRequested
			&& (snapshot.issue == .insufficientStorage
				|| snapshot.phase == .checkingStorage
				|| snapshot.phase == .waitingForUmbrel)
		self.storageRetryRequested = validStorageRetry
		self.storageProbing = validStorageRetry
			&& (snapshot.phase == .checkingStorage || snapshot.phase == .waitingForUmbrel)
		self.storagePaused = belongsToSource
			&& snapshot.issue == .insufficientStorage
			&& !self.storageProbing
		self.connectivityRecovering = belongsToSource
			&& snapshot.phase == .waitingForUmbrel
			&& !self.storagePaused
	}

	public var phase: PhotoBackupPhase {
		if storagePaused { return .needsAttention }
		if connectivityRecovering { return .waitingForUmbrel }
		if storageProbing { return .checkingStorage }
		return .waiting
	}

	public var issue: PhotoBackupIssue? {
		guard !connectivityRecovering else { return nil }
		return storagePaused || storageProbing ? .insufficientStorage : nil
	}

	public mutating func observeTerminalBatch(
		foundStorageFailure: Bool,
		foundConnectivityFailure: Bool,
		hasTerminalJobs: Bool
	) {
		if foundStorageFailure {
			storagePaused = true
			connectivityRecovering = false
		} else if foundConnectivityFailure {
			// A batch can straddle a route change. Even if an earlier job succeeded,
			// any connection failure means reopening the whole queue is premature.
			connectivityRecovering = true
		} else if hasTerminalJobs {
			// A clean terminal result means the destination answered. Successes and
			// permanent server/auth failures have their own handling outside the
			// connectivity recovery loop.
			connectivityRecovering = false
		}
	}

	public mutating func finishStorageProbe(_ outcome: PhotoBackupStorageProbeOutcome) {
		guard storageProbing else { return }
		switch outcome {
		case .succeeded:
			storageRetryRequested = false
			storageProbing = false
			storagePaused = false
			connectivityRecovering = false
		case .connectivityFailure:
			// Being away from the Umbrel doesn't answer the storage question. Keep
			// the one-resource capacity probe alive for a later system activation.
			connectivityRecovering = true
		case .insufficientStorage:
			storageRetryRequested = false
			storageProbing = false
			storagePaused = true
			connectivityRecovering = false
		case .permanentFailure:
			// Authentication and server failures are not evidence that storage is
			// still full. End the probe so the ordinary failed-resource state is shown.
			storageRetryRequested = false
			storageProbing = false
			storagePaused = false
			connectivityRecovering = false
		}
	}

	public mutating func beginStorageProbe() {
		guard storagePaused, storageRetryRequested else { return }
		storagePaused = false
		storageProbing = true
		connectivityRecovering = false
	}

	public mutating func finishStorageProbeWithoutWork() {
		guard storageProbing else { return }
		storageRetryRequested = false
		storageProbing = false
		storagePaused = false
		connectivityRecovering = false
	}

	public mutating func finishConnectivityRecoveryWithoutWork() {
		connectivityRecovering = false
	}
}

// A small, stable issue code shared by the extension and host app. PhotoKit
// sanitizes upload errors, so classify only signals Apple documents preserving:
// normalized response headers and standard URL-loading error codes.
public enum PhotoBackupIssue: String, Codable, Equatable, Sendable {
	case insufficientStorage
	case authenticationRequired

	public init?(responseHeaderFields: [String: String]?) {
		guard responseHeaderFields?["x-umbrel-photo-backup-error"] == "insufficient-storage" else {
			return nil
		}
		self = .insufficientStorage
	}

	public init?(uploadError: Error?) {
		guard let error = uploadError as? URLError,
			error.code == .userAuthenticationRequired
		else { return nil }
		self = .authenticationRequired
	}
}

// Compact, durable presentation totals maintained by the background extension's
// incremental ledger. The host app reads these instead of walking the PhotoKit
// library whenever it needs to render backup status.
public struct PhotoBackupStatistics: Codable, Equatable, Sendable {
	public let queuedCount: Int
	public let preparedCount: Int
	public let uploadedPhotoCount: Int
	public let uploadedVideoCount: Int
	public let failedCount: Int
	public let uploadedBytes: Int64
	// When the most recent asset finished uploading. Optional so snapshots written
	// before it existed still decode.
	public let lastUploadedAt: Date?

	public var uploadedCount: Int { uploadedPhotoCount + uploadedVideoCount }

	public func remainingCount(
		photoCount: Int,
		videoCount: Int,
		includePhotos: Bool,
		includeVideos: Bool
	) -> Int {
		let included = (includePhotos ? photoCount : 0) + (includeVideos ? videoCount : 0)
		let uploaded = (includePhotos ? uploadedPhotoCount : 0)
			+ (includeVideos ? uploadedVideoCount : 0)
		// The extension inventories a large library in bounded batches. Assets it
		// hasn't reached yet are correctly remaining because they are present in
		// PhotoKit's count but not in the ledger's uploaded count.
		return max(0, included - uploaded)
	}

	// Failed uploads count as remaining work while anything else is still waiting,
	// because the extension retries them once the rest have caught up.
	public func onlyFailuresRemain(remainingCount: Int) -> Bool {
		failedCount > 0 && remainingCount <= failedCount
	}

	public init(
		queuedCount: Int,
		preparedCount: Int,
		uploadedPhotoCount: Int,
		uploadedVideoCount: Int,
		failedCount: Int,
		uploadedBytes: Int64,
		lastUploadedAt: Date? = nil
	) {
		self.queuedCount = queuedCount
		self.preparedCount = preparedCount
		self.uploadedPhotoCount = uploadedPhotoCount
		self.uploadedVideoCount = uploadedVideoCount
		self.failedCount = failedCount
		self.uploadedBytes = uploadedBytes
		self.lastUploadedAt = lastUploadedAt
	}
}

public struct PhotoBackupSnapshot: Codable, Equatable, Sendable {
	public var phase: PhotoBackupPhase
	public var issue: PhotoBackupIssue?
	public var lastError: String?
	public var updatedAt: Date
	public var sourceId: String?
	public var statistics: PhotoBackupStatistics?

	public init(
		phase: PhotoBackupPhase,
		issue: PhotoBackupIssue? = nil,
		lastError: String? = nil,
		updatedAt: Date = Date(),
		sourceId: String? = nil,
		statistics: PhotoBackupStatistics? = nil
	) {
		self.phase = phase
		self.issue = issue
		self.lastError = lastError
		self.updatedAt = updatedAt
		self.sourceId = sourceId
		self.statistics = statistics
	}

	public static let disabled = PhotoBackupSnapshot(phase: .disabled)
}

public struct PhotoBackupLibraryAsset: Equatable, Sendable {
	public let localIdentifier: String
	public let mediaType: Int64

	public init(localIdentifier: String, mediaType: Int64) {
		self.localIdentifier = localIdentifier
		self.mediaType = mediaType
	}
}

// Whole-library truth for presentation. Change ingestion owns revision state in
// the durable ledger. Do not independently compare PHAsset.modificationDate here:
// PhotoKit also advances that timestamp for metadata-only changes, so treating it
// as a content version would make an uploaded asset appear pending.
public struct PhotoBackupCoverage: Equatable, Sendable {
	public let includedCount: Int
	public let remainingCount: Int
	public let failedCount: Int
	public let backedUpPhotoCount: Int
	public let backedUpVideoCount: Int
	public let backedUpBytes: Int64

	public static let empty = PhotoBackupCoverage(
		includedCount: 0,
		remainingCount: 0,
		failedCount: 0,
		backedUpPhotoCount: 0,
		backedUpVideoCount: 0,
		backedUpBytes: 0
	)

	public static func calculate(
		assets: some Sequence<PhotoBackupLibraryAsset>,
		records: [String: PhotoBackupLedger.AssetRecord],
		includePhotos: Bool,
		includeVideos: Bool
	) -> PhotoBackupCoverage {
		var included = 0
		var remaining = 0
		var failed = 0
		var backedUpPhotos = 0
		var backedUpVideos = 0
		var backedUpBytes: Int64 = 0
		for asset in assets {
			let currentRecord = records[asset.localIdentifier]
			if let currentRecord, currentRecord.state == .uploaded {
				if asset.mediaType == 2 {
					backedUpVideos += 1
				} else {
					backedUpPhotos += 1
				}
				let bytes = max(0, currentRecord.uploadedBytes)
				let (sum, overflowed) = backedUpBytes.addingReportingOverflow(bytes)
				backedUpBytes = overflowed ? .max : sum
			}

			let isIncluded = asset.mediaType == 2 ? includeVideos : includePhotos
			guard isIncluded else { continue }
			included += 1
			guard let currentRecord else {
				remaining += 1
				continue
			}
			switch currentRecord.state {
			case .uploaded:
				break
			case .prepared:
				remaining += 1
			case .failed:
				remaining += 1
				failed += 1
			case .pending, .deleted:
				remaining += 1
			}
		}
		return PhotoBackupCoverage(
			includedCount: included,
			remainingCount: remaining,
			failedCount: failed,
			backedUpPhotoCount: backedUpPhotos,
			backedUpVideoCount: backedUpVideos,
			backedUpBytes: backedUpBytes
		)
	}

}

public enum PhotoBackupStore {
	public enum ConfigurationRead {
		case found(PhotoBackupConfiguration)
		case missing
		case unavailable
	}

	#if DEBUG
	public static let appGroupIdentifier = "group.com.umbrel.app.dev"
	#else
	public static let appGroupIdentifier = "group.com.umbrel.app.photos"
	#endif

	private static let configurationFile = "configuration.json"
	private static let snapshotFile = "snapshot.json"
	private static let storageRetryFile = "storage-retry.json"
	private static let recoveryRetryFile = "recovery-retry.json"

	private static let sharedFiles: PhotoBackupSharedFiles? = {
		guard let container = FileManager.default
			.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier)
		else { return nil }
		let directory = container.appendingPathComponent(
			"Library/Application Support/Umbrel",
			isDirectory: true
		)
		do {
			try prepareStorageDirectory(at: directory)
			return PhotoBackupSharedFiles(directory: directory)
		} catch {
			return nil
		}
	}()

	public static func save(configuration: PhotoBackupConfiguration) -> Bool {
		guard configuration.hasValidRoute,
			let sharedFiles
		else { return false }
		return sharedFiles.write(configuration, to: configurationFile)
	}

	public static func configuration() -> PhotoBackupConfiguration? {
		guard case .found(let configuration) = configurationRead() else { return nil }
		return configuration
	}

	public static func configurationRead() -> ConfigurationRead {
		guard let sharedFiles else { return .unavailable }
		switch sharedFiles.readResult(PhotoBackupConfiguration.self, from: configurationFile) {
		case .found(let configuration):
			return .found(configuration)
		case .missing:
			return .missing
		case .unavailable:
			return .unavailable
		}
	}

	public static var snapshot: PhotoBackupSnapshot {
		sharedFiles?.read(PhotoBackupSnapshot.self, from: snapshotFile) ?? .disabled
	}

	public static func publish(_ snapshot: PhotoBackupSnapshot) {
		sharedFiles?.write(snapshot, to: snapshotFile)
	}

	// A one-shot host-app signal. The extension consumes it only after it has
	// successfully requeued failed resources, keeping all queue mutation inside the
	// process that owns PhotoKit's upload-job state machine.
	public static func requestStorageRetry(sourceId: String) -> Bool {
		sharedFiles?.write(sourceId, to: storageRetryFile) ?? false
	}

	public static func storageRetryRequested(for sourceId: String) -> Bool {
		sharedFiles?.read(String.self, from: storageRetryFile) == sourceId
	}

	public static func clearStorageRetryRequest() {
		sharedFiles?.remove(storageRetryFile)
	}

	// The host app can restart PhotoKit, but the extension exclusively owns queue
	// mutation. Persist one source-scoped request so the next extension invocation
	// acknowledges terminal jobs before returning their failed resources to pending.
	public static func requestRecoveryRetry(sourceId: String) -> Bool {
		sharedFiles?.write(sourceId, to: recoveryRetryFile) ?? false
	}

	public static func recoveryRetryRequested(for sourceId: String) -> Bool {
		sharedFiles?.read(String.self, from: recoveryRetryFile) == sourceId
	}

	public static func clearRecoveryRetryRequest(for sourceId: String) {
		sharedFiles?.remove(recoveryRetryFile, ifEqualTo: sourceId)
	}

	public static func clearConfiguration() {
		sharedFiles?.remove(configurationFile)
		clearStorageRetryRequest()
		sharedFiles?.remove(recoveryRetryFile)
		// Disabling uploads must not make completed backup history disappear. Keep
		// the source-scoped totals; callers only render them for the matching account
		// and source id.
		let previous = snapshot
		publish(PhotoBackupSnapshot(
			phase: .disabled,
			updatedAt: Date(),
			sourceId: previous.sourceId,
			statistics: previous.statistics
		))
	}

	public static var ledgerURL: URL? {
		sharedFiles?.directory.appendingPathComponent("photo-backup.sqlite")
	}

	// The ledger must survive cache pressure because it is PhotoKit's durable upload
	// queue, so it belongs in Application Support rather than Caches. It is nevertheless
	// reproducible from the photo library and Umbrel, and restoring it on another iPhone
	// would preserve device-specific PhotoKit identifiers. Exclude the whole directory
	// from device backups while keeping it durable for the lifetime of this installation.
	static func prepareStorageDirectory(at directory: URL) throws {
		try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
		var values = URLResourceValues()
		values.isExcludedFromBackup = true
		var mutableDirectory = directory
		try mutableDirectory.setResourceValues(values)
	}

}
