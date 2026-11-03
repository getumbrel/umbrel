import Foundation
import SQLite3

// Cross-process source of truth for PhotoKit background uploads. Both the app and
// extension open this database from their App Group. WAL plus SQLite transactions
// make every receipt durable before PhotoKit is told to forget its terminal job.
public final class PhotoBackupLedger {
	public enum ReceiptError: Swift.Error, Equatable {
		case invalidByteCount
	}

	// Another process finished or restarted the library inventory this one was adding to
	public enum InventoryScanError: Swift.Error, Equatable {
		case superseded
	}

	public enum AssetState: Int64, Equatable, Sendable {
		case pending = 0
		case prepared = 1
		case uploaded = 2
		case failed = 3
		case deleted = 4
	}

	public struct DatabaseError: Swift.Error, LocalizedError, Equatable {
		public let code: Int32
		public let message: String
		public var errorDescription: String? { "Photo backup database error (\(code)): \(message)" }
	}

	public struct AssetCandidate: Equatable, Sendable {
		public let localIdentifier: String
		public let mediaType: Int64
		public let creationDate: Date
		public let modificationDate: Date

		public init(localIdentifier: String, mediaType: Int64, creationDate: Date, modificationDate: Date) {
			self.localIdentifier = localIdentifier
			self.mediaType = mediaType
			self.creationDate = creationDate
			self.modificationDate = modificationDate
		}
	}

	public struct AssetWork: Equatable, Sendable {
		public let localIdentifier: String
		public let mediaType: Int64
		public let revision: Int64
		public let creationDate: Date
		public let contentVersionDate: Date
	}

	public struct AssetRecord: Equatable, Sendable {
		public let state: AssetState
		public let modificationDate: Date
		public let uploadedBytes: Int64
	}

	// One page of a walk over the ledger's assets, and where the next page starts
	public struct AssetWorkPage: Equatable, Sendable {
		public let assets: [AssetWork]
		public let nextRow: Int64?
	}

	public struct InventoryScan: Equatable, Sendable {
		public let generation: Int64
		public let changeToken: Data
	}

	public struct ResourcePlan: Equatable, Sendable {
		public let resourceKey: String
		public let filename: String
		public let destinationPath: String

		public init(resourceKey: String, filename: String, destinationPath: String) {
			self.resourceKey = resourceKey
			self.filename = filename
			self.destinationPath = destinationPath
		}
	}

	public struct ResourceWork: Equatable, Sendable {
		public let resourceKey: String
		public let filename: String
		public let destinationPath: String
		public let state: Int64
	}

	public struct ResourceReceiptQuery: Equatable, Sendable {
		public let resourceKey: String
		public let fileExtension: String
	}

	public struct ResourceReceipt: Equatable, Sendable {
		public let resourceKey: String
		public let bytes: Int64

		public init(resourceKey: String, bytes: Int64) {
			self.resourceKey = resourceKey
			self.bytes = bytes
		}
	}

	public static let assetPending: Int64 = 0
	public static let assetPrepared: Int64 = 1
	public static let assetUploaded: Int64 = 2
	public static let assetFailed: Int64 = 3
	public static let assetDeleted: Int64 = 4

	public static let resourcePending: Int64 = 0
	public static let resourceRegistered: Int64 = 1
	public static let resourceSucceeded: Int64 = 2
	public static let resourceFailed: Int64 = 3
	// No PhotoKit resource produced by an iOS device can plausibly approach one
	// tebibyte. Reject larger server-controlled receipts before they reach SQLite.
	public static let maximumResourceBytes: Int64 = 1_024 * 1_024 * 1_024 * 1_024

	public static func isValidResourceByteCount(_ bytes: Int64) -> Bool {
		bytes > 0 && bytes <= maximumResourceBytes
	}

	private static let changeTokenKey = "photoLibraryChangeToken"
	private static let automaticRetryProgressKey = "automaticRetryUploadedCount"
	private static let schemaVersion: Int64 = 2
	private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
	private let queue = DispatchQueue(label: "com.umbrel.app.photo-backup-ledger")
	private var db: OpaquePointer?
	private let stopLock = NSLock()
	private var stopped = false

	public init?(url: URL) {
		do {
			try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
		} catch {
			return nil
		}

		var connection: OpaquePointer?
		let result = sqlite3_open_v2(
			url.path,
			&connection,
			SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX,
			nil
		)
		guard result == SQLITE_OK, let connection else {
			if let connection { sqlite3_close(connection) }
			return nil
		}
		db = connection

		do {
			try execute("PRAGMA busy_timeout = 5000")
			let openedVersion = try integer("PRAGMA user_version")
			try validateSchemaVersion(openedVersion)
			if openedVersion == 0 {
				try enableWAL()
			}
			try transaction {
				let storedVersion = try integer("PRAGMA user_version")
				try validateSchemaVersion(storedVersion)
				if storedVersion == 0 {
					try createSchema()
					try execute("PRAGMA user_version = \(Self.schemaVersion)")
				}
			}
		} catch {
			sqlite3_close(connection)
			db = nil
			return nil
		}
	}

	deinit {
		if let db { sqlite3_close(db) }
	}

	// iOS terminates an app it suspends while the app holds a lock on this shared
	// database (0xdead10cc), and it suspends the app as soon as its background time
	// ends. This ends the statement in flight, which rolls back its transaction,
	// closes the connection and refuses all later work, so once it returns the app
	// can be suspended. Safe to call from any thread except from inside a ledger call.
	public func stop() {
		let first = stopLock.withLock {
			defer { stopped = true }
			return !stopped
		}
		guard first else { return }
		let closed = DispatchSemaphore(value: 0)
		queue.async {
			// Closing the last connection to a WAL database copies the log into it under
			// an exclusive lock, unless the connection is interrupted
			self.stopLock.withLock {
				guard let db = self.db else { return }
				sqlite3_interrupt(db)
				sqlite3_close_v2(db)
				self.db = nil
			}
			closed.signal()
		}
		// SQLite forgets an interrupt that lands before a statement's first step, so it's
		// repeated until the call in flight unwinds. One waiting on another process's
		// lock may only notice at its busy timeout, so this gives up after a while.
		let deadline = DispatchTime.now() + 2
		repeat {
			stopLock.withLock {
				if let db { sqlite3_interrupt(db) }
			}
		} while closed.wait(timeout: .now() + .milliseconds(10)) == .timedOut && DispatchTime.now() < deadline
	}

	public var isStopped: Bool {
		stopLock.withLock { stopped }
	}

	private func checkNotStopped() throws {
		guard !isStopped else {
			throw DatabaseError(code: SQLITE_INTERRUPT, message: "The photo backup ledger was stopped")
		}
	}

	private func createSchema() throws {
		try execute(
			"""
			CREATE TABLE IF NOT EXISTS photo_assets (
				deviceId TEXT NOT NULL,
				localIdentifier TEXT NOT NULL,
				mediaType INTEGER NOT NULL,
				revision INTEGER NOT NULL DEFAULT 1,
				state INTEGER NOT NULL,
				creationDate REAL NOT NULL,
				modificationDate REAL NOT NULL,
				contentVersionDate REAL NOT NULL,
				inventoryGeneration INTEGER NOT NULL DEFAULT 0,
				expectedResources INTEGER NOT NULL DEFAULT 0,
				uploadedBytes INTEGER NOT NULL DEFAULT 0,
				uploadedAt REAL,
				lastError TEXT,
				PRIMARY KEY (deviceId, localIdentifier)
			)
			""")
		try execute(
			"""
			CREATE TABLE IF NOT EXISTS photo_resources (
				resourceKey TEXT PRIMARY KEY,
				deviceId TEXT NOT NULL,
				localIdentifier TEXT NOT NULL,
				revision INTEGER NOT NULL,
				filename TEXT NOT NULL,
				destinationPath TEXT NOT NULL,
				state INTEGER NOT NULL,
				bytes INTEGER NOT NULL DEFAULT 0,
				lastError TEXT
			)
			""")
		try execute(
			"CREATE INDEX IF NOT EXISTS photo_resources_asset ON photo_resources (deviceId, localIdentifier, revision)")
		try execute(
			"""
			CREATE INDEX IF NOT EXISTS photo_assets_work
			ON photo_assets (deviceId, creationDate DESC, mediaType)
			WHERE state IN (\(Self.assetPending), \(Self.assetPrepared))
			""")
		try execute(
			"""
			CREATE TABLE IF NOT EXISTS photo_inventory_scans (
				deviceId TEXT PRIMARY KEY,
				generation INTEGER NOT NULL,
				changeToken BLOB NOT NULL
			)
			""")
		try execute(
			"""
			CREATE TABLE IF NOT EXISTS photo_metadata (
				deviceId TEXT NOT NULL,
				key TEXT NOT NULL,
				value BLOB NOT NULL,
				PRIMARY KEY (deviceId, key)
			)
			""")
	}

