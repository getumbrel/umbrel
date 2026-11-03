import Photos
import SwiftUI
import UIKit
import UmbrelKit

// The Library tab is the iPhone's actual PhotoKit library with Umbrel backup state
// layered on top. Backup receipts never decide which assets are visible.
struct LibraryView: View {
	@Environment(MainModel.self) private var model
	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	@Namespace private var photoViewerTransition
	@State private var viewerSelection: PhotoViewerSelection?
	@State private var isNearLatest = true
	@State private var scrollToLatestRequest = 0
	@State private var showsPhotoBackupInfo = false
	private var backupEnabled: Bool { model.backupPhotosEnabled || model.backupVideosEnabled }

	var body: some View {
		GeometryReader { geometry in
			ScrollView(showsIndicators: false) {
				VStack(alignment: .leading, spacing: 24) {
					titleBlock
					if model.showsPhotoLibrary, model.canSwitchPhotoBackupHere,
						let destination = model.otherPhotoBackupDestinationName
					{
						PhotoBackupElsewhereNotice(destination: destination)
					}
					if let notice = model.photoBackupNotice {
						PhotoBackupNoticeCard(
							notice: notice,
							setUpTailscale: model.presentTailscaleSetup,
							dismissOffer: model.dismissBackUpAnywhereOffer,
							retryStorage: model.retryPhotoBackupAfterInsufficientStorage,
							retryBackup: model.retryPhotoBackupAfterError
						)
					}
					if model.showsPhotoLibrary {
						statTiles
						ViewAllInPhotosButton()
						photoGrid(gridWidth: max(geometry.size.width - (Theme.contentInset * 2) - 16, 0))
					} else {
						setupCard
						if model.photoBackupIsConfiguredElsewhere {
							// umbrelOS's Photos holds every device's backups, so it stays one tap away
							ViewAllInPhotosButton()
						}
					}
				}
				.frame(maxWidth: .infinity, alignment: .leading)
				.padding(.horizontal, Theme.contentInset)
				.padding(.top, 56)
				.padding(.bottom, 32)
			}
			.background { SeeThroughTab() }
			.environment(\.frostWallpaper, model.blurredWallpaper)
		}
		.fullScreenCover(item: $viewerSelection) { selection in
			PhotoViewer(
				initialIndex: selection.index,
				initialAssetIdentifier: selection.assetIdentifier,
				transitionNamespace: photoViewerTransition
			)
		}
		.sheet(isPresented: $showsPhotoBackupInfo) {
			PhotoBackupInfoSheet(sourceName: model.photoBackupSourceName)
				.task { await model.refreshPhotoBackupSourceName() }
		}
	}

	// "Library", a sync status row, and a one-line explainer.
	private var titleBlock: some View {
		VStack(alignment: .leading, spacing: 12) {
			VStack(alignment: .leading, spacing: 4) {
				Text("Library")
					.font(.largeTitle.bold())
					.foregroundStyle(.white)
				if model.showsPhotoLibrary {
					HStack(spacing: 4) {
						StatusDot(color: statusColor)
						Text(statusText)
							.font(.subheadline.weight(.medium))
							.foregroundStyle(.white)
							.lineLimit(2)
							.truncationMode(.tail)
					}
				}
			}
			// While backup goes elsewhere, the notice below says where and offers the switch
			if model.showsPhotoLibrary, !model.photoBackupIsConfiguredElsewhere {
				Button { showsPhotoBackupInfo = true } label: {
					Text("\(photoBackupDescription) \(Text("How\u{00A0}it\u{00A0}works\u{00A0}").fontWeight(.semibold))\(Text(Image(systemName: "chevron.right")).font(.system(size: 10, weight: .semibold)))")
						.font(.footnote.weight(.medium))
						.foregroundStyle(.white.opacity(0.8))
						.fixedSize(horizontal: false, vertical: true)
				}
				.buttonStyle(.plain)
				.accessibilityLabel("\(photoBackupDescription) How Photo Backup works")
				.accessibilityHint("Explains background uploads, Tailscale, and photo access")
			}
		}
	}

