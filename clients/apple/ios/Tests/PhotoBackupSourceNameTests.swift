import XCTest
@testable import Umbrel

final class PhotoBackupSourceNameTests: XCTestCase {
	func testKeepsNamesWithJoinedEmoji() {
		let flag = "Nate\u{2019}s iPhone \u{1F3F3}\u{FE0F}\u{200D}\u{1F308}"
		XCTAssertEqual(PhotoBackupSourceName.suggested(from: flag), flag)
		let developer = "\u{1F9D1}\u{200D}\u{1F4BB} Dev phone"
		XCTAssertEqual(PhotoBackupSourceName.suggested(from: developer), developer)
	}

	func testRejectsWhatUmbrelOSRejects() {
		XCTAssertNil(PhotoBackupSourceName.suggested(from: "Nate\u{0007}s iPhone"))
		XCTAssertNil(PhotoBackupSourceName.suggested(from: "Nate\u{007F}s iPhone"))
		XCTAssertNil(PhotoBackupSourceName.suggested(from: "  \n"))
	}

	func testTrims() {
		XCTAssertEqual(PhotoBackupSourceName.suggested(from: "  Nate\u{2019}s iPhone \n"), "Nate\u{2019}s iPhone")
	}

	// umbrelOS counts UTF-16 code units, so 60 emoji (120 units) must be cut to 50
	func testFitsUmbrelOSLengthLimit() {
		let emoji = String(repeating: "\u{1F600}", count: 60)
		let suggested = PhotoBackupSourceName.suggested(from: emoji)
		XCTAssertEqual(suggested, String(repeating: "\u{1F600}", count: 50))
		XCTAssertEqual(suggested?.utf16.count, 100)

		let ascii = String(repeating: "a", count: 150)
		XCTAssertEqual(PhotoBackupSourceName.suggested(from: ascii)?.utf16.count, 100)
	}

	func testNewSourceTakesTheNextFreeName() {
		let name = "Nate\u{2019}s iPhone"
		XCTAssertEqual(PhotoBackupSourceName.unique(name, among: ["iPhone"]), name)
		XCTAssertEqual(PhotoBackupSourceName.unique(name, among: [name]), "\(name) (2)")
		XCTAssertEqual(PhotoBackupSourceName.unique(name, among: [name, "\(name) (2)"]), "\(name) (3)")
		// Still within umbrelOS's limit once the number is added
		let long = String(repeating: "a", count: 100)
		let unique = PhotoBackupSourceName.unique(long, among: [long])
		XCTAssertTrue(unique.hasSuffix(" (2)"))
		XCTAssertEqual(unique.utf16.count, 100)
	}
}
