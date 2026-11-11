import AVFoundation
import AVKit
import Foundation
import Observation
import OSLog
import Photos
import SwiftUI
import UIKit
import UmbrelKit

// UIPageViewController asks its data source only for adjacent pages, keeping
// navigation smooth without placing a very large PhotoKit library in one layout.
struct PhotoViewer: View {
	let initialIndex: Int
	let initialAssetIdentifier: String
	let transitionNamespace: Namespace.ID

	@Environment(\.dismiss) private var dismiss
	@Environment(MainModel.self) private var model
	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	@State private var visibleIndex: Int?
	@State private var visibleAssetIdentifier: String
	@State private var showsControls = true
	@State private var showsInfo = false
	@State private var presentedVideoPlayer: AVPlayer?

	init(initialIndex: Int, initialAssetIdentifier: String, transitionNamespace: Namespace.ID) {
		self.initialIndex = initialIndex
		self.initialAssetIdentifier = initialAssetIdentifier
		self.transitionNamespace = transitionNamespace
		_visibleIndex = State(initialValue: initialIndex)
		_visibleAssetIdentifier = State(initialValue: initialAssetIdentifier)
	}

	var body: some View {
		NavigationStack {
			ZStack {
				Color.black.ignoresSafeArea()
				pager
			}
			.ignoresSafeArea()
			.toolbar { toolbar }
			.toolbar(showsControls ? .visible : .hidden, for: .navigationBar)
			.toolbarBackgroundVisibility(.hidden, for: .navigationBar)
			.navigationBarTitleDisplayMode(.inline)
		}
		.environment(\.colorScheme, .dark)
		.statusBarHidden(!showsControls)
		.navigationTransition(.zoom(sourceID: visibleAssetIdentifier, in: transitionNamespace))
		.background {
			FullScreenVideoPresenter(player: presentedVideoPlayer) {
				presentedVideoPlayer = nil
			}
			.frame(width: 0, height: 0)
		}
		.onChange(of: assets.count) { _, count in
			guard count > 0 else {
				dismiss()
				return
			}
			visibleIndex = min(selectedIndex, count - 1)
		}
		.onChange(of: visibleIndex) { _, index in
			guard let index, assets.indices.contains(index) else { return }
			visibleAssetIdentifier = assets[index].localIdentifier
			if assets[index].mediaType == .video { showsControls = true }
		}
		.sheet(isPresented: $showsInfo) {
			if let asset = selectedAsset {
				PhotoViewerInfoSheet(asset: asset)
			}
		}
	}

	private var pager: some View {
		PhotoPageController(
			assets: assets,
			imageManager: model.photoLibrary.imageManager,
			selectedIndex: $visibleIndex,
			selectedAssetIdentifier: $visibleAssetIdentifier,
			onPlayVideo: { presentedVideoPlayer = $0 },
			onTap: {
				withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.18)) {
					showsControls.toggle()
				}
			}
		)
		.ignoresSafeArea()
	}

	// System toolbar items, so on iPhone Duo they move into the side column like Photos'.
	// The backup status stays at the top as the title, like Photos' date.
	@ToolbarContentBuilder
	private var toolbar: some ToolbarContent {
		ToolbarItem(placement: .cancellationAction) {
			Button { dismiss() } label: {
				Label("Back to Library", systemImage: "chevron.left")
			}
			.tint(.white)
		}
		if let asset = selectedAsset {
			ToolbarItem(placement: .principal) {
				PhotoViewerBackupStatus(asset: asset)
					.id(asset.localIdentifier)
					.allowsHitTesting(false)
			}
			.sharedBackgroundVisibility(.hidden)
			ToolbarItem(placement: .primaryAction) {
				Button { showsInfo = true } label: {
					Label("Photo information", systemImage: "info")
				}
				.tint(.white)
			}
		}
	}

	private var assets: PhotoLibraryModel.Assets { model.photoLibrary.assets }

	private var selectedAsset: PHAsset? {
		if assets.indices.contains(selectedIndex) {
			let asset = assets[selectedIndex]
			if asset.localIdentifier == visibleAssetIdentifier { return asset }
		}
		return assets.first { $0.localIdentifier == visibleAssetIdentifier }
	}

	private var selectedIndex: Int {
		min(max(visibleIndex ?? initialIndex, 0), max(0, assets.count - 1))
	}

}

