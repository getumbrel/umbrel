package com.umbrel.android.main

import com.umbrel.kit.SavedDevice
import com.umbrel.kit.backup.PhotoBackupFailureReason
import com.umbrel.kit.backup.PhotoBackupLedger.AssetRecord
import com.umbrel.kit.backup.PhotoBackupLedger.AssetState
import com.umbrel.kit.backup.PhotoBackupLedger.FailedAsset
import com.umbrel.kit.backup.PhotoBackupNotice
import com.umbrel.kit.backup.PhotoBackupPreference
import com.umbrel.kit.backup.PhotoBackupStatistics
import com.umbrel.kit.backup.PhotoBackupStatus
import com.umbrel.kit.backup.PhotoLibraryAccess
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

class FailedUploadsTest {
	@Test
	fun leadClaimsOnlyWhatTheBackupStatusSupports() {
		assertEquals(
			"These 4 items aren’t backed up yet. Everything else from this phone is backed up.",
			failedUploadsLead(4, PhotoBackupStatus.UpToDateExceptFailures, backsUpEverything = true),
		)
		assertEquals(
			"This item isn’t backed up yet. Everything else from this phone is backed up.",
			failedUploadsLead(1, PhotoBackupStatus.UpToDateExceptFailures, backsUpEverything = true),
		)
		// A skipped folder, or videos that are turned off, aren't backed up
		assertEquals("These 4 items aren’t backed up yet.", failedUploadsLead(4, PhotoBackupStatus.UpToDateExceptFailures, backsUpEverything = false))
		assertEquals(PhotoBackupStatus.UpToDate.text, failedUploadsLead(0, PhotoBackupStatus.UpToDate, backsUpEverything = false))
		assertEquals("These 4 items aren’t backed up yet.", failedUploadsLead(4, PhotoBackupStatus.BackingUp(9), backsUpEverything = true))
		assertEquals("Everything from this phone is backed up.", failedUploadsLead(0, PhotoBackupStatus.UpToDate, backsUpEverything = true))
		// After Try Again the items are queued, not backed up
		assertEquals(PhotoBackupStatus.SettingUp.text, failedUploadsLead(0, PhotoBackupStatus.SettingUp, backsUpEverything = true))
		assertEquals(PhotoBackupStatus.UpToDateExceptSkipped.text, failedUploadsLead(0, PhotoBackupStatus.UpToDateExceptSkipped, backsUpEverything = false))
	}

	// "Everything else from this phone is backed up" has to be true of the whole phone
	@Test
	fun backupCoversEverythingOnlyWithAllMediaAllFoldersAndAccessToAllPhotos() {
		val photo = LocalMediaItem(id = 1, isVideo = false, takenAtMs = 0, durationMs = null, width = 0, height = 0, generation = 0)
		val camera = LibraryFolder("dcim/camera/", "Camera", photoCount = 1, videoCount = 0, newest = photo)
		fun state(
			preference: PhotoBackupPreference = PhotoBackupPreference(includesPhotos = true, includesVideos = true, foldersChosen = true),
			access: PhotoLibraryAccess = PhotoLibraryAccess.FULL,
		) = MainUiState(device = SavedDevice("device", "Umbrel", "umbrel.local"), session = null, backupPreference = preference, photoLibraryAccess = access)

		assertTrue(backsUpEverything(state(), listOf(camera)))
		// "Select photos": backup covers the selection, and the rest of the phone isn't backed up
		assertFalse(backsUpEverything(state(access = PhotoLibraryAccess.SELECTED), listOf(camera)))
		assertFalse(backsUpEverything(state(state().backupPreference.copy(includesVideos = false)), listOf(camera)))
		assertFalse(backsUpEverything(state(state().backupPreference.copy(includesPhotos = false)), listOf(camera)))
		assertFalse(backsUpEverything(state(state().backupPreference.copy(skippedFolders = setOf(camera.key))), listOf(camera)))
		// A skipped folder that has since emptied leaves nothing out
		assertTrue(backsUpEverything(state(state().backupPreference.copy(skippedFolders = setOf("pictures/gone/"))), listOf(camera)))
	}

	// Passes upload nothing while backup is paused or stopped, and only what the Umbrel
	// refused or kept failing on waits for Try Again.
	@Test
	fun noRetryIsPromisedOrOfferedWhereNoneHelps() {
		assertTrue(backupRetriesFailuresByItself(PhotoBackupStatus.UpToDateExceptFailures))
		assertTrue(backupRetriesFailuresByItself(PhotoBackupStatus.BackingUp(3)))
		assertFalse(backupRetriesFailuresByItself(PhotoBackupStatus.Paused))
		assertFalse(backupRetriesFailuresByItself(PhotoBackupStatus.Error))
		for (reason in PhotoBackupFailureReason.entries) {
			for (count in listOf(1, 3)) {
				assertFalse(reason.name, "by itself" in reason.note(count, retriesByItself = false))
				assertEquals(reason.name, reason == PhotoBackupFailureReason.UNREADABLE, "by itself" in reason.note(count, retriesByItself = true))
			}
			assertFalse(reason.name, "by itself" in reason.detail(retriesByItself = false))
			assertEquals(reason.name, reason == PhotoBackupFailureReason.UNREADABLE, "by itself" in reason.detail(retriesByItself = true))
			assertEquals(reason.name, reason == PhotoBackupFailureReason.GENERAL, reason.offersRetry)
		}
	}

