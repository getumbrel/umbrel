import Security
import XCTest
@testable import UmbrelKit

final class LocalHTTPSTests: XCTestCase {
	func testBoundedDataAcceptsAResponseAtTheLimit() async throws {
		let session = makeStubSession()
		defer { session.invalidateAndCancel() }

		let request = try XCTUnwrap(URLRequest(url: URL(string: "https://stub.test/?bytes=64&declared=64")!))
		let (data, _) = try await LocalHTTPSTransport.boundedData(
			for: request,
			session: session,
			maximumBytes: 64
		)

		XCTAssertEqual(data.count, 64)
	}

	func testBoundedDataRejectsAnOversizedDeclaredLength() async throws {
		let session = makeStubSession()
		defer { session.invalidateAndCancel() }

		let request = try XCTUnwrap(URLRequest(url: URL(string: "https://stub.test/?bytes=65&declared=65")!))
		await assertDataLimitExceeded {
			try await LocalHTTPSTransport.boundedData(
				for: request,
				session: session,
				maximumBytes: 64
			)
		}
	}

	func testBoundedDataRejectsAnOversizedStreamWithoutADeclaredLength() async throws {
		let session = makeStubSession()
		defer { session.invalidateAndCancel() }

		let request = try XCTUnwrap(URLRequest(url: URL(string: "https://stub.test/?bytes=65")!))
		await assertDataLimitExceeded {
			try await LocalHTTPSTransport.boundedData(
				for: request,
				session: session,
				maximumBytes: 64
			)
		}
	}

	func testUnsavedCandidateUsesOnlyFirstUseVerification() async throws {
		let recorder = IdentityProbeRecorder()
		let candidate = Candidate(host: "new-umbrel.local", name: "New Umbrel", id: "new-device")

		let result = await Umbreld.identifyCandidate(
			candidate,
			knownDeviceIds: [],
			probe: { host, expectedDeviceId in
				await recorder.record(host: host, expectedDeviceId: expectedDeviceId)
				return Umbreld.IdentityProbeResult(
					discoveryInfo: .init(id: "new-device", device: "Umbrel Pro", onboarded: true),
					candidateCertificate: Data("candidate-ca".utf8)
				)
			}
		)
		let calls = await recorder.recordedCalls()

		XCTAssertEqual(result?.id, "new-device")
		XCTAssertEqual(result?.candidateCACertificate, Data("candidate-ca".utf8))
		XCTAssertEqual(calls, [.init(host: "new-umbrel.local", expectedDeviceId: nil)])
	}

	func testSavedTXTHintRequiresPinnedVerificationImmediately() async throws {
		let recorder = IdentityProbeRecorder()
		let candidate = Candidate(host: "known.local", name: "Known", id: "saved-device")

		let result = await Umbreld.identifyCandidate(
			candidate,
			knownDeviceIds: ["saved-device"],
			probe: { host, expectedDeviceId in
				await recorder.record(host: host, expectedDeviceId: expectedDeviceId)
				return Umbreld.IdentityProbeResult(
					discoveryInfo: .init(id: "saved-device", device: "Umbrel", onboarded: true),
					candidateCertificate: nil
				)
			}
		)
		let calls = await recorder.recordedCalls()

		XCTAssertEqual(result?.id, "saved-device")
		XCTAssertEqual(calls, [.init(host: "known.local", expectedDeviceId: "saved-device")])
	}

	func testAuthoritativeSavedIdentityWithoutTXTHintIsRevalidatedWithPin() async throws {
		let recorder = IdentityProbeRecorder()
		let candidate = Candidate(host: "claimed.local", name: "Claimed", id: "untrusted-hint")

		let result = await Umbreld.identifyCandidate(
			candidate,
			knownDeviceIds: ["saved-device"],
			probe: { host, expectedDeviceId in
				await recorder.record(host: host, expectedDeviceId: expectedDeviceId)
				if expectedDeviceId == nil {
					return Umbreld.IdentityProbeResult(
						discoveryInfo: .init(id: "saved-device", device: "Spoof", onboarded: true),
						candidateCertificate: Data("spoof-ca".utf8)
					)
				}
				return nil
			}
		)
		let calls = await recorder.recordedCalls()

		XCTAssertNil(result)
		XCTAssertEqual(calls, [
			.init(host: "claimed.local", expectedDeviceId: nil),
			.init(host: "claimed.local", expectedDeviceId: "saved-device"),
		])
	}

	func testExplicitManualCandidateMayUseTailscaleHost() async throws {
		let recorder = IdentityProbeRecorder()
		let candidate = Candidate(host: "100.90.0.1", name: "100.90.0.1")

		let result = await Umbreld.identifyCandidate(
			candidate,
			knownDeviceIds: [],
			allowsTailscaleHost: true,
			probe: { host, expectedDeviceId in
				await recorder.record(host: host, expectedDeviceId: expectedDeviceId)
				return Umbreld.IdentityProbeResult(
					discoveryInfo: .init(id: "remote-device", device: "Umbrel Home", onboarded: true),
					candidateCertificate: Data("candidate-ca".utf8)
				)
			}
		)
		let calls = await recorder.recordedCalls()

		XCTAssertEqual(result?.id, "remote-device")
		XCTAssertEqual(result?.host, "100.90.0.1")
		XCTAssertEqual(calls, [.init(host: "100.90.0.1", expectedDeviceId: nil)])
	}

