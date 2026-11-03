import Foundation
import SQLite3
import XCTest
@testable import UmbrelKit

final class PhotoBackupLedgerTests: XCTestCase {
	private var directory: URL!
	private var databaseURL: URL!

	override func setUpWithError() throws {
		directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
		try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
		databaseURL = directory.appendingPathComponent("photo-backup.sqlite")
	}

	override func tearDownWithError() throws {
		try? FileManager.default.removeItem(at: directory)
	}

	func testSchemaVersionIsEstablishedAndReopens() throws {
		XCTAssertNotNil(PhotoBackupLedger(url: databaseURL))
		XCTAssertEqual(try userVersion(), 2)

		XCTAssertNotNil(PhotoBackupLedger(url: databaseURL))
		XCTAssertEqual(try userVersion(), 2)
	}

	func testCompatibleUnversionedLedgerIsAdoptedWithoutLosingData() throws {
		do {
			let ledger = try makeLedger()
			try ledger.seedInventory([candidate("photo", mediaType: 1)], deviceId: "device", changeToken: Data())
		}
		try setUserVersion(0)

		let reopened = try makeLedger()
		XCTAssertNotNil(try reopened.assetRecord(deviceId: "device", localIdentifier: "photo"))
		XCTAssertEqual(try userVersion(), 2)
	}

	func testNewerSchemaVersionIsRejectedWithoutChangingIt() throws {
		try setUserVersion(3)
		XCTAssertEqual(try journalMode(), "delete")

		XCTAssertNil(PhotoBackupLedger(url: databaseURL))
		XCTAssertEqual(try userVersion(), 3)
		XCTAssertEqual(try journalMode(), "delete")
	}

	func testConcurrentInitializersShareOneSchemaBootstrap() throws {
		let lock = NSLock()
		var successfulOpens = 0
		DispatchQueue.concurrentPerform(iterations: 8) { _ in
			let opened = PhotoBackupLedger(url: databaseURL) != nil
			lock.lock()
			if opened { successfulOpens += 1 }
			lock.unlock()
		}

		XCTAssertEqual(successfulOpens, 8)
		XCTAssertEqual(try userVersion(), 2)
	}

	func testImplausibleReceiptBytesAreRejectedAtomically() throws {
		let ledger = try makeLedger()
		try ledger.seedInventory(
			[candidate("photo", mediaType: 1)],
			deviceId: "device",
			changeToken: Data()
		)
		try ledger.prepareAsset(
			deviceId: "device",
			localIdentifier: "photo",
			revision: 1,
			resources: [
				.init(resourceKey: "still", filename: "photo.heic", destinationPath: "/photo.heic"),
				.init(resourceKey: "motion", filename: "photo.mov", destinationPath: "/photo.mov"),
			]
		)

		XCTAssertThrowsError(
			try ledger.recordResourceSucceeded(resourceKey: "still", bytes: .max)
		) { error in
			XCTAssertEqual(error as? PhotoBackupLedger.ReceiptError, .invalidByteCount)
		}
		XCTAssertThrowsError(
			try ledger.recordConfirmedResources([
				.init(resourceKey: "still", bytes: 10),
				.init(resourceKey: "motion", bytes: 0),
			])
		) { error in
			XCTAssertEqual(error as? PhotoBackupLedger.ReceiptError, .invalidByteCount)
		}

		let resources = try ledger.resources(deviceId: "device", localIdentifier: "photo", revision: 1)
		XCTAssertTrue(resources.allSatisfy { $0.state == PhotoBackupLedger.resourcePending })
	}

	func testMaximumPlausibleReceiptsRemainSummable() throws {
		let ledger = try makeLedger()
		try ledger.seedInventory(
			[candidate("photo", mediaType: 1)],
			deviceId: "device",
			changeToken: Data()
		)
		try ledger.prepareAsset(
			deviceId: "device",
			localIdentifier: "photo",
			revision: 1,
			resources: [
				.init(resourceKey: "still", filename: "photo.heic", destinationPath: "/photo.heic"),
				.init(resourceKey: "motion", filename: "photo.mov", destinationPath: "/photo.mov"),
			]
		)

		try ledger.recordResourceSucceeded(
			resourceKey: "still",
			bytes: PhotoBackupLedger.maximumResourceBytes
		)
		try ledger.recordResourceSucceeded(
			resourceKey: "motion",
			bytes: PhotoBackupLedger.maximumResourceBytes
		)

		let expected = PhotoBackupLedger.maximumResourceBytes * 2
		XCTAssertEqual(try ledger.statistics(deviceId: "device").uploadedBytes, expected)
		XCTAssertEqual(
			try ledger.assetRecord(deviceId: "device", localIdentifier: "photo")?.uploadedBytes,
			expected
		)
	}