	private func validateSchemaVersion(_ version: Int64) throws {
		guard version == 0 || version == Self.schemaVersion else {
			// The app and PhotoKit extension share this durable ledger. Refuse a
			// schema written by newer code instead of interpreting it incorrectly.
			throw DatabaseError(
				code: SQLITE_SCHEMA,
				message: "Unsupported photo backup schema version \(version)"
			)
		}
	}

	private func enableWAL() throws {
		// WAL is persistent, so only an unversioned database needs this transition.
		// Changing journal mode needs an exclusive lock and can bypass SQLite's busy
		// handler, so concurrent first opens retry this single initialization step.
		try setBusyTimeout(0)
		defer { _ = sqlite3_busy_timeout(db, 5_000) }
		for attempt in 0..<50 {
			do {
				let mode = try text("PRAGMA journal_mode = WAL")
				guard mode.lowercased() == "wal" else {
					throw DatabaseError(code: SQLITE_ERROR, message: "Could not enable WAL journaling")
				}
				return
			} catch let error as DatabaseError
				where (error.code == SQLITE_BUSY || error.code == SQLITE_LOCKED) && attempt < 49
			{
				sqlite3_sleep(10)
			}
		}
	}

	public func seedInventory(_ candidates: [AssetCandidate], deviceId: String, changeToken: Data) throws {
		try queue.sync {
			try transaction {
				let generation = try nextInventoryGenerationLocked(deviceId: deviceId)
				for candidate in candidates {
					try seedCandidateLocked(candidate, deviceId: deviceId, inventoryGeneration: generation)
				}
				let missing = try prepare(
					"""
					UPDATE photo_assets SET state = ?, lastError = NULL
					WHERE deviceId = ? AND inventoryGeneration != ?
					""")
				defer { sqlite3_finalize(missing) }
				try bind(Self.assetDeleted, at: 1, in: missing)
				try bind(deviceId, at: 2, in: missing)
				try bind(generation, at: 3, in: missing)
				try stepDone(missing)
				try setMetadataLocked(changeToken, key: Self.changeTokenKey, deviceId: deviceId)
			}
		}
	}

	// Full-library inventory is durably checkpointed and may span extension
	// activations when PhotoKit requests termination. The token is captured before
	// the first batch and committed only after the last; persistent history then
	// covers every mutation that raced the scan.
	public func startInventoryScan(deviceId: String, changeToken: Data) throws -> InventoryScan {
		try queue.sync {
			if let existing = try inventoryScanLocked(deviceId: deviceId) { return existing }
			return try transaction {
				let generation = try nextInventoryGenerationLocked(deviceId: deviceId)
				let statement = try prepare(
					"INSERT INTO photo_inventory_scans (deviceId, generation, changeToken) VALUES (?, ?, ?)")
				defer { sqlite3_finalize(statement) }
				try bind(deviceId, at: 1, in: statement)
				try bind(generation, at: 2, in: statement)
				try bind(changeToken, at: 3, in: statement)
				try stepDone(statement)
				return InventoryScan(generation: generation, changeToken: changeToken)
			}
		}
	}

	@discardableResult
	public func recordInventoryBatch(
		_ candidates: [AssetCandidate],
		deviceId: String,
		generation: Int64
	) throws -> Int {
		guard !candidates.isEmpty else { return 0 }
		return try queue.sync {
			try transaction {
				guard try inventoryScanLocked(deviceId: deviceId)?.generation == generation else {
					throw InventoryScanError.superseded
				}
				// A resumed scan re-enumerates PhotoKit from the beginning because the
				// framework has no durable cursor whose ordering remains valid while the
				// library changes. Filter only this bounded caller-supplied batch instead
				// of materializing every scanned identifier in memory.
				let scanned = try inventoryScannedIdentifiersLocked(
					from: candidates.map(\.localIdentifier),
					deviceId: deviceId,
					generation: generation
				)
				let unscanned = candidates.filter { !scanned.contains($0.localIdentifier) }
				for candidate in unscanned {
					try seedCandidateLocked(candidate, deviceId: deviceId, inventoryGeneration: generation)
				}
				return unscanned.count
			}
		}
	}

	public func finishInventoryScan(deviceId: String, generation: Int64) throws {
		try queue.sync {
			try transaction {
				guard let scan = try inventoryScanLocked(deviceId: deviceId), scan.generation == generation else {
					throw InventoryScanError.superseded
				}
				let missing = try prepare(
					"UPDATE photo_assets SET state = ?, lastError = NULL WHERE deviceId = ? AND inventoryGeneration != ?")
				defer { sqlite3_finalize(missing) }
				try bind(Self.assetDeleted, at: 1, in: missing)
				try bind(deviceId, at: 2, in: missing)
				try bind(generation, at: 3, in: missing)
				try stepDone(missing)
				try setMetadataLocked(scan.changeToken, key: Self.changeTokenKey, deviceId: deviceId)
				try deleteInventoryScanLocked(deviceId: deviceId)
			}
		}
	}

	public func applyChanges(
		inserted: [AssetCandidate],
		updated: [AssetCandidate],
		deleted: Set<String>,
		deviceId: String,
		changeToken: Data
	) throws {
		try queue.sync {
			try transaction {
				for candidate in inserted { try seedCandidateLocked(candidate, deviceId: deviceId) }
				// Persistent history doesn't distinguish content from metadata updates.
				// Requeue a newer unknown update to avoid missing an edit. When the host
				// observed the same update live, its richer object-change details already
				// advanced metadata-only watermarks and make this replay a no-op.
				for candidate in updated { try seedCandidateLocked(candidate, deviceId: deviceId) }
				for identifier in deleted { try markDeletedLocked(deviceId: deviceId, localIdentifier: identifier) }
				try setMetadataLocked(changeToken, key: Self.changeTokenKey, deviceId: deviceId)
			}
		}
	}

	// The host app receives richer PHPhotoLibraryChangeObserver callbacks while it
	// is running. PhotoKit distinguishes actual asset-content changes from metadata
	// changes there, but persistent history only exposes a generic "updated" set.
	// Advance metadata timestamps without invalidating an uploaded receipt so the
	// extension's later persistent-history replay sees the same watermark and does
	// not turn an iCloud metadata reconciliation into a duplicate upload.
	@discardableResult
	public func recordObservedChanges(
		inserted: [AssetCandidate],
		contentChanged: [AssetCandidate],
		metadataChanged: [AssetCandidate],
		deviceId: String
	) throws -> Bool {
		guard !inserted.isEmpty || !contentChanged.isEmpty || !metadataChanged.isEmpty else { return false }
		return try queue.sync {
			try transaction {
				var backupChanged = false
				for candidate in inserted + contentChanged {
					if try seedCandidateLocked(candidate, deviceId: deviceId) {
						backupChanged = true
					}
				}
				for candidate in metadataChanged {
					if try recordMetadataChangeLocked(candidate, deviceId: deviceId) {
						backupChanged = true
					}
				}
				return backupChanged
			}
		}
	}

	public func changeToken(deviceId: String) throws -> Data? {
		try queue.sync { try metadataLocked(key: Self.changeTokenKey, deviceId: deviceId) }
	}

	public func clearChangeToken(deviceId: String) throws {
		try queue.sync {
			try transaction {
				let statement = try prepare("DELETE FROM photo_metadata WHERE deviceId = ? AND key = ?")
				defer { sqlite3_finalize(statement) }
				try bind(deviceId, at: 1, in: statement)
				try bind(Self.changeTokenKey, at: 2, in: statement)
				try stepDone(statement)
				try deleteInventoryScanLocked(deviceId: deviceId)
			}
		}
	}

