package com.umbrel.kit.backup

import com.umbrel.kit.Umbreld
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.EOFException
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.ProtocolException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.cert.CertificateException
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException

/** Ports of PhotoBackupConfigurationTests, PhotoBackupSourceTests, PhotoBackupTransportFailureTests and the model parts of PhotoBackupCoverageTests. */
class PhotoBackupModelTest {
	private val source = Umbreld.PhotoBackupSource("source", "0", "Android phone")
	private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

	// ── Configuration ──

	// Earlier builds stored the plain-HTTP Tailscale origin uploads went to. Uploads now go to
	// whichever address of the saved Umbrel proves its identity, and the source carries on.
	@Test
	fun aConfigurationWithATailscaleOriginKeepsItsSource() {
		val stored = """{"deviceId":"device","uploadBaseUrl":"http://100.90.0.1","source":{"id":"source","accountId":"0","name":"Android phone"},""" +
			""""includePhotos":true,"includeVideos":false,"allowsCellularAccess":true}"""

		assertEquals(
			PhotoBackupConfiguration("device", source, includePhotos = true, includeVideos = false, allowsCellularAccess = true),
			json.decodeFromString(PhotoBackupConfiguration.serializer(), stored),
		)
	}

	@Test
	fun configurationRequiresTheCellularPreference() {
		for (stored in listOf(
			"""{"deviceId":"device","uploadBaseUrl":"http://100.90.0.1","source":{"id":"source","accountId":"0","name":"Android phone"},"includePhotos":true,"includeVideos":false}""",
			"""{"deviceId":"device","uploadBaseUrl":"http://100.90.0.1","source":{"id":"source","accountId":"0","name":"Android phone"},"includePhotos":true,"includeVideos":false,"allowsCellularAccess":null}""",
		)) {
			assertThrows(IllegalArgumentException::class.java) { json.decodeFromString(PhotoBackupConfiguration.serializer(), stored) }
		}
	}

	@Test
	fun presentationIsOffForDormantRememberedIntent() {
		assertEquals(PhotoBackupPresentationMode.OFF, presentation(intentEnabled = true, targetActive = false))
	}

	@Test
	fun presentationSetsUpUntilEveryActiveFactMatches() {
		assertEquals(PhotoBackupPresentationMode.SETTING_UP, presentation(configurationMatchesTarget = false))
		assertEquals(PhotoBackupPresentationMode.SETTING_UP, presentation(snapshotMatchesSource = false))
		assertEquals(PhotoBackupPresentationMode.SETTING_UP, presentation(snapshotPhase = PhotoBackupPhase.DISABLED))
	}

	@Test
	fun presentationKeepsPreconfigurationFailureVisible() {
		assertEquals(
			PhotoBackupPresentationMode.FAILED,
			presentation(configurationMatchesTarget = false, snapshotMatchesSource = false, snapshotPhase = PhotoBackupPhase.DISABLED, setupFailed = true),
		)
	}

	@Test
	fun presentationIsActiveOnlyWhenTheConfigurationAndSourceAreActive() {
		assertEquals(PhotoBackupPresentationMode.ACTIVE, presentation())
	}

	// ── Change token ──

	@Test
	fun anyChangeOfAccessEndsIncrementalReading() {
		val volumes = mapOf("external_primary" to LibraryChangeToken.Volume("v1", 10))
		val stored = LibraryChangeToken(volumes, PhotoLibraryAccess.FULL, setOf("android.permission.READ_MEDIA_IMAGES"))

		assertTrue(stored.copy(volumes = mapOf("external_primary" to LibraryChangeToken.Volume("v1", 20))).continues(stored))
		assertFalse(stored.copy(access = PhotoLibraryAccess.SELECTED).continues(stored))
		assertFalse(stored.copy(permissions = stored.permissions + "android.permission.READ_MEDIA_VIDEO").continues(stored))
		assertFalse(stored.copy(volumes = mapOf("external_primary" to LibraryChangeToken.Volume("v2", 10))).continues(stored))
		assertFalse(stored.copy(volumes = volumes + ("sd" to LibraryChangeToken.Volume("v1", 10))).continues(stored))
	}

