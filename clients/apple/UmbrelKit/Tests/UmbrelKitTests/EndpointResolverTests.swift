import XCTest
@testable import UmbrelKit

final class EndpointResolverTests: XCTestCase {
	func testConnectionHostsIncludeCanonicalHostAndDeduplicateAddresses() {
		let device = SavedDevice(
			id: "device",
			name: "Umbrel",
			host: "umbrel.local",
			addresses: ["192.168.1.2", "UMBREL.LOCAL", "100.64.0.1"]
		)

		XCTAssertEqual(
			device.connectionHosts,
			["umbrel.local", "192.168.1.2", "100.64.0.1"]
		)
	}

	func testResolverReturnsFirstVerifiedIdentity() async {
		let verifier = EndpointVerifier(
			results: [
				"umbrel.local": (false, 30_000_000),
				"100.64.0.1": (true, 1_000_000),
			]
		)

		let resolver = NativeEndpointResolver()
		let host = try? await resolver.resolve(
			Umbreld.Target(deviceId: "expected-device", hosts: ["umbrel.local", "100.64.0.1"])
		) { host, deviceId in
			await verifier.verify(host: host, deviceId: deviceId)
		}

		XCTAssertEqual(host, "100.64.0.1")
		let attempts = await verifier.attempts
		XCTAssertEqual(Set(attempts.map(\.deviceId)), ["expected-device"])
	}

	func testResolverPrefersPromptTailscaleOverAFasterLocalRoute() async {
		let verifier = EndpointVerifier(
			results: [
				"umbrel.local": (true, 1_000_000),
				"100.64.0.1": (true, 10_000_000),
			]
		)
		let resolver = NativeEndpointResolver(tailscalePreferenceWindow: .milliseconds(50))

		let host = try? await resolver.resolve(
			Umbreld.Target(deviceId: "device", hosts: ["umbrel.local", "100.64.0.1"])
		) { host, deviceId in
			await verifier.verify(host: host, deviceId: deviceId)
		}

		XCTAssertEqual(host, "100.64.0.1")
		let attempts = await verifier.attempts
		XCTAssertEqual(attempts.map(\.host), ["100.64.0.1"])
	}

	func testResolverFallsBackLocallyWhenTailscaleIsUnavailable() async {
		let verifier = EndpointVerifier(
			results: [
				"umbrel.local": (true, 1_000_000),
				"100.64.0.1": (false, 1_000_000),
			]
		)
		let resolver = NativeEndpointResolver(tailscalePreferenceWindow: .seconds(10))

		let host = try? await resolver.resolve(
			Umbreld.Target(deviceId: "device", hosts: ["umbrel.local", "100.64.0.1"])
		) { host, deviceId in
			await verifier.verify(host: host, deviceId: deviceId)
		}

		XCTAssertEqual(host, "umbrel.local")
		let attempts = await verifier.attempts
		XCTAssertEqual(Set(attempts.map(\.host)), ["umbrel.local", "100.64.0.1"])
	}

	func testResolverOpensTheRaceAfterTailscalePreferenceWindow() async {
		let verifier = EndpointVerifier(
			results: [
				"umbrel.local": (true, 1_000_000),
				"100.64.0.1": (true, 100_000_000),
			]
		)
		let resolver = NativeEndpointResolver(tailscalePreferenceWindow: .milliseconds(5))

		let host = try? await resolver.resolve(
			Umbreld.Target(deviceId: "device", hosts: ["umbrel.local", "100.64.0.1"])
		) { host, deviceId in
			await verifier.verify(host: host, deviceId: deviceId)
		}

		XCTAssertEqual(host, "umbrel.local")
	}

	func testResolverStillRequiresTailscaleToProveTheSavedIdentity() async throws {
		let resolver = NativeEndpointResolver(tailscalePreferenceWindow: .seconds(1))
		let host = try await resolver.resolve(
			Umbreld.Target(deviceId: "device", hosts: ["umbrel.local", "100.64.0.1"])
		) { host, _ in
			host == "100.64.0.1" ? .rejected(.trust("wrong device")) : .verified
		}

		XCTAssertEqual(host, "umbrel.local")
	}

