package com.umbrel.kit.backup

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.umbrel.kit.Umbreld
import com.umbrel.kit.backup.PhotoBackupEngine.PassOutcome
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.ProtocolException
import java.net.SocketTimeoutException

@RunWith(AndroidJUnit4::class)
class PhotoBackupEngineTest {
	private lateinit var directory: File
	private lateinit var preferences: PhotoBackupPreferences
	private lateinit var ledger: PhotoBackupLedger
	private val library = FakeLibrary()
	private val server = FakeServer()
	private val secrets = FakeSecrets()
	private val source = Umbreld.PhotoBackupSource("source", "0", "Android phone")

	@Before
	fun setUp() {
		val context = ApplicationProvider.getApplicationContext<Context>()
		context.getSharedPreferences(PhotoBackupPreferences.FILE_NAME, Context.MODE_PRIVATE).edit().clear().commit()
		preferences = PhotoBackupPreferences(context)
		directory = File(System.getProperty("java.io.tmpdir"), "umbrel-engine-" + System.nanoTime()).apply { mkdirs() }
		ledger = PhotoBackupLedger(File(directory, "photo-backup.sqlite"))
		secrets.grants["umbrel:0"] = "grant"
		configure()
	}

	@After
	fun tearDown() {
		ledger.close()
		directory.deleteRecursively()
	}

	// ── Inventory ──

	@Test
	fun aLargeLibraryIsInventoriedAcrossPassesWithoutLosingEarlierRows() {
		configure(includePhotos = false, includeVideos = false)
		repeat(5_000) { library.add(PhotoBackupLedger.MEDIA_TYPE_IMAGE) }
		repeat(300) { library.add(PhotoBackupLedger.MEDIA_TYPE_VIDEO) }

		assertEquals(PassOutcome.MoreWork, pass())
		assertNull(ledger.changeToken("source"))
		assertEquals(4_096L, ledger.presentAssetCount("source", PhotoBackupLedger.MEDIA_TYPE_IMAGE))

		assertEquals(PassOutcome.Completed, pass())
		assertNotNull(ledger.changeToken("source"))
		// Rows from the first pass were not marked deleted by the second.
		assertEquals(5_000L, ledger.presentAssetCount("source", PhotoBackupLedger.MEDIA_TYPE_IMAGE))
		assertEquals(300L, ledger.presentAssetCount("source", PhotoBackupLedger.MEDIA_TYPE_VIDEO))
	}

	@Test
	fun videosAreInventoriedWhileOnlyPhotosAreEnabled() {
		configure(includePhotos = true, includeVideos = false)
		library.add(PhotoBackupLedger.MEDIA_TYPE_IMAGE)
		val video = library.add(PhotoBackupLedger.MEDIA_TYPE_VIDEO)
		assertEquals(PassOutcome.Completed, pass())
		assertEquals(1, server.uploads.size)

		// Turning videos on later needs no new scan: the video is already in the ledger.
		configure(includePhotos = true, includeVideos = true)
		assertEquals(PassOutcome.Completed, pass())
		assertEquals(2, server.uploads.size)
		assertEquals(PhotoBackupLedger.AssetState.UPLOADED, ledger.assetRecord("source", video)?.state)
	}

	@Test
	fun incrementalPassesSeeEditsAndItemsMovedToTheTrash() {
		val kept = library.add()
		val trashed = library.add()
		assertEquals(PassOutcome.Completed, pass())
		assertEquals(2, server.uploads.size)

		library.edit(kept, ByteArray(32))
		library.trash(trashed)
		assertEquals(PassOutcome.Completed, pass())

		assertEquals(3, server.uploads.size)
		assertEquals(1L, ledger.statistics("source").uploadedPhotoCount)
		assertNull(ledger.assetRecord("source", trashed))
		assertEquals(PhotoBackupLedger.AssetState.UPLOADED, ledger.assetRecord("source", kept)?.state)
	}

	// A camera that replaces its provisional file in place can keep DATE_MODIFIED; the size
	// still changes, and the new version gets a key of its own.
	@Test
	fun aRewriteInPlaceIsUploadedAgainUnderANewKey() {
		val photo = library.add(bytes = ByteArray(16))
		pass()
		library.edit(photo, ByteArray(24))
		pass()
		library.edit(photo, ByteArray(16))
		pass()

		assertEquals(3, server.uploads.size)
		assertEquals(3, server.uploads.map { it.resourceKey }.toSet().size)
		assertEquals(PhotoBackupLedger.AssetState.UPLOADED, ledger.assetRecord("source", photo)?.state)
	}

