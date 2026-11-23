import XCTest
@testable import Umbrel
@testable import UmbrelKit

final class PhotoBackupFailuresTests: XCTestCase {
	func testOnlyAFailureBackupIncludesIsMarked() {
		XCTAssertEqual(photoBackupBadge(record: record(.uploaded), showsFailure: false), .backedUp)
		XCTAssertEqual(photoBackupBadge(record: record(.failed), showsFailure: true), .failed)
		// Its media type is turned off, so Profile doesn't count it either
		XCTAssertNil(photoBackupBadge(record: record(.failed), showsFailure: false))
		XCTAssertNil(photoBackupBadge(record: record(.pending), showsFailure: true))
		XCTAssertNil(photoBackupBadge(record: nil, showsFailure: true))
	}

	// The row's count, the page's total and its sections come from this one grouping
	func testTheListHoldsEachFailedItemTheLibraryShowsOnceUnderItsReason() {
		let failed = [
			asset("a", .general), asset("b", .nothingToUpload), asset("c", .unreadable), asset("d", .general),
			asset("gone", .general),
		]
		// Deleted since it failed, so the Library doesn't show it. The ledger hears on a later pass.
		let shown = ["a": 1, "b": 2, "c": 3, "d": 4, "other": 5]

		let groups = PhotoBackupFailureList.grouped(failed, shown: shown)

		XCTAssertEqual(groups, [.unreadable: [3], .general: [1, 4], .nothingToUpload: [2]])
		XCTAssertEqual(groups.values.reduce(0) { $0 + $1.count }, 4)
		// A reason nothing failed for has no section
		XCTAssertEqual(PhotoBackupFailureList.grouped([asset("a", .general)], shown: shown), [.general: [1]])
		// Without access to all photos the Library shows nothing, and nothing is listed
		XCTAssertEqual(PhotoBackupFailureList.grouped(failed, shown: [String: Int]()), [:])
	}

	func testLeadClaimsOnlyWhatTheBackupStatusSupports() {
		let lead = PhotoBackupFailuresPage.lead
		let everything = PhotoBackupMedia(photos: true, videos: true)
		XCTAssertEqual(
			lead(4, .upToDateExceptFailures, everything),
			"These 4 items aren\u{2019}t backed up yet. Everything else from this iPhone is backed up."
		)
		XCTAssertEqual(
			lead(1, .upToDateExceptFailures, everything),
			"This item isn\u{2019}t backed up yet. Everything else from this iPhone is backed up."
		)
		XCTAssertEqual(lead(4, .backingUp(9), everything), "These 4 items aren\u{2019}t backed up yet.")
		XCTAssertEqual(lead(0, .upToDate, everything), "Everything from this iPhone is backed up.")
		// After Try Again the items are queued, not backed up
		XCTAssertEqual(lead(0, .backingUp(4), everything), MainModel.PhotoBackupStatus.backingUp(4).text)
	}

	// Videos that backup leaves out aren't backed up, whatever the status
	func testLeadDoesNotClaimEverythingWhileAMediaTypeIsOff() {
		let lead = PhotoBackupFailuresPage.lead
		for media in [PhotoBackupMedia(photos: true, videos: false), PhotoBackupMedia(photos: false, videos: true)] {
			XCTAssertEqual(lead(4, .upToDateExceptFailures, media), "These 4 items aren\u{2019}t backed up yet.")
			XCTAssertEqual(lead(0, .upToDate, media), MainModel.PhotoBackupStatus.upToDate.text)
		}
	}

	func testNotesSpeakOfOneItemOrSeveral() {
		XCTAssertEqual(
			PhotoBackupFailureReason.unreadable.note(count: 1, retriesByItself: true),
			"Often an iCloud original that hasn\u{2019}t downloaded. Umbrel tries this again by itself."
		)
		XCTAssertEqual(
			PhotoBackupFailureReason.unreadable.note(count: 2, retriesByItself: true),
			"Often an iCloud original that hasn\u{2019}t downloaded. Umbrel tries these again by itself."
		)
		XCTAssertEqual(
			PhotoBackupFailureReason.general.note(count: 1, retriesByItself: true),
			"Something went wrong sending this to your Umbrel. Umbrel tries this again by itself."
		)
		XCTAssertEqual(
			PhotoBackupFailureReason.general.note(count: 2, retriesByItself: true),
			"Something went wrong sending these to your Umbrel. Umbrel tries these again by itself."
		)
		XCTAssertEqual(
			PhotoBackupFailureReason.general.note(count: 1, retriesByItself: false),
			"Something went wrong sending this to your Umbrel."
		)
		XCTAssertEqual(
			PhotoBackupFailureReason.nothingToUpload.note(count: 1, retriesByItself: true),
			"iOS has no file for this item that Umbrel can upload. Nothing you need to do."
		)
		XCTAssertEqual(
			PhotoBackupFailureReason.nothingToUpload.note(count: 2, retriesByItself: true),
			"iOS has no file for these items that Umbrel can upload. Nothing you need to do."
		)
	}

	// Automatic retries stop while backup is paused or stopped
	func testNoRetryIsPromisedWhenNoneWillHappen() {
		for reason in PhotoBackupFailureReason.allCases {
			for count in [1, 3] {
				XCTAssertFalse(reason.note(count: count, retriesByItself: false).contains("by itself"), "\(reason)")
				XCTAssertEqual(
					reason.note(count: count, retriesByItself: true).contains("by itself"),
					reason.offersRetry,
					"\(reason)"
				)
			}
			XCTAssertFalse(reason.detail(retriesByItself: false).contains("by itself"), "\(reason)")
			XCTAssertEqual(reason.detail(retriesByItself: true).contains("by itself"), reason.offersRetry, "\(reason)")
		}
	}

	private func record(_ state: PhotoBackupLedger.AssetState) -> PhotoBackupLedger.AssetRecord {
		.init(
			state: state,
			modificationDate: .distantPast,
			uploadedBytes: 0,
			failureReason: state == .failed ? .general : nil
		)
	}

	private func asset(_ identifier: String, _ reason: PhotoBackupFailureReason) -> PhotoBackupLedger.FailedAsset {
		.init(localIdentifier: identifier, reason: reason)
	}
}
