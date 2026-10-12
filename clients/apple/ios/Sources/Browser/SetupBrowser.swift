import SwiftUI
import UmbrelKit

// First-time setup, without leaving the app. A new Umbrel is set up by umbrelOS's own
// onboarding (it knows the hardware, storage, and restore options), shown here over
// the Umbrel's pinned secure connection. When the account exists, the app signs in
// with the password that was just chosen and carries on.
struct SetupBrowser: View {
	let target: Umbreld.Target
	// Called once setup has produced an account, with the chosen password if the app
	// saw it being typed. The presenter dismisses this view.
	var onFinish: (_ password: String?) -> Void
	// Called when setup reaches a step that restarts the Umbrel, which has to happen
	// in a browser, saying whether it's a restore. The presenter dismisses this view.
	var onNeedsBrowser: (_ restoring: Bool) -> Void
	var onCancel: () -> Void

	@State private var page: BrowserPage?
	@State private var unreachable = false
	@State private var password: String?
	@State private var accountCreated = false

	var body: some View {
		ZStack {
			Color.black.ignoresSafeArea()
			if let page {
				BrowserPageView(page: page, isImmersive: true, onClose: onCancel)
			} else if unreachable {
				ContentUnavailableView {
					Label("Can’t Reach Umbrel", systemImage: "wifi.exclamationmark")
				} description: {
					Text("Make sure your Umbrel is turned on and this iPhone is on the same network.")
				} actions: {
					Button("Try Again") { Task { await open() } }
					Button("Cancel", action: onCancel)
				}
			} else {
				ProgressView().tint(.white)
			}
		}
		.preferredColorScheme(.dark)
		.task { await open() }
	}

	private func open() async {
		unreachable = false
		guard let host = try? await Umbreld.resolvedHost(for: target),
			let url = URL(string: "https://\(host)/")
		else {
			unreachable = true
			return
		}
		// The owner is the only account that can exist at the end of setup.
		let context = BrowserContext(deviceId: target.deviceId, accountId: "0", hosts: target.hosts)
		let page = BrowserPage(
			origin: "setup",
			identity: .init(name: "Set Up Umbrel", iconURL: nil, isUmbrel: true),
			context: context)
		page.observePasswordEntry { password = $0 }
		// Setup is umbrelOS's moment: its wallpaper fills the screen, with no bar.
		page.fillScreen(keepingClear: Self.safeAreaInsets)
		page.onLocationChange = { location in
			// Restore is chosen partway through setup, so it can't be sent to a browser in
			// advance. It hands over at its first screen, before anything has changed. The
			// RAID pages are a safety net in case umbrelOS offers RAID where the app doesn't
			// expect it.
			if Self.restartingSteps.contains(where: { location.path().hasPrefix($0) }) {
				onNeedsBrowser(location.path().hasPrefix("/onboarding/restore"))
				return
			}
			// umbrelOS ends onboarding on a confirmation page, then enters the desktop.
			// Leaving onboarding after that page is the user saying they're done.
			if location.path().hasPrefix("/onboarding/account-created") {
				accountCreated = true
			} else if accountCreated, !location.path().hasPrefix("/onboarding") {
				onFinish(password)
			}
		}
		page.open(url, resuming: false)
		self.page = page
	}

	private static let restartingSteps = [
		"/onboarding/restore", "/onboarding/raid", "/onboarding/ssd-raid", "/onboarding/hdd-raid",
	]

	private static var safeAreaInsets: UIEdgeInsets {
		let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
		let insets = scenes.compactMap(\.keyWindow).first?.safeAreaInsets ?? .zero
		return UIEdgeInsets(top: insets.top, left: 0, bottom: insets.bottom, right: 0)
	}
}