	private var statusText: String {
		if model.photoBackupIsConfiguredElsewhere { return "On another Umbrel" }
		return model.photoBackupStatus.text
	}

	private var statusColor: Color {
		if model.photoBackupIsConfiguredElsewhere { return Theme.gray }
		return model.photoBackupStatus.color
	}

	private var photoBackupDescription: String {
		if !backupEnabled {
			return "Photos and videos already backed up remain on your Umbrel."
		}
		// The status line above says what's happening; How it works has the rest. Home
		// versus anywhere is the one difference Tailscale makes that people notice.
		if model.photoBackupRoute == .tailscale {
			return "Your photos and videos back up to your Umbrel automatically, wherever you are."
		}
		return "Your photos and videos back up to your Umbrel automatically when you\u{2019}re home."
	}

	// The extension maintains these totals incrementally in its durable ledger. The
	// foreground app never walks the entire PhotoKit library to render this row.
	private var statTiles: some View {
		let statistics = model.photoBackup.statistics
		return HStack(spacing: 8) {
			LibraryStatTile(
				icon: "photo.stack",
				value: formatCount(statistics?.uploadedPhotoCount ?? 0),
				label: "Photos"
			)
			LibraryStatTile(
				icon: "video",
				value: formatCount(statistics?.uploadedVideoCount ?? 0),
				label: "Videos"
			)
			LibraryStatTile(
				icon: "checkmark.icloud",
				value: formatStorageSize(Double(statistics?.uploadedBytes ?? 0)),
				label: "Storage"
			)
		}
	}

	// The complete iPhone library in chronological order inside the Library card:
	// four full rows plus ~60% of a fifth row
	// bleeding through the card's top edge, so the crop itself signals that older
	// photos are a scroll away. Padding stays on the sides and bottom only; smaller
	// libraries shrink to their exact height with the original padded layout.
	private func photoGrid(gridWidth: CGFloat) -> some View {
		let cols = 3
		let assets = model.photoLibrary.assets
		let count = assets.count
		let rows = Int(ceil(Double(count) / Double(cols)))
		let cellWidth = (gridWidth - 8) / CGFloat(cols)
		// Beyond four rows the card adopts the fixed-height bled layout:
		// 4.6 rows of tile and four 4pt gaps, with the viewport pulled up through
		// the card's top padding so the partial row crops at the card edge.
		let bleeds = rows > 4
		let viewportShape = RoundedRectangle(cornerRadius: 16, style: .continuous)
		// Bled viewport spans the card's full interior height, top edge to bottom
		// edge; the 8pt at-rest gap below the newest row scrolls with the content.
		let viewportHeight =
			bleeds
			? (4.6 * cellWidth) + 24
			: (CGFloat(rows) * cellWidth) + (CGFloat(max(0, rows - 1)) * 4)

		return Group {
			if count == 0 {
				SectionCard {
					Text("No photos or videos")
						.font(.footnote.weight(.medium))
						.foregroundStyle(.white.opacity(0.6))
						.frame(maxWidth: .infinity)
						.padding(.vertical, 32)
				}
			} else {
				SectionCard(padding: 8) {
					PhotoLibraryGrid(
						assets: assets,
						imageManager: model.photoLibrary.imageManager,
						receiptCache: model.photoBackupReceipts,
						transitionNamespace: photoViewerTransition,
						backupSourceId: model.photoBackup.sourceId,
						backupRevision: model.photoBackupReceiptRevision,
						columns: cols,
						rows: rows,
						bleeds: bleeds,
						bottomContentInset: bleeds ? 8 : 0,
						scrollToLatestRequest: scrollToLatestRequest,
						onNearLatestChange: { isNearLatest = $0 }
					) { index, identifier in
						viewerSelection = PhotoViewerSelection(index: index, assetIdentifier: identifier)
					}
					.frame(height: viewportHeight)
					// Bled: the scroll view's own rectangular bounds give rows a
					// straight cut at both edges; the card-boundary clip then shaves
					// only the slivers that would poke past the card's corner curves.
					// Compact keeps the original 16pt viewport clip.
					.clipShape(bleeds ? AnyShape(CardBoundaryCrop()) : AnyShape(viewportShape))
					// The bled viewport reaches through the card's top and bottom
					// padding so mid-scroll rows crop at the card's edges, while the
					// sides keep the card's 8pt insets.
					.padding(.vertical, bleeds ? -8 : 0)
					.overlay(alignment: .bottom) {
						if bleeds && !isNearLatest {
							Button {
								scrollToLatestRequest += 1
							} label: {
								Image(systemName: "arrow.down")
									.font(.system(size: 15, weight: .semibold))
									.foregroundStyle(.white)
									.frame(width: 40, height: 40)
									.background {
										AccessibleMaterialBackground(shape: Circle())
									}
									.glassGlint(in: Circle())
							}
							.buttonStyle(.plain)
							.frame(width: 56, height: 56)
							.contentShape(Rectangle())
							.accessibilityLabel("Jump to Latest")
							.padding(.bottom, 4)
							.zIndex(1)
							.transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.9)))
						}
					}
					.animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: isNearLatest)
				}
			}
		}
	}

	// In place of the library: before Photos access exists, and while backup goes to
	// another Umbrel that has nothing from this iPhone (see showsPhotoLibrary)
	private var setupCard: some View {
		PhotoBackupSetupCard(learnMore: { showsPhotoBackupInfo = true })
	}

	private func formatCount(_ count: Int) -> String {
		guard count >= 1000 else { return "\(count)" }
		let thousands = String(format: "%.1f", Double(count) / 1000)
			.replacingOccurrences(of: ".0", with: "")
		return "\(thousands)k"
	}

}

