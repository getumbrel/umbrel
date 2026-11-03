import CryptoKit
import Foundation

// Shared by PhotoKit's background uploader and the app's own uploader. Both must
// give a photo the same key and send the same headers, so neither can upload what
// the other already has.

public enum PhotoBackupResourceRole: String, Sendable {
	case photo
	case livePhotoMotion = "live-photo-motion"
	case video
}

public enum PhotoBackupResourceKey {
	// One resource's identity on the Umbrel. Changing this formula would make every
	// library upload again.
	public static func make(
		sourceId: String,
		localIdentifier: String,
		contentVersionDate: Date,
		role: PhotoBackupResourceRole
	) -> String {
		// Avoid the resettable ledger revision: edits change the key, while each
		// Live Photo component gets its own stable identity.
		stableKey(
			namespace: "umbrel-photo-resource-v1",
			parts: [
				sourceId,
				localIdentifier,
				String(contentVersionDate.timeIntervalSince1970.bitPattern, radix: 16),
				role.rawValue,
			]
		)
	}

	public static func isValid(_ value: String) -> Bool {
		value.utf8.count == 64 && value.utf8.allSatisfy { byte in
			(byte >= 48 && byte <= 57) || (byte >= 97 && byte <= 102)
		}
	}

	static func stableKey(namespace: String, parts: [String]) -> String {
		let material = ([namespace] + parts).joined(separator: "\0")
		return SHA256.hash(data: Data(material.utf8)).map { String(format: "%02x", $0) }.joined()
	}
}

// An unedited file's iCloud identity. An iPhone restored from this one, continuing its
// backup, finds the same file by it, so the Umbrel can count it as backed up without
// receiving it again.
public struct PhotoBackupCloudIdentity: Equatable, Sendable {
	public let cloudIdentifier: String
	public let role: PhotoBackupResourceRole

	// umbreld refuses an upload whose identity it can't store, so one it would refuse is
	// left off instead
	public init?(cloudIdentifier: String, role: PhotoBackupResourceRole) {
		guard !cloudIdentifier.isEmpty,
			cloudIdentifier.utf8.count <= 1_024,
			!cloudIdentifier.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
		else { return nil }
		self.cloudIdentifier = cloudIdentifier
		self.role = role
	}
}

public enum PhotoBackupUpload {
	public static let path = "/api/photos/upload"
	public static let claimPath = "/api/photos/claim"
	// The most files umbreld takes in one claim
	public static let claimsPerRequest = 256

	// Before a batch uploads, the backup asks which of its files it already has: from an
	// earlier install of the app, or the iPhone this one was restored from. Those are
	// recorded as backed up instead of sent.
	public static func claimRequest(
		url: URL,
		grant: String,
		resources: [Umbreld.PhotoBackupResourceClaim]
	) throws -> URLRequest {
		var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
		request.httpMethod = "POST"
		request.setValue("Bearer \(grant)", forHTTPHeaderField: "Authorization")
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		request.httpBody = try JSONEncoder().encode(Umbreld.PhotoBackupResourceClaimInput(resources: resources))
		return request
	}

	// The files the Umbrel already has, or nil when it didn't answer a claim. umbrelOS
	// before claims answers 401, and the files upload as before.
	public static func claimedResources(
		statusCode: Int,
		data: Data,
		requested: [Umbreld.PhotoBackupResourceClaim]
	) -> [Umbreld.PhotoBackupResourceReceipt]? {
		guard (200..<300).contains(statusCode),
			let receipts = try? JSONDecoder().decode([Umbreld.PhotoBackupResourceReceipt].self, from: data)
		else { return nil }
		let keys = Set(requested.map(\.resourceKey))
		return receipts.filter { keys.contains($0.resourceKey) && PhotoBackupLedger.isValidResourceByteCount($0.bytes) }
	}

	public static func fileExtension(originalFilename: String, preferredFilenameExtension: String?) -> String {
		let originalExtension = URL(fileURLWithPath: originalFilename).pathExtension.lowercased()
		let preferredExtension = preferredFilenameExtension?.lowercased() ?? ""
		return validFileExtension(originalExtension)
			?? validFileExtension(preferredExtension)
			?? "bin"
	}

	static func validFileExtension(_ value: String) -> String? {
		guard !value.isEmpty, value.utf8.count <= 16,
			value.utf8.allSatisfy({ byte in
				(byte >= 48 && byte <= 57) || (byte >= 97 && byte <= 122)
			})
		else { return nil }
		return value
	}

