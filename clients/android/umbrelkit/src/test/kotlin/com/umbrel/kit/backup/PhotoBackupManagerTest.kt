package com.umbrel.kit.backup

import android.content.Context
import android.provider.Settings
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.umbrel.kit.SavedDevice
import com.umbrel.kit.Umbreld
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(AndroidJUnit4::class)
class PhotoBackupManagerTest {
	private class RecordingWork : PhotoBackupManager.Work {
		val events = mutableListOf<String>()
		override fun start(configuration: PhotoBackupConfiguration) {
			events += "start"
		}
		override fun cancel() {
			events += "cancel"
		}
		override suspend fun requestPass() {
			events += "pass"
		}
		override suspend fun startUserInitiatedTransfer() {
			events += "transfer"
		}
	}

	private lateinit var directory: File
	private lateinit var preferences: PhotoBackupPreferences
	private val server = FakeServer()
	private val secrets = FakeSecrets()
	private val work = RecordingWork()
	private var access = PhotoLibraryAccess.FULL
	private val device = SavedDevice("umbrel", "Umbrel", "umbrel.local", addresses = listOf("192.168.1.10", "100.90.0.1"))
	private val session = Umbreld.Session("umbrel", "0", "access", Long.MAX_VALUE, "device-token")
	// Past the folder choice that comes with turning backup on, as in the app after "Start backup".
	private val photos = PhotoBackupPreference(includesPhotos = true, includesVideos = true, foldersChosen = true)

	@Before
	fun setUp() {
		val context = ApplicationProvider.getApplicationContext<Context>()
		context.getSharedPreferences(PhotoBackupPreferences.FILE_NAME, Context.MODE_PRIVATE).edit().clear().commit()
		context.getSharedPreferences(PhotoBackupPreferences.IDENTITY_FILE_NAME, Context.MODE_PRIVATE).edit().clear().commit()
		Settings.Secure.putString(context.contentResolver, Settings.Secure.ANDROID_ID, "this-phone")
		preferences = PhotoBackupPreferences(context)
		directory = File(System.getProperty("java.io.tmpdir"), "umbrel-manager-" + System.nanoTime()).apply { mkdirs() }
		secrets.sessions["umbrel"] = session
	}

	@After
	fun tearDown() {
		directory.deleteRecursively()
	}

	private fun TestScope.manager(): PhotoBackupManager {
		val dispatcher = StandardTestDispatcher(testScheduler)
		return PhotoBackupManager(
			preferences = preferences,
			ledgerFile = File(directory, "photo-backup.sqlite"),
			server = server,
			secrets = secrets,
			work = work,
			libraryAccess = { access },
			locationAccess = { true },
			backgroundRestricted = { false },
			defaultNetwork = { PhotoBackupNetwork.Traits(wifiOrEthernet = true, unmetered = true, roaming = false) },
			suggestedName = { "Android phone" },
			scope = CoroutineScope(dispatcher),
			ioDispatcher = dispatcher,
		).apply { setDeviceLookup { if (it == device.id) device else null } }
	}

	// Turning backup on away from the Umbrel keeps the choice and waits; it is no failure.
	@Test
	fun turningBackupOnAwayFromTheUmbrelKeepsTheChoiceAndWaits() = runTest {
		server.grantError = Umbreld.Error(0, "Could not reach this Umbrel", Umbreld.ErrorKind.CONNECTIVITY)
		val manager = manager()

		manager.setPreference(device, session, photos)
		advanceUntilIdle()

		assertTrue(manager.preference(device.id, session.accountId).isEnabled)
		assertNull(preferences.configuration)
		assertFalse(manager.state.value.setupInProgress)
		assertNull(manager.state.value.setupFailure)
		val waiting = manager.presentation(device, session.accountId, PhotoLibraryCounts(), null)
		assertEquals(PhotoBackupStatus.WaitingForUmbrel, waiting.status)
		assertEquals(PhotoBackupNotice.WAITING_FOR_UMBREL, waiting.notice)
		assertEquals(PhotoBackupNotice.Action.SET_UP_TAILSCALE, waiting.notice?.action)

		// Reaching the Umbrel later finishes setup without another tap.
		server.grantError = null
		assertTrue(manager.resumeWaitingSetup(device, session))
		advanceUntilIdle()

		val configuration = preferences.configuration!!
		assertEquals(device.id, configuration.deviceId)
		assertEquals("grant-1", secrets.grants["umbrel:0"])
		assertEquals(configuration.source.id, secrets.sourceIds["umbrel:0"])
		assertTrue("start" in work.events)
	}

