import CryptoKit
import ExtensionFoundation
import Foundation
import OSLog
import Photos
import UmbrelKit
import UniformTypeIdentifiers

// PhotoKit is the only uploader. Each invocation advances a small durable state
// machine: ingest library changes, reconcile PhotoKit's jobs with the durable
// ledger, then fill the system's inflight queue. The host app never uploads.
@main
final class BackgroundUploadExtension: PHBackgroundResourceUploadExtension {
	private static let inventoryBatchSize = 256
	private static let inventoryTargetPerInvocation = 4_096
	private static let historyCheckpointSize = 1_024
	private static let logger = Logger(
		subsystem: "com.umbrel.app.photo-background-upload",
		category: "PhotoBackup"
	)
	private let terminationLock = NSLock()
	private var terminated = false

	required init() {}

	func process() -> PHBackgroundResourceUploadProcessingResult {
		Self.logger.notice("PhotoKit invoked the background upload extension")
		// notifyTermination() cancels one activation. PhotoKit presents the next
		// activation as another process() call and may reuse this extension object,
		// so a previous activation's cancellation must not poison every future pass.
		terminationLock.lock()
		terminated = false
		terminationLock.unlock()
		let configuration: PhotoBackupConfiguration
		switch PhotoBackupStore.configurationRead() {
		case .found(let storedConfiguration):
			configuration = storedConfiguration
		case .missing:
			Self.logger.notice("Invocation completed because backup is not configured")
			return .completed
		case .unavailable:
			Self.logger.error("Invocation failed because backup configuration is unavailable")
			return .failure
		}
		// Refuse malformed or non-Tailscale configuration before reading a credential or
		// touching the photo library. The host app applies the same validation on save.
		guard configuration.isTailscaleDestination else {
			Self.logger.error("Invocation rejected an invalid upload destination")
			return .failure
		}
		let initialSnapshot = PhotoBackupStore.snapshot
		let recoveryRetryRequested = PhotoBackupStore.recoveryRetryRequested(for: configuration.source.id)
		guard let ledgerURL = PhotoBackupStore.ledgerURL, let ledger = PhotoBackupLedger(url: ledgerURL) else {
			if recoveryRetryRequested {
				PhotoBackupStore.clearRecoveryRetryRequest(for: configuration.source.id)
			}
			Self.logger.error("Invocation failed because the shared ledger could not be opened")
			publish(
				.needsAttention,
				sourceId: configuration.source.id,
				error: "shared-ledger-unavailable"
			)
			return .failure
		}
		// Insufficient server storage is a source-level pause, not a reason to keep
		// cycling through the rest of the library. An explicit retry first drains the
		// old inflight batch, then sends one resource as a capacity probe. Only a
		// successful probe reopens the normal queue.
		let storedStorageRetry = PhotoBackupStore.storageRetryRequested(for: configuration.source.id)
		var recovery = PhotoBackupRecoveryState(
			snapshot: initialSnapshot,
			sourceId: configuration.source.id,
			storageRetryRequested: storedStorageRetry
		)
		var authenticationIssue: PhotoBackupIssue? = initialSnapshot.sourceId == configuration.source.id
			&& initialSnapshot.issue == .authenticationRequired
			? .authenticationRequired
			: nil
		if storedStorageRetry, !recovery.storageRetryRequested {
			PhotoBackupStore.clearStorageRetryRequest()
		}
		publish(
			authenticationIssue == nil ? recovery.phase : .needsAttention,
			sourceId: configuration.source.id,
			issue: recovery.issue ?? authenticationIssue
		)
		let grant: String
		switch Keychain.readPhotoBackupGrant(
			deviceId: configuration.deviceId,
			accountId: configuration.source.accountId
		) {
		case .found(let token):
			grant = token
		case .missing:
			if recoveryRetryRequested {
				PhotoBackupStore.clearRecoveryRetryRequest(for: configuration.source.id)
			}
			Self.logger.error("Invocation failed because the backup credential is missing")
			publish(
				.needsAttention,
				sourceId: configuration.source.id,
				issue: recovery.issue ?? .authenticationRequired
			)
			return .failure
		case .unavailable:
			if recoveryRetryRequested {
				PhotoBackupStore.clearRecoveryRetryRequest(for: configuration.source.id)
			}
			Self.logger.error("Invocation failed because the backup credential is unavailable")
			if let issue = recovery.issue {
				publish(.needsAttention, sourceId: configuration.source.id, issue: issue)
			} else {
				publish(
					.needsAttention,
					sourceId: configuration.source.id,
					error: "shared-keychain-unavailable"
				)
			}
			return .failure
		}

		do {
			let changeResult = try ingestLibraryChanges(ledger: ledger, configuration: configuration)
			if changeResult == .tokenReset {
				Self.logger.notice("PhotoKit change history expired; scheduled a fresh library inventory")
				publish(
					authenticationIssue == nil ? recovery.phase : .needsAttention,
					sourceId: configuration.source.id,
					issue: recovery.issue ?? authenticationIssue
				)
				return .processing
			}

			let retryable = recovery.storagePaused
				? []
				: try retryableJobs(ledger: ledger, configuration: configuration)
			let allTerminal = jobs(for: .acknowledge)
			let terminalResourceKeys = Set(allTerminal.compactMap(resourceKey))
			let currentTerminalResourceKeys = try ledger.currentResourceKeys(
				from: terminalResourceKeys,
				deviceId: configuration.source.id,
				includePhotos: configuration.includePhotos,
				includeVideos: configuration.includeVideos
			)
			let terminal = allTerminal.filter { job in
				guard let key = resourceKey(for: job) else { return false }
				return currentTerminalResourceKeys.contains(key)
			}
			let confirmedTerminalResourceKeys = try ledger.succeededResourceKeys(
				from: Set(terminal.compactMap(resourceKey))
			)
			let unresolvedTerminal = terminal.filter { job in
				guard let key = resourceKey(for: job) else { return true }
				return !confirmedTerminalResourceKeys.contains(key)
			}
			let obsoleteTerminal = allTerminal.filter { job in
				guard let key = resourceKey(for: job) else { return true }
				return !currentTerminalResourceKeys.contains(key)
			}
			if !obsoleteTerminal.isEmpty {
				// Old-source jobs still belong to the shared ledger and must be released,
				// but they cannot change the active source's recovery status.
				try acknowledge(
					obsoleteTerminal,
					ledger: ledger,
					configuration: configuration,
					publishIssue: false
				)
			}
			let terminalCounts = JobStateCounts(terminal)
			let foundStorageFailure = unresolvedTerminal.contains(where: {
				PhotoBackupIssue(responseHeaderFields: $0.responseHeaderFields) == .insufficientStorage
			})
			let foundAuthenticationFailure = unresolvedTerminal.contains(where: {
				issue(for: $0) == .authenticationRequired
			})
			if foundStorageFailure {
				authenticationIssue = nil
			} else if foundAuthenticationFailure {
				authenticationIssue = .authenticationRequired
			}
			let foundConnectivityFailure = unresolvedTerminal.contains(where: isConnectivityFailure)
			recovery.observeTerminalBatch(
				foundStorageFailure: foundStorageFailure,
				foundConnectivityFailure: foundConnectivityFailure,
				hasTerminalJobs: !terminal.isEmpty
			)
			if !terminal.isEmpty {
				// Apple can terminate this process at any point. Persist the source-level
				// recovery mode before mutating jobs so the next activation can't refill
				// the queue from a stale snapshot.
				publish(
					authenticationIssue == nil ? recovery.phase : .needsAttention,
					sourceId: configuration.source.id,
					issue: recovery.issue ?? authenticationIssue
				)
			}
			let jobsToRetry: [PHAssetResourceUploadJob]
			if recovery.storagePaused {
				jobsToRetry = []
			} else if recovery.connectivityRecovering {
				// Keep Apple's ordinary retry for unrelated transient errors, but use
				// only one failed connection as the Tailscale reachability probe. The rest
				// return to our durable queue for a later system activation.
				let otherTransientFailures = retryable.filter { !isConnectivityFailure($0) }
				let connectivityProbe = retryable.first(where: isConnectivityFailure).map { [$0] } ?? []
				jobsToRetry = otherTransientFailures + connectivityProbe
			} else {
				jobsToRetry = retryable
			}
			let retryResourceKeys = Set(jobsToRetry.compactMap(resourceKey))
			let finished = recovery.storagePaused
				? terminal
				: terminal.filter { job in
					guard let key = resourceKey(for: job) else { return true }
					return !retryResourceKeys.contains(key)
				}
			Self.logger.notice(
				"Observed terminal jobs: succeeded=\(terminalCounts.succeeded, privacy: .public) failed=\(terminalCounts.failed, privacy: .public) retryable=\(retryable.count, privacy: .public) retried=\(jobsToRetry.count, privacy: .public)"
			)
			// Successful and permanent failures still consume PhotoKit's job limit.
			// Free those slots before retrying transient failures, because retry()
			// itself counts against the same limit.
			let storageProbeOutcome: PhotoBackupStorageProbeOutcome? = {
				guard recovery.storageProbing, !finished.isEmpty else { return nil }
				if finished.contains(where: { job in
					resourceKey(for: job).map { confirmedTerminalResourceKeys.contains($0) } == true
				}) { return .succeeded }
				if finished.contains(where: isSuccessful) { return .succeeded }
				if finished.contains(where: {
					PhotoBackupIssue(responseHeaderFields: $0.responseHeaderFields) == .insufficientStorage
				}) { return .insufficientStorage }
				if finished.allSatisfy(isConnectivityFailure) { return .connectivityFailure }
				return .permanentFailure
			}()
			if !finished.isEmpty {
				try acknowledge(
					finished,
					ledger: ledger,
					configuration: configuration,
					confirmedResourceKeys: confirmedTerminalResourceKeys
				)
			}
			if let storageProbeOutcome {
				let hadStorageRetryRequest = recovery.storageRetryRequested
				recovery.finishStorageProbe(storageProbeOutcome)
				if hadStorageRetryRequest, !recovery.storageRetryRequested {
					PhotoBackupStore.clearStorageRetryRequest()
				}
			}
			if !recovery.storagePaused {
				try retry(jobsToRetry, configuration: configuration, grant: grant)
			}
			if recoveryRetryRequested {
				// The host only requests recovery. Requeue here, after terminal jobs have
				// been acknowledged, so this process remains the sole owner of PhotoKit
				// job-to-ledger transitions.
				try ledger.requeueFailedAssets(
					deviceId: configuration.source.id,
					includePhotos: configuration.includePhotos,
					includeVideos: configuration.includeVideos
				)
				PhotoBackupStore.clearRecoveryRetryRequest(for: configuration.source.id)
				authenticationIssue = nil
				publish(
					recovery.phase,
					sourceId: configuration.source.id,
					statistics: try statistics(ledger: ledger, configuration: configuration),
					issue: recovery.issue
				)
			}

			guard !isTerminated else {
				Self.logger.notice("Invocation yielded after PhotoKit requested termination")
				return .processing
			}
			let activeJobs = try reconcileActiveJobs(
				ledger: ledger,
				configuration: configuration,
				grant: grant
			)
			let activeCounts = JobStateCounts(activeJobs)
			if recovery.storagePaused, recovery.storageRetryRequested, activeJobs.isEmpty {
				try ledger.requeueFailedAssets(
					deviceId: configuration.source.id,
					includePhotos: configuration.includePhotos,
					includeVideos: configuration.includeVideos
				)
				recovery.beginStorageProbe()
				publish(
					recovery.phase,
					sourceId: configuration.source.id,
					statistics: try statistics(ledger: ledger, configuration: configuration),
					issue: recovery.issue
				)
			}
			// Once everything else has been backed up, give failed uploads another try in
			// this pass instead of leaving them for the user to retry. Storage, sign-in and
			// connectivity problems keep their own recovery.
			if activeJobs.isEmpty,
				changeResult != .moreWork,
				authenticationIssue == nil,
				!recovery.storagePaused,
				!recovery.storageProbing,
				!recovery.connectivityRecovering,
				try ledger.requeueFailedAssetsAfterProgress(
					deviceId: configuration.source.id,
					includePhotos: configuration.includePhotos,
					includeVideos: configuration.includeVideos
				)
			{
				Self.logger.notice("Requeued failed resources after the rest of the backup caught up")
			}

			guard !isTerminated else {
				Self.logger.notice("Invocation yielded after PhotoKit requested termination")
				return .processing
			}
			let availableSlots = max(0, PHAssetResourceUploadJob.jobLimit - activeJobs.count)
			let creationLimit = if authenticationIssue != nil {
				0
			} else if recovery.storageProbing || recovery.connectivityRecovering {
				min(availableSlots, max(0, 1 - activeJobs.count))
			} else {
				availableSlots
			}
			let created = recovery.storagePaused
				? 0
				: try createJobs(
					upTo: creationLimit,
					ledger: ledger,
					configuration: configuration,
					grant: grant
				)
			let stats = try statistics(ledger: ledger, configuration: configuration)
			let hasInflightJobs = !activeJobs.isEmpty || created > 0
			if recovery.storageProbing, !hasInflightJobs {
				// The failed resource may have been removed or disabled while backup was
				// paused. With nothing left to probe, the storage pause is obsolete.
				PhotoBackupStore.clearStorageRetryRequest()
				recovery.finishStorageProbeWithoutWork()
			}
			if recovery.connectivityRecovering,
				!hasInflightJobs,
				stats.queuedCount == 0,
				stats.preparedCount == 0
			{
				// The resource may have been removed or excluded while waiting.
				recovery.finishConnectivityRecoveryWithoutWork()
			}
			let phase: PhotoBackupPhase
			if authenticationIssue != nil {
				phase = .needsAttention
			} else if recovery.storagePaused || recovery.connectivityRecovering || recovery.storageProbing {
				phase = recovery.phase
			} else if stats.failedCount > 0, stats.queuedCount == 0, stats.preparedCount == 0 {
				phase = .needsAttention
			} else if activeCounts.pending > 0 {
				phase = .uploading
			} else if changeResult == .moreWork || hasInflightJobs || stats.queuedCount > 0 || stats.preparedCount > 0 {
				phase = .waiting
			} else {
				phase = .upToDate
			}
			publish(
				phase,
				sourceId: configuration.source.id,
				statistics: stats,
				issue: recovery.issue ?? authenticationIssue
			)
			Self.logger.notice(
				"PhotoKit jobs: registered=\(activeCounts.registered, privacy: .public) pending=\(activeCounts.pending, privacy: .public) created=\(created, privacy: .public) freeSlotsBeforeCreate=\(availableSlots, privacy: .public); ledger: queuedAssets=\(stats.queuedCount, privacy: .public) preparedAssets=\(stats.preparedCount, privacy: .public) failedAssets=\(stats.failedCount, privacy: .public); phase=\(phase.rawValue, privacy: .public)"
			)

			let hasRemainingWork = changeResult == .moreWork
				|| hasInflightJobs
				|| (!recovery.storagePaused && (stats.queuedCount > 0 || stats.preparedCount > 0))
			let result: PHBackgroundResourceUploadProcessingResult = if authenticationIssue != nil {
				.failure
			} else {
				hasRemainingWork ? .processing : .completed
			}
			Self.logger.notice("Invocation finished with moreWork=\(hasRemainingWork, privacy: .public)")
			return result
		} catch {
			let nsError = error as NSError
			if nsError.domain == PHPhotosErrorDomain,
				nsError.code == PHPhotosError.Code.limitExceeded.rawValue
			{
				Self.logger.notice("PhotoKit's upload job queue is full")
				publish(
					authenticationIssue == nil ? recovery.phase : .needsAttention,
					sourceId: configuration.source.id,
					issue: recovery.issue ?? authenticationIssue
				)
				return .processing
			}
			// Keep stable classification searchable without publishing free-form text,
			// which can contain endpoint details or server-provided messages.
			Self.logger.error(
				"Invocation failed: domain=\(nsError.domain, privacy: .public) code=\(nsError.code, privacy: .public) description=\(nsError.localizedDescription, privacy: .private)"
			)
			if recoveryRetryRequested {
				PhotoBackupStore.clearRecoveryRetryRequest(for: configuration.source.id)
			}
			if let issue = recovery.issue ?? authenticationIssue {
				publish(.needsAttention, sourceId: configuration.source.id, issue: issue)
			} else {
				publish(
					.needsAttention,
					sourceId: configuration.source.id,
					error: "\(nsError.domain):\(nsError.code)"
				)
			}
			return .failure
		}
	}

