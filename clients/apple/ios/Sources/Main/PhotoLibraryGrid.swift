import Observation
import Photos
import SwiftUI
import UIKit
import UmbrelKit

// UICollectionView reuses a small set of cells no matter how large the PhotoKit
// fetch becomes. The surrounding SwiftUI card owns presentation; this view owns
// only the high-volume grid and its thumbnail preheat window.
struct PhotoLibraryGrid: UIViewRepresentable {
	let assets: PhotoLibraryModel.Assets
	let imageManager: PHCachingImageManager
	let receiptCache: PhotoBackupReceiptCache
	let transitionNamespace: Namespace.ID
	let backupSourceId: String?
	let backupRevision: Date
	let columns: Int
	let rows: Int
	let bleeds: Bool
	let bottomContentInset: CGFloat
	let scrollToLatestRequest: Int
	let onNearLatestChange: (Bool) -> Void
	let onSelect: (_ index: Int, _ assetIdentifier: String) -> Void

	func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

	func makeUIView(context: Context) -> UICollectionView {
		let layout = UICollectionViewFlowLayout()
		layout.minimumInteritemSpacing = 4
		layout.minimumLineSpacing = 4
		layout.sectionInset = .zero
		layout.estimatedItemSize = .zero

		let collectionView = UICollectionView(frame: .zero, collectionViewLayout: layout)
		collectionView.backgroundColor = .clear
		collectionView.alwaysBounceVertical = false
		collectionView.contentInsetAdjustmentBehavior = .never
		collectionView.showsVerticalScrollIndicator = false
		collectionView.scrollsToTop = false
		collectionView.dataSource = context.coordinator
		collectionView.delegate = context.coordinator
		collectionView.register(PhotoCell.self, forCellWithReuseIdentifier: PhotoCell.reuseIdentifier)
		context.coordinator.collectionView = collectionView
		context.coordinator.revision = assets.revision
		context.coordinator.installFastScroller()
		context.coordinator.scheduleInitialPosition()
		return collectionView
	}

	func updateUIView(_ collectionView: UICollectionView, context: Context) {
		let coordinator = context.coordinator
		let previousRevision = coordinator.revision
		coordinator.parent = self
		coordinator.updatePresentation()
		collectionView.contentInset.bottom = bottomContentInset
		// After the data update, so the latest item is one UIKit already has
		defer { coordinator.handleScrollToLatestRequest() }

		guard previousRevision != assets.revision else {
			coordinator.refreshLayoutIfNeeded()
			return
		}

		let wasAtBottom = coordinator.isNearBottom
		coordinator.stopCachingThumbnails()
		coordinator.revision = assets.revision
		if coordinator.didSetInitialPosition,
			let change = assets.change,
			change.previousRevision == previousRevision,
			change.hasIncrementalChanges,
			change.applies(from: coordinator.loaded, to: assets.count) {
			collectionView.performBatchUpdates {
				if !change.removedIndexes.isEmpty {
					collectionView.deleteItems(at: change.removedIndexes.map { IndexPath(item: $0, section: 0) })
				}
				if !change.insertedIndexes.isEmpty {
					collectionView.insertItems(at: change.insertedIndexes.map { IndexPath(item: $0, section: 0) })
				}
			} completion: { _ in
				// PhotoKit reports changed indexes in the post-insertion/deletion
				// state, while UICollectionView expects reload indexes in the pre-
				// update state. Reconfigure visible changed cells after the batch,
				// as Apple recommends, instead of reloading them inside it.
				for index in change.changedIndexes {
					let indexPath = IndexPath(item: index, section: 0)
					if let cell = collectionView.cellForItem(at: indexPath) as? PhotoCell {
						coordinator.configure(cell, at: indexPath)
					}
				}
				coordinator.finishDataUpdate(stickToBottom: wasAtBottom)
			}
		} else {
			// UIKit reads the new count lazily, at its next layout.
			coordinator.loaded = nil
			collectionView.reloadData()
			coordinator.finishDataUpdate(stickToBottom: wasAtBottom)
		}
	}