// Apple recommends presenting AVPlayerViewController itself for immersive video
// playback. This keeps the system's transport, AirPlay, and volume controls in one
// exclusive full-screen interface instead of layering our viewer controls above it.
private struct FullScreenVideoPresenter: UIViewControllerRepresentable {
	let player: AVPlayer?
	let onDismiss: () -> Void

	func makeUIViewController(context: Context) -> PresenterViewController {
		PresenterViewController()
	}

	func updateUIViewController(_ controller: PresenterViewController, context: Context) {
		controller.update(player: player, onDismiss: onDismiss)
	}

	static func dismantleUIViewController(_ controller: PresenterViewController, coordinator: Void) {
		controller.stop()
	}

	@MainActor
	final class PresenterViewController: UIViewController, @preconcurrency AVPlayerViewControllerDelegate {
		private static let logger = Logger(subsystem: "com.umbrel.app", category: "VideoPlayback")

		private var activePlayerController: AVPlayerViewController?
		private var audioSessionIsActive = false
		private var pendingPlayer: AVPlayer?
		private var onDismiss: (() -> Void)?

		override func viewDidAppear(_ animated: Bool) {
			super.viewDidAppear(animated)
			presentIfNeeded()
		}

		func update(player: AVPlayer?, onDismiss: @escaping () -> Void) {
			self.onDismiss = onDismiss
			pendingPlayer = player
			if player == nil {
				stop()
			} else {
				presentIfNeeded()
			}
		}

		func stop() {
			pendingPlayer?.pause()
			pendingPlayer = nil
			deactivateAudioSession()
			guard let activePlayerController else { return }
			self.activePlayerController = nil
			activePlayerController.dismiss(animated: false)
		}

		private func presentIfNeeded() {
			guard viewIfLoaded?.window != nil,
				activePlayerController == nil,
				let pendingPlayer
			else { return }

			let playerController = AVPlayerViewController()
			playerController.player = pendingPlayer
			playerController.delegate = self
			activePlayerController = playerController
			activateAudioSession()
			present(playerController, animated: true) {
				pendingPlayer.play()
			}
		}

		func playerViewController(
			_ playerViewController: AVPlayerViewController,
			willEndFullScreenPresentationWithAnimationCoordinator coordinator: UIViewControllerTransitionCoordinator
		) {
			coordinator.animate(alongsideTransition: nil) { [weak self] context in
				guard !context.isCancelled, let self else { return }
				pendingPlayer?.pause()
				pendingPlayer = nil
				activePlayerController = nil
				deactivateAudioSession()
				onDismiss?()
			}
		}

		private func activateAudioSession() {
			let audioSession = AVAudioSession.sharedInstance()
			do {
				// Explicit video playback is primary media, so it should remain audible
				// when the iPhone's Ring/Silent switch is set to silent. Activation is
				// deferred until Play so other audio isn't interrupted prematurely.
				try audioSession.setCategory(.playback, mode: .moviePlayback)
				try audioSession.setActive(true)
				audioSessionIsActive = true
			} catch {
				Self.logger.error("Could not activate video audio session: \(error.localizedDescription, privacy: .public)")
			}
		}

		private func deactivateAudioSession() {
			guard audioSessionIsActive else { return }
			do {
				try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
				audioSessionIsActive = false
			} catch {
				Self.logger.error("Could not deactivate video audio session: \(error.localizedDescription, privacy: .public)")
			}
		}
	}
}

