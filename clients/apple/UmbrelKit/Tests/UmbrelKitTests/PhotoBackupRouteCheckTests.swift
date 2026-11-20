import XCTest
@testable import UmbrelKit

final class PhotoBackupRouteCheckTests: XCTestCase {
	private let sent = ["a", "b"].map {
		Umbreld.PhotoBackupResourceClaim(resourceKey: String(repeating: $0, count: 64), fileExtension: "heic", identity: nil)
	}

	func testNothingIsAskedWithoutTheUmbrel() async {
		var claims = 0
		let proof = await Umbreld.photoBackupRouteCheck(
			sent: sent,
			answers: { false },
			claim: { _ in claims += 1; return .receipts([]) }
		)
		XCTAssertEqual(proof, .unproven)
		XCTAssertEqual(claims, 0)
	}

	func testNothingSentNeedsNoClaim() async {
		var claims = 0
		let proof = await Umbreld.photoBackupRouteCheck(
			sent: [],
			answers: { true },
			claim: { _ in claims += 1; return .unanswered }
		)
		XCTAssertEqual(proof, .proven(receipts: [], missing: []))
		XCTAssertEqual(claims, 0)
	}

	func testUploadsTheUmbrelDoesntHaveAreMissing() async {
		let receipt = Umbreld.PhotoBackupResourceReceipt(resourceKey: String(repeating: "a", count: 64), bytes: 5)
		let proof = await Umbreld.photoBackupRouteCheck(
			sent: sent,
			answers: { true },
			claim: { _ in .receipts([receipt]) }
		)
		XCTAssertEqual(proof, .proven(receipts: [receipt], missing: [String(repeating: "b", count: 64)]))
	}

	func testAnUmbrelWithoutClaimsKeepsPhotoKitsWord() async {
		let proof = await Umbreld.photoBackupRouteCheck(sent: sent, answers: { true }, claim: { _ in .declined })
		XCTAssertEqual(proof, .proven(receipts: [], missing: []))
	}

	func testAnUnansweredClaimConfirmsNothing() async {
		let proof = await Umbreld.photoBackupRouteCheck(sent: sent, answers: { true }, claim: { _ in .unanswered })
		XCTAssertEqual(proof, .unconfirmed)
	}
}