	static func dismantleUIView(_ collectionView: UICollectionView, coordinator: Coordinator) {
		coordinator.stopCachingThumbnails()
	}

	@MainActor
	final class Coordinator: NSObject, UICollectionViewDataSource, UICollectionViewDelegateFlowLayout {
		var parent: PhotoLibraryGrid
		private let presentation: PhotoLibraryGridPresentation
		weak var collectionView: UICollectionView?
		var revision: Int
		// The revision and count UIKit last read from the data source.
		var loaded: (revision: Int, count: Int)?
		var didSetInitialPosition = false

		private var initialPositionScheduled = false
		private var lastScrollToLatestRequest: Int
		private var lastReportedNearLatest: Bool?
		private let fastScroller = PhotoLibraryFastScroller()
		private var previousPreheatRect = CGRect.zero
		private var cachedAssets: [String: PHAsset] = [:]
		private var cachedTargetSize = CGSize.zero
		private var previousGridWidth: CGFloat = 0

		init(parent: PhotoLibraryGrid) {
			self.parent = parent
			presentation = PhotoLibraryGridPresentation(parent: parent)
			revision = parent.assets.revision
			lastScrollToLatestRequest = parent.scrollToLatestRequest
			super.init()
			fastScroller.onScrub = { [weak self] progress in
				self?.scroll(to: progress)
			}
		}

		func installFastScroller() {
			guard let collectionView else { return }
			collectionView.addSubview(fastScroller)
			// A drag that begins on the thumb belongs to the scrubber; ordinary
			// gestures everywhere else continue to scroll or select the grid.
			collectionView.panGestureRecognizer.require(toFail: fastScroller.scrubGestureRecognizer)
			updateFastScroller()
		}

		func numberOfSections(in collectionView: UICollectionView) -> Int { 1 }

		func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int {
			let count = parent.assets.count
			loaded = (parent.assets.revision, count)
			return count
		}

		func collectionView(
			_ collectionView: UICollectionView,
			cellForItemAt indexPath: IndexPath
		) -> UICollectionViewCell {
			let cell = collectionView.dequeueReusableCell(
				withReuseIdentifier: PhotoCell.reuseIdentifier,
				for: indexPath
			)
			guard let cell = cell as? PhotoCell else { return cell }
			configure(cell, at: indexPath)
			return cell
		}

		fileprivate func configure(_ cell: PhotoCell, at indexPath: IndexPath) {
			guard parent.assets.indices.contains(indexPath.item) else { return }
			let asset = parent.assets[indexPath.item]
			cell.contentConfiguration = UIHostingConfiguration {
				PhotoLibraryGridCell(
					index: indexPath.item,
					asset: asset,
					imageManager: parent.imageManager,
					receiptCache: parent.receiptCache,
					transitionNamespace: parent.transitionNamespace,
					presentation: presentation
				)
				.id(asset.localIdentifier)
			}
			.margins(.all, 0)
			cell.accessibilityLabel = accessibilityLabel(for: asset)
			cell.accessibilityHint = "Opens full screen"
			cell.accessibilityTraits = .button
			cell.isAccessibilityElement = true
		}

		private func accessibilityLabel(for asset: PHAsset) -> String {
			let mediaDescription: String
			if asset.mediaSubtypes.contains(.photoLive) {
				mediaDescription = "Live Photo"
			} else {
				mediaDescription = asset.mediaType == .video ? "Video" : "Photo"
			}
			guard let creationDate = asset.creationDate else { return mediaDescription }
			return "\(mediaDescription), \(creationDate.formatted(date: .abbreviated, time: .shortened))"
		}

		func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
			collectionView.deselectItem(at: indexPath, animated: false)
			guard parent.assets.indices.contains(indexPath.item) else { return }
			parent.onSelect(indexPath.item, parent.assets[indexPath.item].localIdentifier)
		}

