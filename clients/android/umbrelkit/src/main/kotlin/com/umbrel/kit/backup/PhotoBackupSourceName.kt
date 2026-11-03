package com.umbrel.kit.backup

import android.content.Context
import android.provider.Settings
import java.text.BreakIterator

/** The name a new photo backup source suggests to the Umbrel: this phone's own name. */
object PhotoBackupSourceName {
	/** Read at setup and in the UI alike, so both show the same name. */
	fun current(context: Context): String {
		val fallback = if (context.resources.configuration.smallestScreenWidthDp >= 600) "Android tablet" else "Android phone"
		// The name in Settings › About phone › Device name, which starts as the model's name.
		return suggested(Settings.Global.getString(context.contentResolver, Settings.Global.DEVICE_NAME)) ?: fallback
	}

	/**
	 * umbrelOS accepts 1 to 100 UTF-16 code units with no ASCII control characters. Emoji are
	 * kept: their joiners and variation selectors aren't control characters. A longer name is
	 * cut at the last whole character that fits.
	 */
	fun suggested(deviceName: String?, maximumLength: Int = MAX_LENGTH): String? {
		val name = deviceName?.trim() ?: return null
		if (name.any { it.code < 0x20 || it.code == 0x7F }) return null
		val characters = BreakIterator.getCharacterInstance().apply { setText(name) }
		var end = 0
		var boundary = characters.next()
		while (boundary != BreakIterator.DONE && boundary <= maximumLength) {
			end = boundary
			boundary = characters.next()
		}
		return name.substring(0, end).trim().ifEmpty { null }
	}

	/**
	 * A new source next to "Nate’s Pixel" becomes "Nate’s Pixel (2)". umbrelOS keeps the folders
	 * apart but not the names Photos shows.
	 */
	fun unique(name: String, among: List<String>): String {
		val taken = among.mapTo(HashSet()) { it.lowercase() }
		if (name.lowercase() !in taken) return name
		for (number in 2..99) {
			val suffix = " ($number)"
			val candidate = (suggested(name, MAX_LENGTH - suffix.length) ?: name) + suffix
			if (candidate.lowercase() !in taken) return candidate
		}
		return name
	}

	private const val MAX_LENGTH = 100
}
