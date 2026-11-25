import AVFoundation
import AVKit
import Foundation
import ImageIO
import Observation
import OSLog
import Photos
import SwiftUI
import UIKit
import UmbrelKit
import UniformTypeIdentifiers

// UIPageViewController asks its data source only for adjacent pages, keeping
// navigation smooth without placing a very large PhotoKit library in one layout.
struct PhotoViewer: View {
	let initialIndex: Int
	let initialAssetIdentifier: String
	let transitionNamespace: Namespace.ID
	// What VoiceOver calls the button that closes it, which says where that leads
	let backLabel: String

	@Environment(\.dismiss) private var dismiss
	@Environment(MainModel.self) private var model
	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	@State private var visibleIndex: Int?
	@State private var visibleAssetIdentifier: String
	@State private var showsControls = true
	@State private var info: PhotoViewerInfoState
	@State private var usesSideColumn = false
	@State private var presentedVideoPlayer: AVPlayer?

	// `showsInfo` opens it with Info already showing, for a photo opened to see which it is
	init(
		initialIndex: Int,
		initialAssetIdentifier: String,
		transitionNamespace: Namespace.ID,
		showsInfo: Bool = false,
		backLabel: String = "Back to Library"
	) {
		self.initialIndex = initialIndex
		self.initialAssetIdentifier = initialAssetIdentifier
		self.transitionNamespace = transitionNamespace
		self.backLabel = backLabel
		_visibleIndex = State(initialValue: initialIndex)
		_visibleAssetIdentifier = State(initialValue: initialAssetIdentifier)
		_info = State(initialValue: PhotoViewerInfoState(isShown: showsInfo))
	}

	var body: some View {
		NavigationStack {
			ZStack {
				Color.black.ignoresSafeArea()
				pager
			}
			.ignoresSafeArea()
			.toolbar { toolbar }
			// Like Photos, Info takes the top bar's place and leaves its own button to close it.
			// On iPhone Duo that button is in the top bar, so the bar stays for it.
			.toolbar(showsControls && (!info.isShown || usesSideColumn) ? .visible : .hidden, for: .navigationBar)
			.toolbar(showsControls ? .visible : .hidden, for: .bottomBar)
			.toolbarBackgroundVisibility(.hidden, for: .navigationBar, .bottomBar)
			.navigationBarTitleDisplayMode(.inline)
			.modifier(SideColumnReader(isInSideColumn: $usesSideColumn))
			.modifier(PinnedTopBar())
		}
		.environment(\.colorScheme, .dark)
		.statusBarHidden(!showsControls || (info.isShown && !usesSideColumn))
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
		.onChange(of: info.isShown) { _, isShown in
			// Swiping up opens Info even with the controls hidden, and its button closes it
			if isShown { showsControls = true }
		}
		.onChange(of: visibleIndex) { _, index in
			guard let index, assets.indices.contains(index) else { return }
			visibleAssetIdentifier = assets[index].localIdentifier
			if assets[index].mediaType == .video { showsControls = true }
		}
	}

