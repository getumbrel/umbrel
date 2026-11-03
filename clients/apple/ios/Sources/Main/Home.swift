import SwiftUI
import UIKit
import UmbrelKit

// The Home tab: device header, an apps grid, quick-access folders, a photo-library
// shell, and a storage breakdown, all over the user's wallpaper.
struct HomeView: View {
	@Environment(MainModel.self) private var model
	@Environment(Browser.self) private var browser
	@Environment(\.openURL) private var openURL
	@State private var isOpeningBrowser = false
	@State private var isShowingBrowserUnavailable = false
	@State private var isConfirmingReconnect = false
	@State private var isReconnecting = false
	@State private var showsConnectionProgress = false
	let onShowConnectionDetails: () -> Void

	var body: some View {
		ScrollView(showsIndicators: false) {
			VStack(alignment: .leading, spacing: Theme.sectionGap) {
				titleSection
				connectionIssueCard
				photoBackupIssueCard
				AppsSection(model: model)
				FilesSection(
					paths: model.favoritePaths,
					brandColor: BrandColor.color(model.wallpaperBrandColorHsl),
					loaded: model.didLoad,
					// /files resolves to the home of the signed-in umbrelOS account.
					onViewAll: { openUmbrel(path: "/files") },
					onOpenPath: { openUmbrel(path: "/files\($0)") }
				)
				LibraryPreviewSection()
				StorageSection(
					disk: model.disk,
					brandColorHsl: model.wallpaperBrandColorHsl,
					loaded: model.didLoad,
					onViewLiveUsage: {
						openUmbrel(
							queryItems: [
								URLQueryItem(name: "dialog", value: "live-usage"),
								URLQueryItem(name: "live-usage-tab", value: "storage"),
							]
						)
					}
				)
			}
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding(.horizontal, Theme.contentInset)
			.padding(.top, 56)
			.padding(.bottom, 32)
		}
		.refreshable {
			await model.refreshVisibleData(for: .home, force: true)
		}
		// The wallpaper itself is drawn once, behind every tab and umbrelOS alike, by
		// MainView. The frosting draws its own blurred copy aligned to it.
		.background { SeeThroughTab() }
		// The blurred wallpaper flows to every SectionCard for its frosted fill.
		.environment(\.frostWallpaper, model.blurredWallpaper)
		.alert(model.unreachableTitle, isPresented: $isShowingBrowserUnavailable) {
			Button("OK", role: .cancel) {}
		} message: {
			Text(model.unreachableMessage)
		}
		.alert(IdentityChange.confirmTitle, isPresented: $isConfirmingReconnect) {
			Button("Reconnect") {
				isReconnecting = true
				Task {
					await model.onReconnect()
					isReconnecting = false
				}
			}
			Button("Cancel", role: .cancel) {}
		} message: {
			Text(IdentityChange.confirmMessage)
		}
		.task(id: model.connectionState == .unverified) {
			showsConnectionProgress = false
			guard model.connectionState == .unverified else { return }
			try? await Task.sleep(for: .milliseconds(400))
			guard !Task.isCancelled, model.connectionState == .unverified else { return }
			showsConnectionProgress = true
		}
	}

	private func openUmbrel(path: String = "", queryItems: [URLQueryItem] = []) {
		guard !isOpeningBrowser else { return }
		isOpeningBrowser = true
		Task {
			defer { isOpeningBrowser = false }
			if await !browser.openUmbrel(path: path, queryItems: queryItems) {
				isShowingBrowserUnavailable = true
			}
		}
	}

	// Device title (e.g. "Patrick's Umbrel Pro") and connection status.
	private var titleSection: some View {
		VStack(alignment: .leading, spacing: 10) {
			Group {
				if let name = model.userName, !name.isEmpty {
					let owner = Text("\(name)\u{2019}s ").foregroundStyle(.white)
					let device = Text(model.deviceLabel).foregroundStyle(.white.opacity(0.75))
					Text("\(owner)\(device)")
				} else {
					Text(model.deviceLabel).foregroundStyle(.white)
				}
			}
			.font(.largeTitle.bold())
			.lineLimit(2)
			.truncationMode(.tail)
			// The name is prefetched during onboarding and seeded from config, so it's
			// normally correct on the first frame; if it ever does change late, crossfade
			// the glyphs rather than snapping the title wider.
			.contentTransition(.opacity)
			.animation(.easeOut(duration: 0.3), value: model.userName)

			connectionStatusLabel()
		}
	}

