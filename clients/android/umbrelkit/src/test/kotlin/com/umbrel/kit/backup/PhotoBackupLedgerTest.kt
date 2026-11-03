package com.umbrel.kit.backup

import androidx.sqlite.driver.AndroidSQLiteDriver
import androidx.sqlite.execSQL
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.umbrel.kit.backup.PhotoBackupLedger.AssetCandidate
import com.umbrel.kit.backup.PhotoBackupLedger.AssetState
import com.umbrel.kit.backup.PhotoBackupLedger.ResourcePlan
import com.umbrel.kit.backup.PhotoBackupLedger.ResourceReceipt
import com.umbrel.kit.backup.PhotoBackupLedger.ResourceReceiptQuery
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.Collections
import kotlin.concurrent.thread

@RunWith(AndroidJUnit4::class)
class PhotoBackupLedgerTest {
	private lateinit var directory: File
	private lateinit var databaseFile: File
	private val opened = mutableListOf<PhotoBackupLedger>()

	@Before
	fun setUp() {
		directory = File(System.getProperty("java.io.tmpdir"), "umbrel-ledger-" + System.nanoTime()).apply { mkdirs() }
		databaseFile = File(directory, "photo-backup.sqlite")
	}

	@After
	fun tearDown() {
		opened.forEach { it.close() }
		directory.deleteRecursively()
	}

	@Test
	fun schemaVersionIsEstablishedAndReopens() {
		makeLedger()
		assertEquals(PhotoBackupLedger.SCHEMA_VERSION, pragma("user_version"))

		makeLedger()
		assertEquals(PhotoBackupLedger.SCHEMA_VERSION, pragma("user_version"))
	}

	// Only development builds wrote schema 2, keyed by modification date.
	@Test
	fun anEarlierSchemaIsRebuilt() {
		AndroidSQLiteDriver().open(databaseFile.absolutePath).use {
			it.execSQL("CREATE TABLE photo_assets (deviceId TEXT NOT NULL, localIdentifier TEXT NOT NULL, modificationDate REAL NOT NULL)")
			it.execSQL("INSERT INTO photo_assets VALUES ('device', 'photo', 1.0)")
			it.execSQL("PRAGMA user_version = 2")
		}

		val ledger = makeLedger()

		assertEquals(PhotoBackupLedger.SCHEMA_VERSION, pragma("user_version"))
		assertNull(ledger.assetRecord("device", "photo"))
		ledger.seedInventory(listOf(candidate("photo", 1)), "device")
		assertEquals(AssetState.PENDING, ledger.assetRecord("device", "photo")?.state)
	}

	@Test
	fun compatibleUnversionedLedgerIsAdoptedWithoutLosingData() {
		makeLedger().seedInventory(listOf(candidate("photo", 1)), "device")
		opened.removeAt(opened.lastIndex).close()
		setUserVersion(0)

		val reopened = makeLedger()
		assertNotNull(reopened.assetRecord("device", "photo"))
		assertEquals(PhotoBackupLedger.SCHEMA_VERSION, pragma("user_version"))
	}

	@Test
	fun newerSchemaVersionIsRejectedWithoutChangingIt() {
		val newer = PhotoBackupLedger.SCHEMA_VERSION + 1
		setUserVersion(newer.toInt())
		val journalMode = journalMode()
		assertNotEquals("wal", journalMode)

		assertThrows(PhotoBackupLedger.DatabaseException::class.java) { PhotoBackupLedger(databaseFile) }
		assertEquals(newer, pragma("user_version"))
		assertEquals(journalMode, journalMode())
	}

	@Test
	fun concurrentInitializersShareOneSchemaBootstrap() {
		val successes = Collections.synchronizedList(mutableListOf<PhotoBackupLedger>())
		val threads = List(8) { thread { runCatching { PhotoBackupLedger(databaseFile) }.onSuccess { successes += it } } }
		threads.forEach { it.join() }
		opened += successes

		assertEquals(8, successes.size)
		assertEquals(PhotoBackupLedger.SCHEMA_VERSION, pragma("user_version"))
	}

	@Test
	fun implausibleReceiptBytesAreRejectedAtomically() {
		val ledger = makeLedger()
		ledger.seedInventory(listOf(candidate("photo", 1)), "device")
		ledger.prepareAsset("device", "photo", 1, listOf(plan("still", "/photo.heic"), plan("motion", "/photo.mov")))

		assertThrows(PhotoBackupLedger.InvalidByteCountException::class.java) { ledger.recordResourceSucceeded("still", Long.MAX_VALUE) }
		assertThrows(PhotoBackupLedger.InvalidByteCountException::class.java) {
			ledger.recordConfirmedResources(listOf(ResourceReceipt("still", 10), ResourceReceipt("motion", 0)))
		}

		assertTrue(ledger.resources("device", "photo", 1).all { it.state == PhotoBackupLedger.RESOURCE_PENDING })
	}