	public func nextAssets(
		deviceId: String,
		includePhotos: Bool,
		includeVideos: Bool,
		limit: Int
	) throws -> [AssetWork] {
		guard includePhotos || includeVideos, limit > 0 else { return [] }
		return try queue.sync {
			var mediaTypes = [Int64]()
			if includePhotos { mediaTypes.append(1) }
			if includeVideos { mediaTypes.append(2) }
			let placeholders = mediaTypes.map { _ in "?" }.joined(separator: ",")
			let statement = try prepare(
				"""
				SELECT asset.localIdentifier, asset.mediaType, asset.revision,
					asset.creationDate, asset.contentVersionDate
				FROM photo_assets AS asset
				WHERE asset.deviceId = ?
					AND asset.mediaType IN (\(placeholders))
					-- Keep this explicit so SQLite can use photo_assets_work instead of
					-- scanning and sorting the full uploaded library on every refill.
					AND asset.state IN (\(Self.assetPending), \(Self.assetPrepared))
					AND (
						asset.state = ?
						OR (
							asset.state = ?
							AND EXISTS (
								SELECT 1 FROM photo_resources AS resource
								WHERE resource.deviceId = asset.deviceId
									AND resource.localIdentifier = asset.localIdentifier
									AND resource.revision = asset.revision
									AND resource.state = ?
							)
						)
					)
				ORDER BY asset.creationDate DESC
				LIMIT ?
				""")
			defer { sqlite3_finalize(statement) }
			var index: Int32 = 1
			try bind(deviceId, at: index, in: statement)
			index += 1
			for mediaType in mediaTypes {
				try bind(mediaType, at: index, in: statement)
				index += 1
			}
			try bind(Self.assetPending, at: index, in: statement)
			index += 1
			try bind(Self.assetPrepared, at: index, in: statement)
			index += 1
			try bind(Self.resourcePending, at: index, in: statement)
			index += 1
			try bind(Int64(limit), at: index, in: statement)

			var assets = [AssetWork]()
			while true {
				switch sqlite3_step(statement) {
				case SQLITE_ROW:
					assets.append(
						AssetWork(
							localIdentifier: try requiredText(at: 0, in: statement),
							mediaType: sqlite3_column_int64(statement, 1),
							revision: sqlite3_column_int64(statement, 2),
							creationDate: Date(timeIntervalSince1970: sqlite3_column_double(statement, 3)),
							contentVersionDate: Date(timeIntervalSince1970: sqlite3_column_double(statement, 4))
						))
				case SQLITE_DONE:
					return assets
				case let result:
					throw databaseError(result)
				}
			}
		}
	}

	// Assets whose only unfinished resources are held by PhotoKit's background upload
	// jobs. The app sends these last, so opening it finishes the backup even while
	// those jobs wait for Tailscale.
	public func nextAssetsHeldByPhotoKit(
		deviceId: String,
		includePhotos: Bool,
		includeVideos: Bool,
		limit: Int
	) throws -> [AssetWork] {
		guard includePhotos || includeVideos, limit > 0 else { return [] }
		return try queue.sync {
			var mediaTypes = [Int64]()
			if includePhotos { mediaTypes.append(1) }
			if includeVideos { mediaTypes.append(2) }
			let placeholders = mediaTypes.map { _ in "?" }.joined(separator: ",")
			let statement = try prepare(
				"""
				SELECT asset.localIdentifier, asset.mediaType, asset.revision,
					asset.creationDate, asset.contentVersionDate
				FROM photo_assets AS asset
				WHERE asset.deviceId = ?
					AND asset.mediaType IN (\(placeholders))
					AND asset.state = ?
					AND EXISTS (
						SELECT 1 FROM photo_resources AS resource
						WHERE resource.deviceId = asset.deviceId
							AND resource.localIdentifier = asset.localIdentifier
							AND resource.revision = asset.revision
							AND resource.state = ?
					)
				ORDER BY asset.creationDate DESC
				LIMIT ?
				""")
			defer { sqlite3_finalize(statement) }
			var index: Int32 = 1
			try bind(deviceId, at: index, in: statement)
			index += 1
			for mediaType in mediaTypes {
				try bind(mediaType, at: index, in: statement)
				index += 1
			}
			try bind(Self.assetPrepared, at: index, in: statement)
			index += 1
			try bind(Self.resourceRegistered, at: index, in: statement)
			index += 1
			try bind(Int64(limit), at: index, in: statement)

			var assets = [AssetWork]()
			while true {
				switch sqlite3_step(statement) {
				case SQLITE_ROW:
					assets.append(
						AssetWork(
							localIdentifier: try requiredText(at: 0, in: statement),
							mediaType: sqlite3_column_int64(statement, 1),
							revision: sqlite3_column_int64(statement, 2),
							creationDate: Date(timeIntervalSince1970: sqlite3_column_double(statement, 3)),
							contentVersionDate: Date(timeIntervalSince1970: sqlite3_column_double(statement, 4))
						))
				case SQLITE_DONE:
					return assets
				case let result:
					throw databaseError(result)
				}
			}
		}
	}

	// The assets in these states, in the order they were recorded, a page at a time. Unlike
	// nextAssets, an asset a page left as it was doesn't come round again, so a pass that
	// can't finish every asset still visits each once.
	public func assetWork(
		deviceId: String,
		states: [AssetState],
		includePhotos: Bool,
		includeVideos: Bool,
		after row: Int64 = 0,
		limit: Int
	) throws -> AssetWorkPage {
		var mediaTypes = [Int64]()
		if includePhotos { mediaTypes.append(1) }
		if includeVideos { mediaTypes.append(2) }
		guard !mediaTypes.isEmpty, !states.isEmpty, limit > 0 else { return AssetWorkPage(assets: [], nextRow: nil) }
		return try queue.sync {
			let statePlaceholders = states.map { _ in "?" }.joined(separator: ",")
			let mediaPlaceholders = mediaTypes.map { _ in "?" }.joined(separator: ",")
			let statement = try prepare(
				"""
				SELECT rowid, localIdentifier, mediaType, revision, creationDate, contentVersionDate
				FROM photo_assets
				WHERE deviceId = ?
					AND rowid > ?
					AND state IN (\(statePlaceholders))
					AND mediaType IN (\(mediaPlaceholders))
				ORDER BY rowid
				LIMIT ?
				""")
			defer { sqlite3_finalize(statement) }
			var index: Int32 = 1
			try bind(deviceId, at: index, in: statement)
			index += 1
			try bind(row, at: index, in: statement)
			index += 1
			for state in states {
				try bind(state.rawValue, at: index, in: statement)
				index += 1
			}
			for mediaType in mediaTypes {
				try bind(mediaType, at: index, in: statement)
				index += 1
			}
			try bind(Int64(limit), at: index, in: statement)

			var assets = [AssetWork]()
			var lastRow: Int64?
			while true {
				switch sqlite3_step(statement) {
				case SQLITE_ROW:
					lastRow = sqlite3_column_int64(statement, 0)
					assets.append(
						AssetWork(
							localIdentifier: try requiredText(at: 1, in: statement),
							mediaType: sqlite3_column_int64(statement, 2),
							revision: sqlite3_column_int64(statement, 3),
							creationDate: Date(timeIntervalSince1970: sqlite3_column_double(statement, 4)),
							contentVersionDate: Date(timeIntervalSince1970: sqlite3_column_double(statement, 5))
						))
				case SQLITE_DONE:
					return AssetWorkPage(assets: assets, nextRow: assets.count == limit ? lastRow : nil)
				case let result:
					throw databaseError(result)
				}
			}
		}
	}

	public func prepareAsset(
		deviceId: String,
		localIdentifier: String,
		revision: Int64,
		resources: [ResourcePlan]
	) throws {
		try queue.sync {
			try transaction {
				let update = try prepare(
					"""
					UPDATE photo_assets
					SET state = ?, expectedResources = ?, lastError = NULL
					WHERE deviceId = ? AND localIdentifier = ? AND revision = ? AND state IN (?, ?)
					""")
				defer { sqlite3_finalize(update) }
				try bind(Self.assetPrepared, at: 1, in: update)
				try bind(Int64(resources.count), at: 2, in: update)
				try bind(deviceId, at: 3, in: update)
				try bind(localIdentifier, at: 4, in: update)
				try bind(revision, at: 5, in: update)
				try bind(Self.assetPending, at: 6, in: update)
				try bind(Self.assetPrepared, at: 7, in: update)
				try stepDone(update)
				guard sqlite3_changes(db) == 1 else { return }

				for resource in resources {
					let insert = try prepare(
						"""
						INSERT OR IGNORE INTO photo_resources
							(resourceKey, deviceId, localIdentifier, revision, filename, destinationPath, state)
						VALUES (?, ?, ?, ?, ?, ?, ?)
						""")
					defer { sqlite3_finalize(insert) }
					try bind(resource.resourceKey, at: 1, in: insert)
					try bind(deviceId, at: 2, in: insert)
					try bind(localIdentifier, at: 3, in: insert)
					try bind(revision, at: 4, in: insert)
					try bind(resource.filename, at: 5, in: insert)
					try bind(resource.destinationPath, at: 6, in: insert)
					try bind(Self.resourcePending, at: 7, in: insert)
					try stepDone(insert)
				}
			}
		}
	}

