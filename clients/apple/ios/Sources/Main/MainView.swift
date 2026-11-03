import Network
import SwiftUI
import UmbrelKit

// One connected device: a four-tab layout (Home, Apps, Library, Profile) over the user's
// umbrelOS wallpaper. Uses the native tab bar so it gets the system's Liquid Glass
// treatment.
//
// Profile is a settings sheet that covers the whole screen, dock included. Its tab-bar
// item presents that sheet without changing the selected content tab. This avoids
// overlapping a TabView destination transition with the sheet transition.
struct MainView: View {
	private enum Tab: Hashable {
		case home, apps, library, profile
	}

	let device: SavedDevice
	var onBack: () -> Void
	var onReconnect: () async -> Void
	@Binding private var connectionSnapshot: DeviceConnectionSnapshot
	@State private var model: MainModel?
	@State private var browser: Browser?
	@State private var selection: Tab = .home
	@State private var showProfile = false
	@State private var profilePath: [ProfileDestination] = []

	init(
		device: SavedDevice,
		connectionSnapshot: Binding<DeviceConnectionSnapshot>,
		onBack: @escaping () -> Void,
		onReconnect: @escaping () async -> Void
	) {
		self.device = device
		self.onBack = onBack
		self.onReconnect = onReconnect
		_connectionSnapshot = connectionSnapshot
	}

	var body: some View {
		Group {
			if let model, let browser, model.device?.id == device.id {
				GeometryReader { geometry in
					// The full window size, not the safe-area size: the wallpaper backdrop
					// and the card frost both pin their image to this, and the backdrop
					// draws edge to edge under the status bar and home indicator. It also
					// makes the frost's global-coordinate offsets line up exactly, since
					// the global space measures from the same screen origin.
					content(model, browser: browser)
						.environment(
							\.wallpaperViewportSize,
							CGSize(
								width: geometry.size.width
									+ geometry.safeAreaInsets.leading + geometry.safeAreaInsets.trailing,
								height: geometry.size.height
									+ geometry.safeAreaInsets.top + geometry.safeAreaInsets.bottom
							)
						)
				}
			} else {
				Color.black.ignoresSafeArea()
			}
		}
		.task(id: device.id) {
			guard model?.device?.id != device.id else { return }
			let snapshot = _connectionSnapshot
			let model = MainModel(
				device: device,
				initialConnectionState: snapshot.wrappedValue.state,
				onConnectionCheck: { state in
					snapshot.wrappedValue = DeviceConnectionSnapshot(
						state: state,
						checkedAt: Date()
					)
				}
			)
			self.model = model
			browser = Browser(model: model)
		}
	}

	// The wallpaper is the one thing that never changes. The native tabs and umbrelOS
	// are two layers of content over it, and opening umbrelOS is a handover between
	// them: the tabs dissolve off the wallpaper as umbrelOS settles onto it.
	private func content(_ model: MainModel, browser: Browser) -> some View {
		let showsUmbrel = browser.showsUmbrel
		return ZStack {
			mainContent(model, browser: browser)
				.opacity(showsUmbrel ? 0 : 1)
				.allowsHitTesting(!showsUmbrel)
				.accessibilityHidden(showsUmbrel)
				.animation(
					.easeOut(duration: showsUmbrel ? 0.18 : 0.3).delay(showsUmbrel ? 0 : 0.08),
					value: showsUmbrel)
			if let umbrel = browser.umbrel {
				UmbrelOSView(browser: browser, page: umbrel, isShown: showsUmbrel)
					.animation(
						showsUmbrel
							? .spring(duration: 0.42, bounce: 0.12).delay(0.08)
							: .easeIn(duration: 0.16),
						value: showsUmbrel)
			}
		}
		// The status-bar shading and the header belong to neither layer. They are
		// shared by every tab and by umbrelOS, and stay exactly as they are while
		// what's beneath them changes.
		.overlay(alignment: .top) { WallpaperTopGradient() }
		.overlay(alignment: .top) { headerBar(model, browser: browser) }
		// A background, not a layer in the stack: it must not take part in layout, or
		// its full-screen size would push the content out of the safe area.
		// It is also the only wallpaper there is: every tab and umbrelOS show this one
		// image, so nothing can be out of register with anything else.
		.background { WallpaperBackground(image: model.wallpaperImage) }
		.environment(\.brandColor, BrandColor.color(model.wallpaperBrandColorHsl))
		.environment(model)
		.environment(browser)
		.onChange(of: showsUmbrel) { _, shown in
			// umbrelOS takes over the screen itself, so anything presented over the
			// tabs (Profile, a setup guide) gets out of its way.
			guard shown else { return }
			showProfile = false
			model.dismissTailscaleSetup()
		}
	}