	// No Tailscale address is needed: setup completes on the local network alone.
	@Test
	fun backupSetsUpWithoutATailscaleAddress() = runTest {
		val manager = manager()
		val local = device.copy(addresses = listOf("192.168.1.10"))

		manager.setPreference(local, session, photos)
		advanceUntilIdle()

		assertNotNull(preferences.configuration)
		assertEquals(listOf("start", "transfer"), work.events)
	}

	@Test
	fun turningBackupOnStartsAUserInitiatedTransfer() = runTest {
		val manager = manager()

		manager.setPreference(device, session, photos)
		advanceUntilIdle()

		assertNotNull(preferences.configuration)
		assertEquals(listOf("start", "transfer"), work.events)
		assertEquals(PhotoBackupPhase.WAITING, preferences.snapshot.phase)
	}

	// Nothing uploads before the user could skip a folder.
	@Test
	fun setupWithAccessToAllPhotosWaitsForTheFolderChoice() = runTest {
		val manager = manager()

		manager.enableBackup(device, session)
		advanceUntilIdle()
		assertTrue(manager.preference(device.id, session.accountId).isEnabled)
		assertNull(preferences.configuration)
		assertTrue(work.events.isEmpty())
		assertFalse(manager.resumeWaitingSetup(device, session))
		assertEquals(PhotoBackupStatus.SettingUp, manager.presentation(device, session.accountId, PhotoLibraryCounts(), null).status)

		// The choice's switches save as they change, and setup still waits.
		val enabled = manager.preference(device.id, session.accountId)
		manager.setPreference(device, session, enabled.copy(skippedFolders = setOf("pictures/whatsapp/")))
		advanceUntilIdle()
		assertNull(preferences.configuration)

		manager.confirmFolderChoice(device, session)
		advanceUntilIdle()

		assertEquals(setOf("pictures/whatsapp/"), preferences.configuration?.skippedFolders)
		assertEquals(listOf("start", "transfer"), work.events)
	}

	// The selection already decides what's backed up, so there's no folder choice to wait for.
	@Test
	fun setupWithSelectedPhotosStartsWithoutTheFolderChoice() = runTest {
		access = PhotoLibraryAccess.SELECTED
		val manager = manager()

		manager.enableBackup(device, session)
		advanceUntilIdle()

		assertNotNull(preferences.configuration)
		assertEquals(listOf("start", "transfer"), work.events)
	}

	@Test
	fun skippingAFolderReachesTheWorkerWithoutANewGrant() = runTest {
		val manager = manager()
		manager.setPreference(device, session, photos)
		advanceUntilIdle()
		val source = preferences.configuration!!.source

		manager.setPreference(device, session, photos.copy(skippedFolders = setOf("pictures/whatsapp/")))
		advanceUntilIdle()

		assertEquals(setOf("pictures/whatsapp/"), preferences.configuration?.skippedFolders)
		assertEquals(source, preferences.configuration?.source)
		assertEquals(1, server.grantsCreated.size)
	}

	@Test
	fun withoutPhotoAccessTheChoiceWaitsForThePermissionResult() = runTest {
		access = PhotoLibraryAccess.NONE
		val manager = manager()

		manager.setPreference(device, session, photos)
		advanceUntilIdle()
		assertTrue(manager.preference(device.id, session.accountId).isEnabled)
		assertTrue(server.grantsCreated.isEmpty())

		// Refusing access in answer to turning backup on turns it back off.
		manager.libraryAccessChanged(device, session, userInitiated = true, deniedTurnsOff = true)
		advanceUntilIdle()
		assertFalse(manager.preference(device.id, session.accountId).isEnabled)
		assertNull(preferences.activeTarget)
	}

	@Test
	fun grantingPhotoAccessFinishesSetup() = runTest {
		access = PhotoLibraryAccess.NONE
		val manager = manager()
		manager.setPreference(device, session, photos)
		advanceUntilIdle()

		access = PhotoLibraryAccess.SELECTED
		manager.libraryAccessChanged(device, session, userInitiated = true)
		advanceUntilIdle()

		assertNotNull(preferences.configuration)
		assertEquals(listOf("start", "transfer"), work.events)
	}

