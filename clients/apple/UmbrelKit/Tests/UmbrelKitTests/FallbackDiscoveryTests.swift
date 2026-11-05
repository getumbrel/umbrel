import XCTest

@testable import UmbrelKit

final class FallbackDiscoveryTests: XCTestCase {
	func testFallbackHostsStaySmallAndPredictable() {
		XCTAssertEqual(
			Umbreld.fallbackDiscoveryHosts,
			[
				"umbrel.local",
				"umbrel-2.local",
				"umbrel-3.local",
				"umbrel-4.local",
				"umbrel-5.local",
				"umbrel-home.local",
				"umbrel-pro.local",
			]
		)
	}

	func testFallbackResponseRequiresTheUmbrelOSVersionContract() throws {
		let valid = Data(#"{"result":{"data":{"version":"1.7.4","name":"umbrelOS 1.7.4"}}}"#.utf8)
		XCTAssertNoThrow(try Umbreld.validateFallbackSystemVersion(data: valid, status: 200))

		let unrelated = Data(#"{"result":{"data":{"version":"1.7.4","name":"Another service"}}}"#.utf8)
		XCTAssertThrowsError(try Umbreld.validateFallbackSystemVersion(data: unrelated, status: 200))

		let incomplete = Data(#"{"result":{"data":{"version":"1.7.4"}}}"#.utf8)
		XCTAssertThrowsError(try Umbreld.validateFallbackSystemVersion(data: incomplete, status: 200))
	}

	func testFallbackResponseReportsItsVersion() throws {
		let current = Data(#"{"result":{"data":{"version":"2.0.0","name":"umbrelOS 2.0"}}}"#.utf8)
		XCTAssertEqual(try Umbreld.validateFallbackSystemVersion(data: current, status: 200), "2.0.0")
	}

	func testOnlyReleasesBeforeUmbrelOS2RequireAnUpdate() {
		for version in ["0.5.4", "1.0.0", "1.4.2", "1.7.4"] {
			XCTAssertTrue(Umbreld.requiresUpdate(version: version), version)
		}
		for version in ["2.0.0", "2.0.0-beta.1", "2.0.1", "2.1.0", "10.0.0"] {
			XCTAssertFalse(Umbreld.requiresUpdate(version: version), version)
		}
		// Never tell someone to update on a version that can't be read
		for version in ["", "beta", "v1.7.4"] {
			XCTAssertFalse(Umbreld.requiresUpdate(version: version), version)
		}
	}

	func testCurrentFallbackHostsAreIdentifiedAndOnlyOlderOnesNeedAnUpdate() async {
		let versions = [
			"umbrel.local": "2.0.0",
			"umbrel-2.local": "1.7.4",
			"umbrel-3.local": "2.0.0-beta.2",
			"umbrel-pro.local": "2.1.0",
		]
		let attempts = IdentificationAttempts()
		let result = await discover(versions: versions, knownDeviceIds: ["saved"]) { candidate, knownDeviceIds in
			await attempts.record(candidate.host, knownDeviceIds)
			// umbrel-pro.local answers its version but never proves its identity
			return candidate.host == "umbrel-pro.local"
				? .unverified(Umbreld.UnverifiedDevice(host: candidate.host, reason: .slow))
				: .device(device(host: candidate.host, id: "id-\(candidate.host)"))
		}

		XCTAssertEqual(result.devices.map(\.host), ["umbrel-3.local", "umbrel.local"])
		XCTAssertEqual(result.unverified, [Umbreld.UnverifiedDevice(host: "umbrel-pro.local", reason: .slow)])
		XCTAssertEqual(result.updateRequired, [Umbreld.UpdateRequiredDevice(host: "umbrel-2.local")])
		let identified = await attempts.all
		// A slow Umbrel isn't asked twice, and older Umbrels are never asked
		XCTAssertEqual(identified.map(\.host).sorted(), ["umbrel-3.local", "umbrel-pro.local", "umbrel.local"])
		XCTAssertTrue(identified.allSatisfy { $0.knownDeviceIds == ["saved"] })
	}

	func testUnexpectedFailureIsAskedOnceMore() async {
		let attempts = IdentificationAttempts()
		let result = await discover(versions: ["umbrel.local": "2.0.0"]) { candidate, knownDeviceIds in
			await attempts.record(candidate.host, knownDeviceIds)
			// Still starting the first time, ready the second
			return await attempts.all.count == 1
				? .unverified(Umbreld.UnverifiedDevice(host: candidate.host, reason: .unexpected))
				: .device(device(host: candidate.host, id: "home"))
		}

		XCTAssertEqual(result, Umbreld.FallbackDiscoveryResult(devices: [device(host: "umbrel.local", id: "home")]))
	}

	func testAHungIdentificationEndsAtTheDeadlineAsSlow() async {
		let attempts = IdentificationAttempts()
		let started = ContinuousClock.now
		let result = await discover(
			versions: ["umbrel.local": "2.0.0"],
			addresses: ["umbrel.local": ["192.168.1.10"]],
			attemptDeadline: .milliseconds(200)
		) { candidate, knownDeviceIds in
			await attempts.record(candidate.host, knownDeviceIds)
			try? await Task.sleep(for: .seconds(30))
			return .device(device(host: candidate.host, id: "home"))
		}

		XCTAssertLessThan(started.duration(to: .now), .seconds(2))
		XCTAssertEqual(
			result.unverified,
			[Umbreld.UnverifiedDevice(host: "umbrel.local", addresses: ["192.168.1.10"], reason: .slow)]
		)
		let identified = await attempts.all
		XCTAssertEqual(identified.count, 1)
	}

	func testTwoNamesForTheSameUmbrelShowOnce() async {
		let result = await discover(versions: ["umbrel.local": "2.0.0", "umbrel-home.local": "2.0.0"]) { candidate, _ in
			.device(device(host: candidate.host, id: "home", certificate: Data("home-ca".utf8)))
		}

		XCTAssertEqual(result.devices.map(\.host), ["umbrel-home.local"])
	}

	func testAClaimedIdUnderAnotherCADoesNotHideTheRealUmbrel() async {
		let result = await discover(versions: ["umbrel.local": "2.0.0", "umbrel-2.local": "2.0.0"]) { candidate, _ in
			let certificate = candidate.host == "umbrel.local" ? "home-ca" : "impostor-ca"
			return .device(device(host: candidate.host, id: "home", certificate: Data(certificate.utf8)))
		}

		XCTAssertEqual(result.devices.map(\.host), ["umbrel-2.local", "umbrel.local"])
	}

	func testAnotherNameForAVerifiedUmbrelIsNotAFailure() async {
		let result = await discover(
			versions: ["umbrel.local": "2.0.0", "umbrel-2.local": "2.0.0"],
			addresses: ["umbrel.local": ["192.168.1.10"], "umbrel-2.local": ["192.168.1.10"]]
		) { candidate, _ in
			candidate.host == "umbrel.local"
				? .device(device(host: candidate.host, addresses: candidate.addresses, id: "home"))
				: .unverified(Umbreld.UnverifiedDevice(
					host: candidate.host,
					addresses: candidate.addresses,
					reason: .slow))
		}

		XCTAssertEqual(result.devices.map(\.host), ["umbrel.local"])
		XCTAssertEqual(result.unverified, [])
	}

	func testASavedUmbrelWithAChangedCertificateIsLeftToItsOwnHandling() async {
		let result = await discover(versions: ["umbrel.local": "2.0.0"]) { _, _ in .savedIdentityChanged }

		XCTAssertEqual(result, Umbreld.FallbackDiscoveryResult())
	}

	func testUpdateHintsArriveBeforeIdentificationFinishes() async {
		let events = IdentificationAttempts()
		let result = await discover(
			versions: ["umbrel.local": "2.0.0", "umbrel-2.local": "1.7.4"],
			onUpdateRequired: { devices in
				await events.record("update hints: \(devices.map(\.host))", [])
			}
		) { candidate, knownDeviceIds in
			try? await Task.sleep(for: .milliseconds(100))
			await events.record("identified \(candidate.host)", knownDeviceIds)
			return .device(device(host: candidate.host, id: "home"))
		}

		let order = await events.all.map(\.host)
		XCTAssertEqual(order, ["update hints: [\"umbrel-2.local\"]", "identified umbrel.local"])
		XCTAssertEqual(result.updateRequired, [Umbreld.UpdateRequiredDevice(host: "umbrel-2.local")])
	}

	func testDeadlineReturnsAFastResultAndCutsOffASlowOne() async {
		let fast = await Umbreld.withDeadline(.seconds(5)) { "done" }
		XCTAssertEqual(fast, "done")

		let started = ContinuousClock.now
		let slow = await Umbreld.withDeadline(.milliseconds(100)) { () async -> String in
			try? await Task.sleep(for: .seconds(30))
			return "too late"
		}
		XCTAssertNil(slow)
		XCTAssertLessThan(started.duration(to: .now), .seconds(2))
	}

	func testTheFallbackTimeLimitFitsTheFindingScreen() {
		// iOS keeps searching at most this long while verification runs
		XCTAssertLessThanOrEqual(Umbreld.fallbackDiscoveryTimeLimit, .seconds(30))
	}

	func testFallbackDevicesAreNamedLikeBonjourNamesThem() {
		XCTAssertEqual(Umbreld.fallbackDeviceName(host: "umbrel.local"), "umbrel")
		XCTAssertEqual(Umbreld.fallbackDeviceName(host: "umbrel-home.local"), "umbrel-home")
	}

	func testFallbackWithOnlyOlderUmbrelsSkipsIdentification() async {
		let attempts = IdentificationAttempts()
		let result = await discover(versions: ["umbrel.local": "1.7.4"]) { candidate, knownDeviceIds in
			await attempts.record(candidate.host, knownDeviceIds)
			return .unverified(Umbreld.UnverifiedDevice(host: candidate.host, reason: .unexpected))
		}

		XCTAssertEqual(result, Umbreld.FallbackDiscoveryResult(
			updateRequired: [Umbreld.UpdateRequiredDevice(host: "umbrel.local")]
		))
		let identified = await attempts.all
		XCTAssertTrue(identified.isEmpty)
	}

	private func discover(
		versions: [String: String],
		addresses: [String: [String]] = [:],
		knownDeviceIds: Set<String> = [],
		attemptDeadline: Duration = .seconds(5),
		onUpdateRequired: @escaping @Sendable ([Umbreld.UpdateRequiredDevice]) async -> Void = { _ in },
		identify: @escaping Umbreld.CandidateIdentifier
	) async -> Umbreld.FallbackDiscoveryResult {
		await Umbreld.discoverFallbackHosts(
			knownDeviceIds: knownDeviceIds,
			version: { versions[$0] },
			candidate: { host in
				Candidate(
					host: host,
					addresses: addresses[host] ?? [],
					name: Umbreld.fallbackDeviceName(host: host))
			},
			identify: identify,
			retryDelay: .zero,
			attemptDeadline: attemptDeadline,
			onUpdateRequired: onUpdateRequired
		)
	}

	func testLiveFallbackDiscovery() async throws {
		try XCTSkipUnless(
			ProcessInfo.processInfo.environment["UMBRELKIT_FALLBACK_DISCOVERY_TEST"] == "1",
			"Set UMBRELKIT_FALLBACK_DISCOVERY_TEST=1 on a network with legacy and current Umbrels"
		)

		let result = await Umbreld.discoverFallbackHosts()
		XCTAssertFalse(
			result.devices.isEmpty && result.updateRequired.isEmpty,
			"Expected at least one common Umbrel hostname to answer"
		)
	}
}

private func device(
	host: String,
	addresses: [String] = [],
	id: String,
	certificate: Data? = nil
) -> IdentifiedDevice {
	IdentifiedDevice(
		host: host,
		discoveryHost: host,
		addresses: addresses,
		name: Umbreld.fallbackDeviceName(host: host),
		id: id,
		model: "Umbrel Home",
		onboarded: true,
		candidateCACertificate: certificate
	)
}

private actor IdentificationAttempts {
	struct Attempt {
		let host: String
		let knownDeviceIds: Set<String>
	}

	private(set) var all: [Attempt] = []

	func record(_ host: String, _ knownDeviceIds: Set<String>) {
		all.append(Attempt(host: host, knownDeviceIds: knownDeviceIds))
	}
}