	@Test
	fun maximumPlausibleReceiptsRemainSummable() {
		val ledger = makeLedger()
		ledger.seedInventory(listOf(candidate("photo", 1)), "device")
		ledger.prepareAsset("device", "photo", 1, listOf(plan("still", "/photo.heic"), plan("motion", "/photo.mov")))

		ledger.recordResourceSucceeded("still", PhotoBackupLedger.MAX_RESOURCE_BYTES)
		ledger.recordResourceSucceeded("motion", PhotoBackupLedger.MAX_RESOURCE_BYTES)

		val expected = PhotoBackupLedger.MAX_RESOURCE_BYTES * 2
		assertEquals(expected, ledger.statistics("device").uploadedBytes)
		assertEquals(expected, ledger.assetRecord("device", "photo")?.uploadedBytes)
	}

	@Test
	fun inventoryFiltersDisabledMediaAndFinalizesEveryResourceTogether() {
		val ledger = makeLedger()
		ledger.seedInventory(listOf(candidate("photo", 1), candidate("video", 2)), "device", "first")

		assertEquals("first", ledger.changeToken("device"))
		var stats = ledger.statistics("device", includePhotos = true, includeVideos = false)
		assertEquals(1L, stats.queuedCount)
		assertEquals(0L, stats.preparedCount)
		assertEquals(listOf("photo"), ledger.nextAssets("device", includePhotos = true, includeVideos = false, limit = 10).map { it.localIdentifier })

		ledger.prepareAsset("device", "photo", 1, listOf(plan("still", "/Photos/photo.heic"), plan("motion", "/Photos/photo.mov")))
		ledger.recordResourceSucceeded("still", 10)
		stats = ledger.statistics("device", includePhotos = true, includeVideos = false)
		assertEquals(1L, stats.preparedCount)
		assertEquals(0L, stats.uploadedCount)

		ledger.recordResourceSucceeded("motion", 20)
		stats = ledger.statistics("device", includePhotos = true, includeVideos = false)
		assertEquals(0L, stats.preparedCount)
		assertEquals(1L, stats.uploadedCount)
		assertEquals(30L, stats.uploadedBytes)
		assertEquals(30L, ledger.assetRecord("device", "photo")?.uploadedBytes)
	}

	@Test
	fun statisticsReportWhenTheLastItemFinishedUploading() {
		val ledger = makeLedger()
		ledger.seedInventory(listOf(candidate("photo", 1)), "device")
		assertNull(ledger.statistics("device").lastUploadedAtMs)

		ledger.prepareAsset("device", "photo", 1, listOf(plan("still", "/Photos/photo.heic")))
		val before = System.currentTimeMillis()
		ledger.recordResourceSucceeded("still", 10)

		val uploadedAt = requireNotNull(ledger.statistics("device").lastUploadedAtMs)
		assertTrue(uploadedAt in (before - 1)..System.currentTimeMillis())
	}

	@Test
	fun statisticsSplitUploadedPhotosAndVideosWithoutHidingDisabledMedia() {
		val ledger = makeLedger()
		ledger.seedInventory(listOf(candidate("photo", 1), candidate("video", 2)), "device")
		ledger.prepareAsset("device", "photo", 1, listOf(plan("photo-resource", "/photo")))
		ledger.prepareAsset("device", "video", 1, listOf(plan("video-resource", "/video")))
		ledger.recordResourceSucceeded("photo-resource", 10)
		ledger.recordResourceSucceeded("video-resource", 20)

		val stats = ledger.statistics("device", includePhotos = true, includeVideos = false)
		assertEquals(1L, stats.uploadedPhotoCount)
		assertEquals(1L, stats.uploadedVideoCount)
		assertEquals(2L, stats.uploadedCount)
		assertEquals(30L, stats.uploadedBytes)
	}

	@Test
	fun skippedFoldersAreNotQueuedAndTheirUploadsAreReportedApart() {
		val ledger = makeLedger()
		ledger.seedInventory(listOf(candidate("camera", 1, folder = CAMERA), candidate("whatsapp", 1, creationTime = 2, folder = WHATSAPP)), "device")
		val skipped = setOf(WHATSAPP)

		assertEquals(listOf("camera"), ledger.nextAssets("device", includePhotos = true, includeVideos = true, limit = 10, skippedFolders = skipped).map { it.localIdentifier })
		assertEquals(1L, ledger.statistics("device", skippedFolders = skipped).queuedCount)
		assertEquals(2L, ledger.statistics("device").queuedCount)

		// Uploaded before the folder was skipped: still counted, and reported as skipped.
		ledger.prepareAsset("device", "whatsapp", 1, listOf(plan("whatsapp-resource", "/whatsapp")))
		ledger.recordResourceSucceeded("whatsapp-resource", 10)
		val stats = ledger.statistics("device", skippedFolders = skipped)
		assertEquals(1L, stats.uploadedPhotoCount)
		assertEquals(1L, stats.uploadedSkippedPhotoCount)
		assertEquals(10L, stats.uploadedBytes)
		assertEquals(0L, ledger.statistics("device").uploadedSkippedPhotoCount)
	}

