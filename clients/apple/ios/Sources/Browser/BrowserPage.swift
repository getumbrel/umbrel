import Observation
import SwiftUI
import UmbrelKit
import WebKit

// One open web page: umbrelOS itself, or an app running on the Umbrel. Pages stay
// alive after the browser closes, so returning to an app picks up where it was left.
@MainActor
@Observable
final class BrowserPage: NSObject, Identifiable {
	struct Identity: Equatable {
		var name: String
		var iconURL: URL?
		// umbrelOS itself is drawn with the Umbrel mark rather than an app icon.
		var isUmbrel: Bool
	}

	struct Failure: Equatable {
		var title: String
		var message: String
	}

	enum Dialog: Identifiable {
		case alert(String, () -> Void)
		case confirm(String, (Bool) -> Void)
		case prompt(String, String, (String?) -> Void)
		case credentials(String, (URLCredential?) -> Void)

		var id: String {
			switch self {
			case .alert: "alert"
			case .confirm: "confirm"
			case .prompt: "prompt"
			case .credentials: "credentials"
			}
		}
	}

	let id = UUID()
	// Pages are pooled by origin: one per app, one for umbrelOS.
	let origin: String
	private(set) var identity: Identity
	@ObservationIgnored let webView: WKWebView
	@ObservationIgnored private let context: BrowserContext

	private(set) var progress: Double = 0
	private(set) var isLoading = false
	private(set) var canGoBack = false
	private(set) var canGoForward = false
	private(set) var currentURL: URL?
	// The page actually on screen. During a load, currentURL (the web view's url) is
	// already the address being loaded while the previous page is still showing, so this
	// only changes when a load commits or the page changes its own address in place.
	private(set) var shownURL: URL?
	// Whether the page has drawn something worth showing instead of the launch screen.
	private(set) var isRevealed = false
	private(set) var failure: Failure?
	private(set) var barColor: UIColor?
	private(set) var pageColor: UIColor?
	var dialog: Dialog?
	// Another website someone tapped through to, for the view to open in Safari's in-app
	// view.
	var externalURL: URL?
	// Set from the start of a main-page load until it commits or fails. WebKit hands
	// redirects that follow a tap to the policy check as the tap again.
	@ObservationIgnored private var isLoadingMainFrame = false
	// Who the current dialog is from, shown as its title.
	private(set) var dialogTitle = ""
	var downloadedFile: URL?

	// Links that leave this page for another one on the Umbrel (umbrelOS launching an
	// app, an app linking to another).
	@ObservationIgnored var onOpenUmbrelURL: (URL) -> Void = { _ in }
	// Fired for every main-frame location change, including in-page routing.
	@ObservationIgnored var onLocationChange: (URL) -> Void = { _ in }

	@ObservationIgnored private var observations: [NSKeyValueObservation] = []
	@ObservationIgnored private var revealTask: Task<Void, Never>?
	@ObservationIgnored private var requestedURL: URL?
	@ObservationIgnored private var settleDeadline: ContinuousClock.Instant?
	private static let settleInterval: Duration = .milliseconds(300)
	@ObservationIgnored private var downloadDestinations: [ObjectIdentifier: URL] = [:]
	// Set when the app refuses a connection because the Umbrel's identity doesn't
	// match. WebKit reports that load as cancelled, which is otherwise ignored.
	@ObservationIgnored private var refusal: Refusal?

	private enum Refusal {
		case untrusted
		// The server presented a different certificate authority, as it does after the
		// Umbrel or its certificate is reset.
		case differentIdentity
	}

	// umbrelOS shown in place, on the app's wallpaper, instead of as a page of its own.
	let isSeeThrough: Bool