	func notifyTermination() {
		Self.logger.notice("PhotoKit requested extension termination")
		terminationLock.lock()
		terminated = true
		terminationLock.unlock()
	}

	private var isTerminated: Bool {
		terminationLock.lock()
		defer { terminationLock.unlock() }
		return terminated
	}

	// MARK: - Photo library inventory

	private enum ChangeIngestionResult {
		case complete
		case moreWork
		case tokenReset
	}

	private func ingestLibraryChanges(
		ledger: PhotoBackupLedger,
		configuration: PhotoBackupConfiguration
	) throws -> ChangeIngestionResult {
		let library = PHPhotoLibrary.shared()
		guard let tokenData = try ledger.changeToken(deviceId: configuration.source.id) else {
			let scan = try ledger.startInventoryScan(
				deviceId: configuration.source.id,
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
				recordedCount < Self.inventoryTargetPerInvocation,
				!isTerminated
			{
				let upperBound = min(nextIndex + Self.inventoryBatchSize, result.count)
				let batchResult: (examined: Int, recorded: Int) = try autoreleasepool {
					var candidates = [PhotoBackupLedger.AssetCandidate]()
					candidates.reserveCapacity(upperBound - nextIndex)
					for index in nextIndex..<upperBound {
						guard !isTerminated else { break }
						candidates.append(candidate(for: result.object(at: index)))
					}
					let recorded = try ledger.recordInventoryBatch(
						candidates,
						deviceId: configuration.source.id,
						generation: scan.generation
					)
					return (candidates.count, recorded)
				}
				examinedCount += batchResult.examined
				recordedCount += batchResult.recorded
				nextIndex += batchResult.examined
			}
			let reachedEnd = nextIndex == result.count
			Self.logger.notice(
				"Inventoried PhotoKit library: examined=\(examinedCount, privacy: .public) recorded=\(recordedCount, privacy: .public) total=\(result.count, privacy: .public) complete=\(reachedEnd, privacy: .public) terminated=\(self.isTerminated, privacy: .public)"
			)
			guard reachedEnd, !isTerminated else { return .moreWork }
			try ledger.finishInventoryScan(deviceId: configuration.source.id, generation: scan.generation)
			return .complete
		}

		let token = try unarchiveToken(tokenData)
		do {
			let changes = try library.fetchPersistentChanges(since: token)
			// Persistent history can be large because it includes Photos processing,
			// iCloud sync, and upload-job lifecycle changes. Collapse the history to
			// each asset's final action and periodically commit the token without
			// yielding the activation. Checkpoints keep a very large history replay
			// interruption-safe; PhotoKit termination, not an arbitrary record count,
			// decides when this invocation stops.
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
					deviceId: configuration.source.id,
					changeToken: try archive(checkpointToken)
				)
				upsertedIdentifiers.removeAll(keepingCapacity: true)
				deletedIdentifiers.removeAll(keepingCapacity: true)
				lastChangeToken = nil
				uncommittedChangeCount = 0
				checkpointCount += 1
			}
			for change in changes {
				guard !isTerminated else { break }
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
				if uncommittedChangeCount == Self.historyCheckpointSize {
					try commitCheckpoint()
				}
			}
			try commitCheckpoint()
			Self.logger.notice(
				"Ingested PhotoKit history: changes=\(changeCount, privacy: .public) checkpoints=\(checkpointCount, privacy: .public) terminated=\(self.isTerminated, privacy: .public)"
			)
			return isTerminated ? .moreWork : .complete
		} catch {
			let nsError = error as NSError
			let recoverableHistoryCodes = [
				PHPhotosError.Code.persistentChangeTokenExpired.rawValue,
				PHPhotosError.Code.persistentChangeDetailsUnavailable.rawValue,
			]
			guard nsError.domain == PHPhotosErrorDomain, recoverableHistoryCodes.contains(nsError.code) else {
				throw error
			}
			try ledger.clearChangeToken(deviceId: configuration.source.id)
			return .tokenReset
		}
	}

	private func inventoryOptions() -> PHFetchOptions {
		let options = PHFetchOptions()
		options.predicate = NSPredicate(
			format: "mediaType IN %@",
			[PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue]
		)
		// Fill PhotoKit's finite job queue with the newest assets first. An
		// unspecified fetch order can begin with old, iCloud-only resources and
		// prevent recent on-device photos from starting until those download.
		options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
		return options
	}

	private func candidates(for identifiers: Set<String>) -> [PhotoBackupLedger.AssetCandidate] {
		guard !identifiers.isEmpty else { return [] }
		let result = PHAsset.fetchAssets(withLocalIdentifiers: Array(identifiers), options: inventoryOptions())
		var candidates = [PhotoBackupLedger.AssetCandidate]()
		candidates.reserveCapacity(result.count)
		result.enumerateObjects { asset, _, _ in candidates.append(self.candidate(for: asset)) }
		return candidates
	}

	private func candidate(for asset: PHAsset) -> PhotoBackupLedger.AssetCandidate {
		PhotoBackupLedger.AssetCandidate(
			localIdentifier: asset.localIdentifier,
			mediaType: Int64(asset.mediaType.rawValue),
			creationDate: asset.creationDate ?? .distantPast,
			modificationDate: asset.modificationDate ?? asset.creationDate ?? .distantPast
		)
	}

	private func archive(_ token: PHPersistentChangeToken) throws -> Data {
		try NSKeyedArchiver.archivedData(withRootObject: token, requiringSecureCoding: true)
	}

	private func unarchiveToken(_ data: Data) throws -> PHPersistentChangeToken {
		guard let token = try NSKeyedUnarchiver.unarchivedObject(ofClass: PHPersistentChangeToken.self, from: data) else {
			throw ExtensionError.invalidChangeToken
		}
		return token
	}

	// MARK: - Job reconciliation

	private func retryableJobs(
		ledger: PhotoBackupLedger,
		configuration: PhotoBackupConfiguration
	) throws -> [PHAssetResourceUploadJob] {
		let retryable = jobs(for: .retry)
		guard !retryable.isEmpty else { return [] }
		let jobsAndKeys = retryable.compactMap { job in
			resourceKey(for: job).map { (job: job, key: $0) }
		}
		let currentKeys = try ledger.currentResourceKeys(
			from: Set(jobsAndKeys.map(\.key)),
			deviceId: configuration.source.id,
			includePhotos: configuration.includePhotos,
			includeVideos: configuration.includeVideos
		)
		let confirmedKeys = try ledger.succeededResourceKeys(from: currentKeys)
		return jobsAndKeys.compactMap { job, key in
			currentKeys.contains(key) && !confirmedKeys.contains(key) && shouldRetry(job) ? job : nil
		}
	}

	private func retry(
		_ jobs: [PHAssetResourceUploadJob],
		configuration: PhotoBackupConfiguration,
		grant: String
	) throws {
		for job in jobs {
			guard var destination = configuration.retargetUploadDestination(job.destination) else {
				throw ExtensionError.invalidUploadBase
			}
			destination.setValue("Bearer \(grant)", forHTTPHeaderField: "Authorization")
			try PHPhotoLibrary.shared().performChangesAndWait {
				PHAssetResourceUploadJobChangeRequest(for: job)?.retry(destination: destination)
			}
		}
	}

	private func shouldRetry(_ job: PHAssetResourceUploadJob) -> Bool {
		// A 507 from Umbrel is recoverable only after the user frees server
		// storage. Spending PhotoKit's single retry immediately cannot help.
		guard PhotoBackupIssue(responseHeaderFields: job.responseHeaderFields) == nil else { return false }
		guard let error = job.error as? URLError else { return true }
		return error.code != .badServerResponse && error.code != .userAuthenticationRequired
	}

	private func isSuccessful(_ job: PHAssetResourceUploadJob) -> Bool {
		successfulReceipt(for: job) != nil
	}

	private func successfulReceipt(for job: PHAssetResourceUploadJob) -> (resourceKey: String, bytes: Int64)? {
		guard let key = resourceKey(for: job),
			job.state == .succeeded,
			job.responseHeaderFields?["x-umbrel-photo-backup-key"] == key,
			let bytes = Int64(job.responseHeaderFields?["x-umbrel-upload-bytes"] ?? ""),
			PhotoBackupLedger.isValidResourceByteCount(bytes)
		else { return nil }
		return (key, bytes)
	}

	private func isConnectivityFailure(_ job: PHAssetResourceUploadJob) -> Bool {
		PhotoBackupTransportFailure.isConnectivityFailure(job.error)
	}

	private func issue(for job: PHAssetResourceUploadJob) -> PhotoBackupIssue? {
		PhotoBackupIssue(responseHeaderFields: job.responseHeaderFields)
			?? PhotoBackupIssue(uploadError: job.error)
	}

	private func acknowledge(
		_ jobs: [PHAssetResourceUploadJob],
		ledger: PhotoBackupLedger,
		configuration: PhotoBackupConfiguration,
		confirmedResourceKeys: Set<String> = [],
		publishIssue: Bool = true
	) throws {
		for job in jobs {
			let key = resourceKey(for: job)
			let serverAlreadyConfirmed = key.map { confirmedResourceKeys.contains($0) } == true
			let issue = serverAlreadyConfirmed ? nil : issue(for: job)
			if let key {
				if serverAlreadyConfirmed {
					// The foreground app observed the exact atomically promoted resource
					// on Umbrel before PhotoKit delivered this terminal job. Keep that
					// stronger receipt and only release PhotoKit's bookkeeping below.
				} else if let receipt = successfulReceipt(for: job) {
					try ledger.recordResourceSucceeded(resourceKey: receipt.resourceKey, bytes: receipt.bytes)
				} else if issue == nil, isConnectivityFailure(job) {
					// Use PhotoKit's one retry for one connectivity probe. Return every
					// other connectivity failure to our durable queue so a later
					// system-scheduled invocation can try it again.
					try ledger.recordResourcePending(resourceKey: key)
				} else {
					try ledger.recordResourceFailed(
						resourceKey: key,
						message: job.error?.localizedDescription ?? "The upload server rejected this resource"
					)
				}
			}
			if let issue, publishIssue {
				// Apple removes all job metadata after acknowledgement. Persist both
				// the ledger result and the typed source pause before that point.
				publish(
					.needsAttention,
					sourceId: configuration.source.id,
					statistics: try statistics(ledger: ledger, configuration: configuration),
					issue: issue
				)
			}

			// The durable ledger update happens first. If acknowledgement fails, the
			// next invocation repeats the idempotent update and tries again.
			try PHPhotoLibrary.shared().performChangesAndWait {
				PHAssetResourceUploadJobChangeRequest(for: job)?.acknowledge()
			}
		}
	}

	private func reconcileActiveJobs(
		ledger: PhotoBackupLedger,
		configuration: PhotoBackupConfiguration,
		grant: String
	) throws -> [PHAssetResourceUploadJob] {
		let active = jobs(for: .process)
		let jobsAndKeys = active.compactMap { job in
			resourceKey(for: job).map { (job: job, key: $0) }
		}
		let currentKeys = try ledger.currentResourceKeys(
			from: Set(jobsAndKeys.map(\.key)),
			deviceId: configuration.source.id,
			includePhotos: configuration.includePhotos,
			includeVideos: configuration.includeVideos
		)
		let retainedJobsAndKeys = jobsAndKeys.filter { job, key in
			currentKeys.contains(key)
				&& configuration.matchesUploadDestination(job.destination, grant: grant)
		}
		let retainedJobs = Set(retainedJobsAndKeys.map { ObjectIdentifier($0.job) })
		let obsolete = active.filter { job in
			!retainedJobs.contains(ObjectIdentifier(job))
		}
		var cancelledJobs = Set<ObjectIdentifier>()
		if !obsolete.isEmpty {
			try PHPhotoLibrary.shared().performChangesAndWait {
				for job in obsolete {
					guard let request = PHAssetResourceUploadJobChangeRequest(for: job) else { continue }
					request.cancel()
					cancelledJobs.insert(ObjectIdentifier(job))
				}
			}
		}
		let remaining = active.filter { job in
			!cancelledJobs.contains(ObjectIdentifier(job))
		}
		let remainingKeys = Set(remaining.compactMap(resourceKey))
		let releasedKeys = Set(
			obsolete
				.filter { cancelledJobs.contains(ObjectIdentifier($0)) }
				.compactMap(resourceKey)
		).subtracting(remainingKeys)
		if !releasedKeys.isEmpty {
			try ledger.releaseRegisteredResources(
				releasedKeys
			)
		}

		try ledger.markResourcesRegistered(remainingKeys)
		try ledger.releaseOrphanedRegisteredResources(
			deviceId: configuration.source.id,
			activeResourceKeys: remainingKeys,
			includePhotos: configuration.includePhotos,
			includeVideos: configuration.includeVideos
		)
		return remaining
	}

	private func jobs(for action: PHAssetResourceUploadJob.Action) -> [PHAssetResourceUploadJob] {
		let result = PHAssetResourceUploadJob.fetchJobs(action: action, options: nil)
		return (0..<result.count).map { result.object(at: $0) }
	}

	private struct JobStateCounts {
		var registered = 0
		var pending = 0
		var failed = 0
		var succeeded = 0
		var cancelled = 0

		init(_ jobs: [PHAssetResourceUploadJob]) {
			for job in jobs {
				switch job.state {
				case .registered:
					registered += 1
				case .pending:
					pending += 1
				case .failed:
					failed += 1
				case .succeeded:
					succeeded += 1
				case .cancelled:
					cancelled += 1
				@unknown default:
					break
				}
			}
		}
	}

	private func resourceKey(for job: PHAssetResourceUploadJob) -> String? {
		let value = job.destination.value(forHTTPHeaderField: "X-Umbrel-Photo-Backup-Key")
		guard let value, value.utf8.count == 64, value.utf8.allSatisfy({ byte in
			(byte >= 48 && byte <= 57) || (byte >= 97 && byte <= 102)
		}) else { return nil }
		return value
	}

	// MARK: - Job creation

	private func createJobs(
		upTo limit: Int,
		ledger: PhotoBackupLedger,
		configuration: PhotoBackupConfiguration,
		grant: String
	) throws -> Int {
		guard limit > 0 else { return 0 }
		let candidates = try ledger.nextAssets(
			deviceId: configuration.source.id,
			includePhotos: configuration.includePhotos,
			includeVideos: configuration.includeVideos,
			limit: limit
		)
		var remainingSlots = limit
		var created = 0

		for work in candidates where remainingSlots > 0 {
			guard !isTerminated else { break }
			guard
				let asset = PHAsset.fetchAssets(withLocalIdentifiers: [work.localIdentifier], options: nil).firstObject
			else {
				try ledger.markDeleted(deviceId: configuration.source.id, localIdentifier: work.localIdentifier)
				continue
			}

			let resources = selectedResources(for: asset)
			guard !resources.isEmpty else {
				try ledger.markAssetFailed(
					deviceId: configuration.source.id,
					localIdentifier: work.localIdentifier,
					revision: work.revision,
					message: "This asset has no uploadable resource"
				)
				continue
			}

			let plans = resources.map { plan(for: $0, work: work, configuration: configuration) }
			try ledger.prepareAsset(
				deviceId: configuration.source.id,
				localIdentifier: work.localIdentifier,
				revision: work.revision,
				resources: plans.map(\.ledgerPlan)
			)
			let stored = try ledger.resources(
				deviceId: configuration.source.id,
				localIdentifier: work.localIdentifier,
				revision: work.revision
			)
			let pendingKeys = Set(stored.filter { $0.state == PhotoBackupLedger.resourcePending }.map(\.resourceKey))
			let pending = plans.filter { pendingKeys.contains($0.resourceKey) }.prefix(remainingSlots)
			for plan in pending {
				let request = try destination(for: plan, configuration: configuration, grant: grant)
				try PHPhotoLibrary.shared().performChangesAndWait {
					PHAssetResourceUploadJobChangeRequest.creationRequestForJob(
						destination: request,
						resource: plan.resource
					)
				}
				try ledger.markResourcesRegistered([plan.resourceKey])
				created += 1
				remainingSlots -= 1
			}
		}
		return created
	}

	private struct PlannedResource {
		let resource: PHAssetResource
		let resourceKey: String
		let fileExtension: String
		let filename: String
		let sourceCreationDateMilliseconds: Int64?
		let destinationPath: String

		var ledgerPlan: PhotoBackupLedger.ResourcePlan {
			.init(resourceKey: resourceKey, filename: filename, destinationPath: destinationPath)
		}
	}

	private struct SelectedResource {
		let resource: PHAssetResource
		let role: ResourceRole
	}

	private enum ResourceRole: String {
		case photo
		case livePhotoMotion = "live-photo-motion"
		case video
	}

	private func plan(
		for selected: SelectedResource,
		work: PhotoBackupLedger.AssetWork,
		configuration: PhotoBackupConfiguration
	) -> PlannedResource {
		let resource = selected.resource
		// Avoid the resettable ledger revision: edits change the key, while each
		// Live Photo component gets its own stable identity.
		let key = stableKey(
			namespace: "umbrel-photo-resource-v1",
			parts: [
				configuration.source.id,
				work.localIdentifier,
				String(work.contentVersionDate.timeIntervalSince1970.bitPattern, radix: 16),
				selected.role.rawValue,
			]
		)
		let originalExtension = URL(fileURLWithPath: resource.originalFilename).pathExtension.lowercased()
		let preferredExtension = resource.contentType.preferredFilenameExtension?.lowercased() ?? ""
		let fileExtension = validFileExtension(originalExtension)
			?? validFileExtension(preferredExtension)
			?? "bin"
		// umbreld owns the physical destination. The stable resource key makes retries
		// idempotent while the original filename remains display metadata.
		let destinationPath = "\(configuration.source.id)/\(key).\(fileExtension)"
		return PlannedResource(
			resource: resource,
			resourceKey: key,
			fileExtension: fileExtension,
			filename: resource.originalFilename,
			sourceCreationDateMilliseconds: sourceCreationDateMilliseconds(work.creationDate),
			destinationPath: destinationPath
		)
	}

	private func sourceCreationDateMilliseconds(_ date: Date) -> Int64? {
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

	private func destination(
		for plan: PlannedResource,
		configuration: PhotoBackupConfiguration,
		grant: String
	) throws -> URLRequest {
		guard
			configuration.isTailscaleDestination,
			let base = URL(string: configuration.uploadBaseURL),
			base.scheme == "http",
			base.host != nil
		else { throw ExtensionError.invalidUploadBase }
		// This per-job URL is the real upload destination. The extension's signed
		// BackgroundUploadURLBase is necessarily static; project.yml records the
		// physical testing that verifies PhotoKit accepts this per-configuration host.
		let url = base.appending(path: "/api/photos/upload")

		var request = URLRequest(url: url)
		request.httpMethod = "POST"
		request.allowsCellularAccess = configuration.allowsCellularAccess
		// PhotoKit owns upload scheduling and already considers device power. Its
		// upload-job API has no external-power constraint, so we intentionally don't
		// offer a charging-only preference that the system can't reliably enforce.
		request.setValue("Bearer \(grant)", forHTTPHeaderField: "Authorization")
		request.setValue(plan.resourceKey, forHTTPHeaderField: "X-Umbrel-Photo-Backup-Key")
		request.setValue(plan.fileExtension, forHTTPHeaderField: "X-Umbrel-Photo-Backup-Extension")
		// Header values are ASCII; Base64 preserves PhotoKit's Unicode filename exactly.
		request.setValue(
			Data(plan.filename.utf8).base64EncodedString(),
			forHTTPHeaderField: "X-Umbrel-Photo-Original-Filename-Base64"
		)
		if let creationDate = plan.sourceCreationDateMilliseconds {
			request.setValue(
				String(creationDate),
				forHTTPHeaderField: "X-Umbrel-Photo-Creation-Date-Ms"
			)
		}
		request.setValue(
			plan.resource.contentType.preferredMIMEType ?? "application/octet-stream",
			forHTTPHeaderField: "Content-Type"
		)
		return request
	}

	private func selectedResources(for asset: PHAsset) -> [SelectedResource] {
		let resources = PHAssetResource.assetResources(for: asset)
		var selected = [SelectedResource]()
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
				selected.append(.init(resource: primary, role: .photo))
			}
			if asset.mediaSubtypes.contains(.photoLive),
				let paired = resources.first(where: { $0.type == .fullSizePairedVideo })
					?? resources.first(where: { $0.type == .pairedVideo })
			{
				selected.append(.init(resource: paired, role: .livePhotoMotion))
			}
		} else if asset.mediaType == .video,
			let primary = resources.first(where: { $0.type == .fullSizeVideo })
				?? resources.first(where: { $0.type == .video })
		{
			selected.append(.init(resource: primary, role: .video))
		}
		return selected
	}

	private func stableKey(namespace: String, parts: [String]) -> String {
		let material = ([namespace] + parts).joined(separator: "\0")
		return SHA256.hash(data: Data(material.utf8)).map { String(format: "%02x", $0) }.joined()
	}

	private func validFileExtension(_ value: String) -> String? {
		guard !value.isEmpty, value.utf8.count <= 16,
			value.utf8.allSatisfy({ byte in
				(byte >= 48 && byte <= 57) || (byte >= 97 && byte <= 122)
			})
		else { return nil }
		return value
	}

	// MARK: - Shared presentation

	private func statistics(
		ledger: PhotoBackupLedger,
		configuration: PhotoBackupConfiguration
	) throws -> PhotoBackupStatistics {
		try ledger.statistics(
			deviceId: configuration.source.id,
			includePhotos: configuration.includePhotos,
			includeVideos: configuration.includeVideos
		)
	}

	private func publish(
		_ phase: PhotoBackupPhase,
		sourceId: String,
		statistics: PhotoBackupStatistics? = nil,
		issue: PhotoBackupIssue? = nil,
		error: String? = nil
	) {
		let previous = PhotoBackupStore.snapshot
		PhotoBackupStore.publish(PhotoBackupSnapshot(
			phase: phase,
			issue: issue,
			lastError: error,
			sourceId: sourceId,
			statistics: statistics ?? (previous.sourceId == sourceId ? previous.statistics : nil)
		))
	}


	private enum ExtensionError: LocalizedError {
		case invalidUploadBase
		case invalidChangeToken

		var errorDescription: String? {
			switch self {
			case .invalidUploadBase:
				"The extension does not declare a valid upload destination"
			case .invalidChangeToken:
				"The saved Photo Library change token is invalid"
			}
		}
	}
}