	@Test
	fun aSkippedFolderIsLeftOutUntilItIsTurnedBackOn() {
		configure(skippedFolders = setOf(WHATSAPP_FOLDER))
		val camera = library.add()
		val whatsapp = library.add(folder = WHATSAPP_FOLDER)

		assertEquals(PassOutcome.Completed, pass())
		assertEquals(1, server.uploads.size)
		assertEquals(PhotoBackupLedger.AssetState.UPLOADED, ledger.assetRecord("source", camera)?.state)
		assertEquals(PhotoBackupLedger.AssetState.PENDING, ledger.assetRecord("source", whatsapp)?.state)

		configure(skippedFolders = emptySet())
		pass()

		assertEquals(2, server.uploads.size)
		assertEquals(PhotoBackupLedger.AssetState.UPLOADED, ledger.assetRecord("source", whatsapp)?.state)
	}

	@Test
	fun movingABackedUpPhotoIntoASkippedFolderDoesNotUploadItAgain() {
		configure(skippedFolders = setOf(WHATSAPP_FOLDER))
		val photo = library.add()
		pass()

		library.move(photo, WHATSAPP_FOLDER)

		assertEquals(PassOutcome.Completed, pass())
		assertEquals(1, server.uploads.size)
		assertEquals(1L, ledger.statistics("source", skippedFolders = setOf(WHATSAPP_FOLDER)).uploadedSkippedPhotoCount)
	}

	@Test
	fun aMetadataOnlyChangeIsNotUploadedAgain() {
		val photo = library.add()
		pass()

		library.touch(photo)

		assertEquals(PassOutcome.Completed, pass())
		assertEquals(1, server.uploads.size)
		assertEquals(PhotoBackupLedger.AssetState.UPLOADED, ledger.assetRecord("source", photo)?.state)
	}

	@Test
	fun aPermanentDeletionStartsAFreshInventory() {
		val deleted = library.add()
		library.add()
		assertEquals(PassOutcome.Completed, pass())

		library.delete(deleted)
		// The ledger has more present assets than MediaStore: forget the token and rescan.
		assertEquals(PassOutcome.MoreWork, pass())
		assertNull(ledger.changeToken("source"))
		assertEquals(PassOutcome.Completed, pass())

		assertNull(ledger.assetRecord("source", deleted))
		assertEquals(1L, ledger.statistics("source").uploadedPhotoCount)
	}

	@Test
	fun aResumedInventoryContinuesBelowItsCursor() {
		configure(includePhotos = false, includeVideos = false)
		repeat(5_000) { library.add() }

		assertEquals(PassOutcome.MoreWork, pass())
		val firstPass = library.pageRequests.toList()
		assertEquals(PhotoBackupEngine.INVENTORY_TARGET_PER_PASS / PhotoBackupEngine.INVENTORY_BATCH_SIZE, firstPass.size)
		library.pageRequests.clear()

		pass()

		// The second pass starts where the first stopped instead of rereading from the top.
		assertEquals(5_000L - PhotoBackupEngine.INVENTORY_TARGET_PER_PASS + 1, library.pageRequests.first())
		assertEquals(5_000L, ledger.presentAssetCount("source", PhotoBackupLedger.MEDIA_TYPE_IMAGE))
	}

	@Test
	fun aChangedMediaStoreVersionStartsAFreshInventory() {
		library.add()
		assertEquals(PassOutcome.Completed, pass())

		library.version = "v2"
		assertEquals(PassOutcome.MoreWork, pass())
		assertEquals(PassOutcome.Completed, pass())
		assertEquals(1, server.uploads.size)
	}

	// ── Uploads and receipts ──

	@Test
	fun uploadsCarryTheResourceIdentityAndTheOpenedLength() {
		val photo = library.add(bytes = ByteArray(1234))
		assertEquals(PassOutcome.Completed, pass())

		val upload = server.uploads.single()
		val work = ledger.assetRecord("source", photo)
		assertEquals(PhotoBackupLedger.AssetState.UPLOADED, work?.state)
		val item = library.items.getValue(photo)
		assertEquals(PhotoBackupEngine.resourceKey("source", photo, 1, 1234, item.generationModified, "photo"), upload.resourceKey)
		assertEquals("jpg", upload.fileExtension)
		assertEquals("IMG_1.jpg", upload.filename)
		assertEquals(1234L, server.uploadedLengths.single())
		assertEquals(PhotoBackupPhase.UP_TO_DATE, preferences.snapshot.phase)
		assertEquals(1L, preferences.snapshot.statistics?.uploadedPhotoCount)
	}