	public static func sourceCreationDateMilliseconds(_ date: Date) -> Int64? {
		// Some PhotoKit resources have no embedded capture date. umbreld uses this
		// source date only as their fallback, never over file-derived metadata.
		guard date != .distantPast else { return nil }
		let milliseconds = date.timeIntervalSince1970 * 1_000
		guard milliseconds.isFinite,
			milliseconds >= -62_135_596_800_000,
			milliseconds <= 253_402_300_799_999
		else { return nil }
		return Int64(milliseconds.rounded())
	}

	public static func headers(
		resourceKey: String,
		fileExtension: String,
		originalFilename: String,
		sourceCreationDateMilliseconds: Int64?,
		mimeType: String?,
		grant: String,
		cloudIdentity: PhotoBackupCloudIdentity? = nil
	) -> [String: String] {
		var headers = [
			"Authorization": "Bearer \(grant)",
			"X-Umbrel-Photo-Backup-Key": resourceKey,
			"X-Umbrel-Photo-Backup-Extension": fileExtension,
			// Header values are ASCII; Base64 preserves PhotoKit's Unicode filename exactly.
			"X-Umbrel-Photo-Original-Filename-Base64": Data(originalFilename.utf8).base64EncodedString(),
			"Content-Type": mimeType ?? "application/octet-stream",
		]
		if let sourceCreationDateMilliseconds {
			headers["X-Umbrel-Photo-Creation-Date-Ms"] = String(sourceCreationDateMilliseconds)
		}
		// Older umbrelOS ignores these
		if let cloudIdentity {
			headers["X-Umbrel-Photo-Cloud-Identifier-Base64"] = Data(cloudIdentity.cloudIdentifier.utf8).base64EncodedString()
			headers["X-Umbrel-Photo-Resource-Role"] = cloudIdentity.role.rawValue
		}
		return headers
	}

	// What one upload's answer means for the ledger and the rest of the pass
	public enum Outcome: Equatable, Sendable {
		case succeeded(bytes: Int64)
		// The Umbrel is out of space: pause until the user frees some
		case insufficientStorage
		// The backup grant was refused: pause until backup is set up again
		case authenticationRequired
		// The Umbrel can't be reached on any route right now
		case unreachable
		// The Umbrel answered but couldn't take it now; try this resource again later
		case temporaryFailure
		// This resource will never upload as it is
		case rejected(String)
	}

	public static func outcome(
		statusCode: Int,
		responseHeaders: [String: String],
		expectedResourceKey: String
	) -> Outcome {
		let headers = Dictionary(
			responseHeaders.map { ($0.key.lowercased(), $0.value) },
			uniquingKeysWith: { first, _ in first }
		)
		if headers["x-umbrel-photo-backup-error"] == "insufficient-storage" || statusCode == 507 {
			return .insufficientStorage
		}
		switch statusCode {
		case 200..<300:
			guard headers["x-umbrel-photo-backup-key"] == expectedResourceKey,
				let bytes = Int64(headers["x-umbrel-upload-bytes"] ?? ""),
				PhotoBackupLedger.isValidResourceByteCount(bytes)
			else { return .temporaryFailure }
			return .succeeded(bytes: bytes)
		case 401:
			return .authenticationRequired
		case 408, 429, 500..<600:
			return .temporaryFailure
		default:
			return .rejected("The Umbrel rejected this file (\(statusCode))")
		}
	}

	public static func outcome(failure error: Error) -> Outcome {
		let umbreldError = error as? Umbreld.Error
		// No route proved the pinned identity, so nothing was sent. The next pass checks
		// every route again; a changed identity is the app's to report, not backup's.
		if PhotoBackupTransportFailure.isConnectivityFailure(error)
			|| umbreldError?.isConnectivityFailure == true
			|| umbreldError?.kind == .trust
		{
			return .unreachable
		}
		if umbreldError?.isAuthError == true || PhotoBackupIssue(uploadError: error) != nil {
			return .authenticationRequired
		}
		// An unreadable answer isn't about this resource
		return .temporaryFailure
	}
}

#if os(iOS)
import OSLog
import Photos
import UniformTypeIdentifiers

// The app and its upload extension require iOS 26, where PHAssetResource has contentType
@available(iOS 26.0, *)
public struct PhotoBackupPlannedResource {
	public let resource: PHAssetResource
	public let role: PhotoBackupResourceRole
	public let resourceKey: String
	public let fileExtension: String
	public let filename: String
	public let sourceCreationDateMilliseconds: Int64?
	public let destinationPath: String