	private var pager: some View {
		PhotoPageController(
			assets: assets,
			imageManager: model.photoLibrary.imageManager,
			model: model,
			info: info,
			selectedIndex: $visibleIndex,
			selectedAssetIdentifier: $visibleAssetIdentifier,
			onPlayVideo: { presentedVideoPlayer = $0 },
			onTap: {
				guard !info.isShown else { return }
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
				Label(backLabel, systemImage: "chevron.left")
			}
			.tint(.white)
		}
		if let asset = selectedAsset {
			// Info's own card says it, and on iPhone Duo the top bar stays over the photo
			if !info.isShown {
				ToolbarItem(placement: .principal) {
					PhotoViewerBackupStatus(asset: asset)
						.id(asset.localIdentifier)
						.allowsHitTesting(false)
				}
				.sharedBackgroundVisibility(.hidden)
			}
			// Where Photos has Info: in the bottom bar on iPhone, and on iPhone Duo at the
			// end of the top bar, beside the clock, instead of down in the side column.
			if #available(iOS 27.1, *), usesSideColumn {
				ToolbarItem(placement: .topBarTrailing) { infoButton }
					.axisBehavior(.horizontalOnly)
			} else {
				ToolbarItem(placement: .bottomBar) { infoButton }
			}
		}
	}

	private var infoButton: some View {
		Button { info.isShown.toggle() } label: {
			Label("Photo information", systemImage: info.isShown ? "info.circle.fill" : "info.circle")
		}
		.tint(.white)
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

// Opening Info scrolls the page, which would otherwise minimise the top bar on iPhone
// Duo and take the Info button with it.
private struct PinnedTopBar: ViewModifier {
	func body(content: Content) -> some View {
		if #available(iOS 27.0, *) {
			content.toolbarMinimizationBehavior(.never, for: .navigationBar)
		} else {
			content
		}
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
			// Over the viewer, not in place of it: a full-screen presentation takes the
			// viewer out of the window, and if an alert or sheet elsewhere then closes the
			// viewer under the player, UIKit can't zoom back from it and throws.
			playerController.modalPresentationStyle = .overFullScreen
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
	// The pages lay out under the bars, so the bars' height comes from the pager instead
	var bottomBarInset: CGFloat = 0

	init(isActive: Bool) {
		self.isActive = isActive
	}
}

// Shared by every page, so Info stays open while swiping between photos, like Photos'
@MainActor
@Observable
private final class PhotoViewerInfoState {
	var isShown: Bool

	init(isShown: Bool) {
		self.isShown = isShown
	}
}

// UIKit's page controller is data-source driven: it creates neighboring pages
// only when a gesture needs them, regardless of the library's total size.
private struct PhotoPageController: UIViewControllerRepresentable {
	let assets: PhotoLibraryModel.Assets
	let imageManager: PHCachingImageManager
	let model: MainModel
	let info: PhotoViewerInfoState
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
					model: parent.model,
					info: parent.info,
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
			if state.bottomBarInset != insets.bottom { state.bottomBarInset = insets.bottom }
		}
	}
}

private struct PhotoViewerPage: View {
	let asset: PHAsset
	let imageManager: PHCachingImageManager
	let model: MainModel
	let info: PhotoViewerInfoState
	let state: PhotoViewerPageState
	let onPlayVideo: (AVPlayer) -> Void
	let onTap: () -> Void

	@Environment(\.displayScale) private var displayScale
	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	@State private var representedIdentifier: String?
	@State private var imageRequestID: PHImageRequestID?
	@State private var videoRequestID: PHImageRequestID?
	@State private var imageRequestGeneration = 0
	@State private var videoRequestGeneration = 0
	@State private var image: UIImage?
	@State private var isLoadingVideo = false
	@State private var isZoomed = false
	@State private var scrollPosition = ScrollPosition()
	// Where this page is resting or heading, which a scroll in flight doesn't show yet
	@State private var restsOnInfo = false
	@State private var isDragging = false
	@State private var isInfoInView = false
	@State private var loadsInfo = false