	func testLivePassiveIdentificationDoesNotEnrollUntilExplicitClaim() async throws {
		guard let host = ProcessInfo.processInfo.environment["UMBRELKIT_HTTPS_TEST_HOST"] else {
			throw XCTSkip("Set UMBRELKIT_HTTPS_TEST_HOST to run against an Umbrel")
		}

		guard let device = await Umbreld.identify(candidate: Candidate(host: host, name: "Live test")) else {
			return XCTFail("Passive HTTPS identification failed")
		}
		guard case .missing = Keychain.readLocalHTTPSCA(deviceId: device.id) else {
			throw XCTSkip("The live Umbrel already has an enrolled CA in this Keychain")
		}

		try await Umbreld.claimLocalHTTPSIdentity(device)
		let pinned = await Umbreld.identify(host: host, expectedDeviceId: device.id)
		let stored = Keychain.readLocalHTTPSCA(deviceId: device.id)
		await Umbreld.forgetLocalHTTPSIdentity(deviceId: device.id)

		XCTAssertEqual(pinned?.id, device.id)
		guard case .found = stored else {
			return XCTFail("Explicit claim did not persist the CA")
		}
	}

	func testLiveCandidateTrustWorksWithBoundedResponseStreaming() async throws {
		guard let host = ProcessInfo.processInfo.environment["UMBRELKIT_HTTPS_TEST_HOST"] else {
			throw XCTSkip("Set UMBRELKIT_HTTPS_TEST_HOST to run against an Umbrel")
		}

		let device = await Umbreld.identify(candidate: Candidate(host: host, name: "Live test"))

		XCTAssertNotNil(device)
	}

	func testPEMCertificateIsParsedAndCanonicalized() throws {
		let data = try LocalHTTPSTransport.certificateData(fromPEM: testCertificatePEM)
		let certificate = try XCTUnwrap(SecCertificateCreateWithData(nil, data as CFData))

		XCTAssertEqual(data, SecCertificateCopyData(certificate) as Data)
	}

	func testMalformedPEMCertificateIsRejected() {
		XCTAssertThrowsError(
			try LocalHTTPSTransport.certificateData(
				fromPEM: "-----BEGIN CERTIFICATE-----\nnot-a-certificate\n-----END CERTIFICATE-----")) { error in
				XCTAssertEqual(error as? LocalHTTPSTransportError, .invalidCertificate)
			}
	}

	private func makeStubSession() -> URLSession {
		let configuration = URLSessionConfiguration.ephemeral
		configuration.protocolClasses = [BoundedBodyURLProtocol.self]
		return URLSession(configuration: configuration)
	}

	private func assertDataLimitExceeded(
		_ operation: () async throws -> (Data, URLResponse),
		file: StaticString = #filePath,
		line: UInt = #line
	) async {
		do {
			_ = try await operation()
			XCTFail("Expected the response body limit to be enforced", file: file, line: line)
		} catch {
			XCTAssertEqual((error as? URLError)?.code, .dataLengthExceedsMaximum, file: file, line: line)
		}
	}

	func testSavedDeviceRecoveryUsesOnlyPrimaryLocalHostWhenBothKeychainItemsAreMissing() throws {
		let target = Umbreld.Target(
			deviceId: "saved-device",
			hosts: ["saved-umbrel.local", "192.168.1.50"]
		)

		let decision = try Umbreld.savedIdentityRecoveryDecision(
			for: target,
			caRead: .missing,
			sessionRead: .missing
		)

		XCTAssertEqual(decision, .claim(host: "saved-umbrel.local"))
	}

	func testSavedDeviceRecoveryDoesNothingWhenPinExists() throws {
		let target = Umbreld.Target(deviceId: "saved-device", hosts: ["saved-umbrel.local"])
		let session = Umbreld.Session(
			deviceId: "saved-device",
			accountId: "0",
			accessToken: "access",
			accessExpiresAt: 1,
			deviceToken: "device"
		)

		XCTAssertEqual(
			try Umbreld.savedIdentityRecoveryDecision(
				for: target,
				caRead: .found(Data("ca".utf8)),
				sessionRead: .found(session)
			),
			.alreadyEnrolled
		)
	}

	func testSavedDeviceRecoveryRejectsExistingOrMalformedSessionWithoutAPin() {
		let target = Umbreld.Target(deviceId: "saved-device", hosts: ["saved-umbrel.local"])
		let session = Umbreld.Session(
			deviceId: "saved-device",
			accountId: "0",
			accessToken: "access",
			accessExpiresAt: 1,
			deviceToken: "device"
		)

		for sessionRead in [Keychain.SessionReadResult.found(session), .invalid] {
			XCTAssertThrowsError(
				try Umbreld.savedIdentityRecoveryDecision(
					for: target,
					caRead: .missing,
					sessionRead: sessionRead
				)
			) { error in
				XCTAssertEqual(error as? LocalHTTPSTransportError, .notEnrolled)
			}
		}
	}

