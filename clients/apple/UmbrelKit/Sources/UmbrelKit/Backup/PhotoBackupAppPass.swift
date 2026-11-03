import Foundation

// The app's own uploader, which backs up whenever the app is open so people see it
// happen. It runs the extension's state machine without upload jobs: bring the ledger
// up to date, apply the user's retry requests, then send the newest pending resources
// one at a time over the Umbrel's pinned connection until the work, the route or the
// app's time runs out. Every step is durable before the next, so a pass can stop
// anywhere and the next one resumes.
//
// Before each batch it asks the Umbrel which of the files this backup already has, from
// an earlier install of the app or the iPhone this one was restored from, and records
// those as backed up instead of sending them.
//
// With Tailscale, PhotoKit's extension also uploads in the background from the same
// ledger. Both may send a file; umbreld keeps one copy and a receipt is never undone.
public final class PhotoBackupAppPass {
	public enum Outcome: Equatable, Sendable {
		// Nothing left to do
		case completed
		// Inventory or retried resources remain; run another pass now
		case moreWork
		// No route reached the Umbrel; try again later or when the network changes
		case unreachable
		// The Umbrel couldn't take uploads for now; try again later
		case retryLater
		// Paused until the user frees storage or sets backup up again
		case waitingForUser
	}

	public enum Ingestion: Equatable, Sendable {
		case complete
		case moreWork
		// The library's change history was lost; the next pass inventories it again
		case restart
	}

	// One file of an asset, ready to send
	public struct Resource {
		public let plan: PhotoBackupLedger.ResourcePlan
		public let headers: [String: String]
		// What the Umbrel is asked before the file uploads. Without it, it just uploads.
		public let claim: Umbreld.PhotoBackupResourceClaim?
		public let write: (URL) async throws -> Void

		public init(
			plan: PhotoBackupLedger.ResourcePlan,
			headers: [String: String],
			claim: Umbreld.PhotoBackupResourceClaim? = nil,
			write: @escaping (URL) async throws -> Void
		) {
			self.plan = plan
			self.headers = headers
			self.claim = claim
			self.write = write
		}
	}

	public enum Lookup {
		case removed
		// Empty when the asset has nothing to back up
		case resources([Resource])
	}

	// What the pass reads and sends through. The app wires these to PhotoKit and the
	// Umbrel; tests replace them.
	public struct Environment {
		public var ingest: () throws -> Ingestion
		public var lookup: (PhotoBackupLedger.AssetWork, _ grant: String) throws -> Lookup
		// Proves a route to the Umbrel before anything is read from the library
		public var connect: () async throws -> Void
		public var upload: (_ file: URL, _ headers: [String: String]) async throws -> Umbreld.PhotoBackupUploadResponse
		// Which of these files this backup already has
		public var claim: ([Umbreld.PhotoBackupResourceClaim]) async throws -> [Umbreld.PhotoBackupResourceReceipt]
		// True once the app has left. The pass finishes the file in flight and ends,
		// like the extension when PhotoKit asks it to stop.
		public var shouldYield: () -> Bool

		public init(
			ingest: @escaping () throws -> Ingestion,
			lookup: @escaping (PhotoBackupLedger.AssetWork, _ grant: String) throws -> Lookup,
			connect: @escaping () async throws -> Void,
			upload: @escaping (_ file: URL, _ headers: [String: String]) async throws -> Umbreld.PhotoBackupUploadResponse,
			claim: @escaping ([Umbreld.PhotoBackupResourceClaim]) async throws -> [Umbreld.PhotoBackupResourceReceipt] = { _ in [] },
			shouldYield: @escaping () -> Bool = { false }
		) {
			self.ingest = ingest
			self.lookup = lookup
			self.connect = connect
			self.upload = upload
			self.claim = claim
			self.shouldYield = shouldYield
		}
	}