// How it works, from Library, its setup card and Profile's Photos section
struct PhotoBackupInfoSheet: View {
	@Environment(\.dismiss) private var dismiss
	// Nil when the Umbrel may know this device by a name the app doesn't have
	let sourceName: String?

	var body: some View {
		NavigationStack {
			ScrollView(showsIndicators: false) {
				VStack(spacing: 24) {
					hero
					VStack(spacing: 0) {
						InfoPageRow(
							icon: "house",
							title: "Automatic at home",
							message: "Backs up when you open the app, and from time to time while your iPhone charges."
						)
						InfoPageDivider()
						InfoPageRow(
							icon: "network",
							title: "Anywhere with Tailscale",
							message: "With Tailscale, iOS backs up new photos in the background, even when the app is closed or you\u{2019}re away from home. Your Umbrel also works from anywhere."
						)
						InfoPageDivider()
						InfoPageRow(
							icon: "bell",
							title: "Tells you if it stops",
							message: "If nothing has backed up for a week, Umbrel sends a reminder to open the app."
						)
						InfoPageDivider()
						InfoPageRow(
							icon: "photo.badge.checkmark",
							title: "Needs Full Photo Library access",
							message: "Choose Full Access so every photo and video can back up. Choose photos, videos, or both in Profile."
						)
						if let sourceName {
							InfoPageDivider()
							InfoPageRow(
								icon: "iphone",
								title: "Your iPhone on Umbrel",
								message: "This iPhone shows as \u{201c}\(sourceName)\u{201d} in Photos on your Umbrel."
							)
						}
						InfoPageDivider()
						InfoPageRow(
							icon: "wand.and.stars",
							title: "Keeps up with edits",
							message: "When you edit a photo or video, the new version backs up. Your Umbrel keeps the latest version."
						)
						InfoPageDivider()
						InfoPageRow(
							icon: "pause.circle",
							title: "Turning backup off",
							message: "Turning backup off stops uploads. Anything already backed up remains on your Umbrel."
						)
					}
					.background(Color(hex: 0x2C2C2E), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
				}
				.padding(.horizontal, 20)
				.padding(.top, 20)
				.padding(.bottom, 32)
			}
			.scrollEdgeEffectStyle(.soft, for: .top)
			.background(Color(hex: 0x1C1C1E).ignoresSafeArea())
			.navigationTitle("Photo Backup")
			.navigationBarTitleDisplayMode(.inline)
			.toolbar {
				DrawerCloseToolbarItem(action: { dismiss() })
			}
		}
		.presentationDragIndicator(.visible)
		.presentationCornerRadius(38)
		.presentationBackground(Color(hex: 0x1C1C1E))
	}

	private var hero: some View {
		VStack(spacing: 14) {
			Image(systemName: "photo.stack")
				.font(.system(size: 34, weight: .semibold))
				.foregroundStyle(.white)
				.frame(width: 76, height: 76)
				.background(Color.white.opacity(0.08), in: Circle())
			Text("How Photo Backup works")
				.font(.title2.bold())
				.foregroundStyle(.white)
			Text("Automatically back up this iPhone’s photos and videos directly to your Umbrel.")
				.font(.subheadline)
				.foregroundStyle(Theme.gray)
				.multilineTextAlignment(.center)
				.fixedSize(horizontal: false, vertical: true)
		}
		.padding(.horizontal, 12)
	}

}

#Preview("Photo Backup Info") {
	PhotoBackupInfoSheet(sourceName: "Nate\u{2019}s iPhone")
}