	// A server error says nothing about the item: it stays queued and the pass ends for a retry
	// with backoff. The user can't do anything about it, so backup reads as waiting.
	@Test
	fun aServerErrorKeepsTheItemQueuedAndRetriesLater() {
		val photo = library.add()
		server.respond = { PhotoUploadResult.Rejected(503, null) }

		assertEquals(PassOutcome.RetryLater, pass())
		assertEquals(1, server.uploads.size)
		assertEquals(PhotoBackupLedger.AssetState.PREPARED, ledger.assetRecord("source", photo)?.state)
		assertEquals(PhotoBackupPhase.WAITING, preferences.snapshot.phase)
		assertNull(preferences.snapshot.lastError)

		server.respond = { PhotoUploadResult.Succeeded(10) }
		assertEquals(PassOutcome.Completed, pass())
		assertEquals(PhotoBackupLedger.AssetState.UPLOADED, ledger.assetRecord("source", photo)?.state)
		assertEquals(PhotoBackupPhase.UP_TO_DATE, preferences.snapshot.phase)
	}

	@Test
	fun serverErrorsInARowEndThePassWithoutFailingItems() {
		repeat(5) { library.add() }
		server.respond = { PhotoUploadResult.Rejected(500, null) }

		// An outage that outlasts several retries still fails nothing.
		repeat(PhotoBackupEngine.MAX_ITEM_ATTEMPTS + 1) { assertEquals(PassOutcome.RetryLater, pass()) }

		assertEquals(2 * (PhotoBackupEngine.MAX_ITEM_ATTEMPTS + 1), server.uploads.size)
		assertEquals(0L, ledger.statistics("source").failedCount)
	}

	// Errors that come in bursts while uploads still get through, as when the Umbrel is busy
	// indexing new folders, must not stall a large backup behind a growing backoff.
	@Test
	fun aPassThatUploadedBeforeServerErrorsContinuesAtOnce() {
		repeat(5) { library.add() }
		var calls = 0
		server.respond = { if (++calls == 1) PhotoUploadResult.Succeeded(10) else PhotoUploadResult.Rejected(500, null) }

		assertEquals(PassOutcome.MoreWork, pass())
		assertEquals(3, server.uploads.size)
		assertEquals(1L, ledger.statistics("source").uploadedPhotoCount)
		assertEquals(PhotoBackupPhase.WAITING, preferences.snapshot.phase)

		// The next pass that gets nothing through backs off.
		assertEquals(PassOutcome.RetryLater, pass())
	}

	// A video too large to upload within one job is cut off by the job's time limit every pass
	// and starts again from zero. It goes behind the rest of the queue instead of holding up
	// everything older than it, and still gets its turn.
	@Test
	fun anUploadCutOffMidwayGoesBehindTheRestOfTheQueue() {
		library.add(createdMs = 1_000)
		library.add(createdMs = 2_000)
		library.add(PhotoBackupLedger.MEDIA_TYPE_VIDEO, createdMs = 3_000)
		server.respond = { upload ->
			if (upload.creationDateMs == 3_000L) throw CancellationException("The job ran out of time")
			PhotoUploadResult.Succeeded(10)
		}

		assertThrows(CancellationException::class.java) { pass() }
		assertEquals(listOf(3_000L), server.uploads.map { it.creationDateMs })

		server.uploads.clear()
		server.respond = { PhotoUploadResult.Succeeded(10) }
		assertEquals(PassOutcome.Completed, pass())
		assertEquals(listOf(2_000L, 1_000L, 3_000L), server.uploads.map { it.creationDateMs })
	}

	// A file the Umbrel fails on while it accepts others is the item's problem; it stops
	// being sent after a few passes instead of forever.
	@Test
	fun anItemThatKeepsFailingWhileOthersUploadNeedsTryAgain() {
		val bad = library.add(createdMs = 1_000_000)
		server.respond = { if (it.filename == "IMG_1.jpg") PhotoUploadResult.Rejected(500, null) else PhotoUploadResult.Succeeded(10) }

		repeat(PhotoBackupEngine.MAX_ITEM_ATTEMPTS) {
			library.add(createdMs = 1_000L * (it + 1))
			pass()
		}

		assertEquals(PhotoBackupLedger.AssetState.FAILED, ledger.assetRecord("source", bad)?.state)
		val sends = server.uploads.count { it.filename == "IMG_1.jpg" }
		assertEquals(PhotoBackupEngine.MAX_ITEM_ATTEMPTS, sends)

		library.add(createdMs = 2_000)
		pass()
		assertEquals(sends, server.uploads.count { it.filename == "IMG_1.jpg" })
	}