	func testInventoryFiltersDisabledMediaAndFinalizesEveryResourceTogether() throws {
		let ledger = try makeLedger()
		try ledger.seedInventory(
			[
				candidate("photo", mediaType: 1),
				candidate("video", mediaType: 2),
			],
			deviceId: "device",
			changeToken: Data("first".utf8)
		)

		XCTAssertEqual(try ledger.changeToken(deviceId: "device"), Data("first".utf8))
		var stats = try ledger.statistics(deviceId: "device", includePhotos: true, includeVideos: false)
		XCTAssertEqual(stats.queuedCount, 1)
		XCTAssertEqual(stats.preparedCount, 0)
		XCTAssertEqual(try ledger.nextAssets(
			deviceId: "device", includePhotos: true, includeVideos: false, limit: 10
		).map(\.localIdentifier), ["photo"])

		try ledger.prepareAsset(
			deviceId: "device",
			localIdentifier: "photo",
			revision: 1,
			resources: [
				.init(resourceKey: "still", filename: "photo.heic", destinationPath: "/Photos/photo.heic"),
				.init(resourceKey: "motion", filename: "photo.mov", destinationPath: "/Photos/photo.mov"),
			]
		)
		try ledger.recordResourceSucceeded(resourceKey: "still", bytes: 10)
		stats = try ledger.statistics(deviceId: "device", includePhotos: true, includeVideos: false)
		XCTAssertEqual(stats.preparedCount, 1)
		XCTAssertEqual(stats.uploadedCount, 0)

		try ledger.recordResourceSucceeded(resourceKey: "motion", bytes: 20)
		stats = try ledger.statistics(deviceId: "device", includePhotos: true, includeVideos: false)
		XCTAssertEqual(stats.preparedCount, 0)
		XCTAssertEqual(stats.uploadedCount, 1)
		XCTAssertEqual(stats.uploadedBytes, 30)
		XCTAssertEqual(try ledger.assetRecords(deviceId: "device")["photo"]?.uploadedBytes, 30)
	}

	func testStatisticsSplitUploadedPhotosAndVideosWithoutHidingDisabledMedia() throws {
		let ledger = try makeLedger()
		try ledger.seedInventory(
			[candidate("photo", mediaType: 1), candidate("video", mediaType: 2)],
			deviceId: "device",
			changeToken: Data()
		)
		try ledger.prepareAsset(
			deviceId: "device",
			localIdentifier: "photo",
			revision: 1,
			resources: [.init(resourceKey: "photo-resource", filename: "photo.heic", destinationPath: "/photo")]
		)
		try ledger.prepareAsset(
			deviceId: "device",
			localIdentifier: "video",
			revision: 1,
			resources: [.init(resourceKey: "video-resource", filename: "video.mov", destinationPath: "/video")]
		)
		try ledger.recordResourceSucceeded(resourceKey: "photo-resource", bytes: 10)
		try ledger.recordResourceSucceeded(resourceKey: "video-resource", bytes: 20)

		let stats = try ledger.statistics(deviceId: "device", includePhotos: true, includeVideos: false)
		XCTAssertEqual(stats.uploadedPhotoCount, 1)
		XCTAssertEqual(stats.uploadedVideoCount, 1)
		XCTAssertEqual(stats.uploadedCount, 2)
		XCTAssertEqual(stats.uploadedBytes, 30)
	}

	func testForegroundServerReceiptsFinalizePreparedAssetWithoutPhotoKitAcknowledgement() throws {
		let ledger = try makeLedger()
		try ledger.seedInventory(
			[candidate("live-photo", mediaType: 1)],
			deviceId: "device",
			changeToken: Data()
		)
		try ledger.prepareAsset(
			deviceId: "device",
			localIdentifier: "live-photo",
			revision: 1,
			resources: [
				.init(resourceKey: "still", filename: "photo.heic", destinationPath: "source/still.heic"),
				.init(resourceKey: "motion", filename: "photo.mov", destinationPath: "source/motion.mov"),
			]
		)
		try ledger.markResourcesRegistered(["still", "motion"])

		XCTAssertEqual(
			try ledger.unconfirmedResourceReceipts(
				deviceId: "device",
				includePhotos: true,
				includeVideos: true
			),
			[
				.init(resourceKey: "still", fileExtension: "heic"),
				.init(resourceKey: "motion", fileExtension: "mov"),
			]
		)

		try ledger.recordConfirmedResources([
			.init(resourceKey: "still", bytes: 10)
		])
		XCTAssertEqual(try ledger.statistics(deviceId: "device").preparedCount, 1)
		XCTAssertEqual(
			try ledger.unconfirmedResourceReceipts(
				deviceId: "device",
				includePhotos: true,
				includeVideos: true
			),
			[.init(resourceKey: "motion", fileExtension: "mov")]
		)

		try ledger.recordConfirmedResources([
			.init(resourceKey: "motion", bytes: 20)
		])
		var stats = try ledger.statistics(deviceId: "device")
		XCTAssertEqual(stats.preparedCount, 0)
		XCTAssertEqual(stats.uploadedCount, 1)
		XCTAssertEqual(stats.uploadedBytes, 30)
		XCTAssertEqual(
			try ledger.succeededResourceKeys(from: ["still", "motion", "missing"]),
			["still", "motion"]
		)

		// A lost HTTP response can make PhotoKit later report a transport failure
		// for bytes that Umbrel already confirmed. That stale transport result must
		// not revoke the stronger durable server receipt.
		try ledger.recordResourcePending(resourceKey: "still")
		try ledger.recordResourceFailed(resourceKey: "motion", message: "response lost")
		stats = try ledger.statistics(deviceId: "device")
		XCTAssertEqual(stats.uploadedCount, 1)
		XCTAssertEqual(stats.failedCount, 0)
	}