	private func mainContent(_ model: MainModel, browser: Browser) -> some View {
		TabView(selection: tabSelection) {
			HomeView(onShowConnectionDetails: showConnectionDetails)
				.tabItem { Label("Home", systemImage: "house.fill") }
				.tag(Tab.home)
			AppsView()
				.tabItem { Label("Apps", systemImage: "circle.grid.cross.up.filled") }
				.tag(Tab.apps)
			LibraryView()
				.tabItem { Label("Library", systemImage: "photo.fill.on.rectangle.fill") }
				.tag(Tab.library)
			Color.clear
				.tabItem { Label("Profile", systemImage: "person.fill") }
				.tag(Tab.profile)
		}
		.tint(Theme.blue)
		.sheet(isPresented: $showProfile, onDismiss: { profilePath.removeAll() }) {
			ProfileSheet(path: $profilePath)
		}
		// Lives behind the tabs purely to present the browser over everything.
		.background {
			BrowserPresenter(
				browser: browser,
				isPresented: browser.isPresented,
				brandColor: BrandColor.color(model.wallpaperBrandColorHsl)
			)
		}
		.environment(model)
		.environment(browser)
		.sheet(
			isPresented: Binding(
				// Profile owns the nested setup sheet while it is visible. Keeping one
				// presenter per state avoids SwiftUI dropping a second sheet request.
				get: { !showProfile && model.tailscaleSetupPresented },
				set: { presented in
					if !presented { model.dismissTailscaleSetup() }
				}
			)
		) {
			TailscaleSetupSheet()
				.environment(model)
				.environment(browser)
		}
		// umbrelOS accents (primary buttons, storage donut, Profile links/toggles) follow the
		// wallpaper's brand color. Set once here so every tab and the sheet inherit it.
		.environment(\.brandColor, BrandColor.color(model.wallpaperBrandColorHsl))
		.onAppear {
			model.onBack = onBack
			// Close any open app page first. While a page covers the screen, SwiftUI doesn't
			// tear down the views under it, so the presenter's own cleanup would only run
			// once the page was closed by hand.
			model.onLogOut = {
				browser.close()
				onBack()
			}
			model.onReconnect = onReconnect
			model.openLibrary = { selection = .library }
			model.openApps = { selection = .apps }
			model.reconcilePhotoLibraryAccess()
		}
		// General Umbrel data is refreshed only while the app is visible. This task is
		// cancelled by SwiftUI as soon as the app enters the background, then performs
		// one full reconciliation when it becomes active again.
		.task(id: scenePhase) {
			guard scenePhase == .active else { return }
			await model.load()
			await browser.keepSessionAlive()
			await browser.preloadUmbrel()
			while !Task.isCancelled {
				do {
					try await Task.sleep(for: .seconds(15))
				} catch {
					return
				}
				await model.refreshVisibleData(for: refreshScope)
			}
		}
		// Tailscale availability is app-level state. One root-owned, uncached identity
		// probe runs on foreground entry and whenever the pinned/candidate host changes.
		.task(id: TailscaleAvailabilityTaskID(
			isActive: scenePhase == .active,
			host: model.tailscaleAvailabilityHost
		)) {
			guard scenePhase == .active else { return }
			await model.refreshTailscaleAvailability()
		}
		// Opening a tab should not wait for the next timer tick. The model's freshness
		// checks make this a no-op when that tab's data was fetched recently.
		.task(id: selection) {
			guard scenePhase == .active else { return }
			await model.refreshVisibleData(for: refreshScope)
		}
		// Profile is presented as a sheet, so opening it does not change `selection` and
		// cannot rely on the tab-change refresh above. Refresh the data Profile actually
		// shows and independently verify its known Tailscale endpoint. Both operations
		// are foreground-only and share the model's existing in-flight guards.
		.task(id: showProfile) {
			guard showProfile, scenePhase == .active else { return }
			async let profileRefresh: Void = model.refreshVisibleData(for: .profile, force: true)
			async let tailscaleRefresh: Void = model.refreshTailscaleAvailability()
			_ = await (profileRefresh, tailscaleRefresh)
		}
		// Apple's path monitor is an event trigger, not a reachability oracle. Its first
		// value describes the current path; subsequent values mean Wi-Fi, cellular, or a
		// VPN route changed. Re-resolve the Umbrel only for those actual transitions.
		.task(id: scenePhase) {
			guard scenePhase == .active else { return }
			var receivedInitialPath = false
			for await _ in NWPathMonitor() {
				if !receivedInitialPath {
					receivedInitialPath = true
					continue
				}
				await model.refreshAfterNetworkPathChange()
			}
		}
		// PhotoKit's extension writes progress into shared storage independently of
		// the host app. Poll that lightweight snapshot only while its UI is visible;
		// changing scene phase cancels this task without affecting background uploads.
		.task(id: scenePhase) {
			guard scenePhase == .active else { return }
			while !Task.isCancelled {
				model.refreshPhotoBackupPresentation()
				do {
					try await Task.sleep(for: .seconds(2))
				} catch {
					return
				}
			}
		}
		.onChange(of: scenePhase) { _, phase in
			if phase == .active {
				model.reconcilePhotoLibraryAccess()
			}
		}
		.onChange(of: device) { _, device in
			model.refreshSavedDevice(device)
		}
		.alert(
			item: Binding(
				get: { model.configStorageIssue },
				set: { if $0 == nil { model.dismissConfigStorageIssue() } }
			)
		) { issue in
			Alert(
				title: Text(issue.title),
				message: Text(issue.localizedDescription),
				dismissButton: .default(Text("OK"))
			)
		}
	}

