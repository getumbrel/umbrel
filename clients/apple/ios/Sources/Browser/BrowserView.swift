import SafariServices
import SwiftUI
import UIKit
import UmbrelKit
import WebKit

// The browser's whole interface: a slim title bar that takes on the page's own
// color, and the page. No address bar, no tabs: this is the Umbrel, not the web.
struct BrowserView: View {
	static let barHeight: CGFloat = 50

	let browser: Browser

	var body: some View {
		ZStack {
			Color.black.ignoresSafeArea()
			if let page = browser.page {
				BrowserPageView(
					page: page,
					onClose: { browser.close() },
					onOpenInSafari: {
						Task {
							guard let url = await browser.safariURL(for: page) else { return }
							await UIApplication.shared.open(url)
						}
					},
					onStatusBarChange: { browser.prefersLightStatusBar = $0 }
				)
				.id(page.id)
				.transition(.opacity)
			}
		}
		.preferredColorScheme(.dark)
	}
}

// One page with its title bar. Shared by the main browser and by first-time setup,
// which shows umbrelOS before there is an account to browse as. Setup is immersive:
// the page fills the screen and the bar's two controls float over it as glass.
struct BrowserPageView: View {
	@Bindable var page: BrowserPage
	var isImmersive = false
	var onClose: () -> Void
	var onOpenInSafari: (() -> Void)?
	var onStatusBarChange: (_ prefersLight: Bool) -> Void = { _ in }

	@Environment(\.brandColor) private var brandColor
	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	@State private var promptText = ""
	@State private var username = ""
	@State private var password = ""

	// Until the page has painted, the chrome stays black like the launch screen.
	private var barColor: Color {
		guard page.isRevealed, page.failure == nil, let color = page.barColor else { return .black }
		return Color(uiColor: color)
	}

	private var pageColor: Color {
		guard page.isRevealed, page.failure == nil, let color = page.pageColor else { return .black }
		return Color(uiColor: color)
	}

	private var foreground: Color { barIsLight ? .black : .white }

	private var barIsLight: Bool {
		guard page.isRevealed, page.failure == nil, let color = page.barColor else { return false }
		return color.isLight
	}

	var body: some View {
		layout
			.animation(.easeInOut(duration: 0.25), value: barColor)
			.animation(.easeInOut(duration: 0.25), value: pageColor)
			.onChange(of: barIsLight, initial: true) { _, isLight in
				onStatusBarChange(!isLight)
			}
			.alert(
				page.dialogTitle,
				isPresented: dialogBinding,
				presenting: page.dialog
			) { dialog in
				dialogActions(dialog)
			} message: { dialog in
				Text(dialogMessage(dialog))
			}
			.sheet(
				isPresented: Binding(
					get: { page.downloadedFile != nil },
					set: { if !$0 { page.downloadedFile = nil } }
				)
			) {
				if let file = page.downloadedFile {
					ActivitySheet(items: [file])
						.presentationDetents([.medium, .large])
				}
			}
			.onChange(of: page.externalURL) { _, url in
				guard let url else { return }
				page.externalURL = nil
				presentSafariView(url)
			}
	}

	@ViewBuilder
	private var layout: some View {
		if isImmersive {
			ZStack(alignment: .top) {
				content.ignoresSafeArea()
				floatingControls
			}
			.background(Color.black.ignoresSafeArea())
		} else {
			VStack(spacing: 0) {
				bar
				content
			}
			// The bar's color runs up behind the status bar; the page's own background
			// runs down behind the home indicator, so the page looks edge to edge.
			.background {
				VStack(spacing: 0) {
					barColor
					pageColor
				}
				.ignoresSafeArea()
			}
		}
	}