	// The shared presentation and retry requests the extension also reads
	public struct SharedState {
		public var snapshot: () -> PhotoBackupSnapshot
		public var publish: (PhotoBackupSnapshot) -> Void
		public var storageRetryRequested: (_ sourceId: String) -> Bool
		public var clearStorageRetryRequest: () -> Void
		public var recoveryRetryRequested: (_ sourceId: String) -> Bool
		public var clearRecoveryRetryRequest: (_ sourceId: String) -> Void

		public init(
			snapshot: @escaping () -> PhotoBackupSnapshot,
			publish: @escaping (PhotoBackupSnapshot) -> Void,
			storageRetryRequested: @escaping (_ sourceId: String) -> Bool,
			clearStorageRetryRequest: @escaping () -> Void,
			recoveryRetryRequested: @escaping (_ sourceId: String) -> Bool,
			clearRecoveryRetryRequest: @escaping (_ sourceId: String) -> Void
		) {
			self.snapshot = snapshot
			self.publish = publish
			self.storageRetryRequested = storageRetryRequested
			self.clearStorageRetryRequest = clearStorageRetryRequest
			self.recoveryRetryRequested = recoveryRetryRequested
			self.clearRecoveryRetryRequest = clearRecoveryRetryRequest
		}

		public static let store = SharedState(
			snapshot: { PhotoBackupStore.snapshot },
			publish: PhotoBackupStore.publish,
			storageRetryRequested: PhotoBackupStore.storageRetryRequested(for:),
			clearStorageRetryRequest: PhotoBackupStore.clearStorageRetryRequest,
			recoveryRetryRequested: PhotoBackupStore.recoveryRetryRequested(for:),
			clearRecoveryRetryRequest: PhotoBackupStore.clearRecoveryRetryRequest(for:)
		)
	}

	private enum Stop {
		case unreachable
		case authenticationRequired
		case insufficientStorage
		case temporaryFailures
		case yielded
	}

	private enum AssetResult {
		case uploaded
		// Nothing was sent: the asset is gone, has nothing to back up, or is already done
		case skipped
		// Sent, and answered with a failure that is this resource's own
		case failed
		case stopped(Stop)
	}

	private static let batchSize = 16
	// Temporary server failures in a row that end a pass
	private static let temporaryFailuresPerPass = 2

	private let configuration: PhotoBackupConfiguration
	private let grant: String
	private let ledger: PhotoBackupLedger
	private let environment: Environment
	private let state: SharedState
	private let directory: URL
	private let releasesOrphanedResources: Bool
	private var recovery: PhotoBackupRecoveryState
	private var authenticationRequired = false

	public init(
		configuration: PhotoBackupConfiguration,
		grant: String,
		ledger: PhotoBackupLedger,
		environment: Environment,
		state: SharedState = .store,
		directory: URL = FileManager.default.temporaryDirectory.appendingPathComponent("PhotoBackup", isDirectory: true),
		releasesOrphanedResources: Bool = true
	) {
		self.configuration = configuration
		self.grant = grant
		self.ledger = ledger
		self.environment = environment
		self.state = state
		self.directory = directory
		self.releasesOrphanedResources = releasesOrphanedResources
		recovery = PhotoBackupRecoveryState(snapshot: .disabled, sourceId: configuration.source.id, storageRetryRequested: false)
	}

	private var sourceId: String { configuration.source.id }

