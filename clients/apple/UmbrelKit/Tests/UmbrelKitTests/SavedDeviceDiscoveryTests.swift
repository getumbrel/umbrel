@testable import UmbrelKit
import XCTest

final class SavedDeviceDiscoveryTests: XCTestCase {
	func testBonjourCandidateCannotIntroduceTailscaleAddress() throws {
		let candidate = Candidate(
			host: "umbrel.local",
			addresses: ["192.168.1.20", "100.90.0.1"],
			name: "Umbrel"
		)

		let filtered = try XCTUnwrap(Umbreld.localDiscoveryCandidate(candidate))

		XCTAssertEqual(filtered.host, "umbrel.local")
		XCTAssertEqual(filtered.addresses, ["192.168.1.20"])
	}

	func testBonjourCandidateRejectsLiteralTailscaleHost() {
		let candidate = Candidate(host: "100.90.0.1", name: "Umbrel")

		XCTAssertNil(Umbreld.localDiscoveryCandidate(candidate))
	}

	func testManualDiscoveryAddressAcceptsLANAndTailscaleIPv4() {
		XCTAssertEqual(Umbreld.manualDiscoveryHost(from: " 192.168.1.20\n"), "192.168.1.20")
		XCTAssertEqual(Umbreld.manualDiscoveryHost(from: "100.90.0.1"), "100.90.0.1")
	}

	func testManualDiscoveryUsesAddressAsSavedNameFallback() throws {
		let candidate = try XCTUnwrap(Umbreld.manualDiscoveryCandidate(from: "100.90.0.1"))

		XCTAssertEqual(candidate.name, "100.90.0.1")
	}

	func testManualDiscoveryAddressRejectsHostnamesAndURLSyntax() {
		XCTAssertNil(Umbreld.manualDiscoveryHost(from: "umbrel.local"))
		XCTAssertNil(Umbreld.manualDiscoveryHost(from: "http://192.168.1.20"))
		XCTAssertNil(Umbreld.manualDiscoveryHost(from: "192.168.1.20:443"))
	}

	func testVerifiedBonjourRenameReplacesStaleHostname() {
		var saved = SavedDevice(
			id: "device",
			name: "Umbrel",
			host: "umbrel.local",
			addresses: ["umbrel.local", "192.168.1.10", "100.90.0.1"]
		)
		let discovered = IdentifiedDevice(
			host: "umbrel-2.local",
			discoveryHost: "umbrel-2.local",
			addresses: ["192.168.1.20"],
			name: "Umbrel 2",
			id: "device",
			model: "Umbrel Home",
			onboarded: true
		)

		saved.mergeVerifiedDiscovery(discovered)

		XCTAssertEqual(saved.host, "umbrel-2.local")
		XCTAssertFalse(saved.addresses.contains("umbrel.local"))
		XCTAssertTrue(saved.addresses.contains("192.168.1.10"))
		XCTAssertTrue(saved.addresses.contains("192.168.1.20"))
		XCTAssertTrue(saved.addresses.contains("100.90.0.1"))
		XCTAssertEqual(saved.photoBackupHost, "100.90.0.1")
	}

	func testDiscoveryForAnotherDeviceCannotChangeSavedDevice() {
		var saved = SavedDevice(id: "device", name: "Umbrel", host: "umbrel.local", addresses: [])
		let original = saved
		let discovered = IdentifiedDevice(
			host: "umbrel-2.local",
			discoveryHost: "umbrel-2.local",
			addresses: ["192.168.1.20"],
			name: "Other Umbrel",
			id: "other",
			model: "Umbrel Home",
			onboarded: true
		)

		saved.mergeVerifiedDiscovery(discovered)

		XCTAssertEqual(saved, original)
	}

	func testPhotoBackupHostUsesTailscaleAddress() {
		let saved = SavedDevice(
			id: "device",
			name: "Umbrel",
			host: "100.90.0.1",
			addresses: ["192.168.1.20"]
		)

		XCTAssertEqual(saved.photoBackupHost, "100.90.0.1")
	}

	func testPhotoBackupHostFindsTailscaleAddressAmongCandidates() {
		let saved = SavedDevice(
			id: "device",
			name: "Umbrel",
			host: "umbrel.local",
			addresses: ["192.168.1.20", "100.90.0.1"]
		)

		XCTAssertEqual(saved.photoBackupHost, "100.90.0.1")
	}

	func testReportedTailscaleAddressReplacesCanonicalPairingAddressForNewBackups() {
		let saved = SavedDevice(
			id: "device",
			name: "Umbrel",
			host: "100.90.0.1",
			addresses: ["192.168.1.20", "100.90.0.2"]
		)

		XCTAssertEqual(saved.photoBackupHost, "100.90.0.2")
	}

	func testVerifiedIPAddressReplacesAnUnreachableBonjourHostname() {
		var saved = SavedDevice(
			id: "device",
			name: "Umbrel",
			host: "umbrel.local",
			addresses: ["umbrel.local", "192.168.1.10"]
		)
		let discovered = IdentifiedDevice(
			host: "192.168.1.20",
			discoveryHost: "umbrel-2.local",
			addresses: ["192.168.1.20"],
			name: "Umbrel",
			id: "device",
			model: "Umbrel Home",
			onboarded: true
		)

		saved.mergeVerifiedDiscovery(discovered)

		XCTAssertEqual(saved.host, "192.168.1.20")
		XCTAssertFalse(saved.addresses.contains("umbrel.local"))
		XCTAssertNil(saved.photoBackupHost)
	}
}