	@Test
	fun anItemMovedToAnotherFolderKeepsItsReceipt() {
		val ledger = makeLedger()
		ledger.seedInventory(listOf(candidate("photo", 1, folder = CAMERA)), "device")
		ledger.prepareAsset("device", "photo", 1, listOf(plan("photo-resource", "/photo")))
		ledger.recordResourceSucceeded("photo-resource", 10)

		ledger.applyChanges(listOf(candidate("photo", 1, generation = 2, folder = WHATSAPP)), emptySet(), "device", "moved")

		assertEquals(AssetState.UPLOADED, ledger.assetRecord("device", "photo")?.state)
		assertEquals(1L, ledger.statistics("device", skippedFolders = setOf(WHATSAPP)).uploadedSkippedPhotoCount)
		assertEquals(0L, ledger.statistics("device", skippedFolders = setOf(CAMERA)).uploadedSkippedPhotoCount)
	}

	@Test
	fun aDateReadDifferentlyLaterReordersTheQueueWithoutANewRevision() {
		val ledger = makeLedger()
		ledger.seedInventory(listOf(candidate("older", 1, creationTime = 1), candidate("newer", 1, creationTime = 2)), "device")

		ledger.seedInventory(listOf(candidate("older", 1, creationTime = 3), candidate("newer", 1, creationTime = 2)), "device")

		val next = ledger.nextAssets("device", includePhotos = true, includeVideos = true, limit = 10)
		assertEquals(listOf("older", "newer"), next.map { it.localIdentifier })
		assertEquals(listOf(1L, 1L), next.map { it.revision })
	}

	// Version 4 had no folders: its receipts stay, the next pass is a full inventory that
	// records every folder, and until then an unknown folder is never skipped.
	@Test
	fun aVersion4LedgerGainsFoldersWithoutLosingReceipts() {
		AndroidSQLiteDriver().open(databaseFile.absolutePath).use {
			it.execSQL(
				"CREATE TABLE photo_assets (deviceId TEXT NOT NULL, localIdentifier TEXT NOT NULL, mediaType INTEGER NOT NULL, " +
					"revision INTEGER NOT NULL DEFAULT 1, state INTEGER NOT NULL, creationDate REAL NOT NULL, contentSize INTEGER NOT NULL, " +
					"contentGeneration INTEGER NOT NULL, inventoryGeneration INTEGER NOT NULL DEFAULT 0, expectedResources INTEGER NOT NULL DEFAULT 0, " +
					"uploadedBytes INTEGER NOT NULL DEFAULT 0, uploadedAt REAL, lastError TEXT, PRIMARY KEY (deviceId, localIdentifier))",
			)
			it.execSQL(
				"CREATE TABLE photo_resources (resourceKey TEXT PRIMARY KEY, deviceId TEXT NOT NULL, localIdentifier TEXT NOT NULL, " +
					"revision INTEGER NOT NULL, filename TEXT NOT NULL, destinationPath TEXT NOT NULL, state INTEGER NOT NULL, " +
					"bytes INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, lastError TEXT)",
			)
			it.execSQL(
				"CREATE TABLE photo_inventory_scans (deviceId TEXT PRIMARY KEY, generation INTEGER NOT NULL, " +
					"changeToken BLOB NOT NULL, imageCursor INTEGER, videoCursor INTEGER)",
			)
			it.execSQL("CREATE TABLE photo_metadata (deviceId TEXT NOT NULL, key TEXT NOT NULL, value BLOB NOT NULL, PRIMARY KEY (deviceId, key))")
			it.execSQL(
				"INSERT INTO photo_assets (deviceId, localIdentifier, mediaType, state, creationDate, contentSize, contentGeneration, " +
					"inventoryGeneration, expectedResources, uploadedBytes, uploadedAt) VALUES " +
					"('device', 'uploaded', 1, ${AssetState.UPLOADED.raw}, 1.0, 1, 1, 1, 1, 10, 1.0), " +
					"('device', 'waiting', 1, ${AssetState.PENDING.raw}, 2.0, 1, 1, 1, 0, 0, NULL)",
			)
			it.execSQL(
				"INSERT INTO photo_resources (resourceKey, deviceId, localIdentifier, revision, filename, destinationPath, state, bytes) " +
					"VALUES ('uploaded-resource', 'device', 'uploaded', 1, 'uploaded', '/uploaded', ${PhotoBackupLedger.RESOURCE_SUCCEEDED}, 10)",
			)
			it.execSQL("INSERT INTO photo_metadata VALUES ('device', 'photoLibraryChangeToken', X'7B7D')")
			it.execSQL("PRAGMA user_version = 4")
		}

		val ledger = makeLedger()

		assertEquals(PhotoBackupLedger.SCHEMA_VERSION, pragma("user_version"))
		assertNull(ledger.changeToken("device"))
		assertEquals(AssetState.UPLOADED, ledger.assetRecord("device", "uploaded")?.state)
		assertEquals(
			listOf("waiting"),
			ledger.nextAssets("device", includePhotos = true, includeVideos = true, limit = 10, skippedFolders = setOf(WHATSAPP)).map { it.localIdentifier },
		)

		ledger.seedInventory(listOf(candidate("uploaded", 1, folder = WHATSAPP), candidate("waiting", 1, creationTime = 2, folder = WHATSAPP)), "device")

		assertEquals(AssetState.UPLOADED, ledger.assetRecord("device", "uploaded")?.state)
		assertTrue(ledger.nextAssets("device", includePhotos = true, includeVideos = true, limit = 10, skippedFolders = setOf(WHATSAPP)).isEmpty())
		assertEquals(1L, ledger.statistics("device", skippedFolders = setOf(WHATSAPP)).uploadedSkippedPhotoCount)
	}