		func collectionView(
			_ collectionView: UICollectionView,
			layout collectionViewLayout: UICollectionViewLayout,
			sizeForItemAt indexPath: IndexPath
		) -> CGSize {
			let spacing = CGFloat(max(0, parent.columns - 1)) * 4
			let rawWidth = max(1, (collectionView.bounds.width - spacing) / CGFloat(parent.columns))
			let scale = collectionView.traitCollection.displayScale
			let width = floor(rawWidth * scale) / scale
			return CGSize(width: width, height: width)
		}

		func scrollViewDidScroll(_ scrollView: UIScrollView) {
			updateFastScroller()
			updateCachedAssets()
			reportNearLatestIfNeeded()
		}

		var isNearBottom: Bool {
			guard let collectionView else { return false }
			let visibleBottom = collectionView.contentOffset.y + collectionView.bounds.height
			return collectionView.contentSize.height - visibleBottom <= max(24, collectionView.bounds.height * 0.05)
		}

		func scheduleInitialPosition() {
			guard !initialPositionScheduled else { return }
			initialPositionScheduled = true
			Task { @MainActor [weak self] in
				guard let self, let collectionView else { return }
				collectionView.layoutIfNeeded()
				scrollToBottom()
				didSetInitialPosition = true
				updateFastScroller()
				updateCachedAssets(force: true)
				reportNearLatestIfNeeded()
			}
		}

		func finishDataUpdate(stickToBottom: Bool) {
			Task { @MainActor [weak self] in
				guard let self, let collectionView else { return }
				collectionView.layoutIfNeeded()
				if stickToBottom { scrollToBottom() }
				updateFastScroller()
				updateCachedAssets(force: true)
				reportNearLatestIfNeeded()
			}
		}

		func handleScrollToLatestRequest() {
			guard parent.scrollToLatestRequest != lastScrollToLatestRequest else { return }
			lastScrollToLatestRequest = parent.scrollToLatestRequest
			scrollToBottom(animated: true)
		}

		func refreshLayoutIfNeeded() {
			guard let collectionView else { return }
			let width = collectionView.bounds.width
			guard width > 0, abs(width - previousGridWidth) > 0.5 else { return }
			previousGridWidth = width
			collectionView.collectionViewLayout.invalidateLayout()
			stopCachingThumbnails()
			updatePresentation()
			Task { @MainActor [weak self] in
				self?.updateFastScroller()
				self?.updateCachedAssets(force: true)
			}
		}

		func stopCachingThumbnails() {
			guard !cachedAssets.isEmpty, cachedTargetSize != .zero else {
				previousPreheatRect = .zero
				return
			}
			parent.imageManager.stopCachingImages(
				for: Array(cachedAssets.values),
				targetSize: cachedTargetSize,
				contentMode: .aspectFill,
				options: PhotoThumbnailRequest.options()
			)
			cachedAssets.removeAll(keepingCapacity: true)
			previousPreheatRect = .zero
		}

		func updatePresentation() {
			if presentation.backupSourceId != parent.backupSourceId {
				presentation.backupSourceId = parent.backupSourceId
			}
			if presentation.backupRevision != parent.backupRevision {
				presentation.backupRevision = parent.backupRevision
			}
			if presentation.columns != parent.columns { presentation.columns = parent.columns }
			if presentation.rows != parent.rows { presentation.rows = parent.rows }
			if presentation.bleeds != parent.bleeds { presentation.bleeds = parent.bleeds }
			let targetSize = thumbnailTargetSize
			if presentation.thumbnailTargetSize != targetSize {
				presentation.thumbnailTargetSize = targetSize
			}
		}

		private var thumbnailTargetSize: CGSize {
			guard let collectionView else { return CGSize(width: 300, height: 300) }
			let spacing = CGFloat(max(0, parent.columns - 1)) * 4
			let width = max(1, (collectionView.bounds.width - spacing) / CGFloat(parent.columns))
			let pixels = ceil(width * collectionView.traitCollection.displayScale)
			return CGSize(width: pixels, height: pixels)
		}

		private func scrollToBottom(animated: Bool = false) {
			guard let collectionView, parent.assets.count > 0 else { return }
			collectionView.scrollToItem(
				at: IndexPath(item: parent.assets.count - 1, section: 0),
				at: .bottom,
				animated: animated
			)
		}