	@Test
	fun aRefusedFileIsNotSentAgainOnItsOwn() {
		val photo = library.add()
		server.respond = { PhotoUploadResult.Rejected(413, null) }

		assertEquals(PassOutcome.Completed, pass())
		library.add()
		server.respond = { PhotoUploadResult.Succeeded(10) }
		pass()
		pass()

		assertEquals(PhotoBackupLedger.AssetState.FAILED, ledger.assetRecord("source", photo)?.state)
		assertEquals(2, server.uploads.size)
	}

	@Test
	fun aFailedItemDoesNotBlockTheRestOfTheQueue() {
		val bad = library.add(createdMs = 9_000)
		val good = library.add(createdMs = 1_000)
		server.respond = { if (it.filename == "IMG_1.jpg") PhotoUploadResult.Rejected(400, null) else PhotoUploadResult.Succeeded(10) }

		pass()

		assertEquals(PhotoBackupLedger.AssetState.FAILED, ledger.assetRecord("source", bad)?.state)
		assertEquals(PhotoBackupLedger.AssetState.UPLOADED, ledger.assetRecord("source", good)?.state)
		// A refused item alone isn't something the user can fix; the viewer marks it.
		assertEquals(PhotoBackupPhase.UP_TO_DATE, preferences.snapshot.phase)
	}

	@Test
	fun tryAgainRequeuesFailedItems() {
		val photo = library.add()
		server.respond = { PhotoUploadResult.Rejected(400, null) }
		pass()
		assertEquals(PhotoBackupLedger.AssetState.FAILED, ledger.assetRecord("source", photo)?.state)

		server.respond = { PhotoUploadResult.Succeeded(10) }
		preferences.requestRecoveryRetry("source")
		assertEquals(PassOutcome.Completed, pass())

		assertEquals(PhotoBackupLedger.AssetState.UPLOADED, ledger.assetRecord("source", photo)?.state)
		assertEquals(false, preferences.recoveryRetryRequested("source"))
	}

	// ── Connectivity ──

	@Test
	fun anUnreachableUmbrelWaitsWithoutSendingTheGrant() {
		library.add()
		server.reachable = false

		assertEquals(PassOutcome.RetryLater, pass())

		assertTrue(server.uploads.isEmpty())
		assertEquals(PhotoBackupPhase.WAITING_FOR_UMBREL, preferences.snapshot.phase)
	}

	// Every address of the saved Umbrel, local and Tailscale, is offered to the resolver,
	// and uploads go to the one that proved the pinned identity.
	@Test
	fun uploadsGoToTheAddressThatProvedTheUmbrelsIdentity() {
		library.add()
		server.host = "100.90.0.1"

		pass()

		assertEquals(listOf(savedDevices.getValue("umbrel")), server.resolutions)
		assertEquals(listOf("100.90.0.1"), server.endpoints)
	}

	@Test
	fun anUmbrelWhoseIdentityChangedNeedsAttentionWithoutSendingTheGrant() {
		library.add()
		server.refusal = "This Umbrel’s security identity changed"

		assertTrue(pass() is PassOutcome.Failed)

		assertTrue(server.uploads.isEmpty())
		assertEquals(PhotoBackupPhase.NEEDS_ATTENTION, preferences.snapshot.phase)
		assertEquals(PhotoBackupEngine.UNTRUSTED_UMBREL, preferences.snapshot.lastError)
	}

	@Test
	fun aCertificateRefusedMidPassIsARouteFailure() {
		val photo = library.add()
		server.respond = { PhotoUploadResult.TransportFailed(javax.net.ssl.SSLPeerUnverifiedException("Hostname localhost not verified")) }

		assertEquals(PassOutcome.RetryLater, pass())

		assertEquals(PhotoBackupLedger.AssetState.PREPARED, ledger.assetRecord("source", photo)?.state)
		assertEquals(PhotoBackupPhase.WAITING_FOR_UMBREL, preferences.snapshot.phase)
	}