	public var ledgerPlan: PhotoBackupLedger.ResourcePlan {
		.init(resourceKey: resourceKey, filename: filename, destinationPath: destinationPath)
	}

	public var mimeType: String? { resource.contentType.preferredMIMEType }

	// `cloudIdentifier` is the asset's, and only for an asset without edits
	public func uploadHeaders(grant: String, cloudIdentifier: String? = nil) -> [String: String] {
		PhotoBackupUpload.headers(
			resourceKey: resourceKey,
			fileExtension: fileExtension,
			originalFilename: filename,
			sourceCreationDateMilliseconds: sourceCreationDateMilliseconds,
			mimeType: mimeType,
			grant: grant,
			cloudIdentity: cloudIdentifier.flatMap { PhotoBackupCloudIdentity(cloudIdentifier: $0, role: role) }
		)
	}

	// What the backup asks the Umbrel about this file before uploading it
	public func claim(cloudIdentifier: String? = nil) -> Umbreld.PhotoBackupResourceClaim {
		.init(
			resourceKey: resourceKey,
			fileExtension: fileExtension,
			identity: cloudIdentifier.flatMap { PhotoBackupCloudIdentity(cloudIdentifier: $0, role: role) }
		)
	}
}

@available(iOS 26.0, *)
public enum PhotoBackupPlanner {
	public static func selectedResources(for asset: PHAsset) -> [(resource: PHAssetResource, role: PhotoBackupResourceRole)] {
		let resources = PHAssetResource.assetResources(for: asset)
		var selected = [(resource: PHAssetResource, role: PhotoBackupResourceRole)]()
		if asset.mediaType == .image {
			// V1 backs up the version a person currently sees in Photos, not every
			// resource needed to reconstruct Apple's edit history. fullSize* is the
			// current edited rendition; unedited assets expose the original fallback.
			// Deliberately ignore adjustment data, prior originals beneath an edit, and
			// alternate RAW/JPEG resources unless product requirements later change to
			// a lossless archival backup.
			if let primary = resources.first(where: { $0.type == .fullSizePhoto })
				?? resources.first(where: { $0.type == .photo })
			{
				selected.append((primary, .photo))
			}
			if asset.mediaSubtypes.contains(.photoLive),
				let paired = resources.first(where: { $0.type == .fullSizePairedVideo })
					?? resources.first(where: { $0.type == .pairedVideo })
			{
				selected.append((paired, .livePhotoMotion))
			}
		} else if asset.mediaType == .video,
			let primary = resources.first(where: { $0.type == .fullSizeVideo })
				?? resources.first(where: { $0.type == .video })
		{
			selected.append((primary, .video))
		}
		return selected
	}

	// The iCloud identifiers of the assets without edits, by local identifier. An edited
	// asset's file is its own rendition, not the original every iPhone shares, so it's
	// never matched by identity. A failed lookup just leaves it out.
	public static func cloudIdentifiers(forUnedited assets: [PHAsset]) -> [String: String] {
		let localIdentifiers = assets.filter { !$0.hasAdjustments }.map(\.localIdentifier)
		guard !localIdentifiers.isEmpty else { return [:] }
		var identifiers = [String: String]()
		for (localIdentifier, mapping) in PHPhotoLibrary.shared().cloudIdentifierMappings(forLocalIdentifiers: localIdentifiers) {
			if case .success(let cloudIdentifier) = mapping {
				identifiers[localIdentifier] = cloudIdentifier.stringValue
			}
		}
		return identifiers
	}

	public static func plan(
		_ resource: PHAssetResource,
		role: PhotoBackupResourceRole,
		work: PhotoBackupLedger.AssetWork,
		sourceId: String
	) -> PhotoBackupPlannedResource {
		let key = PhotoBackupResourceKey.make(
			sourceId: sourceId,
			localIdentifier: work.localIdentifier,
			contentVersionDate: work.contentVersionDate,
			role: role
		)
		let fileExtension = PhotoBackupUpload.fileExtension(
			originalFilename: resource.originalFilename,
			preferredFilenameExtension: resource.contentType.preferredFilenameExtension
		)
		// umbreld owns the physical destination. The stable resource key makes retries
		// idempotent while the original filename remains display metadata.
		return PhotoBackupPlannedResource(
			resource: resource,
			role: role,
			resourceKey: key,
			fileExtension: fileExtension,
			filename: resource.originalFilename,
			sourceCreationDateMilliseconds: PhotoBackupUpload.sourceCreationDateMilliseconds(work.creationDate),
			destinationPath: "\(sourceId)/\(key).\(fileExtension)"
		)
	}
}

