import Observation
import SwiftUI
import UmbrelKit

// The in-app browser for one connected Umbrel. umbrelOS and its apps open here
// instead of leaving for Safari: already signed in, over the Umbrel's pinned secure
// connection, and still running the next time they are opened.
//
// The two are shown differently on purpose. An app is its own thing, so it zooms
// out of its icon into a page with a title bar. umbrelOS is the Umbrel itself and
// shares the app's wallpaper, so it takes over in place (see UmbrelOSView).
@MainActor
@Observable
final class Browser {
	struct ReturnTarget: Equatable {
		let origin: String
		let identity: BrowserPage.Identity
		let url: URL
	}

	// An app, presented over everything with its own title bar.
	private(set) var page: BrowserPage?
	private(set) var isPresented = false
	// umbrelOS, shown in place of the native screens on the same wallpaper.
	private(set) var umbrel: BrowserPage?
	private(set) var showsUmbrel = false
	// The app that opened umbrelOS with a link, so umbrelOS can offer the way back to
	// it. Only where it was is kept, not its page, so this holds nothing open.
	private(set) var returnTarget: ReturnTarget?
	// Whether the status bar should use light (white) content over the current page.
	var prefersLightStatusBar = true

	@ObservationIgnored let model: MainModel
	@ObservationIgnored private var context: BrowserContext?
	// Most recently used first. A handful stay warm so switching between umbrelOS and
	// a couple of apps is instant; older ones are released to keep memory modest.
	@ObservationIgnored private var pages: [BrowserPage] = []
	@ObservationIgnored let sources = BrowserSources()
	@ObservationIgnored private(set) var sourceID: AnyHashable?

	private static let warmPageLimit = 3
	static let umbrelPageOrigin = "umbrelos"

	init(model: MainModel) {
		self.model = model
	}

	// ── Opening ──

	// Opens umbrelOS at a path. Returns false when the Umbrel can't be reached.
	@discardableResult
	func openUmbrel(path: String = "", queryItems: [URLQueryItem] = []) async -> Bool {
		guard let url = await model.browserURL(path: path, queryItems: queryItems),
			let context = currentContext()
		else { return false }
		// Asking for umbrelOS itself returns to wherever it was; asking for a place
		// inside it goes there.
		show(umbrelPage(in: context), at: url, resuming: path.isEmpty && queryItems.isEmpty, from: nil)
		return true
	}

	@discardableResult
	func open(_ app: Umbreld.AppSummary, from source: AnyHashable? = nil) async -> Bool {
		guard let url = await model.browserURL(for: app), let context = currentContext() else { return false }
		show(page(for: app, in: context), at: url, resuming: true, from: source)
		return true
	}

	// Loads umbrelOS quietly once the Umbrel is known to be reachable, so the first
	// time it is opened it is simply there. Nothing is shown and nothing is asked of
	// the user; if it can't load now, opening it later loads it as usual.
	func preloadUmbrel() async {
		guard umbrel == nil, model.connectionState == .connected,
			let url = await model.browserURL(),
			let context = currentContext(),
			umbrel == nil
		else { return }
		umbrelPage(in: context).open(url, resuming: true)
	}

	// Set by the presenter: dismisses whatever page is actually on screen.
	@ObservationIgnored var dismissPresented: () -> Void = {}

	func close() {
		isPresented = false
		dismissPresented()
	}

	func closeUmbrel() {
		showsUmbrel = false
		returnTarget = nil
	}

	// Back to the app that opened umbrelOS, where it was. If its page was released in
	// the meantime, it opens again at the same place.
	func returnToApp() {
		guard let target = returnTarget, let context else { return }
		show(
			page(origin: target.origin, identity: target.identity, in: context),
			at: target.url,
			resuming: true,
			from: nil)
	}

	// The presentation ended, by the close button or by gesture.
	func didDismiss() {
		isPresented = false
		sourceID = nil
	}

	// Keeps the browser session alive while the app is in use, off the critical path
	// of opening a page.
	func keepSessionAlive() async {
		guard let context = currentContext(), let target = model.nativeTarget else { return }
		await context.validateSession(target: target)
	}

	// The current location, readdressed for Safari: a name people can read, over HTTPS
	// wherever Safari can open it without a warning.
	func safariURL(for page: BrowserPage) async -> URL? {
		// Another website (a sign-in, say): its own address.
		if page.outsideHost != nil { return page.shownURL }
		let app = model.installedApps.first(where: { $0.id == page.origin })
		let base = if let app { await model.appURLForOpening(app) } else { await model.dashboardURLForOpening() }
		guard let base, var components = URLComponents(url: base, resolvingAgainstBaseURL: false) else {
			return nil
		}
		if let shown = page.shownURL {
			// A page on the Umbrel that isn't an app's front door keeps its own port.
			if app == nil, page.origin != Self.umbrelPageOrigin { components.port = shown.port }
			components.path = shown.path()
			components.query = shown.query()
			components.fragment = shown.fragment()
		}
		return components.url
	}