		private func scroll(to progress: CGFloat) {
			guard let collectionView else { return }
			let range = scrollRange
			guard range.upperBound > range.lowerBound else { return }
			let y = range.lowerBound + (range.upperBound - range.lowerBound) * min(max(progress, 0), 1)
			collectionView.setContentOffset(CGPoint(x: collectionView.contentOffset.x, y: y), animated: false)
		}

		private var scrollRange: ClosedRange<CGFloat> {
			guard let collectionView else { return 0...0 }
			let minimum = -collectionView.adjustedContentInset.top
			let maximum = max(
				minimum,
				collectionView.contentSize.height
					- collectionView.bounds.height
					+ collectionView.adjustedContentInset.bottom
			)
			return minimum...maximum
		}

		private func updateFastScroller() {
			guard let collectionView else { return }
			let range = scrollRange
			let distance = range.upperBound - range.lowerBound
			let progress = distance > 0
				? (collectionView.contentOffset.y - range.lowerBound) / distance
				: 1
			fastScroller.update(
				progress: min(max(progress, 0), 1),
				viewportHeight: collectionView.bounds.height,
				contentHeight: collectionView.contentSize.height + collectionView.adjustedContentInset.bottom,
				visibleBounds: collectionView.bounds,
				isScrollable: distance > 1
			)
			collectionView.bringSubviewToFront(fastScroller)
		}

		private func reportNearLatestIfNeeded() {
			guard let collectionView else { return }
			let visibleBottom = collectionView.contentOffset.y + collectionView.bounds.height
			let distance = max(0, collectionView.contentSize.height - visibleBottom)
			let isNearLatest = distance < max(100, collectionView.bounds.height * 0.75)
			guard isNearLatest != lastReportedNearLatest else { return }
			lastReportedNearLatest = isNearLatest
			Task { @MainActor [parent] in
				parent.onNearLatestChange(isNearLatest)
			}
		}

		private func updateCachedAssets(force: Bool = false) {
			guard let collectionView, collectionView.bounds.height > 0, parent.assets.count > 0 else { return }
			let targetSize = thumbnailTargetSize
			if targetSize != cachedTargetSize {
				stopCachingThumbnails()
				cachedTargetSize = targetSize
				if presentation.thumbnailTargetSize != targetSize {
					presentation.thumbnailTargetSize = targetSize
				}
			}

			let visibleRect = CGRect(origin: collectionView.contentOffset, size: collectionView.bounds.size)
			let preheatRect = visibleRect.insetBy(dx: 0, dy: -0.5 * visibleRect.height)
			let delta = abs(preheatRect.midY - previousPreheatRect.midY)
			guard force || previousPreheatRect == .zero || delta > collectionView.bounds.height / 3 else { return }

			let differences = differencesBetweenRects(previousPreheatRect, preheatRect)
			let added = assets(in: differences.added, collectionView: collectionView)
			let removed = assets(in: differences.removed, collectionView: collectionView)
			let options = PhotoThumbnailRequest.options()
			if !added.isEmpty {
				parent.imageManager.startCachingImages(
					for: added,
					targetSize: targetSize,
					contentMode: .aspectFill,
					options: options
				)
			}
			if !removed.isEmpty {
				parent.imageManager.stopCachingImages(
					for: removed,
					targetSize: targetSize,
					contentMode: .aspectFill,
					options: options
				)
			}
			for asset in added { cachedAssets[asset.localIdentifier] = asset }
			for asset in removed { cachedAssets.removeValue(forKey: asset.localIdentifier) }
			previousPreheatRect = preheatRect
		}

		private func assets(in rects: [CGRect], collectionView: UICollectionView) -> [PHAsset] {
			let indexes = Set(rects.flatMap { rect in
				collectionView.collectionViewLayout.layoutAttributesForElements(in: rect)?
					.filter { $0.representedElementCategory == .cell }
					.map(\.indexPath.item) ?? []
			})
			return indexes.sorted().compactMap { index in
				parent.assets.indices.contains(index) ? parent.assets[index] : nil
			}
		}