	@Test
	fun aTokenWithoutAccessNeverContinuesIntoOneWithAccess() {
		val decoded = LibraryChangeToken.decode("""{"volumes":{"external_primary":{"version":"v1","generation":10}}}""")!!
		val current = LibraryChangeToken(decoded.volumes, PhotoLibraryAccess.FULL, setOf("android.permission.READ_MEDIA_IMAGES"))

		assertFalse(current.continues(decoded))
		assertEquals(current, LibraryChangeToken.decode(current.encoded()))
	}

	// ── Presentation ──

	@Test
	fun missingLocationAccessPausesActiveBackupWithAFix() {
		val presentation = PhotoBackupPresentation.resolve(inputs(locationAccess = false))

		assertEquals(PhotoBackupStatus.Paused, presentation.status)
		assertEquals(PhotoBackupNotice.LOCATION_ACCESS_REQUIRED, presentation.notice)
		assertEquals(PhotoBackupNotice.Action.ALLOW_LOCATION_ACCESS, presentation.notice?.action)
	}

	@Test
	fun theWorkersLocationIssueShowsUntilItsNextPass() {
		val snapshot = PhotoBackupSnapshot(PhotoBackupPhase.NEEDS_ATTENTION, PhotoBackupIssue.LOCATION_ACCESS_REQUIRED, sourceId = "source")

		assertEquals(PhotoBackupNotice.LOCATION_ACCESS_REQUIRED, PhotoBackupPresentation.resolve(inputs(snapshot = snapshot)).notice)
		assertEquals(PhotoBackupStatus.UpToDate, PhotoBackupPresentation.resolve(inputs()).status)
	}

	// ── Source ──

	@Test
	fun sourceDecodesTheAuthenticatedAccountId() {
		val decoded = Umbreld.json.decodeFromString(
			Umbreld.PhotoBackupSource.serializer(),
			"""{"id":"source","accountId":"alice","name":"Android phone","createdAt":1786320000000}""",
		)
		assertEquals("alice", decoded.accountId)
	}

	@Test
	fun sourceRequiresAnAccountId() {
		for (stored in listOf("""{"id":"source","name":"Android phone"}""", """{"id":"source","accountId":null,"name":"Android phone"}""")) {
			assertThrows(IllegalArgumentException::class.java) { Umbreld.json.decodeFromString(Umbreld.PhotoBackupSource.serializer(), stored) }
		}
	}

	// ── Transport failures ──

	@Test
	fun temporaryConnectivityErrorsRecoverAutomatically() {
		val errors = listOf(
			SocketTimeoutException("timeout"),
			UnknownHostException("100.90.0.1"),
			ConnectException("Connection refused"),
			NoRouteToHostException("No route to host"),
			SocketException("Connection reset"),
			SocketException("Network is unreachable"),
			InterruptedIOException("timeout"),
			IOException("unexpected end of stream on https://100.90.0.1/...", EOFException("\\n not found: limit=0")),
			// A handshake cut short by the network, not a refused certificate.
			SSLHandshakeException("Connection reset by peer"),
		)
		for (error in errors) assertTrue("$error", PhotoBackupTransportFailure.isConnectivityFailure(error))
	}

	@Test
	fun protocolTrustAndSourceErrorsDoNotHideAsConnectivity() {
		val errors = listOf(
			IOException("Canceled"),
			InterruptedIOException("interrupted"),
			ProtocolException("expected 10 bytes but received 20"),
			SSLHandshakeException("certificate").apply { initCause(CertificateException("not trusted")) },
			SSLPeerUnverifiedException("peer"),
			FileNotFoundException("content://media/external/images/media/1"),
			PhotoBackupSourceException("The item changed while uploading"),
			null,
		)
		for (error in errors) assertFalse("$error", PhotoBackupTransportFailure.isConnectivityFailure(error))
	}