	private func headerBar(_ model: MainModel, browser: Browser) -> some View {
		// Back leads from Home out to the list of Umbrels. umbrelOS has its own navigation,
		// and the pill's X closes it. When an app opened umbrelOS with a link, the same
		// corner leads back to that app, like the system's own way back to the previous app.
		let showsBack = selection == .home && !browser.showsUmbrel
		let returnTarget = browser.showsUmbrel ? browser.returnTarget : nil
		return HStack {
			ZStack(alignment: .leading) {
				// Keep the glass compositor alive across tab changes, like the browser pill.
				// Elsewhere the control is hidden without being removed from the hierarchy.
				CircleIconButton(system: "chevron.left", accessibilityLabel: "All Umbrels") { model.onBack() }
					.opacity(showsBack ? 1 : 0)
					.allowsHitTesting(showsBack)
					.accessibilityHidden(!showsBack)
				if let returnTarget {
					ReturnToAppButton(name: returnTarget.identity.name) { browser.returnToApp() }
						.transition(.opacity)
				}
			}
			Spacer()
			HeaderAccessPill(model: model)
		}
		.padding(.horizontal, Theme.contentInset)
		.animation(.easeOut(duration: 0.2), value: showsBack)
		.animation(.easeOut(duration: 0.2), value: returnTarget)
	}

	private var tabSelection: Binding<Tab> {
		Binding(
			get: { selection },
			set: { requestedTab in
				if requestedTab == .profile {
					profilePath.removeAll()
					showProfile = true
				} else {
					selection = requestedTab
				}
			}
		)
	}

	private func showConnectionDetails() {
		profilePath = [.connection]
		showProfile = true
	}

	private var refreshScope: MainModel.RefreshScope {
		switch selection {
		case .home: .home
		case .apps: .apps
		case .library: .library
		case .profile: .profile
		}
	}

	@Environment(\.scenePhase) private var scenePhase
}

