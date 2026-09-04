import XCTest
@testable import Umbrel

final class AppTilePresentationTests: XCTestCase {
	func testAvailableAndStoppedStatesMatchUmbrelOSPresentation() {
		let available = AppTilePresentation(state: "ready")
		XCTAssertFalse(available.dimsIcon)
		XCTAssertNil(available.symbolName)
		XCTAssertEqual(available.label(default: "Files"), "Files")

		let stopped = AppTilePresentation(state: "stopped")
		XCTAssertTrue(stopped.dimsIcon)
		XCTAssertEqual(stopped.symbolName, "pause.circle")
		XCTAssertEqual(stopped.label(default: "Files"), "Files")
		XCTAssertEqual(stopped.accessibilityValue, "Stopped")
	}

	func testUnknownAndFutureStatesUseUnavailablePresentation() {
		for state in ["unknown", "future-state", nil] {
			let presentation = AppTilePresentation(state: state)
			XCTAssertTrue(presentation.dimsIcon)
			XCTAssertEqual(presentation.symbolName, "exclamationmark.triangle")
			XCTAssertEqual(presentation.label(default: "Files"), "Offline")
			XCTAssertEqual(presentation.accessibilityValue, "Offline")
		}
	}

	func testLifecycleActivitiesUseUmbrelOSLabels() {
		let expected = [
			"installing": "Files",
			"starting": "Starting\u{2026}",
			"running": "Files",
			"stopping": "Stopping\u{2026}",
			"restarting": "Restarting\u{2026}",
			"uninstalling": "Uninstalling\u{2026}",
			"updating": "Updating\u{2026}",
		]

		for (state, label) in expected {
			let presentation = AppTilePresentation(state: state)
			XCTAssertTrue(presentation.dimsIcon)
			XCTAssertNil(presentation.symbolName)
			XCTAssertEqual(presentation.label(default: "Files"), label)
		}
	}

	func testOnlyInstallingAndUpdatingUseClampedReportedProgress() {
		XCTAssertEqual(AppTilePresentation(state: "installing").reportedProgress(-1), 0)
		XCTAssertEqual(AppTilePresentation(state: "updating").reportedProgress(42.5), 42.5)
		XCTAssertEqual(AppTilePresentation(state: "updating").reportedProgress(101), 100)
		XCTAssertNil(AppTilePresentation(state: "starting").reportedProgress(50))
		XCTAssertNil(AppTilePresentation(state: "ready").reportedProgress(50))
	}
}