	// Like Photos, Info isn't a sheet: it sits under the photo on the same page, and
	// opening it scrolls the photo up to make room.
	var body: some View {
		GeometryReader { geometry in
			let layout = PhotoViewerInfoLayout(container: geometry.size, asset: asset)
			ScrollView {
				VStack(spacing: 0) {
					media
						.frame(width: geometry.size.width, height: geometry.size.height)
						// Follows the scroll without a state change per frame, which would
						// rebuild the whole page as it moves
						.visualEffect { content, proxy in
							let progress = layout.progress(at: -proxy.frame(in: .scrollView).minY)
							return content
								.scaleEffect(layout.scale(at: progress))
								.offset(y: layout.shift(at: progress))
						}
						.clipped()
					infoSection(minHeight: layout.openOffset)
				}
			}
			.scrollIndicators(.hidden)
			.scrollEdgeEffectHidden()
			.scrollPosition($scrollPosition)
			.scrollTargetBehavior(PhotoViewerInfoSnap(openOffset: layout.openOffset, holdsInfo: restsOnInfo))
			.scrollDisabled(isZoomed)
			.onScrollGeometryChange(for: Bool.self) { scroll in
				scroll.contentOffset.y > 0
			} action: { _, isInView in
				isInfoInView = isInView
				if isInView { loadsInfo = true }
			}
			// Only where a swipe comes to rest decides whether Info is open: partway
			// through, or while the screen turns, the offset says nothing reliable
			.onScrollPhaseChange { _, phase, context in
				if phase == .interacting {
					isDragging = true
				} else if phase == .idle, isDragging {
					isDragging = false
					restsOnInfo = context.geometry.contentOffset.y > layout.openOffset / 2
					if state.isActive { info.isShown = restsOnInfo }
				}
			}
			.onAppear {
				requestImage(for: geometry.size)
			}
			.onChange(of: geometry.size) { _, size in
				requestImage(for: size)
			}
			.onChange(of: info.isShown) { _, isShown in
				guard restsOnInfo != isShown else { return }
				restsOnInfo = isShown
				withAnimation(state.isActive && !reduceMotion ? .snappy : nil) {
					scrollPosition.scrollTo(y: isShown ? layout.openOffset : 0)
				}
			}
			.onChange(of: layout.openOffset, initial: true) { _, openOffset in
				restsOnInfo = info.isShown
				if info.isShown { scrollPosition.scrollTo(y: openOffset) }
			}
		}
		.onChange(of: state.isActive) { _, active in
			if !active { cancelVideoRequest() }
		}
		.onDisappear { cancelRequests(clearImage: true) }
	}