	@Test
	fun notesSpeakOfOneItemOrSeveral() {
		assertEquals(
			"Android couldn’t open this just now. Umbrel tries it again by itself.",
			PhotoBackupFailureReason.UNREADABLE.note(1, retriesByItself = true),
		)
		assertEquals(
			"Android couldn’t open these just now. Umbrel tries them again by itself.",
			PhotoBackupFailureReason.UNREADABLE.note(2, retriesByItself = true),
		)
		assertEquals("Android couldn’t open this just now.", PhotoBackupFailureReason.UNREADABLE.note(1, retriesByItself = false))
		assertEquals("Something went wrong sending this to your Umbrel.", PhotoBackupFailureReason.GENERAL.note(1, retriesByItself = true))
		assertEquals("Something went wrong sending these to your Umbrel.", PhotoBackupFailureReason.GENERAL.note(2, retriesByItself = true))
		assertEquals(
			"This file is empty, so there’s nothing to upload. Nothing you need to do.",
			PhotoBackupFailureReason.NOTHING_TO_UPLOAD.note(1, retriesByItself = true),
		)
		assertEquals(
			"These files are empty, so there’s nothing to upload. Nothing you need to do.",
			PhotoBackupFailureReason.NOTHING_TO_UPLOAD.note(2, retriesByItself = true),
		)
	}

	@Test
	fun anItemThatCouldntBackUpIsMarkedOnlyWhileBackupCoversIt() {
		val failed = AssetRecord(AssetState.FAILED, 0, PhotoBackupFailureReason.GENERAL)
		val unreadable = AssetRecord(AssetState.UNREADABLE, 0, PhotoBackupFailureReason.UNREADABLE)

		assertEquals(BackupReceipt.Failed(PhotoBackupFailureReason.GENERAL), backupReceipt(failed, covered = true))
		assertEquals(BackupReceipt.Failed(PhotoBackupFailureReason.UNREADABLE), backupReceipt(unreadable, covered = true))
		// Its media type is off, its folder is skipped, or backup is off: Profile doesn't count it either
		assertEquals(BackupReceipt.None, backupReceipt(failed, covered = false))
		// A receipt stays whatever backup covers now
		assertEquals(BackupReceipt.BackedUp, backupReceipt(AssetRecord(AssetState.UPLOADED, 10), covered = false))
		assertEquals(BackupReceipt.None, backupReceipt(AssetRecord(AssetState.PENDING, 0), covered = true))
		assertEquals(BackupReceipt.None, backupReceipt(null, covered = true))
	}

	// Only a backup that's paused for storage or stopped is retried through its notice. With
	// any other notice, or none, backup is fine and the items are requeued at once: the notice's
	// request would show backup as starting until a pass ran, however long that took.
	@Test
	fun tryAgainRequeuesAtOnceUnlessBackupIsPausedForStorageOrStopped() {
		assertEquals(FailedUploadRetry.REQUEUE, failedUploadRetry(null))
		for (notice in PhotoBackupNotice.entries) {
			val expected = when (notice) {
				PhotoBackupNotice.INSUFFICIENT_STORAGE -> FailedUploadRetry.STORAGE
				PhotoBackupNotice.RECONNECT, PhotoBackupNotice.NEEDS_ATTENTION -> FailedUploadRetry.RECOVERY
				else -> FailedUploadRetry.REQUEUE
			}
			assertEquals(notice.name, expected, failedUploadRetry(notice))
		}
	}

	// The app's backup state changes with every upload. Reading the list again each time
	// would be a ledger query per item backed up, for as long as Profile is open.
	@Test
	fun theListIsReadAgainOnlyWhenWhatFailedCanHaveChanged() {
		fun state(uploaded: Long, failed: Long, unreadable: Long, revision: Long, sourceId: String? = "source") = MainUiState(
			device = SavedDevice("device", "Umbrel", "umbrel.local"),
			session = null,
			backupStatistics = PhotoBackupStatistics(queuedCount = 100 - uploaded, preparedCount = 1, uploadedPhotoCount = uploaded, uploadedVideoCount = 0, failedCount = failed, uploadedBytes = uploaded * 10, unreadableCount = unreadable, lastUploadedAtMs = revision),
			backupFailedCount = failed + unreadable,
			backupSourceId = sourceId,
			backupReceiptRevision = revision,
			backupStatus = PhotoBackupStatus.BackingUp(100 - uploaded),
		)
		val version = FailedUploadsVersion.of(state(uploaded = 10, failed = 2, unreadable = 1, revision = 1))

		// An upload: the revision, the totals and the status move on, what failed doesn't
		assertEquals(version, FailedUploadsVersion.of(state(uploaded = 11, failed = 2, unreadable = 1, revision = 2)))
		// An item fails, is requeued, or goes from unreadable to failed
		assertNotEquals(version, FailedUploadsVersion.of(state(uploaded = 10, failed = 3, unreadable = 1, revision = 2)))
		assertNotEquals(version, FailedUploadsVersion.of(state(uploaded = 10, failed = 0, unreadable = 1, revision = 2)))
		assertNotEquals(version, FailedUploadsVersion.of(state(uploaded = 10, failed = 3, unreadable = 0, revision = 2)))
		assertNotEquals(version, FailedUploadsVersion.of(state(uploaded = 10, failed = 2, unreadable = 1, revision = 1, sourceId = "other")))
		// Nothing failed: nothing is read
		assertTrue(FailedUploadsVersion.of(state(uploaded = 11, failed = 0, unreadable = 0, revision = 3)).isEmpty)
		assertFalse(version.isEmpty)
		// Backup that isn't set up here counts none, whatever its last totals were
		assertTrue(FailedUploadsVersion.of(state(uploaded = 10, failed = 2, unreadable = 1, revision = 1).copy(backupFailedCount = 0)).isEmpty)
	}