	// Android revokes the permissions of an app left unused for months; backup must come back
	// with access instead of staying off.
	@Test
	fun revokedPhotoAccessPausesBackupUntilAccessReturns() = runTest {
		val manager = manager()
		manager.setPreference(device, session, photos)
		advanceUntilIdle()
		val configuration = preferences.configuration

		access = PhotoLibraryAccess.NONE
		manager.libraryAccessChanged(device, session, userInitiated = false)
		advanceUntilIdle()

		assertEquals(configuration, preferences.configuration)
		assertTrue(manager.preference(device.id, session.accountId).isEnabled)
		assertEquals("grant-1", secrets.grants["umbrel:0"])
		assertEquals(0, server.revocations)
		assertEquals(PhotoBackupStatus.Paused, manager.presentation(device, session.accountId, PhotoLibraryCounts(), null).status)

		work.events.clear()
		access = PhotoLibraryAccess.FULL
		manager.libraryAccessChanged(device, session, userInitiated = false)
		advanceUntilIdle()
		assertEquals(listOf("start", "pass"), work.events)
	}

	@Test
	fun refusingAccessWhileBackupIsPausedKeepsItOn() = runTest {
		val manager = manager()
		manager.setPreference(device, session, photos)
		advanceUntilIdle()

		access = PhotoLibraryAccess.NONE
		manager.libraryAccessChanged(device, session, userInitiated = true)
		advanceUntilIdle()

		assertTrue(manager.preference(device.id, session.accountId).isEnabled)
		assertNotNull(preferences.configuration)
	}

	@Test
	fun signingOutKeepsThePreferenceSoSigningInResumesBackup() = runTest {
		val manager = manager()
		manager.setPreference(device, session, photos)
		advanceUntilIdle()
		val sourceId = preferences.configuration!!.source.id

		manager.disableLocally(device.id)

		assertNull(preferences.configuration)
		assertNull(secrets.grants["umbrel:0"])
		assertTrue("cancel" in work.events)
		assertTrue(manager.preference(device.id, session.accountId).isEnabled)
		assertTrue(preferences.isActive(device.id, session.accountId))

		manager.libraryAccessChanged(device, session, userInitiated = false)
		advanceUntilIdle()
		assertEquals(sourceId, preferences.configuration?.source?.id)
	}

	@Test
	fun turningBothTypesOffRevokesTheGrantAndKeepsTheSourceId() = runTest {
		val manager = manager()
		manager.setPreference(device, session, photos)
		advanceUntilIdle()

		manager.setPreference(device, session, PhotoBackupPreference())
		advanceUntilIdle()

		assertNull(preferences.configuration)
		assertNull(preferences.activeTarget)
		assertNull(secrets.grants["umbrel:0"])
		assertNotNull(secrets.sourceIds["umbrel:0"])
		assertEquals(1, server.revocations)
	}

	@Test
	fun anUnreadableSourceIdIsNeverReplacedWithANewOne() = runTest {
		secrets.sourceIdUnavailable = true
		val manager = manager()

		manager.setPreference(device, session, photos)
		advanceUntilIdle()

		assertTrue(server.grantsCreated.isEmpty())
		assertTrue(secrets.sourceIds.isEmpty())
		assertNull(preferences.configuration)
		assertNotNull(manager.state.value.setupFailure)
		assertEquals(PhotoBackupStatus.Error, manager.presentation(device, session.accountId, PhotoLibraryCounts(), null).status)
	}

	@Test
	fun aSourceForAnotherAccountIsRejectedAndRevoked() = runTest {
		server.grantSource = { Umbreld.PhotoBackupSource(it, "someone-else", "Android phone") }
		val manager = manager()

		manager.setPreference(device, session, photos)
		advanceUntilIdle()

		assertNull(preferences.configuration)
		assertNull(secrets.grants["umbrel:0"])
		assertEquals(1, server.revocations)
		assertNotNull(manager.state.value.setupFailure)
	}

	@Test
	fun anotherAccountCannotTakeOverBackup() = runTest {
		val manager = manager()
		manager.setPreference(device, session, photos)
		advanceUntilIdle()
		val member = Umbreld.Session("umbrel", "nate", "access", Long.MAX_VALUE, "device-token")

		manager.setPreference(device, member, photos)
		advanceUntilIdle()

		assertEquals("0", preferences.configuration?.source?.accountId)
		assertEquals(PhotoBackupTarget("umbrel", "0"), manager.otherTarget("umbrel", "nate"))
		assertFalse(manager.preference("umbrel", "nate").isEnabled)
	}