	// Throws only CancellationError. Cancelling stops the upload in flight, which stays
	// queued for the next pass.
	public func run() async throws -> Outcome {
		let snapshot = state.snapshot()
		let recoveryRetryRequested = state.recoveryRetryRequested(sourceId)
		let storedStorageRetry = state.storageRetryRequested(sourceId)
		recovery = PhotoBackupRecoveryState(
			snapshot: snapshot,
			sourceId: sourceId,
			storageRetryRequested: storedStorageRetry
		)
		// Reaching the Umbrel is checked by connect() before each pass sends anything. A
		// "waiting" phase may be the extension's, about Tailscale alone, so it doesn't
		// hold this pass back to one file.
		recovery.finishConnectivityRecoveryWithoutWork()
		authenticationRequired = snapshot.sourceId == sourceId && snapshot.issue == .authenticationRequired
		if storedStorageRetry, !recovery.storageRetryRequested {
			state.clearStorageRetryRequest()
		}
		// Copies left by an app that was killed mid-upload. One pass runs at a time.
		try? FileManager.default.removeItem(at: directory)
		do {
			// Without background uploads the extension is off, so a resource it left
			// registered has no job behind it. It scans the whole library, and nothing
			// registers more once the extension is off, so the runner asks once.
			if !sharesLedgerWithPhotoKit, releasesOrphanedResources {
				try ledger.releaseOrphanedRegisteredResources(
					deviceId: sourceId,
					activeResourceKeys: [],
					includePhotos: configuration.includePhotos,
					includeVideos: configuration.includeVideos
				)
			}
			let ingestion = try environment.ingest()
			try Task.checkCancellation()
			if ingestion == .restart {
				publishRecovery()
				return .moreWork
			}
			if recoveryRetryRequested {
				try requeueFailedAssets()
				state.clearRecoveryRetryRequest(sourceId)
				authenticationRequired = false
			}
			// An explicit storage retry sends one failed resource as a capacity probe.
			// Only a successful probe reopens the whole queue.
			if recovery.storagePaused, recovery.storageRetryRequested {
				try requeueFailedAssets()
				recovery.beginStorageProbe()
			}
			publishRecovery(try statistics())

			var uploadedAny = false
			let stop = authenticationRequired || recovery.storagePaused
				? nil
				: try await uploadPending(onUploaded: { uploadedAny = true })
			switch stop {
			case .authenticationRequired:
				authenticationRequired = true
			case .unreachable:
				publishRecovery(try statistics())
				return .unreachable
			case .temporaryFailures:
				// The resources stay in the ledger to try again, so there's nothing for the
				// user to do. A pass that got uploads through goes on at once: errors come in
				// bursts, and backing off would stall a large backup.
				let statistics = try statistics()
				publish(recovery.storageProbing ? recovery.phase : .waiting, statistics: statistics, issue: recovery.issue)
				return uploadedAny ? .moreWork : .retryLater
			case .yielded:
				publishRecovery(try statistics())
				return .moreWork
			case .insufficientStorage, nil:
				break
			}

			// Once everything else is backed up, give failed uploads another try
			var retryingFailures = false
			if ingestion == .complete,
				!authenticationRequired,
				!recovery.storagePaused,
				!recovery.storageProbing,
				!recovery.connectivityRecovering
			{
				retryingFailures = try ledger.requeueFailedAssetsAfterProgress(
					deviceId: sourceId,
					includePhotos: configuration.includePhotos,
					includeVideos: configuration.includeVideos
				)
			}
			let statistics = try statistics()
			let hasQueuedWork = statistics.queuedCount > 0 || statistics.preparedCount > 0
			let phase: PhotoBackupPhase
			if authenticationRequired {
				phase = .needsAttention
			} else if recovery.storagePaused || recovery.connectivityRecovering || recovery.storageProbing {
				phase = recovery.phase
			} else if statistics.failedCount > 0, !hasQueuedWork {
				phase = .needsAttention
			} else if ingestion == .moreWork || hasQueuedWork {
				phase = .waiting
			} else {
				phase = .upToDate
			}
			publish(phase, statistics: statistics, issue: currentIssue)
			if authenticationRequired || recovery.storagePaused { return .waitingForUser }
			return ingestion == .moreWork || retryingFailures ? .moreWork : .completed
		} catch is CancellationError {
			throw CancellationError()
		} catch where ledger.isStopped {
			// The app's time is up and nothing went wrong
			throw CancellationError()
		} catch {
			// A local failure, such as the ledger. The next pass starts over.
			if recoveryRetryRequested {
				state.clearRecoveryRetryRequest(sourceId)
			}
			if let issue = currentIssue {
				publish(.needsAttention, issue: issue)
			} else {
				let nsError = error as NSError
				publish(.needsAttention, error: "\(nsError.domain):\(nsError.code)")
			}
			return .retryLater
		}
	}