	@Test
	fun anUploadLeftUnfinishedGoesBehindTheQueueUntilOneFinishes() {
		val ledger = makeLedger()
		ledger.seedInventory(listOf(candidate("older", 1, creationTime = 1), candidate("newer", 1, creationTime = 2)), "device")
		fun order() = ledger.nextAssets("device", includePhotos = true, includeVideos = true, limit = 10).map { it.localIdentifier }

		ledger.uploadStarted("device", "newer")
		assertEquals(listOf("older", "newer"), order())

		ledger.uploadStarted("device", "newer")
		ledger.uploadFinished("device", "newer")
		assertEquals(listOf("newer", "older"), order())
	}

	// Version 5 didn't record cut-off uploads: every item starts with none and keeps its place.
	@Test
	fun aVersion5LedgerKeepsItsRowsAndOrder() {
		PhotoBackupLedger(databaseFile).use { ledger ->
			ledger.seedInventory(listOf(candidate("older", 1, creationTime = 1), candidate("newer", 1, creationTime = 2)), "device")
		}
		AndroidSQLiteDriver().open(databaseFile.absolutePath).use {
			it.execSQL("ALTER TABLE photo_assets DROP COLUMN interruptions")
			it.execSQL("PRAGMA user_version = 5")
		}

		val ledger = makeLedger()

		assertEquals(PhotoBackupLedger.SCHEMA_VERSION, pragma("user_version"))
		assertEquals(listOf("newer", "older"), ledger.nextAssets("device", includePhotos = true, includeVideos = true, limit = 10).map { it.localIdentifier })
		ledger.uploadStarted("device", "newer")
		assertEquals(listOf("older", "newer"), ledger.nextAssets("device", includePhotos = true, includeVideos = true, limit = 10).map { it.localIdentifier })
	}

	@Test
	fun serverReceiptsFinalizeAPreparedAssetAndOutrankLaterTransportResults() {
		val ledger = makeLedger()
		ledger.seedInventory(listOf(candidate("live-photo", 1)), "device")
		ledger.prepareAsset("device", "live-photo", 1, listOf(plan("still", "source/still.heic"), plan("motion", "source/motion.mov")))

		assertEquals(
			listOf(ResourceReceiptQuery("still", "heic"), ResourceReceiptQuery("motion", "mov")),
			ledger.unconfirmedResourceReceipts("device", includePhotos = true, includeVideos = true),
		)

		ledger.recordConfirmedResources(listOf(ResourceReceipt("still", 10)))
		assertEquals(1L, ledger.statistics("device").preparedCount)
		assertEquals(listOf(ResourceReceiptQuery("motion", "mov")), ledger.unconfirmedResourceReceipts("device", includePhotos = true, includeVideos = true))

		ledger.recordConfirmedResources(listOf(ResourceReceipt("motion", 20)))
		var stats = ledger.statistics("device")
		assertEquals(0L, stats.preparedCount)
		assertEquals(1L, stats.uploadedCount)
		assertEquals(30L, stats.uploadedBytes)

		// A lost response can surface later as a transport failure for bytes Umbrel already
		// confirmed. That stale result must not revoke the stronger receipt.
		ledger.recordResourcePending("still")
		ledger.recordResourceFailed("motion", "response lost")
		stats = ledger.statistics("device")
		assertEquals(1L, stats.uploadedCount)
		assertEquals(0L, stats.failedCount)
	}

