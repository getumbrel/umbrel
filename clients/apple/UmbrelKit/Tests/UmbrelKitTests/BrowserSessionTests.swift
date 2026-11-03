import XCTest
@testable import UmbrelKit

final class BrowserSessionTests: XCTestCase {
	func testCookiesAreHostOnlySecureAndHiddenFromScripts() throws {
		let cookies = makeSession(appCookie: "app-value").cookies(forHost: "umbrel.local")

		XCTAssertEqual(
			Set(cookies.map(\.name)),
			[Umbreld.BrowserSession.browserCookieName, Umbreld.BrowserSession.appCookieName])
		for cookie in cookies {
			XCTAssertEqual(cookie.domain, "umbrel.local")
			XCTAssertEqual(cookie.path, "/")
			XCTAssertTrue(cookie.isSecure)
			XCTAssertTrue(cookie.isHTTPOnly)
			XCTAssertEqual(cookie.sameSitePolicy, .sameSiteLax)
			XCTAssertNotNil(cookie.expiresDate)
		}
		XCTAssertEqual(
			cookies.first { $0.name == Umbreld.BrowserSession.browserCookieName }?.value,
			"browser-value")
	}

	func testCookiesWorkForAddressLiterals() {
		let cookies = makeSession(appCookie: nil).cookies(forHost: "100.64.0.1")

		XCTAssertEqual(cookies.map(\.name), [Umbreld.BrowserSession.browserCookieName])
		XCTAssertEqual(cookies.first?.domain, "100.64.0.1")
	}

	func testFingerprintIdentifiesALoginWithoutRevealingItsToken() {
		let session = makeSession(appCookie: nil)
		let other = makeSession(appCookie: nil, dashboardToken: "another-token")

		XCTAssertEqual(session.fingerprint.count, 16)
		XCTAssertFalse(session.fingerprint.contains(session.dashboardToken))
		XCTAssertNotEqual(session.fingerprint, other.fingerprint)
	}

	// Pages compare the fingerprint across launches, and it's written into page script, so
	// it depends only on the token and stays plain hex.
	func testFingerprintIsStableForTheSameLogin() throws {
		let session = makeSession(appCookie: "app-value")
		let sameLogin = Umbreld.BrowserSession(
			deviceId: "other-umbrel",
			accountId: "1",
			dashboardToken: "dashboard-token",
			browserCookie: "renewed-browser-value",
			appCookie: nil)
		let decoded = try JSONDecoder().decode(
			Umbreld.BrowserSession.self, from: JSONEncoder().encode(session))

		XCTAssertEqual(session.fingerprint, "66e7ac6f0a868503")
		XCTAssertEqual(sameLogin.fingerprint, session.fingerprint)
		XCTAssertEqual(decoded.fingerprint, session.fingerprint)
	}

	func testCodableRoundTripKeepsEveryCredential() throws {
		let session = makeSession(appCookie: "app-value")

		let decoded = try JSONDecoder().decode(
			Umbreld.BrowserSession.self, from: JSONEncoder().encode(session))

		XCTAssertEqual(decoded, session)
		XCTAssertEqual(decoded.appCookie, "app-value")
	}

	func testCodableRoundTripKeepsAMissingAppCookieMissing() throws {
		let session = makeSession(appCookie: nil)

		let decoded = try JSONDecoder().decode(
			Umbreld.BrowserSession.self, from: JSONEncoder().encode(session))

		XCTAssertEqual(decoded, session)
		XCTAssertNil(decoded.appCookie)
	}

	// The Cookie header a request made with the installed cookies carries: each cookie
	// exactly as umbrelOS issued it, the app session only when there is one.
	func testInstalledCookiesSendBothSessionsExactlyAsIssued() {
		let withApp = makeSession(appCookie: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIwIn0.c2ln-_")
		let withoutApp = makeSession(appCookie: nil)

		XCTAssertEqual(
			HTTPCookie.requestHeaderFields(with: withApp.cookies(forHost: "umbrel.local"))["Cookie"],
			"__Host-UMBREL_BROWSER_SESSION_HTTPS=browser-value; __Host-UMBREL_APP_SESSION_HTTPS=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIwIn0.c2ln-_")
		XCTAssertEqual(
			HTTPCookie.requestHeaderFields(with: withoutApp.cookies(forHost: "umbrel.local"))["Cookie"],
			"__Host-UMBREL_BROWSER_SESSION_HTTPS=browser-value")
	}

	func testIssuedCookiesReadsBothSessionCookiesFromALoginResponse() throws {
		let url = try XCTUnwrap(URL(string: "https://umbrel.local/trpc/user.login"))
		let response = try XCTUnwrap(
			HTTPURLResponse(
				url: url,
				statusCode: 200,
				httpVersion: "HTTP/1.1",
				headerFields: [
					"Set-Cookie": "__Host-UMBREL_APP_SESSION_HTTPS=app-value; Path=/; Expires=Wed, 14 Oct 2026 10:00:00 GMT; HttpOnly; Secure; SameSite=Lax, __Host-UMBREL_BROWSER_SESSION_HTTPS=browser-value; Path=/; Expires=Wed, 14 Oct 2026 10:00:00 GMT; HttpOnly; Secure; SameSite=Lax"
				]))

		let cookies = Umbreld.issuedCookies(in: response)

		XCTAssertEqual(cookies[Umbreld.BrowserSession.browserCookieName], "browser-value")
		XCTAssertEqual(cookies[Umbreld.BrowserSession.appCookieName], "app-value")
	}

	private func makeSession(appCookie: String?, dashboardToken: String = "dashboard-token") -> Umbreld.BrowserSession {
		Umbreld.BrowserSession(
			deviceId: "umbrel",
			accountId: "0",
			dashboardToken: dashboardToken,
			browserCookie: "browser-value",
			appCookie: appCookie)
	}
}