	func testPreferencePreservesTheStrongestRejectionAcrossRoutes() async {
		let resolver = NativeEndpointResolver(tailscalePreferenceWindow: .seconds(1))
		do {
			_ = try await resolver.resolve(
				Umbreld.Target(deviceId: "device", hosts: ["umbrel.local", "100.64.0.1"])
			) { host, _ in
				host == "100.64.0.1"
					? .rejected(.trust("wrong device"))
					: .rejected(.storage("keychain unavailable"))
			}
			XCTFail("No rejected endpoint may become a winner")
		} catch let rejection as EndpointRejection {
			XCTAssertEqual(rejection, .storage("keychain unavailable"))
		} catch {
			XCTFail("Expected the strongest endpoint rejection, got \(error)")
		}
	}

	func testResolverReturnsNilWhenNoEndpointProvesIdentity() async {
		let resolver = NativeEndpointResolver()
		let host = try? await resolver.resolve(
			Umbreld.Target(deviceId: "device", hosts: ["umbrel.local", "100.64.0.1"])
		) { _, _ in .unavailable }

		XCTAssertNil(host)
	}

	func testResolverReusesWinnerUntilItIsInvalidated() async throws {
		let resolver = NativeEndpointResolver()
		let verifier = EndpointVerifier(
			results: [
				"umbrel.local": (false, 20_000_000),
				"100.64.0.1": (true, 1_000_000),
			]
		)
		let target = Umbreld.Target(
			deviceId: "device",
			hosts: ["umbrel.local", "100.64.0.1"]
		)

		let first = try await resolver.resolve(target) { host, deviceId in
			await verifier.verify(host: host, deviceId: deviceId)
		}
		let attemptsAfterFirstResolution = await verifier.attempts.count
		let second = try await resolver.resolve(target) { _, _ in
			XCTFail("A cached winner must not be probed again")
			return .unavailable
		}
		let attemptsAfterCachedResolution = await verifier.attempts.count

		XCTAssertEqual(first, "100.64.0.1")
		XCTAssertEqual(second, first)
		XCTAssertEqual(attemptsAfterCachedResolution, attemptsAfterFirstResolution)

		await resolver.invalidate(deviceId: "device", host: first)
		let fallback = try await resolver.resolve(target) { host, _ in
			host == "umbrel.local" ? .verified : .unavailable
		}
		XCTAssertEqual(fallback, "umbrel.local")
	}

	func testResolverKeepsWinnersSeparateByDevice() async throws {
		let resolver = NativeEndpointResolver()
		let sharedHosts = ["umbrel.local", "100.64.0.1"]

		let first = try await resolver.resolve(.init(deviceId: "one", hosts: sharedHosts)) { host, id in
			id == "one" && host == "umbrel.local" ? .verified : .unavailable
		}
		let second = try await resolver.resolve(.init(deviceId: "two", hosts: sharedHosts)) { host, id in
			id == "two" && host == "100.64.0.1" ? .verified : .unavailable
		}

		XCTAssertEqual(first, "umbrel.local")
		XCTAssertEqual(second, "100.64.0.1")
	}

	func testNetworkPathInvalidationReevaluatesTheDeviceWinner() async throws {
		let resolver = NativeEndpointResolver()
		let target = Umbreld.Target(
			deviceId: "device",
			hosts: ["umbrel.local", "100.64.0.1"]
		)

		let first = try await resolver.resolve(target) { host, _ in
			host == "umbrel.local" ? .verified : .unavailable
		}
		await resolver.invalidate(deviceId: "device")
		let second = try await resolver.resolve(target) { host, _ in
			host == "100.64.0.1" ? .verified : .unavailable
		}

		XCTAssertEqual(first, "umbrel.local")
		XCTAssertEqual(second, "100.64.0.1")
	}

	func testMinimalSavedDeviceStillDecodes() throws {
		let data = try XCTUnwrap(
			#"{"id":"device","name":"Umbrel","host":"umbrel.local","addresses":[]}"#.data(using: .utf8)
		)

		let device = try JSONDecoder().decode(SavedDevice.self, from: data)

		XCTAssertEqual(device.connectionHosts, ["umbrel.local"])
	}

