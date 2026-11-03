import CryptoKit
import Foundation
import SwiftUI
import UIKit

// umbreld serves app icons as external URLs, mostly SVG, which AsyncImage/UIImage can't
// decode. We fetch the SVG (cached by URL), draw it once with SVGRasterizer, and cache the
// bitmap in memory and on disk. After an icon draws once it appears instantly forever
// after (scrolling, tab switches, next launch), so WebKit only runs the very first time
// an icon is seen. Community app stores often use PNG or JPEG icons instead; those are
// decoded directly.

// ── Rasterized-icon cache (memory + disk) ──
@MainActor
final class IconCache {
	static let shared = IconCache()

	private let memory = NSCache<NSString, UIImage>()
	private let directory: URL

	init() {
		let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
		directory = caches.appendingPathComponent("app-icons-2", isDirectory: true)
		// Snapshots of an on-screen web view could be saved blank, so those are drawn again
		try? FileManager.default.removeItem(at: caches.appendingPathComponent("app-icons", isDirectory: true))
		memory.countLimit = 128
		memory.totalCostLimit = 32 * 1_024 * 1_024
		try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
	}

	func image(forKey key: String) -> UIImage? {
		let cacheKey = key as NSString
		if let hit = memory.object(forKey: cacheKey) { return hit }
		guard let data = try? Data(contentsOf: diskURL(key)), let image = UIImage(data: data) else { return nil }
		memory.setObject(image, forKey: cacheKey, cost: memoryCost(of: image))
		return image
	}

	func store(_ image: UIImage, forKey key: String) {
		memory.setObject(image, forKey: key as NSString, cost: memoryCost(of: image))
		if let data = image.pngData() { try? data.write(to: diskURL(key), options: .atomic) }
	}

	private func memoryCost(of image: UIImage) -> Int {
		if let cgImage = image.cgImage { return cgImage.bytesPerRow * cgImage.height }
		let pixelWidth = image.size.width * image.scale
		let pixelHeight = image.size.height * image.scale
		return Int(pixelWidth * pixelHeight * 4)
	}

	private func diskURL(_ key: String) -> URL {
		let hash = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
		return directory.appendingPathComponent(hash).appendingPathExtension("png")
	}
}
// ── Icon loading ──
enum IconSource {
	case svg(String)
	case raster(Data)
}

@MainActor
final class IconSourceLoader {
	static let shared = IconSourceLoader()

	private var inFlight: [URL: Task<IconSource?, Never>] = [:]

	func source(for url: URL) async -> IconSource? {
		if let task = inFlight[url] { return await task.value }
		let task = Task { () -> IconSource? in
			await IconDownload.source(for: url)
		}
		inFlight[url] = task
		let result = await task.value
		inFlight[url] = nil
		return result
	}
}

private enum IconDownload {
	// The largest first-party gallery icon is currently about 3.3 MB. This keeps
	// legitimate icons working while bounding an untrusted manifest response.
	private static let maximumByteCount = 4 * 1_024 * 1_024
	private static let rasterTypes: Set<String> = ["image/png", "image/jpeg", "image/webp", "image/gif"]

	static func source(for url: URL) async -> IconSource? {
		guard url.scheme?.lowercased() == "https",
			url.host != nil,
			url.user == nil,
			url.password == nil
		else { return nil }

		var request = URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 15)
		request.setValue("image/svg+xml, image/*;q=0.8", forHTTPHeaderField: "Accept")

		do {
			let (bytes, response) = try await URLSession.shared.bytes(
				for: request,
				delegate: IconNoRedirectDelegate()
			)
			guard let response = response as? HTTPURLResponse,
				(200..<300).contains(response.statusCode),
				let mimeType = response.mimeType?.lowercased(),
				mimeType == "image/svg+xml" || rasterTypes.contains(mimeType),
				response.expectedContentLength <= Int64(maximumByteCount)
			else { return nil }

			var data = Data()
			if response.expectedContentLength > 0 {
				data.reserveCapacity(Int(response.expectedContentLength))
			}
			for try await byte in bytes {
				guard data.count < maximumByteCount else { return nil }
				data.append(byte)
			}
			if mimeType == "image/svg+xml" {
				return String(data: data, encoding: .utf8).map(IconSource.svg)
			}
			return .raster(data)
		} catch {
			return nil
		}
	}
}