// One explanation and set of actions reused anywhere Tailscale matters. Umbrel can
// detect whether its own Tailscale app has supplied an address, but iOS does not expose
// another VPN app's signed-in state. The iPhone step therefore links to Tailscale and
// Photo Backup verifies the fixed Umbrel endpoint before any upload can begin.
struct TailscaleSetupSheet: View {
	@Environment(\.dismiss) private var dismiss

	var body: some View {
		NavigationStack {
			TailscaleSetupContent()
				.navigationTitle("Tailscale")
				.navigationBarTitleDisplayMode(.inline)
				.toolbar {
					DrawerCloseToolbarItem(action: { dismiss() })
				}
		}
		.presentationDragIndicator(.visible)
		.presentationCornerRadius(38)
		.presentationBackground(Color(hex: 0x1C1C1E))
	}
}

// Profile is already a sheet. Apple recommends one sheet at a time, with a Back
// button for subsequent steps, so this variant is pushed inside Profile's stack.
struct TailscaleSetupPage: View {
	var body: some View {
		TailscaleSetupContent()
		.navigationTitle("Tailscale")
		.navigationBarTitleDisplayMode(.inline)
	}
}

private struct TailscaleSetupContent: View {
	@Environment(MainModel.self) private var model
	@Environment(Browser.self) private var browser
	@Environment(\.openURL) private var openURL
	@State private var isOpeningUmbrel = false
	@State private var isShowingUmbrelUnavailable = false

	var body: some View {
		ScrollView(showsIndicators: false) {
			VStack(spacing: 24) {
				VStack(spacing: 14) {
					Image("TailscaleIcon")
						.resizable()
						.scaledToFit()
						.frame(width: 76, height: 76)
						.clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
					Text("Connect from anywhere")
						.font(.title2.bold())
						.foregroundStyle(.white)
					Text("Tailscale privately connects this iPhone to your Umbrel, and lets Photo Backup run in the background wherever you are.")
						.font(.subheadline)
						.foregroundStyle(Theme.gray)
						.multilineTextAlignment(.center)
						.fixedSize(horizontal: false, vertical: true)
				}
				.padding(.horizontal, 12)

				VStack(spacing: 12) {
					TailscaleSetupStep(
						number: 1,
						title: umbrelSetupTitle,
						message: umbrelSetupComplete
							? "Tailscale is set up on this Umbrel."
							: umbrelSetupMessage,
						isComplete: umbrelSetupComplete
					)

					TailscaleSetupStep(
						number: 2,
						title: isCheckingIPhone
							? "Checking this iPhone"
							: (model.photoBackupTailscaleAddressChanged
								? "Reconnect Photo Backup"
								: (model.tailscaleAvailableOnThisPhone == true ? "This iPhone" : "Connect this iPhone")),
						message: isCheckingIPhone
							? "Checking the Tailscale connection…"
							: (model.photoBackupTailscaleAddressChanged
								? "Tailscale was reset on your Umbrel. Reconnect Photo Backup to use its new address."
								: (model.tailscaleAvailableOnThisPhone == true
									? "This iPhone can reach your Umbrel through Tailscale."
									: iphoneSetupMessage)),
						isComplete: model.tailscaleAvailableOnThisPhone == true
							&& !model.photoBackupTailscaleAddressChanged,
						isChecking: isCheckingIPhone
					)
				}

				primaryAction
			}
			.padding(.horizontal, 20)
			.padding(.top, 20)
			.padding(.bottom, 32)
		}
		.scrollEdgeEffectStyle(.soft, for: .top)
		.background(Color(hex: 0x1C1C1E).ignoresSafeArea())
		.alert("Can’t Open Umbrel", isPresented: $isShowingUmbrelUnavailable) {
			Button("OK", role: .cancel) {}
		} message: {
			Text("Connect to your Umbrel locally, then try again.")
		}
	}

	// A currently reported address is evidence that Umbrel-side setup has happened.
	// A successful live probe is stronger evidence and also covers a pinned backup host.
	private var umbrelSetupComplete: Bool {
		model.umbrelHasTailscaleAddress || model.tailscaleAvailableOnThisPhone == true
	}