// Brings the ledger up to date with the photo library: a full inventory the first
// time, then PhotoKit's persistent change history.
@available(iOS 26.0, *)
public enum PhotoBackupLibraryIngest {
	public enum Result: Equatable, Sendable {
		case complete
		case moreWork
		case tokenReset
	}

	private static let inventoryBatchSize = 256
	private static let inventoryTargetPerInvocation = 4_096
	private static let historyCheckpointSize = 1_024

	public static func ingest(
		ledger: PhotoBackupLedger,
		sourceId: String,
		logger: Logger,
		isCancelled: () -> Bool
	) throws -> Result {
		do {
			return try ingestLibrary(ledger: ledger, sourceId: sourceId, logger: logger, isCancelled: isCancelled)
		} catch PhotoBackupLedger.InventoryScanError.superseded {
			// The app and PhotoKit's extension can both inventory a new library. The other
			// one finished first, so the next pass reads changes since its result.
			logger.notice("Another process finished the library inventory")
			return .moreWork
		}
	}

	private static func ingestLibrary(
		ledger: PhotoBackupLedger,
		sourceId: String,
		logger: Logger,
		isCancelled: () -> Bool
	) throws -> Result {
		let library = PHPhotoLibrary.shared()
		guard let tokenData = try ledger.changeToken(deviceId: sourceId) else {
			let scan = try ledger.startInventoryScan(
				deviceId: sourceId,
				changeToken: try archive(library.currentChangeToken)
			)
			// Keep progress as durable identifiers instead of a PhotoKit keyset cursor.
			// Do not sort PHAsset by localIdentifier: although PHFetchOptions documents it
			// as supported, even using it as the only descriptor makes PHQuery throw an
			// NSInvalidArgumentException on a physical iOS 26.6 device (FB24429469).
			// Re-enumerating and checking each bounded batch against SQLite also makes
			// mutations, equal dates, and missing dates irrelevant to correctness.
			let options = inventoryOptions()
			let result = PHAsset.fetchAssets(with: options)
			var nextIndex = 0
			var examinedCount = 0
			var recordedCount = 0
			// PhotoKit extensions have a constrained memory and runtime budget. Work in
			// local autorelease pools so PHAsset/Foundation temporaries cannot accumulate,
			// and checkpoint enough assets per invocation to avoid the old one-activation-
			// per-256 scheduling stall. Only newly recorded assets count toward the target,
			// so a resumed scan can cross its already committed prefix and keep progressing.
			while nextIndex < result.count,
				recordedCount < inventoryTargetPerInvocation,
				!isCancelled()
			{
				let upperBound = min(nextIndex + inventoryBatchSize, result.count)
				let batchResult: (examined: Int, recorded: Int) = try autoreleasepool {
					var candidates = [PhotoBackupLedger.AssetCandidate]()
					candidates.reserveCapacity(upperBound - nextIndex)
					for index in nextIndex..<upperBound {
						guard !isCancelled() else { break }
						candidates.append(candidate(for: result.object(at: index)))
					}
					let recorded = try ledger.recordInventoryBatch(
						candidates,
						deviceId: sourceId,
						generation: scan.generation
					)
					return (candidates.count, recorded)
				}
				examinedCount += batchResult.examined
				recordedCount += batchResult.recorded
				nextIndex += batchResult.examined
			}
			let reachedEnd = nextIndex == result.count
			let cancelled = isCancelled()
			logger.notice(
				"Inventoried PhotoKit library: examined=\(examinedCount, privacy: .public) recorded=\(recordedCount, privacy: .public) total=\(result.count, privacy: .public) complete=\(reachedEnd, privacy: .public) terminated=\(cancelled, privacy: .public)"
			)
			guard reachedEnd, !cancelled else { return .moreWork }
			try ledger.finishInventoryScan(deviceId: sourceId, generation: scan.generation)
			return .complete
		}

		let token = try unarchiveToken(tokenData)
		do {
			let changes = try library.fetchPersistentChanges(since: token)
			// Persistent history can be large because it includes Photos processing,
			// iCloud sync, and upload-job lifecycle changes. Collapse the history to
			// each asset's final action and periodically commit the token without
			// yielding the activation. Checkpoints keep a very large history replay
			// interruption-safe; termination, not an arbitrary record count, decides
			// when this pass stops.
			var upsertedIdentifiers = Set<String>()
			var deletedIdentifiers = Set<String>()
			var lastChangeToken: PHPersistentChangeToken?
			var changeCount = 0
			var uncommittedChangeCount = 0
			var checkpointCount = 0
			func commitCheckpoint() throws {
				guard let checkpointToken = lastChangeToken else { return }
				// Insertions and updates both reconcile the ledger to the current PHAsset
				// rendition, so one deduplicated candidate set preserves their semantics.
				try ledger.applyChanges(
					inserted: candidates(for: upsertedIdentifiers),
					updated: [],
					deleted: deletedIdentifiers,
					deviceId: sourceId,
					changeToken: try archive(checkpointToken)
				)
				upsertedIdentifiers.removeAll(keepingCapacity: true)
				deletedIdentifiers.removeAll(keepingCapacity: true)
				lastChangeToken = nil
				uncommittedChangeCount = 0
				checkpointCount += 1
			}
			for change in changes {
				guard !isCancelled() else { break }
				let details = try change.changeDetails(for: .asset)
				let changedIdentifiers = details.insertedLocalIdentifiers
					.union(details.updatedLocalIdentifiers)
				upsertedIdentifiers.formUnion(changedIdentifiers)
				deletedIdentifiers.subtract(changedIdentifiers)
				deletedIdentifiers.formUnion(details.deletedLocalIdentifiers)
				upsertedIdentifiers.subtract(details.deletedLocalIdentifiers)
				lastChangeToken = change.changeToken
				changeCount += 1
				uncommittedChangeCount += 1
				if uncommittedChangeCount == historyCheckpointSize {
					try commitCheckpoint()
				}
			}
			try commitCheckpoint()
			let cancelled = isCancelled()
			logger.notice(
				"Ingested PhotoKit history: changes=\(changeCount, privacy: .public) checkpoints=\(checkpointCount, privacy: .public) terminated=\(cancelled, privacy: .public)"
			)
			return cancelled ? .moreWork : .complete
		} catch {
			let nsError = error as NSError
			let recoverableHistoryCodes = [
				PHPhotosError.Code.persistentChangeTokenExpired.rawValue,
				PHPhotosError.Code.persistentChangeDetailsUnavailable.rawValue,
			]
			guard nsError.domain == PHPhotosErrorDomain, recoverableHistoryCodes.contains(nsError.code) else {
				throw error
			}
			try ledger.clearChangeToken(deviceId: sourceId)
			return .tokenReset
		}
	}