	// ── Snapshot and statistics ──

	@Test
	fun snapshotDecodesDataWrittenWithoutStatistics() {
		val snapshot = json.decodeFromString(PhotoBackupSnapshot.serializer(), """{"phase":"waiting","updatedAtMs":0}""")
		assertEquals(PhotoBackupPhase.WAITING, snapshot.phase)
		assertNull(snapshot.issue)
		assertNull(snapshot.sourceId)
		assertNull(snapshot.statistics)
	}

	@Test
	fun insufficientStorageIssueUsesTheErrorHeader() {
		assertEquals(PhotoBackupIssue.INSUFFICIENT_STORAGE, PhotoBackupIssue.fromErrorHeader("insufficient-storage"))
		assertNull(PhotoBackupIssue.fromErrorHeader(null))
		assertNull(PhotoBackupIssue.fromErrorHeader("another-error"))
	}

	@Test
	fun snapshotRoundTripsSourceScopedStatistics() {
		val original = PhotoBackupSnapshot(
			phase = PhotoBackupPhase.UPLOADING,
			issue = PhotoBackupIssue.INSUFFICIENT_STORAGE,
			updatedAtMs = 1_000,
			sourceId = "source",
			statistics = PhotoBackupStatistics(queuedCount = 3, preparedCount = 2, uploadedPhotoCount = 4, uploadedVideoCount = 1, failedCount = 0, uploadedBytes = 42),
		)
		assertEquals(original, json.decodeFromString(PhotoBackupSnapshot.serializer(), json.encodeToString(PhotoBackupSnapshot.serializer(), original)))
	}

	@Test
	fun authenticationIssueSurvivesTheWorkerAndAppRoundTrip() {
		val original = PhotoBackupSnapshot(PhotoBackupPhase.NEEDS_ATTENTION, PhotoBackupIssue.AUTHENTICATION_REQUIRED, sourceId = "source")
		assertEquals(original, json.decodeFromString(PhotoBackupSnapshot.serializer(), json.encodeToString(PhotoBackupSnapshot.serializer(), original)))
	}

	// Android leaves DATE_TAKEN unset when it can't place a photo's EXIF time in a time zone,
	// as for a library copied from a computer. Like the system photo picker, the modified time
	// dates it then, rather than the moment it was copied.
	@Test
	fun aMissingCaptureDateFallsBackToTheModifiedTimeThenTheAddedTime() {
		assertEquals(5_000L, MediaStoreLibrary.capturedAtMs(takenMs = 5_000, modifiedSeconds = 10, addedSeconds = 20))
		assertEquals(10_000L, MediaStoreLibrary.capturedAtMs(takenMs = 0, modifiedSeconds = 10, addedSeconds = 20))
		assertEquals(20_000L, MediaStoreLibrary.capturedAtMs(takenMs = 0, modifiedSeconds = 0, addedSeconds = 20))
		assertEquals(0L, MediaStoreLibrary.capturedAtMs(takenMs = 0, modifiedSeconds = 0, addedSeconds = 0))
	}

	@Test
	fun statisticsCountUninventoriedAssetsAsRemaining() {
		val statistics = PhotoBackupStatistics(queuedCount = 10, preparedCount = 5, uploadedPhotoCount = 70, uploadedVideoCount = 8, failedCount = 1, uploadedBytes = 42)
		val library = PhotoLibraryCounts(photos = mapOf(CAMERA to 100), videos = mapOf(CAMERA to 20))
		assertEquals(42L, statistics.remainingCount(library, includePhotos = true, includeVideos = true, skippedFolders = emptySet()))
		assertEquals(12L, statistics.remainingCount(library, includePhotos = false, includeVideos = true, skippedFolders = emptySet()))
	}