	@Test
	fun aLongFileNameKeepsItsStartAndItsEnd() {
		fun fitting(length: Int): (String) -> Boolean = { it.length <= length }

		assertEquals("IMG_0042.jpg", middleTruncated("IMG_0042.jpg", fitting(12)))
		// As much as fits, the odd character going to the start
		assertEquals("IMG_2…3.jpg", middleTruncated("IMG_20261120_103245123.jpg", fitting(11)))
		assertEquals("IMG_20…3.jpg", middleTruncated("IMG_20261120_103245123.jpg", fitting(12)))
		// A character made of two isn't cut in half
		assertEquals("ab…e🙂", middleTruncated("ab🙂cd🙂e🙂", fitting(6)))
		assertEquals("…", middleTruncated("IMG_0042.jpg", fitting(1)))
	}
}

// Robolectric for android.net.Uri, which an item's identifier is made from.
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [37])
class FailedUploadsListTest {
	private fun item(id: Long, isVideo: Boolean = false) =
		LocalMediaItem(id = id, isVideo = isVideo, takenAtMs = 0, durationMs = null, width = 0, height = 0, generation = 0)

	// One section per reason that has items, in the order the reasons are listed, each newest first
	@Test
	fun sectionsFollowTheReasonOrderAndHoldEveryItemOnce() {
		val items = (1L..4L).map { item(it) }
		val (a, b, c, d) = items
		val assets = listOf(
			FailedAsset(a.localIdentifier, PhotoBackupFailureReason.GENERAL),
			FailedAsset(b.localIdentifier, PhotoBackupFailureReason.NOTHING_TO_UPLOAD),
			FailedAsset(c.localIdentifier, PhotoBackupFailureReason.UNREADABLE),
			FailedAsset(d.localIdentifier, PhotoBackupFailureReason.GENERAL),
		)

		val uploads = FailedUploads.of(assets, library = items)

		assertEquals(
			listOf(
				PhotoBackupFailureReason.UNREADABLE to listOf(c),
				PhotoBackupFailureReason.GENERAL to listOf(a, d),
				PhotoBackupFailureReason.NOTHING_TO_UPLOAD to listOf(b),
			),
			uploads.byReason.toList(),
		)
		assertEquals(4, uploads.count)
		// A reason nothing failed for has no section
		assertEquals(setOf(PhotoBackupFailureReason.GENERAL), FailedUploads.of(assets.take(1), library = items).byReason.keys)
		assertEquals(0, FailedUploads.of(emptyList(), library = items).count)
	}

	// Deleted since it failed, or no longer visible to the app: the ledger hears on a later pass
	@Test
	fun anItemTheLibraryNoLongerShowsIsNeitherCountedNorListed() {
		val photo = item(1)
		val video = item(2, isVideo = true)
		val gone = item(3)
		val assets = listOf(
			FailedAsset(gone.localIdentifier, PhotoBackupFailureReason.GENERAL),
			FailedAsset(video.localIdentifier, PhotoBackupFailureReason.GENERAL),
			FailedAsset(photo.localIdentifier, PhotoBackupFailureReason.UNREADABLE),
		)

		val uploads = FailedUploads.of(assets, library = listOf(photo, video, item(4)))

		// The row's count, the page's total and its sections are one list, each item with its thumbnail
		assertEquals(2, uploads.count)
		assertEquals(
			mapOf(PhotoBackupFailureReason.UNREADABLE to listOf(photo), PhotoBackupFailureReason.GENERAL to listOf(video)),
			uploads.byReason,
		)
	}

	// As when Android has taken photo access back: nothing can be shown, so nothing is counted
	@Test
	fun nothingIsListedWhileTheLibraryShowsNothing() {
		val uploads = FailedUploads.of(listOf(FailedAsset(item(1).localIdentifier, PhotoBackupFailureReason.GENERAL)), library = emptyList())

		assertEquals(0, uploads.count)
		assertTrue(uploads.byReason.isEmpty())
	}
}