	private func connectionStatusLabel() -> some View {
		Button(action: onShowConnectionDetails) {
			HStack(spacing: 6) {
				switch model.connectionState {
				case .unverified:
					ProgressView()
						.controlSize(.small)
						.tint(.white.opacity(0.7))
						.opacity(showsConnectionProgress ? 1 : 0)
				case .connected:
					StatusDot(color: Theme.online)
					Text("Connected")
				case .unavailable, .localNetworkDenied:
					StatusDot(color: Theme.gray)
					Text(model.identityChanged ? "Can’t verify" : "Offline")
				}
			}
			.frame(minHeight: 18, alignment: .leading)
			.font(.subheadline.weight(.medium))
			.foregroundStyle(.white)
		}
		.buttonStyle(.plain)
		.accessibilityElement(children: .ignore)
		.accessibilityLabel(connectionAccessibilityLabel)
		.accessibilityHint("Shows connection details")
	}

	private var connectionAccessibilityLabel: String {
		switch model.connectionState {
		case .unverified: "Checking connection"
		case .connected: "Connected"
		case .unavailable, .localNetworkDenied: model.identityChanged ? "Can’t verify" : "Offline"
		}
	}

	private func openSettings() {
		guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
		openURL(url)
	}

	@ViewBuilder
	private var photoBackupIssueCard: some View {
		// While the Umbrel is unreachable, the connection card already says so. Home
		// never shows "not connected" for backup: Home's own connection decides that.
		if let notice = model.photoBackupNotice,
			notice != .awayFromUmbrel,
			// An offer, not news: Library is where it belongs
			notice != .backUpAnywhere,
			notice != .waitingForTailscale || model.connectionState == .connected
		{
			PhotoBackupNoticeCard(
				notice: notice,
				setUpTailscale: model.presentTailscaleSetup,
				retryStorage: model.retryPhotoBackupAfterInsufficientStorage,
				retryBackup: model.retryPhotoBackupAfterError
			)
		}
	}

	@ViewBuilder
	private var connectionIssueCard: some View {
		switch model.connectionState {
		case .unverified, .connected:
			EmptyView()
		case .unavailable where model.identityChanged:
			NoticeCard(
				icon: "lock.trianglebadge.exclamationmark",
				title: IdentityChange.title,
				message: IdentityChange.message,
				actionLabel: isReconnecting ? "Reconnecting…" : "Reconnect",
				action: isReconnecting ? nil : { isConfirmingReconnect = true }
			)
		case .unavailable:
			NoticeCard(
				icon: "wifi.exclamationmark",
				title: "Can’t reach your Umbrel",
				message: model.hasTailscaleBrowserAddress
					? "You’re viewing saved information. Make sure your Umbrel is turned on, then connect this iPhone to the same network or turn on Tailscale."
					: "You’re viewing saved information. Make sure your Umbrel is turned on and this iPhone is connected to the same network."
			)
		case .localNetworkDenied:
			NoticeCard(
				icon: "network.slash",
				title: "Local Network Access Off",
				message: "Allow access in Settings to connect to your Umbrel.",
				action: openSettings
			)
		}
	}
}

// The glass pill at the top-right of the main tabs and of umbrelOS. Its first button
// opens umbrelOS and, once there, becomes the way out. Inside umbrelOS it also offers
// what the page needs, the way an app's title bar does.
struct HeaderAccessPill: View {
	let model: MainModel
	@Environment(Browser.self) private var browser
	@State private var isShowingPageOptions = false
	@State private var isOpeningBrowser = false
	@State private var isShowingBrowserUnavailable = false