	public static func inventoryOptions() -> PHFetchOptions {
		let options = PHFetchOptions()
		options.predicate = NSPredicate(
			format: "mediaType IN %@",
			[PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue]
		)
		// Fill the upload queue with the newest assets first. An unspecified fetch order
		// can begin with old, iCloud-only resources and prevent recent on-device photos
		// from starting until those download.
		options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
		return options
	}

	private static func candidates(for identifiers: Set<String>) -> [PhotoBackupLedger.AssetCandidate] {
		guard !identifiers.isEmpty else { return [] }
		let result = PHAsset.fetchAssets(withLocalIdentifiers: Array(identifiers), options: inventoryOptions())
		var candidates = [PhotoBackupLedger.AssetCandidate]()
		candidates.reserveCapacity(result.count)
		result.enumerateObjects { asset, _, _ in candidates.append(candidate(for: asset)) }
		return candidates
	}

	private static func candidate(for asset: PHAsset) -> PhotoBackupLedger.AssetCandidate {
		PhotoBackupLedger.AssetCandidate(
			localIdentifier: asset.localIdentifier,
			mediaType: Int64(asset.mediaType.rawValue),
			creationDate: asset.creationDate ?? .distantPast,
			modificationDate: asset.modificationDate ?? asset.creationDate ?? .distantPast
		)
	}

	private static func archive(_ token: PHPersistentChangeToken) throws -> Data {
		try NSKeyedArchiver.archivedData(withRootObject: token, requiringSecureCoding: true)
	}

	private static func unarchiveToken(_ data: Data) throws -> PHPersistentChangeToken {
		guard let token = try NSKeyedUnarchiver.unarchivedObject(ofClass: PHPersistentChangeToken.self, from: data) else {
			throw PlannerError.invalidChangeToken
		}
		return token
	}

	private enum PlannerError: LocalizedError {
		case invalidChangeToken

		var errorDescription: String? { "The saved Photo Library change token is invalid" }
	}
}
#endif
