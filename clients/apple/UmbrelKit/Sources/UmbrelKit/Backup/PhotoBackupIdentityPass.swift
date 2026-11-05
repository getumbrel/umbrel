import Foundation

// Names the files this iPhone sent before uploads carried their iCloud identities, once,
// so an iPhone restored from this one, continuing its backup, can later claim them
// instead of sending them again.
//
// Only unedited files are named. Every iPhone on an iCloud library has the same
// original, but an edit is each iPhone's own rendition.
public final class PhotoBackupIdentityPass {
	public enum Outcome: Equatable, Sendable {
		case completed
		// Stopped, or the Umbrel couldn't be reached. Running again starts over.
		case interrupted
		// The Umbrel can't take identities, as before umbrelOS could claim, or kept failing to
		case declined
	}

	// What the pass reads and asks through. The app wires these to PhotoKit and the
	// Umbrel; tests replace them.
	public struct Environment {
		public var ingest: () throws -> PhotoBackupAppPass.Ingestion
		// The files of these assets still in the library, each with the iCloud identity of
		// an unedited one
		public var identify: ([PhotoBackupLedger.AssetWork]) throws -> [Umbreld.PhotoBackupResourceClaim]
		public var claim: ([Umbreld.PhotoBackupResourceClaim]) async throws -> [Umbreld.PhotoBackupResourceReceipt]

		public init(
			ingest: @escaping () throws -> PhotoBackupAppPass.Ingestion,
			identify: @escaping ([PhotoBackupLedger.AssetWork]) throws -> [Umbreld.PhotoBackupResourceClaim],
			claim: @escaping ([Umbreld.PhotoBackupResourceClaim]) async throws -> [Umbreld.PhotoBackupResourceReceipt]
		) {
			self.ingest = ingest
			self.identify = identify
			self.claim = claim
		}
	}

	// A Live Photo has two files, so a page's files always fit one request
	private static let assetsPerPage = PhotoBackupUpload.claimsPerRequest / 2

	private let sourceId: String
	private let includePhotos: Bool
	private let includeVideos: Bool
	private let ledger: PhotoBackupLedger
	private let environment: Environment
	// Seconds before asking again after the Umbrel answers with an error
	private let retryDelays: [TimeInterval]
	private let stopLock = NSLock()
	private var stopped = false

	public init(
		sourceId: String,
		includePhotos: Bool,
		includeVideos: Bool,
		ledger: PhotoBackupLedger,
		environment: Environment,
		retryDelays: [TimeInterval] = [2, 10]
	) {
		self.sourceId = sourceId
		self.includePhotos = includePhotos
		self.includeVideos = includeVideos
		self.ledger = ledger
		self.environment = environment
		self.retryDelays = retryDelays
	}

	// Ends the pass after the request in flight
	public func stop() {
		stopLock.withLock { stopped = true }
	}

	private var isStopped: Bool {
		stopLock.withLock { stopped } || Task.isCancelled
	}

	public func run() async throws -> Outcome {
		// A ledger behind the library would name a file sent before an edit that has
		// since been reverted with the original's identity
		while true {
			if isStopped { return .interrupted }
			if try environment.ingest() == .complete { break }
		}
		var row: Int64 = 0
		while true {
			if isStopped { return .interrupted }
			let page = try ledger.assetWork(
				deviceId: sourceId,
				states: [.prepared, .uploaded],
				includePhotos: includePhotos,
				includeVideos: includeVideos,
				after: row,
				limit: Self.assetsPerPage
			)
			let identified = try environment.identify(page.assets).filter { $0.cloudIdentifier != nil }
			// Only files the Umbrel has. A claim names those and matches nothing else.
			let sent = try ledger.succeededResourceKeys(from: Set(identified.map(\.resourceKey)))
			let claims = identified.filter { sent.contains($0.resourceKey) }
			if !claims.isEmpty, let ended = await send(claims) { return ended }
			guard let next = page.nextRow else { return .completed }
			row = next
		}
	}

	// Nil once the Umbrel took them
	private func send(_ claims: [Umbreld.PhotoBackupResourceClaim]) async -> Outcome? {
		var attempt = 0
		while true {
			do {
				_ = try await environment.claim(claims)
				return nil
			} catch is CancellationError {
				return .interrupted
			} catch let error as Umbreld.Error where (400..<500).contains(error.status) {
				// umbrelOS without claims answers 401. Asking again won't change that.
				return .declined
			} catch let error as Umbreld.Error where error.status >= 500 {
				// An error from the Umbrel can pass, so it's asked again
				guard attempt < retryDelays.count else { return .declined }
				guard await pause(retryDelays[attempt]) else { return .interrupted }
				attempt += 1
			} catch {
				return .interrupted
			}
		}
	}

	// False when the pass is stopped while it waits
	private func pause(_ seconds: TimeInterval) async -> Bool {
		let end = Date().addingTimeInterval(seconds)
		while Date() < end, !isStopped {
			try? await Task.sleep(nanoseconds: 100_000_000)
		}
		return !isStopped
	}
}

#if os(iOS)
import Photos

@available(iOS 26.0, *)
extension PhotoBackupIdentityPass {
	// The PhotoKit side of `identify`
	public static func identifiedResources(
		_ works: [PhotoBackupLedger.AssetWork],
		sourceId: String
	) -> [Umbreld.PhotoBackupResourceClaim] {
		guard !works.isEmpty else { return [] }
		var library = [String: PHAsset]()
		PHAsset.fetchAssets(withLocalIdentifiers: works.map(\.localIdentifier), options: nil)
			.enumerateObjects { asset, _, _ in library[asset.localIdentifier] = asset }
		let cloudIdentifiers = PhotoBackupPlanner.cloudIdentifiers(forUnedited: Array(library.values))
		return works.flatMap { work -> [Umbreld.PhotoBackupResourceClaim] in
			guard let asset = library[work.localIdentifier] else { return [] }
			let cloudIdentifier = cloudIdentifiers[work.localIdentifier]
			return PhotoBackupPlanner.selectedResources(for: asset).map { selected in
				PhotoBackupPlanner.plan(selected.resource, role: selected.role, work: work, sourceId: sourceId)
					.claim(cloudIdentifier: cloudIdentifier)
			}
		}
	}
}
#endif