	// Photos backed up before their folder was skipped must not cancel out photos still waiting elsewhere.
	@Test
	fun remainingWorkLeavesSkippedFoldersOutOfBothSides() {
		val statistics = PhotoBackupStatistics(0, 0, uploadedPhotoCount = 90, uploadedVideoCount = 0, failedCount = 0, uploadedBytes = 1, uploadedSkippedPhotoCount = 40)
		val library = PhotoLibraryCounts(photos = mapOf(CAMERA to 60, WHATSAPP to 40))

		// 60 camera photos less the 50 uploaded from the camera; counting all 90 uploads would read as 0.
		assertEquals(10L, statistics.remainingCount(library, includePhotos = true, includeVideos = true, skippedFolders = setOf(WHATSAPP)))
	}

	@Test
	fun nothingWaitingWithASkippedFolderReadsAsUpToDate() {
		val library = PhotoLibraryCounts(photos = mapOf(CAMERA to 1, WHATSAPP to 5))
		val statistics = PhotoBackupStatistics(0, 0, 1, 0, 0, 10)

		val skipping = PhotoBackupPresentation.resolve(inputs(statistics = statistics, library = library, skippedFolders = setOf(WHATSAPP)))
		assertEquals(PhotoBackupStatus.UpToDateExceptSkipped, skipping.status)
		assertEquals("Up to date", skipping.status.text)
		assertNull(skipping.notice)
		// A skipped folder with nothing in it leaves nothing out.
		val empty = PhotoBackupPresentation.resolve(inputs(statistics = statistics, library = PhotoLibraryCounts(mapOf(CAMERA to 1)), skippedFolders = setOf(WHATSAPP)))
		assertEquals(PhotoBackupStatus.UpToDate, empty.status)
		// With "Select photos" access the selection decides, so nothing is skipped.
		val selected = PhotoBackupPresentation.resolve(
			inputs(statistics = statistics, library = PhotoLibraryCounts(mapOf(CAMERA to 1, WHATSAPP to 1)), skippedFolders = setOf(WHATSAPP), access = PhotoLibraryAccess.SELECTED),
		)
		assertEquals(PhotoBackupStatus.BackingUp(1), selected.status)
	}

	@Test
	fun setupWaitsForTheFolderChoiceOnlyWithAccessToAllPhotos() {
		val unchosen = PhotoBackupPreference(includesPhotos = true, includesVideos = true)
		assertEquals(PhotoBackupStatus.SettingUp, PhotoBackupPresentation.resolve(inputs(preference = unchosen, configured = false)).status)
		assertEquals(
			PhotoBackupStatus.WaitingForUmbrel,
			PhotoBackupPresentation.resolve(inputs(preference = unchosen.copy(foldersChosen = true), configured = false)).status,
		)
		assertEquals(
			PhotoBackupStatus.WaitingForUmbrel,
			PhotoBackupPresentation.resolve(inputs(preference = unchosen, configured = false, access = PhotoLibraryAccess.SELECTED)).status,
		)
		// Backup that's already set up keeps running.
		assertEquals(PhotoBackupStatus.UpToDate, PhotoBackupPresentation.resolve(inputs(preference = unchosen)).status)
	}

	@Test
	fun onlyFailedItemsLeftReadsAsUpToDateWithNoNotice() {
		val onlyFailed = PhotoBackupStatistics(0, 0, 1, 0, failedCount = 1, uploadedBytes = 10)
		val failedAndQueued = PhotoBackupStatistics(1, 0, 1, 0, failedCount = 1, uploadedBytes = 10)

		val quiet = PhotoBackupPresentation.resolve(inputs(statistics = onlyFailed, library = PhotoLibraryCounts(mapOf(CAMERA to 2))))
		assertEquals(PhotoBackupStatus.UpToDateExceptFailures, quiet.status)
		assertEquals("Up to date", quiet.status.text)
		assertEquals(PhotoBackupStatus.Tone.GOOD, quiet.status.tone)
		assertNull(quiet.notice)
		// Failed items count as remaining work while anything else is still waiting.
		assertEquals(PhotoBackupStatus.BackingUp(2), PhotoBackupPresentation.resolve(inputs(statistics = failedAndQueued, library = PhotoLibraryCounts(mapOf(CAMERA to 3)))).status)
		// "All backed up" stays for when every item is.
		assertEquals(PhotoBackupStatus.UpToDate, PhotoBackupPresentation.resolve(inputs()).status)
	}

