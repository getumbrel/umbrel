import Photos
import SwiftUI
import UmbrelKit

// The media backup to this Umbrel includes. An item only counts as one that couldn't
// back up when it's one of these, so the Library's mark, Profile's count and its list
// can't disagree.
struct PhotoBackupMedia: Hashable {
	var photos = false
	var videos = false

	func includes(_ mediaType: PHAssetMediaType) -> Bool {
		mediaType == .video ? videos : photos
	}

	// With one turned off, what's backed up isn't everything on the iPhone
	var isEverything: Bool { photos && videos }
}

// What the app says about each reason. Automatic retries stop while backup is paused
// or stopped, so nothing promises one then.
extension PhotoBackupFailureReason {
	var title: String {
		switch self {
		case .unreadable: "Couldn\u{2019}t read from this iPhone"
		case .general: "Couldn\u{2019}t upload"
		case .nothingToUpload: "Can\u{2019}t be backed up"
		}
	}

	// Under the items that failed for this reason, however many there are
	func note(count: Int, retriesByItself: Bool) -> String {
		let these = count == 1 ? "this" : "these"
		let retries = retriesByItself ? " Umbrel tries \(these) again by itself." : ""
		return switch self {
		case .unreadable: "Often an iCloud original that hasn\u{2019}t downloaded.\(retries)"
		case .general: "Something went wrong sending \(these) to your Umbrel.\(retries)"
		case .nothingToUpload:
			"iOS has no file for \(count == 1 ? "this item" : "these items") that Umbrel can upload. Nothing you need to do."
		}
	}

	// About one item, in its Info
	func detail(retriesByItself: Bool) -> String {
		let retries = retriesByItself ? " Umbrel will try again by itself." : ""
		return switch self {
		case .unreadable:
			"This iPhone couldn\u{2019}t read the original, often because it\u{2019}s still in iCloud.\(retries)"
		case .general: "Something went wrong sending this to your Umbrel.\(retries)"
		case .nothingToUpload: "iOS has no file for this item that Umbrel can upload."
		}
	}

	// Trying again can't give an item a file to upload
	var offersRetry: Bool { self != .nothingToUpload }
}

// What Profile shows of the items that couldn't back up, read once for the count on its
// row and the sections of its page, so they can't disagree. It holds only the items the
// Library shows. One deleted since it failed stays failed in the ledger until a backup
// pass reads the library's changes, and there's nothing to show for it meanwhile.
@MainActor
@Observable
final class PhotoBackupFailureList {
	// Each reason's items, newest first, without the reasons nothing failed for. Nil
	// until they've been read.
	private(set) var assets: [PhotoBackupFailureReason: [PHAsset]]?
	// The ledger's list, before the photo library is asked which of it the Library shows
	private(set) var listed: [PhotoBackupLedger.FailedAsset]?

	var count: Int { assets?.values.reduce(0) { $0 + $1.count } ?? 0 }

	func readLedger(from model: MainModel) async {
		// Nothing to read while the ledger counts none
		guard model.photoBackupFailedCount > 0 else {
			listed = []
			return
		}
		// A ledger that can't be read just now keeps what's shown
		guard let failed = await model.photoBackupFailedAssets(), !Task.isCancelled else { return }
		listed = failed
	}

	func readLibrary() async {
		guard let listed else { return }
		guard !listed.isEmpty else {
			assets = [:]
			return
		}
		let lookup = Task.detached { Self.libraryAssets(listed.map(\.localIdentifier)) }
		let shown = await withTaskCancellationHandler { await lookup.value } onCancel: { lookup.cancel() }
		guard !Task.isCancelled else { return }
		assets = Self.grouped(listed, shown: shown)
	}

	// The ledger's failed items that `shown` has, by reason and in the ledger's order
	nonisolated static func grouped<Item>(
		_ failed: [PhotoBackupLedger.FailedAsset],
		shown: [String: Item]
	) -> [PhotoBackupFailureReason: [Item]] {
		var groups = [PhotoBackupFailureReason: [Item]]()
		for asset in failed {
			if let item = shown[asset.localIdentifier] { groups[asset.reason, default: []].append(item) }
		}
		return groups
	}

	// Those of `identifiers` the Library shows: the photos and videos PhotoLibraryModel
	// fetches, narrowed to them, so the viewer can open each one. None without access to
	// all photos, when the Library has none either. Reads the photo library, so it
	// belongs off the main thread.
	nonisolated static func libraryAssets(_ identifiers: [String]) -> [String: PHAsset] {
		guard PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized else { return [:] }
		var assets = [String: PHAsset]()
		for start in stride(from: 0, to: identifiers.count, by: 500) where !Task.isCancelled {
			let options = PHFetchOptions()
			options.predicate = NSPredicate(
				format: "mediaType IN %@ AND localIdentifier IN %@",
				[PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue],
				Array(identifiers[start..<min(start + 500, identifiers.count)])
			)
			PHAsset.fetchAssets(with: options).enumerateObjects { asset, _, _ in
				assets[asset.localIdentifier] = asset
			}
		}
		return assets
	}
}

