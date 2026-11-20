import ImageIO
import SwiftUI
import UIKit
import UmbrelKit

// A wallpaper's id and hash name the same files on every Umbrel, so one disk cache
// serves every device. umbrelOS releases before wallpaper hashes send none, and those
// wallpapers are cached under their id alone.
// Memory is deliberately evictable: the active model retains what it is showing, while
// NSCache can discard other decoded bitmaps under pressure and recreate them from disk.
@MainActor
final class WallpaperStore {
	static let shared = WallpaperStore()

	private enum Variant {
		case fullScreen
		case deviceCard

		var rendition: Umbreld.WallpaperImageRendition {
			switch self {
			case .fullScreen: .large
			case .deviceCard: .medium
			}
		}

		var suffix: String {
			switch self {
			case .fullScreen: "large"
			case .deviceCard: "medium"
			}
		}

		var maxPixelSize: Int {
			switch self {
			case .fullScreen: 2_880
			case .deviceCard: 1_440
			}
		}
	}

	private static let blurMaxPixelSize = 1_440
	private let memory: NSCache<NSString, UIImage> = {
		let cache = NSCache<NSString, UIImage>()
		cache.countLimit = 12
		cache.totalCostLimit = 64 * 1_024 * 1_024
		return cache
	}()
	private let disk = WallpaperDiskCache()

	// SwiftUI recreates MainModel when the user leaves and re-enters a device. A
	// synchronous memory hit lets that new screen render its wallpaper immediately;
	// disk and network work remain asynchronous below.
	func memoryCached(id: String, hash: String?) -> UIImage? {
		cacheKey(id: id, hash: hash, variant: .fullScreen).flatMap { memory.object(forKey: $0 as NSString) }
	}

	func memoryCachedCard(id: String, hash: String?) -> UIImage? {
		cacheKey(id: id, hash: hash, variant: .deviceCard).flatMap { memory.object(forKey: $0 as NSString) }
	}

	func memoryBlurred(id: String, hash: String?) -> UIImage? {
		blurKey(id: id, hash: hash).flatMap { memory.object(forKey: $0 as NSString) }
	}

	func cached(id: String, hash: String?) async -> UIImage? {
		await cached(id: id, hash: hash, variant: .fullScreen)
	}

	func cachedCard(id: String, hash: String?) async -> UIImage? {
		if let image = await cached(id: id, hash: hash, variant: .deviceCard) { return image }
		// A prior full-screen load is also a valid compressed source for a smaller card.
		guard let cardKey = cacheKey(id: id, hash: hash, variant: .deviceCard),
			let fullScreenKey = cacheKey(id: id, hash: hash, variant: .fullScreen),
			let data = await disk.data(for: fullScreenKey),
			let prepared = await WallpaperImageProcessor.decode(
				data,
				maxPixelSize: Variant.deviceCard.maxPixelSize
			)
		else { return nil }
		storeInMemory(prepared.image, for: cardKey)
		return prepared.image
	}

	func load(id: String, hash: String?, target: Umbreld.Target) async -> UIImage? {
		guard let image = await load(id: id, hash: hash, target: target, variant: .fullScreen)
		else { return nil }
		_ = await blurred(id: id, hash: hash)
		return image
	}

	func loadCard(id: String, hash: String?, target: Umbreld.Target) async -> UIImage? {
		if let image = await cachedCard(id: id, hash: hash) { return image }
		return await load(id: id, hash: hash, target: target, variant: .deviceCard)
	}

