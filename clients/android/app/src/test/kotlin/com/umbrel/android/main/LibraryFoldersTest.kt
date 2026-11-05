package com.umbrel.android.main

import com.umbrel.kit.SavedDevice
import com.umbrel.kit.backup.PhotoBackupPreference
import com.umbrel.kit.backup.PhotoLibraryAccess
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LibraryFoldersTest {
	private fun item(id: Long, path: String?, isVideo: Boolean = false) =
		LocalMediaItem(id = id, isVideo = isVideo, takenAtMs = id, durationMs = null, width = 0, height = 0, generation = 0, folderPath = path)

	private fun state(
		preference: PhotoBackupPreference = PhotoBackupPreference(includesPhotos = true, includesVideos = true, skippedFolders = setOf("pictures/whatsapp/")),
		access: PhotoLibraryAccess = PhotoLibraryAccess.FULL,
		other: String? = null,
	) = MainUiState(
		device = SavedDevice("device", "Umbrel", "umbrel.local"),
		session = null,
		backupPreference = preference,
		photoLibraryAccess = access,
		otherBackupDeviceName = other,
	)

	@Test
	fun foldersAreLargestFirstWithTheirNewestItem() {
		val items = listOf(
			item(1, "DCIM/Camera/"),
			item(2, "Pictures/WhatsApp/"),
			item(3, "DCIM/Camera/", isVideo = true),
			item(4, "DCIM/Camera/"),
		)

		val folders = LibraryFolders.of(items)

		assertEquals(listOf("Camera", "WhatsApp"), folders.map { it.name })
		assertEquals(listOf("dcim/camera/", "pictures/whatsapp/"), folders.map { it.key })
		assertEquals(2L to 1L, folders[0].photoCount to folders[0].videoCount)
		assertEquals(4L, folders[0].newest.id)
	}

	// A folder's key ignores case, as MediaStore's own bucket does.
	@Test
	fun pathsThatDifferOnlyInCaseAreOneFolder() {
		val folders = LibraryFolders.of(listOf(item(1, "DCIM/Camera/"), item(2, "dcim/camera/")))
		assertEquals(1, folders.size)
		assertEquals(2L, folders.single().itemCount)
	}

	@Test
	fun foldersSharingANameShowTheirPath() {
		val folders = LibraryFolders.of(listOf(item(1, "DCIM/Camera/"), item(2, "Pictures/Camera/"), item(3, "Download/")))
		assertEquals(setOf("DCIM/Camera", "Pictures/Camera", "Download"), folders.map { it.name }.toSet())
	}

	@Test
	fun countsArePerFolderAndMediaType() {
		val counts = LibraryFolders.counts(listOf(item(1, "DCIM/Camera/"), item(2, "DCIM/Camera/", isVideo = true), item(3, "Download/")))
		assertEquals(mapOf("dcim/camera/" to 1L, "download/" to 1L), counts.photos)
		assertEquals(mapOf("dcim/camera/" to 1L), counts.videos)
		assertEquals(1L, counts.photoCount(skippedFolders = setOf("download/")))
	}

	@Test
	fun contentsLeaveOutAPartThatIsZero() {
		assertEquals("12 photos, 1 video", LibraryFolders.contents(12, 1))
		assertEquals("1 photo", LibraryFolders.contents(1, 0))
		assertEquals("3 videos", LibraryFolders.contents(0, 3))
		assertEquals("2 photos and 3 videos", LibraryFolders.contents(2, 3, separator = " and "))
	}

	@Test
	fun libraryShowsOnlyWhatBackupCovers() {
		val filter = LibraryFilter.of(state(preference = PhotoBackupPreference(includesPhotos = true, includesVideos = false, skippedFolders = setOf("pictures/whatsapp/"))))!!
		assertTrue(filter.shows(item(1, "DCIM/Camera/")))
		assertFalse(filter.shows(item(2, "Pictures/WhatsApp/")))
		assertFalse(filter.shows(item(3, "DCIM/Camera/", isVideo = true)))
	}

	@Test
	fun libraryShowsEverythingWhileBackupIsOffOrElsewhere() {
		assertNull(LibraryFilter.of(state(preference = PhotoBackupPreference())))
		assertNull(LibraryFilter.of(state(other = "Alex’s Umbrel Pro")))
	}

	// With "Select photos" the selection decides: no folder is skipped and none can be chosen.
	@Test
	fun selectedPhotosSkipNoFolders() {
		val selected = state(access = PhotoLibraryAccess.SELECTED)
		assertTrue(LibraryFilter.of(selected)!!.shows(item(1, "Pictures/WhatsApp/")))
		assertFalse(canChooseFolders(selected))
		assertTrue(skippedFolders(selected, LibraryFolders.of(listOf(item(1, "Pictures/WhatsApp/")))).isEmpty())
	}

	@Test
	fun theFolderChoiceWaitsOnlyUntilItIsMade() {
		assertTrue(folderChoicePending(state()))
		assertFalse(folderChoicePending(state(preference = PhotoBackupPreference(includesPhotos = true, foldersChosen = true))))
		assertFalse(folderChoicePending(state(access = PhotoLibraryAccess.SELECTED)))
	}

	// A skipped folder that has since emptied isn't on the phone to count.
	@Test
	fun skippedFoldersCountOnlyFoldersOnThePhone() {
		val folders = LibraryFolders.of(listOf(item(1, "DCIM/Camera/")))
		assertTrue(skippedFolders(state(), folders).isEmpty())
		assertEquals(1, skippedFolders(state(), LibraryFolders.of(listOf(item(1, "Pictures/WhatsApp/")))).size)
		assertEquals("1 folder skipped", skippedFoldersText(1))
		assertEquals("2 folders skipped", skippedFoldersText(2))
	}
}