	@Test
	fun anUmbrelThatIsNoLongerSavedUploadsNothing() {
		library.add()
		savedDevices = emptyMap()

		assertTrue(pass() is PassOutcome.Failed)
		assertTrue(server.uploads.isEmpty())
		assertEquals(PhotoBackupEngine.UMBREL_NOT_SAVED, preferences.snapshot.lastError)
	}

	@Test
	fun aLostConnectionKeepsTheItemQueuedAndResumesWithOneProbe() {
		val first = library.add(createdMs = 2_000)
		val second = library.add(createdMs = 1_000)
		server.respond = { PhotoUploadResult.TransportFailed(SocketTimeoutException("timeout")) }

		assertEquals(PassOutcome.RetryLater, pass())
		assertEquals(PhotoBackupLedger.AssetState.PREPARED, ledger.assetRecord("source", first)?.state)
		assertEquals(PhotoBackupPhase.WAITING_FOR_UMBREL, preferences.snapshot.phase)

		server.respond = { PhotoUploadResult.Succeeded(10) }
		assertEquals(PassOutcome.Completed, pass())
		assertEquals(PhotoBackupLedger.AssetState.UPLOADED, ledger.assetRecord("source", first)?.state)
		assertEquals(PhotoBackupLedger.AssetState.UPLOADED, ledger.assetRecord("source", second)?.state)
		assertEquals(PhotoBackupPhase.UP_TO_DATE, preferences.snapshot.phase)
	}

	// The Umbrel received every byte; only its answer was lost, which says nothing about the
	// route to it.
	@Test
	fun aTimeoutAfterTheBodyWasSentIsNotAConnectivityWait() {
		val photo = library.add()
		server.respond = { PhotoUploadResult.TransportFailed(SocketTimeoutException("timeout"), afterBody = true) }

		assertEquals(PassOutcome.RetryLater, pass())

		assertEquals(PhotoBackupLedger.AssetState.PREPARED, ledger.assetRecord("source", photo)?.state)
		// Waiting to retry, not waiting for the Umbrel to come back.
		assertEquals(PhotoBackupPhase.WAITING, preferences.snapshot.phase)
	}

	@Test
	fun aProtocolErrorIsTemporaryNotAConnectivityWait() {
		val photo = library.add()
		server.respond = { PhotoUploadResult.TransportFailed(ProtocolException("unexpected status line")) }

		assertEquals(PassOutcome.RetryLater, pass())

		assertEquals(PhotoBackupLedger.AssetState.PREPARED, ledger.assetRecord("source", photo)?.state)
		// Waiting to retry, not waiting for the Umbrel to come back.
		assertEquals(PhotoBackupPhase.WAITING, preferences.snapshot.phase)
	}

	@Test
	fun aFileThatKeepsChangingWhileUploadingIsTriedAFewTimes() {
		val photo = library.add()
		server.respond = { throw PhotoBackupSourceException("The item changed while uploading") }

		pass()
		assertEquals(PhotoBackupLedger.AssetState.UNREADABLE, ledger.assetRecord("source", photo)?.state)
		repeat(PhotoBackupEngine.MAX_ITEM_ATTEMPTS) { pass() }

		assertEquals(PhotoBackupLedger.AssetState.FAILED, ledger.assetRecord("source", photo)?.state)
		assertEquals(PhotoBackupEngine.MAX_ITEM_ATTEMPTS, server.uploads.size)
	}

	// ── Authentication and storage ──

	@Test
	fun aRejectedGrantStopsUploadsUntilRecovery() {
		library.add()
		library.add()
		server.respond = { PhotoUploadResult.Rejected(401, PhotoBackupIssue.AUTHENTICATION_REQUIRED) }

		assertEquals(PassOutcome.WaitingForUser, pass())
		assertEquals(1, server.uploads.size)
		assertEquals(PhotoBackupIssue.AUTHENTICATION_REQUIRED, preferences.snapshot.issue)

		// Later passes don't send another file with a grant Umbrel rejected.
		assertEquals(PassOutcome.WaitingForUser, pass())
		assertEquals(1, server.uploads.size)

		// Reconnect replaces the grant, republishes a waiting snapshot, and requests recovery.
		server.respond = { PhotoUploadResult.Succeeded(10) }
		preferences.publish(PhotoBackupSnapshot(PhotoBackupPhase.WAITING, sourceId = "source"))
		preferences.requestRecoveryRetry("source")
		assertEquals(PassOutcome.Completed, pass())
		assertEquals(2L, ledger.statistics("source").uploadedPhotoCount)
	}

