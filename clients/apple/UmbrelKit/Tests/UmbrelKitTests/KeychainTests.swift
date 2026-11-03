import Foundation
import Security
import XCTest
@testable import UmbrelKit

final class KeychainTests: XCTestCase {
	func testExplicitClaimCanReplaceAStaleUnsavedCA() throws {
		let deviceId = "keychain-test-\(UUID().uuidString)"
		let staleCertificate = Data("stale-candidate".utf8)
		let selectedCertificate = Data("explicitly-selected-candidate".utf8)
		defer { Keychain.deleteLocalHTTPSCA(deviceId: deviceId) }

		let initialEnrollment = Keychain.storeLocalHTTPSCAIfAbsent(
			staleCertificate,
			deviceId: deviceId
		)
		if initialEnrollment == .unavailable(status: Int32(errSecMissingEntitlement)) {
			throw XCTSkip("The standalone SwiftPM test runner has no Data Protection Keychain entitlement")
		}
		XCTAssertEqual(
			initialEnrollment,
			.stored
		)
		// Ordinary enrollment remains write-once; only the explicit unsaved-device
		// claim path below is permitted to recover this stale identity.
		XCTAssertEqual(
			Keychain.storeLocalHTTPSCAIfAbsent(selectedCertificate, deviceId: deviceId),
			.conflicts
		)
		XCTAssertEqual(
			Keychain.replaceLocalHTTPSCA(selectedCertificate, deviceId: deviceId),
			.stored
		)
		XCTAssertEqual(
			Keychain.readLocalHTTPSCA(deviceId: deviceId),
			.found(selectedCertificate)
		)
	}

	func testMissingItemIsDefinitive() {
		guard case .missing = Keychain.classifySessionRead(status: errSecItemNotFound, data: nil) else {
			return XCTFail("Expected a missing session")
		}
	}

	func testTransientKeychainFailureIsNotMissing() {
		let transientStatus = OSStatus(-34_018)
		guard case .unavailable(let status, let cachedSession) = Keychain.classifySessionRead(
			status: transientStatus, data: nil)
		else {
			return XCTFail("Expected an unavailable Keychain")
		}
		XCTAssertEqual(status, transientStatus)
		XCTAssertNil(cachedSession)
	}

	func testTransientFailureCanRetainTheLastKnownSession() {
		let session = makeSession()
		let result = Keychain.SessionReadResult.unavailable(status: -34_018, cachedSession: session)

		XCTAssertEqual(result.session, session)
	}

	func testMalformedStoredSessionIsInvalid() {
		guard case .invalid = Keychain.classifySessionRead(status: errSecSuccess, data: Data("not-json".utf8)) else {
			return XCTFail("Expected an invalid stored session")
		}
	}

	func testValidStoredSessionIsReturned() throws {
		let session = makeSession()
		let data = try JSONEncoder().encode(session)

		guard case .found(let decoded) = Keychain.classifySessionRead(status: errSecSuccess, data: data) else {
			return XCTFail("Expected a stored session")
		}
		XCTAssertEqual(decoded, session)
	}

	func testStoredSessionWithoutAccountIdIsInvalid() throws {
		let data = try XCTUnwrap(
			"""
			{"deviceId":"device","accessToken":"access","accessExpiresAt":1,"deviceToken":"device-token"}
			""".data(using: .utf8)
		)

		guard case .invalid = Keychain.classifySessionRead(status: errSecSuccess, data: data) else {
			return XCTFail("Expected a session without an account id to be invalid")
		}
	}

	func testBrowserSessionRoundTripsAndIsReplacedInPlace() throws {
		let deviceId = "keychain-test-\(UUID().uuidString)"
		defer { Keychain.deleteBrowserSession(deviceId: deviceId) }
		try skipWithoutDataProtectionKeychain()
		let session = makeBrowserSession(deviceId: deviceId, accountId: "0", appCookie: "app-value")
		let replacement = makeBrowserSession(deviceId: deviceId, accountId: "0", appCookie: nil, dashboardToken: "next-token")

		XCTAssertTrue(Keychain.setBrowserSession(session))
		XCTAssertEqual(Keychain.readBrowserSession(deviceId: deviceId), session)
		XCTAssertTrue(Keychain.setBrowserSession(replacement))
		XCTAssertEqual(Keychain.readBrowserSession(deviceId: deviceId), replacement)

		Keychain.deleteBrowserSession(deviceId: deviceId)
		XCTAssertNil(Keychain.readBrowserSession(deviceId: deviceId))
	}