	public func resources(deviceId: String, localIdentifier: String, revision: Int64) throws -> [ResourceWork] {
		try queue.sync {
			let statement = try prepare(
				"""
				SELECT resourceKey, filename, destinationPath, state
				FROM photo_resources
				WHERE deviceId = ? AND localIdentifier = ? AND revision = ?
				ORDER BY rowid
				""")
			defer { sqlite3_finalize(statement) }
			try bind(deviceId, at: 1, in: statement)
			try bind(localIdentifier, at: 2, in: statement)
			try bind(revision, at: 3, in: statement)
			var resources = [ResourceWork]()
			while true {
				switch sqlite3_step(statement) {
				case SQLITE_ROW:
					resources.append(
						ResourceWork(
							resourceKey: try requiredText(at: 0, in: statement),
							filename: try requiredText(at: 1, in: statement),
							destinationPath: try requiredText(at: 2, in: statement),
							state: sqlite3_column_int64(statement, 3)
						))
				case SQLITE_DONE:
					return resources
				case let result:
					throw databaseError(result)
				}
			}
		}
	}

	// Only resources belonging to a prepared current revision can already be on the
	// server while the local ledger still lacks PhotoKit's terminal callback. Keeping
	// this query bounded makes foreground receipt reconciliation independent of the
	// size of the user's photo library.
	public func unconfirmedResourceReceipts(
		deviceId: String,
		includePhotos: Bool,
		includeVideos: Bool,
		limit: Int = 256
	) throws -> [ResourceReceiptQuery] {
		var mediaTypes = [Int64]()
		if includePhotos { mediaTypes.append(1) }
		if includeVideos { mediaTypes.append(2) }
		guard !mediaTypes.isEmpty, limit > 0 else { return [] }

		return try queue.sync {
			let placeholders = mediaTypes.map { _ in "?" }.joined(separator: ",")
			let statement = try prepare(
				"""
				SELECT resource.resourceKey, resource.destinationPath
				FROM photo_resources AS resource
				JOIN photo_assets AS asset
					ON asset.deviceId = resource.deviceId
					AND asset.localIdentifier = resource.localIdentifier
				WHERE resource.deviceId = ?
					AND resource.revision = asset.revision
					AND asset.state = ?
					AND resource.state != ?
					AND asset.mediaType IN (\(placeholders))
				ORDER BY asset.rowid, resource.rowid
				LIMIT ?
				""")
			defer { sqlite3_finalize(statement) }
			var index: Int32 = 1
			try bind(deviceId, at: index, in: statement)
			index += 1
			try bind(Self.assetPrepared, at: index, in: statement)
			index += 1
			try bind(Self.resourceSucceeded, at: index, in: statement)
			index += 1
			for mediaType in mediaTypes {
				try bind(mediaType, at: index, in: statement)
				index += 1
			}
			try bind(Int64(min(limit, 256)), at: index, in: statement)

			var resources = [ResourceReceiptQuery]()
			while true {
				switch sqlite3_step(statement) {
				case SQLITE_ROW:
					let destinationPath = try requiredText(at: 1, in: statement)
					let fileExtension = URL(fileURLWithPath: destinationPath).pathExtension.lowercased()
					guard !fileExtension.isEmpty else { continue }
					resources.append(ResourceReceiptQuery(
						resourceKey: try requiredText(at: 0, in: statement),
						fileExtension: fileExtension
					))
				case SQLITE_DONE:
					return resources
				case let result:
					throw databaseError(result)
				}
			}
		}
	}

	public func markResourcesRegistered(_ resourceKeys: Set<String>) throws {
		guard !resourceKeys.isEmpty else { return }
		try queue.sync {
			try transaction {
				for key in resourceKeys {
					let statement = try prepare(
						"UPDATE photo_resources SET state = ? WHERE resourceKey = ? AND state = ?")
					defer { sqlite3_finalize(statement) }
					try bind(Self.resourceRegistered, at: 1, in: statement)
					try bind(key, at: 2, in: statement)
					try bind(Self.resourcePending, at: 3, in: statement)
					try stepDone(statement)
				}
			}
		}
	}

	// Returns only jobs that still belong to the asset's current revision and an
	// enabled media type. The extension uses this before retrying or retaining a
	// PhotoKit job, so an edit or settings change cannot upload obsolete content.
	public func currentResourceKeys(
		from resourceKeys: Set<String>,
		deviceId: String,
		includePhotos: Bool,
		includeVideos: Bool
	) throws -> Set<String> {
		guard !resourceKeys.isEmpty else { return [] }
		var mediaTypes = [Int64]()
		if includePhotos { mediaTypes.append(1) }
		if includeVideos { mediaTypes.append(2) }
		guard !mediaTypes.isEmpty else { return [] }

		return try queue.sync {
			let placeholders = mediaTypes.map { _ in "?" }.joined(separator: ",")
			let statement = try prepare(
				"""
				SELECT 1
				FROM photo_resources AS resource
				JOIN photo_assets AS asset
					ON asset.deviceId = resource.deviceId
					AND asset.localIdentifier = resource.localIdentifier
				WHERE resource.resourceKey = ?
					AND resource.deviceId = ?
					AND resource.revision = asset.revision
					AND asset.state != ?
					AND asset.mediaType IN (\(placeholders))
				LIMIT 1
				""")
			defer { sqlite3_finalize(statement) }
			var current = Set<String>()
			for key in resourceKeys {
				sqlite3_reset(statement)
				sqlite3_clear_bindings(statement)
				try bind(key, at: 1, in: statement)
				try bind(deviceId, at: 2, in: statement)
				try bind(Self.assetDeleted, at: 3, in: statement)
				for (offset, mediaType) in mediaTypes.enumerated() {
					try bind(mediaType, at: Int32(4 + offset), in: statement)
				}
				let result = sqlite3_step(statement)
				if result == SQLITE_ROW {
					current.insert(key)
				} else if result != SQLITE_DONE {
					throw databaseError(result)
				}
			}
			return current
		}
	}

	public func releaseRegisteredResources(_ resourceKeys: Set<String>) throws {
		guard !resourceKeys.isEmpty else { return }
		try queue.sync {
			try transaction {
				for key in resourceKeys {
					let statement = try prepare(
						"UPDATE photo_resources SET state = ? WHERE resourceKey = ? AND state = ?")
					defer { sqlite3_finalize(statement) }
					try bind(Self.resourcePending, at: 1, in: statement)
					try bind(key, at: 2, in: statement)
					try bind(Self.resourceRegistered, at: 3, in: statement)
					try stepDone(statement)
				}
			}
		}
	}

	// A registered ledger row without a processable PhotoKit job is an orphan
	// (for example after cancellation or a failed creation commit). Release it so
	// the same deterministic resource can be registered again.
	public func releaseOrphanedRegisteredResources(
		deviceId: String,
		activeResourceKeys: Set<String>,
		includePhotos: Bool,
		includeVideos: Bool
	) throws {
		var mediaTypes = [Int64]()
		if includePhotos { mediaTypes.append(1) }
		if includeVideos { mediaTypes.append(2) }
		guard !mediaTypes.isEmpty else { return }

		try queue.sync {
			let mediaPlaceholders = mediaTypes.map { _ in "?" }.joined(separator: ",")
			let activePlaceholders = activeResourceKeys.map { _ in "?" }.joined(separator: ",")
			let activeClause = activeResourceKeys.isEmpty
				? ""
				: "AND resource.resourceKey NOT IN (\(activePlaceholders))"
			let statement = try prepare(
				"""
				UPDATE photo_resources AS resource SET state = ?
				WHERE resource.state = ?
					AND resource.deviceId = ?
					AND EXISTS (
						SELECT 1 FROM photo_assets AS asset
						WHERE asset.deviceId = resource.deviceId
							AND asset.localIdentifier = resource.localIdentifier
							AND asset.revision = resource.revision
							AND asset.state != ?
							AND asset.mediaType IN (\(mediaPlaceholders))
					)
					\(activeClause)
				""")
			defer { sqlite3_finalize(statement) }
			var index: Int32 = 1
			try bind(Self.resourcePending, at: index, in: statement)
			index += 1
			try bind(Self.resourceRegistered, at: index, in: statement)
			index += 1
			try bind(deviceId, at: index, in: statement)
			index += 1
			try bind(Self.assetDeleted, at: index, in: statement)
			index += 1
			for mediaType in mediaTypes {
				try bind(mediaType, at: index, in: statement)
				index += 1
			}
			for key in activeResourceKeys.sorted() {
				try bind(key, at: index, in: statement)
				index += 1
			}
			try stepDone(statement)
		}
	}