	// The current rendition is the product-level unit of backup. Once PhotoKit
	// reports an edit, a receipt for an earlier rendition cannot mark it backed up.
	func testCurrentRenditionCannotBeFinalizedByAnEarlierVersion() throws {
		let ledger = try makeLedger()
		let original = candidate("photo", mediaType: 1, modificationTime: 1)
		try ledger.seedInventory([original], deviceId: "device", changeToken: Data("first".utf8))
		try ledger.prepareAsset(
			deviceId: "device",
			localIdentifier: "photo",
			revision: 1,
			resources: [.init(resourceKey: "old", filename: "old.heic", destinationPath: "/Photos/old.heic")]
		)

		let edited = candidate("photo", mediaType: 1, modificationTime: 2)
		try ledger.applyChanges(
			inserted: [],
			updated: [edited],
			deleted: [],
			deviceId: "device",
			changeToken: Data("second".utf8)
		)
		try ledger.recordResourceSucceeded(resourceKey: "old", bytes: 10)

		var stats = try ledger.statistics(deviceId: "device")
		XCTAssertEqual(stats.queuedCount, 1)
		XCTAssertEqual(stats.uploadedCount, 0)
		let work = try XCTUnwrap(try ledger.nextAssets(
			deviceId: "device", includePhotos: true, includeVideos: true, limit: 1
		).first)
		XCTAssertEqual(work.revision, 2)

		try ledger.prepareAsset(
			deviceId: "device",
			localIdentifier: "photo",
			revision: 2,
			resources: [.init(resourceKey: "new", filename: "new.heic", destinationPath: "/Photos/new.heic")]
		)
		try ledger.recordResourceSucceeded(resourceKey: "new", bytes: 12)
		stats = try ledger.statistics(deviceId: "device")
		XCTAssertEqual(stats.uploadedCount, 1)
		XCTAssertEqual(stats.uploadedBytes, 12)
	}

	func testUnchangedPhotoKitUpdateDoesNotRequeueUploadedAsset() throws {
		let ledger = try makeLedger()
		let photo = candidate("photo", mediaType: 1, modificationTime: 1)
		try ledger.seedInventory([photo], deviceId: "device", changeToken: Data("first".utf8))
		try ledger.prepareAsset(
			deviceId: "device",
			localIdentifier: "photo",
			revision: 1,
			resources: [.init(resourceKey: "resource", filename: "photo.heic", destinationPath: "/Photos/photo.heic")]
		)
		try ledger.recordResourceSucceeded(resourceKey: "resource", bytes: 10)

		// Upload-job lifecycle changes can surface in PhotoKit's persistent
		// history without changing the asset itself.
		try ledger.applyChanges(
			inserted: [],
			updated: [photo],
			deleted: [],
			deviceId: "device",
			changeToken: Data("second".utf8)
		)

		let stats = try ledger.statistics(deviceId: "device")
		XCTAssertEqual(stats.queuedCount, 0)
		XCTAssertEqual(stats.preparedCount, 0)
		XCTAssertEqual(stats.uploadedCount, 1)
		XCTAssertTrue(try ledger.nextAssets(
			deviceId: "device", includePhotos: true, includeVideos: true, limit: 1
		).isEmpty)
	}

	func testLiveObservedEditAndPersistentReplayAdvanceOnlyOneRevision() throws {
		let ledger = try makeLedger()
		let original = candidate("photo", mediaType: 1, modificationTime: 1)
		try ledger.seedInventory([original], deviceId: "device", changeToken: Data("first".utf8))
		try ledger.prepareAsset(
			deviceId: "device",
			localIdentifier: "photo",
			revision: 1,
			resources: [.init(resourceKey: "old", filename: "old.heic", destinationPath: "/Photos/old.heic")]
		)
		try ledger.recordResourceSucceeded(resourceKey: "old", bytes: 10)

		let edited = candidate("photo", mediaType: 1, modificationTime: 2)
		XCTAssertTrue(try ledger.recordObservedChanges(
			inserted: [], contentChanged: [edited], metadataChanged: [], deviceId: "device"
		))
		XCTAssertFalse(try ledger.recordObservedChanges(
			inserted: [], contentChanged: [edited], metadataChanged: [], deviceId: "device"
		))
		XCTAssertEqual(try ledger.changeToken(deviceId: "device"), Data("first".utf8))
		try ledger.applyChanges(
			inserted: [],
			updated: [edited],
			deleted: [],
			deviceId: "device",
			changeToken: Data("second".utf8)
		)

		let work = try XCTUnwrap(try ledger.nextAssets(
			deviceId: "device", includePhotos: true, includeVideos: true, limit: 1
		).first)
		XCTAssertEqual(work.localIdentifier, "photo")
		XCTAssertEqual(work.revision, 2)
		XCTAssertEqual(try ledger.changeToken(deviceId: "device"), Data("second".utf8))
	}

	func testLiveMetadataChangeAdvancesWatermarkWithoutRequeueingUploadedAsset() throws {
		let ledger = try makeLedger()
		let original = candidate("photo", mediaType: 1, modificationTime: 1)
		try ledger.seedInventory([original], deviceId: "device", changeToken: Data("first".utf8))
		try ledger.prepareAsset(
			deviceId: "device",
			localIdentifier: "photo",
			revision: 1,
			resources: [.init(resourceKey: "resource", filename: "photo.heic", destinationPath: "/Photos/photo.heic")]
		)
		try ledger.recordResourceSucceeded(resourceKey: "resource", bytes: 10)

		let metadataUpdate = candidate("photo", mediaType: 1, modificationTime: 2)
		XCTAssertFalse(try ledger.recordObservedChanges(
			inserted: [], contentChanged: [], metadataChanged: [metadataUpdate], deviceId: "device"
		))
		let record = try XCTUnwrap(try ledger.assetRecords(deviceId: "device")["photo"])
		XCTAssertEqual(record.state, .uploaded)
		XCTAssertEqual(record.modificationDate.timeIntervalSince1970, 2, accuracy: 0.001)

		// Persistent history later reports the same generic update. The live
		// metadata watermark makes that replay idempotent.
		try ledger.applyChanges(
			inserted: [],
			updated: [metadataUpdate],
			deleted: [],
			deviceId: "device",
			changeToken: Data("second".utf8)
		)
		XCTAssertTrue(try ledger.nextAssets(
			deviceId: "device", includePhotos: true, includeVideos: true, limit: 1
		).isEmpty)
		XCTAssertEqual(try ledger.statistics(deviceId: "device").uploadedCount, 1)
	}

