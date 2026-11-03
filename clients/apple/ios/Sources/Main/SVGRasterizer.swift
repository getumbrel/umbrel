import UIKit
import WebKit

// Draws an app's SVG icon into a bitmap. iOS has no public SVG decoder, so WebKit draws
// it, in one shared page that's never on screen. The SVG loads as an image, which can't
// run script or fetch anything, and the page's own JavaScript is off. The app's script
// draws that image onto a canvas and hands back its pixels, so nothing waits for WebKit
// to paint the screen, and an icon that drew nothing is a failure rather than an image.
@MainActor
final class SVGRasterizer: NSObject {
	static let shared = SVGRasterizer()

	// Longer than loading the page or drawing any real icon takes, so a page that stopped
	// answering is replaced
	private static let timeout: TimeInterval = 10

	private static let page = """
		<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:">
		"""

	// Fitted to the square like the icon's own viewBox, and returned with the first alpha
	// above zero, or zero when nothing was drawn
	private static let script = """
		const image = new Image();
		image.src = source;
		await image.decode();
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		const context = canvas.getContext('2d');
		const width = image.naturalWidth || size;
		const height = image.naturalHeight || size;
		const fit = Math.min(size / width, size / height);
		context.drawImage(image, (size - width * fit) / 2, (size - height * fit) / 2, width * fit, height * fit);
		const pixels = context.getImageData(0, 0, size, size).data;
		let opaque = 0;
		for (let index = 3; index < pixels.length && opaque === 0; index += 4) opaque = pixels[index];
		return [opaque, canvas.toDataURL('image/png')];
		"""

	private var webView: WKWebView?
	private var isReady = false
	private var waiting: [CheckedContinuation<Bool, Never>] = []

	// A square image `pixelSize` wide, or nil when the SVG couldn't be drawn or drew nothing
	func image(from svg: String, pixelSize: Int) async -> UIImage? {
		guard pixelSize > 0, let webView = await readyWebView() else { return nil }
		let source = "data:image/svg+xml;base64,\(Data(svg.utf8).base64EncodedString())"
		let value = await evaluate(in: webView, arguments: ["source": source, "size": pixelSize])
		guard let result = value as? [Any], result.count == 2,
			let opaque = result[0] as? Int, opaque > 0,
			let url = result[1] as? String,
			let comma = url.firstIndex(of: ","),
			let data = Data(base64Encoded: String(url[url.index(after: comma)...]))
		else { return nil }
		return UIImage(data: data)
	}

	private func evaluate(in webView: WKWebView, arguments: [String: Any]) async -> Any? {
		await withCheckedContinuation { continuation in
			var finished = false
			let finish = { [weak self] (value: Any?, timedOut: Bool) in
				guard !finished else { return }
				finished = true
				if timedOut { self?.discard(webView) }
				continuation.resume(returning: value)
			}
			webView.callAsyncJavaScript(Self.script, arguments: arguments, in: nil, in: .defaultClient) { result in
				finish(try? result.get(), false)
			}
			DispatchQueue.main.asyncAfter(deadline: .now() + Self.timeout) {
				finish(nil, true)
			}
		}
	}

	private func readyWebView() async -> WKWebView? {
		if webView == nil { loadPage() }
		if !isReady {
			guard await withCheckedContinuation({ waiting.append($0) }) else { return nil }
		}
		return webView
	}

	private func loadPage() {
		let configuration = WKWebViewConfiguration()
		configuration.websiteDataStore = .nonPersistent()
		configuration.defaultWebpagePreferences.allowsContentJavaScript = false
		let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 1, height: 1), configuration: configuration)
		webView.navigationDelegate = self
		self.webView = webView
		isReady = false
		webView.loadHTMLString(Self.page, baseURL: nil)
		DispatchQueue.main.asyncAfter(deadline: .now() + Self.timeout) { [weak self, weak webView] in
			guard let self, let webView, !isReady else { return }
			discard(webView)
		}
	}

	// The next icon starts a new page
	private func discard(_ webView: WKWebView) {
		guard webView === self.webView else { return }
		self.webView = nil
		isReady = false
		resumeWaiting(ready: false)
	}

	private func resumeWaiting(ready: Bool) {
		let waiting = waiting
		self.waiting = []
		for continuation in waiting { continuation.resume(returning: ready) }
	}
}

extension SVGRasterizer: WKNavigationDelegate {
	func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
		guard webView === self.webView else { return }
		isReady = true
		resumeWaiting(ready: true)
	}

	func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
		discard(webView)
	}

	func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
		discard(webView)
	}

	func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
		discard(webView)
	}

	func webView(
		_ webView: WKWebView,
		decidePolicyFor navigationAction: WKNavigationAction,
		decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
	) {
		// loadHTMLString uses about:blank for the page. Nothing else may load.
		decisionHandler(navigationAction.request.url?.absoluteString == "about:blank" ? .allow : .cancel)
	}
}