	public func recordResourceSucceeded(resourceKey: String, bytes: Int64) throws {
		guard Self.isValidResourceByteCount(bytes) else { throw ReceiptError.invalidByteCount }
		try queue.sync {
			try transaction {
				try recordResourceSucceededLocked(
					resourceKey: resourceKey,
					bytes: bytes
				)
			}
		}
	}

	// A normal authenticated foreground request can observe the atomically promoted
	// server file before PhotoKit schedules the extension's acknowledgement pass.
	// Record that same receipt through the ledger's existing idempotent success path;
	// this never creates, retries, cancels, or acknowledges a PhotoKit job.
	public func recordConfirmedResources(_ receipts: [ResourceReceipt]) throws {
		guard !receipts.isEmpty else { return }
		guard receipts.allSatisfy({ Self.isValidResourceByteCount($0.bytes) }) else {
			throw ReceiptError.invalidByteCount
		}
		try queue.sync {
			try transaction {
				for receipt in receipts {
					try recordResourceSucceededLocked(
						resourceKey: receipt.resourceKey,
						bytes: receipt.bytes
					)
				}
			}
		}
	}

	public func succeededResourceKeys(from resourceKeys: Set<String>) throws -> Set<String> {
		guard !resourceKeys.isEmpty else { return [] }
		return try queue.sync {
			let statement = try prepare(
				"SELECT state FROM photo_resources WHERE resourceKey = ? LIMIT 1")
			defer { sqlite3_finalize(statement) }
			var succeeded = Set<String>()
			for key in resourceKeys {
				sqlite3_reset(statement)
				sqlite3_clear_bindings(statement)
				try bind(key, at: 1, in: statement)
				let result = sqlite3_step(statement)
				if result == SQLITE_ROW {
					if sqlite3_column_int64(statement, 0) == Self.resourceSucceeded {
						succeeded.insert(key)
					}
				} else if result != SQLITE_DONE {
					throw databaseError(result)
				}
			}
			return succeeded
		}
	}

	public func recordResourceFailed(resourceKey: String, message: String) throws {
		try queue.sync {
			try transaction {
				guard let owner = try resourceOwnerLocked(resourceKey: resourceKey) else { return }
				let update = try prepare(
					"UPDATE photo_resources SET state = ?, lastError = ? WHERE resourceKey = ? AND state != ?")
				defer { sqlite3_finalize(update) }
				try bind(Self.resourceFailed, at: 1, in: update)
				try bind(message, at: 2, in: update)
				try bind(resourceKey, at: 3, in: update)
				try bind(Self.resourceSucceeded, at: 4, in: update)
				try stepDone(update)
				try refreshAssetOutcomeLocked(owner: owner)
			}
		}
	}

	// A transport outage says nothing about the asset itself. Return only that
	// resource to the durable queue so a later PhotoKit activation can try again;
	// successful siblings of a Live Photo remain untouched.
	public func recordResourcePending(resourceKey: String) throws {
		try queue.sync {
			try transaction {
				guard let owner = try resourceOwnerLocked(resourceKey: resourceKey) else { return }
				let update = try prepare(
					"UPDATE photo_resources SET state = ?, lastError = NULL WHERE resourceKey = ? AND state != ?")
				defer { sqlite3_finalize(update) }
				try bind(Self.resourcePending, at: 1, in: update)
				try bind(resourceKey, at: 2, in: update)
				try bind(Self.resourceSucceeded, at: 3, in: update)
				try stepDone(update)
				try refreshAssetOutcomeLocked(owner: owner)
			}
		}
	}

	public func markAssetFailed(deviceId: String, localIdentifier: String, revision: Int64, message: String) throws {
		try queue.sync {
			let statement = try prepare(
				"""
				UPDATE photo_assets SET state = ?, lastError = ?
				WHERE deviceId = ? AND localIdentifier = ? AND revision = ?
				""")
			defer { sqlite3_finalize(statement) }
			try bind(Self.assetFailed, at: 1, in: statement)
			try bind(message, at: 2, in: statement)
			try bind(deviceId, at: 3, in: statement)
			try bind(localIdentifier, at: 4, in: statement)
			try bind(revision, at: 5, in: statement)
			try stepDone(statement)
		}
	}

	public func markDeleted(deviceId: String, localIdentifier: String) throws {
		try queue.sync { try markDeletedLocked(deviceId: deviceId, localIdentifier: localIdentifier) }
	}

	// Retries only the failed resources and keeps successful Live Photo siblings. Used by
	// Try Again, a backup configuration change and the storage probe; the extension's
	// automatic retry is requeueFailedAssetsAfterProgress.
	public func requeueFailedAssets(
		deviceId: String,
		includePhotos: Bool,
		includeVideos: Bool
	) throws {
		try queue.sync {
			try transaction {
				try requeueFailedAssetsLocked(
					deviceId: deviceId,
					includePhotos: includePhotos,
					includeVideos: includeVideos
				)
			}
		}
	}

	// Most failures are Umbrel answering an upload with a temporary server error,
	// and umbreld recognizes an exact retry without storing a second copy. Once only
	// failed resources remain, retry them once in the same pass. Remembering the
	// uploaded count at that retry means a resource that keeps failing is tried
	// again only after other backups have made progress, never in a loop.
	public func requeueFailedAssetsAfterProgress(
		deviceId: String,
		includePhotos: Bool,
		includeVideos: Bool
	) throws -> Bool {
		return try queue.sync {
			try transaction {
				let statistics = try statisticsLocked(
					deviceId: deviceId,
					includePhotos: includePhotos,
					includeVideos: includeVideos
				)
				guard statistics.failedCount > 0,
					statistics.queuedCount == 0,
					statistics.preparedCount == 0
				else { return false }
				let progress = Data(String(statistics.uploadedCount).utf8)
				guard try metadataLocked(key: Self.automaticRetryProgressKey, deviceId: deviceId) != progress else {
					return false
				}
				try requeueFailedAssetsLocked(
					deviceId: deviceId,
					includePhotos: includePhotos,
					includeVideos: includeVideos
				)
				try setMetadataLocked(progress, key: Self.automaticRetryProgressKey, deviceId: deviceId)
				return true
			}
		}
	}

	private func requeueFailedAssetsLocked(
		deviceId: String,
		includePhotos: Bool,
		includeVideos: Bool
	) throws {
		var mediaTypes = [Int64]()
		if includePhotos { mediaTypes.append(1) }
		if includeVideos { mediaTypes.append(2) }
		guard !mediaTypes.isEmpty else { return }

		let placeholders = mediaTypes.map { _ in "?" }.joined(separator: ",")
		let resources = try prepare(
			"""
			UPDATE photo_resources SET state = ?, lastError = NULL
			WHERE state = ? AND EXISTS (
				SELECT 1 FROM photo_assets
				WHERE photo_assets.deviceId = photo_resources.deviceId
					AND photo_assets.localIdentifier = photo_resources.localIdentifier
					AND photo_assets.revision = photo_resources.revision
					AND photo_assets.deviceId = ?
					AND photo_assets.state = ?
					AND photo_assets.mediaType IN (\(placeholders))
			)
			""")
		defer { sqlite3_finalize(resources) }
		try bind(Self.resourcePending, at: 1, in: resources)
		try bind(Self.resourceFailed, at: 2, in: resources)
		try bind(deviceId, at: 3, in: resources)
		try bind(Self.assetFailed, at: 4, in: resources)
		for (offset, mediaType) in mediaTypes.enumerated() {
			try bind(mediaType, at: Int32(5 + offset), in: resources)
		}
		try stepDone(resources)

		let assets = try prepare(
			"""
			UPDATE photo_assets SET state = ?, lastError = NULL
			WHERE deviceId = ? AND state = ? AND mediaType IN (\(placeholders))
			""")
		defer { sqlite3_finalize(assets) }
		try bind(Self.assetPending, at: 1, in: assets)
		try bind(deviceId, at: 2, in: assets)
		try bind(Self.assetFailed, at: 3, in: assets)
		for (offset, mediaType) in mediaTypes.enumerated() {
			try bind(mediaType, at: Int32(4 + offset), in: assets)
		}
		try stepDone(assets)
	}