		private func differencesBetweenRects(_ old: CGRect, _ new: CGRect) -> (added: [CGRect], removed: [CGRect]) {
			guard old.intersects(new) else { return ([new], old == .zero ? [] : [old]) }
			var added: [CGRect] = []
			var removed: [CGRect] = []
			if new.maxY > old.maxY {
				added.append(CGRect(x: new.minX, y: old.maxY, width: new.width, height: new.maxY - old.maxY))
			}
			if old.minY > new.minY {
				added.append(CGRect(x: new.minX, y: new.minY, width: new.width, height: old.minY - new.minY))
			}
			if new.maxY < old.maxY {
				removed.append(CGRect(x: new.minX, y: new.maxY, width: new.width, height: old.maxY - new.maxY))
			}
			if old.minY < new.minY {
				removed.append(CGRect(x: new.minX, y: old.minY, width: new.width, height: new.minY - old.minY))
			}
			return (added, removed)
		}
	}
}

extension PhotoLibraryModel.Assets.Change {
	// UIKit checks a batch update against the count it last read, not against the
	// previous revision. After reloadData it hasn't read one yet, and would take
	// the new count as the state before the update, then abort on the deletes.
	// PhotoKit reports a move's source after removals and insertions, while UIKit
	// reads it as the state before the update, so a change with moves reloads.
	func applies(from loaded: (revision: Int, count: Int)?, to count: Int) -> Bool {
		guard let loaded, loaded.revision == previousRevision, moves.isEmpty else { return false }
		return loaded.count - removedIndexes.count + insertedIndexes.count == count
			&& (removedIndexes.last ?? -1) < loaded.count
			&& (insertedIndexes.last ?? -1) < count
	}
}

// UIKit's scroll indicator is only positional feedback in this embedded grid.
// This thumb provides the missing Photos-style fast scrub without sending every
// drag update through SwiftUI or enumerating the PhotoKit fetch result.
private final class PhotoLibraryFastScroller: UIView {
	var onScrub: ((CGFloat) -> Void)?
	private let thumb = CALayer()
	private var trackHeight: CGFloat = 0
	private var thumbHeight: CGFloat = 36
	private let trackInset: CGFloat = 8
	private let thumbHitInset: CGFloat = 8
	private let grabFeedback = UIImpactFeedbackGenerator(style: .light)