	@Test
	fun reconnectReplacesARejectedGrantAndRequestsRecovery() = runTest {
		val manager = manager()
		manager.setPreference(device, session, photos)
		advanceUntilIdle()
		val sourceId = preferences.configuration!!.source.id
		preferences.publish(PhotoBackupSnapshot(PhotoBackupPhase.NEEDS_ATTENTION, PhotoBackupIssue.AUTHENTICATION_REQUIRED, sourceId = sourceId))
		assertEquals(PhotoBackupNotice.RECONNECT, manager.presentation(device, session.accountId, PhotoLibraryCounts(), null).notice)

		server.grantToken = "grant-2"
		manager.retryAfterError(device, session)
		advanceUntilIdle()

		assertEquals("grant-2", secrets.grants["umbrel:0"])
		assertEquals(sourceId, preferences.configuration?.source?.id)
		assertTrue(preferences.recoveryRetryRequested(sourceId))
		assertEquals(PhotoBackupPhase.WAITING, preferences.snapshot.phase)
		assertNull(preferences.snapshot.issue)
	}

	@Test
	fun reconnectAfterTheBackupWasRemovedStartsANewOne() = runTest {
		val manager = manager()
		manager.setPreference(device, session, photos)
		advanceUntilIdle()
		val removed = preferences.configuration!!.source.id
		preferences.publish(PhotoBackupSnapshot(PhotoBackupPhase.NEEDS_ATTENTION, PhotoBackupIssue.AUTHENTICATION_REQUIRED, sourceId = removed))
		server.backupSources = Umbreld.PhotoBackupSources(listOf("continue-source"), emptyList())

		manager.retryAfterError(device, session)
		advanceUntilIdle()

		val source = preferences.configuration?.source?.id
		assertNotNull(source)
		assertNotEquals(removed, source)
		assertEquals(source, secrets.sourceIds["umbrel:0"])
		assertEquals(source, server.grantsCreated.last())
		assertEquals(PhotoBackupPhase.WAITING, preferences.snapshot.phase)
	}

	@Test
	fun reconnectKeepsTheBackupTheUmbrelStillHas() = runTest {
		val manager = manager()
		manager.setPreference(device, session, photos)
		advanceUntilIdle()
		val sourceId = preferences.configuration!!.source.id
		preferences.publish(PhotoBackupSnapshot(PhotoBackupPhase.NEEDS_ATTENTION, PhotoBackupIssue.AUTHENTICATION_REQUIRED, sourceId = sourceId))
		server.backupSources = Umbreld.PhotoBackupSources(
			listOf("continue-source"),
			listOf(Umbreld.PhotoBackupSourceDetails(sourceId, "Pixel", "android")),
		)

		manager.retryAfterError(device, session)
		advanceUntilIdle()

		assertEquals(sourceId, preferences.configuration?.source?.id)
		assertEquals(sourceId, server.grantsCreated.last())
	}

	@Test
	fun reconnectKeepsTheBackupWhenTheUmbrelCantListBackups() = runTest {
		val manager = manager()
		manager.setPreference(device, session, photos)
		advanceUntilIdle()
		val sourceId = preferences.configuration!!.source.id
		preferences.publish(PhotoBackupSnapshot(PhotoBackupPhase.NEEDS_ATTENTION, PhotoBackupIssue.AUTHENTICATION_REQUIRED, sourceId = sourceId))
		server.backupSourcesError = Umbreld.Error(500, "Internal server error")

		manager.retryAfterError(device, session)
		advanceUntilIdle()

		assertEquals(1, server.backupSourceReads)
		assertEquals(sourceId, preferences.configuration?.source?.id)
		assertEquals(sourceId, server.grantsCreated.last())
	}

	// ── A phone set up from another ──

	private fun carried(vararg sources: Umbreld.PhotoBackupSourceDetails) = Umbreld.PhotoBackupSources(listOf("continue-source"), sources.toList())

	private val oldBackup = Umbreld.PhotoBackupSourceDetails("old-source", "Pixel 7", "android")

	/** As Android's backup or phone-to-phone transfer brings it from the old phone. */
	private fun carriedFromAnotherPhone(sourceId: String = "old-source") {
		val context = ApplicationProvider.getApplicationContext<Context>()
		Settings.Secure.putString(context.contentResolver, Settings.Secure.ANDROID_ID, "old-phone")
		PhotoBackupPreferences(context).setCarriedSourceId(sourceId, device.id, session.accountId)
		Settings.Secure.putString(context.contentResolver, Settings.Secure.ANDROID_ID, "this-phone")
	}

	private fun PhotoBackupManager.continuingName() = presentation(device, session.accountId, PhotoLibraryCounts(), null).continuingName

