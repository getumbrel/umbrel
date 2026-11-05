import CryptoKit
import Foundation

// The in-app browser shows umbrelOS and its apps exactly as a browser would, so it
// needs the credentials umbrelOS gives a browser: a dashboard token plus two
// host-scoped cookies. A native session deliberately cannot stand in for them.
//
// These are obtained once, alongside the native sign-in, and replayed into the web
// view for whichever of the Umbrel's addresses is reachable. umbrelOS never rotates
// them; it only slides their expiry while the session is in use.
extension Umbreld {
	public struct BrowserSession: Codable, Sendable, Equatable {
		public static let browserCookieName = "__Host-UMBREL_BROWSER_SESSION_HTTPS"
		public static let appCookieName = "__Host-UMBREL_APP_SESSION_HTTPS"
		public static let tokenStorageKey = "umbrel-auth-token"

		public let deviceId: String
		public let accountId: String
		public let dashboardToken: String
		// Cookie values are kept exactly as umbrelOS issued them.
		public let browserCookie: String
		public let appCookie: String?

		public init(
			deviceId: String,
			accountId: String,
			dashboardToken: String,
			browserCookie: String,
			appCookie: String?
		) {
			self.deviceId = deviceId
			self.accountId = accountId
			self.dashboardToken = dashboardToken
			self.browserCookie = browserCookie
			self.appCookie = appCookie
		}

		// Identifies this login to a web page without revealing any credential.
		public var fingerprint: String {
			SHA256.hash(data: Data(dashboardToken.utf8)).prefix(8)
				.map { String(format: "%02x", $0) }.joined()
		}

		// Host-only, Secure, HttpOnly cookies equivalent to the ones umbrelOS sets at
		// login. The in-app browser only ever loads an Umbrel over HTTPS.
		public func cookies(forHost host: String) -> [HTTPCookie] {
			guard let url = URL(string: "https://\(host)/") else { return [] }
			let pairs = [(Self.browserCookieName, browserCookie)]
				+ (appCookie.map { [(Self.appCookieName, $0)] } ?? [])
			return pairs.flatMap { name, value in
				HTTPCookie.cookies(
					withResponseHeaderFields: [
						"Set-Cookie": "\(name)=\(value); Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax"
					],
					for: url)
			}
		}

		fileprivate var cookieHeader: String {
			([(Self.browserCookieName, browserCookie)] + (appCookie.map { [(Self.appCookieName, $0)] } ?? []))
				.map { "\($0)=\($1)" }
				.joined(separator: "; ")
		}
	}

	public enum BrowserSessionStatus: Sendable {
		case valid
		// umbrelOS no longer accepts these credentials.
		case invalid
		// The Umbrel couldn't be asked; nothing was learned.
		case unknown
	}

	private struct BrowserLoginInput: Encodable {
		let userId: String
		let password: String
		let totpToken: String?
	}

	// umbrelOS labels this login in the account's session list by its user agent. The
	// in-app browser ends its own with the same token, so both show as this app.
	private static var browserUserAgent: String {
		"UmbrelApp/\(NativeClient.current.appVersion)"
	}

	public static func loginBrowser(
		target: Target,
		userId: String,
		password: String,
		totpToken: String?
	) async throws -> BrowserSession {
		let body = try JSONEncoder().encode(
			BrowserLoginInput(userId: userId, password: password, totpToken: totpToken))
		return try await withResolvedHost(for: target, replay: .never) { host in
			let (data, response) = try await performRequestRaw(
				host: host,
				path: "user.login",
				method: "POST",
				deviceId: target.deviceId,
				accessToken: nil,
				userAgent: browserUserAgent,
				body: body,
				timeout: 10)
			let dashboardToken: String = try decodeEnvelope(
				data: data, status: response.statusCode, path: "user.login")
			let cookies = issuedCookies(in: response)
			guard let browserCookie = cookies[BrowserSession.browserCookieName] else {
				throw Error(status: 0, message: "user.login: missing browser session", kind: .protocolFailure)
			}
			return BrowserSession(
				deviceId: target.deviceId,
				accountId: userId,
				dashboardToken: dashboardToken,
				browserCookie: browserCookie,
				appCookie: cookies[BrowserSession.appCookieName])
		}
	}

	// Extends the session's sliding expiry, which also proves it is still accepted.
	public static func renewBrowserSession(
		target: Target,
		session: BrowserSession
	) async -> BrowserSessionStatus {
		do {
			let status = try await browserSessionRequest(
				target: target, session: session, path: "user.renewToken", replay: .safe)
			switch status {
			case 200: return .valid
			case 401, 403: return .invalid
			default: return .unknown
			}
		} catch {
			return .unknown
		}
	}

	// The account umbrelOS signs in with exactly these credentials. Nil when it doesn't
	// accept them as one session, or couldn't be asked.
	public static func browserSessionAccountId(target: Target, session: BrowserSession) async -> String? {
		do {
			return try await withResolvedHost(for: target, replay: .safe) { host in
				let (data, response) = try await performRequestRaw(
					host: host,
					path: "user.get",
					method: "GET",
					deviceId: target.deviceId,
					accessToken: session.dashboardToken,
					cookieHeader: session.cookieHeader,
					userAgent: browserUserAgent,
					body: nil,
					timeout: 10)
				let user: UserInfo = try decodeEnvelope(data: data, status: response.statusCode, path: "user.get")
				return user.userId
			}
		} catch {
			return nil
		}
	}

	public static func logoutBrowser(target: Target, session: BrowserSession) async throws {
		_ = try await browserSessionRequest(
			target: target, session: session, path: "user.logout", replay: .never)
	}

	private static func browserSessionRequest(
		target: Target,
		session: BrowserSession,
		path: String,
		replay: ReplayPolicy
	) async throws -> Int {
		let body = try JSONEncoder().encode(EmptyInput())
		return try await withResolvedHost(for: target, replay: replay) { host in
			try await performRequestRaw(
				host: host,
				path: path,
				method: "POST",
				deviceId: target.deviceId,
				accessToken: session.dashboardToken,
				cookieHeader: session.cookieHeader,
				userAgent: browserUserAgent,
				body: body,
				timeout: 10
			).1.statusCode
		}
	}

	static func issuedCookies(in response: HTTPURLResponse) -> [String: String] {
		guard let url = response.url else { return [:] }
		var headers: [String: String] = [:]
		for (name, value) in response.allHeaderFields {
			if let name = name as? String, let value = value as? String { headers[name] = value }
		}
		return Dictionary(
			HTTPCookie.cookies(withResponseHeaderFields: headers, for: url).map { ($0.name, $0.value) },
			uniquingKeysWith: { _, latest in latest })
	}

	// Lets a web view extend the same pinned trust the native API uses: the Umbrel's
	// own CA, valid only for this Umbrel, evaluated for the exact host being loaded.
	public static func localHTTPSCredential(
		for challenge: URLAuthenticationChallenge,
		deviceId: String
	) -> URLCredential? {
		LocalHTTPSTransport.credential(for: challenge, deviceId: deviceId)
	}

	// After the pinned CA refused a connection: whether the server presented a different
	// certificate authority altogether, as it does after the Umbrel or its certificate
	// is reset.
	public static func localHTTPSIdentityDiffers(
		for challenge: URLAuthenticationChallenge,
		deviceId: String
	) -> Bool {
		LocalHTTPSTransport.identityDiffers(for: challenge, deviceId: deviceId)
	}
}