	// The current rendition is the unit of backup. Once an edit is ingested, a receipt for an
	// earlier rendition can't mark it backed up.
	@Test
	fun currentRenditionCannotBeFinalizedByAnEarlierVersion() {
		val ledger = makeLedger()
		ledger.seedInventory(listOf(candidate("photo", 1, size = 1)), "device", "first")
		ledger.prepareAsset("device", "photo", 1, listOf(plan("old", "/Photos/old.heic")))

		ledger.applyChanges(listOf(candidate("photo", 1, size = 2, generation = 2)), emptySet(), "device", "second")
		ledger.recordResourceSucceeded("old", 10)

		var stats = ledger.statistics("device")
		assertEquals(1L, stats.queuedCount)
		assertEquals(0L, stats.uploadedCount)
		val work = ledger.nextAssets("device", includePhotos = true, includeVideos = true, limit = 1).single()
		assertEquals(2L, work.revision)

		ledger.prepareAsset("device", "photo", 2, listOf(plan("new", "/Photos/new.heic")))
		ledger.recordResourceSucceeded("new", 12)
		stats = ledger.statistics("device")
		assertEquals(1L, stats.uploadedCount)
		assertEquals(12L, stats.uploadedBytes)
	}

	@Test
	fun aPlanForAReplacedRevisionIsIgnored() {
		val ledger = makeLedger()
		ledger.seedInventory(listOf(candidate("photo", 1, size = 1)), "device")
		ledger.applyChanges(listOf(candidate("photo", 1, size = 2, generation = 2)), emptySet(), "device", null)

		ledger.prepareAsset("device", "photo", 1, listOf(plan("stale", "/stale.jpg")))

		assertTrue(ledger.resources("device", "photo", 1).isEmpty())
		assertEquals(1L, ledger.statistics("device").queuedCount)
	}

	// MediaStore advances an item's generation for metadata-only changes too, such as a
	// favorite or a new modification date.
	@Test
	fun anUnchangedUpdateDoesNotRequeueAnUploadedAsset() {
		val ledger = makeLedger()
		ledger.seedInventory(listOf(candidate("photo", 1, size = 10, generation = 1)), "device", "first")
		ledger.prepareAsset("device", "photo", 1, listOf(plan("resource", "/Photos/photo.heic")))
		ledger.recordResourceSucceeded("resource", 10)

		ledger.applyChanges(listOf(candidate("photo", 1, size = 10, generation = 7)), emptySet(), "device", "second")

		val stats = ledger.statistics("device")
		assertEquals(0L, stats.queuedCount)
		assertEquals(0L, stats.preparedCount)
		assertEquals(1L, stats.uploadedCount)
		assertTrue(ledger.nextAssets("device", includePhotos = true, includeVideos = true, limit = 1).isEmpty())
	}

	@Test
	fun theContentVersionChangesOnlyWithTheSize() {
		val ledger = makeLedger()
		ledger.seedInventory(listOf(candidate("photo", 1, size = 10, generation = 4)), "device")
		var work = ledger.nextAssets("device", includePhotos = true, includeVideos = true, limit = 1).single()
		assertEquals(1L, work.revision)
		assertEquals(10L, work.contentSize)
		assertEquals(4L, work.contentGeneration)

		ledger.applyChanges(listOf(candidate("photo", 1, size = 10, generation = 5)), emptySet(), "device", null)
		work = ledger.nextAssets("device", includePhotos = true, includeVideos = true, limit = 1).single()
		assertEquals(1L, work.revision)
		assertEquals(4L, work.contentGeneration)

		ledger.applyChanges(listOf(candidate("photo", 1, size = 12, generation = 9)), emptySet(), "device", null)
		work = ledger.nextAssets("device", includePhotos = true, includeVideos = true, limit = 1).single()
		assertEquals(2L, work.revision)
		assertEquals(12L, work.contentSize)
		assertEquals(9L, work.contentGeneration)
	}

	@Test
	fun failedResourceNeedsAttentionWithoutLosingOtherReceipts() {
		val ledger = makeLedger()
		ledger.seedInventory(listOf(candidate("live", 1)), "device")
		ledger.prepareAsset("device", "live", 1, listOf(plan("still", "/Photos/live.heic"), plan("motion", "/Photos/live.mov")))
		ledger.recordResourceSucceeded("still", 10)
		ledger.recordResourceFailed("motion", "timed out")

		val stats = ledger.statistics("device")
		assertEquals(1L, stats.failedCount)
		assertEquals(0L, stats.uploadedCount)
		val resources = ledger.resources("device", "live", 1)
		assertEquals(PhotoBackupLedger.RESOURCE_SUCCEEDED, resources.single { it.resourceKey == "still" }.state)
		assertEquals(PhotoBackupLedger.RESOURCE_FAILED, resources.single { it.resourceKey == "motion" }.state)

		ledger.requeueFailedAssets("device", includePhotos = true, includeVideos = true)
		val retried = ledger.resources("device", "live", 1)
		assertEquals(PhotoBackupLedger.RESOURCE_SUCCEEDED, retried.single { it.resourceKey == "still" }.state)
		assertEquals(PhotoBackupLedger.RESOURCE_PENDING, retried.single { it.resourceKey == "motion" }.state)
		assertEquals(1L, ledger.statistics("device").queuedCount)
	}