	@Test
	fun aPhoneSetUpFromAnotherCarriesOnItsBackup() = runTest {
		carriedFromAnotherPhone()
		server.backupSources = carried(oldBackup)

		val manager = manager()
		manager.setPreference(device, session, photos)
		advanceUntilIdle()

		assertEquals("old-source", secrets.sourceIds["umbrel:0"])
		assertEquals("old-source", preferences.configuration?.source?.id)
		// Renamed after this phone, and Library names the old backup until it has caught up
		assertEquals(listOf(true), server.continuations)
		assertEquals(listOf("Android phone"), server.suggestedNames)
		assertNull(preferences.renamePending(device.id, session.accountId))
		assertEquals("Pixel 7", manager.continuingName())
	}

	@Test
	fun aBackupFromBeforePlatformsWereRecordedIsCarriedOn() = runTest {
		carriedFromAnotherPhone()
		server.backupSources = carried(oldBackup.copy(platform = null))

		manager().setPreference(device, session, photos)
		advanceUntilIdle()

		assertEquals(listOf("old-source"), server.grantsCreated)
		assertEquals(listOf(true), server.continuations)
	}

	// The same phone after a reinstall keeps its backup's name, which the user may have chosen
	@Test
	fun aReinstallCarriesOnWithoutRenaming() = runTest {
		preferences.setCarriedSourceId("old-source", device.id, session.accountId)
		server.backupSources = carried(oldBackup.copy(name = "Nate’s photos"))

		val manager = manager()
		manager.setPreference(device, session, photos)
		advanceUntilIdle()

		assertEquals(listOf("old-source"), server.grantsCreated)
		assertEquals(listOf(false), server.continuations)
		assertNull(manager.continuingName())
	}

	@Test
	fun theOldPhonesNameIsntTakenWhenItMatchesThisOne() = runTest {
		carriedFromAnotherPhone()
		server.sources += Umbreld.PhotoSourceSummary("android", "Android phone", Umbreld.PhotoSourceSummary.Stats(900, 20))
		server.backupSources = carried(oldBackup.copy(name = "Android phone"))

		manager().setPreference(device, session, photos)
		advanceUntilIdle()

		assertEquals(listOf("Android phone"), server.suggestedNames)
	}

	// The first grant renamed the backup but its answer never arrived: the retry mustn't count
	// the new name as another backup's
	@Test
	fun aRetryAfterALostGrantKeepsTheName() = runTest {
		carriedFromAnotherPhone()
		server.backupSources = carried(oldBackup)
		server.grantError = Umbreld.Error(0, "Could not reach this Umbrel", Umbreld.ErrorKind.CONNECTIVITY)
		val manager = manager()
		manager.setPreference(device, session, photos)
		advanceUntilIdle()
		assertEquals("old-source", secrets.sourceIds["umbrel:0"])
		assertEquals(PhotoBackupStatus.WaitingForUmbrel, manager.presentation(device, session.accountId, PhotoLibraryCounts(), null).status)

		server.grantError = null
		server.backupSources = carried(oldBackup.copy(name = "Android phone"))
		server.sources += Umbreld.PhotoSourceSummary("android", "Android phone", Umbreld.PhotoSourceSummary.Stats(900, 20))
		assertTrue(manager.resumeWaitingSetup(device, session))
		advanceUntilIdle()

		assertEquals(listOf("Android phone"), server.suggestedNames)
		assertEquals(listOf(true), server.continuations)
		assertNull(preferences.renamePending(device.id, session.accountId))
	}

	// Without the account's backups the rename can't be named apart from them
	@Test
	fun aRetryThatCantReadTheBackupsFails() = runTest {
		carriedFromAnotherPhone()
		server.backupSources = carried(oldBackup)
		server.grantError = Umbreld.Error(0, "Could not reach this Umbrel", Umbreld.ErrorKind.CONNECTIVITY)
		val manager = manager()
		manager.setPreference(device, session, photos)
		advanceUntilIdle()

		server.grantError = null
		server.backupSourcesError = Umbreld.Error(500, "Photos library is unavailable")
		assertTrue(manager.resumeWaitingSetup(device, session))
		advanceUntilIdle()

		assertTrue(server.grantsCreated.isEmpty())
		assertEquals("Photos library is unavailable", manager.state.value.setupFailure)
	}