	@ViewBuilder
	private var media: some View {
		ZStack {
			if asset.mediaType == .video {
				if let image {
					Button(action: requestVideo) {
						ZStack {
							Image(uiImage: image).resizable().scaledToFit()
							Group {
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
							.opacity(isInfoInView ? 0 : 1)
							.animation(.easeOut(duration: 0.15), value: isInfoInView)
						}
						.frame(maxWidth: .infinity, maxHeight: .infinity)
						.contentShape(Rectangle())
					}
					.buttonStyle(.plain)
					.disabled(isLoadingVideo || isInfoInView)
					.accessibilityLabel("Play video")
				} else {
					ProgressView().tint(.white)
				}
			} else if let image {
				ZoomablePhoto(
					image: image,
					allowsZoom: !isInfoInView,
					onTap: onTap,
					onZoomChange: { isZoomed = $0 }
				)
			} else {
				ProgressView()
					.tint(.white)
					.frame(maxWidth: .infinity, maxHeight: .infinity)
					.contentShape(Rectangle())
					.onTapGesture(perform: onTap)
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
	}

	// The details are only read once Info starts to show, not for every page swiped past
	private func infoSection(minHeight: CGFloat) -> some View {
		ZStack {
			if loadsInfo {
				PhotoViewerInfo(asset: asset)
					.environment(model)
					// For Try Again, as this page is hosted outside the app's own hierarchy
					.environment(\.brandColor, BrandColor.color(model.wallpaperBrandColorHsl))
					.frame(maxWidth: PhotoViewerInfoLayout.maxColumnWidth)
					.padding(.horizontal, 16)
					.padding(.top, 16)
					.padding(.bottom, 16 + state.bottomBarInset)
			}
		}
		.frame(maxWidth: .infinity, minHeight: minHeight, alignment: .top)
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

// Where Photos rests a photo with Info open: in a square at the top of the screen, or
// the top half of a wide one. A photo shorter than that grows to fill it, and a taller
// one shows its lower part.
private struct PhotoViewerInfoLayout: Sendable {
	// Photos' column of cards on a screen wider than an iPhone's
	static let maxColumnWidth: CGFloat = 574

	let container: CGSize
	let fittedHeight: CGFloat

	init(container: CGSize, asset: PHAsset) {
		self.container = container
		if asset.pixelWidth > 0, asset.pixelHeight > 0 {
			let aspect = CGFloat(asset.pixelWidth) / CGFloat(asset.pixelHeight)
			fittedHeight = max(min(container.height, container.width / aspect), 1)
		} else {
			fittedHeight = max(container.height, 1)
		}
	}

	var photoHeight: CGFloat { min(container.width, container.height / 2) }
	var openOffset: CGFloat { container.height - photoHeight }
	private var openScale: CGFloat { max(1, photoHeight / fittedHeight) }

	func progress(at offset: CGFloat) -> CGFloat {
		min(max(offset / max(openOffset, 1), 0), 1)
	}

	func scale(at progress: CGFloat) -> CGFloat {
		1 + progress * (openScale - 1)
	}

	// Moves the photo from the middle of its page to rest on the page's bottom edge
	func shift(at progress: CGFloat) -> CGFloat {
		progress * (container.height - fittedHeight * openScale) / 2
	}
}

// Rests on the photo or on Info, and scrolls freely through Info below that
private struct PhotoViewerInfoSnap: ScrollTargetBehavior {
	let openOffset: CGFloat
	// False while the Info button is closing it, which must pass straight through
	let holdsInfo: Bool

	func updateTarget(_ target: inout ScrollTarget, context: TargetContext) {
		guard target.rect.minY < openOffset else { return }
		let start = context.originalTarget.rect.minY
		// Points per millisecond; under this a release is a slow drag, not a flick
		let flick: CGFloat = 0.1
		let opens: Bool
		if holdsInfo, start > openOffset + 1 {
			// Scrolling back up through Info stops at its top, and only the next swipe closes it
			opens = true
		} else if abs(context.velocity.dy) > flick {
			opens = context.velocity.dy > 0
		} else {
			// A slow drag commits once it has clearly left where it started
			opens = target.rect.minY > openOffset * (start < openOffset / 2 ? 0.15 : 0.85)
		}
		target.rect.origin.y = opens ? openOffset : 0
	}
}

private struct ZoomablePhoto: UIViewRepresentable {
	let image: UIImage
	let allowsZoom: Bool
	let onTap: () -> Void
	let onZoomChange: (Bool) -> Void

	func makeCoordinator() -> Coordinator { Coordinator(onTap: onTap, onZoomChange: onZoomChange) }

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
		context.coordinator.onZoomChange = onZoomChange
		context.coordinator.allowsZoom = allowsZoom
		scrollView.pinchGestureRecognizer?.isEnabled = allowsZoom
		if !allowsZoom, scrollView.zoomScale > scrollView.minimumZoomScale {
			scrollView.setZoomScale(scrollView.minimumZoomScale, animated: true)
		}
		guard context.coordinator.imageView?.image !== image else { return }
		context.coordinator.imageView?.image = image
		scrollView.setZoomScale(1, animated: false)
		context.coordinator.updatePanning(in: scrollView)
	}

	final class Coordinator: NSObject, UIScrollViewDelegate {
		weak var imageView: UIImageView?
		var onTap: () -> Void
		var onZoomChange: (Bool) -> Void
		var allowsZoom = true
		private var isZoomed = false

		init(onTap: @escaping () -> Void, onZoomChange: @escaping (Bool) -> Void) {
			self.onTap = onTap
			self.onZoomChange = onZoomChange
		}

		@objc func didSingleTap() {
			onTap()
		}

		@objc func didDoubleTap(_ recognizer: UITapGestureRecognizer) {
			guard allowsZoom, let scrollView = recognizer.view as? UIScrollView, let imageView else { return }
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
			let zoomed = scrollView.zoomScale > 1.001
			scrollView.panGestureRecognizer.isEnabled = zoomed
			guard zoomed != isZoomed else { return }
			isZoomed = zoomed
			// Can be reached from a view update, where SwiftUI state mustn't change
			Task { @MainActor in onZoomChange(zoomed) }
		}
	}
}

// Photos' Info cards, without what this app can't edit (caption, date and keywords) or
// leaves out (location), and with the backup status Photos doesn't have.
private struct PhotoViewerInfo: View {
	let asset: PHAsset

	// Nil until it has been read, so the card can wait without claiming anything
	@State private var metadata: PhotoViewerMetadata?

	var body: some View {
		VStack(spacing: 16) {
			detailsCard
			PhotoViewerInfoCard {
				PhotoViewerBackupStatus(asset: asset, style: .details)
					.padding(.horizontal, 16)
					.padding(.vertical, 14)
			}
		}
		.task(id: asset.localIdentifier) {
			metadata = await PhotoViewerMetadata.load(for: asset)
		}
	}

	private var detailsCard: some View {
		PhotoViewerInfoCard {
			VStack(alignment: .leading, spacing: 0) {
				VStack(alignment: .leading, spacing: 3) {
					Text(dateLine)
					if let name = metadata?.name ?? (metadata == nil ? "Name" : nil) {
						Text(name)
							.foregroundStyle(.secondary)
							.lineLimit(1)
							.truncationMode(.middle)
					}
				}
				.padding(.horizontal, 16)
				.padding(.vertical, 16)

				Divider()
				HStack(spacing: 8) {
					Text(cameraLine)
						.lineLimit(1)
					Spacer(minLength: 8)
					if asset.mediaSubtypes.contains(.photoLive) {
						PhotoViewerBadge(text: "LIVE")
					}
					if let format = metadata?.format {
						PhotoViewerBadge(text: format)
					}
				}
				.padding(.horizontal, 16)
				.padding(.vertical, 11)

				Divider()
				VStack(alignment: .leading, spacing: 3) {
					if showsCameraDetails {
						Text(metadata?.lens ?? "No lens information")
					}
					Text(sizeLine)
				}
				.foregroundStyle(.secondary)
				.padding(.horizontal, 16)
				.padding(.vertical, 14)

				if showsCameraDetails {
					Divider()
					exposureRow
				}
			}
			.font(.subheadline)
			// The date too, which would otherwise visibly change once the camera's clock is read
			.redacted(reason: metadata == nil ? .placeholder : [])
		}
	}

	// A photo whose original is only in iCloud can't be read here, which isn't the
	// same as a photo that records no camera
	private var showsCameraDetails: Bool {
		!isVideo && metadata?.isOriginalUnavailable != true
	}

	private var cameraLine: String {
		if let camera = metadata?.camera { return camera }
		if isVideo { return "Video" }
		return metadata?.isOriginalUnavailable == true ? "Camera information unavailable" : "No camera information"
	}

	// Photos keeps all five cells, with a dash for a setting the photo doesn't record.
	// It spaces the values evenly by their own widths, and a row of dashes in equal cells.
	private var exposureRow: some View {
		let exposure = metadata?.exposure ?? PhotoViewerMetadata.noExposure
		let isEmpty = exposure.allSatisfy { $0 == nil }
		return HStack(spacing: 0) {
			ForEach(Array(exposure.enumerated()), id: \.offset) { index, value in
				if index > 0 {
					if !isEmpty { Spacer(minLength: 4) }
					Divider().frame(height: 16)
					if !isEmpty { Spacer(minLength: 4) }
				}
				Text(value ?? "-")
					.lineLimit(1)
					.minimumScaleFactor(0.8)
					.frame(minWidth: 28, maxWidth: isEmpty ? .infinity : nil)
			}
		}
		.font(.footnote)
		.foregroundStyle(.secondary)
		.padding(.horizontal, 16)
		.padding(.vertical, 13)
		.accessibilityElement(children: .combine)
	}

	private var isVideo: Bool { asset.mediaType == .video }

	private var dateLine: String {
		// The time on the camera's own clock when it recorded one, as in Photos and in
		// umbrelOS, so a photo reads the same wherever and whenever it's looked at
		let date: Date
		var style = Date.FormatStyle()
		if let cameraClock = metadata?.cameraClock {
			date = cameraClock
			style.timeZone = .gmt
		} else if let creationDate = asset.creationDate {
			date = creationDate
		} else {
			return "No date"
		}
		return [
			date.formatted(style.weekday(.wide)),
			date.formatted(style.month(.abbreviated).day().year()),
			date.formatted(style.hour().minute()),
		].joined(separator: " • ")
	}

	private var sizeLine: String {
		var parts: [String] = []
		let megapixels = Double(asset.pixelWidth * asset.pixelHeight) / 1_000_000
		if !isVideo, megapixels > 0 {
			let precision = megapixels < 1 ? 1 : 0
			parts.append("\(megapixels.formatted(.number.precision(.fractionLength(precision)))) MP")
		}
		if asset.pixelWidth > 0, asset.pixelHeight > 0 {
			parts.append("\(asset.pixelWidth) × \(asset.pixelHeight)")
		}
		if let bytes = metadata?.bytes, bytes > 0 {
			parts.append(ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file))
		}
		if isVideo {
			parts.append(duration)
		}
		return parts.joined(separator: " • ")
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

private struct PhotoViewerInfoCard<Content: View>: View {
	@ViewBuilder var content: Content

	var body: some View {
		content
			.frame(maxWidth: .infinity, alignment: .leading)
			.background(Color(uiColor: .secondarySystemBackground))
			.clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
	}
}

private struct PhotoViewerBadge: View {
	let text: String

	var body: some View {
		Text(text)
			.font(.caption2.weight(.medium))
			.padding(.horizontal, 8)
			.padding(.vertical, 3)
			.background(.fill.secondary, in: Capsule())
	}
}

extension PHAsset {
	// The resource an asset's file name is read from: the photo or video itself where
	// there is one. It's read from the photo library, so not on the main thread.
	var namingResource: PHAssetResource? {
		let resources = PHAssetResource.assetResources(for: self)
		return resources.first { $0.type == .photo || $0.type == .video } ?? resources.first
	}
}

// The file and camera details Photos shows, read from the photo's own metadata.
private struct PhotoViewerMetadata {
	static let noExposure: [String?] = Array(repeating: nil, count: 5)

	var name: String?
	var format: String?
	var camera: String?
	var lens: String?
	// ISO, focal length, exposure bias, aperture and shutter speed, in Photos' order
	var exposure = noExposure
	// The capture time as the camera showed it, held as if that clock were GMT
	var cameraClock: Date?
	var bytes: Int64?
	var isOriginalUnavailable = false

	// Only what's on this iPhone: a photo kept in iCloud isn't downloaded just for its
	// details. The file is read where it is, its header only, never loaded whole.
	static func load(for asset: PHAsset) async -> PhotoViewerMetadata {
		await withCheckedContinuation { continuation in
			DispatchQueue.global(qos: .userInitiated).async {
				var metadata = PhotoViewerMetadata()
				if let resource = asset.namingResource {
					metadata.name = (resource.originalFilename as NSString).deletingPathExtension
					metadata.format = format(of: resource)
				}
				let loaded = metadata

				switch asset.mediaType {
				case .image:
					let options = PHContentEditingInputRequestOptions()
					options.isNetworkAccessAllowed = false
					asset.requestContentEditingInput(with: options) { input, _ in
						// Photos calls back on the main queue, and the file is only there while `input` is
						DispatchQueue.global(qos: .userInitiated).async {
							var metadata = loaded
							if let url = input?.fullSizeImageURL {
								metadata.read(url)
							} else {
								metadata.isOriginalUnavailable = true
							}
							continuation.resume(returning: metadata)
						}
					}
				case .video:
					let options = PHVideoRequestOptions()
					options.version = .original
					options.isNetworkAccessAllowed = false
					PHImageManager.default().requestAVAsset(forVideo: asset, options: options) { avAsset, _, _ in
						var metadata = loaded
						metadata.bytes = ((avAsset as? AVURLAsset)?.url).flatMap(fileSize)
						continuation.resume(returning: metadata)
					}
				default:
					continuation.resume(returning: loaded)
				}
			}
		}
	}

	// Photos names the format, not the file extension: HEIF for .heic, JPEG for .jpg.
	private static func format(of resource: PHAssetResource) -> String? {
		guard let type = UTType(resource.uniformTypeIdentifier) else { return nil }
		if type.conforms(to: .heic) || type.conforms(to: .heif) { return "HEIF" }
		if type.conforms(to: .jpeg) { return "JPEG" }
		if type.conforms(to: .png) { return "PNG" }
		if type.conforms(to: .quickTimeMovie) { return "MOV" }
		if type.conforms(to: .mpeg4Movie) { return "MP4" }
		return type.preferredFilenameExtension?.uppercased()
	}

	private static func fileSize(_ url: URL) -> Int64? {
		(try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize.map(Int64.init)
	}

	private mutating func read(_ url: URL) {
		bytes = Self.fileSize(url)
		guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
		      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else { return }
		let tiff = properties[kCGImagePropertyTIFFDictionary] as? [CFString: Any] ?? [:]
		let exif = properties[kCGImagePropertyExifDictionary] as? [CFString: Any] ?? [:]
		let aux = properties[kCGImagePropertyExifAuxDictionary] as? [CFString: Any] ?? [:]

		let make = (tiff[kCGImagePropertyTIFFMake] as? String)?.trimmingCharacters(in: .whitespaces)
		let model = (tiff[kCGImagePropertyTIFFModel] as? String)?.trimmingCharacters(in: .whitespaces)
		// "Apple" + "iPhone 15 Pro" reads as one name, but Nikon's model already starts
		// with "NIKON", so its make ("NIKON CORPORATION") would repeat it.
		if let model, !model.isEmpty {
			let brand = make?.split(separator: " ").first.map(String.init) ?? ""
			if let make, !brand.isEmpty, !model.localizedCaseInsensitiveContains(brand) {
				camera = "\(make) \(model)"
			} else {
				camera = model
			}
		}

		let focalLength = (exif[kCGImagePropertyExifFocalLenIn35mmFilm] as? NSNumber)?.doubleValue
			?? (exif[kCGImagePropertyExifFocalLength] as? NSNumber)?.doubleValue
		let aperture = (exif[kCGImagePropertyExifFNumber] as? NSNumber)?.doubleValue
		let focalText = focalLength.flatMap { $0 > 0 ? "\(Int($0.rounded())) mm" : nil }
		let apertureText = aperture.flatMap { $0 > 0 ? "ƒ\($0.formatted(.number.precision(.fractionLength(0...2))))" : nil }

		// Cameras with interchangeable lenses name the lens outside the main EXIF block
		let lensModel = ((exif[kCGImagePropertyExifLensModel] ?? aux[kCGImagePropertyExifAuxLensModel]) as? String)?
			.trimmingCharacters(in: .whitespaces)
		if let lensModel, !lensModel.isEmpty {
			if make == "Apple", let focalText, let apertureText {
				// iPhones write "iPhone X back dual camera 6mm f/2.4", which Photos shows
				// as "Telephoto Camera — 52 mm ƒ2.4"
				let camera = Self.iPhoneCamera(
					lensModel: lensModel,
					focalLength: (exif[kCGImagePropertyExifFocalLength] as? NSNumber)?.doubleValue,
					lensRange: (exif[kCGImagePropertyExifLensSpecification] as? [NSNumber])?.map(\.doubleValue) ?? []
				)
				lens = [camera, "\(focalText) \(apertureText)"].compactMap { $0 }.joined(separator: " — ")
			} else {
				lens = lensModel.replacingOccurrences(of: "f/", with: "ƒ")
			}
		}

		if let taken = exif[kCGImagePropertyExifDateTimeOriginal] as? String {
			let formatter = DateFormatter()
			formatter.locale = Locale(identifier: "en_US_POSIX")
			formatter.timeZone = .gmt
			formatter.dateFormat = "yyyy:MM:dd HH:mm:ss"
			cameraClock = formatter.date(from: taken)
		}

		if let iso = (exif[kCGImagePropertyExifISOSpeedRatings] as? [NSNumber])?.first {
			exposure[0] = "ISO \(iso.intValue)"
		}
		exposure[1] = focalText
		if let bias = (exif[kCGImagePropertyExifExposureBiasValue] as? NSNumber)?.doubleValue {
			exposure[2] = "\(bias.formatted(.number.precision(.fractionLength(0...1)))) ev"
		}
		exposure[3] = apertureText
		if let time = (exif[kCGImagePropertyExifExposureTime] as? NSNumber)?.doubleValue, time > 0 {
			exposure[4] = time < 0.5
				? "1/\(Int((1 / time).rounded())) s"
				: "\(time.formatted(.number.precision(.fractionLength(1)))) s"
		}
	}

	// Which of the iPhone's cameras took it, told by the lens itself and not the zoom:
	// a 2× crop of the Main camera reports 48 mm and is still the Main camera. The file
	// gives the shortest and longest lenses of the camera system; nil when that isn't
	// enough to be sure.
	private static func iPhoneCamera(lensModel: String, focalLength: Double?, lensRange: [Double]) -> String? {
		let model = lensModel.lowercased()
		if model.contains("front") { return "Front Camera" }
		guard model.contains("back") else { return nil }
		guard model.contains("dual") || model.contains("triple") else { return "Main Camera" }
		guard let focalLength, lensRange.count >= 2 else { return nil }
		let isShortest = abs(focalLength - lensRange[0]) < 0.1
		let isLongest = abs(focalLength - lensRange[1]) < 0.1
		if model.contains("dual wide") {
			return isShortest ? "Ultra Wide Camera" : isLongest ? "Main Camera" : nil
		}
		if model.contains("triple") {
			return isShortest ? "Ultra Wide Camera" : isLongest ? "Telephoto Camera" : "Main Camera"
		}
		return isShortest ? "Main Camera" : isLongest ? "Telephoto Camera" : nil
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
			}
		} else {
			switch style {
			case .toolbar:
				Color.clear
					.frame(width: 1, height: 38)
			case .details:
				Label("Checking backup", systemImage: "clock")
					.font(.subheadline)
					.foregroundStyle(.secondary)
			}
		}
	}

	private func detailsStatusLabel(_ status: Status) -> some View {
		VStack(alignment: .leading, spacing: 0) {
			// A failure's sentence runs to a few lines, so its icon sits by the title
			HStack(alignment: status.failureReason == nil ? .center : .top, spacing: 12) {
				Image(systemName: status.icon)
					.font(.title3)
					.foregroundStyle(.primary)
					.frame(width: 28)
				VStack(alignment: .leading, spacing: 2) {
					Text(status.text)
						.font(.subheadline.weight(.semibold))
					if let detail = detailText(status) {
						Text(detail)
							.font(.footnote)
							.foregroundStyle(.secondary)
							.fixedSize(horizontal: false, vertical: true)
					}
				}
				Spacer(minLength: 0)
			}
			.accessibilityElement(children: .combine)
			if status.failureReason?.offersRetry == true, isListed {
				PillButton(
					title: "Try Again",
					isLoading: model.photoBackupRetryInProgress,
					action: model.retryFailedPhotoBackups
				)
					// Under the sentence, past the icon's column
					.padding(.leading, 40)
					.padding(.top, 4)
					// PillButton keeps a 7pt margin around its capsule for its 44pt tap target
					.padding(.bottom, -7)
			}
		}
	}

	// Whether Profile lists this item among those that couldn't back up, which is when
	// Try Again reaches it and it's tried again by itself. Not while backup isn't set up
	// here, or is still being set up to include its media type.
	private var isListed: Bool { model.photoBackupMedia.includes(asset.mediaType) }

	private func detailText(_ status: Status) -> String? {
		switch status {
		case .backedUp:
			guard let bytes = status.backupBytes else { return "Saved to your Umbrel" }
			return "\(ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)) saved to your Umbrel"
		case .notBackedUp:
			return asset.mediaType == .video ? "Video backup is turned off." : "Photo backup is turned off."
		case .waiting:
			return nil
		case .failed(let reason):
			return reason.detail(retriesByItself: isListed && model.photoBackupRetriesFailuresByItself)
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
			status = .failed(record?.failureReason ?? .general)
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
		case backedUp(bytes: Int64), waiting, notBackedUp, failed(PhotoBackupFailureReason)

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

		var failureReason: PhotoBackupFailureReason? {
			guard case let .failed(reason) = self else { return nil }
			return reason
		}
	}
}