	@Test
	fun thePresentationNamesTheSourceOnlyWhileBackupIsSetUp() {
		assertEquals(source.name, PhotoBackupPresentation.resolve(inputs()).sourceName)
		assertNull(PhotoBackupPresentation.resolve(inputs(configured = false)).sourceName)
	}

	@Test
	fun withoutMobileDataQueuedItemsWaitForUnmeteredWiFi() {
		val queued = PhotoBackupStatistics(2, 0, 1, 0, 0, 10)
		val library = PhotoLibraryCounts(mapOf(CAMERA to 3))
		fun status(network: PhotoBackupNetwork.Traits?, allowsCellular: Boolean = false, statistics: PhotoBackupStatistics = queued) =
			PhotoBackupPresentation.resolve(inputs(statistics = statistics, library = library, defaultNetwork = network, allowsCellular = allowsCellular))

		for (network in listOf(MOBILE_DATA, HOTSPOT, null)) {
			val waiting = status(network)
			assertEquals(PhotoBackupStatus.WaitingForWiFi, waiting.status)
			assertEquals("Waiting for Wi-Fi", waiting.status.text)
			assertEquals(PhotoBackupNotice.WAITING_FOR_WIFI, waiting.notice)
		}
		assertEquals(PhotoBackupStatus.BackingUp(2), status(HOME_WIFI).status)
		// With mobile data allowed, or nothing left to upload, the network isn't the story.
		assertEquals(PhotoBackupStatus.BackingUp(2), status(MOBILE_DATA, allowsCellular = true).status)
		assertEquals(PhotoBackupStatus.UpToDate, status(MOBILE_DATA, statistics = PhotoBackupStatistics(0, 0, 3, 0, 0, 10)).status)
	}

	@Test
	fun theNetworkRuleNeedsUnmeteredWiFiWithoutMobileData() {
		fun qualifies(network: PhotoBackupNetwork.Traits?, allowsMobileData: Boolean, userInitiated: Boolean = false) =
			PhotoBackupNetwork.qualifies(network, allowsMobileData, userInitiated)

		assertTrue(qualifies(HOME_WIFI, allowsMobileData = false))
		assertFalse(qualifies(HOTSPOT, allowsMobileData = false))
		// A carrier can mark mobile data unmetered; it still isn't Wi-Fi.
		assertFalse(qualifies(MOBILE_DATA.copy(unmetered = true), allowsMobileData = false))
		assertFalse(qualifies(null, allowsMobileData = false))
		assertTrue(qualifies(MOBILE_DATA, allowsMobileData = true))
		assertTrue(qualifies(HOTSPOT, allowsMobileData = true))
		// Roaming waits for automatic passes only.
		assertFalse(qualifies(MOBILE_DATA.copy(roaming = true), allowsMobileData = true))
		assertTrue(qualifies(MOBILE_DATA.copy(roaming = true), allowsMobileData = true, userInitiated = true))
		assertFalse(qualifies(null, allowsMobileData = true, userInitiated = true))
	}

	private fun configuration(skippedFolders: Set<String> = emptySet(), allowsCellular: Boolean = false) =
		PhotoBackupConfiguration("device", source, includePhotos = true, includeVideos = true, allowsCellularAccess = allowsCellular, skippedFolders = skippedFolders)