	func testSavedDeviceRecoveryRejectsTailscalePrimaryHost() {
		let target = Umbreld.Target(
			deviceId: "saved-device",
			hosts: ["100.100.10.20", "saved-umbrel.local"]
		)

		XCTAssertThrowsError(
			try Umbreld.savedIdentityRecoveryDecision(
				for: target,
				caRead: .missing,
				sessionRead: .missing
			)
		) { error in
			XCTAssertEqual(error as? LocalHTTPSTransportError, .trustFailed)
		}
	}

	private let testCertificatePEM = """
		-----BEGIN CERTIFICATE-----
		MIIDLDCCAhSgAwIBAgIUQN+vZuip6m95yaEcLuqGiALn47IwDQYJKoZIhvcNAQEL
		BQAwHDEaMBgGA1UEAwwRVW1icmVsS2l0LVRlc3QtQ0EwHhcNMjYwODEzMDMyNzQ0
		WhcNMzYwODEwMDMyNzQ0WjAcMRowGAYDVQQDDBFVbWJyZWxLaXQtVGVzdC1DQTCC
		ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALHtaPqHCHtQCD7XGFkHTFAk
		XlU9mZra/7zocYZUK2l7QwxuxIkbar2YlYHVhm4CM47kLVmi+OGFPOpndeymfX1o
		gYCn60ycylKoVcx6gobNJzBETuWSDI2D1QIrWvItnEUYuJK7sl9LEmXa4RHq3H/R
		KclbxMtuZf71R1JqzsRKeD0zShNipSJ5etpDKWdW2KxTQFHtRqfjG+gmAaxhr42E
		YvB1TZ08S2xepq/iNc8vEpfMgzwyxyDXV61WRBkNYCWzcTJZ4TpxFF6+z1FbUSdA
		iYymrr99WExgqk+y9XLI3sk6gvTW+/U13RzeozCH6voZVPBguiDzmzPrhPYQXpUC
		AwEAAaNmMGQwHQYDVR0OBBYEFBLj2Fz36XxyX1U5VgDp6BjiThN2MB8GA1UdIwQY
		MBaAFBLj2Fz36XxyX1U5VgDp6BjiThN2MBIGA1UdEwEB/wQIMAYBAf8CAQAwDgYD
		VR0PAQH/BAQDAgEGMA0GCSqGSIb3DQEBCwUAA4IBAQA0oHmWc659wIAVzmfYpl+q
		h9JZe0uJd+eGG1X9PSClqX8okS5IXhI2lqyn6Wy9TkKHBrUsul76g0GJAqeP4YqJ
		Bn0/xwjL0ZwybzfiKUX/IWjfksMufc3wtDkiZ7AqW9HuzhQCLa3CQRTBZ/bFzSkp
		k4x4zY3+XHzJkkcHAWkRD2qIdNXGbguHiBVBk1ZV+T/0W89efW+tQJ8dPooJX+Ng
		cypSJJWGClLjW7zSTYK8Nl1iMEsY9O8OpAg5e+WwImL7JgXssTOPj3I5rdLoKP7K
		wuGHe9yRHVZ5PZI5rUQWTY6ST5aN8rbMsOegQFJj18lPdvQAd9kfm2NI9wYKAHSC
		-----END CERTIFICATE-----
		"""
}

private actor IdentityProbeRecorder {
	struct Call: Equatable {
		let host: String
		let expectedDeviceId: String?
	}

	private var calls: [Call] = []

	func record(host: String, expectedDeviceId: String?) {
		calls.append(Call(host: host, expectedDeviceId: expectedDeviceId))
	}

	func recordedCalls() -> [Call] { calls }
}

private final class BoundedBodyURLProtocol: URLProtocol {
	override class func canInit(with request: URLRequest) -> Bool { true }
	override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

	override func startLoading() {
		guard let url = request.url,
			let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
			let byteCountString = components.queryItems?.first(where: { $0.name == "bytes" })?.value,
			let byteCount = Int(byteCountString)
		else {
			client?.urlProtocol(self, didFailWithError: URLError(.badURL))
			return
		}

		var headers = [String: String]()
		if let declared = components.queryItems?.first(where: { $0.name == "declared" })?.value {
			headers["Content-Length"] = declared
		}
		let response = HTTPURLResponse(
			url: url,
			statusCode: 200,
			httpVersion: "HTTP/1.1",
			headerFields: headers
		)!
		client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
		client?.urlProtocol(self, didLoad: Data(repeating: 0x41, count: byteCount))
		client?.urlProtocolDidFinishLoading(self)
	}

	override func stopLoading() {}
}