@MainActor
@Observable
private final class PhotoViewerPageState {
	var isActive: Bool

	init(isActive: Bool) {
		self.isActive = isActive
	}
}

// UIKit's page controller is data-source driven: it creates neighboring pages
// only when a gesture needs them, regardless of the library's total size.
private struct PhotoPageController: UIViewControllerRepresentable {
	let assets: PhotoLibraryModel.Assets
	let imageManager: PHCachingImageManager
	@Binding var selectedIndex: Int?
	@Binding var selectedAssetIdentifier: String
	let onPlayVideo: (AVPlayer) -> Void
	let onTap: () -> Void

	func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

	func makeUIViewController(context: Context) -> UIPageViewController {
		let controller = UIPageViewController(
			transitionStyle: .scroll,
			navigationOrientation: .horizontal
		)
		controller.dataSource = context.coordinator
		controller.delegate = context.coordinator
		context.coordinator.controller = controller

		if let page = context.coordinator.page(at: resolvedSelectedIndex) {
			controller.setViewControllers([page], direction: .forward, animated: false)
			context.coordinator.setActiveIndex(page.index)
		}
		return controller
	}

	func updateUIViewController(_ controller: UIPageViewController, context: Context) {
		context.coordinator.parent = self
		guard let current = controller.viewControllers?.first as? PageHost else { return }
		let desired = resolvedSelectedIndex
		let expectedIdentifier = assets.indices.contains(desired) ? assets[desired].localIdentifier : nil
		guard current.index != desired || current.assetIdentifier != expectedIdentifier else { return }
		guard let page = context.coordinator.page(at: desired) else { return }

		let direction: UIPageViewController.NavigationDirection = desired >= current.index ? .forward : .reverse
		controller.setViewControllers([page], direction: direction, animated: false)
		context.coordinator.setActiveIndex(desired)
		let coordinator = context.coordinator
		Task { @MainActor in coordinator.publishSelection(page) }
	}

	private var resolvedSelectedIndex: Int {
		let candidate = min(max(selectedIndex ?? 0, 0), max(0, assets.count - 1))
		if assets.indices.contains(candidate), assets[candidate].localIdentifier == selectedAssetIdentifier {
			return candidate
		}
		return assets.firstIndex { $0.localIdentifier == selectedAssetIdentifier } ?? candidate
	}

	@MainActor
	final class Coordinator: NSObject, UIPageViewControllerDataSource, UIPageViewControllerDelegate {
		var parent: PhotoPageController
		weak var controller: UIPageViewController?
		weak var activePage: PageHost?

		init(parent: PhotoPageController) {
			self.parent = parent
		}

		func page(at index: Int) -> PageHost? {
			guard parent.assets.indices.contains(index) else { return nil }
			let state = PhotoViewerPageState(
				isActive: parent.selectedAssetIdentifier == parent.assets[index].localIdentifier
			)
			return PageHost(
				index: index,
				assetIdentifier: parent.assets[index].localIdentifier,
				state: state,
				rootView: PhotoViewerPage(
					asset: parent.assets[index],
					imageManager: parent.imageManager,
					state: state,
					onPlayVideo: parent.onPlayVideo,
					onTap: parent.onTap
				)
			)
		}

		func setActiveIndex(_ index: Int) {
			activePage?.state.isActive = false
			guard let page = controller?.viewControllers?.first as? PageHost, page.index == index else { return }
			page.state.isActive = true
			activePage = page
		}

		func publishSelection(_ page: PageHost) {
			parent.selectedIndex = page.index
			parent.selectedAssetIdentifier = page.assetIdentifier
		}

		func pageViewController(
			_ pageViewController: UIPageViewController,
			viewControllerBefore viewController: UIViewController
		) -> UIViewController? {
			guard let host = viewController as? PageHost else { return nil }
			return page(at: host.index - 1)
		}

