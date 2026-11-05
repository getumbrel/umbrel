import XCTest
@testable import Umbrel

final class PhotoLibraryGridTests: XCTestCase {
	private typealias Change = PhotoLibraryModel.Assets.Change

	// Revision 2 had 9 items; revision 3 deletes the last four.
	private let deletesLastFour = Change(
		previousRevision: 2,
		hasIncrementalChanges: true,
		removedIndexes: IndexSet(5...8),
		insertedIndexes: [],
		changedIndexes: [],
		moves: []
	)

	func testAppliesFromThePreviousRevision() {
		XCTAssertTrue(deletesLastFour.applies(from: (revision: 2, count: 9), to: 5))
	}

	// reloadData leaves the count unread until the next layout. UIKit would then
	// read the new count (5) as the state before the update and abort on item 8.
	func testDoesNotApplyBeforeUIKitReadsTheReload() {
		XCTAssertFalse(deletesLastFour.applies(from: nil, to: 5))
	}

	func testDoesNotApplyFromAnOlderRevision() {
		XCTAssertFalse(deletesLastFour.applies(from: (revision: 1, count: 10), to: 5))
	}

	func testDoesNotApplyWhenCountsDisagree() {
		XCTAssertFalse(deletesLastFour.applies(from: (revision: 2, count: 10), to: 5))
	}

	func testDoesNotApplyOutOfRangeIndexes() {
		let insertsPastTheEnd = Change(
			previousRevision: 2,
			hasIncrementalChanges: true,
			removedIndexes: [],
			insertedIndexes: [9],
			changedIndexes: [],
			moves: []
		)
		XCTAssertFalse(insertsPastTheEnd.applies(from: (revision: 2, count: 8), to: 9))
	}

	// A photo whose date changed while another left the library: PhotoKit reports the
	// move from index 1 after removing index 0, which UIKit rejects as a delete and a
	// move from the same index path.
	func testDoesNotApplyMoves() {
		let removesAndMoves = Change(
			previousRevision: 2,
			hasIncrementalChanges: true,
			removedIndexes: [0],
			insertedIndexes: [],
			changedIndexes: [],
			moves: [.init(from: 1, to: 0)]
		)
		XCTAssertFalse(removesAndMoves.applies(from: (revision: 2, count: 7), to: 6))

		let onlyMoves = Change(
			previousRevision: 2,
			hasIncrementalChanges: true,
			removedIndexes: [],
			insertedIndexes: [],
			changedIndexes: [],
			moves: [.init(from: 3, to: 0)]
		)
		XCTAssertFalse(onlyMoves.applies(from: (revision: 2, count: 7), to: 7))
	}
}
