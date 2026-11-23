import Observation
import Photos
import UmbrelKit

// One live view of the iPhone's photo library, shared by Home and Library. PhotoKit
// remains the owner of the collection; this wrapper only makes its fetch result
// observable to SwiftUI and updates it when the system reports library changes.
@MainActor
@Observable
final class PhotoLibraryModel: NSObject {
	struct ObservedChanges {
		let inserted: [PHAsset]
		let contentChanged: [PHAsset]
		let metadataChanged: [PHAsset]

		var isEmpty: Bool {
			inserted.isEmpty && contentChanged.isEmpty && metadataChanged.isEmpty
		}
	}

	struct Assets: RandomAccessCollection {
		typealias Index = Int
		typealias Element = PHAsset

		struct Move {
			let from: Int
			let to: Int
		}

		struct Change {
			let previousRevision: Int
			let hasIncrementalChanges: Bool
			let removedIndexes: IndexSet
			let insertedIndexes: IndexSet
			let changedIndexes: IndexSet
			let moves: [Move]
		}

		fileprivate let result: PHFetchResult<PHAsset>?
		let revision: Int
		let change: Change?

		var startIndex: Int { 0 }
		var endIndex: Int { result?.count ?? 0 }

		subscript(position: Int) -> PHAsset {
			precondition(position >= startIndex && position < endIndex)
			return result!.object(at: position)
		}

		// Nil for an asset the library doesn't hold
		func index(of asset: PHAsset) -> Int? {
			guard let index = result?.index(of: asset), index != NSNotFound else { return nil }
			return index
		}
	}

	private(set) var assets = Assets(result: nil, revision: 0, change: nil)
	private(set) var authorizationStatus = PHPhotoLibrary.authorizationStatus(for: .readWrite)
	private(set) var photoCount = 0
	private(set) var videoCount = 0
	@ObservationIgnored private var fetchResult: PHFetchResult<PHAsset>?
	@ObservationIgnored private var photoFetchResult: PHFetchResult<PHAsset>?
	@ObservationIgnored private var videoFetchResult: PHFetchResult<PHAsset>?
	@ObservationIgnored private var assetsRevision = 0
	// Don't create PhotoKit objects or register for library changes until the user
	// has granted access. Apple may present the system prompt on the first PhotoKit
	// operation that requires authorization, so launch should only query status.
	@ObservationIgnored lazy var imageManager = PHCachingImageManager()
	@ObservationIgnored private var isObservingChanges = false
	// MainModel uses PhotoKit's object-level change details to update the shared
	// backup ledger. Keep this as a callback instead of another observable
	// collection: PhotoKit's retained fetch result remains the only in-memory
	// representation of the library.
	@ObservationIgnored var onObservedChanges: ((ObservedChanges) -> Void)?

	var canReadLibrary: Bool {
		// Background resource uploads require full Photo Library access. Treat
		// Limited Access as an upgrade-needed state rather than a partial backup.
		authorizationStatus == .authorized
	}

	override init() {
		super.init()
		refresh()
	}

	deinit {
		if isObservingChanges {
			PHPhotoLibrary.shared().unregisterChangeObserver(self)
		}
	}

	func refresh() {
		let previousAuthorizationStatus = authorizationStatus
		authorizationStatus = PHPhotoLibrary.authorizationStatus(for: .readWrite)
		guard canReadLibrary else {
			if fetchResult != nil { replaceFetchResults(all: nil, photos: nil, videos: nil) }
			return
		}
		startObservingChangesIfNeeded()
		// The retained fetch result is kept current by PHPhotoLibraryChangeObserver.
		// Refetch only on first access or after authorization changes.
		guard fetchResult == nil || authorizationStatus != previousAuthorizationStatus else { return }

		let options = PHFetchOptions()
		options.predicate = NSPredicate(
			format: "mediaType IN %@",
			[PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue]
		)
		// Match the iPhone Photos library: chronological order, with the newest
		// photos at the bottom of the grid.
		options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
		replaceFetchResults(
			all: PHAsset.fetchAssets(with: options),
			photos: PHAsset.fetchAssets(with: .image, options: nil),
			videos: PHAsset.fetchAssets(with: .video, options: nil)
		)
	}