	// MARK: - Upload

	// PhotoKit's extension uploads from the same ledger in the background
	private var sharesLedgerWithPhotoKit: Bool { configuration.route == .tailscale }

	// Newest first. While a storage probe is open, one asset goes first and its answer
	// decides whether the queue reopens. Files PhotoKit holds for background upload go
	// last, so opening the app finishes the backup even while those jobs wait for
	// Tailscale.
	private func uploadPending(onUploaded: () -> Void) async throws -> Stop? {
		var connected = false
		var attempted = false
		var consecutiveTemporaryFailures = 0
		var heldByPhotoKit = false
		// Until an Umbrel that doesn't take claims answers one
		var claiming = true
		// Assets that sent nothing, or whose PhotoKit job keeps them. They wait for the
		// next pass instead of coming round again.
		var skipped = Set<String>()
		while true {
			try Task.checkCancellation()
			if environment.shouldYield() { return .yielded }
			let limit = recovery.storageProbing || recovery.connectivityRecovering ? 1 : Self.batchSize
			let found = heldByPhotoKit
				? try ledger.nextAssetsHeldByPhotoKit(
					deviceId: sourceId,
					includePhotos: configuration.includePhotos,
					includeVideos: configuration.includeVideos,
					limit: limit + skipped.count
				)
				: try ledger.nextAssets(
					deviceId: sourceId,
					includePhotos: configuration.includePhotos,
					includeVideos: configuration.includeVideos,
					limit: limit + skipped.count
				)
			let candidates = found.filter { !skipped.contains(Self.skipKey($0)) }.prefix(limit)
			guard !candidates.isEmpty else {
				// A storage probe is about the failed files, not PhotoKit's
				guard !heldByPhotoKit, sharesLedgerWithPhotoKit, !recovery.storageProbing else { break }
				heldByPhotoKit = true
				// Including those a PhotoKit job took while this pass was sending another
				skipped.removeAll()
				continue
			}
			if !connected {
				// Nothing is read from the library, which may download it from iCloud,
				// until the Umbrel answers
				do {
					try await environment.connect()
				} catch is CancellationError {
					throw CancellationError()
				} catch {
					return finish(PhotoBackupUpload.outcome(failure: error)) ?? .temporaryFailures
				}
				connected = true
				publishUploading()
			}
			var batch = [(work: PhotoBackupLedger.AssetWork, resources: [Resource])]()
			for work in candidates {
				try Task.checkCancellation()
				if environment.shouldYield() { return .yielded }
				if heldByPhotoKit { skipped.insert(Self.skipKey(work)) }
				guard let resources = try sendableResources(work, heldByPhotoKit: heldByPhotoKit) else {
					skipped.insert(Self.skipKey(work))
					continue
				}
				batch.append((work, resources))
			}
			// A storage probe has to send a file. One PhotoKit holds is claimed too, as its
			// job may have been made without an answer from the Umbrel.
			if claiming, !recovery.storageProbing {
				switch try await claim(batch.flatMap(\.resources)) {
				case .claimed(let keys):
					if !keys.isEmpty {
						attempted = true
						// The Umbrel answering is as good as an upload for a pass recovering its route
						recovery.observeTerminalBatch(foundStorageFailure: false, foundConnectivityFailure: false, hasTerminalJobs: true)
						onUploaded()
						publishUploading()
					}
					batch = batch.compactMap { asset in
						let unclaimed = asset.resources.filter { !keys.contains($0.plan.resourceKey) }
						return unclaimed.isEmpty ? nil : (asset.work, unclaimed)
					}
				case .declined:
					claiming = false
				case .unanswered:
					break
				}
			}
			for (work, resources) in batch {
				try Task.checkCancellation()
				if environment.shouldYield() { return .yielded }
				let probing = recovery.storageProbing
				switch try await upload(work, resources: resources, heldByPhotoKit: heldByPhotoKit) {
				case .skipped:
					skipped.insert(Self.skipKey(work))
					continue
				case .uploaded:
					attempted = true
					recovery.observeTerminalBatch(foundStorageFailure: false, foundConnectivityFailure: false, hasTerminalJobs: true)
					if probing { finishStorageProbe(.succeeded) }
					consecutiveTemporaryFailures = 0
					onUploaded()
				case .failed:
					attempted = true
					recovery.observeTerminalBatch(foundStorageFailure: false, foundConnectivityFailure: false, hasTerminalJobs: true)
					if probing { finishStorageProbe(.permanentFailure) }
					consecutiveTemporaryFailures = 0
				case .stopped(.temporaryFailures):
					attempted = true
					// The Umbrel answered, but a server error says nothing about storage
					if !probing {
						recovery.observeTerminalBatch(foundStorageFailure: false, foundConnectivityFailure: false, hasTerminalJobs: true)
					}
					consecutiveTemporaryFailures += 1
					if consecutiveTemporaryFailures >= Self.temporaryFailuresPerPass || probing {
						return .temporaryFailures
					}
				case .stopped(let stop):
					return stop
				}
				publishUploading()
			}
		}
		if !attempted, recovery.storageProbing {
			// The failed resource may have been removed or turned off while backup was paused
			state.clearStorageRetryRequest()
			recovery.finishStorageProbeWithoutWork()
		}
		if !attempted, recovery.connectivityRecovering {
			recovery.finishConnectivityRecoveryWithoutWork()
		}
		return nil
	}