	func testAssetVersionDateChangesOnlyWhenContentChanges() throws {
		let ledger = try makeLedger()
		try ledger.seedInventory(
			[candidate("photo", mediaType: 1, modificationTime: 1)],
			deviceId: "device",
			changeToken: Data()
		)

		let metadataUpdate = candidate("photo", mediaType: 1, modificationTime: 2)
		XCTAssertFalse(try ledger.recordObservedChanges(
			inserted: [], contentChanged: [], metadataChanged: [metadataUpdate], deviceId: "device"
		))
		var work = try XCTUnwrap(try ledger.nextAssets(
			deviceId: "device", includePhotos: true, includeVideos: true, limit: 1
		).first)
		XCTAssertEqual(work.revision, 1)
		XCTAssertEqual(work.contentVersionDate.timeIntervalSince1970, 1, accuracy: 0.001)

		let contentUpdate = candidate("photo", mediaType: 1, modificationTime: 3)
		XCTAssertTrue(try ledger.recordObservedChanges(
			inserted: [], contentChanged: [contentUpdate], metadataChanged: [], deviceId: "device"
		))
		work = try XCTUnwrap(try ledger.nextAssets(
			deviceId: "device", includePhotos: true, includeVideos: true, limit: 1
		).first)
		XCTAssertEqual(work.revision, 2)
		XCTAssertEqual(work.contentVersionDate.timeIntervalSince1970, 3, accuracy: 0.001)
	}

	func testInventoryDoesNotLetMetadataClassificationHideLaterPersistentUpdate() throws {
		let ledger = try makeLedger()
		let original = candidate("photo", mediaType: 1, modificationTime: 1)
		let scan = try ledger.startInventoryScan(
			deviceId: "device",
			changeToken: Data("before-scan".utf8)
		)
		XCTAssertEqual(
			try ledger.recordInventoryBatch([original], deviceId: "device", generation: scan.generation),
			1
		)
		try ledger.prepareAsset(
			deviceId: "device",
			localIdentifier: "photo",
			revision: 1,
			resources: [.init(resourceKey: "resource", filename: "photo.heic", destinationPath: "/Photos/photo.heic")]
		)
		try ledger.recordResourceSucceeded(resourceKey: "resource", bytes: 10)

		let updateDuringScan = candidate("photo", mediaType: 1, modificationTime: 2)
		XCTAssertFalse(try ledger.recordObservedChanges(
			inserted: [], contentChanged: [], metadataChanged: [updateDuringScan], deviceId: "device"
		))
		let recordDuringScan = try XCTUnwrap(try ledger.assetRecords(deviceId: "device")["photo"])
		XCTAssertEqual(recordDuringScan.state, .uploaded)
		XCTAssertEqual(recordDuringScan.modificationDate.timeIntervalSince1970, 1, accuracy: 0.001)

		try ledger.finishInventoryScan(deviceId: "device", generation: scan.generation)
		try ledger.applyChanges(
			inserted: [],
			updated: [updateDuringScan],
			deleted: [],
			deviceId: "device",
			changeToken: Data("after-update".utf8)
		)
		let work = try XCTUnwrap(try ledger.nextAssets(
			deviceId: "device", includePhotos: true, includeVideos: true, limit: 1
		).first)
		XCTAssertEqual(work.localIdentifier, "photo")
		XCTAssertEqual(work.revision, 2)
	}

	func testFailedResourceNeedsAttentionWithoutLosingOtherReceipts() throws {
		let ledger = try makeLedger()
		try ledger.seedInventory([candidate("live", mediaType: 1)], deviceId: "device", changeToken: Data())
		try ledger.prepareAsset(
			deviceId: "device",
			localIdentifier: "live",
			revision: 1,
			resources: [
				.init(resourceKey: "still", filename: "live.heic", destinationPath: "/Photos/live.heic"),
				.init(resourceKey: "motion", filename: "live.mov", destinationPath: "/Photos/live.mov"),
			]
		)
		try ledger.recordResourceSucceeded(resourceKey: "still", bytes: 10)
		try ledger.recordResourceFailed(resourceKey: "motion", message: "timed out")

		let stats = try ledger.statistics(deviceId: "device")
		XCTAssertEqual(stats.failedCount, 1)
		XCTAssertEqual(stats.uploadedCount, 0)
		let resources = try ledger.resources(deviceId: "device", localIdentifier: "live", revision: 1)
		XCTAssertEqual(resources.first { $0.resourceKey == "still" }?.state, PhotoBackupLedger.resourceSucceeded)
		XCTAssertEqual(resources.first { $0.resourceKey == "motion" }?.state, PhotoBackupLedger.resourceFailed)

		try ledger.requeueFailedAssets(deviceId: "device", includePhotos: true, includeVideos: true)
		let retried = try ledger.resources(deviceId: "device", localIdentifier: "live", revision: 1)
		XCTAssertEqual(retried.first { $0.resourceKey == "still" }?.state, PhotoBackupLedger.resourceSucceeded)
		XCTAssertEqual(retried.first { $0.resourceKey == "motion" }?.state, PhotoBackupLedger.resourcePending)
		XCTAssertEqual(try ledger.statistics(deviceId: "device").queuedCount, 1)
	}