	private func startObservingChangesIfNeeded() {
		guard !isObservingChanges else { return }
		PHPhotoLibrary.shared().register(self)
		isObservingChanges = true
	}

	private func replaceFetchResults(
		all: PHFetchResult<PHAsset>?,
		photos: PHFetchResult<PHAsset>?,
		videos: PHFetchResult<PHAsset>?,
		changeDetails: PHFetchResultChangeDetails<PHAsset>? = nil,
		observedChanges: ObservedChanges? = nil
	) {
		let previousRevision = assetsRevision
		assetsRevision += 1
		let change: Assets.Change?
		if let changeDetails {
			var moves: [Assets.Move] = []
			changeDetails.enumerateMoves { from, to in
				moves.append(.init(from: from, to: to))
			}
			change = .init(
				previousRevision: previousRevision,
				hasIncrementalChanges: changeDetails.hasIncrementalChanges,
				removedIndexes: changeDetails.removedIndexes ?? [],
				insertedIndexes: changeDetails.insertedIndexes ?? [],
				changedIndexes: changeDetails.changedIndexes ?? [],
				moves: moves
			)
		} else {
			change = nil
		}
		fetchResult = all
		photoFetchResult = photos
		videoFetchResult = videos
		assets = Assets(result: all, revision: assetsRevision, change: change)
		// Each fetch contains a single media type, so its count doesn't invoke
		// countOfAssets(with:), which Apple documents as enumerating the result.
		photoCount = photos?.count ?? 0
		videoCount = videos?.count ?? 0
		if let observedChanges, !observedChanges.isEmpty {
			onObservedChanges?(observedChanges)
		}
	}

	private func apply(_ change: PHChange) {
		guard let fetchResult else { return }
		let allDetails = change.changeDetails(for: fetchResult)
		let all = allDetails?.fetchResultAfterChanges ?? fetchResult
		let detectedChanges: ObservedChanges?
		if let allDetails {
			detectedChanges = observedChanges(
				from: change,
				details: allDetails,
				previousResult: fetchResult
			)
		} else {
			detectedChanges = nil
		}
		let photos = photoFetchResult.flatMap {
			change.changeDetails(for: $0)?.fetchResultAfterChanges ?? $0
		}
		let videos = videoFetchResult.flatMap {
			change.changeDetails(for: $0)?.fetchResultAfterChanges ?? $0
		}
		guard all !== fetchResult || photos !== photoFetchResult || videos !== videoFetchResult else { return }
		replaceFetchResults(
			all: all,
			photos: photos,
			videos: videos,
			changeDetails: allDetails,
			observedChanges: detectedChanges
		)
	}

	private func observedChanges(
		from change: PHChange,
		details: PHFetchResultChangeDetails<PHAsset>,
		previousResult: PHFetchResult<PHAsset>
	) -> ObservedChanges? {
		guard details.hasIncrementalChanges else { return nil }
		var contentChanged = [PHAsset]()
		var metadataChanged = [PHAsset]()
		for asset in details.changedObjects {
			let previousIndex = previousResult.index(of: asset)
			guard previousIndex != NSNotFound else {
				// If PhotoKit can't supply the before object, preserve backup
				// correctness by treating the ambiguous update as content.
				contentChanged.append(asset)
				continue
			}
			let previousAsset = previousResult.object(at: previousIndex)
			// Apple defines this flag as whether the image or video content changed:
			// https://developer.apple.com/documentation/photos/phobjectchangedetails/assetcontentchanged
			if change.changeDetails(for: previousAsset)?.assetContentChanged == false {
				metadataChanged.append(asset)
			} else {
				contentChanged.append(asset)
			}
		}
		return ObservedChanges(
			inserted: details.insertedObjects,
			contentChanged: contentChanged,
			metadataChanged: metadataChanged
		)
	}
}

extension PhotoLibraryModel: PHPhotoLibraryChangeObserver {
	nonisolated func photoLibraryDidChange(_ changeInstance: PHChange) {
		Task { @MainActor [weak self] in
			self?.apply(changeInstance)
		}
	}
}