	// The asset's files still to send, or nil when it has none: it's gone, has nothing
	// to back up, or is already done
	private func sendableResources(_ work: PhotoBackupLedger.AssetWork, heldByPhotoKit: Bool) throws -> [Resource]? {
		let resources: [Resource]
		switch try environment.lookup(work, grant) {
		case .removed:
			try ledger.markDeleted(deviceId: sourceId, localIdentifier: work.localIdentifier)
			return nil
		case .resources(let found):
			resources = found
		}
		guard !resources.isEmpty else {
			try ledger.markAssetFailed(
				deviceId: sourceId,
				localIdentifier: work.localIdentifier,
				revision: work.revision,
				message: "This asset has no uploadable resource"
			)
			return nil
		}
		try ledger.prepareAsset(
			deviceId: sourceId,
			localIdentifier: work.localIdentifier,
			revision: work.revision,
			resources: resources.map(\.plan)
		)
		let sendable = try sendableKeys(work, heldByPhotoKit: heldByPhotoKit)
		let found = resources.filter { sendable.contains($0.plan.resourceKey) }
		return found.isEmpty ? nil : found
	}

	private func sendableKeys(_ work: PhotoBackupLedger.AssetWork, heldByPhotoKit: Bool) throws -> Set<String> {
		let sendable = heldByPhotoKit ? PhotoBackupLedger.resourceRegistered : PhotoBackupLedger.resourcePending
		return Set(
			try ledger.resources(deviceId: sourceId, localIdentifier: work.localIdentifier, revision: work.revision)
				.filter { $0.state == sendable }
				.map(\.resourceKey)
		)
	}

	private enum ClaimAnswer {
		case claimed(Set<String>)
		// The Umbrel answered without claiming, as umbrelOS before claims does
		case declined
		// No answer it could use, as when the connection dropped or the Umbrel had an
		// error. The batch uploads, and the next one asks again.
		case unanswered
	}