	@Test
	fun anUmbrelOutOfReachIsWaitedForBeforeChoosing() = runTest {
		carriedFromAnotherPhone()
		server.backupSourcesError = Umbreld.Error(0, "Could not reach this Umbrel", Umbreld.ErrorKind.CONNECTIVITY)
		val manager = manager()
		manager.setPreference(device, session, photos)
		advanceUntilIdle()
		assertNull(secrets.sourceIds["umbrel:0"])
		assertNull(manager.state.value.setupFailure)

		server.backupSourcesError = null
		server.backupSources = carried(oldBackup)
		assertTrue(manager.resumeWaitingSetup(device, session))
		advanceUntilIdle()

		assertEquals(listOf("old-source"), server.grantsCreated)
		assertEquals(listOf(true), server.continuations)
	}

	@Test
	fun onlyABackupTheUmbrelStillHasIsCarriedOn() = runTest {
		val refused = listOf(
			"umbrelOS 2.0" to null,
			"removed" to carried(),
			"an iPhone's" to carried(oldBackup.copy(platform = "ios")),
			"not supported" to Umbreld.PhotoBackupSources(emptyList(), listOf(oldBackup)),
		)
		for ((case, listed) in refused) {
			secrets.sourceIds.clear()
			secrets.grants.clear()
			server.continuations.clear()
			preferences.clearConfiguration()
			carriedFromAnotherPhone()
			server.backupSources = listed

			manager().setPreference(device, session, photos)
			advanceUntilIdle()

			val source = secrets.sourceIds["umbrel:0"]
			assertNotNull(case, source)
			assertNotEquals(case, "old-source", source)
			assertEquals(case, listOf(false), server.continuations)
			assertNull(case, preferences.renamePending(device.id, session.accountId))
		}
	}

	// Without the answer the phone can't tell whether to carry on its backup, so it doesn't start a new one
	@Test
	fun aFailedReadOfTheBackupsStartsNoNewOne() = runTest {
		carriedFromAnotherPhone()
		server.backupSourcesError = Umbreld.Error(500, "Photos library is unavailable")

		val manager = manager()
		manager.setPreference(device, session, photos)
		advanceUntilIdle()

		assertNull(secrets.sourceIds["umbrel:0"])
		assertTrue(server.grantsCreated.isEmpty())
		assertEquals("Photos library is unavailable", manager.state.value.setupFailure)
	}

	@Test
	fun aPhoneWithoutACarriedIdDoesntAsk() = runTest {
		manager().setPreference(device, session, photos)
		advanceUntilIdle()

		assertEquals(0, server.backupSourceReads)
		assertEquals(listOf(false), server.continuations)
	}

	@Test
	fun anotherAccountsIdIsntCarriedOn() = runTest {
		carriedFromAnotherPhone()
		server.backupSources = carried(oldBackup)
		val member = Umbreld.Session("umbrel", "nate", "access", Long.MAX_VALUE, "device-token")
		secrets.sessions["umbrel"] = member

		manager().setPreference(device, member, photos)
		advanceUntilIdle()

		assertEquals(0, server.backupSourceReads)
		assertNotEquals("old-source", secrets.sourceIds["umbrel:nate"])
	}

	// Android's backup carries the copy to a new phone, including from phones set up before it
	// existed and phones whose backup is off for now
	@Test
	fun theBackupIdIsCopiedWhereAndroidBacksItUp() = runTest {
		val manager = manager()
		manager.setPreference(device, session, photos)
		advanceUntilIdle()
		assertEquals(secrets.sourceIds["umbrel:0"], preferences.carriedSourceId(device.id, session.accountId))

		secrets.sourceIds["umbrel:0"] = "existing-source"
		manager.setPreference(device, session, PhotoBackupPreference())
		advanceUntilIdle()
		manager.sync(device, session, userInitiated = false)
		assertEquals("existing-source", preferences.carriedSourceId(device.id, session.accountId))
		assertTrue(preferences.carriedFromThisPhone(device.id, session.accountId))
	}

	@Test
	fun insufficientStorageRetryIsExplicitAndScopedToTheSource() = runTest {
		val manager = manager()
		manager.setPreference(device, session, photos)
		advanceUntilIdle()
		val sourceId = preferences.configuration!!.source.id
		preferences.publish(PhotoBackupSnapshot(PhotoBackupPhase.NEEDS_ATTENTION, PhotoBackupIssue.INSUFFICIENT_STORAGE, sourceId = sourceId))
		assertEquals(PhotoBackupNotice.INSUFFICIENT_STORAGE, manager.presentation(device, session.accountId, PhotoLibraryCounts(), null).notice)

		manager.retryAfterInsufficientStorage()
		advanceUntilIdle()

		assertTrue(preferences.storageRetryRequested(sourceId))
		assertEquals(PhotoBackupStatus.CheckingStorage, manager.presentation(device, session.accountId, PhotoLibraryCounts(), null).status)
		assertEquals("transfer", work.events.last())
	}

