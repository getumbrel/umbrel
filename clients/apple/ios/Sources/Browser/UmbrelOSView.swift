import SwiftUI
import UmbrelKit

// umbrelOS, in place. The app and umbrelOS share one wallpaper, so opening umbrelOS
// is not presented as a page at all: the wallpaper holds perfectly still, the native
// screen dissolves from above it, and umbrelOS's interface arrives in its place.
struct UmbrelOSView: View {
	let browser: Browser
	@Bindable var page: BrowserPage
	let isShown: Bool
	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	@State private var showsProgress = false
	@State private var isInSideColumn = false

	private var isReady: Bool { page.isRevealed && page.failure == nil }

	var body: some View {
		// umbrelOS runs from the top of the screen to the bottom, like a page under
		// Safari's bars: WebKit is told what the toolbar covers and lays umbrelOS out
		// clear of it, while its sheets and backdrops still reach the screen's edges.
		// Like Safari on iPhone Duo, it stops at the side column, unless umbrelOS keeps
		// clear of the safe area itself. Then it runs under the column too, and an
		// umbrelOS that also keeps clear of the top lays itself out under the toolbar.
		GeometryReader { proxy in
			ZStack {
				BrowserWebView(webView: page.webView) { page.webViewDidLayout() }
					// Moving without resizing, as when the side column changes sides
					.onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { _ in
						page.webViewDidLayout()
					}
					.opacity(isReady ? 1 : 0)
					.ignoresSafeArea(edges: page.keepsClearOfSides ? .all : .vertical)
				if let failure = page.failure {
					failureCard(failure)
				} else if !page.isRevealed, showsProgress {
					ProgressView().tint(.white)
				}
			}
			.animation(reduceMotion ? nil : .easeOut(duration: 0.3), value: isReady)
			.onChange(of: coveredEdges(proxy.safeAreaInsets), initial: true) { _, edges in
				page.keepClear(of: edges)
			}
			.modifier(SideColumnReader(isInSideColumn: $isInSideColumn))
		}
		// Only fades. Scaling the web view would push it past the screen's edges, and
		// WebKit would hand umbrelOS a new viewport and safe area on every frame, so its
		// dock would bounce as it arrived.
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

	// The safe area here includes the toolbar along the top. Where the toolbar is a side
	// column there's no top bar, so umbrelOS runs to the top edge, as in Safari, and
	// keeps its own room there. The bottom is left to umbrelOS where it can handle it:
	// its sheets run to the screen's edge and its dock keeps clear of the home
	// indicator through the page's safe area.
	private func coveredEdges(_ insets: EdgeInsets) -> UIEdgeInsets {
		UIEdgeInsets(
			top: isInSideColumn || page.keepsClearOfTop ? 0 : insets.top,
			left: 0,
			bottom: page.keepsClearOfHomeIndicator ? 0 : insets.bottom,
			right: 0)
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