	private fun inputs(
		locationAccess: Boolean = true,
		snapshot: PhotoBackupSnapshot = PhotoBackupSnapshot(PhotoBackupPhase.UP_TO_DATE, sourceId = "source"),
		statistics: PhotoBackupStatistics = PhotoBackupStatistics(0, 0, 1, 0, 0, 10),
		library: PhotoLibraryCounts = PhotoLibraryCounts(mapOf(CAMERA to 1)),
		skippedFolders: Set<String> = emptySet(),
		access: PhotoLibraryAccess = PhotoLibraryAccess.FULL,
		preference: PhotoBackupPreference = PhotoBackupPreference(includesPhotos = true, includesVideos = true, foldersChosen = true),
		configured: Boolean = true,
		defaultNetwork: PhotoBackupNetwork.Traits? = HOME_WIFI,
		allowsCellular: Boolean = false,
	) = PhotoBackupPresentation.Inputs(
		libraryAccess = access,
		locationAccess = locationAccess,
		preference = preference,
		targetActive = true,
		configuration = if (configured) configuration(skippedFolders, allowsCellular) else null,
		snapshot = snapshot,
		sourceId = "source",
		ledgerStatistics = statistics,
		setupInProgress = false,
		setupFailed = false,
		storageRetryRequested = false,
		recoveryRetryRequested = false,
		backgroundRestricted = false,
		library = library,
		defaultNetwork = defaultNetwork,
	)

	private fun presentation(
		intentEnabled: Boolean = true,
		targetActive: Boolean = true,
		configurationMatchesTarget: Boolean = true,
		snapshotMatchesSource: Boolean = true,
		snapshotPhase: PhotoBackupPhase = PhotoBackupPhase.WAITING,
		setupInProgress: Boolean = false,
		setupFailed: Boolean = false,
	) = PhotoBackupPresentationMode.resolve(intentEnabled, targetActive, configurationMatchesTarget, snapshotMatchesSource, snapshotPhase, setupInProgress, setupFailed)
}

/** Port of PhotoBackupRecoveryStateTests. */
class PhotoBackupRecoveryStateTest {
	private val sourceId = "source"

	@Test
	fun connectivityRecoverySurvivesAFreshPass() {
		val state = PhotoBackupRecoveryState(snapshot(PhotoBackupPhase.UPLOADING), sourceId, storageRetryRequested = false)
		state.observeTerminalBatch(foundStorageFailure = false, foundConnectivityFailure = true, hasTerminalJobs = true)

		assertEquals(PhotoBackupPhase.WAITING_FOR_UMBREL, state.phase)
		assertNull(state.issue)

		val restored = PhotoBackupRecoveryState(snapshot(state.phase, state.issue), sourceId, storageRetryRequested = false)
		assertTrue(restored.connectivityRecovering)
		assertEquals(PhotoBackupPhase.WAITING_FOR_UMBREL, restored.phase)
	}

	@Test
	fun connectivityFailureKeepsAMixedBatchThrottled() {
		val state = PhotoBackupRecoveryState(snapshot(PhotoBackupPhase.UPLOADING), sourceId, storageRetryRequested = false)
		state.observeTerminalBatch(foundStorageFailure = false, foundConnectivityFailure = true, hasTerminalJobs = true)

		assertTrue(state.connectivityRecovering)
		assertEquals(PhotoBackupPhase.WAITING_FOR_UMBREL, state.phase)
	}

	@Test
	fun aPermanentResultEndsConnectivityRecovery() {
		val state = PhotoBackupRecoveryState(snapshot(PhotoBackupPhase.WAITING_FOR_UMBREL), sourceId, storageRetryRequested = false)
		state.observeTerminalBatch(foundStorageFailure = false, foundConnectivityFailure = false, hasTerminalJobs = true)

		assertFalse(state.connectivityRecovering)
		assertEquals(PhotoBackupPhase.WAITING, state.phase)
	}