	@Test
	fun aMissingGrantNeedsReconnect() {
		library.add()
		secrets.grants.clear()

		assertEquals(PassOutcome.WaitingForUser, pass())
		assertEquals(PhotoBackupIssue.AUTHENTICATION_REQUIRED, preferences.snapshot.issue)
	}

	@Test
	fun anUnavailableKeystoreIsATransientFailure() {
		library.add()
		secrets.grantUnavailable = true

		assertTrue(pass() is PassOutcome.Failed)
		assertEquals(PhotoBackupPhase.NEEDS_ATTENTION, preferences.snapshot.phase)
		assertEquals("secure-storage-unavailable", preferences.snapshot.lastError)
		assertTrue(server.uploads.isEmpty())
	}

	@Test
	fun insufficientStoragePausesUntilAnExplicitRetryProbesOnce() {
		repeat(3) { library.add() }
		server.respond = { PhotoUploadResult.Rejected(507, PhotoBackupIssue.INSUFFICIENT_STORAGE) }

		assertEquals(PassOutcome.WaitingForUser, pass())
		assertEquals(1, server.uploads.size)
		assertEquals(PhotoBackupIssue.INSUFFICIENT_STORAGE, preferences.snapshot.issue)

		// Paused passes never send more files to a full Umbrel.
		assertEquals(PassOutcome.WaitingForUser, pass())
		assertEquals(1, server.uploads.size)

		// A retry that still finds the disk full sends exactly one probe.
		preferences.requestStorageRetry("source")
		assertEquals(PassOutcome.WaitingForUser, pass())
		assertEquals(2, server.uploads.size)
		assertEquals(false, preferences.storageRetryRequested("source"))

		// A successful probe reopens the whole queue.
		server.respond = { PhotoUploadResult.Succeeded(10) }
		preferences.requestStorageRetry("source")
		assertEquals(PassOutcome.Completed, pass())
		assertEquals(3L, ledger.statistics("source").uploadedPhotoCount)
		assertNull(preferences.snapshot.issue)
	}

	@Test
	fun aServerErrorDuringAStorageProbeKeepsTheProbeOpen() {
		repeat(2) { library.add() }
		server.respond = { PhotoUploadResult.Rejected(507, PhotoBackupIssue.INSUFFICIENT_STORAGE) }
		pass()
		preferences.requestStorageRetry("source")

		server.respond = { PhotoUploadResult.Rejected(503, null) }
		assertEquals(PassOutcome.RetryLater, pass())
		assertEquals(PhotoBackupPhase.CHECKING_STORAGE, preferences.snapshot.phase)
		assertTrue(preferences.storageRetryRequested("source"))

		server.respond = { PhotoUploadResult.Succeeded(10) }
		assertEquals(PassOutcome.Completed, pass())
		assertEquals(2L, ledger.statistics("source").uploadedPhotoCount)
		assertNull(preferences.snapshot.issue)
	}

	// ── Access and items ──

	// Without the permission MediaStore would serve every photo with its location removed.
	@Test
	fun withoutLocationAccessBackupPausesInsteadOfUploadingRedactedBytes() {
		val photo = library.add()
		library.canReadLocation = false

		assertEquals(PassOutcome.WaitingForUser, pass())
		assertTrue(server.uploads.isEmpty())
		assertEquals(PhotoBackupPhase.NEEDS_ATTENTION, preferences.snapshot.phase)
		assertEquals(PhotoBackupIssue.LOCATION_ACCESS_REQUIRED, preferences.snapshot.issue)
		assertEquals(PhotoBackupLedger.AssetState.PENDING, ledger.assetRecord("source", photo)?.state)

		library.canReadLocation = true
		assertEquals(PassOutcome.Completed, pass())
		assertEquals(PhotoBackupLedger.AssetState.UPLOADED, ledger.assetRecord("source", photo)?.state)
		assertNull(preferences.snapshot.issue)
	}

	@Test
	fun anOriginalRefusedDespiteThePermissionAlsoPauses() {
		val photo = library.add()
		library.refusesOriginals = true

		assertEquals(PassOutcome.WaitingForUser, pass())
		assertTrue(server.uploads.isEmpty())
		assertEquals(PhotoBackupIssue.LOCATION_ACCESS_REQUIRED, preferences.snapshot.issue)
		assertEquals(PhotoBackupLedger.AssetState.PREPARED, ledger.assetRecord("source", photo)?.state)
		assertEquals(1L, ledger.statistics("source").preparedCount)
	}