	var body: some View {
		HStack(spacing: 0) {
			Button {
				if browser.showsUmbrel { browser.closeUmbrel() } else { openDashboard() }
			} label: {
				// One glyph in one place. It changes on the spot, with nothing fading
				// through it, so this never reads as one button uncovering another.
				Image(systemName: browser.showsUmbrel ? "xmark" : "macwindow")
					.font(.system(size: 18, weight: .medium))
					.transaction { $0.animation = nil }
					.frame(width: 44, height: 42)
					.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.accessibilityLabel(browser.showsUmbrel ? "Close umbrelOS" : "Open umbrelOS")

			if browser.showsUmbrel {
				Button {
					isShowingPageOptions = true
				} label: {
					Image(systemName: "ellipsis")
						.font(.system(size: 20))
						.frame(width: 44, height: 42)
						.contentShape(Rectangle())
				}
				.buttonStyle(.plain)
				.accessibilityLabel("More")
				.transition(.opacity)
				.confirmationDialog("umbrelOS", isPresented: $isShowingPageOptions) {
					Button("Reload") { browser.umbrel?.reload() }
					Button("Open in Safari") {
						if let umbrel = browser.umbrel { openInSafari(umbrel) }
					}
				}
			}
		}
		.foregroundStyle(.white.opacity(0.85))
		.frame(height: 42)
		.glassControl(in: Capsule())
		.animation(.easeOut(duration: 0.2), value: browser.showsUmbrel)
		.alert(model.unreachableTitle, isPresented: $isShowingBrowserUnavailable) {
			Button("OK", role: .cancel) {}
		} message: {
			Text(model.unreachableMessage)
		}
	}

	private func openDashboard() {
		guard !isOpeningBrowser else { return }
		isOpeningBrowser = true
		Task {
			defer { isOpeningBrowser = false }
			if await !browser.openUmbrel() {
				isShowingBrowserUnavailable = true
			}
		}
	}

	private func openInSafari(_ page: BrowserPage) {
		Task {
			guard let url = await browser.safariURL(for: page) else { return }
			await UIApplication.shared.open(url)
		}
	}
}

// Fixed top gradient for status-bar legibility over the wallpaper (Home and Apps).
struct WallpaperTopGradient: View {
	var body: some View {
		LinearGradient(colors: [.black.opacity(0.9), .clear], startPoint: .top, endPoint: .bottom)
			.frame(height: 150)
			.frame(maxWidth: .infinity)
			.ignoresSafeArea()
			.allowsHitTesting(false)
	}
}

// A 42pt translucent circular icon button (header back / actions).
struct CircleIconButton: View {
	let system: String
	let accessibilityLabel: LocalizedStringKey
	var action: () -> Void
	var body: some View {
		Button(action: action) {
			Image(systemName: system)
				.font(.system(size: 17, weight: .medium))
				.foregroundStyle(.white.opacity(0.85))
				.frame(width: 42, height: 42)
				.glassControl(in: Circle())
		}
		.accessibilityLabel(Text(accessibilityLabel))
	}
}

// The way back to an app that opened umbrelOS, in the same glass as the header's
// other controls.
struct ReturnToAppButton: View {
	let name: String
	var action: () -> Void
	var body: some View {
		Button(action: action) {
			HStack(spacing: 4) {
				Image(systemName: "chevron.left")
					.font(.system(size: 15, weight: .semibold))
				// Capped so the name stays inside the header's fixed-height capsule
				Text(name)
					.font(.subheadline.weight(.medium))
					.lineLimit(1)
					.dynamicTypeSize(...DynamicTypeSize.xxxLarge)
			}
			.foregroundStyle(.white.opacity(0.85))
			.padding(.leading, 12)
			.padding(.trailing, 16)
			.frame(height: 42)
			.glassControl(in: Capsule())
		}
		.accessibilityLabel("Back to \(name)")
	}
}

// MARK: - Apps

private struct AppsSection: View {
	let model: MainModel
	@Environment(Browser.self) private var browser
	@Environment(\.dynamicTypeSize) private var dynamicTypeSize

	private var columnCount: Int { dynamicTypeSize.isAccessibilitySize ? 2 : 3 }
	private var columns: [GridItem] {
		Array(repeating: GridItem(.flexible(), spacing: 4), count: columnCount)
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 12) {
			SectionHeader(title: "Apps", showsChevron: true, action: model.openApps) {
				if model.updateCount > 0 {
					TrailingLabel(text: model.updateCount == 1 ? "1 update" : "\(model.updateCount) updates")
				}
			}
			.accessibilityIdentifier("homeAppsHeader")
			LoadReveal(loaded: model.didLoad, order: 0) {
				if model.installedApps.isEmpty {
					EmptyStateCard(
						icon: "circle.grid.cross.up.filled",
						title: "Install your first app",
						subtitle: "Open the Umbrel App Store to install apps",
						buttonTitle: "Open Umbrel App Store",
						action: { Task { await browser.openUmbrel(path: "/app-store") } }
					)
				} else {
					SectionCard { grid }
				}
			} skeleton: {
				SectionCard {
					SkeletonTiles(rows: 6 / columnCount, cols: columnCount)
				}
			}
		}
	}

	private var grid: some View {
		let apps = model.installedApps
		let hasOverflow = apps.count > 6
		let visible = hasOverflow ? Array(apps.prefix(5)) : Array(apps.prefix(6))
		let overflow = Array(apps.dropFirst(5))
		let rows = 6 / columnCount
		return LazyVGrid(columns: columns, spacing: 4) {
			ForEach(0..<6) { index in
				let shape = Bento.tile(
					row: index / columnCount,
					col: index % columnCount,
					rows: rows,
					cols: columnCount
				)
				cell(index: index, visible: visible, hasOverflow: hasOverflow, overflow: overflow)
					.frame(maxWidth: .infinity)
					.frame(height: 100)
					.background(Theme.tile, in: shape)
					.overlay(shape.strokeBorder(.white.opacity(0.07), lineWidth: 1))
					.clipShape(shape)
			}
		}
	}

	@ViewBuilder
	private func cell(index: Int, visible: [Umbreld.AppSummary], hasOverflow: Bool, overflow: [Umbreld.AppSummary]) -> some View {
		if hasOverflow && index == 5 {
			Button(action: model.openApps) {
				OverflowTile(count: overflow.count, sample: Array(overflow.prefix(3)))
			}
			.buttonStyle(.plain)
			.accessibilityLabel("View \(overflow.count) more apps")
		} else if index < visible.count {
			AppTileButton(app: visible[index])
		} else {
			Color.clear
		}
	}
}