	public func statistics(
		deviceId: String,
		includePhotos: Bool = true,
		includeVideos: Bool = true
	) throws -> PhotoBackupStatistics {
		try queue.sync {
			try statisticsLocked(deviceId: deviceId, includePhotos: includePhotos, includeVideos: includeVideos)
		}
	}

	private func statisticsLocked(
		deviceId: String,
		includePhotos: Bool,
		includeVideos: Bool
	) throws -> PhotoBackupStatistics {
		var enabledMediaTypes = [Int64]()
		if includePhotos { enabledMediaTypes.append(1) }
		if includeVideos { enabledMediaTypes.append(2) }
		let mediaPredicate = enabledMediaTypes.isEmpty
			? "0"
			: "mediaType IN (\(enabledMediaTypes.map { _ in "?" }.joined(separator: ",")))"
		let counts = try prepare(
			"""
			SELECT
				SUM(CASE WHEN state = ? AND \(mediaPredicate) THEN 1 ELSE 0 END),
				SUM(CASE WHEN state = ? AND \(mediaPredicate) THEN 1 ELSE 0 END),
				SUM(CASE WHEN state = ? AND mediaType = 1 THEN 1 ELSE 0 END),
				SUM(CASE WHEN state = ? AND mediaType = 2 THEN 1 ELSE 0 END),
				SUM(CASE WHEN state = ? AND \(mediaPredicate) THEN 1 ELSE 0 END),
				CAST(MIN(TOTAL(CASE WHEN state = ? THEN uploadedBytes ELSE 0 END), 9223372036854775807) AS INTEGER),
				MAX(CASE WHEN state = ? THEN uploadedAt END)
			FROM photo_assets WHERE deviceId = ?
			""")
		defer { sqlite3_finalize(counts) }
		var index: Int32 = 1
		for state in [Self.assetPending, Self.assetPrepared, Self.assetFailed] {
			try bind(state, at: index, in: counts)
			index += 1
			for mediaType in enabledMediaTypes {
				try bind(mediaType, at: index, in: counts)
				index += 1
			}
			if state == Self.assetPrepared {
				try bind(Self.assetUploaded, at: index, in: counts)
				index += 1
				try bind(Self.assetUploaded, at: index, in: counts)
				index += 1
			}
		}
		try bind(Self.assetUploaded, at: index, in: counts)
		index += 1
		try bind(Self.assetUploaded, at: index, in: counts)
		index += 1
		try bind(deviceId, at: index, in: counts)
		let result = sqlite3_step(counts)
		guard result == SQLITE_ROW else { throw databaseError(result) }

		return PhotoBackupStatistics(
			queuedCount: Int(sqlite3_column_int64(counts, 0)),
			preparedCount: Int(sqlite3_column_int64(counts, 1)),
			uploadedPhotoCount: Int(sqlite3_column_int64(counts, 2)),
			uploadedVideoCount: Int(sqlite3_column_int64(counts, 3)),
			failedCount: Int(sqlite3_column_int64(counts, 4)),
			uploadedBytes: sqlite3_column_int64(counts, 5),
			lastUploadedAt: sqlite3_column_type(counts, 6) == SQLITE_NULL
				? nil
				: Date(timeIntervalSince1970: sqlite3_column_double(counts, 6))
		)
	}

	// Indexed lookup for one visible thumbnail. The host app deliberately avoids
	// materializing the whole ledger for libraries with hundreds of thousands of
	// assets.
	public func assetRecord(deviceId: String, localIdentifier: String) throws -> AssetRecord? {
		try queue.sync {
			let statement = try prepare(
				"""
				SELECT state, modificationDate, uploadedBytes
				FROM photo_assets
				WHERE deviceId = ? AND localIdentifier = ? AND state != ?
				""")
			defer { sqlite3_finalize(statement) }
			try bind(deviceId, at: 1, in: statement)
			try bind(localIdentifier, at: 2, in: statement)
			try bind(Self.assetDeleted, at: 3, in: statement)
			switch sqlite3_step(statement) {
			case SQLITE_DONE:
				return nil
			case SQLITE_ROW:
				guard let state = AssetState(rawValue: sqlite3_column_int64(statement, 0)) else {
					throw DatabaseError(code: SQLITE_CORRUPT, message: "Photo backup asset has an invalid state")
				}
				return AssetRecord(
					state: state,
					modificationDate: Date(timeIntervalSince1970: sqlite3_column_double(statement, 1)),
					uploadedBytes: sqlite3_column_int64(statement, 2)
				)
			case let result:
				throw databaseError(result)
			}
		}
	}

	// Bulk access remains available for diagnostics. Interactive
	// presentation uses assetRecord(deviceId:localIdentifier:) through a bounded
	// cache instead.
	public func assetRecords(deviceId: String) throws -> [String: AssetRecord] {
		try queue.sync {
			let statement = try prepare(
				"SELECT localIdentifier, state, modificationDate, uploadedBytes FROM photo_assets WHERE deviceId = ? AND state != ?")
			defer { sqlite3_finalize(statement) }
			try bind(deviceId, at: 1, in: statement)
			try bind(Self.assetDeleted, at: 2, in: statement)
			var records = [String: AssetRecord]()
			while true {
				switch sqlite3_step(statement) {
				case SQLITE_ROW:
					let identifier = try requiredText(at: 0, in: statement)
					guard let state = AssetState(rawValue: sqlite3_column_int64(statement, 1)) else {
						throw DatabaseError(code: SQLITE_CORRUPT, message: "Photo backup asset has an invalid state")
					}
					records[identifier] = AssetRecord(
						state: state,
						modificationDate: Date(timeIntervalSince1970: sqlite3_column_double(statement, 2)),
						uploadedBytes: sqlite3_column_int64(statement, 3)
					)
				case SQLITE_DONE:
					return records
				case let result:
					throw databaseError(result)
				}
			}
		}
	}

	public func assetStates(deviceId: String) throws -> [String: AssetState] {
		try assetRecords(deviceId: deviceId).mapValues(\.state)
	}

	private struct AssetRow {
		let revision: Int64
		let state: Int64
		let modificationDate: Double
	}

	private struct ResourceOwner {
		let deviceId: String
		let localIdentifier: String
		let revision: Int64
	}

	@discardableResult
	private func seedCandidateLocked(
		_ candidate: AssetCandidate,
		deviceId: String,
		inventoryGeneration: Int64? = nil
	) throws -> Bool {
		if let existing = try assetRowLocked(deviceId: deviceId, localIdentifier: candidate.localIdentifier) {
			let changed = candidate.modificationDate.timeIntervalSince1970 > existing.modificationDate + 0.001
			let revived = existing.state == Self.assetDeleted
			if changed || revived {
				try updateCandidateLocked(candidate, deviceId: deviceId, revision: existing.revision + 1)
			}
			if let inventoryGeneration {
				try markInventoryGenerationLocked(
					inventoryGeneration,
					deviceId: deviceId,
					localIdentifier: candidate.localIdentifier
				)
			}
			return changed || revived
		}

		let statement = try prepare(
			"""
			INSERT INTO photo_assets
				(deviceId, localIdentifier, mediaType, revision, state, creationDate, modificationDate,
					contentVersionDate, inventoryGeneration)
			VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
			""")
		defer { sqlite3_finalize(statement) }
		try bind(deviceId, at: 1, in: statement)
		try bind(candidate.localIdentifier, at: 2, in: statement)
		try bind(candidate.mediaType, at: 3, in: statement)
		try bind(Self.assetPending, at: 4, in: statement)
		try bind(candidate.creationDate.timeIntervalSince1970, at: 5, in: statement)
		try bind(candidate.modificationDate.timeIntervalSince1970, at: 6, in: statement)
		try bind(candidate.modificationDate.timeIntervalSince1970, at: 7, in: statement)
		try bind(inventoryGeneration ?? 0, at: 8, in: statement)
		try stepDone(statement)
		return true
	}