	@Test
	fun withoutPhotoAccessBackupPausesAndResumesWhenAccessReturns() {
		val photo = library.add()
		library.access = PhotoLibraryAccess.NONE

		assertEquals(PassOutcome.WaitingForUser, pass())
		assertNull(ledger.changeToken("source"))
		assertTrue(server.uploads.isEmpty())
		assertEquals(PhotoBackupPhase.NEEDS_ATTENTION, preferences.snapshot.phase)
		assertEquals(PhotoBackupIssue.PHOTO_ACCESS_REQUIRED, preferences.snapshot.issue)

		library.access = PhotoLibraryAccess.FULL
		assertEquals(PassOutcome.Completed, pass())
		assertEquals(PhotoBackupLedger.AssetState.UPLOADED, ledger.assetRecord("source", photo)?.state)
		assertNull(preferences.snapshot.issue)
	}

	// A pass that loses access midway would otherwise find every item unreadable.
	@Test
	fun accessLostDuringAPassPausesWithoutMarkingItemsUnreadable() {
		val photo = library.add()
		library.items.getValue(photo).unreadable = true
		val engine = engine(
			object : PhotoBackupLibrary by library {
				override fun open(localIdentifier: String): OpenedResource {
					library.access = PhotoLibraryAccess.NONE
					return library.open(localIdentifier)
				}
			},
		)

		assertEquals(PassOutcome.WaitingForUser, runBlocking { engine.runPass(Long.MAX_VALUE) })
		assertEquals(PhotoBackupIssue.PHOTO_ACCESS_REQUIRED, preferences.snapshot.issue)
		assertEquals(0L, ledger.statistics("source").unreadableCount)
	}

	@Test
	fun selectedAccessBacksUpTheSelection() {
		library.access = PhotoLibraryAccess.SELECTED
		library.select(library.add())
		library.add()

		assertEquals(PassOutcome.Completed, pass())
		assertEquals(1, server.uploads.size)
	}

	// Selecting more photos changes no row's generation, so an incremental read can't see them.
	@Test
	fun photosAddedToTheSelectionAreBackedUp() {
		library.access = PhotoLibraryAccess.SELECTED
		library.select(library.add())
		val later = library.add()
		pass()

		library.select(later)
		settle()

		assertEquals(2, server.uploads.size)
		assertEquals(PhotoBackupLedger.AssetState.UPLOADED, ledger.assetRecord("source", later)?.state)
	}

	@Test
	fun allowingAccessToEverythingBacksUpTheRestOfTheLibrary() {
		library.access = PhotoLibraryAccess.SELECTED
		library.select(library.add())
		val rest = List(3) { library.add() }
		pass()
		assertEquals(1, server.uploads.size)

		library.access = PhotoLibraryAccess.FULL
		settle()

		assertEquals(4, server.uploads.size)
		assertTrue(rest.all { ledger.assetRecord("source", it)?.state == PhotoBackupLedger.AssetState.UPLOADED })
	}

	@Test
	fun anItemThatDisappearsBeforeUploadIsDropped() {
		val photo = library.add()
		// The row disappears between the inventory query and the read.
		library.items.getValue(photo).gone = true

		assertEquals(PassOutcome.Completed, pass())
		assertTrue(server.uploads.isEmpty())
		assertNull(ledger.assetRecord("source", photo))
	}

	// ── Revived and unreadable items ──

	// Regression: a revived item rebuilt its old resource key, INSERT OR IGNORE kept the old
	// revision's row, and the asset sat PREPARED with nothing to send while every pass
	// reported more work.
	@Test
	fun aBackedUpPhotoRestoredFromTheTrashIsBackedUpAgainWithoutAnUpload() {
		val photo = library.add()
		assertEquals(PassOutcome.Completed, pass())
		library.trash(photo)
		assertEquals(PassOutcome.Completed, pass())
		assertNull(ledger.assetRecord("source", photo))

		library.untrash(photo)

		assertEquals(PassOutcome.Completed, pass())
		assertEquals(PhotoBackupLedger.AssetState.UPLOADED, ledger.assetRecord("source", photo)?.state)
		assertEquals(1L, ledger.statistics("source").uploadedPhotoCount)
		assertEquals(1, server.uploads.size)
		assertEquals(PhotoBackupPhase.UP_TO_DATE, preferences.snapshot.phase)
	}