private final class IconNoRedirectDelegate: NSObject, URLSessionTaskDelegate {
	func urlSession(
		_ session: URLSession,
		task: URLSessionTask,
		willPerformHTTPRedirection response: HTTPURLResponse,
		newRequest request: URLRequest,
		completionHandler: @escaping (URLRequest?) -> Void
	) {
		completionHandler(nil)
	}
}

// A rounded app icon: instant from cache when available, otherwise the umbrelOS
// placeholder until the icon is drawn. One that can't be drawn keeps the placeholder
// and is tried again the next time it appears.
struct AppIconView: View {
	let url: URL?
	var size: CGFloat = 50
	var corner: CGFloat = 12.5

	@Environment(\.displayScale) private var displayScale
	@State private var image: UIImage?

	private var pixelSize: Int { Int((size * displayScale).rounded(.up)) }

	// Icons are drawn at the view's pixel size. Include it so a small overflow icon is
	// never reused and enlarged in a full-size app card.
	private var cacheKey: String? {
		guard let url else { return nil }
		return "\(url.absoluteString)#\(pixelSize)px"
	}

	var body: some View {
		ZStack {
			if let image {
				Image(uiImage: image)
					.resizable()
					.interpolation(.high)
					.scaledToFill()
			} else {
				placeholder
			}
		}
		.frame(width: size, height: size)
		.clipShape(.rect(cornerRadius: corner))
		// Fade freshly rasterized icons in over their placeholder (cached ones are
		// set before first render, so no animation runs for them).
		.animation(.easeOut(duration: 0.25), value: image)
		.task(id: cacheKey) {
			image = nil
			guard let url, let cacheKey else { return }
			if let cached = IconCache.shared.image(forKey: cacheKey) {
				image = cached
				return
			}
			guard let source = await IconSourceLoader.shared.source(for: url),
				!Task.isCancelled,
				cacheKey == self.cacheKey
			else { return }
			let drawn: UIImage?
			switch source {
			case .svg(let svg):
				drawn = await SVGRasterizer.shared.image(from: svg, pixelSize: pixelSize)
			case .raster(let data):
				drawn = Self.rasterIcon(data, pixelSize: CGFloat(pixelSize))
			}
			guard let drawn, !Task.isCancelled, cacheKey == self.cacheKey else { return }
			IconCache.shared.store(drawn, forKey: cacheKey)
			image = drawn
		}
	}

	// Draw a PNG or JPEG icon filling a square at the icon's on-screen pixel size, like
	// an SVG icon, so a large source image isn't kept in memory or on disk.
	private static func rasterIcon(_ data: Data, pixelSize: CGFloat) -> UIImage? {
		guard let decoded = UIImage(data: data),
			decoded.size.width > 0,
			decoded.size.height > 0,
			pixelSize > 0
		else { return nil }
		let fill = max(pixelSize / decoded.size.width, pixelSize / decoded.size.height)
		let drawn = CGSize(width: decoded.size.width * fill, height: decoded.size.height * fill)
		let format = UIGraphicsImageRendererFormat()
		format.scale = 1
		let renderer = UIGraphicsImageRenderer(size: CGSize(width: pixelSize, height: pixelSize), format: format)
		return renderer.image { _ in
			decoded.draw(in: CGRect(
				x: (pixelSize - drawn.width) / 2,
				y: (pixelSize - drawn.height) / 2,
				width: drawn.width,
				height: drawn.height
			))
		}
	}

	// The umbrelOS loading/fallback icon (packages/ui assets/app-icon-placeholder.svg),
	// bundled as a vector asset so it renders on the first frame.
	private var placeholder: some View {
		Image("AppIconPlaceholder")
			.resizable()
			.interpolation(.high)
			.scaledToFill()
	}
}