// An app icon + name label. Used both inside the Home apps card (gray-3 label) and bare
// on the Apps tab, where white labels remain legible over the wallpaper.
struct AppTile: View {
	let app: Umbreld.AppSummary
	var labelColor: Color = Theme.gray3
	var preparing = false
	// Identifies this tile's icon as the place its app opens from and closes into.
	var sourceID: AnyHashable?
	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	var body: some View {
		let title = app.name ?? app.id
		let presentation = AppTilePresentation(state: app.state)
		VStack(spacing: 8) {
			AppIconView(url: app.iconURL)
				.background { if let sourceID { BrowserSource(id: sourceID) } }
				.brightness(presentation.dimsIcon || preparing ? -0.4 : 0)
				.overlay {
					if preparing {
						ProgressView().tint(.white)
					} else {
						stateOverlay(for: presentation)
					}
				}
			Text(presentation.label(default: title))
				.font(.caption2.weight(.medium))
				.foregroundStyle(labelColor)
				.lineLimit(1)
				.padding(.horizontal, 4)
				.contentTransition(.opacity)
		}
		.animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: presentation)
		.accessibilityElement(children: .ignore)
		.accessibilityLabel(title)
		.accessibilityValue(preparing ? "Opening" : (presentation.accessibilityValue ?? ""))
	}

	@ViewBuilder
	private func stateOverlay(for presentation: AppTilePresentation) -> some View {
		switch presentation {
		case .inProgress:
			AppStateProgressBar(progress: presentation.reportedProgress(app.progress))
		case .stopped, .unavailable:
			if let symbolName = presentation.symbolName {
				Image(systemName: symbolName)
					.font(.system(size: 24, weight: .medium))
					.foregroundStyle(.white.opacity(0.9))
					.transition(.scale(scale: 0.85).combined(with: .opacity))
			}
		case .available:
			EmptyView()
		}
	}
}

// Lifecycle work uses the same compact bar as umbrelOS: reported progress for installs
// and updates, and an indeterminate sweep for transitions without meaningful progress.
private struct AppStateProgressBar: View {
	let progress: Double?
	@State private var sliding = false
	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	private let width: CGFloat = 34
	private let height: CGFloat = 3.5

	var body: some View {
		Capsule().fill(.white.opacity(0.4))
			.frame(width: width, height: height)
			.overlay(alignment: .leading) {
				if let progress {
					Capsule().fill(.white.opacity(0.9))
						.frame(width: width * progress / 100, height: height)
						.animation(reduceMotion ? nil : .easeOut(duration: 0.35), value: progress)
				} else {
					Capsule().fill(.white.opacity(0.9))
						.frame(width: width * (reduceMotion ? 0.6 : 0.3), height: height)
						.offset(x: reduceMotion ? width * 0.2 : (sliding ? width : -width * 0.3))
						.animation(
							reduceMotion ? nil : .linear(duration: 1.2).repeatForever(autoreverses: false),
							value: sliding
						)
						.onAppear { sliding = !reduceMotion }
						.onChange(of: reduceMotion) { _, shouldReduceMotion in
							sliding = !shouldReduceMotion
						}
				}
			}
			.clipShape(Capsule())
	}
}

// A tappable app tile: opens the app in the in-app browser. App lifecycle management
// stays in umbrelOS, so unavailable apps hand off there instead of duplicating it here.
struct AppTileButton: View {
	let app: Umbreld.AppSummary
	var labelColor: Color = Theme.gray3

	@Environment(MainModel.self) private var model
	@Environment(Browser.self) private var browser

	@State private var sourceID = UUID()
	@State private var showsCredentials = false
	@State private var opensAfterCredentials = false
	@State private var launchAlert: AppLaunchAlert?
	@State private var liveApp: Umbreld.AppSummary?
	@State private var isPreparingLaunch = false

	private var appForLaunch: Umbreld.AppSummary { liveApp ?? app }