		func pageViewController(
			_ pageViewController: UIPageViewController,
			viewControllerAfter viewController: UIViewController
		) -> UIViewController? {
			guard let host = viewController as? PageHost else { return nil }
			return page(at: host.index + 1)
		}

		func pageViewController(
			_ pageViewController: UIPageViewController,
			didFinishAnimating finished: Bool,
			previousViewControllers: [UIViewController],
			transitionCompleted completed: Bool
		) {
			guard completed, let page = pageViewController.viewControllers?.first as? PageHost else { return }
			publishSelection(page)
			setActiveIndex(page.index)
		}
	}

	@MainActor
	final class PageHost: UIHostingController<PhotoViewerPage> {
		let index: Int
		let assetIdentifier: String
		let state: PhotoViewerPageState

		init(index: Int, assetIdentifier: String, state: PhotoViewerPageState, rootView: PhotoViewerPage) {
			self.index = index
			self.assetIdentifier = assetIdentifier
			self.state = state
			super.init(rootView: rootView)
			view.backgroundColor = .black
		}

		@available(*, unavailable)
		required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

		// Like Photos, a photo is centred on the whole screen, under the bars, the status
		// bar and the side column on iPhone Duo, and stays put while the bars hide and show.
		override func viewSafeAreaInsetsDidChange() {
			super.viewSafeAreaInsetsDidChange()
			guard let insets = parent?.view.safeAreaInsets else { return }
			let ignored = UIEdgeInsets(top: -insets.top, left: -insets.left, bottom: -insets.bottom, right: -insets.right)
			if additionalSafeAreaInsets != ignored { additionalSafeAreaInsets = ignored }
		}
	}
}

private struct PhotoViewerPage: View {
	let asset: PHAsset
	let imageManager: PHCachingImageManager
	let state: PhotoViewerPageState
	let onPlayVideo: (AVPlayer) -> Void
	let onTap: () -> Void

	@Environment(\.displayScale) private var displayScale
	@State private var representedIdentifier: String?
	@State private var imageRequestID: PHImageRequestID?
	@State private var videoRequestID: PHImageRequestID?
	@State private var imageRequestGeneration = 0
	@State private var videoRequestGeneration = 0
	@State private var image: UIImage?
	@State private var isLoadingVideo = false

	var body: some View {
		GeometryReader { geometry in
			ZStack {
				if asset.mediaType == .video {
					if let image {
						Button(action: requestVideo) {
							ZStack {
								Image(uiImage: image).resizable().scaledToFit()
								if isLoadingVideo {
									ProgressView()
										.tint(.white)
										.frame(width: 72, height: 72)
										.glassSurface(in: Circle())
								} else {
									Image(systemName: "play.fill")
										.font(.system(size: 24, weight: .semibold))
										.foregroundStyle(.white)
										.frame(width: 72, height: 72)
										.glassControl(in: Circle())
								}
							}
							.frame(maxWidth: .infinity, maxHeight: .infinity)
							.contentShape(Rectangle())
						}
						.buttonStyle(.plain)
						.disabled(isLoadingVideo)
						.accessibilityLabel("Play video")
					} else {
						ProgressView().tint(.white)
					}
				} else if let image {
					ZoomablePhoto(image: image, onTap: onTap)
				} else {
					ProgressView()
						.tint(.white)
						.frame(maxWidth: .infinity, maxHeight: .infinity)
						.contentShape(Rectangle())
						.onTapGesture(perform: onTap)
				}
			}
			.frame(maxWidth: .infinity, maxHeight: .infinity)
			.onAppear {
				requestImage(for: geometry.size)
			}
			.onChange(of: geometry.size) { _, size in
				requestImage(for: size)
			}
		}
		.onChange(of: state.isActive) { _, active in
			if !active { cancelVideoRequest() }
		}
		.onDisappear { cancelRequests(clearImage: true) }
	}