	private var content: some View {
		ZStack {
			BrowserWebView(webView: page.webView)
				.opacity(page.isRevealed && page.failure == nil ? 1 : 0)
			if let failure = page.failure {
				failureView(failure)
					.transition(.opacity)
			} else if !page.isRevealed {
				LaunchScreen(identity: page.identity)
					.transition(.opacity)
			}
		}
		.animation(reduceMotion ? nil : .easeOut(duration: 0.3), value: page.isRevealed)
		.animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: page.failure)
	}

	// The bar's controls on their own, as glass, tucked into the top corners of the
	// card umbrelOS floats 20 points in from the edges of its window.
	private var floatingControls: some View {
		HStack {
			menu
			Spacer(minLength: 0)
			barButton("xmark", label: "Close", action: onClose)
		}
		.padding(.horizontal, 28)
		.padding(.top, 28)
	}

	// ── Title bar ──

	private var bar: some View {
		ZStack {
			title
			HStack(spacing: 8) {
				menu
				Spacer(minLength: 0)
				barButton("xmark", label: "Close", action: onClose)
			}
		}
		.padding(.horizontal, 12)
		.frame(height: BrowserView.barHeight)
		.overlay(alignment: .bottom) { progressLine }
		// The whole bar, not just its controls, is the handle for dragging the page away.
		.contentShape(Rectangle())
	}

	private var title: some View {
		HStack(spacing: 8) {
			if let host = page.outsideHost {
				Image(systemName: "globe")
					.font(.system(size: 15, weight: .medium))
					.frame(width: 20, height: 20)
			} else if page.identity.isUmbrel {
				Image("UmbrelMark")
					.resizable()
					.renderingMode(.template)
					.scaledToFit()
					.frame(width: 20, height: 20)
			} else {
				AppIconView(url: page.identity.iconURL, size: 24, corner: 6)
			}
			Text(page.outsideHost ?? page.identity.name)
				.font(.subheadline.weight(.semibold))
				.lineLimit(1)
		}
		.foregroundStyle(foreground)
		.padding(.horizontal, 52)
		.accessibilityElement(children: .combine)
		.accessibilityAddTraits(.isHeader)
	}

	private func barButton(_ symbol: String, label: LocalizedStringKey, action: @escaping () -> Void) -> some View {
		Button(action: action) {
			barGlyph(symbol)
		}
		.buttonStyle(.plain)
		.accessibilityLabel(label)
	}

	@ViewBuilder
	private func barGlyph(_ symbol: String) -> some View {
		if isImmersive {
			Image(systemName: symbol)
				.font(.system(size: 15, weight: .semibold))
				.foregroundStyle(.white)
				.frame(width: 40, height: 40)
				.glassControl(in: Circle())
				.frame(width: 44, height: 44)
				.contentShape(Rectangle())
		} else {
			Image(systemName: symbol)
				.font(.system(size: 15, weight: .semibold))
				.foregroundStyle(foreground.opacity(0.9))
				.frame(width: 34, height: 34)
				.background(foreground.opacity(0.12), in: Circle())
				.frame(width: 44, height: 44)
				.contentShape(Rectangle())
		}
	}

	private var menu: some View {
		Menu {
			if page.canGoBack {
				Button { page.goBack() } label: { Label("Back", systemImage: "chevron.backward") }
			}
			if page.canGoForward {
				Button { page.goForward() } label: { Label("Forward", systemImage: "chevron.forward") }
			}
			Button { page.reload() } label: { Label("Reload", systemImage: "arrow.clockwise") }
			Divider()
			if let url = page.currentURL {
				ShareLink(item: url) { Label("Share…", systemImage: "square.and.arrow.up") }
			}
			if let onOpenInSafari {
				Button(action: onOpenInSafari) { Label("Open in Safari", systemImage: "safari") }
			}
		} label: {
			barGlyph("ellipsis")
		}
		.menuOrder(.fixed)
		.accessibilityLabel("More")
	}

	// A hairline that fills as the page loads, then gets out of the way.
	private var progressLine: some View {
		GeometryReader { geometry in
			Capsule()
				.fill(brandColor)
				.frame(width: geometry.size.width * max(0.08, page.progress), height: 2)
				.opacity(page.isLoading ? 1 : 0)
				.animation(.easeOut(duration: 0.25), value: page.progress)
				.animation(.easeOut(duration: 0.35).delay(page.isLoading ? 0 : 0.15), value: page.isLoading)
		}
		.frame(height: 2)
		.accessibilityHidden(true)
	}

	// ── States ──

	private func failureView(_ failure: BrowserPage.Failure) -> some View {
		VStack(spacing: 0) {
			Spacer()
			Image(systemName: "wifi.exclamationmark")
				.font(.system(size: 34, weight: .medium))
				.foregroundStyle(.white.opacity(0.6))
				.padding(.bottom, 20)
			Text(failure.title)
				.font(.title3.weight(.semibold))
				.foregroundStyle(.white)
				.multilineTextAlignment(.center)
			Text(failure.message)
				.font(.subheadline)
				.foregroundStyle(Theme.gray)
				.multilineTextAlignment(.center)
				.fixedSize(horizontal: false, vertical: true)
				.padding(.top, 8)
			Spacer()
			PrimaryActionButton(title: "Try Again") { page.reload() }
				.padding(.bottom, 12)
		}
		.padding(.horizontal, 28)
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(Color.black)
	}

	// ── Page dialogs ──

	private var dialogBinding: Binding<Bool> {
		Binding(
			get: { page.dialog != nil },
			set: { presented in
				// Dismissed without a choice: answer for the page so it isn't left waiting.
				if !presented, let dialog = page.dialog {
					page.dialog = nil
					BrowserPage.dismiss(dialog)
				}
			}
		)
	}

	private func answer(_ respond: () -> Void) {
		page.dialog = nil
		respond()
		promptText = ""
		username = ""
		password = ""
	}

	@ViewBuilder
	private func dialogActions(_ dialog: BrowserPage.Dialog) -> some View {
		switch dialog {
		case .alert(_, let done):
			Button("OK") { answer { done() } }
		case .confirm(_, let done):
			Button("Cancel", role: .cancel) { answer { done(false) } }
			Button("OK") { answer { done(true) } }
		case .prompt(_, let defaultText, let done):
			TextField("", text: $promptText)
				.onAppear { promptText = defaultText }
			Button("Cancel", role: .cancel) { answer { done(nil) } }
			Button("OK") {
				let text = promptText
				answer { done(text) }
			}
		case .credentials(_, let done):
			TextField("Username", text: $username)
				.textInputAutocapitalization(.never)
				.autocorrectionDisabled()
			SecureField("Password", text: $password)
			Button("Cancel", role: .cancel) { answer { done(nil) } }
			Button("Sign In") {
				let credential = URLCredential(user: username, password: password, persistence: .forSession)
				answer { done(credential) }
			}
		}
	}

	private func dialogMessage(_ dialog: BrowserPage.Dialog) -> String {
		switch dialog {
		case .alert(let message, _), .confirm(let message, _), .prompt(let message, _, _):
			message
		case .credentials(let asker, _):
			"\(asker) is asking you to sign in."
		}
	}
}