	var body: some View {
		let launchDisposition = AppLaunchDisposition(state: app.state)
		Button {
			guard launchDisposition != .busy, !isPreparingLaunch else { return }
			Task { await prepareLaunch() }
		} label: {
			AppTile(
				app: app,
				labelColor: labelColor,
				preparing: isPreparingLaunch,
				sourceID: sourceID
			)
		}
		.buttonStyle(.plain)
		.disabled(isPreparingLaunch || launchDisposition == .busy)
		.alert(
			Text(launchAlert?.title ?? ""),
			isPresented: Binding(
				get: { launchAlert != nil },
				set: { if !$0 { launchAlert = nil } }
			),
			presenting: launchAlert
		) { alert in
			switch alert {
			case .blocked where model.canManageApps:
				Button("Open Umbrel") { openUmbrel() }
				Button("Cancel", role: .cancel) {}
			case .torOnly where model.canManageApps:
				Button("Open Umbrel") { openUmbrel(path: "/settings/advanced/tor") }
				Button("Cancel", role: .cancel) {}
			case .blocked, .torOnly, .unavailable:
				Button("OK", role: .cancel) {}
			}
		} message: { alert in
			Text(alert.message(canManageApps: model.canManageApps))
		}
		.sheet(isPresented: $showsCredentials, onDismiss: finishPendingLaunch) {
			CredentialsSheet(app: appForLaunch) { opensAfterCredentials = true }
		}
	}

	@MainActor
	private func prepareLaunch() async {
		isPreparingLaunch = true
		defer { isPreparingLaunch = false }
		guard let resolvedApp = await model.appForLaunch(id: app.id) else {
			launchAlert = .unavailable(title: model.unreachableTitle, message: model.unreachableMessage)
			return
		}
		liveApp = resolvedApp
		switch AppLaunchDisposition(state: resolvedApp.state) {
		case .available:
			break
		case .paused:
			launchAlert = .blocked(app: resolvedApp, paused: true)
			return
		case .offline:
			launchAlert = .blocked(app: resolvedApp, paused: false)
			return
		case .busy:
			return
		}
		if resolvedApp.torOnly == true {
			launchAlert = .torOnly(app: resolvedApp)
			return
		}
		if resolvedApp.credentials?.showBeforeOpen == true {
			showsCredentials = true
		} else {
			await openApp()
		}
	}

	private func openUmbrel(path: String = "") {
		Task {
			if await !browser.openUmbrel(path: path) { launchAlert = .unavailable(title: model.unreachableTitle, message: model.unreachableMessage) }
		}
	}

	private func finishPendingLaunch() {
		guard opensAfterCredentials else { return }
		opensAfterCredentials = false
		Task { await openApp() }
	}

	// The app grows out of this tile's icon. Inside the app every page is already a
	// trusted, secure connection, so apps that require HTTPS need no extra step.
	private func openApp() async {
		if await !browser.open(appForLaunch, from: sourceID) { launchAlert = .unavailable(title: model.unreachableTitle, message: model.unreachableMessage) }
	}
}

private enum AppLaunchAlert {
	case blocked(app: Umbreld.AppSummary, paused: Bool)
	case torOnly(app: Umbreld.AppSummary)
	case unavailable(title: String, message: String)

	var title: String {
		switch self {
		case let .blocked(app, paused):
			return "\(app.name ?? app.id) is \(paused ? "Paused" : "Offline")"
		case let .torOnly(app):
			return "\(app.name ?? app.id) Uses Tor"
		case let .unavailable(title, _):
			return title
		}
	}

	func message(canManageApps: Bool) -> String {
		switch self {
		case let .blocked(_, paused):
			if canManageApps {
				return paused
					? "Open Umbrel to start this app."
					: "Open Umbrel to restart or troubleshoot this app."
			}
			return paused
				? "Ask the Umbrel owner to start this app."
				: "Ask the Umbrel owner to restart this app."
		case .torOnly:
			return canManageApps
				? "This app is only available over Tor. Open Umbrel to view your Umbrel’s Tor address."
				: "This app is only available over Tor. Ask the owner for your Umbrel’s Tor address, then open Umbrel in Tor Browser."
		case let .unavailable(_, message):
			return message
		}
	}
}

private enum AppLaunchDisposition: Equatable {
	case available
	case paused
	case offline
	case busy

	init(state: String?) {
		switch state {
		case "ready", "running":
			self = .available
		case "stopped":
			self = .paused
		case "unknown", nil:
			self = .offline
		case "installing", "starting", "stopping", "restarting", "uninstalling", "updating":
			self = .busy
		default:
			self = .offline
		}
	}
}

private struct OverflowTile: View {
	let count: Int
	let sample: [Umbreld.AppSummary]

	// The fanned mini-icons in the "+N apps" stack: the front icon is largest and
	// tilted left, shrinking / shifting right / tilting right toward the back. Slots are
	// ordered back → front for correct z-stacking; `sampleIndex` fills each slot, with the
	// front-most (most prominent) icon being the first extra app.
	private struct Slot {
		let size: CGFloat
		let rotation: Double
		let x: CGFloat
		let y: CGFloat
		let sampleIndex: Int
	}

	private static let slots: [Slot] = [
		Slot(size: 21.8, rotation: 11.38, x: 13.6, y: 2.5, sampleIndex: 2), // back-right, smallest
		Slot(size: 24.2, rotation: 2.95, x: 0.2, y: 0.3, sampleIndex: 1), // middle
		Slot(size: 27.4, rotation: -12.99, x: -12.8, y: 1.5, sampleIndex: 0), // front-left, largest
	]

