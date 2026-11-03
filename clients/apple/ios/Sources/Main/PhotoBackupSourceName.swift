import UIKit

enum PhotoBackupSourceName {
	static var current: String {
		let fallback = UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
		// iOS 16 and later returns the generic fallback unless Apple grants the
		// user-assigned-device-name entitlement. Use the same value in setup and UI.
		return suggested(from: UIDevice.current.name) ?? fallback
	}

	// umbrelOS accepts 1 to 100 UTF-16 code units with no ASCII control characters.
	// Emoji are kept: their joiners and variation selectors aren't control characters.
	static func suggested(from deviceName: String, maximumLength: Int = 100) -> String? {
		let name = deviceName.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !name.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7F }) else { return nil }
		var truncated = ""
		for character in name {
			guard truncated.utf16.count + character.utf16.count <= maximumLength else { break }
			truncated.append(character)
		}
		truncated = truncated.trimmingCharacters(in: .whitespacesAndNewlines)
		return truncated.isEmpty ? nil : truncated
	}

	// A new source next to "Nate's iPhone" becomes "Nate's iPhone (2)". umbrelOS keeps
	// the folders apart but not the names Photos shows.
	static func unique(_ name: String, among existing: [String]) -> String {
		let taken = Set(existing.map { $0.lowercased() })
		guard taken.contains(name.lowercased()) else { return name }
		for number in 2...99 {
			let suffix = " (\(number))"
			let base = suggested(from: name, maximumLength: 100 - suffix.utf16.count) ?? name
			let candidate = base + suffix
			if !taken.contains(candidate.lowercased()) { return candidate }
		}
		return name
	}
}
