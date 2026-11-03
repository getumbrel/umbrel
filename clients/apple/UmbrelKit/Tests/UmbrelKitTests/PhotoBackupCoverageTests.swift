import Foundation
import XCTest
@testable import UmbrelKit

final class PhotoBackupCoverageTests: XCTestCase {
	func testSnapshotDecodesDataWrittenBeforeStatisticsWereAdded() throws {
		let data = Data(#"{"phase":"waiting","updatedAt":0}"#.utf8)
		let snapshot = try JSONDecoder().decode(PhotoBackupSnapshot.self, from: data)

		XCTAssertEqual(snapshot.phase, .waiting)
		XCTAssertNil(snapshot.issue)
		XCTAssertNil(snapshot.sourceId)
		XCTAssertNil(snapshot.statistics)
	}

	func testStatisticsDecodeDataWrittenBeforeLastUploadTimeWasAdded() throws {
		let data = Data(#"""
		{"queuedCount":1,"preparedCount":0,"uploadedPhotoCount":2,"uploadedVideoCount":0,"failedCount":0,"uploadedBytes":10}
		"""#.utf8)
		let statistics = try JSONDecoder().decode(PhotoBackupStatistics.self, from: data)

		XCTAssertEqual(statistics.uploadedPhotoCount, 2)
		XCTAssertNil(statistics.lastUploadedAt)
	}

	func testInsufficientStorageIssueUsesPhotoKitNormalizedResponseHeader() {
		XCTAssertEqual(
			PhotoBackupIssue(responseHeaderFields: [
				"x-umbrel-photo-backup-error": "insufficient-storage"
			]),
			.insufficientStorage
		)
		XCTAssertNil(PhotoBackupIssue(responseHeaderFields: nil))
		XCTAssertNil(PhotoBackupIssue(responseHeaderFields: [
			"x-umbrel-photo-backup-error": "another-error"
		]))
	}

	func testSnapshotRoundTripsSourceScopedStatistics() throws {
		let statistics = PhotoBackupStatistics(
			queuedCount: 3,
			preparedCount: 2,
			uploadedPhotoCount: 4,
			uploadedVideoCount: 1,
			failedCount: 0,
			uploadedBytes: 42
		)
		let original = PhotoBackupSnapshot(
			phase: .uploading,
			issue: .insufficientStorage,
			updatedAt: Date(timeIntervalSince1970: 1),
			sourceId: "source",
			statistics: statistics
		)

		let decoded = try JSONDecoder().decode(
			PhotoBackupSnapshot.self,
			from: JSONEncoder().encode(original)
		)
		XCTAssertEqual(decoded, original)
	}

	func testAuthenticationIssueSurvivesExtensionAndHostRoundTrip() throws {
		let original = PhotoBackupSnapshot(
			phase: .needsAttention,
			issue: .authenticationRequired,
			sourceId: "source"
		)

		let decoded = try JSONDecoder().decode(
			PhotoBackupSnapshot.self,
			from: JSONEncoder().encode(original)
		)
		XCTAssertEqual(decoded, original)
	}

	func testAuthenticationIssueUsesPhotoKitURLLoadingError() {
		XCTAssertEqual(
			PhotoBackupIssue(uploadError: URLError(.userAuthenticationRequired)),
			.authenticationRequired
		)
		XCTAssertNil(PhotoBackupIssue(uploadError: URLError(.badServerResponse)))
		XCTAssertNil(PhotoBackupIssue(uploadError: nil))
	}

	func testRecoveryRetryRequestIsScopedToItsBackupSource() throws {
		let directory = FileManager.default.temporaryDirectory
			.appendingPathComponent(UUID().uuidString, isDirectory: true)
		try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
		addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
		let files = PhotoBackupSharedFiles(directory: directory)
		let filename = "recovery-retry.json"
		let firstSource = "recovery-\(UUID().uuidString)"
		let secondSource = "recovery-\(UUID().uuidString)"

		XCTAssertTrue(files.write(firstSource, to: filename))
		XCTAssertEqual(files.read(String.self, from: filename), firstSource)

		XCTAssertTrue(files.write(secondSource, to: filename))
		XCTAssertFalse(files.remove(filename, ifEqualTo: firstSource))
		XCTAssertEqual(files.read(String.self, from: filename), secondSource)
		XCTAssertTrue(files.remove(filename, ifEqualTo: secondSource))
		XCTAssertNil(files.read(String.self, from: filename))
	}

	func testSharedFileReadDistinguishesMissingFromUnreadable() throws {
		let directory = FileManager.default.temporaryDirectory
			.appendingPathComponent(UUID().uuidString, isDirectory: true)
		try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
		addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
		let files = PhotoBackupSharedFiles(directory: directory)
		let filename = "configuration.json"

		guard case .missing = files.readResult(String.self, from: filename) else {
			return XCTFail("A missing file must not be reported as a read failure")
		}

		try Data("not-json".utf8).write(to: directory.appendingPathComponent(filename))
		guard case .unavailable = files.readResult(String.self, from: filename) else {
			return XCTFail("Malformed data must not be reported as a missing file")
		}
	}

	func testStatisticsCountUninventoriedAssetsAsRemaining() {
		let statistics = PhotoBackupStatistics(
			queuedCount: 10,
			preparedCount: 5,
			uploadedPhotoCount: 70,
			uploadedVideoCount: 8,
			failedCount: 1,
			uploadedBytes: 42
		)

		XCTAssertEqual(statistics.remainingCount(
			photoCount: 100,
			videoCount: 20,
			includePhotos: true,
			includeVideos: true
		), 42)
		XCTAssertEqual(statistics.remainingCount(
			photoCount: 100,
			videoCount: 20,
			includePhotos: false,
			includeVideos: true
		), 12)
	}

	func testOnlyFailuresRemainWhenNothingElseIsLeft() {
		let statistics = PhotoBackupStatistics(
			queuedCount: 0,
			preparedCount: 0,
			uploadedPhotoCount: 90,
			uploadedVideoCount: 0,
			failedCount: 2,
			uploadedBytes: 42
		)

		XCTAssertFalse(statistics.onlyFailuresRemain(remainingCount: 10))
		XCTAssertTrue(statistics.onlyFailuresRemain(remainingCount: 2))
		XCTAssertFalse(PhotoBackupStatistics(
			queuedCount: 0,
			preparedCount: 0,
			uploadedPhotoCount: 90,
			uploadedVideoCount: 0,
			failedCount: 0,
			uploadedBytes: 42
		).onlyFailuresRemain(remainingCount: 0))
	}

	func testDurableLedgerStateDeterminesCoverageWithoutReinterpretingPhotoKitTimestamps() {
		let records = [
			"backed-up": record(.uploaded, modificationTime: 2),
			"metadata-newer": record(.uploaded, modificationTime: 1),
			"prepared": record(.prepared, modificationTime: 2),
		]
		let coverage = PhotoBackupCoverage.calculate(
			assets: [
				asset("backed-up", mediaType: 1),
				asset("metadata-newer", mediaType: 1),
				asset("unknown", mediaType: 1),
				asset("prepared", mediaType: 2),
			],
			records: records,
			includePhotos: true,
			includeVideos: true
		)

		XCTAssertEqual(coverage.includedCount, 4)
		XCTAssertEqual(coverage.remainingCount, 2)
		XCTAssertEqual(coverage.failedCount, 0)
		XCTAssertEqual(coverage.backedUpPhotoCount, 2)
		XCTAssertEqual(coverage.backedUpVideoCount, 0)
		XCTAssertEqual(coverage.backedUpBytes, 20)
	}

	func testDisabledMediaDoesNotAffectRemainingButKeepsBackedUpResults() {
		let coverage = PhotoBackupCoverage.calculate(
			assets: [asset("photo", mediaType: 1), asset("video", mediaType: 2)],
			records: [
				"photo": record(.uploaded, modificationTime: 1, uploadedBytes: 10),
				"video": record(.uploaded, modificationTime: 1, uploadedBytes: 20),
			],
			includePhotos: true,
			includeVideos: false
		)

		XCTAssertEqual(coverage.includedCount, 1)
		XCTAssertEqual(coverage.remainingCount, 0)
		XCTAssertEqual(coverage.backedUpPhotoCount, 1)
		XCTAssertEqual(coverage.backedUpVideoCount, 1)
		XCTAssertEqual(coverage.backedUpBytes, 30)
	}

	func testCoverageSaturatesCorruptLegacyByteTotals() {
		let coverage = PhotoBackupCoverage.calculate(
			assets: [asset("one", mediaType: 1), asset("two", mediaType: 1)],
			records: [
				"one": record(.uploaded, modificationTime: 1, uploadedBytes: .max),
				"two": record(.uploaded, modificationTime: 1, uploadedBytes: .max),
			],
			includePhotos: true,
			includeVideos: true
		)

		XCTAssertEqual(coverage.backedUpBytes, .max)
	}

	private func asset(
		_ identifier: String,
		mediaType: Int64
	) -> PhotoBackupLibraryAsset {
		.init(
			localIdentifier: identifier,
			mediaType: mediaType
		)
	}

	private func record(
		_ state: PhotoBackupLedger.AssetState,
		modificationTime: TimeInterval,
		uploadedBytes: Int64 = 10
	) -> PhotoBackupLedger.AssetRecord {
		.init(
			state: state,
			modificationDate: Date(timeIntervalSince1970: modificationTime),
			uploadedBytes: uploadedBytes
		)
	}
}
