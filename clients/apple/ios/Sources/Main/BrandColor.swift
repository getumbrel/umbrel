import SwiftUI

enum BrandColor {
	private static let fallback = (hue: 259.0, saturation: 1.0, lightness: 0.59)

	// The brand color as a SwiftUI Color, for folders, buttons and the storage donut. `mixWhite`
	// (0…1) blends it toward white, matching umbrelOS's `color-mix(..., white)` lighter shades.
	static func color(_ value: String?, mixWhite: Double = 0) -> Color {
		let color = components(from: value)
		return Color(
			hslHue: color.hue,
			saturation: color.saturation,
			lightness: color.lightness,
			mixWhite: mixWhite
		)
	}

	private static func components(from value: String?) -> (hue: Double, saturation: Double, lightness: Double) {
		guard let value else { return fallback }
		let parts = value.split(whereSeparator: \.isWhitespace)
		guard parts.count == 3,
			let hue = Double(parts[0]),
			let saturation = percentage(parts[1]),
			let lightness = percentage(parts[2]),
			hue.isFinite,
			(0...360).contains(hue)
		else { return fallback }
		return (hue, saturation, lightness)
	}

	private static func percentage(_ value: Substring) -> Double? {
		guard value.last == "%",
			let number = Double(value.dropLast()),
			number.isFinite,
			(0...100).contains(number)
		else { return nil }
		return number / 100
	}
}

extension Color {
	// CSS HSL → Color, optionally blended toward white by `mixWhite` (0…1). SwiftUI's
	// built-in initializer is HSB, so we convert HSL ourselves.
	init(hslHue h: Double, saturation s: Double, lightness l: Double, mixWhite: Double = 0) {
		let c = (1 - abs(2 * l - 1)) * s
		let hp = h.truncatingRemainder(dividingBy: 360) / 60
		let x = c * (1 - abs(hp.truncatingRemainder(dividingBy: 2) - 1))
		let (r, g, b): (Double, Double, Double)
		switch hp {
		case 0..<1: (r, g, b) = (c, x, 0)
		case 1..<2: (r, g, b) = (x, c, 0)
		case 2..<3: (r, g, b) = (0, c, x)
		case 3..<4: (r, g, b) = (0, x, c)
		case 4..<5: (r, g, b) = (x, 0, c)
		default: (r, g, b) = (c, 0, x)
		}
		let m = l - c / 2
		let t = max(0, min(1, mixWhite))
		self = Color(
			.sRGB,
			red: (r + m) + (1 - (r + m)) * t,
			green: (g + m) + (1 - (g + m)) * t,
			blue: (b + m) + (1 - (b + m)) * t
		)
	}
}

// The wallpaper-derived brand color flows down to the primary buttons and storage donut.
// Defaults to the umbrelOS accent blue until a wallpaper is known.
private struct BrandColorKey: EnvironmentKey {
	static let defaultValue = Theme.blue
}

extension EnvironmentValues {
	var brandColor: Color {
		get { self[BrandColorKey.self] }
		set { self[BrandColorKey.self] = newValue }
	}
}
