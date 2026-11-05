import SwiftUI
import UmbrelKit

// umbrelOS, in place. The app and umbrelOS share one wallpaper, so opening umbrelOS
// is not presented as a page at all: the wallpaper and the header hold perfectly
// still, the native screen dissolves from between them, and umbrelOS's interface
// arrives in its place.
struct UmbrelOSView: View {
	let browser: Browser
	@Bindable var page: BrowserPage
	let isShown: Bool
	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	@State private var showsProgress = false

	static let headerHeight: CGFloat = 50

	private var isReady: Bool { page.isRevealed && page.failure == nil }

	var body: some View {
		VStack(spacing: 0) {
			// The app's header stays put above; umbrelOS begins beneath it.
			Color.clear.frame(height: Self.headerHeight)
			ZStack {
				BrowserWebView(webView: page.webView)
					.opacity(isReady ? 1 : 0)
					// umbrelOS stops above the home indicator. Its dock, and the room its
					// pages leave for the dock, are laid out from the bottom of the page,
					// so running the page under the home indicator would put the dock
					// there. Its dimming and its sheets end at that edge too, so the page's
					// top and bottom edges are feathered to fade them out instead of
					// ending in a line. Reaching the bottom of the screen needs umbrelOS to
					// keep its dock clear of the home indicator itself.
					.mask {
						VStack(spacing: 0) {
							LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom)
								.frame(height: 14)
							Color.black
							LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom)
								.frame(height: 10)
						}
					}
				if let failure = page.failure {
					failureCard(failure)
				} else if !page.isRevealed, showsProgress {
					ProgressView().tint(.white)
				}
			}
			.animation(reduceMotion ? nil : .easeOut(duration: 0.3), value: isReady)
		}
		// Arrives a touch larger than life and settles, the reverse of how it leaves.
		.scaleEffect(isShown || reduceMotion ? 1 : 1.04)
		.opacity(isShown ? 1 : 0)
		.allowsHitTesting(isShown)
		.accessibilityHidden(!isShown)
		.task(id: page.isRevealed) {
			// Only admit to loading if it takes long enough to notice.
			showsProgress = false
			guard !page.isRevealed else { return }
			try? await Task.sleep(for: .milliseconds(500))
			if !Task.isCancelled { showsProgress = true }
		}
		.alert(
			page.dialogTitle,
			isPresented: Binding(
				get: { isShown && page.dialog != nil },
				set: { presented in
					if !presented, let dialog = page.dialog {
						page.dialog = nil
						BrowserPage.dismiss(dialog)
					}
				}
			),
			presenting: page.dialog
		) { dialog in
			switch dialog {
			case .alert(_, let done):
				Button("OK") { answer(done) }
			case .confirm(_, let done):
				Button("Cancel", role: .cancel) { answer { done(false) } }
				Button("OK") { answer { done(true) } }
			case .prompt(_, _, let done):
				Button("Cancel", role: .cancel) { answer { done(nil) } }
			case .credentials(_, let done):
				Button("Cancel", role: .cancel) { answer { done(nil) } }
			}
		} message: { dialog in
			switch dialog {
			case .alert(let message, _), .confirm(let message, _), .prompt(let message, _, _):
				Text(message)
			case .credentials(let asker, _):
				Text("\(asker) is asking you to sign in.")
			}
		}
		.sheet(
			isPresented: Binding(
				get: { isShown && page.downloadedFile != nil },
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

	private func answer(_ respond: () -> Void) {
		page.dialog = nil
		respond()
	}

	private func failureCard(_ failure: BrowserPage.Failure) -> some View {
		VStack(spacing: 8) {
			Image(systemName: "wifi.exclamationmark")
				.font(.system(size: 30, weight: .medium))
				.foregroundStyle(.white.opacity(0.7))
				.padding(.bottom, 8)
			Text(failure.title)
				.font(.title3.weight(.semibold))
				.foregroundStyle(.white)
				.multilineTextAlignment(.center)
			Text(failure.message)
				.font(.subheadline)
				.foregroundStyle(.white.opacity(0.7))
				.multilineTextAlignment(.center)
				.fixedSize(horizontal: false, vertical: true)
			PillButton(title: "Try Again") { page.reload() }
				.padding(.top, 8)
		}
		.padding(.horizontal, 36)
		.frame(maxWidth: .infinity, maxHeight: .infinity)
	}
}
