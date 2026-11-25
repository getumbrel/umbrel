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

	func testBonjourCandidateAcceptsOnlyLocalHosts() throws {
		let rejected = [
			"umbrel.example.com",
			"attacker.example.com/trpc?x=",
			"user@umbrel.local",
			"umbrel.local:8080",
			"192.168.1.20:8080",
			"192.168.1.20:8080?x=.local",
			"umbrel",
			// Literal addresses outside the ranges a local network uses
			"203.0.113.7",
			"127.0.0.1",
		]
		for host in rejected {
			XCTAssertNil(Umbreld.localDiscoveryCandidate(Candidate(host: host, name: "Umbrel")), host)
			let filtered = try XCTUnwrap(Umbreld.localDiscoveryCandidate(
				Candidate(host: "umbrel.local", addresses: [host, "192.168.1.20"], name: "Umbrel")
			))
			XCTAssertEqual(filtered.addresses, ["192.168.1.20"], host)
		}

		let local = Candidate(
			host: "192.168.1.20",
			addresses: ["10.0.0.5", "172.16.4.2", "169.254.7.9"],
			name: "Umbrel"
		)
		XCTAssertEqual(Umbreld.localDiscoveryCandidate(local), local)
	}

	func testAdvertisedAddressOutsideTheLocalNetworkNeverReachesASavedDevice() async throws {
		var saved = SavedDevice(id: "device", name: "Umbrel", host: "umbrel.local", addresses: [])
		let candidate = Candidate(
			host: "umbrel.local",
			addresses: ["192.168.1.20", "203.0.113.7"],
			name: "Umbrel",
			id: "device"
		)

		// Only the name is asked, and it proves the saved identity
		let discovered = await Umbreld.identifyCandidate(
			candidate,
			knownDeviceIds: ["device"],
			probe: { host, _ in
				host == "umbrel.local"
					? Umbreld.IdentityProbeResult(
						discoveryInfo: .init(id: "device", device: "Umbrel Home", onboarded: true),
						candidateCertificate: nil
					)
					: nil
			}
		)
		saved.mergeVerifiedDiscovery(try XCTUnwrap(discovered))

		XCTAssertEqual(saved.connectionHosts, ["umbrel.local", "192.168.1.20"])
	}

	func testStoredRoutesKeepOnlyLocalHosts() {
		let reported = [
			"192.168.1.5", "fe80::1", "umbrel.example.com", "100.64.0.1", "umbrel.local",
			"user@host.local", "192.168.1.5:8080", "",
		]
		var refreshed = SavedDevice(id: "device", name: "Umbrel", host: "umbrel.local", addresses: [])
		refreshed.replaceAvailableAddresses(reported)
		XCTAssertEqual(refreshed.addresses, ["192.168.1.5", "100.64.0.1", "umbrel.local"])
		var remembered = SavedDevice(id: "device", name: "Umbrel", host: "umbrel.local", addresses: [])
		remembered.rememberConnectionCandidates(reported)
		XCTAssertEqual(remembered.addresses, ["192.168.1.5", "100.64.0.1", "umbrel.local"])

		// A route that isn't a local host is skipped even if an earlier build saved it
		let stored = SavedDevice(
			id: "device",
			name: "Umbrel",
			host: "127.0.0.1:8080/path?x=",
			addresses: ["192.168.1.5", "umbrel.example.com"]
		)
		XCTAssertEqual(stored.connectionHosts, ["192.168.1.5"])

		// Discovery that answered anywhere else changes nothing
		var saved = SavedDevice(id: "device", name: "Umbrel", host: "umbrel.local", addresses: [])
		let original = saved
		saved.mergeVerifiedDiscovery(IdentifiedDevice(
			host: "umbrel.example.com",
			discoveryHost: "umbrel.local",
			addresses: ["192.168.1.9"],
			name: "Other",
			id: "device",
			model: "Umbrel Home",
			onboarded: true
		))
		XCTAssertEqual(saved, original)
		saved.mergeVerifiedDiscovery(IdentifiedDevice(
			host: "192.168.1.9",
			discoveryHost: "umbrel.local",
			addresses: ["192.168.1.9", "evil.example.com"],
			name: "Umbrel",
			id: "device",
			model: "Umbrel Home",
			onboarded: true
		))
		XCTAssertEqual(saved.host, "192.168.1.9")
		XCTAssertEqual(saved.addresses, ["192.168.1.9"])
	}

	func testManualDiscoveryAddressAcceptsDirectIPsAndLocalHostnames() {
		XCTAssertEqual(Umbreld.manualDiscoveryHost(from: "10.0.0.1"), "10.0.0.1")
		XCTAssertEqual(Umbreld.manualDiscoveryHost(from: "172.16.0.1"), "172.16.0.1")
		XCTAssertEqual(Umbreld.manualDiscoveryHost(from: " 192.168.1.20\n"), "192.168.1.20")
		XCTAssertEqual(Umbreld.manualDiscoveryHost(from: "169.254.1.1"), "169.254.1.1")
		XCTAssertEqual(Umbreld.manualDiscoveryHost(from: "100.90.0.1"), "100.90.0.1")
		XCTAssertEqual(Umbreld.manualDiscoveryHost(from: " Umbrel-4.LOCAL. "), "umbrel-4.local")
	}

	func testManualDiscoveryUsesAddressAsSavedNameFallback() throws {
		let candidate = try XCTUnwrap(Umbreld.manualDiscoveryCandidate(from: "100.90.0.1"))

		XCTAssertEqual(candidate.name, "100.90.0.1")
	}

	func testManualDiscoveryUsesLocalHostnameDirectly() throws {
		let candidate = try XCTUnwrap(Umbreld.manualDiscoveryCandidate(from: "umbrel.local"))

		XCTAssertEqual(candidate.host, "umbrel.local")
		XCTAssertEqual(candidate.name, "umbrel.local")
		XCTAssertTrue(candidate.addresses.isEmpty)
	}

	func testManualDiscoveryAcceptsMagicDNSNamesForResolution() {
		XCTAssertEqual(Umbreld.manualDiscoveryHost(from: "umbrel"), "umbrel")
		XCTAssertEqual(
			Umbreld.manualDiscoveryHost(from: " Umbrel.My-Tailnet.ts.net. "),
			"umbrel.my-tailnet.ts.net"
		)
	}

	func testManualDiscoveryAcceptsPlainHTTPAndHTTPSURLs() {
		XCTAssertEqual(Umbreld.manualDiscoveryHost(from: "http://umbrel.local/"), "umbrel.local")
		XCTAssertEqual(Umbreld.manualDiscoveryHost(from: "HTTPS://Umbrel/"), "umbrel")
		XCTAssertEqual(Umbreld.manualDiscoveryHost(from: "http://192.168.1.20/"), "192.168.1.20")
		XCTAssertEqual(Umbreld.manualDiscoveryHost(from: "https://100.90.0.1"), "100.90.0.1")
		XCTAssertEqual(
			Umbreld.manualDiscoveryHost(from: "https://umbrel.my-tailnet.ts.net/"),
			"umbrel.my-tailnet.ts.net"
		)
	}

	func testManualDiscoveryUsesOnlyResolvedTailscaleAddressesForMagicDNS() throws {
		let candidate = try XCTUnwrap(Umbreld.manualDiscoveryCandidate(
			from: "umbrel.my-tailnet.ts.net",
			resolvedIPv4Addresses: ["192.168.1.20", "100.90.0.1", "203.0.113.2", "100.90.0.2", "100.90.0.1"]
		))

		XCTAssertEqual(candidate.host, "100.90.0.1")
		XCTAssertEqual(candidate.addresses, ["100.90.0.2"])
		XCTAssertEqual(candidate.name, "umbrel.my-tailnet.ts.net")
	}

	func testManualDiscoveryAllowsSafeLocalAndTailscaleResultsForShortHostnames() throws {
		let candidate = try XCTUnwrap(Umbreld.manualDiscoveryCandidate(
			from: "umbrel",
			resolvedIPv4Addresses: ["203.0.113.2", "192.168.1.20", "100.90.0.1", "192.168.1.20"]
		))

		XCTAssertEqual(candidate.host, "192.168.1.20")
		XCTAssertEqual(candidate.addresses, ["100.90.0.1"])
		XCTAssertEqual(candidate.name, "umbrel")
	}

	func testManualDiscoveryRejectsNonTailscaleDNSResults() {
		XCTAssertNil(Umbreld.manualDiscoveryCandidate(
			from: "umbrel.my-tailnet.ts.net",
			resolvedIPv4Addresses: ["192.168.1.20", "203.0.113.2"]
		))
	}

	func testManualDiscoveryAddressRejectsPublicHostnamesAndURLSyntax() {
		XCTAssertNil(Umbreld.manualDiscoveryHost(from: "example.com"))
		XCTAssertNil(Umbreld.manualDiscoveryHost(from: "https://example.com"))
		XCTAssertNil(Umbreld.manualDiscoveryHost(from: "ftp://umbrel.local"))
		XCTAssertNil(Umbreld.manualDiscoveryHost(from: "https://user@umbrel.local"))
		XCTAssertNil(Umbreld.manualDiscoveryHost(from: "https://umbrel.local:443"))
		XCTAssertNil(Umbreld.manualDiscoveryHost(from: "https://umbrel.local/settings"))
		XCTAssertNil(Umbreld.manualDiscoveryHost(from: "https://umbrel.local?tab=apps"))
		XCTAssertNil(Umbreld.manualDiscoveryHost(from: "https://umbrel.local#apps"))
		XCTAssertNil(Umbreld.manualDiscoveryHost(from: "192.168.1.20:443"))
		XCTAssertNil(Umbreld.manualDiscoveryHost(from: "192.168.1.999"))
		XCTAssertNil(Umbreld.manualDiscoveryHost(from: "bad_name.ts.net"))
		XCTAssertNil(Umbreld.manualDiscoveryHost(from: "0.0.0.0"))
		XCTAssertNil(Umbreld.manualDiscoveryHost(from: "127.0.0.1"))
		XCTAssertNil(Umbreld.manualDiscoveryHost(from: "172.15.255.255"))
		XCTAssertNil(Umbreld.manualDiscoveryHost(from: "172.32.0.0"))
		XCTAssertNil(Umbreld.manualDiscoveryHost(from: "203.0.113.2"))
		XCTAssertNil(Umbreld.manualDiscoveryHost(from: "224.0.0.1"))
	}

	func testManualDiscoveryReportsUnsupportedLiteralAsInvalid() async {
		do {
			_ = try await Umbreld.discoverManually(at: "127.0.0.1")
			XCTFail("Expected an invalid-address error")
		} catch {
			XCTAssertEqual(error as? Umbreld.ManualDiscoveryError, .invalidAddress)
		}
	}

	func testManualDiscoveryReportsUnsupportedResolvedAddressAsNotFound() async {
		do {
			_ = try await Umbreld.discoverManually(at: "localhost")
			XCTFail("Expected a no-device-found error")
		} catch {
			XCTAssertEqual(error as? Umbreld.ManualDiscoveryError, .noDeviceFound)
		}
	}

	func testSystemIPv4ResolverUsesLocalDNSConfiguration() async throws {
		let addresses = try await IPv4HostResolver.resolve("localhost")

		XCTAssertTrue(addresses.contains("127.0.0.1"))
	}

	func testLiveManualAddressDiscovery() async throws {
		guard let host = ProcessInfo.processInfo.environment["UMBRELKIT_MANUAL_DISCOVERY_TEST_HOST"] else {
			throw XCTSkip("Set UMBRELKIT_MANUAL_DISCOVERY_TEST_HOST to an Umbrel IP or hostname")
		}

		guard case .device = try await Umbreld.discoverManually(at: host) else {
			return XCTFail("Expected a current Umbrel at \(host)")
		}
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
