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

	func testReidentifyReportsFinishedSetupOverTheScannedAnchor() async throws {
		let device = IdentifiedDevice(
			host: "192.168.4.23",
			discoveryHost: "umbrel-3.local",
			addresses: ["192.168.4.23"],
			name: "umbrel-3",
			id: "new-device",
			model: "Umbrel Home (2025)",
			onboarded: false,
			candidateCACertificate: Data("candidate-ca".utf8)
		)

		let result = await Umbreld.reidentify(device) { host, anchor in
			// Only the exact endpoint and anchor from the scan may answer
			guard host == "192.168.4.23", anchor == .candidate(Data("candidate-ca".utf8)) else { return nil }
			return .init(id: "new-device", device: "Umbrel Home (2025)", onboarded: true)
		}

		XCTAssertEqual(result?.onboarded, true)
		XCTAssertEqual(result?.host, device.host)
		XCTAssertEqual(result?.discoveryHost, device.discoveryHost)
		XCTAssertEqual(result?.candidateCACertificate, device.candidateCACertificate)
	}

	func testReidentifyUsesThePinForAClaimedDevice() async throws {
		let device = IdentifiedDevice(
			host: "umbrel.local",
			discoveryHost: "umbrel.local",
			addresses: [],
			name: "umbrel",
			id: "claimed-device",
			model: "Umbrel Home",
			onboarded: false
		)

		let result = await Umbreld.reidentify(device) { host, anchor in
			guard host == "umbrel.local", anchor == .pinned(deviceId: "claimed-device") else { return nil }
			return .init(id: "claimed-device", device: "Umbrel Home", onboarded: true)
		}

		XCTAssertEqual(result?.onboarded, true)
		XCTAssertNil(result?.candidateCACertificate)
	}

	func testReidentifyRejectsADifferentUmbrelAtTheSameAddress() async throws {
		let device = IdentifiedDevice(
			host: "umbrel.local",
			discoveryHost: "umbrel.local",
			addresses: [],
			name: "umbrel",
			id: "new-device",
			model: "Umbrel Home",
			onboarded: false,
			candidateCACertificate: Data("candidate-ca".utf8)
		)

		let replaced = await Umbreld.reidentify(device) { _, _ in
			.init(id: "other-device", device: "Umbrel Home", onboarded: true)
		}
		let unanswered = await Umbreld.reidentify(device) { _, _ in nil }

		XCTAssertNil(replaced)
		XCTAssertNil(unanswered)
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

	func testRefusedCertificateFromAnotherAuthorityIsToldApartFromTheRightOne() throws {
		let caA = try certificate(fromPEM: testUmbrelCAAPEM)
		let caB = try certificate(fromPEM: testUmbrelCABPEM)
		let leaf = try certificate(fromPEM: testUmbrelLeafPEM)

		// Issued by the pinned CA: the same Umbrel, whatever address it was reached at.
		XCTAssertTrue(chainsToAnchor([leaf], anchor: caA))
		XCTAssertTrue(chainsToAnchor([leaf, caA], anchor: caA))
		// Issued by another CA, even one sent along with it: a different identity.
		XCTAssertFalse(chainsToAnchor([leaf], anchor: caB))
		XCTAssertFalse(chainsToAnchor([leaf, caA], anchor: caB))
	}

	func testRefusedCertificateFromThePinnedAuthorityIsTheSameIdentity() throws {
		let caA = try certificate(fromPEM: testUmbrelCAAPEM)
		let caB = try certificate(fromPEM: testUmbrelCABPEM)
		let leaf = try certificate(fromPEM: testUmbrelLeafPEM)
		let current = try certificate(fromPEM: testUmbrelCurrentLeafPEM)
		let expired = try certificate(fromPEM: testUmbrelExpiredLeafPEM)

		// Right authority, refused for its dates or for the address: the same Umbrel. The
		// current certificate passes for the name it covers, so the address is the only reason.
		XCTAssertFalse(chainsToAnchor([expired], anchor: caA))
		XCTAssertTrue(isIssued(by: caA, chain: evaluatedChain([expired], host: "umbrel.local", anchor: caA)))
		XCTAssertTrue(evaluates([current], host: "umbrel.local", anchor: caA))
		XCTAssertTrue(isIssued(by: caA, chain: evaluatedChain([current], host: "192.168.1.9", anchor: caA)))
		// Another authority, even with the pinned one sent alongside: a different identity.
		XCTAssertFalse(isIssued(by: caB, chain: evaluatedChain([leaf], host: "umbrel.local", anchor: caB)))
		XCTAssertFalse(isIssued(by: caB, chain: evaluatedChain([leaf, caA], host: "umbrel.local", anchor: caB)))
	}

	func testNoCertificateIsIssuedByTheAnchorWithoutAChain() throws {
		let caA = try certificate(fromPEM: testUmbrelCAAPEM)
		let caB = try certificate(fromPEM: testUmbrelCABPEM)

		XCTAssertFalse(chainsToAnchor([], anchor: caA))
		XCTAssertFalse(isIssued(by: caA, chain: []))
		// Another authority alone is not this one.
		XCTAssertFalse(isIssued(by: caA, chain: [caB]))
		XCTAssertTrue(isIssued(by: caA, chain: [caA]))
	}

	func testPinnedTrustAcceptsTheUmbrelAtAnAddressItsCertificateDoesNotName() throws {
		let caA = try certificate(fromPEM: testUmbrelCAAPEM)
		let caB = try certificate(fromPEM: testUmbrelCABPEM)
		let current = try certificate(fromPEM: testUmbrelCurrentLeafPEM)
		let expired = try certificate(fromPEM: testUmbrelExpiredLeafPEM)

		XCTAssertTrue(evaluateServerTrust(try challengeTrust([current], host: "100.90.0.1"), anchor: caA))
		// The anchor still decides identity, and the dates still apply.
		XCTAssertFalse(evaluateServerTrust(try challengeTrust([current], host: "100.90.0.1"), anchor: caB))
		XCTAssertFalse(evaluateServerTrust(try challengeTrust([expired], host: "umbrel.local"), anchor: caA))
	}

	// Asked as the in-app browser asks it: after the pinned credential was refused for the
	// same challenge.
	func testRefusedIdentityDiffersOnlyForAnotherAuthoritysCertificate() throws {
		let pinnedA = "local-https-test-\(UUID().uuidString)"
		let pinnedB = "local-https-test-\(UUID().uuidString)"
		defer {
			Keychain.deleteLocalHTTPSCA(deviceId: pinnedA)
			Keychain.deleteLocalHTTPSCA(deviceId: pinnedB)
		}
		try enroll(testUmbrelCAAPEM, deviceId: pinnedA)
		try enroll(testUmbrelCABPEM, deviceId: pinnedB)
		let caA = try certificate(fromPEM: testUmbrelCAAPEM)
		let leaf = try certificate(fromPEM: testUmbrelLeafPEM)
		let expired = try certificate(fromPEM: testUmbrelExpiredLeafPEM)

		// The pinned authority's certificate, refused for its dates: the same Umbrel.
		XCTAssertFalse(try identityDiffersAfterRefusal(host: "umbrel.local", chain: [expired], deviceId: pinnedA))
		// Another authority's certificate, even with this one sent alongside: a reset Umbrel.
		XCTAssertTrue(try identityDiffersAfterRefusal(host: "umbrel.local", chain: [leaf], deviceId: pinnedB))
		XCTAssertTrue(try identityDiffersAfterRefusal(host: "umbrel.local", chain: [leaf, caA], deviceId: pinnedB))
		// Nothing pinned to compare against.
		XCTAssertFalse(try identityDiffersAfterRefusal(
			host: "umbrel.local", chain: [leaf], deviceId: "local-https-test-\(UUID().uuidString)"))
	}

	private func identityDiffersAfterRefusal(host: String, chain: [SecCertificate], deviceId: String) throws -> Bool {
		let challenge = try challenge(host: host, chain: chain)
		XCTAssertNil(LocalHTTPSTransport.credential(for: challenge, deviceId: deviceId))
		return LocalHTTPSTransport.identityDiffers(for: challenge, deviceId: deviceId)
	}

	private func enroll(_ pem: String, deviceId: String) throws {
		let enrollment = Keychain.storeLocalHTTPSCAIfAbsent(
			try LocalHTTPSTransport.certificateData(fromPEM: pem), deviceId: deviceId)
		if enrollment == .unavailable(status: Int32(errSecMissingEntitlement)) {
			throw XCTSkip("The standalone SwiftPM test runner has no Data Protection Keychain entitlement")
		}
		XCTAssertEqual(enrollment, .stored)
	}

	// A server trust challenge as URLSession and WKWebView deliver one.
	private func challenge(host: String, chain: [SecCertificate]) throws -> URLAuthenticationChallenge {
		var trust: SecTrust?
		XCTAssertEqual(
			SecTrustCreateWithCertificates(chain as CFArray, SecPolicyCreateSSL(true, host as CFString), &trust),
			errSecSuccess)
		return URLAuthenticationChallenge(
			protectionSpace: ServerTrustProtectionSpace(host: host, trust: try XCTUnwrap(trust)),
			proposedCredential: nil,
			previousFailureCount: 0,
			failureResponse: nil,
			error: nil,
			sender: UnansweredChallengeSender())
	}

	// A trust as a challenge for `host` delivers it, on the same fixed date as pinnedTrust.
	private func challengeTrust(_ certificates: [SecCertificate], host: String) throws -> SecTrust {
		var trust: SecTrust?
		SecTrustCreateWithCertificates(certificates as CFArray, SecPolicyCreateSSL(true, host as CFString), &trust)
		let created = try XCTUnwrap(trust)
		SecTrustSetVerifyDate(created, Date(timeIntervalSince1970: 1_798_761_600) as CFDate) // 2027-01-01
		return created
	}

	// The chain a failed pinned evaluation leaves behind, as the trust delegates see it.
	private func evaluatedChain(_ certificates: [SecCertificate], host: String, anchor: SecCertificate) -> [SecCertificate] {
		guard let trust = pinnedTrust(certificates, host: host, anchor: anchor) else { return [] }
		var error: CFError?
		XCTAssertFalse(SecTrustEvaluateWithError(trust, &error))
		return (SecTrustCopyCertificateChain(trust) as? [SecCertificate]) ?? []
	}

	private func evaluates(_ certificates: [SecCertificate], host: String, anchor: SecCertificate) -> Bool {
		guard let trust = pinnedTrust(certificates, host: host, anchor: anchor) else { return false }
		var error: CFError?
		return SecTrustEvaluateWithError(trust, &error)
	}

	// Evaluated on a fixed date inside the current certificate's year, so the tests don't
	// change outcome when it expires.
	private func pinnedTrust(_ certificates: [SecCertificate], host: String, anchor: SecCertificate) -> SecTrust? {
		var trust: SecTrust?
		SecTrustCreateWithCertificates(certificates as CFArray, SecPolicyCreateSSL(true, host as CFString), &trust)
		guard let trust else { return nil }
		SecTrustSetAnchorCertificates(trust, [anchor] as CFArray)
		SecTrustSetAnchorCertificatesOnly(trust, true)
		SecTrustSetVerifyDate(trust, Date(timeIntervalSince1970: 1_798_761_600) as CFDate) // 2027-01-01
		return trust
	}

	private func certificate(fromPEM pem: String) throws -> SecCertificate {
		let data = try LocalHTTPSTransport.certificateData(fromPEM: pem)
		return try XCTUnwrap(SecCertificateCreateWithData(nil, data as CFData))
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

	// Two unrelated CAs and a leaf for umbrel.local issued by the first, valid until 2126.
	private let testUmbrelCAAPEM = """
		-----BEGIN CERTIFICATE-----
		MIIBoTCCAUagAwIBAgIUJBCuFD/6qjd7paDO4bsAabMUwt8wCgYIKoZIzj0EAwIw
		GzEZMBcGA1UEAwwQVGVzdCBVbWJyZWwgQ0EgQTAgFw0yNjEwMDgwNDMxMzJaGA8y
		MTI2MDkxNDA0MzEzMlowGzEZMBcGA1UEAwwQVGVzdCBVbWJyZWwgQ0EgQTBZMBMG
		ByqGSM49AgEGCCqGSM49AwEHA0IABB6uBMbutY35r0xxOTsnVxR2ic5lFBCalnjy
		7XZNkuXTRkuc4Cq1iYEiR7TvzDcKqPqOManZ2SqQal19Pd2/PdyjZjBkMB0GA1Ud
		DgQWBBSn7migp0hekDh832w+rwmUdWoNRTAfBgNVHSMEGDAWgBSn7migp0hekDh8
		32w+rwmUdWoNRTASBgNVHRMBAf8ECDAGAQH/AgEAMA4GA1UdDwEB/wQEAwIBBjAK
		BggqhkjOPQQDAgNJADBGAiEAs8twJpeSjjTJfYY4GBukc2l5j4K06ev5brwGhCFV
		BSQCIQCZWvmaUzJzONI71uHC6JvIHz0A38+mIsQvPqH3JpqVaQ==
		-----END CERTIFICATE-----
		"""
	private let testUmbrelCABPEM = """
		-----BEGIN CERTIFICATE-----
		MIIBoDCCAUagAwIBAgIUT+lojZQuH+ewJnBcnB63YSLZTTYwCgYIKoZIzj0EAwIw
		GzEZMBcGA1UEAwwQVGVzdCBVbWJyZWwgQ0EgQjAgFw0yNjEwMDgwNDMxMzJaGA8y
		MTI2MDkxNDA0MzEzMlowGzEZMBcGA1UEAwwQVGVzdCBVbWJyZWwgQ0EgQjBZMBMG
		ByqGSM49AgEGCCqGSM49AwEHA0IABIDc2ghHqG0404CrHIOElzcn68Esb8/cl/xG
		S1vsg9JoLOQPIIzdxSfQGSPpsQ4kqaVuS6aVTRmAne9T1JVT7eijZjBkMB0GA1Ud
		DgQWBBTnLf9oEjzEdeVCajlHRQlMxZD17TAfBgNVHSMEGDAWgBTnLf9oEjzEdeVC
		ajlHRQlMxZD17TASBgNVHRMBAf8ECDAGAQH/AgEAMA4GA1UdDwEB/wQEAwIBBjAK
		BggqhkjOPQQDAgNIADBFAiEA8AA5hLEJHe1R8dUovjgHLM2kgQdRBeCOF0x7WbY4
		874CIFGrRMbqA9TsuJitmE3HF60CSVniBmGm1N50O2RrOI/d
		-----END CERTIFICATE-----
		"""
	private let testUmbrelLeafPEM = """
		-----BEGIN CERTIFICATE-----
		MIIBxjCCAWygAwIBAgIUF2+YiB5iZSttaTbZAFx9vtl9OEowCgYIKoZIzj0EAwIw
		GzEZMBcGA1UEAwwQVGVzdCBVbWJyZWwgQ0EgQTAgFw0yNjEwMDgwNDMxMzJaGA8y
		MTI2MDkxNDA0MzEzMlowFzEVMBMGA1UEAwwMdW1icmVsLmxvY2FsMFkwEwYHKoZI
		zj0CAQYIKoZIzj0DAQcDQgAEsK8JR01w5dJZk91U6fQR92erStbAlRIR6pfooaPU
		fj9LR7xreVL7ivo3yMJvRKAMtlFtXEjCES1lKDYAzQC8iqOBjzCBjDAMBgNVHRMB
		Af8EAjAAMA4GA1UdDwEB/wQEAwIHgDATBgNVHSUEDDAKBggrBgEFBQcDATAXBgNV
		HREEEDAOggx1bWJyZWwubG9jYWwwHQYDVR0OBBYEFB2IzrdsRb85pokG5HSvIOIR
		FBCOMB8GA1UdIwQYMBaAFKfuaKCnSF6QOHzfbD6vCZR1ag1FMAoGCCqGSM49BAMC
		A0gAMEUCIQDvQHwJ2NC0a/2wlbO9B+4XQhX3ixIazubouCnlaKTu/QIga6f7mcOG
		BLMIa3KdVjSmP9nRJ3bGi+gKZb6hiTT+Z/4=
		-----END CERTIFICATE-----
		"""

	// Issued by the first CA for umbrel.local, valid from October 2026 for a year: inside
	// Apple's 398-day limit, so it is refused only for what a test asks about.
	private let testUmbrelCurrentLeafPEM = """
		-----BEGIN CERTIFICATE-----
		MIIBxTCCAWqgAwIBAgIUF2+YiB5iZSttaTbZAFx9vtl9OEwwCgYIKoZIzj0EAwIw
		GzEZMBcGA1UEAwwQVGVzdCBVbWJyZWwgQ0EgQTAeFw0yNjEwMDEwMDAwMDBaFw0y
		NzEwMDEwMDAwMDBaMBcxFTATBgNVBAMMDHVtYnJlbC5sb2NhbDBZMBMGByqGSM49
		AgEGCCqGSM49AwEHA0IABNSbfgLjfQo73RuO1VbbLewqlE6iWSvbXjozk7tCreqC
		XWi1cVNOFuPz+qHOdghkgPO54OJ9QsHDeBBJFxL8dMKjgY8wgYwwDAYDVR0TAQH/
		BAIwADAOBgNVHQ8BAf8EBAMCB4AwEwYDVR0lBAwwCgYIKwYBBQUHAwEwFwYDVR0R
		BBAwDoIMdW1icmVsLmxvY2FsMB0GA1UdDgQWBBSz6sHbyFboSt1TzxMON5fXXQR4
		1jAfBgNVHSMEGDAWgBSn7migp0hekDh832w+rwmUdWoNRTAKBggqhkjOPQQDAgNJ
		ADBGAiEAjj4NQ+0CLa2uvizWXYBMiOUtAtuxngKiyRPIlpxxBKUCIQCp4srv0K0T
		YYSXJg6LC6OAciNRv+z+X2yBrvS9haEWUw==
		-----END CERTIFICATE-----
		"""

	// Issued by the first CA, valid only during 2020.
	private let testUmbrelExpiredLeafPEM = """
		-----BEGIN CERTIFICATE-----
		MIIBxDCCAWqgAwIBAgIUF2+YiB5iZSttaTbZAFx9vtl9OEswCgYIKoZIzj0EAwIw
		GzEZMBcGA1UEAwwQVGVzdCBVbWJyZWwgQ0EgQTAeFw0yMDAxMDEwMDAwMDBaFw0y
		MTAxMDEwMDAwMDBaMBcxFTATBgNVBAMMDHVtYnJlbC5sb2NhbDBZMBMGByqGSM49
		AgEGCCqGSM49AwEHA0IABGk8k3HpLTmfv3CYb2kDaSUOPXKNnUCh3OV/jt9mlPNr
		QH+bkeVJ/ljECLWWbFXpX+gBZQg3TRpeLuAeHWirC7SjgY8wgYwwDAYDVR0TAQH/
		BAIwADAOBgNVHQ8BAf8EBAMCB4AwEwYDVR0lBAwwCgYIKwYBBQUHAwEwFwYDVR0R
		BBAwDoIMdW1icmVsLmxvY2FsMB0GA1UdDgQWBBRSheO05v59BuYKW4ikJY9ek6NR
		qDAfBgNVHSMEGDAWgBSn7migp0hekDh832w+rwmUdWoNRTAKBggqhkjOPQQDAgNI
		ADBFAiBeUz7LPOpeMXefBO2bhrt30wyJBfkaTgmfMhdRholVFQIhANWPwDDv7A/J
		0Qv5UaRfD/gzZnFpVyxnPpNB0i9w7QJF
		-----END CERTIFICATE-----
		"""

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

// Only the system can attach a server trust to a protection space, so supply it here.
private final class ServerTrustProtectionSpace: URLProtectionSpace, @unchecked Sendable {
	private let trust: SecTrust

	init(host: String, trust: SecTrust) {
		self.trust = trust
		super.init(
			host: host,
			port: 443,
			protocol: NSURLProtectionSpaceHTTPS,
			realm: nil,
			authenticationMethod: NSURLAuthenticationMethodServerTrust)
	}

	required init?(coder: NSCoder) { nil }

	override var serverTrust: SecTrust? { trust }
}

private final class UnansweredChallengeSender: NSObject, URLAuthenticationChallengeSender {
	func use(_ credential: URLCredential, for challenge: URLAuthenticationChallenge) {}
	func continueWithoutCredential(for challenge: URLAuthenticationChallenge) {}
	func cancel(_ challenge: URLAuthenticationChallenge) {}
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