private struct PhotoViewerSelection: Identifiable {
	let index: Int
	let assetIdentifier: String
	var id: String { assetIdentifier }
}

// The card's rounded boundary expressed in the bled photo viewport's coordinates:
// the viewport sits inset 8pt from the card's sides and spans its full height.
// Clipping the viewport with this crops mid-scroll rows the way the card itself
// would: a straight cut at the top and bottom edges, with only the outermost
// corner slivers shaved by the card's corner curves.
private struct CardBoundaryCrop: Shape {
	func path(in rect: CGRect) -> Path {
		RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
			.path(in: CGRect(
				x: rect.minX - 8,
				y: rect.minY,
				width: rect.width + 16,
				height: rect.height
			))
	}
}

// One permission-aware setup card shared by Home and Library. iOS always offers
// Limited Access in its system sheet, but PhotoKit's background upload extension
// requires Full Access, so Limited must lead to an explicit Settings upgrade.
struct PhotoBackupSetupCard: View {
	@Environment(MainModel.self) private var model
	@Environment(\.openURL) private var openURL
	@State private var isConfirmingSwitch = false
	var learnMore: (() -> Void)? = nil

	var body: some View {
		Group {
			if let destination = model.otherPhotoBackupDestinationName, model.canSwitchPhotoBackupHere {
				EmptyStateCard(
					icon: "photo.stack",
					title: "Photo Backup is on for \(destination)",
					subtitle: "This iPhone can back up to one Umbrel at a time.",
					buttonTitle: model.photoBackupSetupInProgress ? "Switching backup\u{2026}" : "Back Up to This Umbrel",
					buttonLoading: model.photoBackupSetupInProgress,
					action: { isConfirmingSwitch = true }
				)
				.photoBackupSwitchConfirmation(isPresented: $isConfirmingSwitch, destination: destination)
			} else {
				EmptyStateCard(
					icon: "photo.on.rectangle.angled",
					title: title,
					subtitle: subtitle,
					buttonTitle: buttonTitle,
					buttonLoading: model.photoBackupSetupInProgress,
					learnMore: learnMore,
					action: {
						if needsSettings {
							if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
						} else {
							model.enableBackup()
						}
					}
				)
			}
		}
	}

	private var buttonTitle: String {
		if needsSettings { return "Open Settings" }
		return model.photoBackupSetupInProgress ? "Starting backup…" : "Set up backup"
	}