	init(origin: String, identity: Identity, context: BrowserContext, seeThrough: Bool = false) {
		self.origin = origin
		self.identity = identity
		self.context = context
		isSeeThrough = seeThrough
		webView = context.makeWebView(seeThrough: seeThrough)
		super.init()
		webView.navigationDelegate = self
		webView.uiDelegate = self
		observations = [
			webView.observe(\.estimatedProgress) { [weak self] view, _ in
				MainActor.assumeIsolated { self?.progress = view.estimatedProgress }
			},
			webView.observe(\.isLoading) { [weak self] view, _ in
				MainActor.assumeIsolated { self?.isLoading = view.isLoading }
			},
			webView.observe(\.canGoBack) { [weak self] view, _ in
				MainActor.assumeIsolated { self?.canGoBack = view.canGoBack }
			},
			webView.observe(\.canGoForward) { [weak self] view, _ in
				MainActor.assumeIsolated { self?.canGoForward = view.canGoForward }
			},
			webView.observe(\.url) { [weak self] view, _ in
				MainActor.assumeIsolated {
					guard let self, let url = view.url else { return }
					// A page changing its own address (pushState, a fragment) can't change
					// origin. Anything else waits for didCommit.
					if let shown = self.shownURL, Self.origin(of: shown) == Self.origin(of: url), shown != url {
						self.shownURL = url
					}
					guard url != self.currentURL else { return }
					self.currentURL = url
					self.onLocationChange(url)
				}
			},
			webView.observe(\.themeColor) { [weak self] _, _ in
				MainActor.assumeIsolated { self?.updateBarColor() }
			},
			webView.observe(\.underPageBackgroundColor) { [weak self] _, _ in
				MainActor.assumeIsolated { self?.updateBarColor() }
			},
		]
	}

	// Reports what is typed into password fields, for first-time setup only: the
	// password the user chooses on umbrelOS's own form is the one this app then signs
	// in with, so they are not asked to type it a third time. It is delivered to the
	// caller and never stored here. Must be called before the first load.
	func observePasswordEntry(_ handler: @escaping (String) -> Void) {
		let world = WKContentWorld.world(name: "umbrel-setup")
		let controller = webView.configuration.userContentController
		controller.add(PasswordEntryHandler(handler), contentWorld: world, name: "passwordEntry")
		controller.addUserScript(
			WKUserScript(
				source: """
					(() => {
						// Fields can switch to plain text while "show password" is on.
						const fields = new WeakSet()
						document.addEventListener('input', (event) => {
							const field = event.target
							if (!(field instanceof HTMLInputElement)) return
							if (field.type === 'password') fields.add(field)
							if (!fields.has(field) || !field.value) return
							webkit.messageHandlers.passwordEntry.postMessage(field.value)
						}, true)
					})()
					""",
				injectionTime: .atDocumentStart,
				forMainFrameOnly: true,
				in: world))
	}

	// Lets the page run edge to edge, under the status bar and the home indicator,
	// while its content keeps clear of them. The page is not asked to know about the
	// device: its root is padded and its viewport units shortened to match, so whatever
	// it pins to the window (a wallpaper) fills the screen and whatever it lays out
	// (a card sized to the viewport) lands inside the safe area. Must be called before
	// the first load.
	func fillScreen(keepingClear insets: UIEdgeInsets) {
		webView.setMinimumViewportInset(insets, maximumViewportInset: insets)
		// What shows beneath the page when the keyboard lifts it; not a sampled color.
		webView.underPageBackgroundColor = .black
		webView.configuration.userContentController.addUserScript(
			WKUserScript(
				source: """
					(() => {
						const style = document.createElement('style')
						style.textContent = 'html { box-sizing: border-box !important; padding: \(Int(insets.top))px 0 \(Int(insets.bottom))px !important; }'
						document.documentElement.appendChild(style)
					})()
					""",
				injectionTime: .atDocumentStart,
				forMainFrameOnly: true,
				in: .world(name: "umbrel-setup")))
	}

	func update(identity: Identity) {
		if self.identity != identity { self.identity = identity }
	}

	// Shows a location. Resuming leaves a page that is already open on this address
	// exactly where it was, wherever inside the app the user had got to; otherwise
	// the page goes to the location unless it is already there.
	func open(_ url: URL, resuming: Bool) {
		if let currentURL, failure == nil {
			if resuming, Self.origin(of: currentURL) == Self.origin(of: url) { return }
			if Self.isSameLocation(currentURL, url) { return }
			if isSeeThrough, isRevealed, Self.origin(of: currentURL) == Self.origin(of: url) {
				navigateInPage(to: url)
				return
			}
		}
		load(url)
	}

