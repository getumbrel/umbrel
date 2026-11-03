import CryptoKit
import UmbrelKit
import WebKit

// Everything the in-app browser needs to show one account on one Umbrel: a private
// website data store, the Umbrel's addresses, and the umbrelOS browser session that
// keeps the user signed in across all of them.
@MainActor
final class BrowserContext {
	let deviceId: String
	let accountId: String
	let dataStore: WKWebsiteDataStore
	private(set) var hosts: Set<String>
	private(set) var session: Umbreld.BrowserSession? {
		didSet { if session != oldValue { replaceTokenScripts() } }
	}

	// The web views made here, each with the token script it was given, so a new
	// session can reach pages that are already open.
	private struct OpenWebView {
		weak var webView: WKWebView?
		var tokenScript: WKUserScript?
	}
	private var openWebViews: [OpenWebView] = []

	// Web content only ever sees the session's fingerprint, never this world.
	private static let world = WKContentWorld.world(name: "umbrel")

	init(deviceId: String, accountId: String, hosts: [String]) {
		self.deviceId = deviceId
		self.accountId = accountId
		self.hosts = Set(hosts.map(Self.normalized))
		dataStore = WKWebsiteDataStore(forIdentifier: Self.dataStoreId(deviceId: deviceId, accountId: accountId))
		if let stored = Keychain.readBrowserSession(deviceId: deviceId), stored.accountId == accountId {
			session = stored
		}
	}

	func updateHosts(_ hosts: [String]) {
		self.hosts.formUnion(hosts.map(Self.normalized))
	}

	func isUmbrel(_ url: URL?) -> Bool {
		guard let host = url?.host() else { return false }
		return hosts.contains(Self.normalized(host))
	}

	// umbrelOS itself, as opposed to an app on another port.
	func isDashboard(_ url: URL?) -> Bool {
		guard let url, isUmbrel(url), url.scheme == "https" else { return false }
		return url.port == nil || url.port == 443
	}

	// The Umbrel only ever loads over HTTPS here. Its plain HTTP addresses serve the
	// same pages, so an http:// link to it opens at the matching https:// address.
	func secureURL(for url: URL) -> URL {
		guard url.scheme?.lowercased() == "http", isUmbrel(url),
			var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
		else { return url }
		components.scheme = "https"
		if components.port == 80 { components.port = nil }
		return components.url ?? url
	}

	// ── Web view ──

	// A see-through web view shows umbrelOS as content on the app's own wallpaper
	// rather than as a page with a wallpaper of its own.
	func makeWebView(seeThrough: Bool = false) -> WKWebView {
		let configuration = WKWebViewConfiguration()
		configuration.websiteDataStore = dataStore
		configuration.allowsInlineMediaPlayback = true
		configuration.allowsPictureInPictureMediaPlayback = true
		configuration.allowsAirPlayForMediaPlayback = true
		configuration.defaultWebpagePreferences.preferredContentMode = .mobile
		// Sites sniff for Safari; the trailing token lets umbrelOS recognise this app.
		configuration.applicationNameForUserAgent = "Version/26.0 Mobile/15E148 Safari/604.1 UmbrelApp/\(Self.appVersion)"
		let script = tokenScript
		if let script { configuration.userContentController.addUserScript(script) }
		if seeThrough { configuration.userContentController.addUserScript(seeThroughScript) }

		// Screen-sized from the start: a page loaded before it is on screen should lay
		// out once, at the width it will be shown at, not for a zero-width window.
		let screen = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first?.screen
		let webView = WKWebView(frame: screen?.bounds ?? .zero, configuration: configuration)
		// The app is dark throughout; pages that follow the system appearance should
		// match it from their very first frame, before they are ever on screen.
		webView.overrideUserInterfaceStyle = .dark
		webView.allowsBackForwardNavigationGestures = !seeThrough
		if seeThrough {
			webView.isOpaque = false
			webView.backgroundColor = .clear
			webView.scrollView.backgroundColor = .clear
			webView.underPageBackgroundColor = .clear
		}
		webView.scrollView.contentInsetAdjustmentBehavior = .never
		webView.scrollView.keyboardDismissMode = .interactive
		webView.removeFormAccessoryBar()
		#if DEBUG
		webView.isInspectable = true
		#endif
		openWebViews.append(OpenWebView(webView: webView, tokenScript: script))
		return webView
	}