	// Records the files this backup already has as backed up, so they aren't sent
	private func claim(_ resources: [Resource]) async throws -> ClaimAnswer {
		let claims = resources.compactMap(\.claim)
		guard !claims.isEmpty else { return .claimed([]) }
		let receipts: [Umbreld.PhotoBackupResourceReceipt]
		do {
			receipts = try await environment.claim(claims)
		} catch is CancellationError {
			throw CancellationError()
		} catch let error as Umbreld.Error where (400..<500).contains(error.status) {
			// umbrelOS before claims answers 401. A server error can pass, so the next
			// batch asks again.
			return .declined
		} catch {
			try Task.checkCancellation()
			return .unanswered
		}
		let requested = Set(claims.map(\.resourceKey))
		let confirmed = receipts.filter {
			requested.contains($0.resourceKey) && PhotoBackupLedger.isValidResourceByteCount($0.bytes)
		}
		try ledger.recordConfirmedResources(confirmed.map { .init(resourceKey: $0.resourceKey, bytes: $0.bytes) })
		return .claimed(Set(confirmed.map(\.resourceKey)))
	}

	// A file PhotoKit holds stays its job's. A receipt is recorded, and so is the Umbrel
	// refusing the file, which the job would hear too. Other failures are left to the
	// job, and don't end the pass.
	private func upload(
		_ work: PhotoBackupLedger.AssetWork,
		resources: [Resource],
		heldByPhotoKit: Bool
	) async throws -> AssetResult {
		// PhotoKit's extension may have taken a file since the batch was looked up
		let sendable = try sendableKeys(work, heldByPhotoKit: heldByPhotoKit)
		var uploaded = false
		var temporaryFailure = false
		var rejected = false
		for resource in resources where sendable.contains(resource.plan.resourceKey) {
			let key = resource.plan.resourceKey
			switch try await send(resource) {
			case .outcome(.succeeded(let bytes)):
				try ledger.recordResourceSucceeded(resourceKey: key, bytes: bytes)
				uploaded = true
			case .outcome(.rejected(let message)):
				try ledger.recordResourceFailed(resourceKey: key, message: message)
				rejected = true
			// Both are tried again once the rest of the backup catches up
			case .outcome(.temporaryFailure):
				guard !heldByPhotoKit else { continue }
				try ledger.recordResourceFailed(resourceKey: key, message: "The Umbrel couldn\u{2019}t save this file")
				temporaryFailure = true
			case .unreadable:
				// Like a server error, a library that can't hand over files, as with iCloud
				// unreachable or the iPhone out of space, ends the pass if it keeps happening
				guard !heldByPhotoKit else { continue }
				try ledger.recordResourceFailed(resourceKey: key, message: "Couldn\u{2019}t read this file from the photo library")
				temporaryFailure = true
			case .outcome(.insufficientStorage):
				if !heldByPhotoKit { try ledger.recordResourceFailed(resourceKey: key, message: "The Umbrel is out of space") }
				recovery.observeTerminalBatch(foundStorageFailure: true, foundConnectivityFailure: false, hasTerminalJobs: true)
				if recovery.storageProbing { finishStorageProbe(.insufficientStorage) }
				return .stopped(.insufficientStorage)
			case .outcome(.authenticationRequired):
				// The grant was refused, not the file, which stays queued
				_ = finish(.authenticationRequired)
				return .stopped(.authenticationRequired)
			case .outcome(.unreachable):
				_ = finish(.unreachable)
				return .stopped(.unreachable)
			}
		}
		// A Live Photo's still reaching the Umbrel is progress even if its motion didn't
		if uploaded { return .uploaded }
		if temporaryFailure { return .stopped(.temporaryFailures) }
		return rejected ? .failed : .skipped
	}

	private enum Sent {
		case outcome(PhotoBackupUpload.Outcome)
		// The library couldn't hand over the file
		case unreadable
	}