	// umbrelOS is a single-page app that is already running. Going somewhere else in
	// it is a history entry and the standard event every router listens for, not a
	// reload, so its own interface animates to the new place.
	private func navigateInPage(to url: URL) {
		var target = url.path().isEmpty ? "/" : url.path()
		if let query = url.query() { target += "?\(query)" }
		webView.callAsyncJavaScript(
			"history.pushState(null, '', target); dispatchEvent(new PopStateEvent('popstate', {state: null}))",
			arguments: ["target": target],
			in: nil,
			in: .page
		) { [weak self] result in
			// A page that can't do this is in no state to be navigated; load instead.
			guard let self, case .failure = result else { return }
			self.load(url)
		}
	}

	func reload() {
		failure = nil
		if webView.url != nil {
			webView.reload()
		} else if let requestedURL {
			load(requestedURL)
		}
	}

	func goBack() { webView.goBack() }
	func goForward() { webView.goForward() }

	private func load(_ url: URL) {
		requestedURL = url
		failure = nil
		// A different location starts from the launch screen, never the previous page.
		revealTask?.cancel()
		settleDeadline = nil
		isRevealed = false
		Task {
			await context.prepare(for: url)
			webView.load(URLRequest(url: url))
		}
	}

	// The address of a page that has ended up off the Umbrel (a sign-in, a redirect), shown
	// in place of the app's name so another site never looks like the app.
	var outsideHost: String? {
		guard let shownURL, Self.isWebAddress(shownURL), !context.isUmbrel(shownURL) else { return nil }
		return shownURL.host()
	}

	private static func isWebAddress(_ url: URL) -> Bool {
		["http", "https"].contains(url.scheme?.lowercased() ?? "")
	}

	// A sign-in link to another site names where to send someone back to afterwards in
	// its redirect_uri (OAuth). Coming back to the Umbrel makes it part of an app's own
	// sign-in.
	private func returnsToUmbrel(_ url: URL) -> Bool {
		let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
		return items.contains { $0.name == "redirect_uri" && context.isUmbrel($0.value.flatMap(URL.init(string:))) }
	}

	private static func origin(of url: URL) -> String {
		"\(url.scheme ?? "")://\(url.host() ?? ""):\(url.port ?? 0)"
	}

	// A location is the same when only the fragment differs.
	private static func isSameLocation(_ lhs: URL, _ rhs: URL) -> Bool {
		func key(_ url: URL) -> String {
			var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
			components?.fragment = nil
			let string = components?.string ?? url.absoluteString
			return string.hasSuffix("/") ? String(string.dropLast()) : string
		}
		return key(lhs) == key(rhs)
	}

	private func updateBarColor() {
		barColor = webView.themeColor ?? webView.underPageBackgroundColor
		// A page still changing its colors (a dark theme arriving after a light
		// default) isn't ready to be seen. Hold the launch screen a little longer,
		// within a fixed limit from when the load finished.
		if !isRevealed, let settleDeadline, ContinuousClock.now + Self.settleInterval < settleDeadline {
			reveal(after: Self.settleInterval)
		}
		pageColor = webView.underPageBackgroundColor
	}

	private func reveal(after delay: Duration = .zero) {
		guard !isRevealed else { return }
		revealTask?.cancel()
		revealTask = Task { [weak self] in
			try? await Task.sleep(for: delay)
			guard !Task.isCancelled else { return }
			self?.isRevealed = true
		}
	}