	// umbrelOS paints the user's wallpaper behind everything it draws. The app is
	// already showing that wallpaper, edge to edge, so umbrelOS's copy is made
	// invisible and its page background cleared: one wallpaper, with umbrelOS's
	// interface on top of it. The images stay in the page (umbrelOS samples them for
	// its glass), they are simply not drawn. Wallpaper previews in Settings are
	// positioned differently and are left alone. A video wallpaper is left alone
	// too: the app only has a still of it, so umbrelOS keeps drawing its own, moving
	// one within its page.
	//
	// umbrelOS's windows also fade their frosted backing in after they open, which
	// reads as a dark flash when a window is the first thing shown. Here they arrive
	// fully formed. The backing starts invisible and only the fade reveals it, so
	// skipping the fade also has to show it.
	//
	// This is the one place the app knows anything about umbrelOS's markup. If a
	// future umbrelOS changes it, the only effect is that its own wallpaper shows
	// inside the page again.
	private var seeThroughScript: WKUserScript {
		let origins = hosts.map { "https://\($0)" }
		let originsJSON = (try? String(decoding: JSONEncoder().encode(origins), as: UTF8.self)) ?? "[]"
		let source = """
			(() => {
				if (!\(originsJSON).includes(location.origin)) return
				const style = document.createElement('style')
				style.textContent = `
					html, body { background: transparent !important; }
					picture > img.fixed.inset-0:not(.absolute),
					img[data-wallpaper-full]:not(.absolute) { opacity: 0 !important; }
					.umbrel-window-wallpaper { animation: none !important; opacity: 1 !important; }
				`
				document.documentElement.appendChild(style)
			})()
			"""
		return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: Self.world)
	}

	// umbrelOS keeps its dashboard token in localStorage, which only a page on that
	// origin can write. This hands it over once per origin and login: if umbrelOS
	// later discards the token, it is never put back.
	private var tokenScript: WKUserScript? {
		guard let session else { return nil }
		let origins = hosts.map { "https://\($0)" }
		guard let originsJSON = try? String(decoding: JSONEncoder().encode(origins), as: UTF8.self),
			let tokenJSON = try? String(decoding: JSONEncoder().encode(session.dashboardToken), as: UTF8.self)
		else { return nil }
		let source = """
			(() => {
				if (!\(originsJSON).includes(location.origin)) return
				try {
					if (localStorage.getItem('umbrel-app-session') === '\(session.fingerprint)') return
					localStorage.setItem('umbrel-app-session', '\(session.fingerprint)')
					localStorage.setItem('\(Umbreld.BrowserSession.tokenStorageKey)', \(tokenJSON))
				} catch {}
			})()
			"""
		return WKUserScript(
			source: source,
			injectionTime: .atDocumentStart,
			forMainFrameOnly: true,
			in: Self.world)
	}

	// A page keeps the scripts it was made with. When the session changes (signed in
	// again on umbrelOS's own page, or ended), each open page gets the new session's
	// token script in place of its old one, or none, so its next reload never puts
	// an old token back. WebKit can only remove every script, so the page's others
	// are put back after it.
	private func replaceTokenScripts() {
		openWebViews.removeAll { $0.webView == nil }
		for index in openWebViews.indices {
			guard let controller = openWebViews[index].webView?.configuration.userContentController else { continue }
			let previous = openWebViews[index].tokenScript
			let others = controller.userScripts.filter { $0 !== previous }
			let current = tokenScript
			controller.removeAllUserScripts()
			if let current { controller.addUserScript(current) }
			others.forEach(controller.addUserScript)
			openWebViews[index].tokenScript = current
		}
	}

	// ── Session ──

	// Gives the web view the session's cookies for the address about to be opened.
	// umbrelOS only accepts a token and a cookie from the same session, so cookies left
	// by another session are replaced, but only while umbrelOS still accepts this one:
	// the other may be a sign-in made on one of umbrelOS's own pages after this ended.
	func prepare(for url: URL) async {
		guard let current = session, let host = url.host(), isUmbrel(url) else { return }
		let store = dataStore.httpCookieStore
		let existing = await store.allCookies()
			.filter { Self.normalized($0.domain) == Self.normalized(host) && $0.path == "/" }
		let replacesAnother = current.cookies(forHost: host).contains { cookie in
			existing.contains { $0.name == cookie.name && $0.value != cookie.value }
		}
		if replacesAnother { await validateSession(force: true) }
		guard let session else { return }
		for cookie in session.cookies(forHost: host)
		where !existing.contains(where: { $0.name == cookie.name && $0.value == cookie.value }) {
			await store.setCookie(cookie)
		}
	}

	// Signing in on umbrelOS's own login page (or finishing setup there) creates a
	// perfectly good session. Keep it, so the next address doesn't ask again, but only
	// once umbrelOS confirms it belongs to this account. The login page offers every
	// account on the Umbrel, and the app goes on to give this session to every address.
	func adoptSession(from webView: WKWebView) async {
		guard isDashboard(webView.url), let host = webView.url?.host() else { return }
		let key = Umbreld.BrowserSession.tokenStorageKey
		let token = try? await webView.callAsyncJavaScript(
			"return localStorage.getItem(key)",
			arguments: ["key": key],
			in: nil,
			contentWorld: Self.world) as? String
		guard let token, !token.isEmpty else {
			// umbrelOS dropped the token it was given: find out whether the session ended.
			if session != nil { Task { await validateSession(force: true) } }
			return
		}
		guard token != session?.dashboardToken else { return }
		let cookies = await dataStore.httpCookieStore.allCookies()
			.filter { Self.normalized($0.domain) == Self.normalized(host) }
		guard let browserCookie = cookies.first(where: { $0.name == Umbreld.BrowserSession.browserCookieName })
		else { return }
		let adopted = Umbreld.BrowserSession(
			deviceId: deviceId,
			accountId: accountId,
			dashboardToken: token,
			browserCookie: browserCookie.value,
			appCookie: cookies.first { $0.name == Umbreld.BrowserSession.appCookieName }?.value)
		guard await Umbreld.browserSessionAccountId(target: target, session: adopted) == accountId,
			// The app may have signed out of this account while umbrelOS was asked.
			Keychain.readSession(deviceId: deviceId).session?.accountId == accountId
		else { return }
		session = adopted
		Keychain.setBrowserSession(adopted)
		// The page that produced this session already holds it, if it is still there.
		_ = try? await webView.callAsyncJavaScript(
			"if (localStorage.getItem(key) === token) localStorage.setItem('umbrel-app-session', fingerprint)",
			arguments: ["key": key, "token": token, "fingerprint": adopted.fingerprint],
			in: nil,
			contentWorld: Self.world)
	}

	// umbrelOS sessions last a week from their last use. Renewing on the app's behalf
	// keeps the browser signed in for people who mostly use the native screens, and
	// tells us when the session has ended so a dead one is never handed to a page.
	func validateSession(target: Umbreld.Target, force: Bool = false) async {
		guard let current = session else { return }
		let key = "browser-session-validated:\(deviceId)"
		let last = UserDefaults.standard.double(forKey: key)
		guard force || Date().timeIntervalSince1970 - last > 12 * 60 * 60 else { return }
		switch await Umbreld.renewBrowserSession(target: target, session: current) {
		case .valid:
			UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: key)
		case .invalid:
			guard session == current else { return }
			session = nil
			Keychain.deleteBrowserSession(deviceId: deviceId)
		case .unknown:
			break
		}
	}

	private var target: Umbreld.Target { Umbreld.Target(deviceId: deviceId, hosts: Array(hosts)) }

	private func validateSession(force: Bool) async {
		await validateSession(target: target, force: force)
	}

	// ── Lifecycle ──

	// Called with the password the user just typed into the native sign-in form, so
	// they are never asked for it again by a web page. Best-effort: without it the
	// browser simply shows umbrelOS's own login page once.
	static func signIn(
		target: Umbreld.Target,
		userId: String,
		password: String,
		totpToken: String?
	) async {
		// Ends any previous browser session for this Umbrel rather than leaving it live
		// on the server once its Keychain entry is replaced.
		await signOut(target: target, accountId: userId)
		guard let session = try? await Umbreld.loginBrowser(
			target: target, userId: userId, password: password, totpToken: totpToken)
		else { return }
		Keychain.setBrowserSession(session)
		UserDefaults.standard.set(
			Date().timeIntervalSince1970, forKey: "browser-session-validated:\(target.deviceId)")
	}

	// Forgets the session and everything its web pages stored. The server-side
	// session is ended on a best-effort basis; it expires on its own regardless.
	static func signOut(target: Umbreld.Target, accountId: String?) async {
		let session = Keychain.readBrowserSession(deviceId: target.deviceId)
		Keychain.deleteBrowserSession(deviceId: target.deviceId)
		if let accountId { await clear(deviceId: target.deviceId, accountId: accountId) }
		if let session { try? await Umbreld.logoutBrowser(target: target, session: session) }
	}

	private static func clear(deviceId: String, accountId: String) async {
		let store = WKWebsiteDataStore(forIdentifier: dataStoreId(deviceId: deviceId, accountId: accountId))
		await store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)
	}

	// Data stores outlive the accounts they were made for (a removed Umbrel, a
	// reinstalled app's leftover container). Keep only the ones still signed in.
	static func removeOrphanedData(keeping accounts: [(deviceId: String, accountId: String)]) async {
		let keep = Set(accounts.map { dataStoreId(deviceId: $0.deviceId, accountId: $0.accountId) })
		// WebKit's bookkeeping only exists once a data store does; asking for the
		// identifiers before then crashes inside WebKit.
		_ = WKWebsiteDataStore.default()
		for identifier in await WKWebsiteDataStore.allDataStoreIdentifiers where !keep.contains(identifier) {
			try? await WKWebsiteDataStore.remove(forIdentifier: identifier)
		}
	}

	static func dataStoreId(deviceId: String, accountId: String) -> UUID {
		let digest = Array(SHA256.hash(data: Data("umbrel-browser:\(deviceId):\(accountId)".utf8)).prefix(16))
		return UUID(uuid: (
			digest[0], digest[1], digest[2], digest[3], digest[4], digest[5], digest[6], digest[7],
			digest[8], digest[9], digest[10], digest[11], digest[12], digest[13], digest[14], digest[15]
		))
	}

	private static func normalized(_ host: String) -> String {
		(host.hasSuffix(".") ? String(host.dropLast()) : host).lowercased()
	}

	private static var appVersion: String {
		Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
	}
}

