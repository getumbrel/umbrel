package com.umbrel.android.main

import com.umbrel.android.ui.MainTheme
import com.umbrel.kit.SavedAccountProfile
import com.umbrel.kit.SavedDevice
import com.umbrel.kit.backup.PhotoBackupNotice
import com.umbrel.kit.backup.PhotoBackupPreference
import com.umbrel.kit.backup.PhotoBackupStatistics
import com.umbrel.kit.backup.PhotoBackupStatus
import com.umbrel.kit.backup.PhotoBackupTarget
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LibraryBackupPresentationTest {
	private val on = PhotoBackupPreference(includesPhotos = true, includesVideos = true)

	private fun state(
		preference: PhotoBackupPreference = on,
		status: PhotoBackupStatus = PhotoBackupStatus.UpToDate,
		other: String? = null,
	) = MainUiState(
		device = SavedDevice("device", "Umbrel", "umbrel.local"),
		session = null,
		backupPreference = preference,
		backupStatus = status,
		otherBackupDeviceName = other,
	)

	// The notice under the title says where backup goes, so the status reads as Home's does.
	@Test
	fun anotherDestinationReplacesTheStatus() {
		val elsewhere = state(preference = PhotoBackupPreference(), status = PhotoBackupStatus.Off, other = "Alex’s Umbrel Pro")
		assertEquals("On another Umbrel", libraryBackupStatusText(elsewhere))
		assertEquals(MainTheme.gray, libraryBackupStatusColor(elsewhere))
	}

	// Backup goes elsewhere and this Umbrel has nothing from this phone, so the setup card says
	// where it goes in place of a library with nothing marked.
	@Test
	fun theLibraryGivesWayOnlyWhenThisUmbrelHasNothingFromThisPhone() {
		val elsewhere = state(preference = PhotoBackupPreference(), status = PhotoBackupStatus.Off, other = "Alex’s Umbrel Pro").copy(backupSourceResolved = true)
		assertTrue(backupIsOnlyElsewhere(elsewhere))
		assertFalse(showsPhotoLibrary(canReadLibrary = true, elsewhere))

		val nothingUploaded = elsewhere.copy(backupSourceId = "source", backupStatistics = PhotoBackupStatistics(0, 0, 0, 0, 0, 0))
		assertTrue(backupIsOnlyElsewhere(nothingUploaded))
		val olderBackups = elsewhere.copy(backupSourceId = "source", backupStatistics = PhotoBackupStatistics(0, 0, 3, 0, 0, 30))
		assertFalse(backupIsOnlyElsewhere(olderBackups))
		assertTrue(showsPhotoLibrary(canReadLibrary = true, olderBackups))
		// Unknown totals count as something, and nothing is hidden before the source is read.
		assertFalse(backupIsOnlyElsewhere(elsewhere.copy(backupSourceId = "source")))
		assertFalse(backupIsOnlyElsewhere(elsewhere.copy(backupSourceResolved = false)))

		assertFalse(backupIsOnlyElsewhere(state().copy(backupSourceResolved = true)))
		assertFalse(showsPhotoLibrary(canReadLibrary = false, state()))
	}

	// Android backs up a selection as it does the whole library, and like iOS before its first
	// request it can still ask for access. Once it can't, Settings is the way in.
	@Test
	fun theSetupCardOffersTheSwitchWheneverAccessCanBeHad() {
		assertEquals(PhotoBackupSetupCardKind.SET_UP, photoBackupSetupCardKind(state(), PhotoAccess.BLOCKED))
		val elsewhere = state(other = "Alex’s Umbrel Pro")
		for (access in listOf(PhotoAccess.FULL, PhotoAccess.LIMITED, PhotoAccess.NOT_DETERMINED, PhotoAccess.DENIED)) {
			assertEquals(access.name, PhotoBackupSetupCardKind.SWITCH, photoBackupSetupCardKind(elsewhere, access))
		}
		assertEquals(PhotoBackupSetupCardKind.SWITCH_NEEDS_SETTINGS, photoBackupSetupCardKind(elsewhere, PhotoAccess.BLOCKED))
		// Without access, the switch asks for it next.
		assertEquals(listOf(PhotoAccess.NOT_DETERMINED, PhotoAccess.DENIED), PhotoAccess.entries.filter { it.canRequest })
	}

	// Setup's progress is shared by every Umbrel, so another Umbrel's setup never reads as
	// switching here.
	@Test
	fun switchingShowsOnlyForThisUmbrel() {
		val elsewhere = state(preference = PhotoBackupPreference(), status = PhotoBackupStatus.Off, other = "Alex’s Umbrel Pro")
		assertFalse(backupSwitchInProgress(elsewhere))
		assertFalse(backupSwitchInProgress(elsewhere.copy(backupSetupInProgress = true)))
		assertTrue(backupSwitchInProgress(elsewhere.copy(backupSwitchChecking = true)))
		// Once claimed, this account owns backup and its setup is the switch.
		assertTrue(backupSwitchInProgress(elsewhere.copy(backupPreference = on, backupSetupInProgress = true)))
	}

	@Test
	fun theOtherUmbrelIsNamedSoItReadsApartFromThisOne() {
		val profiles = mapOf("0" to SavedAccountProfile("Alex", "1", role = "owner"), "sam" to SavedAccountProfile("Sam", "2", role = "member"))
		val current = SavedDevice("home", "umbrel", "umbrel.local", model = "Umbrel Pro", userName = "Alex", accountProfiles = profiles)
		val pro = SavedDevice("office", "umbrel", "office.local", model = "Umbrel Pro", accountProfiles = profiles)
		val home = SavedDevice("other", "umbrel", "umbrel.local", model = "Umbrel Home", accountProfiles = profiles)

		assertEquals("another Umbrel", backupDestinationName(PhotoBackupTarget("gone", "0"), null, current, "0"))
		assertEquals("Alex’s Umbrel Home", backupDestinationName(PhotoBackupTarget("other", "0"), home, current, "0"))
		assertEquals("Sam’s Umbrel Pro", backupDestinationName(PhotoBackupTarget("office", "sam"), pro, current, "0"))
		// Same model and owner: the host tells them apart, unless it's the same too.
		assertEquals("office.local", backupDestinationName(PhotoBackupTarget("office", "0"), pro, current, "0"))
		assertEquals("your other Umbrel Pro", backupDestinationName(PhotoBackupTarget("office", "0"), pro.copy(host = "UMBREL.local"), current, "0"))
		// An account this phone has no profile for reads as the last one used here.
		assertEquals("another account on this Umbrel", backupDestinationName(PhotoBackupTarget("home", "nate"), current, current, "0"))
	}

	@Test
	fun theNewPhoneQuestionNamesTheExistingSource() {
		assertEquals(
			"This account already has photos from “Nate’s Pixel”. If this phone was restored from it, backing up stores your photos again.",
			backupNoticeMessage(PhotoBackupNotice.MAY_BACK_UP_TWICE, state().copy(backupNewSourceQuestion = "Nate’s Pixel")),
		)
		assertEquals("Photos may be backed up twice", PhotoBackupNotice.MAY_BACK_UP_TWICE.title)
		assertEquals("Review", PhotoBackupNotice.MAY_BACK_UP_TWICE.actionLabel)
	}

	@Test
	fun statusFollowsTheUploader() {
		assertEquals("All backed up", libraryBackupStatusText(state()))
		assertEquals(MainTheme.online, libraryBackupStatusColor(state()))
		assertEquals("2 items queued", libraryBackupStatusText(state(status = PhotoBackupStatus.BackingUp(2))))
		assertEquals(MainTheme.syncing, libraryBackupStatusColor(state(status = PhotoBackupStatus.BackingUp(2))))
		assertEquals(MainTheme.red, libraryBackupStatusColor(state(status = PhotoBackupStatus.Error)))
		assertEquals("Waiting for Umbrel", libraryBackupStatusText(state(status = PhotoBackupStatus.WaitingForUmbrel)))
	}

	// A source registered earlier keeps its saved name on the Umbrel, which the app only knows
	// while backup is set up.
	@Test
	fun theSourceNameIsOnlyOneTheUmbrelUses() {
		assertEquals("Nate\u2019s Pixel 8a", backupSourceName("Nate\u2019s Pixel 8a", "source") { "Pixel 8a" })
		assertEquals("Pixel 8a", backupSourceName(null, null) { "Pixel 8a" })
		assertEquals(null, backupSourceName(null, "source") { "Pixel 8a" })
	}

	@Test
	fun waitingNamesTailscaleOnlyOnceTheUmbrelHasIt() {
		assertEquals(
			"Backup resumes when this phone is on the same network as your Umbrel. Set up Tailscale to back up from anywhere.",
			backupNoticeMessage(PhotoBackupNotice.WAITING_FOR_UMBREL, state()),
		)
		val tailscale = state().copy(device = SavedDevice("device", "Umbrel", "umbrel.local", addresses = listOf("192.168.1.20", "100.101.102.103")))
		assertEquals(
			"Make sure your Umbrel is turned on. Connect this phone to the same local network, or turn on Tailscale.",
			backupNoticeMessage(PhotoBackupNotice.WAITING_FOR_UMBREL, tailscale),
		)
		assertEquals(PhotoBackupNotice.INSUFFICIENT_STORAGE.message, backupNoticeMessage(PhotoBackupNotice.INSUFFICIENT_STORAGE, tailscale))
	}

	@Test
	fun theExplainerFollowsTheToggles() {
		val off = state(preference = PhotoBackupPreference(), status = PhotoBackupStatus.Off)
		assertEquals("Backup off", libraryBackupStatusText(off))
		assertEquals("Photos and videos already backed up remain on your Umbrel.", libraryBackupDescription(off))
		assertEquals(
			"Android schedules uploads in the background, even when this app is closed.",
			libraryBackupDescription(state(preference = PhotoBackupPreference(includesVideos = true))),
		)
	}

	@Test
	fun viewerStatusUsesTheToggleForTheItemsMediaType() {
		val photosOnly = state(preference = PhotoBackupPreference(includesPhotos = true))
		val photo = LocalMediaItem(1, isVideo = false, takenAtMs = 0, durationMs = null, width = 0, height = 0, generation = 0)
		val video = photo.copy(isVideo = true)
		assertTrue(backupIncludes(photosOnly, photo))
		assertFalse(backupIncludes(photosOnly, video))
	}
}