	func testFailedResourcesRetryOnceAfterBackupCatchesUp() throws {
		let ledger = try makeLedger()
		try ledger.seedInventory(
			[candidate("backed-up", mediaType: 1), candidate("failing", mediaType: 1)],
			deviceId: "device",
			changeToken: Data()
		)
		try prepare(ledger, "backed-up")
		try prepare(ledger, "failing")
		try ledger.recordResourceFailed(resourceKey: "failing", message: "server error")
		XCTAssertFalse(
			try ledger.requeueFailedAssetsAfterProgress(deviceId: "device", includePhotos: true, includeVideos: true),
			"Failed uploads wait while other assets are still being backed up"
		)

		try ledger.recordResourceSucceeded(resourceKey: "backed-up", bytes: 10)
		XCTAssertTrue(
			try ledger.requeueFailedAssetsAfterProgress(deviceId: "device", includePhotos: true, includeVideos: true)
		)
		var stats = try ledger.statistics(deviceId: "device")
		XCTAssertEqual(stats.failedCount, 0)
		XCTAssertEqual(stats.queuedCount, 1)

		try ledger.recordResourceFailed(resourceKey: "failing", message: "server error")
		XCTAssertFalse(
			try ledger.requeueFailedAssetsAfterProgress(deviceId: "device", includePhotos: true, includeVideos: true),
			"A resource that keeps failing isn't retried again until another backup succeeds"
		)
		stats = try ledger.statistics(deviceId: "device")
		XCTAssertEqual(stats.failedCount, 1)

		XCTAssertTrue(try ledger.recordObservedChanges(
			inserted: [candidate("new", mediaType: 1)],
			contentChanged: [],
			metadataChanged: [],
			deviceId: "device"
		))
		try prepare(ledger, "new")
		try ledger.recordResourceSucceeded(resourceKey: "new", bytes: 10)
		XCTAssertTrue(
			try ledger.requeueFailedAssetsAfterProgress(deviceId: "device", includePhotos: true, includeVideos: true)
		)
		XCTAssertEqual(try ledger.statistics(deviceId: "device").failedCount, 0)
	}

	func testStatisticsReportWhenTheLastAssetFinishedUploading() throws {
		let ledger = try makeLedger()
		try ledger.seedInventory([candidate("photo", mediaType: 1)], deviceId: "device", changeToken: Data())
		try prepare(ledger, "photo")
		XCTAssertNil(try ledger.statistics(deviceId: "device").lastUploadedAt)

		let before = Date()
		try ledger.recordResourceSucceeded(resourceKey: "photo", bytes: 10)
		let lastUploadedAt = try XCTUnwrap(try ledger.statistics(deviceId: "device").lastUploadedAt)
		XCTAssertEqual(lastUploadedAt.timeIntervalSince1970, before.timeIntervalSince1970, accuracy: 5)
	}

	func testConnectivityFailureReturnsOnlyFailedResourceToQueue() throws {
		let ledger = try makeLedger()
		try ledger.seedInventory([candidate("live", mediaType: 1)], deviceId: "device", changeToken: Data())
		try ledger.prepareAsset(
			deviceId: "device",
			localIdentifier: "live",
			revision: 1,
			resources: [
				.init(resourceKey: "still", filename: "live.heic", destinationPath: "/Photos/live.heic"),
				.init(resourceKey: "motion", filename: "live.mov", destinationPath: "/Photos/live.mov"),
			]
		)
		try ledger.recordResourceSucceeded(resourceKey: "still", bytes: 10)
		try ledger.recordResourcePending(resourceKey: "motion")

		let resources = try ledger.resources(deviceId: "device", localIdentifier: "live", revision: 1)
		XCTAssertEqual(resources.first { $0.resourceKey == "still" }?.state, PhotoBackupLedger.resourceSucceeded)
		XCTAssertEqual(resources.first { $0.resourceKey == "motion" }?.state, PhotoBackupLedger.resourcePending)
		let stats = try ledger.statistics(deviceId: "device")
		XCTAssertEqual(stats.failedCount, 0)
		XCTAssertEqual(stats.preparedCount, 1)
	}

	func testFullInventoryRescanKeepsPresentAssetsAndDropsOnlyMissingOnes() throws {
		let ledger = try makeLedger()
		try ledger.seedInventory(
			[candidate("present", mediaType: 1), candidate("removed", mediaType: 1)],
			deviceId: "device",
			changeToken: Data("first".utf8)
		)
		try ledger.prepareAsset(
			deviceId: "device",
			localIdentifier: "present",
			revision: 1,
			resources: [.init(resourceKey: "present-resource", filename: "present.heic", destinationPath: "/Photos/present.heic")]
		)
		try ledger.recordResourceSucceeded(
			resourceKey: "present-resource",
			bytes: 10
		)

		try ledger.seedInventory(
			[candidate("present", mediaType: 1), candidate("new", mediaType: 1)],
			deviceId: "device",
			changeToken: Data("second".utf8)
		)

		let stats = try ledger.statistics(deviceId: "device")
		XCTAssertEqual(stats.uploadedCount, 1)
		XCTAssertEqual(stats.queuedCount, 1)
		XCTAssertEqual(try ledger.changeToken(deviceId: "device"), Data("second".utf8))
		XCTAssertEqual(
			try ledger.nextAssets(deviceId: "device", includePhotos: true, includeVideos: true, limit: 10)
				.map(\.localIdentifier),
			["new"]
		)
	}