private extension WKWebView {
	// WebKit puts a bar of previous, next and done buttons above the keyboard for every
	// field, and shows it on its own when a hardware keyboard is attached. It makes a
	// page look like a web form, and it pushes the page up to make room for itself.
	// The bar belongs to WebKit's private content view, so that view is given a
	// subclass that has none. If WebKit's internals change, the bar simply stays.
	func removeFormAccessoryBar() {
		guard let content = scrollView.subviews.first(where: { String(describing: type(of: $0)).hasPrefix("WKContent") }),
			let contentClass: AnyClass = object_getClass(content)
		else { return }
		let name = "\(NSStringFromClass(contentClass))_UmbrelNoAccessory"
		if let existing = NSClassFromString(name) {
			object_setClass(content, existing)
			return
		}
		guard let subclass = objc_allocateClassPair(contentClass, name, 0),
			let method = class_getInstanceMethod(UIView.self, #selector(getter: UIResponder.inputAccessoryView))
		else { return }
		let none: @convention(block) (AnyObject) -> UIView? = { _ in nil }
		class_addMethod(subclass, #selector(getter: UIResponder.inputAccessoryView), imp_implementationWithBlock(none), method_getTypeEncoding(method))
		objc_registerClassPair(subclass)
		object_setClass(content, subclass)
	}
}