	private var needsSettings: Bool {
		switch model.photoLibrary.authorizationStatus {
		case .limited, .denied, .restricted:
			true
		default:
			false
		}
	}

	private var title: String {
		switch model.photoLibrary.authorizationStatus {
		case .limited, .denied, .restricted:
			"Full Photos access required"
		default:
			"Back up your photos"
		}
	}

	private var subtitle: String {
		switch model.photoLibrary.authorizationStatus {
		case .limited, .denied, .restricted:
			"Allow Full Access to view your library and use automatic backup. Existing backups remain on your Umbrel."
		default:
			// Setup asks to send notifications, so this says what they're for
			"Back up this iPhone\u{2019}s photos and videos to your Umbrel. You\u{2019}ll get a reminder if backup stops."
		}
	}
}

extension View {
	// Switching stops backup for the other Umbrel, so it's always confirmed first
	func photoBackupSwitchConfirmation(isPresented: Binding<Bool>, destination: String) -> some View {
		modifier(PhotoBackupSwitchConfirmation(isPresented: isPresented, destination: destination))
	}
}

// Backup goes to another Umbrel while this one holds older backups from this iPhone,
// so the gallery stays and this offers the way to move backup here
private struct PhotoBackupElsewhereNotice: View {
	@State private var isConfirmingSwitch = false
	let destination: String

	var body: some View {
		NoticeCard(
			icon: "photo.stack",
			title: "Photo Backup is on for \(destination)",
			message: "This iPhone can back up to one Umbrel at a time.",
			actionLabel: "Back Up Here",
			action: { isConfirmingSwitch = true }
		)
		.photoBackupSwitchConfirmation(isPresented: $isConfirmingSwitch, destination: destination)
	}
}

private struct PhotoBackupSwitchConfirmation: ViewModifier {
	@Environment(MainModel.self) private var model
	@Binding var isPresented: Bool
	let destination: String

	func body(content: Content) -> some View {
		content
			.alert("Back up to this Umbrel instead?", isPresented: $isPresented) {
				Button("Back Up to This Umbrel", action: model.backUpToThisUmbrelInstead)
				Button("Cancel", role: .cancel) {}
			} message: {
				Text("Photo Backup will stop for \(destination) and start for this Umbrel. Photos already backed up to \(destination) stay there.")
			}
	}
}

private struct LibraryStatTile: View {
	let icon: String
	let value: String
	let label: String

	var body: some View {
		SectionCard(padding: 0) {
			VStack(spacing: 10) {
				Image(systemName: icon)
					.font(.system(size: 20))
					.foregroundStyle(.white)
				VStack(spacing: 2) {
					Text(value)
						.font(.footnote.weight(.semibold))
						.foregroundStyle(.white)
						.shadow(color: .white.opacity(0.25), radius: 2)
					Text(label)
						.font(.footnote.weight(.semibold))
						.foregroundStyle(.white)
				}
			}
			.frame(maxWidth: .infinity)
			.frame(minHeight: 114)
		}
	}
}

enum PhotoAssetBackupBadge: Equatable {
	case backedUp
}

func photoBackupBadge(record: PhotoBackupLedger.AssetRecord?) -> PhotoAssetBackupBadge? {
	guard let record, record.state == .uploaded else { return nil }
	return .backedUp
}

// A PhotoKit thumbnail shared by Home and Library. The one badge has one durable
// meaning: change ingestion has a completed upload receipt for this asset's
// current durable ledger revision.
struct AssetThumbnail: View {
	let asset: PHAsset
	let imageManager: PHCachingImageManager
	let shape: UnevenRoundedRectangle
	let receiptCache: PhotoBackupReceiptCache
	let backupSourceId: String?
	let backupRevision: Date
	let thumbnailTargetSize: CGSize
	@State private var image: UIImage?
	@State private var requestID: PHImageRequestID?
	@State private var representedIdentifier: String?
	@State private var requestGeneration = 0
	@State private var badge: PhotoAssetBackupBadge?