	func blurred(id: String, hash: String?) async -> UIImage? {
		guard let key = blurKey(id: id, hash: hash),
			let fullScreenKey = cacheKey(id: id, hash: hash, variant: .fullScreen),
			let cardKey = cacheKey(id: id, hash: hash, variant: .deviceCard)
		else { return nil }
		if let hit = memory.object(forKey: key as NSString) { return hit }
		if let data = await disk.data(for: key),
			let prepared = await WallpaperImageProcessor.decode(
				data,
				maxPixelSize: Self.blurMaxPixelSize
			)
		{
			storeInMemory(prepared.image, for: key)
			return prepared.image
		}
		// Decode a smaller copy directly from the compressed source before blurring it.
		// The frost is intentionally soft and does not need the full-screen pixel count.
		let sourceData: Data?
		if let fullScreen = await disk.data(for: fullScreenKey) {
			sourceData = fullScreen
		} else {
			sourceData = await disk.data(for: cardKey)
		}
		guard let data = sourceData,
			let source = await WallpaperImageProcessor.decode(
				data,
				maxPixelSize: Self.blurMaxPixelSize
			),
			let result = await WallpaperImageProcessor.blur(
				source,
				radius: 40
			)
		else { return nil }
		storeInMemory(result.image, for: key)
		await disk.store(result.encodedData, for: key)
		await disk.trimVersions(of: id, suffix: "blur")
		return result.image
	}

	private func cached(id: String, hash: String?, variant: Variant) async -> UIImage? {
		guard let key = cacheKey(id: id, hash: hash, variant: variant) else { return nil }
		if let hit = memory.object(forKey: key as NSString) { return hit }
		guard let data = await disk.data(for: key),
			let prepared = await WallpaperImageProcessor.decode(
				data,
				maxPixelSize: variant.maxPixelSize
			)
		else { return nil }
		storeInMemory(prepared.image, for: key)
		return prepared.image
	}

	private func load(id: String, hash: String?, target: Umbreld.Target, variant: Variant) async -> UIImage? {
		guard let key = cacheKey(id: id, hash: hash, variant: variant) else { return nil }
		if let hit = await cached(id: id, hash: hash, variant: variant) { return hit }
		let preferred = await fetch(
			id: id,
			target: target,
			rendition: variant.rendition,
			maxPixelSize: variant.maxPixelSize
		)
		let loaded: (data: Data, image: PreparedWallpaperImage)?
		if let preferred {
			loaded = preferred
		} else if !Task.isCancelled {
			loaded = await fetch(
				id: id,
				target: target,
				rendition: .jpegFallback,
				maxPixelSize: variant.maxPixelSize
			)
		} else {
			loaded = nil
		}
		guard let loaded else { return nil }
		storeInMemory(loaded.image.image, for: key)
		await disk.store(loaded.data, for: key)
		await disk.trimVersions(of: id, suffix: variant.suffix)
		return loaded.image.image
	}

	private func fetch(
		id: String,
		target: Umbreld.Target,
		rendition: Umbreld.WallpaperImageRendition,
		maxPixelSize: Int
	) async -> (data: Data, image: PreparedWallpaperImage)? {
		do {
			let data = try await Umbreld.wallpaperData(
				target: target,
				id: id,
				rendition: rendition
			)
			try Task.checkCancellation()
			guard let image = await WallpaperImageProcessor.decode(
				data,
				maxPixelSize: maxPixelSize
			) else { return nil }
			return (data, image)
		} catch {
			return nil
		}
	}

	private func cacheKey(id: String, hash: String?, variant: Variant) -> String? {
		WallpaperDiskCache.versionKey(id: id, hash: hash).map { "\($0)-\(variant.suffix)" }
	}

	private func blurKey(id: String, hash: String?) -> String? {
		WallpaperDiskCache.versionKey(id: id, hash: hash).map { "\($0)-blur" }
	}

	private func storeInMemory(_ image: UIImage, for key: String) {
		let cost = image.cgImage.map { $0.bytesPerRow * $0.height } ?? 0
		memory.setObject(image, forKey: key as NSString, cost: cost)
	}
}

// UIImage is immutable for this pipeline after preparation. The wrapper documents the
// one controlled concurrency boundary: workers create it, then MainActor owns and shows it.
private struct PreparedWallpaperImage: @unchecked Sendable {
	let image: UIImage
}