	func testIncrementalInventoryScanDoesNotPublishTokenOrDeleteUntilFinished() throws {
		let ledger = try makeLedger()
		try ledger.seedInventory(
			[candidate("present", mediaType: 1), candidate("removed", mediaType: 1)],
			deviceId: "device",
			changeToken: Data("old".utf8)
		)
		try ledger.clearChangeToken(deviceId: "device")

		let scan = try ledger.startInventoryScan(deviceId: "device", changeToken: Data("captured".utf8))
		XCTAssertEqual(try ledger.recordInventoryBatch(
			[candidate("present", mediaType: 1), candidate("new", mediaType: 1)],
			deviceId: "device",
			generation: scan.generation
		), 2)
		XCTAssertEqual(try ledger.recordInventoryBatch(
			[candidate("present", mediaType: 1), candidate("new", mediaType: 1)],
			deviceId: "device",
			generation: scan.generation
		), 0)

		XCTAssertNil(try ledger.changeToken(deviceId: "device"))
		XCTAssertEqual(try ledger.statistics(deviceId: "device").queuedCount, 3)

		try ledger.finishInventoryScan(deviceId: "device", generation: scan.generation)
		XCTAssertEqual(try ledger.changeToken(deviceId: "device"), Data("captured".utf8))
		XCTAssertEqual(try ledger.statistics(deviceId: "device").queuedCount, 2)
	}

	func testInventoryFinishedByAnotherProcessIsSuperseded() throws {
		let ledger = try makeLedger()
		// The app and PhotoKit's extension both join a new library's inventory
		let scan = try ledger.startInventoryScan(deviceId: "device", changeToken: Data("captured".utf8))
		let other = try ledger.startInventoryScan(deviceId: "device", changeToken: Data("captured".utf8))
		XCTAssertEqual(other.generation, scan.generation)
		try ledger.finishInventoryScan(deviceId: "device", generation: other.generation)

		XCTAssertThrowsError(
			try ledger.recordInventoryBatch([candidate("late", mediaType: 1)], deviceId: "device", generation: scan.generation)
		) { XCTAssertEqual($0 as? PhotoBackupLedger.InventoryScanError, .superseded) }
		XCTAssertThrowsError(try ledger.finishInventoryScan(deviceId: "device", generation: scan.generation)) {
			XCTAssertEqual($0 as? PhotoBackupLedger.InventoryScanError, .superseded)
		}
	}

	func testInventoryBatchChecksOnlyItsBoundedCandidateSet() throws {
		let ledger = try makeLedger()
		let scan = try ledger.startInventoryScan(deviceId: "device", changeToken: Data("captured".utf8))
		let first = (0..<256).map { candidate("asset-\($0)", mediaType: 1) }
		let overlapping = (128..<384).map { candidate("asset-\($0)", mediaType: 1) }

		XCTAssertEqual(
			try ledger.recordInventoryBatch(first, deviceId: "device", generation: scan.generation),
			256
		)
		XCTAssertEqual(
			try ledger.recordInventoryBatch(overlapping, deviceId: "device", generation: scan.generation),
			128
		)
		XCTAssertEqual(
			try ledger.recordInventoryBatch(overlapping, deviceId: "device", generation: scan.generation),
			0
		)
		XCTAssertEqual(try ledger.statistics(deviceId: "device").queuedCount, 384)
	}

	func testStaleInventoryBatchDoesNotSeedCandidates() throws {
		let ledger = try makeLedger()
		let scan = try ledger.startInventoryScan(deviceId: "device", changeToken: Data("captured".utf8))
		try ledger.clearChangeToken(deviceId: "device")

		XCTAssertThrowsError(
			try ledger.recordInventoryBatch(
				[candidate("stale", mediaType: 1)],
				deviceId: "device",
				generation: scan.generation
			)
		)
		XCTAssertEqual(try ledger.statistics(deviceId: "device").queuedCount, 0)
	}

	func testOrphanedRegisteredResourceReturnsToPending() throws {
		let ledger = try makeLedger()
		try ledger.seedInventory([candidate("photo", mediaType: 1)], deviceId: "device", changeToken: Data())
		try ledger.prepareAsset(
			deviceId: "device",
			localIdentifier: "photo",
			revision: 1,
			resources: [.init(resourceKey: "resource", filename: "photo.heic", destinationPath: "/Photos/photo.heic")]
		)
		try ledger.markResourcesRegistered(["resource"])

		try ledger.releaseOrphanedRegisteredResources(
			deviceId: "device",
			activeResourceKeys: [],
			includePhotos: true,
			includeVideos: true
		)

		XCTAssertEqual(
			try ledger.resources(deviceId: "device", localIdentifier: "photo", revision: 1).first?.state,
			PhotoBackupLedger.resourcePending
		)
	}

	func testStoppedLedgerRefusesWorkAndHoldsNoLock() throws {
		let ledger = try makeLedger()
		try ledger.seedInventory([candidate("before", mediaType: 1)], deviceId: "device", changeToken: Data())

		ledger.stop()

		XCTAssertTrue(ledger.isStopped)
		XCTAssertThrowsError(
			try ledger.seedInventory([candidate("after", mediaType: 1)], deviceId: "device", changeToken: Data())
		) { error in
			XCTAssertEqual((error as? PhotoBackupLedger.DatabaseError)?.code, SQLITE_INTERRUPT)
		}
		let other = try makeLedger()
		try other.seedInventory([candidate("other", mediaType: 1)], deviceId: "other", changeToken: Data())
		XCTAssertNotNil(try other.assetRecord(deviceId: "device", localIdentifier: "before"))
		XCTAssertNil(try other.assetRecord(deviceId: "device", localIdentifier: "after"))
	}