extension View {
	// Keeps `list` current for as long as this view, Profile, is on screen
	func readingPhotoBackupFailures(into list: PhotoBackupFailureList) -> some View {
		modifier(PhotoBackupFailuresReader(list: list))
	}
}

// The ledger's list is read when Profile opens and when its count of failed items
// changes, or the backup or the media they're counted for. An upload changes none of
// those, so a backup in progress costs no reads. Which of them the Library shows is
// asked after such a read and when the photo library changes.
private struct PhotoBackupFailuresReader: ViewModifier {
	@Environment(MainModel.self) private var model
	let list: PhotoBackupFailureList

	func body(content: Content) -> some View {
		content
			.task(id: LedgerVersion(
				sourceId: model.photoBackup.sourceId,
				media: model.photoBackupMedia,
				failedCount: model.photoBackupFailedCount
			)) {
				await list.readLedger(from: model)
			}
			.task(id: LibraryVersion(listed: list.listed, library: model.photoLibrary.assets.revision)) {
				await list.readLibrary()
			}
	}

	private struct LedgerVersion: Hashable {
		let sourceId: String?
		let media: PhotoBackupMedia
		let failedCount: Int
	}

	private struct LibraryVersion: Equatable {
		let listed: [PhotoBackupLedger.FailedAsset]?
		let library: Int
	}
}

// Profile's page of what couldn't back up, by why. An item leaves when it's tried again
// and comes back if that fails too. One opens in the photo viewer on its Info, which
// names it and says why it couldn't back up.
struct PhotoBackupFailuresPage: View {
	@Environment(MainModel.self) private var model
	@Environment(PhotoBackupFailureList.self) private var list
	@Namespace private var photoViewerTransition
	@State private var viewerSelection: PhotoViewerSelection?

	var body: some View {
		ScrollView(showsIndicators: false) {
			VStack(alignment: .leading, spacing: 0) {
				if let assets = list.assets {
					Lead(count: list.count)
					ForEach(PhotoBackupFailureReason.allCases, id: \.self) { reason in
						if let failed = assets[reason] {
							section(reason, failed)
						}
					}
				}
			}
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding(.horizontal, 20)
			.padding(.top, 20)
			.padding(.bottom, 32)
		}
		.scrollEdgeEffectStyle(.soft, for: .top)
		.background(Color(hex: 0x1C1C1E).ignoresSafeArea())
		.navigationTitle("Couldn\u{2019}t Back Up")
		.navigationBarTitleDisplayMode(.inline)
		.fullScreenCover(item: $viewerSelection) { selection in
			PhotoViewer(
				initialIndex: selection.index,
				initialAssetIdentifier: selection.assetIdentifier,
				transitionNamespace: photoViewerTransition,
				showsInfo: true,
				backLabel: "Back"
			)
		}
	}

	// "Backed up" rather than "on your Umbrel": an edited photo or a Live Photo can have
	// an older or partial copy there. With nothing left to list, only a backup that's up
	// to date has backed everything up: an item being tried again has left the list too,
	// and the status says so. Nor is it everything while photos or videos are turned off.
	static func lead(count: Int, status: MainModel.PhotoBackupStatus, media: PhotoBackupMedia) -> String {
		let everythingElse = status == .upToDateExceptFailures && media.isEverything
			? " Everything else from this iPhone is backed up."
			: ""
		switch count {
		case 0:
			return status == .upToDate && media.isEverything ? "Everything from this iPhone is backed up." : status.text
		case 1:
			return "This item isn\u{2019}t backed up yet." + everythingElse
		default:
			return "These \(count.formatted()) items aren\u{2019}t backed up yet." + everythingElse
		}
	}

	private func section(_ reason: PhotoBackupFailureReason, _ failed: [PHAsset]) -> some View {
		SettingsSection(reason.title, value: failed.count.formatted()) {
			VStack(alignment: .leading, spacing: 0) {
				grid(failed)
					.padding(8)
				Note(reason: reason, count: failed.count)
					.padding(.horizontal, 16)
					.padding(.top, 4)
					// PillButton keeps a 7pt margin under its capsule for its 44pt tap target
					.padding(.bottom, reason.offersRetry ? 5 : 12)
			}
			.frame(maxWidth: .infinity, alignment: .leading)
		}
	}