	private func send(_ resource: Resource) async throws -> Sent {
		try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
		let file = directory.appendingPathComponent(resource.plan.resourceKey)
		try? FileManager.default.removeItem(at: file)
		defer { try? FileManager.default.removeItem(at: file) }
		do {
			try await resource.write(file)
		} catch is CancellationError {
			throw CancellationError()
		} catch {
			try Task.checkCancellation()
			return .unreadable
		}
		try Task.checkCancellation()
		do {
			let response = try await environment.upload(file, resource.headers)
			return .outcome(PhotoBackupUpload.outcome(
				statusCode: response.statusCode,
				responseHeaders: response.headers,
				expectedResourceKey: resource.plan.resourceKey
			))
		} catch is CancellationError {
			throw CancellationError()
		} catch {
			try Task.checkCancellation()
			return .outcome(PhotoBackupUpload.outcome(failure: error))
		}
	}

	// The pass-ending answers that aren't about one resource
	private func finish(_ outcome: PhotoBackupUpload.Outcome) -> Stop? {
		switch outcome {
		case .unreachable:
			recovery.observeTerminalBatch(foundStorageFailure: false, foundConnectivityFailure: true, hasTerminalJobs: true)
			// Being away from the Umbrel doesn't answer the storage question
			if recovery.storageProbing { recovery.finishStorageProbe(.connectivityFailure) }
			return .unreachable
		case .authenticationRequired:
			if recovery.storageProbing { finishStorageProbe(.permanentFailure) }
			return .authenticationRequired
		case .succeeded, .insufficientStorage, .temporaryFailure, .rejected:
			return nil
		}
	}

	private func finishStorageProbe(_ outcome: PhotoBackupStorageProbeOutcome) {
		let hadRequest = recovery.storageRetryRequested
		recovery.finishStorageProbe(outcome)
		if hadRequest, !recovery.storageRetryRequested {
			state.clearStorageRetryRequest()
		}
	}

	private static func skipKey(_ work: PhotoBackupLedger.AssetWork) -> String {
		"\(work.localIdentifier)#\(work.revision)"
	}

	// MARK: - Ledger and presentation

	private func requeueFailedAssets() throws {
		try ledger.requeueFailedAssets(
			deviceId: sourceId,
			includePhotos: configuration.includePhotos,
			includeVideos: configuration.includeVideos
		)
	}

	private func statistics() throws -> PhotoBackupStatistics {
		try ledger.statistics(
			deviceId: sourceId,
			includePhotos: configuration.includePhotos,
			includeVideos: configuration.includeVideos
		)
	}

	private var currentIssue: PhotoBackupIssue? {
		recovery.issue ?? (authenticationRequired ? .authenticationRequired : nil)
	}

	private func publishUploading() {
		let phase: PhotoBackupPhase = recovery.storageProbing ? .checkingStorage : .uploading
		publish(phase, statistics: try? statistics(), issue: recovery.issue)
	}

	private func publishRecovery(_ statistics: PhotoBackupStatistics? = nil) {
		publish(authenticationRequired ? .needsAttention : recovery.phase, statistics: statistics, issue: currentIssue)
	}

	private func publish(
		_ phase: PhotoBackupPhase,
		statistics: PhotoBackupStatistics? = nil,
		issue: PhotoBackupIssue? = nil,
		error: String? = nil
	) {
		// A cancelled pass may belong to backup that was just turned off or moved,
		// whose snapshot isn't this pass's to write any more. A stopped ledger answers
		// nothing that's true of the backup.
		guard !Task.isCancelled, !ledger.isStopped else { return }
		let previous = state.snapshot()
		var phase = phase
		// PhotoKit's extension waits for Tailscale one job at a time while this phase
		// says so. Reaching the Umbrel another way says nothing about Tailscale, so only
		// its own probe ends that wait.
		if sharesLedgerWithPhotoKit,
			previous.sourceId == sourceId,
			previous.phase == .waitingForUmbrel,
			[.waiting, .uploading, .upToDate].contains(phase)
		{
			phase = .waitingForUmbrel
		}
		state.publish(PhotoBackupSnapshot(
			phase: phase,
			issue: issue,
			lastError: error,
			sourceId: sourceId,
			statistics: statistics ?? (previous.sourceId == sourceId ? previous.statistics : nil)
		))
	}
}