	@Test
	fun attemptsFailAResourceAtTheLimitAndTryAgainStartsOver() {
		val ledger = makeLedger()
		ledger.seedInventory(listOf(candidate("photo", 1)), "device")
		ledger.prepareAsset("device", "photo", 1, listOf(plan("resource", "/photo.jpg")))

		assertFalse(ledger.recordResourceAttempt("resource", "server error", limit = 2))
		assertEquals(AssetState.PREPARED, ledger.assetRecord("device", "photo")?.state)
		assertEquals(1L, ledger.statistics("device").preparedCount)
		assertTrue(ledger.recordResourceAttempt("resource", "server error", limit = 2))
		assertEquals(AssetState.FAILED, ledger.assetRecord("device", "photo")?.state)

		ledger.requeueFailedAssets("device", includePhotos = true, includeVideos = true)
		assertFalse(ledger.recordResourceAttempt("resource", "server error", limit = 2))
		assertEquals(AssetState.PENDING, ledger.assetRecord("device", "photo")?.state)
	}

	@Test
	fun requeueingFailedAssetsLeavesDisabledMediaFailed() {
		val ledger = makeLedger()
		ledger.seedInventory(listOf(candidate("photo", 1), candidate("video", 2)), "device")
		ledger.prepareAsset("device", "photo", 1, listOf(plan("photo-resource", "/photo.jpg")))
		ledger.prepareAsset("device", "video", 1, listOf(plan("video-resource", "/video.mp4")))
		ledger.recordResourceFailed("photo-resource", "rejected")
		ledger.recordResourceFailed("video-resource", "rejected")

		ledger.requeueFailedAssets("device", includePhotos = true, includeVideos = false)

		assertEquals(AssetState.PENDING, ledger.assetRecord("device", "photo")?.state)
		assertEquals(AssetState.FAILED, ledger.assetRecord("device", "video")?.state)
	}

	@Test
	fun connectivityFailureReturnsOnlyFailedResourceToQueue() {
		val ledger = makeLedger()
		ledger.seedInventory(listOf(candidate("live", 1)), "device")
		ledger.prepareAsset("device", "live", 1, listOf(plan("still", "/Photos/live.heic"), plan("motion", "/Photos/live.mov")))
		ledger.recordResourceSucceeded("still", 10)
		ledger.recordResourcePending("motion")

		val resources = ledger.resources("device", "live", 1)
		assertEquals(PhotoBackupLedger.RESOURCE_SUCCEEDED, resources.single { it.resourceKey == "still" }.state)
		assertEquals(PhotoBackupLedger.RESOURCE_PENDING, resources.single { it.resourceKey == "motion" }.state)
		val stats = ledger.statistics("device")
		assertEquals(0L, stats.failedCount)
		assertEquals(1L, stats.preparedCount)
	}

	@Test
	fun fullInventoryRescanKeepsPresentAssetsAndDropsOnlyMissingOnes() {
		val ledger = makeLedger()
		ledger.seedInventory(listOf(candidate("present", 1), candidate("removed", 1)), "device", "first")
		ledger.prepareAsset("device", "present", 1, listOf(plan("present-resource", "/Photos/present.heic")))
		ledger.recordResourceSucceeded("present-resource", 10)

		ledger.seedInventory(listOf(candidate("present", 1), candidate("new", 1)), "device", "second")

		val stats = ledger.statistics("device")
		assertEquals(1L, stats.uploadedCount)
		assertEquals(1L, stats.queuedCount)
		assertEquals("second", ledger.changeToken("device"))
		assertEquals(listOf("new"), ledger.nextAssets("device", includePhotos = true, includeVideos = true, limit = 10).map { it.localIdentifier })
		assertEquals(2L, ledger.presentAssetCount("device", PhotoBackupLedger.MEDIA_TYPE_IMAGE))
	}

	@Test
	fun incrementalInventoryScanDoesNotPublishTokenOrDeleteUntilFinished() {
		val ledger = makeLedger()
		ledger.seedInventory(listOf(candidate("present", 1), candidate("removed", 1)), "device", "old")
		ledger.clearChangeToken("device")

		val scan = ledger.startInventoryScan("device", "captured")
		ledger.recordInventoryBatch(listOf(candidate("present", 1), candidate("new", 1)), "device", scan.generation, PhotoBackupLedger.MEDIA_TYPE_IMAGE, 7)

		assertNull(ledger.changeToken("device"))
		assertEquals(3L, ledger.statistics("device").queuedCount)
		// A resumed pass gets the scan already in progress, with the token captured at its
		// start and the cursor where the last page ended.
		assertEquals(scan.copy(imageCursor = 7), ledger.startInventoryScan("device", "later"))

		ledger.finishInventoryScan("device", scan.generation)
		assertEquals("captured", ledger.changeToken("device"))
		assertEquals(2L, ledger.statistics("device").queuedCount)
	}