	private func requestVideo() {
		guard asset.mediaType == .video, state.isActive, videoRequestID == nil else { return }
		isLoadingVideo = true
		videoRequestGeneration &+= 1
		let generation = videoRequestGeneration
		let identifier = asset.localIdentifier
		let options = PHVideoRequestOptions()
		options.deliveryMode = .automatic
		options.isNetworkAccessAllowed = true
		videoRequestID = imageManager.requestPlayerItem(forVideo: asset, options: options) { item, info in
			Task { @MainActor in
				guard generation == videoRequestGeneration,
					representedIdentifier == identifier,
					state.isActive,
					info?[PHImageCancelledKey] as? Bool != true
				else { return }
				videoRequestID = nil
				isLoadingVideo = false
				guard let item else { return }
				let newPlayer = AVPlayer(playerItem: item)
				onPlayVideo(newPlayer)
			}
		}
	}

	private func requestImage(for size: CGSize) {
		guard size.width > 0, size.height > 0 else { return }
		cancelImageRequest()
		let generation = imageRequestGeneration
		let identifier = asset.localIdentifier
		representedIdentifier = identifier

		let options = PHImageRequestOptions()
		options.deliveryMode = .highQualityFormat
		options.resizeMode = .exact
		options.isNetworkAccessAllowed = true
		imageRequestID = imageManager.requestImage(
			for: asset,
			targetSize: CGSize(width: size.width * displayScale, height: size.height * displayScale),
			contentMode: .aspectFit,
			options: options
		) { result, info in
			guard let result, info?[PHImageCancelledKey] as? Bool != true else { return }
			Task { @MainActor in
				guard generation == imageRequestGeneration,
					representedIdentifier == identifier
				else { return }
				imageRequestID = nil
				image = result
			}
		}

	}

	private func cancelImageRequest() {
		if let imageRequestID { imageManager.cancelImageRequest(imageRequestID) }
		imageRequestID = nil
		imageRequestGeneration &+= 1
	}

	private func cancelVideoRequest() {
		if let videoRequestID { imageManager.cancelImageRequest(videoRequestID) }
		videoRequestID = nil
		videoRequestGeneration &+= 1
		isLoadingVideo = false
	}

	private func cancelRequests(clearImage: Bool) {
		cancelImageRequest()
		cancelVideoRequest()
		representedIdentifier = nil
		if clearImage { image = nil }
	}
}

private struct ZoomablePhoto: UIViewRepresentable {
	let image: UIImage
	let onTap: () -> Void

	func makeCoordinator() -> Coordinator { Coordinator(onTap: onTap) }

