import SwiftUI
import UIKit

// Presents the browser with the system's zoom transition, so an app grows out of the
// icon that was tapped and settles back into it when closed.
//
// This is UIKit rather than fullScreenCover for one reason: the zoom transition's
// dismiss gestures would otherwise fight the web page for every downward scroll and
// edge swipe. Here they begin only on the browser's own title bar.
struct BrowserPresenter: UIViewControllerRepresentable {
	let browser: Browser
	let isPresented: Bool
	let brandColor: Color

	func makeUIViewController(context: Context) -> UIViewController {
		let controller = UIViewController()
		controller.view.isUserInteractionEnabled = false
		controller.view.backgroundColor = .clear
		return controller
	}

	func updateUIViewController(_ controller: UIViewController, context: Context) {
		let coordinator = context.coordinator
		if isPresented, coordinator.presented == nil {
			present(from: controller, coordinator: coordinator)
		} else if !isPresented, let presented = coordinator.presented {
			coordinator.presented = nil
			Self.dismiss(presented)
		}
		coordinator.presented?.prefersLightStatusBar = browser.prefersLightStatusBar
	}

	// The view presenting the browser is going away, for example because the Umbrel was
	// signed out while a page was open. The page goes with it rather than staying on
	// screen over whatever comes next.
	static func dismantleUIViewController(_ controller: UIViewController, coordinator: Coordinator) {
		guard let presented = coordinator.presented else { return }
		coordinator.presented = nil
		dismiss(presented)
	}

	// Dismissed through the controller that presented it, so anything open over the page
	// (Safari's in-app view, a share sheet) goes too. Asking the page itself would only
	// close whatever is on top of it.
	private static func dismiss(_ page: UIViewController) {
		guard let presenter = page.presentingViewController, !page.isBeingDismissed else { return }
		presenter.dismiss(animated: true)
	}

	func makeCoordinator() -> Coordinator { Coordinator() }

	@MainActor
	final class Coordinator {
		weak var presented: BrowserHostingController?
	}

	private func present(from anchor: UIViewController, coordinator: Coordinator) {
		// Present from whatever is frontmost, so a browser opened from a sheet covers
		// that sheet and returns to it.
		guard var presenter = anchor.view.window?.rootViewController else { return }
		while let next = presenter.presentedViewController, !next.isBeingDismissed { presenter = next }

		let root = BrowserView(browser: browser)
			.environment(\.brandColor, brandColor)
		let host = BrowserHostingController(rootView: AnyView(root))
		host.modalPresentationStyle = .fullScreen
		host.view.backgroundColor = .black
		host.onDismiss = { [weak browser, weak coordinator, weak host] in
			guard coordinator?.presented === host || coordinator?.presented == nil else { return }
			coordinator?.presented = nil
			browser?.didDismiss()
		}
		// The close button dismisses the page it is on directly. It must work even
		// if the app's idea of what is on screen has drifted from what is.
		browser.dismissPresented = { [weak host] in
			guard let host else { return }
			Self.dismiss(host)
		}

		let options = UIViewController.Transition.ZoomOptions()
		options.interactiveDismissShouldBegin = { [weak host] context in
			// Only a drag that starts on the title bar closes the browser. Everything
			// below it belongs to the page, and the bar's two buttons belong to
			// themselves: a press that wobbles must still be a press.
			guard let host else { return false }
			let buttonZone: CGFloat = 64
			return context.location.y <= BrowserView.barHeight + host.view.safeAreaInsets.top
				&& context.location.x > buttonZone
				&& context.location.x < host.view.bounds.width - buttonZone
		}
		host.preferredTransition = .zoom(options: options) { [weak browser] _ in
			browser?.sources.view(for: browser?.sourceID)
		}

		coordinator.presented = host
		presenter.present(host, animated: true)
	}
}

final class BrowserHostingController: UIHostingController<AnyView> {
	var onDismiss: () -> Void = {}
	var prefersLightStatusBar = true {
		didSet {
			if oldValue != prefersLightStatusBar { setNeedsStatusBarAppearanceUpdate() }
		}
	}

	override var preferredStatusBarStyle: UIStatusBarStyle {
		prefersLightStatusBar ? .lightContent : .darkContent
	}

	override func viewDidDisappear(_ animated: Bool) {
		super.viewDidDisappear(animated)
		// Only a dismissal that finishes gets here: a swipe let go part-way brings the
		// page back without it ever disappearing. Something shown over the page, like
		// Safari's view, hides it without dismissing it.
		if isBeingDismissed { onDismiss() }
	}
}

// Marks a view as the place a page zooms out of. Attach as a background to the icon
// or control that opens the browser.
struct BrowserSource: UIViewRepresentable {
	let id: AnyHashable
	@Environment(Browser.self) private var browser

	func makeUIView(context: Context) -> UIView {
		let view = UIView()
		view.isUserInteractionEnabled = false
		view.backgroundColor = .clear
		return view
	}

	func updateUIView(_ view: UIView, context: Context) {
		browser.sources.register(view, for: id)
	}

	static func dismantleUIView(_ view: UIView, coordinator: ()) {}
}

extension View {
	func browserSource(_ id: AnyHashable) -> some View {
		background { BrowserSource(id: id) }
	}
}
