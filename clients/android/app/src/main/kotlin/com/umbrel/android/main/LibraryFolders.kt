package com.umbrel.android.main

import com.umbrel.kit.backup.PhotoBackupFolders
import com.umbrel.kit.backup.PhotoLibraryAccess
import com.umbrel.kit.backup.PhotoLibraryCounts
import java.text.NumberFormat
import java.util.Locale

/** One folder of the phone's library, as the Folders page lists it. */
data class LibraryFolder(
	/** The key backup stores when the folder is skipped, from [PhotoBackupFolders.key]. */
	val key: String,
	val name: String,
	val photoCount: Long,
	val videoCount: Long,
	/** The most recent item, whose thumbnail stands for the folder. */
	val newest: LocalMediaItem,
) {
	val itemCount: Long get() = photoCount + videoCount
}

object LibraryFolders {
	/**
	 * The library's folders, largest first. Folders that share a name, such as two called
	 * Camera, show their path instead so they can be told apart.
	 */
	fun of(items: List<LocalMediaItem>): List<LibraryFolder> {
		val folders = items.groupBy { it.folder }.map { (key, members) ->
			// Items are oldest first, so the last is the newest.
			val newest = members.last()
			LibraryFolder(
				key = key,
				name = PhotoBackupFolders.name(newest.folderPath),
				photoCount = members.count { !it.isVideo }.toLong(),
				videoCount = members.count { it.isVideo }.toLong(),
				newest = newest,
			)
		}
		val shared = folders.groupingBy { it.name.lowercase(Locale.ROOT) }.eachCount().filterValues { it > 1 }.keys
		return folders
			.map { folder ->
				if (folder.name.lowercase(Locale.ROOT) !in shared) folder else folder.copy(name = folder.newest.folderPath?.trimEnd('/') ?: folder.name)
			}
			.sortedWith(compareByDescending<LibraryFolder> { it.itemCount }.thenBy { it.name.lowercase(Locale.ROOT) })
	}

	/** The photos and videos in each folder, which backup measures its remaining work against. */
	fun counts(items: List<LocalMediaItem>): PhotoLibraryCounts {
		val photos = HashMap<String, Long>()
		val videos = HashMap<String, Long>()
		for (item in items) {
			val counts = if (item.isVideo) videos else photos
			counts[item.folder] = (counts[item.folder] ?: 0) + 1
		}
		return PhotoLibraryCounts(photos, videos)
	}

	/** "1,204 photos, 38 videos", leaving out a part that's zero. */
	fun contents(photoCount: Long, videoCount: Long, separator: String = ", "): String {
		val format = NumberFormat.getIntegerInstance()
		return listOfNotNull(
			photoCount.takeIf { it > 0 }?.let { "${format.format(it)} ${if (it == 1L) "photo" else "photos"}" },
			videoCount.takeIf { it > 0 }?.let { "${format.format(it)} ${if (it == 1L) "video" else "videos"}" },
		).joinToString(separator)
	}
}

/**
 * What Library shows while this phone backs up: only what is backed up or on its way. A
 * folder that's skipped or a media type that's off is left out of the grid, and the status
 * says what is skipped.
 */
data class LibraryFilter(val includesPhotos: Boolean, val includesVideos: Boolean, val skippedFolders: Set<String>) {
	fun shows(item: LocalMediaItem): Boolean = (if (item.isVideo) includesVideos else includesPhotos) && item.folder !in skippedFolders

	companion object {
		/** Null while backup is off or another Umbrel owns it: then Library shows the whole library. */
		fun of(state: MainUiState): LibraryFilter? {
			val preference = state.backupPreference
			if (state.otherBackupDeviceName != null || !preference.isEnabled) return null
			return LibraryFilter(
				preference.includesPhotos,
				preference.includesVideos,
				PhotoBackupFolders.skipped(preference.skippedFolders, state.photoLibraryAccess),
			)
		}
	}
}

/**
 * Whether this account can choose folders: backup is on for it, and the phone shares all its
 * photos. With "Select photos" the selection already decides what's backed up.
 */
fun canChooseFolders(state: MainUiState): Boolean =
	state.otherBackupDeviceName == null && state.backupPreference.isEnabled && state.photoLibraryAccess == PhotoLibraryAccess.FULL

/** Whether the folder choice that comes with turning backup on is still to be made. */
fun folderChoicePending(state: MainUiState): Boolean = canChooseFolders(state) && !state.backupPreference.foldersChosen

/** The phone's folders that backup skips. A skipped folder that has since emptied isn't counted. */
fun skippedFolders(state: MainUiState, folders: List<LibraryFolder>): List<LibraryFolder> {
	if (!canChooseFolders(state)) return emptyList()
	val skipped = state.backupPreference.skippedFolders
	return folders.filter { it.key in skipped }
}

/** "1 folder skipped", "2 folders skipped". */
fun skippedFoldersText(count: Int): String = "${NumberFormat.getIntegerInstance().format(count)} ${if (count == 1) "folder" else "folders"} skipped"