	// ── Pages ──

	private func show(_ page: BrowserPage, at url: URL, resuming: Bool = false, from source: AnyHashable?) {
		context?.updateHosts(model.browserHosts)
		page.open(url, resuming: resuming)
		if page === umbrel {
			// umbrelOS takes over in place; any app on top steps aside for it. A page
			// covers the whole screen, and the views under it aren't updated while it
			// does, so the page is dismissed directly. Its icon is hidden behind
			// umbrelOS, so it fades away instead of shrinking into it.
			if isPresented, let app = self.page, let location = app.shownURL ?? app.currentURL {
				returnTarget = ReturnTarget(origin: app.origin, identity: app.identity, url: location)
			}
			showsUmbrel = true
			sourceID = nil
			close()
			return
		}
		returnTarget = nil
		pages.removeAll { $0 === page }
		pages.insert(page, at: 0)
		for stale in pages.dropFirst(Self.warmPageLimit) where stale !== self.page {
			pages.removeAll { $0 === stale }
		}
		if isPresented {
			// Already on screen (umbrelOS just launched an app): change pages in place.
			withAnimation(.easeInOut(duration: 0.25)) { self.page = page }
		} else {
			sourceID = source
			self.page = page
			isPresented = true
		}
	}

	// umbrelOS has one page for the life of the connection. It is never released
	// with the app pages: it is what makes opening umbrelOS feel like part of the app.
	private func umbrelPage(in context: BrowserContext) -> BrowserPage {
		if let umbrel { return umbrel }
		let page = BrowserPage(
			origin: Self.umbrelPageOrigin,
			identity: BrowserPage.Identity(name: "umbrelOS", iconURL: nil, isUmbrel: true),
			context: context,
			seeThrough: true)
		page.onOpenUmbrelURL = { [weak self] url in self?.route(url) }
		umbrel = page
		return page
	}

	private func page(for app: Umbreld.AppSummary, in context: BrowserContext) -> BrowserPage {
		let identity = BrowserPage.Identity(name: app.name ?? app.id, iconURL: app.iconURL, isUmbrel: false)
		return page(origin: app.id, identity: identity, in: context)
	}

	private func page(origin: String, identity: BrowserPage.Identity, in context: BrowserContext) -> BrowserPage {
		if let existing = pages.first(where: { $0.origin == origin }) {
			existing.update(identity: identity)
			return existing
		}
		let page = BrowserPage(origin: origin, identity: identity, context: context)
		page.onOpenUmbrelURL = { [weak self] url in self?.route(url) }
		return page
	}

	// A page asked for another page on this Umbrel. Send it to that app's own page
	// (or umbrelOS's), so each keeps its place.
	private func route(_ url: URL) {
		guard let context else { return }
		let url = context.secureURL(for: url)
		if context.isDashboard(url) {
			show(umbrelPage(in: context), at: url, from: nil)
		} else if let port = url.port, let app = model.installedApps.first(where: { $0.port == port }) {
			show(page(for: app, in: context), at: url, from: nil)
		} else {
			// Something on the Umbrel that isn't an installed app's front door.
			let identity = BrowserPage.Identity(name: url.host() ?? "Umbrel", iconURL: nil, isUmbrel: false)
			show(
				page(origin: "\(url.host() ?? ""):\(url.port ?? 0)", identity: identity, in: context),
				at: url,
				from: nil)
		}
	}

	private func currentContext() -> BrowserContext? {
		guard let deviceId = model.device?.id, let accountId = model.session?.accountId else { return nil }
		if let context, context.deviceId == deviceId, context.accountId == accountId { return context }
		pages = []
		umbrel = nil
		showsUmbrel = false
		returnTarget = nil
		let context = BrowserContext(deviceId: deviceId, accountId: accountId, hosts: model.browserHosts)
		self.context = context
		return context
	}
}

// The on-screen views pages grow out of and shrink back into.
@MainActor
final class BrowserSources {
	private final class Box {
		weak var view: UIView?
		init(_ view: UIView) { self.view = view }
	}

	private var views: [AnyHashable: Box] = [:]

	func register(_ view: UIView, for id: AnyHashable) {
		views[id] = Box(view)
	}

	func unregister(_ view: UIView, for id: AnyHashable) {
		if views[id]?.view === view { views[id] = nil }
	}

	func view(for id: AnyHashable?) -> UIView? {
		guard let id, let view = views[id]?.view, view.window != nil else { return nil }
		return view
	}
}
