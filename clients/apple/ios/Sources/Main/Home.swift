import SwiftUI
import UIKit
import UmbrelKit

// The Home tab: device header, an apps grid, quick-access folders, a photo-library
// shell, and a storage breakdown, all over the user's wallpaper.
struct HomeView: View {
	@Environment(MainModel.self) private var model
	@Environment(\.openURL) private var openURL
	@State private var isOpeningBrowser = false
	@State private var isShowingBrowserUnavailable = false
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
					brandHSL: BrandColor.hsl(model.wallpaperBrandColorHsl),
					loaded: model.didLoad,
					// /files resolves to the home of whichever umbrelOS account the browser uses.
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
		// The wallpaper is a background (not a ZStack sibling) so the ScrollView keeps its
		// safe-area insets: the header sits below the status bar and content clears the
		// dock. The frosting doesn't need it as a sibling — it draws its own blurred copy.
		.background { WallpaperBackground(image: model.wallpaperImage) }
		.overlay(alignment: .top) { WallpaperTopGradient() }
		// The blurred wallpaper flows to every SectionCard for its frosted fill.
		.environment(\.frostWallpaper, model.blurredWallpaper)
		.alert("Can’t Reach Umbrel", isPresented: $isShowingBrowserUnavailable) {
			Button("OK", role: .cancel) {}
		} message: {
			Text("Check your connection and try again.")
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
			guard let url = await model.dashboardURLForOpening(path: path, queryItems: queryItems) else {
				isShowingBrowserUnavailable = true
				return
			}
			openURL(url)
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
					Text("Offline")
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
		case .unavailable, .localNetworkDenied: "Offline"
		}
	}

	private func openSettings() {
		guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
		openURL(url)
	}

	@ViewBuilder
	private var photoBackupIssueCard: some View {
		if let notice = model.photoBackupNotice,
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

// The Safari + ellipsis glass pill shown at the top-right of the main tabs.
struct HeaderAccessPill: View {
	let model: MainModel
	@Environment(\.openURL) private var openURL
	@State private var isShowingBrowserOptions = false
	@State private var isOpeningBrowser = false
	@State private var isShowingBrowserUnavailable = false

	var body: some View {
		HStack(spacing: 0) {
			Button { openDashboard() } label: {
				Image(systemName: "safari")
					.font(.system(size: 20))
					.frame(width: 44, height: 42)
					.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.disabled(isOpeningBrowser)
			.accessibilityLabel("Open Umbrel in a Browser")

			Button { isShowingBrowserOptions = true } label: {
				Image(systemName: "ellipsis")
					.font(.system(size: 20))
					.frame(width: 44, height: 42)
					.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.accessibilityLabel("Browser options")
			.sheet(isPresented: $isShowingBrowserOptions) {
				BrowserOptionsSheet(model: model)
			}
		}
		.foregroundStyle(.white.opacity(0.85))
		.frame(height: 42)
		.glassControl(in: Capsule())
		.alert("Can’t Reach Umbrel", isPresented: $isShowingBrowserUnavailable) {
			Button("OK", role: .cancel) {}
		} message: {
			Text("Check your connection and try again.")
		}
	}

	private func openDashboard() {
		guard !isOpeningBrowser else { return }
		isOpeningBrowser = true
		Task {
			defer { isOpeningBrowser = false }
			guard let url = await model.dashboardURLForOpening() else {
				isShowingBrowserUnavailable = true
				return
			}
			openURL(url)
		}
	}
}

private struct BrowserOptionsSheet: View {
	let model: MainModel
	@Environment(\.dismiss) private var dismiss
	@Environment(\.brandColor) private var brandColor

	var body: some View {
		NavigationStack {
			ScrollView(showsIndicators: false) {
				VStack(spacing: 0) {
					Text(
						"Choose how this app opens your Umbrel in a web browser. This doesn’t change how the app itself connects."
					)
					.font(.footnote)
					.foregroundStyle(Theme.gray)
					.fixedSize(horizontal: false, vertical: true)
					.frame(maxWidth: .infinity, alignment: .leading)
					.padding(.horizontal, 4)
					.padding(.vertical, 10)

					SettingsSection("Browser Connection") {
						connectionOption(
							icon: "sparkles",
							"Automatic",
							detail: "Use Tailscale when available, otherwise the local network",
							connection: .automatic
						)
						if model.hasLocalBrowserAddress {
							SettingsDivider()
							connectionOption(
								icon: "wifi",
								"Local Network Only",
								detail: "Open using your Umbrel’s local network address",
								connection: .localNetwork
							)
						}
						SettingsDivider()
						if model.hasTailscaleBrowserAddress {
							connectionOption(
								icon: "network",
								"Tailscale Only",
								detail: "Open using your Umbrel’s Tailscale address",
								connection: .tailscale
							)
						} else {
							tailscaleUnavailableOption
						}
					}

					SettingsSection("More") {
						NavigationLink {
							BrowserAdvancedOptions(model: model)
						} label: {
							HStack(spacing: 14) {
								Image(systemName: "gearshape.2")
									.font(.system(size: 17, weight: .medium))
									.foregroundStyle(.white.opacity(0.9))
									.frame(width: 28, height: 28)
								VStack(alignment: .leading, spacing: 4) {
									Text("Advanced Browser Settings")
										.font(.subheadline.weight(.semibold))
										.foregroundStyle(.white)
									Text("Local browser compatibility options")
										.font(.footnote)
										.foregroundStyle(Theme.gray)
								}
								.frame(maxWidth: .infinity, alignment: .leading)
								Spacer(minLength: 8)
								Image(systemName: "chevron.right")
									.font(.system(size: 13, weight: .semibold))
									.foregroundStyle(Theme.gray)
							}
							.padding(16)
							.contentShape(Rectangle())
						}
						.buttonStyle(.plain)
					}
				}
				.padding(.horizontal, 20)
				.padding(.top, 10)
				.padding(.bottom, 24)
			}
			.scrollEdgeEffectStyle(.soft, for: .top)
			.background(Color(hex: 0x1C1C1E).ignoresSafeArea())
			.navigationTitle("Open in Browser")
			.navigationBarTitleDisplayMode(.inline)
			.toolbar {
				DrawerCloseToolbarItem(action: { dismiss() })
			}
		}
		.presentationDetents([.large])
		.presentationDragIndicator(.visible)
		.presentationCornerRadius(38)
		.presentationBackground(Color(hex: 0x1C1C1E))
	}

	private func connectionOption(
		icon: String,
		_ title: String,
		detail: String,
		connection: MainModel.BrowserConnection
	) -> some View {
		Button { model.setBrowserConnection(connection) } label: {
			HStack(spacing: 14) {
				Image(systemName: icon)
					.font(.system(size: 17, weight: .medium))
					.foregroundStyle(.white.opacity(0.9))
					.frame(width: 28, height: 28)
				VStack(alignment: .leading, spacing: 4) {
					Text(title)
						.font(.subheadline.weight(.semibold))
						.foregroundStyle(.white)
					Text(detail)
						.font(.footnote)
						.foregroundStyle(Theme.gray)
				}
				.frame(maxWidth: .infinity, alignment: .leading)
				Spacer(minLength: 8)
				if model.browserConnectionSelection == connection {
					Image(systemName: "checkmark")
						.font(.system(size: 14, weight: .semibold))
						.foregroundStyle(brandColor)
				}
			}
			.padding(16)
			.contentShape(Rectangle())
		}
		.buttonStyle(.plain)
	}

	private var tailscaleUnavailableOption: some View {
		HStack(spacing: 14) {
			Image(systemName: "network")
				.font(.system(size: 17, weight: .medium))
				.frame(width: 28, height: 28)
			VStack(alignment: .leading, spacing: 4) {
				Text("Tailscale Only")
					.font(.subheadline.weight(.semibold))
				Text("Open using your Umbrel’s Tailscale address")
					.font(.footnote)
			}
			.frame(maxWidth: .infinity, alignment: .leading)
			Spacer(minLength: 8)
			Text("Not set up")
				.font(.footnote.weight(.medium))
		}
		.foregroundStyle(Theme.gray)
		.padding(16)
	}

}

private struct BrowserAdvancedOptions: View {
	let model: MainModel
	@State private var isConfirmingHTTPS = false

	var body: some View {
		ScrollView(showsIndicators: false) {
			VStack(alignment: .leading, spacing: 0) {
				SettingsSection("Compatibility") {
					SettingsRow(icon: "lock.fill", title: "Always Use HTTPS") {
						SettingsToggle("Always Use HTTPS", isOn: Binding(
							get: { model.dashboardUsesHTTPS },
							set: { enabled in
								if enabled {
									isConfirmingHTTPS = true
								} else {
									model.setDashboardUsesHTTPS(false)
								}
							}
						))
					}
				}
				Text(
					"Apps that require HTTPS use it automatically. HTTPS is for browser compatibility, not private access. For private access, use Tailscale."
				)
				.font(.footnote)
				.foregroundStyle(Theme.gray)
				.fixedSize(horizontal: false, vertical: true)
				.padding(.horizontal, 4)
			}
			.padding(.horizontal, 20)
			.padding(.top, 10)
			.padding(.bottom, 24)
		}
		.scrollEdgeEffectStyle(.soft, for: .top)
		.background(Color(hex: 0x1C1C1E).ignoresSafeArea())
		.navigationTitle("Advanced Browser Settings")
		.navigationBarTitleDisplayMode(.inline)
		.alert("Always Use HTTPS Locally?", isPresented: $isConfirmingHTTPS) {
			Button("Cancel", role: .cancel) {}
			Button("Use HTTPS Locally") { model.setDashboardUsesHTTPS(true) }
		} message: {
			Text(
				"Your browser may show a privacy warning. If it does, open the details and choose the option to continue to your Umbrel. Only do this for your Umbrel and its installed apps."
			)
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

// MARK: - Apps

private struct AppsSection: View {
	let model: MainModel
	@Environment(\.openURL) private var openURL
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
						action: {
							Task {
								if let url = await model.dashboardURLForOpening(path: "/app-store") { openURL(url) }
							}
						}
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
	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	var body: some View {
		let title = app.name ?? app.id
		let presentation = AppTilePresentation(state: app.state)
		VStack(spacing: 8) {
			AppIconView(url: app.iconURL)
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

// A tappable app tile: opens the app's web UI in the browser. App lifecycle management
// stays in umbrelOS, so unavailable apps hand off there instead of duplicating it here.
struct AppTileButton: View {
	let app: Umbreld.AppSummary
	var labelColor: Color = Theme.gray3

	@Environment(MainModel.self) private var model
	@Environment(\.openURL) private var openURL

	@State private var activeSheet: AppLaunchSheet?
	@State private var pendingLaunch: PendingAppLaunch?
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
				preparing: isPreparingLaunch
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
		.sheet(item: $activeSheet, onDismiss: finishPendingLaunch) { sheet in
			switch sheet {
			case .credentials:
				CredentialsSheet(app: appForLaunch) { pendingLaunch = .evaluateRequirements }
			case .httpsWarning:
				AppHTTPSWarningSheet(app: appForLaunch) { suppressFutureWarnings in
					if suppressFutureWarnings { model.setSuppressHTTPSRequiredAppWarning(true) }
					pendingLaunch = .open
				}
			}
		}
	}

	@MainActor
	private func prepareLaunch() async {
		isPreparingLaunch = true
		defer { isPreparingLaunch = false }
		guard let resolvedApp = await model.appForLaunch(id: app.id) else {
			launchAlert = .unavailable
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
			activeSheet = .credentials
		} else {
			beginLaunch()
		}
	}

	private func openUmbrel(path: String = "") {
		Task {
			guard let url = await model.dashboardURLForOpening(path: path) else {
				launchAlert = .unavailable
				return
			}
			openURL(url)
		}
	}

	private func beginLaunch() {
		if appForLaunch.requiresHttps == true,
			!model.dashboardUsesHTTPS,
			!model.suppressHTTPSRequiredAppWarning {
			activeSheet = .httpsWarning
		} else {
			openApp()
		}
	}

	private func finishPendingLaunch() {
		let launch = pendingLaunch
		pendingLaunch = nil
		switch launch {
		case .evaluateRequirements:
			beginLaunch()
		case .open:
			openApp()
		case nil:
			break
		}
	}

	private func openApp() {
		let app = appForLaunch
		Task {
			guard let url = await model.appURLForOpening(app) else {
				launchAlert = .unavailable
				return
			}
			openURL(url)
		}
	}
}

private enum AppLaunchAlert {
	case blocked(app: Umbreld.AppSummary, paused: Bool)
	case torOnly(app: Umbreld.AppSummary)
	case unavailable

	var title: String {
		switch self {
		case let .blocked(app, paused):
			return "\(app.name ?? app.id) is \(paused ? "Paused" : "Offline")"
		case let .torOnly(app):
			return "\(app.name ?? app.id) Uses Tor"
		case .unavailable:
			return "Can’t Reach Umbrel"
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
		case .unavailable:
			return "Check your connection and try again."
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

private enum AppLaunchSheet: String, Identifiable {
	case credentials
	case httpsWarning

	var id: String { rawValue }
}

private enum PendingAppLaunch {
	case evaluateRequirements
	case open
}

private struct AppHTTPSWarningSheet: View {
	let app: Umbreld.AppSummary
	let onOpen: (Bool) -> Void

	@Environment(\.dismiss) private var dismiss
	@Environment(\.dynamicTypeSize) private var dynamicTypeSize
	@State private var dontShowAgain = false

	var body: some View {
		VStack(spacing: 0) {
			AppIconView(url: app.iconURL, size: 64, corner: 16)
				.padding(.top, 40)

			Text("Open \(app.name ?? app.id) over HTTPS?")
				.font(.title3.weight(.semibold))
				.foregroundStyle(.white)
				.multilineTextAlignment(.center)
				.padding(.top, 16)

			Text("This app needs an HTTPS browser connection to work correctly. Your browser may show a privacy warning the first time.")
				.font(.subheadline)
				.foregroundStyle(Theme.gray)
				.multilineTextAlignment(.center)
				.fixedSize(horizontal: false, vertical: true)
				.padding(.top, 8)

			Text("If it does, open the details and choose the option to continue to your Umbrel.")
				.font(.footnote)
				.foregroundStyle(Theme.gray.opacity(0.8))
				.multilineTextAlignment(.center)
				.fixedSize(horizontal: false, vertical: true)
				.padding(.top, 8)

			Spacer()

			Toggle("Don’t show this warning again", isOn: $dontShowAgain)
				.toggleStyle(HTTPSWarningCheckboxStyle())
				.padding(.horizontal, 4)
				.padding(.bottom, 8)

			Button {
				onOpen(dontShowAgain)
				dismiss()
			} label: {
				Text("Open over HTTPS")
					.font(.headline)
					.foregroundStyle(.white)
					.frame(maxWidth: .infinity, minHeight: 48)
					.background(Color(hex: 0x6155F5), in: .capsule)
			}
			.buttonStyle(.plain)
			.padding(.bottom, 20)
		}
		.padding(.horizontal, 24)
		.presentationDetents([dynamicTypeSize.isAccessibilitySize ? .large : .medium])
		.presentationDragIndicator(.visible)
		.presentationBackground(Color(hex: 0x1C1C1E))
	}
}

// SwiftUI's built-in checkbox style is unavailable on iOS. A custom ToggleStyle
// keeps the familiar checkbox appearance while preserving native toggle semantics
// for VoiceOver, Switch Control, and keyboard input.
private struct HTTPSWarningCheckboxStyle: ToggleStyle {
	func makeBody(configuration: Configuration) -> some View {
		Button {
			configuration.isOn.toggle()
		} label: {
			HStack(spacing: 10) {
				Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
					.font(.system(size: 19))
					.foregroundStyle(configuration.isOn ? Color(hex: 0x6155F5) : Theme.gray.opacity(0.7))

				configuration.label
					.font(.subheadline)
					.foregroundStyle(Theme.gray)

				Spacer(minLength: 0)
			}
			.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
			.contentShape(Rectangle())
		}
		.buttonStyle(.plain)
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
	let brandHSL: String
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
					FolderTile(path: path, brandHSL: brandHSL)
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
	let brandHSL: String

	private var name: String { (path as NSString).lastPathComponent }

	var body: some View {
		VStack(spacing: 8) {
			FolderIconView(path: path, brandHSL: brandHSL)
				.frame(width: 44, height: 40)
			Text(name)
				.font(.caption2.weight(.medium))
				.foregroundStyle(Theme.gray3)
				.lineLimit(1)
				.padding(.horizontal, 4)
		}
	}
}

// MARK: - Library preview (visible whenever the user has granted Photos access)

private struct LibraryPreviewSection: View {
	@Environment(MainModel.self) private var model

	var body: some View {
		VStack(alignment: .leading, spacing: 12) {
			if model.photoLibrary.canReadLibrary {
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
		}
	}

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