	func makeUIView(context: Context) -> UIScrollView {
		let scrollView = UIScrollView()
		scrollView.delegate = context.coordinator
		scrollView.minimumZoomScale = 1
		scrollView.maximumZoomScale = 4
		scrollView.bouncesZoom = true
		scrollView.showsHorizontalScrollIndicator = false
		scrollView.showsVerticalScrollIndicator = false
		scrollView.panGestureRecognizer.isEnabled = false
		// The photo runs under the bars on black, so it needs no edge effect behind them
		scrollView.topEdgeEffect.isHidden = true

		let doubleTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.didDoubleTap(_:)))
		doubleTap.numberOfTapsRequired = 2
		let singleTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.didSingleTap))
		singleTap.require(toFail: doubleTap)
		scrollView.addGestureRecognizer(doubleTap)
		scrollView.addGestureRecognizer(singleTap)

		let imageView = UIImageView()
		imageView.translatesAutoresizingMaskIntoConstraints = false
		imageView.contentMode = .scaleAspectFit
		scrollView.addSubview(imageView)
		NSLayoutConstraint.activate([
			imageView.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor),
			imageView.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor),
			imageView.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor),
			imageView.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor),
			imageView.widthAnchor.constraint(equalTo: scrollView.frameLayoutGuide.widthAnchor),
			imageView.heightAnchor.constraint(equalTo: scrollView.frameLayoutGuide.heightAnchor),
		])
		context.coordinator.imageView = imageView
		return scrollView
	}

	func updateUIView(_ scrollView: UIScrollView, context: Context) {
		context.coordinator.onTap = onTap
		guard context.coordinator.imageView?.image !== image else { return }
		context.coordinator.imageView?.image = image
		scrollView.setZoomScale(1, animated: false)
		context.coordinator.updatePanning(in: scrollView)
	}

	final class Coordinator: NSObject, UIScrollViewDelegate {
		weak var imageView: UIImageView?
		var onTap: () -> Void

		init(onTap: @escaping () -> Void) {
			self.onTap = onTap
		}

		@objc func didSingleTap() {
			onTap()
		}

		@objc func didDoubleTap(_ recognizer: UITapGestureRecognizer) {
			guard let scrollView = recognizer.view as? UIScrollView, let imageView else { return }
			if scrollView.zoomScale > scrollView.minimumZoomScale + 0.01 {
				scrollView.setZoomScale(scrollView.minimumZoomScale, animated: true)
				return
			}

			let scale = min(scrollView.maximumZoomScale, 2.5)
			let size = CGSize(width: scrollView.bounds.width / scale, height: scrollView.bounds.height / scale)
			let point = recognizer.location(in: imageView)
			let rect = CGRect(
				x: point.x - (size.width / 2),
				y: point.y - (size.height / 2),
				width: size.width,
				height: size.height
			)
			scrollView.zoom(to: rect, animated: true)
		}

		func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

		func scrollViewDidZoom(_ scrollView: UIScrollView) {
			updatePanning(in: scrollView)
		}

		func updatePanning(in scrollView: UIScrollView) {
			scrollView.panGestureRecognizer.isEnabled = scrollView.zoomScale > 1.001
		}
	}
}

private struct PhotoViewerInfoSheet: View {
	let asset: PHAsset
	let filename: String?
	@Environment(\.dismiss) private var dismiss

	init(asset: PHAsset) {
		self.asset = asset
		filename = PHAssetResource.assetResources(for: asset).first?.originalFilename
	}

	var body: some View {
		NavigationStack {
			List {
				Section("Backup") {
					PhotoViewerBackupStatus(asset: asset, style: .details)
				}

				Section("Details") {
					if let creationDate = asset.creationDate {
						LabeledContent("Captured") {
							Text(creationDate.formatted(date: .long, time: .shortened))
								.multilineTextAlignment(.trailing)
						}
					}
					if let filename {
						LabeledContent("Filename") {
							Text(filename)
								.lineLimit(1)
								.truncationMode(.middle)
						}
					}
					LabeledContent("Type", value: mediaType)
					if asset.pixelWidth > 0, asset.pixelHeight > 0 {
						LabeledContent("Dimensions", value: "\(asset.pixelWidth) × \(asset.pixelHeight)")
					}
					if asset.mediaType == .video {
						LabeledContent("Duration", value: duration)
					}
				}

				if let location = asset.location?.coordinate {
					Section("Location") {
						LabeledContent(
							"Coordinates",
							value: String(format: "%.5f, %.5f", location.latitude, location.longitude)
						)
					}
				}
			}
			.navigationTitle("Info")
			.navigationBarTitleDisplayMode(.inline)
			.toolbar {
				DrawerCloseToolbarItem(action: { dismiss() })
			}
		}
		.presentationDetents([.medium])
		.presentationDragIndicator(.visible)
	}

	private var mediaType: String {
		if asset.mediaType == .video { return "Video" }
		if asset.mediaSubtypes.contains(.photoLive) { return "Live Photo" }
		return "Photo"
	}

	private var duration: String {
		let totalSeconds = max(0, Int(asset.duration.rounded()))
		let hours = totalSeconds / 3600
		let minutes = (totalSeconds % 3600) / 60
		let seconds = totalSeconds % 60
		if hours > 0 { return String(format: "%d:%02d:%02d", hours, minutes, seconds) }
		return String(format: "%d:%02d", minutes, seconds)
	}
}

