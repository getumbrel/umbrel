package com.umbrel.kit.backup

import java.util.Locale

/**
 * The folder a library item lives in, from MediaStore's RELATIVE_PATH ("DCIM/Camera/").
 * Backup can skip folders. The choice is stored as the folders to skip, so a folder that
 * appears later is backed up rather than missed.
 *
 * A folder's key ignores case, as MediaStore's own bucket id does (it hashes the lowercased
 * path), and leaves out the volume, so a Camera folder on a memory card is the same choice
 * as the one on the phone.
 */
object PhotoBackupFolders {
	/** The key for an item's RELATIVE_PATH. MediaStore leaves the path null when it doesn't know it. */
	fun key(relativePath: String?): String = relativePath?.lowercase(Locale.ROOT) ?: ""

	/** The folder's own name, the last part of its path. Files at the top of a volume have the path "/". */
	fun name(relativePath: String?): String = when (relativePath) {
		null, "" -> "Other"
		"/" -> "Phone storage"
		else -> relativePath.trimEnd('/').substringAfterLast('/')
	}

	/**
	 * The folders backup leaves out. With "Select photos" access the selection already
	 * decides what's backed up, so no folder is skipped; the saved choice applies again
	 * once access to all photos returns.
	 */
	fun skipped(folders: Set<String>, access: PhotoLibraryAccess): Set<String> =
		if (access == PhotoLibraryAccess.FULL) folders else emptySet()
}