	var body: some View {
		VStack(spacing: 8) {
			ZStack {
				ForEach(Array(Self.slots.enumerated()), id: \.offset) { _, slot in
					if slot.sampleIndex < sample.count {
						let app = sample[slot.sampleIndex]
						AppIconView(url: app.iconURL, size: slot.size, corner: slot.size * 0.25)
							.rotationEffect(.degrees(slot.rotation))
							.offset(x: slot.x, y: slot.y)
							.shadow(color: .black.opacity(0.25), radius: 4, x: 2, y: 2)
					}
				}
			}
			.frame(width: 45, height: 45)
			Text("+\(count) apps")
				.font(.caption2.weight(.medium))
				.foregroundStyle(Theme.gray3)
		}
	}
}

// MARK: - Files

// Mirrors the umbrelOS files-favorites widget: the user's first 4 favorite folders, laid
// out 2×2 when there are four and collapsing to a single row (1×3 / 1×2 / 1×1) with fewer.
private struct FilesSection: View {
	let paths: [String]
	let brandColor: Color
	let loaded: Bool
	let onViewAll: () -> Void
	let onOpenPath: (String) -> Void

	var body: some View {
		// Reserve the section with a skeleton while loading; collapse it only once the
		// load confirms there are no favorites (rare — umbrelOS defaults to four).
		if !loaded || !paths.isEmpty {
			VStack(alignment: .leading, spacing: 12) {
				SectionHeader(title: "Files", action: onViewAll) { TrailingLabel(text: "View all") }
				LoadReveal(loaded: loaded, order: 1) {
					SectionCard { grid }
				} skeleton: {
					SectionCard { SkeletonTiles(rows: 2, cols: 2) }
				}
			}
		}
	}

	private var grid: some View {
		// Four folders form a 2×2; fewer collapse to a single row. Guarded to 1 column
		// because this view is also built (unused) while paths is still empty: LoadReveal
		// constructs its content eagerly even when only the skeleton is shown.
		let cols = paths.count == 4 ? 2 : max(1, paths.count)
		let rows = Int(ceil(Double(paths.count) / Double(cols)))
		let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: cols)
		return LazyVGrid(columns: columns, spacing: 4) {
			ForEach(Array(paths.enumerated()), id: \.offset) { index, path in
				let shape = Bento.tile(row: index / cols, col: index % cols, rows: rows, cols: cols)
				Button { onOpenPath(path) } label: {
					FolderTile(path: path, brandColor: brandColor)
						.frame(maxWidth: .infinity)
						.frame(height: 100)
						.background(Theme.tile, in: shape)
						.overlay(shape.strokeBorder(.white.opacity(0.07), lineWidth: 1))
						.clipShape(shape)
						.contentShape(shape)
				}
				.buttonStyle(.plain)
				.accessibilityLabel("Open \((path as NSString).lastPathComponent) in Files")
			}
		}
	}
}

private struct FolderTile: View {
	let path: String
	let brandColor: Color

	private var name: String { (path as NSString).lastPathComponent }

	var body: some View {
		VStack(spacing: 8) {
			FolderIconView(path: path, brandColor: brandColor)
				.frame(width: 44, height: 40)
			Text(name)
				.font(.caption2.weight(.medium))
				.foregroundStyle(Theme.gray3)
				.lineLimit(1)
				.padding(.horizontal, 4)
		}
	}
}

// MARK: - Library preview (matches the Library tab: photos, or its setup card)

private struct LibraryPreviewSection: View {
	@Environment(MainModel.self) private var model

	var body: some View {
		VStack(alignment: .leading, spacing: 12) {
			if model.showsPhotoLibrary {
				// The sync status sits in the header's trailing slot, like Apps' update
				// count, and the card is all photos. Header + card are one tap
				// target opening the Library tab.
				Button {
					model.openLibrary()
				} label: {
					VStack(alignment: .leading, spacing: 12) {
						SectionHeader(title: "Library", showsChevron: true) {
							TrailingLabel(text: statusText, dot: statusColor)
						}
						mosaicCard
					}
					.contentShape(Rectangle())
				}
				.buttonStyle(.plain)
				.accessibilityIdentifier("homeLibraryHeader")
			} else {
				SectionHeader("Library", showsChevron: true, action: model.openLibrary)
					.accessibilityIdentifier("homeLibraryHeader")
				PhotoBackupSetupCard()
			}
			ViewAllInPhotosButton()
				.padding(.top, 4)
		}
	}
}

// The Library screens show this iPhone's library. Everything on the Umbrel, from
// every device and album, lives in umbrelOS's Photos, one tap away on the same
// wallpaper.
struct ViewAllInPhotosButton: View {
	@Environment(MainModel.self) private var model
	@Environment(Browser.self) private var browser
	@State private var isShowingUnavailable = false