	private func fail(_ error: Error) {
		let error = error as NSError
		let refused = refusal
		refusal = nil
		// Cancellations are the page changing its mind (a redirect, a download taking
		// over, the user tapping again), not something to report. A connection the app
		// refused looks the same, and is reported.
		guard refused != nil
			|| (error.code != NSURLErrorCancelled
				&& !(error.domain == "WebKitErrorDomain" && (error.code == 102 || error.code == 204)))
		else { return }
		revealTask?.cancel()
		let name = identity.name
		switch (error.domain, error.code) {
		case _ where refused == .differentIdentity:
			failure = notRecognized
		case _ where refused != nil,
			(NSURLErrorDomain, NSURLErrorServerCertificateUntrusted),
			(NSURLErrorDomain, NSURLErrorServerCertificateHasUnknownRoot),
			(NSURLErrorDomain, NSURLErrorSecureConnectionFailed):
			failure = Failure(
				title: "Can’t Open \(name) Securely",
				message: "This iPhone couldn’t verify a secure connection to your Umbrel.")
		default:
			failure = Failure(
				title: "Can’t Open \(name)",
				message: identity.isUmbrel
					? "Make sure your Umbrel is turned on and this iPhone can reach it."
					: "The app may still be starting. Give it a moment, then try again.")
		}
	}

	// Whether a host and port are where the page itself was loaded from.
	private static func isAddress(of url: URL?, host: String, port: Int) -> Bool {
		guard let url, let pageHost = url.host() else { return false }
		return pageHost.caseInsensitiveCompare(host) == .orderedSame && (url.port ?? 443) == port
	}

	private var notRecognized: Failure {
		Failure(title: IdentityChange.alertTitle, message: IdentityChange.blockedMessage)
	}
}

// ── Navigation ──

extension BrowserPage: WKNavigationDelegate {
	func webView(
		_ webView: WKWebView,
		decidePolicyFor navigationAction: WKNavigationAction,
		preferences: WKWebpagePreferences
	) async -> (WKNavigationActionPolicy, WKWebpagePreferences) {
		guard let url = navigationAction.request.url else { return (.cancel, preferences) }
		if navigationAction.targetFrame?.isMainFrame == true { refusal = nil }
		if navigationAction.shouldPerformDownload { return (.download, preferences) }
		// Apple's guidance: the app's own web content in a web view, other websites in
		// Safari's in-app view, which shows their real address and Safari's protections.
		// So a link someone taps on the Umbrel to another site opens there. Redirects
		// during a load stay in the page (WebKit reports them as the tap that started it),
		// as do links on another site's page and sign-in links that come back to the
		// Umbrel, because a sign-in has to finish in the page that started it. Any page
		// that ends up off the Umbrel shows its own address in the title bar.
		if navigationAction.navigationType == .linkActivated, navigationAction.targetFrame?.isMainFrame == true,
			!isLoadingMainFrame, context.isUmbrel(webView.url),
			Self.isWebAddress(url), !context.isUmbrel(url), !returnsToUmbrel(url)
		{
			externalURL = url
			return (.cancel, preferences)
		}
		switch url.scheme?.lowercased() {
		case "http" where navigationAction.targetFrame?.isMainFrame == true && context.isUmbrel(url):
			// Over plain HTTP the Umbrel would be signed out and ask for a password in
			// the clear, with no address bar to warn anyone.
			load(context.secureURL(for: url))
			return (.cancel, preferences)
		case "http", "https", "about", "blob", "data":
			return (.allow, preferences)
		default:
			// Mail, phone, App Store, and other apps' links belong to the system. A tapped
			// link opens straight away; a page sending someone to another app any other
			// way asks first, the way Safari does.
			if navigationAction.targetFrame?.isMainFrame != false {
				var approved = navigationAction.navigationType == .linkActivated
				if !approved {
					approved = await withCheckedContinuation { continuation in
						present(
							.confirm("This page wants to open another app.") { continuation.resume(returning: $0) },
							from: asker(navigationAction.targetFrame?.securityOrigin))
					}
				}
				if approved { await UIApplication.shared.open(url) }
			}
			return (.cancel, preferences)
		}
	}

