import Foundation

// The photo grid asks only about thumbnails SwiftUI has made visible. SQLite's
// primary key makes each lookup cheap, and the bounded cache prevents scrolling a
// very large library from retaining one entry per asset for the app's lifetime.
public actor PhotoBackupReceiptCache {
	private enum Entry {
		case record(PhotoBackupLedger.AssetRecord)
		case missing
	}

	private struct Context: Equatable {
		let sourceId: String
		let revision: Date
	}

	private let ledger: PhotoBackupLedger?
	private let capacity: Int
	private var context: Context?
	private var entries: [String: Entry] = [:]
	private var insertionOrder: [String] = []

	public init(ledgerURL: URL?, capacity: Int = 512) {
		ledger = ledgerURL.flatMap(PhotoBackupLedger.init(url:))
		self.capacity = max(1, capacity)
	}

	public func record(
		sourceId: String,
		revision: Date,
		localIdentifier: String
	) -> PhotoBackupLedger.AssetRecord? {
		let nextContext = Context(sourceId: sourceId, revision: revision)
		// Cancelled SwiftUI tasks can reach the actor after a newer refresh. Never
		// let an obsolete request roll the shared cache back to an older ledger view.
		if let context, revision < context.revision { return nil }
		if context != nextContext {
			context = nextContext
			entries.removeAll(keepingCapacity: true)
			insertionOrder.removeAll(keepingCapacity: true)
		}

		if let entry = entries[localIdentifier] {
			switch entry {
			case .record(let record): return record
			case .missing: return nil
			}
		}

		guard let ledger else { return nil }
		let record: PhotoBackupLedger.AssetRecord?
		do {
			record = try ledger.assetRecord(deviceId: sourceId, localIdentifier: localIdentifier)
		} catch {
			// A transient WAL/IO failure isn't proof that an asset lacks a receipt.
			// Don't poison the cache with a false miss.
			return nil
		}
		entries[localIdentifier] = record.map(Entry.record) ?? .missing
		insertionOrder.append(localIdentifier)
		if entries.count > capacity {
			let evicted = insertionOrder.removeFirst()
			entries.removeValue(forKey: evicted)
		}
		return record
	}

	// Everything that couldn't back up, read here so it's off the main thread like the
	// receipts. Nil when the ledger can't be read, which doesn't mean nothing failed.
	public func failedAssets(
		sourceId: String,
		includePhotos: Bool,
		includeVideos: Bool
	) -> [PhotoBackupLedger.FailedAsset]? {
		try? ledger?.failedAssets(deviceId: sourceId, includePhotos: includePhotos, includeVideos: includeVideos)
	}

	var cachedEntryCount: Int { entries.count }
}