	// Once a result exists, background verification must not replace useful status
	// with a spinner. Checking is a first-load state, not a recurring polling state.
	private var isCheckingIPhone: Bool {
		model.tailscaleAvailabilityCheckInProgress
			&& model.tailscaleAvailableOnThisPhone == nil
	}

	private var umbrelSetupTitle: String {
		if umbrelSetupComplete { return "Your Umbrel" }
		if !model.canManageApps { return "Ask the owner" }
		return "Set up your Umbrel"
	}

	private var umbrelSetupMessage: String {
		if !model.canManageApps {
			return "The owner needs to set up Tailscale on this Umbrel and share access with you."
		}
		if model.tailscaleApp != nil {
			return "Open Tailscale on your Umbrel and sign in to finish setup."
		}
		return "Install Tailscale from the Umbrel App Store, then open it and sign in."
	}

	private var iphoneSetupMessage: String {
		if !model.canManageApps {
			return "Make sure you’ve accepted the owner’s Tailscale invitation, then connect Tailscale on this iPhone."
		}
		return "Make sure Tailscale is connected on this iPhone and your Umbrel. If you don’t have it on this iPhone, install it from the App Store."
	}

	@ViewBuilder
	private var primaryAction: some View {
		if model.photoBackupTailscaleAddressChanged {
			PrimaryActionButton(
				title: model.photoBackupSetupInProgress
					? "Reconnecting Photo Backup…"
					: "Reconnect Photo Backup",
				isLoading: model.photoBackupSetupInProgress,
				action: model.reconnectPhotoBackupToTailscale
			)
		} else if !umbrelSetupComplete, model.canManageApps {
			PrimaryActionButton(
				title: isOpeningUmbrel
					? "Opening…"
					: (model.tailscaleApp == nil
						? "Install Tailscale on Umbrel"
						: "Open Tailscale on Umbrel"),
				isLoading: isOpeningUmbrel,
				action: openTailscaleOnUmbrel
			)
		} else if !isCheckingIPhone
			&& model.tailscaleAvailableOnThisPhone == false
		{
			PrimaryActionButton(
				title: "View Tailscale in App Store",
				action: openTailscaleForiPhone
			)
		}
	}

	private func openTailscaleOnUmbrel() {
		guard !isOpeningUmbrel else { return }
		isOpeningUmbrel = true
		Task {
			defer { isOpeningUmbrel = false }
			let opened = if let app = model.tailscaleApp {
				await browser.open(app)
			} else {
				await browser.openUmbrel(path: "/app-store/tailscale")
			}
			if !opened { isShowingUmbrelUnavailable = true }
		}
	}

	private func openTailscaleForiPhone() {
		guard let url = URL(string: "https://apps.apple.com/app/id1470499037") else { return }
		openURL(url)
	}
}

private struct TailscaleAvailabilityTaskID: Equatable {
	let isActive: Bool
	let host: String?
}

private struct TailscaleSetupStep: View {
	let number: Int
	let title: String
	let message: String
	var isComplete = false
	var isChecking = false

	var body: some View {
		HStack(alignment: .center, spacing: 14) {
			ZStack {
				Circle()
					.fill(Color.white.opacity(isComplete ? 0.12 : 0.08))
				if isChecking {
					ProgressView()
						.controlSize(.small)
						.tint(.white)
				} else if isComplete {
					Image(systemName: "checkmark")
						.font(.system(size: 13, weight: .bold))
						.foregroundStyle(.white.opacity(0.9))
				} else {
					Text("\(number)")
						.font(.system(size: 13, weight: .semibold))
						.foregroundStyle(.white)
				}
			}
			.frame(width: 32, height: 32)

			VStack(alignment: .leading, spacing: 5) {
				Text(title)
					.font(.subheadline.weight(.semibold))
					.foregroundStyle(.white)
				Text(message)
					.font(.footnote)
					.foregroundStyle(Theme.gray)
					.fixedSize(horizontal: false, vertical: true)
			}
			.frame(maxWidth: .infinity, alignment: .leading)
		}
		.padding(18)
		.background(Color(hex: 0x2C2C2E), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
	}
}