	private func markInventoryGenerationLocked(
		_ generation: Int64,
		deviceId: String,
		localIdentifier: String
	) throws {
		let statement = try prepare(
			"UPDATE photo_assets SET inventoryGeneration = ? WHERE deviceId = ? AND localIdentifier = ?")
		defer { sqlite3_finalize(statement) }
		try bind(generation, at: 1, in: statement)
		try bind(deviceId, at: 2, in: statement)
		try bind(localIdentifier, at: 3, in: statement)
		try stepDone(statement)
	}

	private func updateCandidateLocked(_ candidate: AssetCandidate, deviceId: String, revision: Int64) throws {
		let statement = try prepare(
			"""
			UPDATE photo_assets
			SET mediaType = ?, revision = ?, state = ?, creationDate = ?, modificationDate = ?,
				contentVersionDate = ?,
				expectedResources = 0, uploadedBytes = 0, uploadedAt = NULL, lastError = NULL
			WHERE deviceId = ? AND localIdentifier = ?
			""")
		defer { sqlite3_finalize(statement) }
		try bind(candidate.mediaType, at: 1, in: statement)
		try bind(revision, at: 2, in: statement)
		try bind(Self.assetPending, at: 3, in: statement)
		try bind(candidate.creationDate.timeIntervalSince1970, at: 4, in: statement)
		try bind(candidate.modificationDate.timeIntervalSince1970, at: 5, in: statement)
		try bind(candidate.modificationDate.timeIntervalSince1970, at: 6, in: statement)
		try bind(deviceId, at: 7, in: statement)
		try bind(candidate.localIdentifier, at: 8, in: statement)
		try stepDone(statement)
	}

	// Returns true only when the ledger had never seen the asset and therefore had
	// to queue it. For a known asset, retain its receipt/revision and merely absorb
	// the newer PhotoKit watermark.
	private func recordMetadataChangeLocked(_ candidate: AssetCandidate, deviceId: String) throws -> Bool {
		guard let existing = try assetRowLocked(
			deviceId: deviceId,
			localIdentifier: candidate.localIdentifier
		) else {
			return try seedCandidateLocked(candidate, deviceId: deviceId)
		}
		if existing.state == Self.assetDeleted {
			return try seedCandidateLocked(candidate, deviceId: deviceId)
		}
		// The pre-scan PhotoKit token owns changes during inventory. Do not consume
		// its later history replay here: physical iPhone testing showed that an actual
		// edit can arrive as metadata-only during the scan. One conservative duplicate
		// upload is safer than permanently hiding edited content.
		guard try inventoryScanLocked(deviceId: deviceId) == nil else { return false }
		guard candidate.modificationDate.timeIntervalSince1970 > existing.modificationDate + 0.001 else {
			return false
		}
		let statement = try prepare(
			"""
			UPDATE photo_assets
			SET mediaType = ?, creationDate = ?, modificationDate = ?
			WHERE deviceId = ? AND localIdentifier = ?
			""")
		defer { sqlite3_finalize(statement) }
		try bind(candidate.mediaType, at: 1, in: statement)
		try bind(candidate.creationDate.timeIntervalSince1970, at: 2, in: statement)
		try bind(candidate.modificationDate.timeIntervalSince1970, at: 3, in: statement)
		try bind(deviceId, at: 4, in: statement)
		try bind(candidate.localIdentifier, at: 5, in: statement)
		try stepDone(statement)
		return false
	}

	private func markDeletedLocked(deviceId: String, localIdentifier: String) throws {
		let statement = try prepare(
			"UPDATE photo_assets SET state = ?, lastError = NULL WHERE deviceId = ? AND localIdentifier = ?")
		defer { sqlite3_finalize(statement) }
		try bind(Self.assetDeleted, at: 1, in: statement)
		try bind(deviceId, at: 2, in: statement)
		try bind(localIdentifier, at: 3, in: statement)
		try stepDone(statement)
	}

	private func assetRowLocked(deviceId: String, localIdentifier: String) throws -> AssetRow? {
		let statement = try prepare(
			"SELECT revision, state, modificationDate FROM photo_assets WHERE deviceId = ? AND localIdentifier = ?")
		defer { sqlite3_finalize(statement) }
		try bind(deviceId, at: 1, in: statement)
		try bind(localIdentifier, at: 2, in: statement)
		switch sqlite3_step(statement) {
		case SQLITE_ROW:
			return AssetRow(
				revision: sqlite3_column_int64(statement, 0),
				state: sqlite3_column_int64(statement, 1),
				modificationDate: sqlite3_column_double(statement, 2))
		case SQLITE_DONE:
			return nil
		case let result:
			throw databaseError(result)
		}
	}

	private func resourceOwnerLocked(resourceKey: String) throws -> ResourceOwner? {
		let statement = try prepare(
			"SELECT deviceId, localIdentifier, revision FROM photo_resources WHERE resourceKey = ?")
		defer { sqlite3_finalize(statement) }
		try bind(resourceKey, at: 1, in: statement)
		switch sqlite3_step(statement) {
		case SQLITE_ROW:
			return ResourceOwner(
				deviceId: try requiredText(at: 0, in: statement),
				localIdentifier: try requiredText(at: 1, in: statement),
				revision: sqlite3_column_int64(statement, 2))
		case SQLITE_DONE:
			return nil
		case let result:
			throw databaseError(result)
		}
	}

	private func recordResourceSucceededLocked(
		resourceKey: String,
		bytes: Int64
	) throws {
		guard let owner = try resourceOwnerLocked(resourceKey: resourceKey) else { return }
		let update = try prepare(
			"""
			UPDATE photo_resources
			SET state = ?, bytes = ?, lastError = NULL
			WHERE resourceKey = ?
			""")
		defer { sqlite3_finalize(update) }
		try bind(Self.resourceSucceeded, at: 1, in: update)
		try bind(bytes, at: 2, in: update)
		try bind(resourceKey, at: 3, in: update)
		try stepDone(update)
		try refreshAssetOutcomeLocked(owner: owner)
	}

	private func refreshAssetOutcomeLocked(owner: ResourceOwner) throws {
		guard let asset = try assetRowLocked(deviceId: owner.deviceId, localIdentifier: owner.localIdentifier),
			asset.revision == owner.revision,
			asset.state != Self.assetDeleted
		else { return }

		let statement = try prepare(
			"""
			SELECT
				COUNT(*),
				SUM(CASE WHEN state = ? THEN 1 ELSE 0 END),
				SUM(CASE WHEN state = ? THEN 1 ELSE 0 END),
				CAST(MIN(TOTAL(CASE WHEN state = ? THEN bytes ELSE 0 END), 9223372036854775807) AS INTEGER),
				MAX(CASE WHEN state = ? THEN lastError ELSE NULL END)
			FROM photo_resources
			WHERE deviceId = ? AND localIdentifier = ? AND revision = ?
			""")
		defer { sqlite3_finalize(statement) }
		try bind(Self.resourceSucceeded, at: 1, in: statement)
		try bind(Self.resourceFailed, at: 2, in: statement)
		try bind(Self.resourceSucceeded, at: 3, in: statement)
		try bind(Self.resourceFailed, at: 4, in: statement)
		try bind(owner.deviceId, at: 5, in: statement)
		try bind(owner.localIdentifier, at: 6, in: statement)
		try bind(owner.revision, at: 7, in: statement)
		let result = sqlite3_step(statement)
		guard result == SQLITE_ROW else { throw databaseError(result) }
		let total = sqlite3_column_int64(statement, 0)
		let succeeded = sqlite3_column_int64(statement, 1)
		let failed = sqlite3_column_int64(statement, 2)
		let bytes = sqlite3_column_int64(statement, 3)

		if total > 0, succeeded == total {
			let update = try prepare(
				"""
				UPDATE photo_assets
				SET state = ?, uploadedBytes = ?, uploadedAt = ?, lastError = NULL
				WHERE deviceId = ? AND localIdentifier = ? AND revision = ?
				""")
			defer { sqlite3_finalize(update) }
			try bind(Self.assetUploaded, at: 1, in: update)
			try bind(bytes, at: 2, in: update)
			try bind(Date().timeIntervalSince1970, at: 3, in: update)
			try bind(owner.deviceId, at: 4, in: update)
			try bind(owner.localIdentifier, at: 5, in: update)
			try bind(owner.revision, at: 6, in: update)
			try stepDone(update)
		} else if failed > 0 {
			let message = optionalText(at: 4, in: statement) ?? "PhotoKit could not upload this asset"
			let update = try prepare(
				"""
				UPDATE photo_assets SET state = ?, lastError = ?
				WHERE deviceId = ? AND localIdentifier = ? AND revision = ?
				""")
			defer { sqlite3_finalize(update) }
			try bind(Self.assetFailed, at: 1, in: update)
			try bind(message, at: 2, in: update)
			try bind(owner.deviceId, at: 3, in: update)
			try bind(owner.localIdentifier, at: 4, in: update)
			try bind(owner.revision, at: 5, in: update)
			try stepDone(update)
		}
	}