	@Test
	fun aConfigurationLeftForAnotherAccountStops() = runTest {
		val manager = manager()
		manager.setPreference(device, session, photos)
		advanceUntilIdle()

		manager.releaseStaleConfiguration(device.id, signedInAccountId = "0")
		assertNotNull(preferences.configuration)

		manager.releaseStaleConfiguration(device.id, signedInAccountId = "nate")
		assertNull(preferences.configuration)
		assertNull(secrets.grants["umbrel:0"])
		assertTrue(preferences.isActive(device.id, "0"))
	}

	@Test
	fun removingTheUmbrelClearsItsIntentButKeepsTheSourceId() = runTest {
		val manager = manager()
		manager.setPreference(device, session, photos)
		advanceUntilIdle()

		manager.removeDevice(device.id)

		assertNull(preferences.configuration)
		assertFalse(preferences.preference(device.id, session.accountId).isEnabled)
		assertNotNull(secrets.sourceIds["umbrel:0"])
	}

	// ── A new phone ──

	private val oldPhone = Umbreld.PhotoSourceSummary("iphone", "Nate’s Pixel", Umbreld.PhotoSourceSummary.Stats(1200, 30), lastImportAt = 1_700_000_000_000.0)

	private fun PhotoBackupManager.presentation() = presentation(device, session.accountId, PhotoLibraryCounts(), null)

	// A new or reinstalled phone starts its own backup without asking, as on iOS, even when the
	// account has other phones' backups.
	@Test
	fun aNewPhoneStartsItsOwnBackupWithoutAsking() = runTest {
		server.sources += oldPhone
		val manager = manager()

		manager.setPreference(device, session, photos)
		advanceUntilIdle()

		assertNotNull(preferences.configuration)
		assertEquals(preferences.configuration?.source?.id, secrets.sourceIds["umbrel:0"])
		assertEquals(listOf("start", "transfer"), work.events)
		assertNull(manager.presentation().notice)
	}

	// An account with no phone sources yet reads them once: an empty list is an answer.
	@Test
	fun aFirstSetupReadsTheAccountsSourcesOnce() = runTest {
		manager().setPreference(device, session, photos)
		advanceUntilIdle()

		assertEquals(1, server.sourceReads)
		assertEquals(1, server.grantsCreated.size)
	}

	@Test
	fun aNewBackupTakesAFreeName() = runTest {
		server.sources += Umbreld.PhotoSourceSummary("iphone", "Android phone", Umbreld.PhotoSourceSummary.Stats(10, 0))
		manager().setPreference(device, session, photos)
		advanceUntilIdle()

		assertEquals(listOf("Android phone (2)"), server.suggestedNames)
		assertNotNull(preferences.configuration)
	}

	// Nothing asks the Umbrel or uploads before the folder choice is answered.
	@Test
	fun setupWaitsForTheFolderChoice() = runTest {
		server.sources += oldPhone
		val manager = manager()

		manager.enableBackup(device, session)
		advanceUntilIdle()
		assertEquals(0, server.sourceReads)
		assertEquals(PhotoBackupStatus.SettingUp, manager.presentation().status)

		manager.confirmFolderChoice(device, session)
		advanceUntilIdle()
		assertEquals(listOf("start", "transfer"), work.events)
	}

	@Test
	fun aPhoneWithABackupIdentityKeepsIt() = runTest {
		server.sources += oldPhone
		secrets.sourceIds["umbrel:0"] = "existing-source"
		val manager = manager()

		manager.setPreference(device, session, photos)
		advanceUntilIdle()

		assertEquals("existing-source", preferences.configuration?.source?.id)
	}

	// ── Switching backup here ──

	private val otherDevice = SavedDevice("other", "Umbrel", "other.local")
	private val otherSession = Umbreld.Session("other", "0", "access", Long.MAX_VALUE, "device-token")

	private fun TestScope.backingUpToTheOtherUmbrel(): PhotoBackupManager {
		val manager = manager().apply { setDeviceLookup { listOf(device, otherDevice).firstOrNull { saved -> saved.id == it } } }
		secrets.sessions[otherDevice.id] = otherSession
		manager.setPreference(otherDevice, otherSession, photos)
		advanceUntilIdle()
		work.events.clear()
		return manager
	}