	func webView(
		_ webView: WKWebView,
		decidePolicyFor navigationResponse: WKNavigationResponse
	) async -> WKNavigationResponsePolicy {
		if let response = navigationResponse.response as? HTTPURLResponse,
			let disposition = response.value(forHTTPHeaderField: "Content-Disposition"),
			disposition.lowercased().hasPrefix("attachment")
		{
			return .download
		}
		return navigationResponse.canShowMIMEType ? .allow : .download
	}

	func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
		isLoadingMainFrame = true
	}

	func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
		isLoadingMainFrame = false
		if shownURL != webView.url { shownURL = webView.url }
		failure = nil
		// The launch screen normally lifts when the page finishes loading. This is the
		// limit on how long a slow page can keep it up once bytes are arriving.
		reveal(after: .seconds(3))
	}

	func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
		// Web apps tend to paint a bare document first and their real interface a
		// moment later. Lifting the launch screen on that first paint shows a flash of
		// the wrong page, so wait for the load to finish and for its colors to settle.
		settleDeadline = .now + .milliseconds(1500)
		reveal(after: Self.settleInterval)
		Task { await context.adoptSession(from: webView) }
	}

	func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
		isLoadingMainFrame = false
		fail(error)
	}

	func webView(
		_ webView: WKWebView,
		didFailProvisionalNavigation navigation: WKNavigation!,
		withError error: Error
	) {
		isLoadingMainFrame = false
		fail(error)
	}

	func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
		// iOS reclaims the memory of pages left in the background. Bring it back the
		// next time it is looked at rather than showing a blank page.
		isRevealed = false
		reload()
	}

	func webView(
		_ webView: WKWebView,
		respondTo challenge: URLAuthenticationChallenge
	) async -> (URLSession.AuthChallengeDisposition, URLCredential?) {
		let space = challenge.protectionSpace
		switch space.authenticationMethod {
		case NSURLAuthenticationMethodServerTrust:
			let url = URL(string: "https://\(space.host)")
			guard context.isUmbrel(url) else { return (.performDefaultHandling, nil) }
			// The Umbrel is trusted through its own pinned CA and nothing else. If that
			// doesn't hold, fail closed rather than fall back to the system's roots.
			guard let credential = Umbreld.localHTTPSCredential(for: challenge, deviceId: context.deviceId)
			else {
				let differs = Umbreld.localHTTPSIdentityDiffers(for: challenge, deviceId: context.deviceId)
				refusal = differs ? .differentIdentity : .untrusted
				// A page that is already showing also asks the Umbrel for things in the
				// background (umbrelOS waiting out a reset, say), and those failing doesn't
				// fail the page. Its own address no longer being this Umbrel is final, so
				// say so. Another port or address may be something else entirely.
				if differs, Self.isAddress(of: webView.url, host: space.host, port: space.port) {
					revealTask?.cancel()
					failure = notRecognized
				}
				return (.cancelAuthenticationChallenge, nil)
			}
			return (.useCredential, credential)
		case NSURLAuthenticationMethodHTTPBasic, NSURLAuthenticationMethodHTTPDigest:
			guard challenge.previousFailureCount < 3 else { return (.cancelAuthenticationChallenge, nil) }
			let credential = await withCheckedContinuation { continuation in
				// Named by who's asking, not by the realm the server chose, so a page can't
				// pose as something else ("your Umbrel") to collect a password.
				let asker = asker(scheme: space.protocol ?? "https", host: space.host, port: space.port)
				present(.credentials(asker) { continuation.resume(returning: $0) }, from: asker)
			}
			return credential.map { (.useCredential, $0) } ?? (.cancelAuthenticationChallenge, nil)
		default:
			return (.performDefaultHandling, nil)
		}
	}

	func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
		download.delegate = self
	}

	func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
		download.delegate = self
	}
}

// ── Windows, dialogs, permissions ──