	private func metadataLocked(key: String, deviceId: String) throws -> Data? {
		let statement = try prepare("SELECT value FROM photo_metadata WHERE deviceId = ? AND key = ?")
		defer { sqlite3_finalize(statement) }
		try bind(deviceId, at: 1, in: statement)
		try bind(key, at: 2, in: statement)
		switch sqlite3_step(statement) {
		case SQLITE_ROW:
			guard let bytes = sqlite3_column_blob(statement, 0) else { return Data() }
			return Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0)))
		case SQLITE_DONE:
			return nil
		case let result:
			throw databaseError(result)
		}
	}

	private func inventoryScanLocked(deviceId: String) throws -> InventoryScan? {
		let statement = try prepare(
			"SELECT generation, changeToken FROM photo_inventory_scans WHERE deviceId = ?")
		defer { sqlite3_finalize(statement) }
		try bind(deviceId, at: 1, in: statement)
		switch sqlite3_step(statement) {
		case SQLITE_ROW:
			let generation = sqlite3_column_int64(statement, 0)
			guard let bytes = sqlite3_column_blob(statement, 1) else {
				return InventoryScan(generation: generation, changeToken: Data())
			}
			return InventoryScan(
				generation: generation,
				changeToken: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 1)))
			)
		case SQLITE_DONE:
			return nil
		case let result:
			throw databaseError(result)
		}
	}

	private func inventoryScannedIdentifiersLocked(
		from identifiers: [String],
		deviceId: String,
		generation: Int64
	) throws -> Set<String> {
		guard !identifiers.isEmpty else { return [] }
		let placeholders = Array(repeating: "?", count: identifiers.count).joined(separator: ", ")
		let statement = try prepare(
			"""
			SELECT localIdentifier FROM photo_assets
			WHERE deviceId = ? AND inventoryGeneration = ?
				AND localIdentifier IN (\(placeholders))
			""")
		defer { sqlite3_finalize(statement) }
		try bind(deviceId, at: 1, in: statement)
		try bind(generation, at: 2, in: statement)
		for (offset, identifier) in identifiers.enumerated() {
			try bind(identifier, at: Int32(offset + 3), in: statement)
		}

		var scanned = Set<String>()
		while true {
			switch sqlite3_step(statement) {
			case SQLITE_ROW:
				scanned.insert(try requiredText(at: 0, in: statement))
			case SQLITE_DONE:
				return scanned
			case let result:
				throw databaseError(result)
			}
		}
	}

	private func nextInventoryGenerationLocked(deviceId: String) throws -> Int64 {
		let statement = try prepare(
			"SELECT COALESCE(MAX(inventoryGeneration), 0) + 1 FROM photo_assets WHERE deviceId = ?")
		defer { sqlite3_finalize(statement) }
		try bind(deviceId, at: 1, in: statement)
		let result = sqlite3_step(statement)
		guard result == SQLITE_ROW else { throw databaseError(result) }
		return sqlite3_column_int64(statement, 0)
	}

	private func deleteInventoryScanLocked(deviceId: String) throws {
		let statement = try prepare("DELETE FROM photo_inventory_scans WHERE deviceId = ?")
		defer { sqlite3_finalize(statement) }
		try bind(deviceId, at: 1, in: statement)
		try stepDone(statement)
	}

	private func setMetadataLocked(_ data: Data, key: String, deviceId: String) throws {
		let statement = try prepare(
			"INSERT OR REPLACE INTO photo_metadata (deviceId, key, value) VALUES (?, ?, ?)")
		defer { sqlite3_finalize(statement) }
		try bind(deviceId, at: 1, in: statement)
		try bind(key, at: 2, in: statement)
		let result = data.withUnsafeBytes { bytes in
			sqlite3_bind_blob(statement, 3, bytes.baseAddress, Int32(data.count), Self.transient)
		}
		guard result == SQLITE_OK else { throw databaseError(result) }
		try stepDone(statement)
	}

	private func transaction<T>(_ work: () throws -> T) throws -> T {
		try execute("BEGIN IMMEDIATE")
		do {
			let value = try work()
			try execute("COMMIT")
			return value
		} catch {
			// Even once stopped, so the transaction never keeps its lock
			sqlite3_exec(db, "ROLLBACK", nil, nil, nil)
			throw error
		}
	}

	private func prepare(_ sql: String) throws -> OpaquePointer {
		try checkNotStopped()
		var statement: OpaquePointer?
		let result = sqlite3_prepare_v2(db, sql, -1, &statement, nil)
		guard result == SQLITE_OK, let statement else { throw databaseError(result) }
		return statement
	}

	private func integer(_ sql: String) throws -> Int64 {
		let statement = try prepare(sql)
		defer { sqlite3_finalize(statement) }
		let result = sqlite3_step(statement)
		guard result == SQLITE_ROW else { throw databaseError(result) }
		return sqlite3_column_int64(statement, 0)
	}

	private func text(_ sql: String) throws -> String {
		let statement = try prepare(sql)
		defer { sqlite3_finalize(statement) }
		let result = sqlite3_step(statement)
		guard result == SQLITE_ROW else { throw databaseError(result) }
		guard let value = sqlite3_column_text(statement, 0) else {
			throw DatabaseError(code: SQLITE_ERROR, message: "Database returned no value for \(sql)")
		}
		return String(cString: value)
	}

	private func execute(_ sql: String) throws {
		try checkNotStopped()
		let result = sqlite3_exec(db, sql, nil, nil, nil)
		guard result == SQLITE_OK else { throw databaseError(result) }
	}

	private func setBusyTimeout(_ milliseconds: Int32) throws {
		let result = sqlite3_busy_timeout(db, milliseconds)
		guard result == SQLITE_OK else { throw databaseError(result) }
	}

	private func bind(_ value: String, at index: Int32, in statement: OpaquePointer) throws {
		let result = sqlite3_bind_text(statement, index, value, -1, Self.transient)
		guard result == SQLITE_OK else { throw databaseError(result) }
	}

	private func bind(_ value: Int64, at index: Int32, in statement: OpaquePointer) throws {
		let result = sqlite3_bind_int64(statement, index, value)
		guard result == SQLITE_OK else { throw databaseError(result) }
	}

	private func bind(_ value: Double, at index: Int32, in statement: OpaquePointer) throws {
		let result = sqlite3_bind_double(statement, index, value)
		guard result == SQLITE_OK else { throw databaseError(result) }
	}

	private func bind(_ value: Data, at index: Int32, in statement: OpaquePointer) throws {
		let result = value.withUnsafeBytes { bytes in
			sqlite3_bind_blob(statement, index, bytes.baseAddress, Int32(value.count), Self.transient)
		}
		guard result == SQLITE_OK else { throw databaseError(result) }
	}

	private func stepDone(_ statement: OpaquePointer) throws {
		let result = sqlite3_step(statement)
		guard result == SQLITE_DONE else { throw databaseError(result) }
	}

	private func requiredText(at index: Int32, in statement: OpaquePointer) throws -> String {
		guard let text = sqlite3_column_text(statement, index) else {
			throw DatabaseError(code: SQLITE_CORRUPT, message: "Photo backup row is missing required data")
		}
		return String(cString: text)
	}

	private func optionalText(at index: Int32, in statement: OpaquePointer) -> String? {
		guard sqlite3_column_type(statement, index) != SQLITE_NULL,
			let text = sqlite3_column_text(statement, index)
		else { return nil }
		return String(cString: text)
	}

	private func databaseError(_ code: Int32) -> DatabaseError {
		let message = db.map { String(cString: sqlite3_errmsg($0)) } ?? "SQLite is unavailable"
		return DatabaseError(code: code, message: message)
	}
}