	// As when iOS takes the app's time back in the middle of a long write
	func testStopEndsAWriteInFlightAndKeepsNoneOfIt() throws {
		let ledger = try makeLedger()
		let candidates = (0..<200_000).map { candidate("photo\($0)", mediaType: 1) }
		let returned = expectation(description: "The write returned")
		var writeError: Error?
		DispatchQueue.global().async {
			do {
				try ledger.seedInventory(candidates, deviceId: "device", changeToken: Data())
			} catch {
				writeError = error
			}
			returned.fulfill()
		}
		Thread.sleep(forTimeInterval: 0.05)

		let stopped = Date()
		ledger.stop()

		XCTAssertLessThan(Date().timeIntervalSince(stopped), 1)
		wait(for: [returned], timeout: 10)
		XCTAssertEqual((writeError as? PhotoBackupLedger.DatabaseError)?.code, SQLITE_INTERRUPT)
		// Rolled back whole, and nothing keeps another connection from writing
		let other = try makeLedger()
		XCTAssertNil(try other.assetRecord(deviceId: "device", localIdentifier: "photo0"))
		try other.seedInventory([candidate("other", mediaType: 1)], deviceId: "other", changeToken: Data())
	}

	// Closing the last connection otherwise copies the log into the database under an
	// exclusive lock, after the app's time is up
	func testStopClosesWithoutCopyingTheLog() throws {
		var ledger: PhotoBackupLedger? = try makeLedger()
		try ledger?.seedInventory(
			(0..<1_000).map { candidate("photo\($0)", mediaType: 1) },
			deviceId: "device",
			changeToken: Data()
		)
		let size = try fileSize()

		ledger?.stop()
		ledger = nil

		XCTAssertEqual(try fileSize(), size)
		XCTAssertNotNil(try makeLedger().assetRecord(deviceId: "device", localIdentifier: "photo999"))
	}

	func testNextAssetsSkipsFullyRegisteredAssetsAndRefillsFreedJobSlots() throws {
		let ledger = try makeLedger()
		try ledger.seedInventory(
			[
				candidate("registered", mediaType: 1, creationTime: 3),
				candidate("partially-prepared", mediaType: 1, creationTime: 2),
				candidate("unprepared", mediaType: 1, creationTime: 1),
			],
			deviceId: "device",
			changeToken: Data()
		)
		try ledger.prepareAsset(
			deviceId: "device",
			localIdentifier: "registered",
			revision: 1,
			resources: [.init(resourceKey: "registered-resource", filename: "registered.heic", destinationPath: "/Photos/registered.heic")]
		)
		try ledger.markResourcesRegistered(["registered-resource"])
		try ledger.prepareAsset(
			deviceId: "device",
			localIdentifier: "partially-prepared",
			revision: 1,
			resources: [.init(resourceKey: "pending-resource", filename: "pending.heic", destinationPath: "/Photos/pending.heic")]
		)

		XCTAssertEqual(
			try ledger.nextAssets(
				deviceId: "device",
				includePhotos: true,
				includeVideos: true,
				limit: 10
			).map(\.localIdentifier),
			["partially-prepared", "unprepared"]
		)
	}

	func testOnlyCurrentEnabledRevisionOwnsAResourceJob() throws {
		let ledger = try makeLedger()
		try ledger.seedInventory(
			[candidate("photo", mediaType: 1, modificationTime: 1)],
			deviceId: "device",
			changeToken: Data()
		)
		try ledger.prepareAsset(
			deviceId: "device",
			localIdentifier: "photo",
			revision: 1,
			resources: [.init(resourceKey: "old", filename: "photo.heic", destinationPath: "/Photos/photo.heic")]
		)
		try ledger.applyChanges(
			inserted: [],
			updated: [candidate("photo", mediaType: 1, modificationTime: 2)],
			deleted: [],
			deviceId: "device",
			changeToken: Data("edit".utf8)
		)
		try ledger.prepareAsset(
			deviceId: "device",
			localIdentifier: "photo",
			revision: 2,
			resources: [.init(resourceKey: "current", filename: "photo.heic", destinationPath: "/Photos/photo.heic")]
		)
		try ledger.seedInventory(
			[candidate("photo", mediaType: 1)],
			deviceId: "other-source",
			changeToken: Data()
		)
		try ledger.prepareAsset(
			deviceId: "other-source",
			localIdentifier: "photo",
			revision: 1,
			resources: [.init(resourceKey: "other", filename: "photo.heic", destinationPath: "/Photos/photo.heic")]
		)

		XCTAssertEqual(
			try ledger.currentResourceKeys(
				from: ["old", "current", "other", "unknown"],
				deviceId: "device",
				includePhotos: true,
				includeVideos: false
			),
			["current"]
		)
		XCTAssertTrue(try ledger.currentResourceKeys(
			from: ["current"],
			deviceId: "device",
			includePhotos: false,
			includeVideos: true
		).isEmpty)
	}

	func testAssetStatesExposePresentationStateWithoutDeletedAssets() throws {
		let ledger = try makeLedger()
		try ledger.seedInventory(
			[candidate("pending", mediaType: 1), candidate("prepared", mediaType: 1), candidate("removed", mediaType: 1)],
			deviceId: "device",
			changeToken: Data()
		)
		try ledger.prepareAsset(
			deviceId: "device",
			localIdentifier: "prepared",
			revision: 1,
			resources: [.init(resourceKey: "resource", filename: "photo.heic", destinationPath: "/Photos/photo.heic")]
		)
		try ledger.markDeleted(deviceId: "device", localIdentifier: "removed")

		XCTAssertEqual(
			try ledger.assetStates(deviceId: "device"),
			[
				"pending": .pending,
				"prepared": .prepared,
			]
		)
	}