	var body: some View {
		Button {
			Task {
				if await !browser.openUmbrel(path: "/photos") { isShowingUnavailable = true }
			}
		} label: {
			HStack(spacing: 6) {
				Image(systemName: "photo.on.rectangle.angled")
				Text("View All in Photos")
			}
			.font(.footnote.weight(.semibold))
			.foregroundStyle(.white)
			.padding(.horizontal, 18)
			.frame(minHeight: 52)
			// Same stable wallpaper frost as the cards it sits among.
			.background {
				FrostBackground(shape: Capsule(), wallpaper: model.blurredWallpaper)
			}
			.glassGlint(in: Capsule())
		}
		.buttonStyle(.plain)
		.frame(maxWidth: .infinity)
		.alert(model.unreachableTitle, isPresented: $isShowingUnavailable) {
			Button("OK", role: .cancel) {}
		} message: {
			Text(model.unreachableMessage)
		}
	}
}

private extension LibraryPreviewSection {
	// A window onto the newest rows of the iPhone library, bottom-aligned in a fixed-height
	// card that crops at the top edge. The window starts on a Library row
	// boundary so the layout mirrors the tab exactly, ragged last row and all; with a
	// small library the top shows plain frost instead of cropped photos.
	private var mosaicCard: some View {
		let cols = 3
		let assets = Array(model.photoLibrary.assets.suffix(9))
		let count = assets.isEmpty ? 9 : assets.count
		let rows = Int(ceil(Double(count) / Double(cols)))
		return SectionCard(padding: 0) {
			LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: cols), spacing: 4) {
				ForEach(0..<count, id: \.self) { index in
					// Shift the bento frame down one row so no tile counts as the outer top
					// row: the top edge is cropped, so only the bottom corners get 16px
					let tile = Bento.tile(row: index / cols + 1, col: index % cols, rows: rows + 1, cols: cols)
					if index < assets.count {
						let asset = assets[index]
						AssetThumbnail(
							asset: asset,
							imageManager: model.photoLibrary.imageManager,
							shape: tile,
							receiptCache: model.photoBackupReceipts,
							backupSourceId: model.photoBackup.sourceId,
							backupRevision: model.photoBackupReceiptRevision,
							thumbnailTargetSize: CGSize(width: 300, height: 300)
						)
						.id(asset.localIdentifier)
					} else {
						tile
							.fill(Theme.tile)
							.aspectRatio(1, contentMode: .fit)
					}
				}
			}
			.padding(.horizontal, 8)
			// The crop happens at the card border: the 8px gutter is sides
			// and bottom only, so the clipped top row bleeds to the card's top edge
			.frame(height: 252, alignment: .bottom)
			.clipped()
			.padding(.bottom, 8)
		}
		// Round the bled top row off with the card's own corners
		.clipShape(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
	}

	private var statusText: String {
		if model.photoBackupIsConfiguredElsewhere { return "On another Umbrel" }
		return model.photoBackupStatus.text
	}

	private var statusColor: Color {
		if model.photoBackupIsConfiguredElsewhere { return Theme.gray }
		return model.photoBackupStatus.color
	}
}

// MARK: - Storage

private struct StorageSection: View {
	let disk: Umbreld.DiskUsage?
	let brandColorHsl: String?
	let loaded: Bool
	let onViewLiveUsage: () -> Void
	@Environment(\.dynamicTypeSize) private var dynamicTypeSize

	// Apps is the brand color; the remaining categories are successively whiter
	// tints so the whole breakdown reads as one wallpaper-derived hue.
	private var appsColor: Color { BrandColor.color(brandColorHsl) }
	private var filesColor: Color { BrandColor.color(brandColorHsl, mixWhite: 0.32) }
	private var machinesColor: Color { BrandColor.color(brandColorHsl, mixWhite: 0.58) }
	private var systemColor: Color { BrandColor.color(brandColorHsl, mixWhite: 0.82) }