	var body: some View {
		shape
			.fill(Color.white.opacity(0.06))
			.aspectRatio(1, contentMode: .fit)
			.overlay {
				if let image {
					GeometryReader { proxy in
						Image(uiImage: image)
							.resizable()
							.scaledToFill()
							.frame(width: proxy.size.width, height: proxy.size.height)
					}
				}
			}
			.overlay(alignment: .bottomLeading) {
				if asset.mediaType == .video {
					Text(videoDuration)
						.font(.system(size: 10, weight: .semibold, design: .rounded))
						.foregroundStyle(.white)
						.padding(.horizontal, 5)
						.padding(.vertical, 3)
						.background(.black.opacity(0.55), in: .capsule)
						.padding(6)
				}
			}
			.overlay(alignment: .bottomTrailing) { backupBadge }
			.clipShape(shape)
			.task(id: ThumbnailRequest(assetIdentifier: asset.localIdentifier, targetSize: thumbnailTargetSize)) {
				requestThumbnail()
			}
			.task(id: receiptRequest) { await refreshBackupBadge() }
			.onDisappear(perform: cancelThumbnailRequest)
	}

	private var receiptRequest: PhotoBackupReceiptRequest {
		PhotoBackupReceiptRequest(
			sourceId: backupSourceId,
			revision: backupRevision,
			localIdentifier: asset.localIdentifier,
			modificationDate: asset.modificationDate ?? asset.creationDate ?? .distantPast
		)
	}

	@ViewBuilder
	private var backupBadge: some View {
		switch badge {
		case .backedUp:
			Image(systemName: "checkmark.circle.fill")
				.font(.system(size: 18, weight: .semibold))
				.foregroundStyle(.white.opacity(0.8))
				.shadow(color: .black.opacity(0.55), radius: 2, y: 1)
				.padding(6)
		case nil:
			EmptyView()
		}
	}

	private var videoDuration: String {
		let total = Int(asset.duration.rounded())
		return String(format: "%d:%02d", total / 60, total % 60)
	}

	private func requestThumbnail() {
		cancelThumbnailRequest()
		let generation = requestGeneration
		let identifier = asset.localIdentifier
		if representedIdentifier != identifier {
			representedIdentifier = identifier
			image = nil
		}
		let options = PhotoThumbnailRequest.options()
		requestID = imageManager.requestImage(
			for: asset,
			targetSize: thumbnailTargetSize,
			contentMode: .aspectFill,
			options: options
		) { result, info in
			guard let result, info?[PHImageCancelledKey] as? Bool != true else { return }
			Task { @MainActor in
				guard generation == requestGeneration, representedIdentifier == identifier else { return }
				image = result
				if info?[PHImageResultIsDegradedKey] as? Bool != true { requestID = nil }
			}
		}
	}

	private func refreshBackupBadge() async {
		guard let backupSourceId else {
			badge = nil
			return
		}
		let record = await receiptCache.record(
			sourceId: backupSourceId,
			revision: backupRevision,
			localIdentifier: asset.localIdentifier
		)
		guard !Task.isCancelled else { return }
		badge = photoBackupBadge(record: record)
	}

	private func cancelThumbnailRequest() {
		if let requestID { imageManager.cancelImageRequest(requestID) }
		requestID = nil
		requestGeneration &+= 1
	}
}

enum PhotoThumbnailRequest {
	static func options() -> PHImageRequestOptions {
		let options = PHImageRequestOptions()
		options.deliveryMode = .opportunistic
		options.resizeMode = .fast
		options.isNetworkAccessAllowed = true
		return options
	}
}

private struct ThumbnailRequest: Hashable {
	let assetIdentifier: String
	let targetSize: CGSize
}

private struct PhotoBackupReceiptRequest: Hashable {
	let sourceId: String?
	let revision: Date
	let localIdentifier: String
	let modificationDate: Date
}