private struct PhotoViewerBackupStatus: View {
	enum Style { case toolbar, details }

	let asset: PHAsset
	var style: Style = .toolbar

	@Environment(MainModel.self) private var model
	@State private var status: Status?

	@ViewBuilder
	var body: some View {
		content
			.task(id: request) { await refresh() }
	}

	@ViewBuilder
	private var content: some View {
		if let status {
			switch style {
			case .toolbar:
				statusLabel(status)
					.foregroundStyle(.white.opacity(0.9))
					.padding(.horizontal, 14)
					.frame(minHeight: 38)
					.glassSurface(in: Capsule())
			case .details:
				detailsStatusLabel(status)
				if let bytes = status.backupBytes {
					LabeledContent("Backup size", value: formatStorageSize(Double(bytes)))
				}
			}
		} else {
			switch style {
			case .toolbar:
				Color.clear
					.frame(width: 1, height: 38)
			case .details:
				Label("Checking backup", systemImage: "clock")
			}
		}
	}

	private func detailsStatusLabel(_ status: Status) -> some View {
		Label {
			VStack(alignment: .leading, spacing: 2) {
				Text(status.text)
				if status == .notBackedUp {
					Text(
						asset.mediaType == .video
							? "Video backup is turned off."
							: "Photo backup is turned off."
					)
						.font(.subheadline)
						.foregroundStyle(.secondary)
				}
			}
		} icon: {
			Image(systemName: status.icon)
				.symbolRenderingMode(.monochrome)
				.foregroundStyle(.primary)
		}
	}

	private func statusLabel(_ status: Status) -> some View {
		HStack(spacing: 8) {
			Image(systemName: status.icon)
				.font(.system(size: 14, weight: .semibold))
			Text(status.text)
				.font(.footnote.weight(.semibold))
		}
	}

	private var request: Request {
		Request(
			sourceId: model.photoBackup.sourceId,
			revision: model.photoBackupReceiptRevision,
			localIdentifier: asset.localIdentifier,
			modificationDate: asset.modificationDate ?? asset.creationDate ?? .distantPast,
			backupEnabled: backupEnabled
		)
	}

	private var backupEnabled: Bool {
		asset.mediaType == .video ? model.backupVideosEnabled : model.backupPhotosEnabled
	}

	private func refresh() async {
		let record: PhotoBackupLedger.AssetRecord?
		if let sourceId = model.photoBackup.sourceId {
			record = await model.photoBackupReceipts.record(
				sourceId: sourceId,
				revision: model.photoBackupReceiptRevision,
				localIdentifier: asset.localIdentifier
			)
		} else {
			record = nil
		}
		guard !Task.isCancelled else { return }

		if let record, record.state == .uploaded {
			status = .backedUp(bytes: record.uploadedBytes)
		} else if !backupEnabled {
			status = .notBackedUp
		} else if record?.state == .failed {
			status = .failed
		} else {
			status = .waiting
		}
	}

	private struct Request: Hashable {
		let sourceId: String?
		let revision: Date
		let localIdentifier: String
		let modificationDate: Date
		let backupEnabled: Bool
	}

	private enum Status: Equatable {
		case backedUp(bytes: Int64), waiting, notBackedUp, failed

		var icon: String {
			switch self {
			case .backedUp: "checkmark.circle.fill"
			case .waiting: "clock"
			case .notBackedUp: "minus.circle"
			case .failed: "exclamationmark.triangle.fill"
			}
		}

		var text: String {
			switch self {
			case .backedUp: "Backed up"
			case .waiting: "Waiting to back up"
			case .notBackedUp: "Not backed up"
			case .failed: "Couldn’t back up"
			}
		}

		var backupBytes: Int64? {
			guard case let .backedUp(bytes) = self, bytes > 0 else { return nil }
			return bytes
		}
	}
}