	var body: some View {
		VStack(alignment: .leading, spacing: 12) {
			SectionHeader(title: "Storage", action: onViewLiveUsage) {
				TrailingLabel(text: "View Live Usage")
			}
			LoadReveal(loaded: loaded, order: 2) {
				SectionCard(padding: 24) {
					storageLayout {
						DonutChart(disk: disk, colors: [appsColor, filesColor, machinesColor, systemColor])
							.frame(width: 103, height: 103)
							.frame(maxWidth: dynamicTypeSize.isAccessibilitySize ? .infinity : nil)
						VStack(alignment: .leading, spacing: 12) {
							Group {
								let used = Text(usedText).foregroundStyle(.white)
								let total = Text(" of \(totalText) used").foregroundStyle(.white.opacity(0.5))
								Text("\(used)\(total)")
							}
							.font(.headline.weight(.bold))
							.lineLimit(1)
							.allowsTightening(true)
							.minimumScaleFactor(0.75)

							VStack(alignment: .leading, spacing: 4) {
								legendRow("Apps", appsColor)
								legendRow("Files", filesColor)
								if hasMachineStorage {
									legendRow("Machines", machinesColor)
								}
								legendRow("System", systemColor)
							}
						}
						.frame(maxWidth: .infinity, alignment: .leading)
					}
				}
			} skeleton: {
				SectionCard(padding: 24) {
					storageLayout {
						Circle()
							.stroke(Color.white.opacity(0.08), lineWidth: 12)
							.frame(width: 103, height: 103)
							.frame(maxWidth: dynamicTypeSize.isAccessibilitySize ? .infinity : nil)
						VStack(alignment: .leading, spacing: 12) {
							RoundedRectangle(cornerRadius: 4).fill(Theme.tile).frame(width: 150, height: 18)
							VStack(alignment: .leading, spacing: 8) {
								ForEach(0..<3, id: \.self) { _ in
									RoundedRectangle(cornerRadius: 3).fill(Theme.tile).frame(width: 72, height: 10)
								}
							}
						}
						.frame(maxWidth: .infinity, alignment: .leading)
					}
					.pulsing()
				}
			}
		}
	}

	private var storageLayout: AnyLayout {
		if dynamicTypeSize.isAccessibilitySize {
			AnyLayout(VStackLayout(alignment: .leading, spacing: 24))
		} else {
			AnyLayout(HStackLayout(alignment: .center, spacing: 24))
		}
	}

	private func legendRow(_ label: String, _ color: Color) -> some View {
		HStack(spacing: 10) {
			Capsule().fill(color).frame(width: 14, height: 5)
			Text(label).font(.footnote.weight(.medium)).foregroundStyle(.white)
		}
	}

	private var usedText: String { disk.map { formatStorageSize($0.totalUsed) } ?? "—" }
	private var totalText: String { disk.map { formatStorageSize($0.size) } ?? "—" }
	private var hasMachineStorage: Bool { (disk?.machinesUsed ?? 0) > 0 }
}

// Concentric donut of categorized usage over a faint free-space track.
private struct DonutChart: View {
	let disk: Umbreld.DiskUsage?
	let colors: [Color] // apps, files, machines, system

	var body: some View {
		ZStack {
			Circle().stroke(Color.white.opacity(0.08), lineWidth: 12)
			ForEach(Array(segments.enumerated()), id: \.offset) { _, seg in
				Circle()
					.trim(from: seg.start, to: seg.end)
					.stroke(seg.color, style: .init(lineWidth: 12, lineCap: .butt))
					.rotationEffect(.degrees(-90))
			}
			Image(systemName: "externaldrive")
				.font(.system(size: 22, weight: .regular))
				.foregroundStyle(.white.opacity(0.5))
		}
	}

	private struct Segment { let start: CGFloat; let end: CGFloat; let color: Color }

	private var segments: [Segment] {
		guard let disk, disk.size > 0 else { return [] }
		let parts: [(Double, Color)] = [
			(disk.appsUsed, colors[0]),
			(disk.files, colors[1]),
			(disk.machinesUsed, colors[2]),
			(disk.system, colors[3]),
		]
		var result: [Segment] = []
		var cursor: CGFloat = 0
		for (value, color) in parts {
			let frac = CGFloat(value / disk.size)
			guard frac > 0 else { continue }
			result.append(Segment(start: cursor, end: cursor + frac, color: color))
			cursor += frac
		}
		return result
	}
}

// Matches umbrelOS's `formatStorageSize`: base-1000 SI units (pretty-bytes), 1 decimal
// place — but rounded to a whole number once the value is 3+ digits (>=100) to keep it
// short — with the space stripped. e.g. "25GB", "2TB", "12.4GB", "256GB".
func formatStorageSize(_ bytes: Double) -> String {
	func pretty(_ value: Double, fractionDigits: Int) -> (text: String, scaled: Double) {
		let units = ["B", "kB", "MB", "GB", "TB", "PB"]
		var scaled = value
		var unit = 0
		while scaled >= 1000, unit < units.count - 1 {
			scaled /= 1000
			unit += 1
		}
		let formatter = NumberFormatter()
		formatter.numberStyle = .decimal
		formatter.usesGroupingSeparator = false
		formatter.maximumFractionDigits = fractionDigits
		formatter.minimumFractionDigits = 0
		let number = formatter.string(from: scaled as NSNumber) ?? "\(scaled)"
		return ("\(number)\(units[unit])", scaled)
	}

	let scaled = pretty(bytes, fractionDigits: 1).scaled
	return pretty(bytes, fractionDigits: scaled >= 100 ? 0 : 1).text
}