	// Lazy, so thousands of items cost only the thumbnails on screen
	private func grid(_ failed: [PHAsset]) -> some View {
		let columns = 3
		let rows = (failed.count + columns - 1) / columns
		return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: columns), spacing: 4) {
			ForEach(Array(failed.enumerated()), id: \.element.localIdentifier) { index, asset in
				FailedAssetTile(
					asset: asset,
					// A single short row rounds its own last tile
					shape: Bento.tile(
						row: index / columns,
						col: index % columns,
						rows: rows,
						cols: min(columns, failed.count)
					),
					imageManager: model.photoLibrary.imageManager,
					receiptCache: model.photoBackupReceipts,
					transitionNamespace: photoViewerTransition,
					open: open
				)
			}
		}
	}

	// The viewer pages through the library, so it opens where the library has the asset.
	// One that left the library a moment ago, before the list caught up, opens nothing.
	private func open(_ asset: PHAsset) {
		guard let index = model.photoLibrary.assets.index(of: asset) else { return }
		viewerSelection = PhotoViewerSelection(index: index, assetIdentifier: asset.localIdentifier)
	}

	// The first line and each section's note follow backup's status, which changes with
	// every upload. They're views of their own so that redraws them and not the grids.
	private struct Lead: View {
		@Environment(MainModel.self) private var model
		let count: Int

		var body: some View {
			Text(PhotoBackupFailuresPage.lead(count: count, status: model.photoBackupStatus, media: model.photoBackupMedia))
				.font(.subheadline)
				.foregroundStyle(Theme.gray)
				.fixedSize(horizontal: false, vertical: true)
				.padding(.bottom, 6)
		}
	}

	private struct Note: View {
		@Environment(MainModel.self) private var model
		let reason: PhotoBackupFailureReason
		let count: Int

		var body: some View {
			VStack(alignment: .leading, spacing: 4) {
				Text(reason.note(count: count, retriesByItself: model.photoBackupRetriesFailuresByItself))
					.font(.footnote.weight(.medium))
					.foregroundStyle(Theme.gray)
					.fixedSize(horizontal: false, vertical: true)
				if reason.offersRetry {
					PillButton(
						title: "Try Again",
						isLoading: model.photoBackupRetryInProgress,
						action: model.retryFailedPhotoBackups
					)
				}
			}
		}
	}
}

// One item that couldn't back up, which opens in the viewer. One Photos has no picture
// for shows the file's name instead, so it can still be told apart.
struct FailedAssetTile: View {
	let asset: PHAsset
	let shape: UnevenRoundedRectangle
	let imageManager: PHCachingImageManager
	let receiptCache: PhotoBackupReceiptCache
	let transitionNamespace: Namespace.ID
	let open: (PHAsset) -> Void
	@State private var hasNoPicture = false
	// The file's name, or the date of an asset that has no file. Read only when there's
	// no picture to show.
	@State private var caption: String?

	var body: some View {
		Button {
			open(asset)
		} label: {
			AssetThumbnail(
				asset: asset,
				imageManager: imageManager,
				shape: shape,
				receiptCache: receiptCache,
				// No mark: everything here failed
				backupSourceId: nil,
				backupRevision: .distantPast,
				backupMedia: PhotoBackupMedia(),
				thumbnailTargetSize: CGSize(width: 300, height: 300),
				hasNoPicture: $hasNoPicture
			)
			.overlay {
				if hasNoPicture { fileLabel }
			}
			// A picture is cropped to its tile, and so is where a tap lands
			.contentShape([.interaction, .accessibility], shape)
		}
		.buttonStyle(.plain)
		// What the tile shows in place of a picture, and otherwise what the Library calls the item
		.accessibilityLabel("\(caption ?? photoAccessibilityLabel(for: asset)), Couldn\u{2019}t back up")
		.accessibilityHint("Opens full screen")
		.matchedTransitionSource(id: asset.localIdentifier, in: transitionNamespace)
		.task(id: hasNoPicture) {
			guard hasNoPicture else { return }
			let asset = asset
			let name = await Task.detached { asset.namingResource?.originalFilename }.value
			caption = name ?? asset.creationDate?.formatted(date: .abbreviated, time: .omitted)
		}
	}

	private var fileLabel: some View {
		VStack(spacing: 6) {
			Image(systemName: "doc")
				.font(.system(size: 22))
			if let caption {
				Text(caption)
					.font(.caption2.weight(.medium))
					.multilineTextAlignment(.center)
					.lineLimit(2)
					.truncationMode(.middle)
					// Two lines of text any larger don't fit a tile
					.dynamicTypeSize(...DynamicTypeSize.accessibility2)
			}
		}
		.foregroundStyle(Theme.gray)
		.padding(.horizontal, 8)
	}
}