	lazy var scrubGestureRecognizer: UILongPressGestureRecognizer = {
		let gesture = UILongPressGestureRecognizer(target: self, action: #selector(handleScrub(_:)))
		gesture.minimumPressDuration = 0
		gesture.allowableMovement = .greatestFiniteMagnitude
		return gesture
	}()

	override init(frame: CGRect) {
		super.init(frame: frame)
		isAccessibilityElement = true
		accessibilityLabel = "Photo library position"
		accessibilityValue = Self.accessibilityValue(for: 0)
		accessibilityTraits = [.adjustable]
		thumb.backgroundColor = UIColor.white.withAlphaComponent(0.72).cgColor
		layer.addSublayer(thumb)
		addGestureRecognizer(scrubGestureRecognizer)
	}

	required init?(coder: NSCoder) {
		fatalError("init(coder:) has not been implemented")
	}

	func update(
		progress: CGFloat,
		viewportHeight: CGFloat,
		contentHeight: CGFloat,
		visibleBounds: CGRect,
		isScrollable: Bool
	) {
		isHidden = !isScrollable || viewportHeight <= 0 || contentHeight <= 0
		guard !isHidden else { return }
		currentProgress = progress
		accessibilityValue = Self.accessibilityValue(for: progress)

		trackHeight = max(0, viewportHeight - (trackInset * 2))
		thumbHeight = min(
			max(36, trackHeight * min(1, viewportHeight / contentHeight)),
			trackHeight
		)
		let travel = max(0, trackHeight - thumbHeight)
		let thumbY = trackInset + (travel * progress)
		let hitHeight = thumbHeight + (thumbHitInset * 2)
		frame = CGRect(
			x: visibleBounds.maxX - 32,
			y: visibleBounds.minY + thumbY - thumbHitInset,
			width: 32,
			height: hitHeight
		)
		updateThumbAppearance(
			isDragging: scrubGestureRecognizer.state == .began || scrubGestureRecognizer.state == .changed
		)
	}

	override func accessibilityIncrement() {
		setProgress(min(1, currentProgress + 0.1))
	}

	override func accessibilityDecrement() {
		setProgress(max(0, currentProgress - 0.1))
	}

	private var currentProgress: CGFloat = 0

	private func setProgress(_ progress: CGFloat) {
		currentProgress = progress
		accessibilityValue = Self.accessibilityValue(for: progress)
		onScrub?(progress)
	}

	private static func accessibilityValue(for progress: CGFloat) -> String {
		NumberFormatter.localizedString(from: NSNumber(value: progress), number: .percent)
	}

	@objc private func handleScrub(_ gesture: UILongPressGestureRecognizer) {
		guard let scrollView = superview as? UIScrollView else { return }
		switch gesture.state {
		case .began:
			updateThumbAppearance(isDragging: true)
			grabFeedback.impactOccurred()
			scrub(to: gesture.location(in: scrollView).y - scrollView.bounds.minY)
		case .changed:
			scrub(to: gesture.location(in: scrollView).y - scrollView.bounds.minY)
		case .ended, .cancelled, .failed:
			updateThumbAppearance(isDragging: false)
			grabFeedback.prepare()
		default:
			break
		}
	}

	private func scrub(to visibleY: CGFloat) {
		let travel = max(1, trackHeight - thumbHeight)
		currentProgress = min(max((visibleY - trackInset - (thumbHeight / 2)) / travel, 0), 1)
		onScrub?(currentProgress)
	}

	private func updateThumbAppearance(isDragging: Bool) {
		let width: CGFloat = isDragging ? 6 : 4
		CATransaction.begin()
		CATransaction.setDisableActions(true)
		thumb.frame = CGRect(
			x: bounds.width - width - 3,
			y: thumbHitInset,
			width: width,
			height: thumbHeight
		)
		thumb.cornerRadius = width / 2
		thumb.backgroundColor = UIColor.white.withAlphaComponent(isDragging ? 0.95 : 0.72).cgColor
		CATransaction.commit()
	}
}

fileprivate final class PhotoCell: UICollectionViewCell {
	static let reuseIdentifier = "PhotoCell"

	override func prepareForReuse() {
		super.prepareForReuse()
		contentConfiguration = nil
		accessibilityLabel = nil
		accessibilityHint = nil
		isAccessibilityElement = false
	}
}

@MainActor
@Observable
private final class PhotoLibraryGridPresentation {
	var backupSourceId: String?
	var backupRevision: Date
	var columns: Int
	var rows: Int
	var bleeds: Bool
	var thumbnailTargetSize = CGSize(width: 300, height: 300)

	init(parent: PhotoLibraryGrid) {
		backupSourceId = parent.backupSourceId
		backupRevision = parent.backupRevision
		columns = parent.columns
		rows = parent.rows
		bleeds = parent.bleeds
	}
}

private struct PhotoLibraryGridCell: View {
	let index: Int
	let asset: PHAsset
	let imageManager: PHCachingImageManager
	let receiptCache: PhotoBackupReceiptCache
	let transitionNamespace: Namespace.ID
	let presentation: PhotoLibraryGridPresentation

	var body: some View {
		AssetThumbnail(
			asset: asset,
			imageManager: imageManager,
			shape: Bento.tile(
				row: index / presentation.columns,
				col: index % presentation.columns,
				rows: presentation.rows,
				cols: presentation.columns,
				outer: presentation.bleeds ? 16 : 2,
				inner: 2
			),
			receiptCache: receiptCache,
			backupSourceId: presentation.backupSourceId,
			backupRevision: presentation.backupRevision,
			thumbnailTargetSize: presentation.thumbnailTargetSize
		)
		.matchedTransitionSource(id: asset.localIdentifier, in: transitionNamespace)
	}
}