	// One browser session per Umbrel, whichever account signed in last. Reads don't filter
	// by account; the stored account id is what lets a caller refuse another account's session.
	func testBrowserSessionIsKeptPerUmbrelNotPerAccount() throws {
		let deviceId = "keychain-test-\(UUID().uuidString)"
		let otherDeviceId = "keychain-test-\(UUID().uuidString)"
		defer {
			Keychain.deleteBrowserSession(deviceId: deviceId)
			Keychain.deleteBrowserSession(deviceId: otherDeviceId)
		}
		try skipWithoutDataProtectionKeychain()
		let firstAccount = makeBrowserSession(deviceId: deviceId, accountId: "0", appCookie: "app-value")
		let secondAccount = makeBrowserSession(
			deviceId: deviceId, accountId: "1", appCookie: nil, dashboardToken: "second-account-token")
		let otherUmbrel = makeBrowserSession(deviceId: otherDeviceId, accountId: "0", appCookie: nil)

		XCTAssertTrue(Keychain.setBrowserSession(firstAccount))
		XCTAssertTrue(Keychain.setBrowserSession(otherUmbrel))
		XCTAssertEqual(Keychain.readBrowserSession(deviceId: deviceId)?.accountId, "0")
		XCTAssertTrue(Keychain.setBrowserSession(secondAccount))

		XCTAssertEqual(Keychain.readBrowserSession(deviceId: deviceId), secondAccount)
		XCTAssertEqual(Keychain.readBrowserSession(deviceId: otherDeviceId), otherUmbrel)
		Keychain.deleteBrowserSession(deviceId: deviceId)
		XCTAssertEqual(Keychain.readBrowserSession(deviceId: otherDeviceId), otherUmbrel)
	}

	func testDeletingTheBrowserSessionKeepsTheNativeSession() throws {
		let deviceId = "keychain-test-\(UUID().uuidString)"
		defer {
			Keychain.deleteBrowserSession(deviceId: deviceId)
			Keychain.deleteSession(deviceId: deviceId)
		}
		try skipWithoutDataProtectionKeychain()
		let nativeSession = Umbreld.Session(
			deviceId: deviceId,
			accountId: "0",
			accessToken: "access",
			accessExpiresAt: 1,
			deviceToken: "device-token")

		XCTAssertTrue(Keychain.setSession(nativeSession, deviceId: deviceId))
		XCTAssertTrue(Keychain.setBrowserSession(makeBrowserSession(deviceId: deviceId, accountId: "0", appCookie: nil)))
		Keychain.deleteBrowserSession(deviceId: deviceId)

		XCTAssertNil(Keychain.readBrowserSession(deviceId: deviceId))
		guard case .found(let stored) = Keychain.readSession(deviceId: deviceId) else {
			return XCTFail("Expected the native session to remain")
		}
		XCTAssertEqual(stored, nativeSession)
	}

	// The browser-session calls don't report a Keychain status, so probe with the call
	// testExplicitClaimCanReplaceAStaleUnsavedCA skips on.
	private func skipWithoutDataProtectionKeychain() throws {
		let probeDeviceId = "keychain-test-\(UUID().uuidString)"
		defer { Keychain.deleteLocalHTTPSCA(deviceId: probeDeviceId) }
		let enrollment = Keychain.storeLocalHTTPSCAIfAbsent(Data("entitlement-probe".utf8), deviceId: probeDeviceId)
		if enrollment == .unavailable(status: Int32(errSecMissingEntitlement)) {
			throw XCTSkip("The standalone SwiftPM test runner has no Data Protection Keychain entitlement")
		}
	}

	private func makeBrowserSession(
		deviceId: String,
		accountId: String,
		appCookie: String?,
		dashboardToken: String = "dashboard-token"
	) -> Umbreld.BrowserSession {
		Umbreld.BrowserSession(
			deviceId: deviceId,
			accountId: accountId,
			dashboardToken: dashboardToken,
			browserCookie: "browser-value",
			appCookie: appCookie)
	}

	private func makeSession() -> Umbreld.Session {
		Umbreld.Session(
			deviceId: "device",
			accountId: "0",
			accessToken: "access",
			accessExpiresAt: 1,
			deviceToken: "device-token")
	}
}