	@Test
	fun inventoryCursorsAreKeptPerMediaType() {
		val ledger = makeLedger()
		val scan = ledger.startInventoryScan("device", "captured")
		assertNull(scan.cursor(PhotoBackupLedger.MEDIA_TYPE_IMAGE))

		ledger.recordInventoryBatch(listOf(candidate("photo", 1)), "device", scan.generation, PhotoBackupLedger.MEDIA_TYPE_IMAGE, null)
		ledger.recordInventoryBatch(listOf(candidate("video", 2)), "device", scan.generation, PhotoBackupLedger.MEDIA_TYPE_VIDEO, 42)

		val resumed = ledger.inventoryScan("device")!!
		assertEquals(PhotoBackupLedger.INVENTORY_FINISHED, resumed.cursor(PhotoBackupLedger.MEDIA_TYPE_IMAGE))
		assertEquals(42L, resumed.cursor(PhotoBackupLedger.MEDIA_TYPE_VIDEO))
	}

	@Test
	fun staleInventoryBatchDoesNotSeedCandidates() {
		val ledger = makeLedger()
		val scan = ledger.startInventoryScan("device", "captured")
		ledger.clearChangeToken("device")

		assertThrows(PhotoBackupLedger.DatabaseException::class.java) {
			ledger.recordInventoryBatch(listOf(candidate("stale", 1)), "device", scan.generation, PhotoBackupLedger.MEDIA_TYPE_IMAGE, null)
		}
		assertEquals(0L, ledger.statistics("device").queuedCount)
	}

	@Test
	fun assetRecordsExposePresentationStateWithoutDeletedAssets() {
		val ledger = makeLedger()
		ledger.seedInventory(listOf(candidate("pending", 1), candidate("prepared", 1), candidate("removed", 1)), "device")
		ledger.prepareAsset("device", "prepared", 1, listOf(plan("resource", "/Photos/photo.heic")))
		ledger.markDeleted("device", "removed")

		assertEquals(AssetState.PENDING, ledger.assetRecord("device", "pending")?.state)
		assertEquals(AssetState.PREPARED, ledger.assetRecord("device", "prepared")?.state)
		assertNull(ledger.assetRecord("device", "removed"))
		assertEquals(2L, ledger.presentAssetCount("device", PhotoBackupLedger.MEDIA_TYPE_IMAGE))
	}

	@Test
	fun assetRecordUsesTheCurrentSourceAndHidesDeletedAssets() {
		val ledger = makeLedger()
		ledger.seedInventory(listOf(candidate("photo", 1)), "source")

		assertEquals(AssetState.PENDING, ledger.assetRecord("source", "photo")?.state)
		assertNull(ledger.assetRecord("other-source", "photo"))
		ledger.markDeleted("source", "photo")
		assertNull(ledger.assetRecord("source", "photo"))
	}

	@Test
	fun aDeletedAssetThatReturnsReclaimsItsReceipt() {
		val ledger = makeLedger()
		ledger.seedInventory(listOf(candidate("photo", 1)), "device")
		ledger.prepareAsset("device", "photo", 1, listOf(plan("resource", "/photo.jpg")))
		ledger.recordResourceSucceeded("resource", 10)
		ledger.applyChanges(emptyList(), setOf("photo"), "device", null)
		assertNull(ledger.assetRecord("device", "photo"))
		assertEquals(0L, ledger.statistics("device").uploadedPhotoCount)

		ledger.applyChanges(listOf(candidate("photo", 1)), emptySet(), "device", null)

		assertEquals(AssetState.UPLOADED, ledger.assetRecord("device", "photo")?.state)
		assertEquals(10L, ledger.statistics("device").uploadedBytes)
		assertTrue(ledger.nextAssets("device", includePhotos = true, includeVideos = true, limit = 1).isEmpty())
	}

	@Test
	fun aReturningAssetResumesItsPendingResource() {
		val ledger = makeLedger()
		ledger.seedInventory(listOf(candidate("photo", 1)), "device")
		ledger.prepareAsset("device", "photo", 1, listOf(plan("resource", "/photo.jpg")))
		ledger.markDeleted("device", "photo")

		ledger.applyChanges(listOf(candidate("photo", 1)), emptySet(), "device", null)

		assertEquals(AssetState.PREPARED, ledger.assetRecord("device", "photo")?.state)
		assertEquals(1L, ledger.statistics("device").preparedCount)
		assertEquals(1L, ledger.nextAssets("device", includePhotos = true, includeVideos = true, limit = 1).single().revision)
	}