	@Test
	fun anInterruptedUploadRestoredFromTheTrashIsUploaded() {
		val photo = library.add()
		server.respond = { PhotoUploadResult.TransportFailed(SocketTimeoutException("timeout")) }
		assertEquals(PassOutcome.RetryLater, pass())
		library.trash(photo)
		pass()
		library.untrash(photo)
		server.respond = { PhotoUploadResult.Succeeded(16) }

		assertEquals(PassOutcome.Completed, pass())
		assertEquals(PhotoBackupLedger.AssetState.UPLOADED, ledger.assetRecord("source", photo)?.state)
		assertEquals(2, server.uploads.size)
	}

	@Test
	fun aRejectedItemRestoredFromTheTrashStaysRejectedUntilTryAgain() {
		val photo = library.add()
		server.respond = { PhotoUploadResult.Rejected(413, null) }
		pass()
		library.trash(photo)
		pass()
		library.untrash(photo)
		server.respond = { PhotoUploadResult.Succeeded(16) }

		assertEquals(PassOutcome.Completed, pass())
		assertEquals(PhotoBackupLedger.AssetState.FAILED, ledger.assetRecord("source", photo)?.state)
		assertEquals(1, server.uploads.size)

		preferences.requestRecoveryRetry("source")
		assertEquals(PassOutcome.Completed, pass())
		assertEquals(PhotoBackupLedger.AssetState.UPLOADED, ledger.assetRecord("source", photo)?.state)
	}

	// Regression: one failed read marked a present item DELETED, and nothing ever revived it.
	@Test
	fun anItemThatCantBeReadIsKeptAndTriedAgain() {
		val kept = library.add()
		val flaky = library.add()
		library.items.getValue(flaky).unreadable = true

		assertEquals(PassOutcome.Completed, pass())
		assertEquals(PhotoBackupLedger.AssetState.UNREADABLE, ledger.assetRecord("source", flaky)?.state)
		assertEquals(PhotoBackupLedger.AssetState.UPLOADED, ledger.assetRecord("source", kept)?.state)
		assertEquals(1L, preferences.snapshot.statistics?.unreadableCount)

		// Still unreadable: tried once per pass, never a loop of passes.
		assertEquals(PassOutcome.Completed, pass())

		library.items.getValue(flaky).unreadable = false
		assertEquals(PassOutcome.Completed, pass())
		assertEquals(PhotoBackupLedger.AssetState.UPLOADED, ledger.assetRecord("source", flaky)?.state)
		assertEquals(0L, preferences.snapshot.statistics?.unreadableCount)
		assertEquals(2, server.uploads.size)
	}

	@Test
	fun anEmptyFileNeedsAttentionWithoutARequest() {
		val photo = library.add(bytes = ByteArray(0))

		pass()

		assertTrue(server.uploads.isEmpty())
		assertEquals(PhotoBackupLedger.AssetState.FAILED, ledger.assetRecord("source", photo)?.state)
	}

	@Test
	fun aPassStopsUploadingAtItsDeadline() = runBlocking {
		repeat(3) { library.add() }

		val outcome = engine().runPass(deadlineMs = 0)

		assertEquals(PassOutcome.MoreWork, outcome)
		assertTrue(server.uploads.isEmpty())
		assertEquals(3L, ledger.statistics("source").queuedCount)
	}

	private fun configure(includePhotos: Boolean = true, includeVideos: Boolean = true, skippedFolders: Set<String> = emptySet()) {
		preferences.save(PhotoBackupConfiguration("umbrel", source, includePhotos, includeVideos, allowsCellularAccess = false, skippedFolders = skippedFolders))
	}

	private var savedDevices = mapOf("umbrel" to Umbreld.Target("umbrel", listOf("192.168.1.10", "100.90.0.1")))

	private fun engine(library: PhotoBackupLibrary = this.library) =
		PhotoBackupEngine(preferences, ledger, library, server, secrets, targets = { savedDevices[it] })

	private fun pass(): PassOutcome = runBlocking { engine().runPass(Long.MAX_VALUE) }

	/** Runs passes until one leaves nothing to do right away, as the worker's chain does. */
	private fun settle(): PassOutcome {
		var outcome: PassOutcome
		do outcome = pass() while (outcome == PassOutcome.MoreWork)
		return outcome
	}
}