	func testAuthoritativeAddressRefreshReplacesStaleAddresses() {
		var device = SavedDevice(
			id: "device",
			name: "Umbrel",
			host: "umbrel.local",
			addresses: ["192.168.1.20", "100.64.0.1"]
		)

		device.replaceAvailableAddresses(["192.168.1.21"])

		XCTAssertEqual(device.addresses, ["192.168.1.21"])
	}

	func testRememberingConnectionCandidatesDoesNotEraseKnownRoutes() {
		var device = SavedDevice(
			id: "device",
			name: "Kitchen Umbrel",
			host: "umbrel.local",
			addresses: ["192.168.1.20"]
		)

		device.rememberConnectionCandidates(["100.64.0.1", "192.168.1.20"])

		XCTAssertEqual(device.addresses, ["192.168.1.20", "100.64.0.1"])
		XCTAssertEqual(device.name, "Kitchen Umbrel")
		XCTAssertEqual(device.host, "umbrel.local")
	}

	func testResolverPreservesCancellation() async {
		let resolver = NativeEndpointResolver()
		let task = Task {
			try await resolver.resolve(
				Umbreld.Target(deviceId: "device", hosts: ["umbrel.local"])
			) { _, _ in
				try? await Task.sleep(for: .seconds(10))
				return .unavailable
			}
		}

		task.cancel()
		do {
			_ = try await task.value
			XCTFail("A cancelled resolution must not become an offline error")
		} catch is CancellationError {
			// Expected.
		} catch {
			XCTFail("Expected CancellationError, got \(error)")
		}
	}

	func testResolverPreservesCancellationDuringTailscalePreference() async {
		let resolver = NativeEndpointResolver(tailscalePreferenceWindow: .seconds(5))
		let task = Task {
			try await resolver.resolve(
				Umbreld.Target(deviceId: "device", hosts: ["umbrel.local", "100.64.0.1"])
			) { _, _ in
				try? await Task.sleep(for: .seconds(10))
				return .unavailable
			}
		}

		task.cancel()
		do {
			_ = try await task.value
			XCTFail("A cancelled preference window must not fall through to a local request")
		} catch is CancellationError {
			// Expected.
		} catch {
			XCTFail("Expected CancellationError, got \(error)")
		}
	}

	func testConcurrentTargetsNeverBorrowAnEndpointOutsideTheirCandidateSet() async throws {
		let resolver = NativeEndpointResolver()
		async let first = resolver.resolve(
			Umbreld.Target(deviceId: "device", hosts: ["lan.local"])
		) { host, _ in
			try? await Task.sleep(for: .milliseconds(20))
			return host == "lan.local" ? .verified : .unavailable
		}
		async let second = resolver.resolve(
			Umbreld.Target(deviceId: "device", hosts: ["100.64.0.1"])
		) { host, _ in
			host == "100.64.0.1" ? .verified : .unavailable
		}

		let results = try await (first, second)
		XCTAssertEqual(results.0, "lan.local")
		XCTAssertEqual(results.1, "100.64.0.1")
	}

	func testResolverSurfacesSecurityRejectionWhenNoEndpointVerifies() async {
		let resolver = NativeEndpointResolver()
		do {
			_ = try await resolver.resolve(
				Umbreld.Target(deviceId: "device", hosts: ["offline.local", "changed.local"])
			) { host, _ in
				host == "changed.local"
					? .rejected(.trust("identity changed"))
					: .unavailable
			}
			XCTFail("A rejected identity must not become a verified endpoint")
		} catch let rejection as EndpointRejection {
			XCTAssertEqual(rejection, .trust("identity changed"))
		} catch {
			XCTFail("Expected a trust rejection, got \(error)")
		}
	}
}

private actor EndpointVerifier {
	struct Attempt: Sendable {
		let host: String
		let deviceId: String
	}

	let results: [String: (success: Bool, delay: UInt64)]
	private(set) var attempts: [Attempt] = []

	init(results: [String: (success: Bool, delay: UInt64)]) {
		self.results = results
	}

	func verify(host: String, deviceId: String) async -> EndpointVerification {
		attempts.append(Attempt(host: host, deviceId: deviceId))
		guard let result = results[host] else { return .unavailable }
		try? await Task.sleep(nanoseconds: result.delay)
		return result.success ? .verified : .unavailable
	}
}