	@Test
	fun aPreparedAssetWithNothingPendingIsNotQueuedWork() {
		val ledger = makeLedger()
		ledger.seedInventory(listOf(candidate("photo", 1)), "device")
		ledger.prepareAsset("device", "photo", 1, emptyList())

		assertEquals(AssetState.PREPARED, ledger.assetRecord("device", "photo")?.state)
		val stats = ledger.statistics("device")
		assertEquals(0L, stats.queuedCount)
		assertEquals(0L, stats.preparedCount)
	}

	@Test
	fun anUnreadableAssetIsCountedAndTriedAgain() {
		val ledger = makeLedger()
		ledger.seedInventory(listOf(candidate("photo", 1)), "device")
		ledger.prepareAsset("device", "photo", 1, listOf(plan("resource", "/photo.jpg")))

		ledger.markAssetUnreadable("device", "photo", 1, "Couldn’t read this item")

		val stats = ledger.statistics("device")
		assertEquals(1L, stats.unreadableCount)
		assertEquals(0L, stats.preparedCount)
		assertEquals(AssetState.UNREADABLE, ledger.assetRecord("device", "photo")?.state)
		assertEquals(listOf("photo"), ledger.nextAssets("device", includePhotos = true, includeVideos = true, limit = 1).map { it.localIdentifier })
		ledger.prepareAsset("device", "photo", 1, listOf(plan("resource", "/photo.jpg")))
		assertEquals(AssetState.PREPARED, ledger.assetRecord("device", "photo")?.state)
	}

	@Test
	fun resourceKeysAreStableAndSixtyFourHex() {
		val key = PhotoBackupEngine.resourceKey("source", "content://media/1", 1, 100, 7, "photo")
		assertEquals(64, key.length)
		assertTrue(key.all { it in '0'..'9' || it in 'a'..'f' })
		assertEquals(key, PhotoBackupEngine.resourceKey("source", "content://media/1", 1, 100, 7, "photo"))
	}

	@Test
	fun everyPartOfTheContentVersionChangesTheResourceKey() {
		val key = PhotoBackupEngine.resourceKey("source", "content://media/1", 1, 100, 7, "photo")
		val variants = listOf(
			PhotoBackupEngine.resourceKey("other", "content://media/1", 1, 100, 7, "photo"),
			PhotoBackupEngine.resourceKey("source", "content://media/2", 1, 100, 7, "photo"),
			PhotoBackupEngine.resourceKey("source", "content://media/1", 2, 100, 7, "photo"),
			PhotoBackupEngine.resourceKey("source", "content://media/1", 1, 101, 7, "photo"),
			PhotoBackupEngine.resourceKey("source", "content://media/1", 1, 100, 8, "photo"),
			PhotoBackupEngine.resourceKey("source", "content://media/1", 1, 100, 7, "video"),
		)
		assertFalse(key in variants)
		assertEquals(variants.size, variants.toSet().size)
	}

	private fun makeLedger() = PhotoBackupLedger(databaseFile).also { opened += it }

	private fun pragma(name: String): Long = AndroidSQLiteDriver().open(databaseFile.absolutePath).use { connection ->
		connection.prepare("PRAGMA $name").use { statement ->
			statement.step()
			statement.getLong(0)
		}
	}

	private fun journalMode(): String = AndroidSQLiteDriver().open(databaseFile.absolutePath).use { connection ->
		connection.prepare("PRAGMA journal_mode").use { statement ->
			statement.step()
			statement.getText(0).lowercase()
		}
	}

	private fun setUserVersion(version: Int) = AndroidSQLiteDriver().open(databaseFile.absolutePath).use { it.execSQL("PRAGMA user_version = $version") }
}

internal fun candidate(identifier: String, mediaType: Long, creationTime: Long = 1, size: Long = 1, generation: Long = 1, folder: String = CAMERA) =
	AssetCandidate(identifier, mediaType, creationTime * 1000, size, generation, folder)

private const val CAMERA = "dcim/camera/"
private const val WHATSAPP = "pictures/whatsapp/"

internal fun plan(resourceKey: String, destinationPath: String) =
	ResourcePlan(resourceKey, destinationPath.substringAfterLast('/'), destinationPath)

/** One complete inventory in a single pass, as iOS's seedInventory does in one transaction. */
internal fun PhotoBackupLedger.seedInventory(candidates: List<AssetCandidate>, sourceId: String, changeToken: String = "") {
	val scan = startInventoryScan(sourceId, changeToken)
	recordInventoryBatch(candidates, sourceId, scan.generation, PhotoBackupLedger.MEDIA_TYPE_IMAGE, null)
	finishInventoryScan(sourceId, scan.generation)
}