private struct PreparedWallpaperBlur: @unchecked Sendable {
	let image: UIImage
	let encodedData: Data
}

private enum WallpaperImageProcessor {
	// Image I/O creates a bounded, immediately decoded bitmap without first inflating the
	// original 5K JPEG. It also handles the AVIF renditions on supported Apple platforms.
	static func decode(_ data: Data, maxPixelSize: Int) async -> PreparedWallpaperImage? {
		let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
		guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else {
			return nil
		}
		let thumbnailOptions = [
			kCGImageSourceCreateThumbnailFromImageAlways: true,
			kCGImageSourceCreateThumbnailWithTransform: true,
			kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
			kCGImageSourceShouldCacheImmediately: true,
		] as CFDictionary
		guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbnailOptions)
		else { return nil }
		return PreparedWallpaperImage(image: UIImage(cgImage: image))
	}

	static func blur(_ image: PreparedWallpaperImage, radius: CGFloat) async -> PreparedWallpaperBlur? {
		guard let blurred = image.image.gaussianBlurred(radius: radius),
			let encodedData = blurred.jpegData(compressionQuality: 0.9)
		else { return nil }
		return PreparedWallpaperBlur(image: blurred, encodedData: encodedData)
	}
}

private actor WallpaperDiskCache {
	private let directory: URL
	private var directoryReady = false

	init() {
		let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
		// This cache version stores bounded AVIF/JPEG sources and smaller blur outputs.
		directory = caches.appendingPathComponent("wallpapers-v2", isDirectory: true)
	}

	func data(for key: String) -> Data? {
		try? Data(contentsOf: fileURL(key))
	}

	func store(_ data: Data, for key: String) {
		if !directoryReady {
			guard (try? FileManager.default.createDirectory(
				at: directory,
				withIntermediateDirectories: true
			)) != nil else { return }
			directoryReady = true
		}
		try? data.write(to: fileURL(key), options: .atomic)
	}

	// Umbrels on different umbrelOS releases can show the same wallpaper with different
	// files, and each device card needs its own copy offline, so a few versions of each
	// wallpaper are kept. Beyond that the oldest are removed, so hashes that keep
	// changing can't fill the disk.
	func trimVersions(of id: String, suffix: String) {
		let ending = "-\(suffix).image"
		let fileManager = FileManager.default
		guard let urls = try? fileManager.contentsOfDirectory(
			at: directory,
			includingPropertiesForKeys: [.contentModificationDateKey]
		) else { return }
		let versions = urls.filter { url in
			let name = url.lastPathComponent
			guard name.hasSuffix(ending) else { return false }
			let version = String(name.dropLast(ending.count))
			return version == id
				|| (version.hasPrefix("\(id)-")
					&& Umbreld.Wallpaper.validHash(String(version.dropFirst(id.count + 1))) != nil)
		}
		guard versions.count > Self.versionsKept else { return }
		let newestFirst = versions.sorted {
			let first = (try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
			let second = (try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
			return first > second
		}
		for url in newestFirst.dropFirst(Self.versionsKept) { try? fileManager.removeItem(at: url) }
	}

	private static let versionsKept = 3

	// Keys become filenames. Ids are numeric presets and hashes short lowercase hex, and
	// both are checked here because they come from the Umbrel; anything else isn't cached.
	static func versionKey(id: String, hash: String?) -> String? {
		guard !id.isEmpty, id.allSatisfy(\.isASCIIDigit) else { return nil }
		guard let hash else { return id }
		guard let valid = Umbreld.Wallpaper.validHash(hash) else { return id }
		return "\(id)-\(valid)"
	}

	private func fileURL(_ key: String) -> URL {
		directory.appendingPathComponent(key, isDirectory: false).appendingPathExtension("image")
	}
}

private extension Character {
	var isASCIIDigit: Bool { ("0"..."9").contains(self) }
}