	@Test
	fun switchingTurnsTheOtherUmbrelOffAndSetsUpHere() = runTest {
		val manager = backingUpToTheOtherUmbrel()
		assertEquals(PhotoBackupTarget("other", "0"), manager.otherTarget(device.id, session.accountId))

		// Turning backup on here never moves it by itself.
		manager.enableBackup(device, session)
		advanceUntilIdle()
		assertEquals("other", preferences.configuration?.deviceId)

		manager.switchHere(device, session)
		advanceUntilIdle()

		assertNull(manager.otherTarget(device.id, session.accountId))
		assertFalse(preferences.preference("other", "0").isEnabled)
		assertTrue(preferences.isActive(device.id, session.accountId))
		assertEquals(listOf("cancel"), work.events)
		// The other Umbrel's grant is revoked and removed; its source stays for a later switch back.
		assertEquals(listOf("other"), server.revokedDevices)
		assertNull(secrets.grants["other:0"])
		assertNotNull(secrets.sourceIds["other:0"])
		// As when backup is turned on here, the folder choice comes before the first upload.
		assertFalse(manager.state.value.setupInProgress)
		assertEquals(PhotoBackupStatus.SettingUp, manager.presentation().status)

		manager.confirmFolderChoice(device, session)
		advanceUntilIdle()
		assertEquals(device.id, preferences.configuration?.deviceId)
		assertEquals(listOf("cancel", "start", "transfer"), work.events)
		// Naming the new backup asked this Umbrel and account.
		assertEquals(device.id to session.accountId, server.sourceRequests.last())
	}

	@Test
	fun switchingDoesntAskAboutOtherPhonesBackups() = runTest {
		val manager = backingUpToTheOtherUmbrel()
		server.sources += oldPhone

		manager.switchHere(device, session)
		advanceUntilIdle()
		manager.confirmFolderChoice(device, session)
		advanceUntilIdle()

		assertEquals(device.id, preferences.configuration?.deviceId)
		assertEquals(preferences.configuration?.source?.id, secrets.sourceIds["umbrel:0"])
		assertNull(manager.presentation().notice)
	}

	// Android asks for photo access from the app, so a switch it can still ask for goes ahead
	// and the request comes next, as iOS asks during setup. Setup waits for the answer.
	@Test
	fun switchingBeforePhotoAccessWaitsForTheAnswer() = runTest {
		val manager = backingUpToTheOtherUmbrel()
		access = PhotoLibraryAccess.NONE

		manager.switchHere(device, session, canRequestAccess = true)
		advanceUntilIdle()
		assertTrue(preferences.isActive(device.id, session.accountId))
		assertNull(preferences.configuration)
		assertFalse(manager.state.value.setupInProgress)

		access = PhotoLibraryAccess.SELECTED
		manager.libraryAccessChanged(device, session, userInitiated = true, deniedTurnsOff = true)
		advanceUntilIdle()
		assertEquals(device.id, preferences.configuration?.deviceId)
	}

	@Test
	fun refusingPhotoAccessAfterTheSwitchTurnsBackupOff() = runTest {
		val manager = backingUpToTheOtherUmbrel()
		access = PhotoLibraryAccess.NONE
		manager.switchHere(device, session, canRequestAccess = true)
		advanceUntilIdle()

		manager.libraryAccessChanged(device, session, userInitiated = true, deniedTurnsOff = true)
		advanceUntilIdle()

		assertFalse(manager.preference(device.id, session.accountId).isEnabled)
		assertNull(preferences.activeTarget)
	}

	@Test
	fun theSourceIsResolvedUnlessSecureStorageCantBeRead() = runTest {
		val manager = backingUpToTheOtherUmbrel()
		assertNotNull(manager.otherTarget(device.id, session.accountId))
		assertTrue(manager.presentation().sourceResolved)
		assertNull(manager.presentation().sourceId)

		secrets.sourceIdUnavailable = true
		assertFalse(manager.presentation().sourceResolved)
	}

	// Without photo access the switch would stop the other Umbrel and start nothing. Android backs
	// up a selection of photos, so a selection is enough.
	@Test
	fun switchingNeedsPhotoAccess() = runTest {
		val manager = backingUpToTheOtherUmbrel()

		access = PhotoLibraryAccess.NONE
		assertFalse(manager.canSwitchHere())
		manager.switchHere(device, session)
		advanceUntilIdle()
		assertTrue(preferences.isActive("other", "0"))
		assertEquals("other", preferences.configuration?.deviceId)

		access = PhotoLibraryAccess.SELECTED
		assertTrue(manager.canSwitchHere())
		manager.switchHere(device, session)
		advanceUntilIdle()
		assertEquals(device.id, preferences.configuration?.deviceId)
	}
}