// What an app looks like in the moment before its page arrives: its own icon, on
// black, the way an app's launch screen holds the place of its first frame.
private struct LaunchScreen: View {
	let identity: BrowserPage.Identity
	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	@State private var breathing = false

	var body: some View {
		ZStack {
			Color.black
			Group {
				if identity.isUmbrel {
					Image("UmbrelMark")
						.resizable()
						.scaledToFit()
						.frame(width: 64)
				} else {
					AppIconView(url: identity.iconURL, size: 84, corner: 21)
						.shadow(color: .black.opacity(0.5), radius: 24, y: 12)
				}
			}
			.scaleEffect(breathing ? 1.04 : 1)
			.animation(
				reduceMotion ? nil : .easeInOut(duration: 1.1).repeatForever(autoreverses: true),
				value: breathing
			)
			.onAppear { breathing = true }
		}
		.accessibilityElement(children: .ignore)
		.accessibilityLabel("Opening \(identity.name)")
	}
}

// Hosts a page's long-lived web view. The view is owned by its page, so the same
// instance moves in and out of the hierarchy as the browser opens and closes.
struct BrowserWebView: UIViewRepresentable {
	let webView: WKWebView

	func makeUIView(context: Context) -> UIView {
		let container = UIView()
		container.backgroundColor = .clear
		return container
	}

	func updateUIView(_ container: UIView, context: Context) {
		guard webView.superview !== container else { return }
		webView.removeFromSuperview()
		webView.frame = container.bounds
		webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
		container.addSubview(webView)
	}
}

// Safari's in-app view for another website, presented the way Apple asks: modally, from
// whatever is on screen. SwiftUI's in-app openURL presents from the window's root,
// which is already showing the app's page, so from a page it shows nothing.
@MainActor
func presentSafariView(_ url: URL) {
	let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
	guard var top = scenes.compactMap(\.keyWindow).first?.rootViewController else { return }
	while let next = top.presentedViewController, !next.isBeingDismissed { top = next }
	top.present(SFSafariViewController(url: url), animated: true)
}

struct ActivitySheet: UIViewControllerRepresentable {
	let items: [Any]

	func makeUIViewController(context: Context) -> UIActivityViewController {
		UIActivityViewController(activityItems: items, applicationActivities: nil)
	}

	func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

private extension UIColor {
	// Perceived lightness, for choosing black or white controls over a page's color.
	var isLight: Bool {
		var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
		guard getRed(&red, green: &green, blue: &blue, alpha: &alpha) else { return false }
		return 0.2126 * red + 0.7152 * green + 0.0722 * blue > 0.6
	}
}