extension BrowserPage: WKUIDelegate {
	// Pages ask for a new window with target="_blank" or window.open. There is one
	// window here, so route the request to where it belongs instead of dropping it.
	func webView(
		_ webView: WKWebView,
		createWebViewWith configuration: WKWebViewConfiguration,
		for navigationAction: WKNavigationAction,
		windowFeatures: WKWindowFeatures
	) -> WKWebView? {
		guard let url = navigationAction.request.url, url.scheme != "about" else { return nil }
		if context.isUmbrel(url) {
			onOpenUmbrelURL(url)
		} else if Self.isWebAddress(url) {
			externalURL = url
		} else {
			UIApplication.shared.open(url)
		}
		return nil
	}

	func webView(
		_ webView: WKWebView,
		runJavaScriptAlertPanelWithMessage message: String,
		initiatedByFrame frame: WKFrameInfo
	) async {
		await withCheckedContinuation { continuation in
			present(.alert(message) { continuation.resume() }, from: asker(frame.securityOrigin))
		}
	}

	func webView(
		_ webView: WKWebView,
		runJavaScriptConfirmPanelWithMessage message: String,
		initiatedByFrame frame: WKFrameInfo
	) async -> Bool {
		await withCheckedContinuation { continuation in
			present(.confirm(message) { continuation.resume(returning: $0) }, from: asker(frame.securityOrigin))
		}
	}

	func webView(
		_ webView: WKWebView,
		runJavaScriptTextInputPanelWithPrompt prompt: String,
		defaultText: String?,
		initiatedByFrame frame: WKFrameInfo
	) async -> String? {
		await withCheckedContinuation { continuation in
			present(.prompt(prompt, defaultText ?? "") { continuation.resume(returning: $0) }, from: asker(frame.securityOrigin))
		}
	}

	// A dialog nobody can see must still be answered, or the page hangs forever.
	private func present(_ next: Dialog, from asker: String) {
		if let pending = dialog { Self.dismiss(pending) }
		dialogTitle = asker
		dialog = next
	}

	// Who a dialog is from. On this page's own origin that's the page's name. Anything
	// else (an embedded page, a site the page moved to) is named by its address, so it
	// can't speak as the app.
	private func asker(scheme: String, host: String, port: Int) -> String {
		let scheme = scheme.lowercased()
		let host = host.lowercased()
		let defaultPort = scheme == "https" ? 443 : 80
		let port = port == 0 ? defaultPort : port
		if let home = requestedURL, home.scheme?.lowercased() == scheme, home.host()?.lowercased() == host,
			(home.port ?? defaultPort) == port
		{
			return identity.name
		}
		// A sandboxed or data: page has no address to show, and isn't the app either.
		guard !host.isEmpty else { return "Unknown Page" }
		return port == defaultPort ? host : "\(host):\(port)"
	}

	private func asker(_ origin: WKSecurityOrigin?) -> String {
		guard let origin else { return identity.name }
		return asker(scheme: origin.protocol, host: origin.host, port: origin.port)
	}

	static func dismiss(_ dialog: Dialog) {
		switch dialog {
		case .alert(_, let done): done()
		case .confirm(_, let done): done(false)
		case .prompt(_, _, let done): done(nil)
		case .credentials(_, let done): done(nil)
		}
	}
}

// ── Downloads ──

extension BrowserPage: WKDownloadDelegate {
	func download(
		_ download: WKDownload,
		decideDestinationUsing response: URLResponse,
		suggestedFilename: String
	) async -> URL? {
		let directory = FileManager.default.temporaryDirectory
			.appending(path: "Downloads/\(UUID().uuidString)", directoryHint: .isDirectory)
		try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
		let destination = directory.appending(path: suggestedFilename)
		downloadDestinations[ObjectIdentifier(download)] = destination
		return destination
	}

	func downloadDidFinish(_ download: WKDownload) {
		downloadedFile = downloadDestinations.removeValue(forKey: ObjectIdentifier(download))
	}

	func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
		downloadDestinations[ObjectIdentifier(download)] = nil
	}
}

private final class PasswordEntryHandler: NSObject, WKScriptMessageHandler {
	private let handler: (String) -> Void

	init(_ handler: @escaping (String) -> Void) {
		self.handler = handler
	}

	func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
		guard message.frameInfo.isMainFrame, let value = message.body as? String else { return }
		handler(value)
	}
}