	@Test
	fun connectivityFailureDoesNotConsumeAStorageRetry() {
		val state = PhotoBackupRecoveryState(snapshot(PhotoBackupPhase.NEEDS_ATTENTION, PhotoBackupIssue.INSUFFICIENT_STORAGE), sourceId, storageRetryRequested = true)
		assertTrue(state.storagePaused)
		assertTrue(state.storageRetryRequested)

		state.beginStorageProbe()
		state.observeTerminalBatch(foundStorageFailure = false, foundConnectivityFailure = true, hasTerminalJobs = true)
		state.finishStorageProbe(PhotoBackupStorageProbeOutcome.CONNECTIVITY_FAILURE)

		assertTrue(state.storageProbing)
		assertTrue(state.storageRetryRequested)
		assertTrue(state.connectivityRecovering)
		assertEquals(PhotoBackupPhase.WAITING_FOR_UMBREL, state.phase)
		assertNull(state.issue)

		val restored = PhotoBackupRecoveryState(snapshot(state.phase, state.issue), sourceId, storageRetryRequested = true)
		assertTrue(restored.storageProbing)
		assertTrue(restored.connectivityRecovering)

		restored.observeTerminalBatch(foundStorageFailure = false, foundConnectivityFailure = false, hasTerminalJobs = true)
		restored.finishStorageProbe(PhotoBackupStorageProbeOutcome.SUCCEEDED)
		assertFalse(restored.storageRetryRequested)
		assertFalse(restored.storageProbing)
		assertFalse(restored.connectivityRecovering)
		assertEquals(PhotoBackupPhase.WAITING, restored.phase)
		assertNull(restored.issue)
	}

	@Test
	fun aConfirmedStorageFailureReturnsTheProbeToStoragePause() {
		val state = PhotoBackupRecoveryState(snapshot(PhotoBackupPhase.CHECKING_STORAGE, PhotoBackupIssue.INSUFFICIENT_STORAGE), sourceId, storageRetryRequested = true)
		state.observeTerminalBatch(foundStorageFailure = true, foundConnectivityFailure = false, hasTerminalJobs = true)
		state.finishStorageProbe(PhotoBackupStorageProbeOutcome.INSUFFICIENT_STORAGE)

		assertTrue(state.storagePaused)
		assertFalse(state.storageRetryRequested)
		assertEquals(PhotoBackupPhase.NEEDS_ATTENTION, state.phase)
		assertEquals(PhotoBackupIssue.INSUFFICIENT_STORAGE, state.issue)
	}

	@Test
	fun aPermanentFailureDoesNotMasqueradeAsInsufficientStorage() {
		val state = PhotoBackupRecoveryState(snapshot(PhotoBackupPhase.CHECKING_STORAGE, PhotoBackupIssue.INSUFFICIENT_STORAGE), sourceId, storageRetryRequested = true)
		state.observeTerminalBatch(foundStorageFailure = false, foundConnectivityFailure = false, hasTerminalJobs = true)
		state.finishStorageProbe(PhotoBackupStorageProbeOutcome.PERMANENT_FAILURE)

		assertFalse(state.storagePaused)
		assertFalse(state.storageRetryRequested)
		assertFalse(state.storageProbing)
		assertEquals(PhotoBackupPhase.WAITING, state.phase)
		assertNull(state.issue)
	}

	@Test
	fun anUnrelatedStaleStorageRetryRequestIsIgnored() {
		val state = PhotoBackupRecoveryState(snapshot(PhotoBackupPhase.UP_TO_DATE), sourceId, storageRetryRequested = true)

		assertFalse(state.storageRetryRequested)
		assertFalse(state.storageProbing)
		assertFalse(state.storagePaused)
	}

	private fun snapshot(phase: PhotoBackupPhase, issue: PhotoBackupIssue? = null) = PhotoBackupSnapshot(phase, issue, sourceId = sourceId)
}

private const val CAMERA = "dcim/camera/"
private val HOME_WIFI = PhotoBackupNetwork.Traits(wifiOrEthernet = true, unmetered = true, roaming = false)
private val HOTSPOT = PhotoBackupNetwork.Traits(wifiOrEthernet = true, unmetered = false, roaming = false)
private val MOBILE_DATA = PhotoBackupNetwork.Traits(wifiOrEthernet = false, unmetered = false, roaming = false)
private const val WHATSAPP = "pictures/whatsapp/"