	func testAssetRecordsExposeModificationDateForCurrentCoverage() throws {
		let ledger = try makeLedger()
		try ledger.seedInventory(
			[candidate("photo", mediaType: 1, modificationTime: 42)],
			deviceId: "device",
			changeToken: Data()
		)

		let record = try XCTUnwrap(try ledger.assetRecords(deviceId: "device")["photo"])
		XCTAssertEqual(record.state, .pending)
		XCTAssertEqual(record.modificationDate, Date(timeIntervalSince1970: 42))
	}

	func testAssetRecordUsesTheCurrentSourceAndHidesDeletedAssets() throws {
		let ledger = try makeLedger()
		try ledger.seedInventory(
			[candidate("photo", mediaType: 1, modificationTime: 42)],
			deviceId: "source",
			changeToken: Data()
		)

		XCTAssertEqual(
			try ledger.assetRecord(deviceId: "source", localIdentifier: "photo")?.modificationDate,
			Date(timeIntervalSince1970: 42)
		)
		XCTAssertNil(try ledger.assetRecord(deviceId: "other-source", localIdentifier: "photo"))
		try ledger.markDeleted(deviceId: "source", localIdentifier: "photo")
		XCTAssertNil(try ledger.assetRecord(deviceId: "source", localIdentifier: "photo"))
	}

	func testReceiptCacheStaysBoundedAndInvalidatesForANewRevision() async throws {
		let ledger = try makeLedger()
		try ledger.seedInventory(
			[candidate("one", mediaType: 1), candidate("two", mediaType: 1), candidate("three", mediaType: 1)],
			deviceId: "source",
			changeToken: Data()
		)
		let cache = PhotoBackupReceiptCache(ledgerURL: databaseURL, capacity: 2)
		let revision = Date(timeIntervalSince1970: 1)

		let first = await cache.record(sourceId: "source", revision: revision, localIdentifier: "one")
		XCTAssertEqual(first?.state, .pending)
		_ = await cache.record(sourceId: "source", revision: revision, localIdentifier: "two")
		_ = await cache.record(sourceId: "source", revision: revision, localIdentifier: "three")
		var count = await cache.cachedEntryCount
		XCTAssertEqual(count, 2)

		_ = await cache.record(
			sourceId: "source",
			revision: Date(timeIntervalSince1970: 2),
			localIdentifier: "one"
		)
		count = await cache.cachedEntryCount
		XCTAssertEqual(count, 1)

		_ = await cache.record(sourceId: "source", revision: revision, localIdentifier: "two")
		count = await cache.cachedEntryCount
		XCTAssertEqual(count, 1)
	}

	private func makeLedger() throws -> PhotoBackupLedger {
		try XCTUnwrap(PhotoBackupLedger(url: databaseURL))
	}

	private func prepare(_ ledger: PhotoBackupLedger, _ localIdentifier: String) throws {
		try ledger.prepareAsset(
			deviceId: "device",
			localIdentifier: localIdentifier,
			revision: 1,
			resources: [
				.init(
					resourceKey: localIdentifier,
					filename: "\(localIdentifier).heic",
					destinationPath: "/Photos/\(localIdentifier).heic"
				),
			]
		)
	}

	private func userVersion() throws -> Int32 {
		let database = try openDatabase()
		defer { sqlite3_close(database) }
		var statement: OpaquePointer?
		let prepareResult = sqlite3_prepare_v2(database, "PRAGMA user_version", -1, &statement, nil)
		guard prepareResult == SQLITE_OK, let statement else {
			throw sqliteError(prepareResult)
		}
		defer { sqlite3_finalize(statement) }
		let stepResult = sqlite3_step(statement)
		guard stepResult == SQLITE_ROW else { throw sqliteError(stepResult) }
		return sqlite3_column_int(statement, 0)
	}

	private func setUserVersion(_ version: Int32) throws {
		let database = try openDatabase()
		defer { sqlite3_close(database) }
		let result = sqlite3_exec(database, "PRAGMA user_version = \(version)", nil, nil, nil)
		guard result == SQLITE_OK else { throw sqliteError(result) }
	}

	private func journalMode() throws -> String {
		let database = try openDatabase()
		defer { sqlite3_close(database) }
		var statement: OpaquePointer?
		let prepareResult = sqlite3_prepare_v2(database, "PRAGMA journal_mode", -1, &statement, nil)
		guard prepareResult == SQLITE_OK, let statement else {
			throw sqliteError(prepareResult)
		}
		defer { sqlite3_finalize(statement) }
		let stepResult = sqlite3_step(statement)
		guard stepResult == SQLITE_ROW, let value = sqlite3_column_text(statement, 0) else {
			throw sqliteError(stepResult)
		}
		return String(cString: value)
	}

	private func fileSize() throws -> Int {
		try XCTUnwrap(FileManager.default.attributesOfItem(atPath: databaseURL.path)[.size] as? Int)
	}

	private func openDatabase() throws -> OpaquePointer {
		var database: OpaquePointer?
		let result = sqlite3_open(databaseURL.path, &database)
		guard result == SQLITE_OK, let database else {
			if let database { sqlite3_close(database) }
			throw sqliteError(result)
		}
		return database
	}

	private func sqliteError(_ code: Int32) -> NSError {
		NSError(domain: "PhotoBackupLedgerTests.SQLite", code: Int(code))
	}

	private func candidate(
		_ identifier: String,
		mediaType: Int64,
		creationTime: TimeInterval = 1,
		modificationTime: TimeInterval = 1
	) -> PhotoBackupLedger.AssetCandidate {
		.init(
			localIdentifier: identifier,
			mediaType: mediaType,
			creationDate: Date(timeIntervalSince1970: creationTime),
			modificationDate: Date(timeIntervalSince1970: modificationTime)
		)
	}
}
