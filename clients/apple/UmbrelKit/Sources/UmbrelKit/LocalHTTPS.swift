import Foundation
import os
import Security

enum LocalHTTPSTransportError: LocalizedError, Equatable {
	case notEnrolled
	case invalidCertificate
	case identityChanged
	case storageUnavailable
	case trustFailed

	var errorDescription: String? {
		switch self {
		case .notEnrolled:
			return "This Umbrel has not established a secure connection yet"
		case .invalidCertificate:
			return "This Umbrel returned an invalid security certificate"
		case .identityChanged:
			return "Can’t confirm this is your Umbrel. Its security identity changed"
		case .storageUnavailable:
			return "Secure connection storage is temporarily unavailable"
		case .trustFailed:
			return "Couldn’t verify this Umbrel’s secure connection"
		}
	}
}

// UmbrelKit trusts one device-local CA per Umbrel. The trust applies only to the
// URLSession evaluating that Umbrel; it is never installed as a system-wide root.
// Apple still evaluates the complete TLS chain, certificate lifetime and server usage
// through SecPolicyCreateSSL, but not the address (see evaluateServerTrust).
enum LocalHTTPSTransport {
	private static let sessions = LocalHTTPSSessionPool()
	private static let bootstrapResponseMaximumBytes = 64 * 1_024
	private static let candidateResponseMaximumBytes = 64 * 1_024

	private static let bootstrapSession: URLSession = {
		let configuration = URLSessionConfiguration.ephemeral
		configuration.timeoutIntervalForRequest = 10
		configuration.timeoutIntervalForResource = 10
		configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
		configuration.urlCache = nil
		configuration.httpShouldSetCookies = false
		configuration.httpCookieStorage = nil
		configuration.urlCredentialStorage = nil
		return URLSession(configuration: configuration, delegate: NoRedirectDelegate(), delegateQueue: nil)
	}()

	// Legacy discovery asks a handful of untrusted LAN hosts for one tiny JSON value.
	// Keep it separate from enrollment: a hard resource deadline prevents trickled
	// responses from outliving the scan, while streaming enforces the body limit before
	// Foundation buffers an arbitrary response in memory.
	private static let fallbackDiscoverySession: URLSession = {
		let configuration = URLSessionConfiguration.ephemeral
		configuration.timeoutIntervalForRequest = 2
		configuration.timeoutIntervalForResource = 2
		configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
		configuration.urlCache = nil
		configuration.httpShouldSetCookies = false
		configuration.httpCookieStorage = nil
		configuration.urlCredentialStorage = nil
		return URLSession(configuration: configuration, delegate: NoRedirectDelegate(), delegateQueue: nil)
	}()

	static func bootstrapData(for request: URLRequest) async throws -> (Data, URLResponse) {
		try await boundedData(
			for: request,
			session: bootstrapSession,
			maximumBytes: bootstrapResponseMaximumBytes
		)
	}

	static func fallbackDiscoveryData(for request: URLRequest, maximumBytes: Int) async throws -> (Data, URLResponse) {
		try await boundedData(for: request, session: fallbackDiscoverySession, maximumBytes: maximumBytes)
	}

	// Internal so the streaming limit can be exercised with an isolated URLSession
	// in tests; production callers use the bootstrap and discovery wrappers above.
	static func boundedData(
		for request: URLRequest,
		session: URLSession,
		maximumBytes: Int,
		taskDelegate: URLSessionTaskDelegate? = nil
	) async throws -> (Data, URLResponse) {
		precondition(maximumBytes >= 0)
		let (bytes, response) = if let taskDelegate {
			try await session.bytes(for: request, delegate: taskDelegate)
		} else {
			try await session.bytes(for: request)
		}
		defer { bytes.task.cancel() }
		guard response.expectedContentLength <= Int64(maximumBytes) else {
			throw URLError(.dataLengthExceedsMaximum)
		}

		var data = Data()
		data.reserveCapacity(min(maximumBytes, max(0, Int(response.expectedContentLength))))
		for try await byte in bytes {
			guard data.count < maximumBytes else {
				throw URLError(.dataLengthExceedsMaximum)
			}
			data.append(byte)
		}
		return (data, response)
	}

	static func data(for request: URLRequest, deviceId: String) async throws -> (Data, URLResponse) {
		try await sessions.data(for: request, deviceId: deviceId)
	}

	// The body streams from the file, so a long video never has to fit in memory
	static func upload(
		for request: URLRequest,
		fromFile fileURL: URL,
		deviceId: String
	) async throws -> (Data, URLResponse) {
		try await sessions.upload(for: request, fromFile: fileURL, deviceId: deviceId)
	}

	// Candidate anchors remain in memory until the live HTTPS endpoint proves both
	// possession of the corresponding private key and the same discovery id.
	static func data(for request: URLRequest, candidateCertificate: Data) async throws -> (Data, URLResponse) {
		guard let host = request.url?.host,
			let anchor = SecCertificateCreateWithData(nil, candidateCertificate as CFData)
		else { throw LocalHTTPSTransportError.invalidCertificate }

		let delegate = LocalHTTPSSessionDelegate(expectedHost: host, anchor: anchor)
		let configuration = secureConfiguration()
		configuration.timeoutIntervalForResource = request.timeoutInterval
		let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
		defer { session.finishTasksAndInvalidate() }
		// The async byte-stream task needs the delegate explicitly to deliver the
		// custom server-trust challenge while enforcing the response-size limit.
		return try await boundedData(
			for: request,
			session: session,
			maximumBytes: candidateResponseMaximumBytes,
			taskDelegate: delegate
		)
	}

	static func certificateData(fromPEM pem: String) throws -> Data {
		let body = pem
			.replacingOccurrences(of: "-----BEGIN CERTIFICATE-----", with: "")
			.replacingOccurrences(of: "-----END CERTIFICATE-----", with: "")
			.components(separatedBy: .whitespacesAndNewlines)
			.joined()
		guard !body.isEmpty,
			let decoded = Data(base64Encoded: body),
			let certificate = SecCertificateCreateWithData(nil, decoded as CFData)
		else { throw LocalHTTPSTransportError.invalidCertificate }
		return SecCertificateCopyData(certificate) as Data
	}

	static func enroll(
		certificate: Data,
		deviceId: String,
		replacingExisting: Bool = false
	) async -> Keychain.LocalHTTPSCAStoreResult {
		let result = replacingExisting
			? Keychain.replaceLocalHTTPSCA(certificate, deviceId: deviceId)
			: Keychain.storeLocalHTTPSCAIfAbsent(certificate, deviceId: deviceId)
		// A previous build may already have constructed a session from a passively
		// enrolled CA. Drop every cached session after an explicit claim so subsequent
		// requests can only use the newly selected identity.
		if replacingExisting, result == .stored {
			await sessions.remove(deviceId: deviceId)
		}
		return result
	}

	static func credential(for challenge: URLAuthenticationChallenge, deviceId: String) -> URLCredential? {
		let space = challenge.protectionSpace
		guard space.authenticationMethod == NSURLAuthenticationMethodServerTrust,
			let trust = space.serverTrust,
			case .found(let certificate) = Keychain.readLocalHTTPSCA(deviceId: deviceId),
			let anchor = SecCertificateCreateWithData(nil, certificate as CFData),
			evaluateServerTrust(trust, anchor: anchor)
		else { return nil }
		return URLCredential(trust: trust)
	}

	// For a server the pinned CA refused: whether its certificate wasn't issued by this
	// Umbrel's CA at all, which is what a reset certificate or a reset Umbrel looks like,
	// as opposed to the right certificate reached at an address it doesn't name. Ask it
	// after credential(for:) refused the same challenge: that evaluation against the pin
	// is what puts this Umbrel's CA into the chain of a certificate it issued.
	static func identityDiffers(for challenge: URLAuthenticationChallenge, deviceId: String) -> Bool {
		guard let trust = challenge.protectionSpace.serverTrust,
			let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate], !chain.isEmpty,
			case .found(let certificate) = Keychain.readLocalHTTPSCA(deviceId: deviceId),
			let anchor = SecCertificateCreateWithData(nil, certificate as CFData)
		else { return false }
		return !isIssued(by: anchor, chain: chain)
	}

	static func forget(deviceId: String) async {
		Keychain.deleteLocalHTTPSCA(deviceId: deviceId)
		await sessions.remove(deviceId: deviceId)
	}

	fileprivate static func secureConfiguration() -> URLSessionConfiguration {
		let configuration = URLSessionConfiguration.ephemeral
		configuration.timeoutIntervalForRequest = 10
		configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
		configuration.urlCache = nil
		configuration.httpShouldSetCookies = false
		configuration.httpCookieStorage = nil
		configuration.urlCredentialStorage = nil
		return configuration
	}
}

private actor LocalHTTPSSessionPool {
	private struct Key: Hashable {
		let deviceId: String
		let host: String
	}

	private struct Entry {
		let session: URLSession
		// URLSession retains its delegate until invalidation. Keeping it here as well
		// makes that lifetime explicit and prevents future refactors from weakening it.
		let delegate: LocalHTTPSSessionDelegate
	}

	private var entries: [Key: Entry] = [:]

	func data(for request: URLRequest, deviceId: String) async throws -> (Data, URLResponse) {
		guard let host = request.url?.host else { throw LocalHTTPSTransportError.trustFailed }
		let key = Key(deviceId: deviceId, host: normalizedHost(host))
		let entry = try entry(for: key)
		let started = ContinuousClock.now
		do {
			return try await entry.session.data(for: request)
		} catch let error as URLError where error.code == .cancelled {
			// URLSession reports a refused handshake only as a cancelled request. Say why
			// it was refused when that happened during this request.
			throw entry.delegate.refusal(since: started) ?? error
		}
	}

	func upload(
		for request: URLRequest,
		fromFile fileURL: URL,
		deviceId: String
	) async throws -> (Data, URLResponse) {
		guard let host = request.url?.host else { throw LocalHTTPSTransportError.trustFailed }
		let entry = try entry(for: Key(deviceId: deviceId, host: normalizedHost(host)))
		let started = ContinuousClock.now
		do {
			return try await entry.session.upload(for: request, fromFile: fileURL)
		} catch let error as URLError where error.code == .cancelled {
			throw entry.delegate.refusal(since: started) ?? error
		}
	}

	func remove(deviceId: String) {
		let keys = entries.keys.filter { $0.deviceId == deviceId }
		for key in keys {
			entries[key]?.session.invalidateAndCancel()
			entries[key] = nil
		}
	}

	private func entry(for key: Key) throws -> Entry {
		if let existing = entries[key] { return existing }

		let certificateData: Data
		switch Keychain.readLocalHTTPSCA(deviceId: key.deviceId) {
		case .found(let data):
			certificateData = data
		case .missing:
			throw LocalHTTPSTransportError.notEnrolled
		case .unavailable:
			throw LocalHTTPSTransportError.storageUnavailable
		}
		guard let anchor = SecCertificateCreateWithData(nil, certificateData as CFData) else {
			throw LocalHTTPSTransportError.invalidCertificate
		}

		let delegate = LocalHTTPSSessionDelegate(expectedHost: key.host, anchor: anchor)
		let session = URLSession(
			configuration: LocalHTTPSTransport.secureConfiguration(),
			delegate: delegate,
			delegateQueue: nil)
		let entry = Entry(session: session, delegate: delegate)
		entries[key] = entry
		return entry
	}
}

private final class NoRedirectDelegate: NSObject, URLSessionTaskDelegate {
	func urlSession(
		_ session: URLSession,
		task: URLSessionTask,
		willPerformHTTPRedirection response: HTTPURLResponse,
		newRequest request: URLRequest,
		completionHandler: @escaping (URLRequest?) -> Void
	) {
		completionHandler(nil)
	}
}

private final class LocalHTTPSSessionDelegate: NSObject, URLSessionDelegate, URLSessionTaskDelegate {
	private let expectedHost: String
	private let anchor: SecCertificate
	private let lastRefusal = OSAllocatedUnfairLock<(error: LocalHTTPSTransportError, at: ContinuousClock.Instant)?>(
		initialState: nil)

	init(expectedHost: String, anchor: SecCertificate) {
		self.expectedHost = normalizedHost(expectedHost)
		self.anchor = anchor
	}

	func urlSession(
		_ session: URLSession,
		didReceive challenge: URLAuthenticationChallenge,
		completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
	) {
		let protectionSpace = challenge.protectionSpace
		guard protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust else {
			completionHandler(.performDefaultHandling, nil)
			return
		}
		guard normalizedHost(protectionSpace.host) == expectedHost,
			let trust = protectionSpace.serverTrust,
			evaluateServerTrust(trust, anchor: anchor)
		else {
			// A certificate this Umbrel's CA didn't issue is a different identity, as after
			// the Umbrel or its certificate is reset. Anything else is a failed check.
			let chain = protectionSpace.serverTrust.flatMap { SecTrustCopyCertificateChain($0) as? [SecCertificate] }
			let error: LocalHTTPSTransportError = chain.map { !$0.isEmpty && !isIssued(by: anchor, chain: $0) } == true
				? .identityChanged : .trustFailed
			lastRefusal.withLock { $0 = (error, .now) }
			completionHandler(.cancelAuthenticationChallenge, nil)
			return
		}
		lastRefusal.withLock { $0 = nil }
		completionHandler(.useCredential, URLCredential(trust: trust))
	}

	func refusal(since start: ContinuousClock.Instant) -> LocalHTTPSTransportError? {
		lastRefusal.withLock { refusal in
			guard let refusal, refusal.at >= start else { return nil }
			return refusal.error
		}
	}

	func urlSession(
		_ session: URLSession,
		task: URLSessionTask,
		willPerformHTTPRedirection response: HTTPURLResponse,
		newRequest request: URLRequest,
		completionHandler: @escaping (URLRequest?) -> Void
	) {
		// API requests can carry native access credentials. Never forward them to a
		// redirected origin, even if that origin presents a certificate from the CA.
		completionHandler(nil)
	}
}

private func normalizedHost(_ host: String) -> String {
	host.hasSuffix(".") ? String(host.dropLast()).lowercased() : host.lowercased()
}

// Whether a refused server's certificate came from this anchor, however else it failed:
// the wrong address, or dates a wrong clock disagrees with. `chain` is the one the trust
// evaluation built, which ends at the anchor whenever the anchor issued the certificate.
func isIssued(by anchor: SecCertificate, chain: [SecCertificate]) -> Bool {
	let anchorData = SecCertificateCopyData(anchor) as Data
	return chain.contains { SecCertificateCopyData($0) as Data == anchorData }
		|| chainsToAnchor(chain, anchor: anchor)
}

// Whether the certificates were issued by the anchor, whatever host they name.
func chainsToAnchor(_ certificates: [SecCertificate], anchor: SecCertificate) -> Bool {
	var trust: SecTrust?
	guard SecTrustCreateWithCertificates(certificates as CFArray, SecPolicyCreateBasicX509(), &trust) == errSecSuccess,
		let trust,
		SecTrustSetAnchorCertificates(trust, [anchor] as CFArray) == errSecSuccess,
		SecTrustSetAnchorCertificatesOnly(trust, true) == errSecSuccess
	else { return false }
	var error: CFError?
	return SecTrustEvaluateWithError(trust, &error)
}

// The anchor is the Umbrel's own CA, which signs only that Umbrel's server certificate,
// so the anchor alone proves identity. The certificate's names can lag behind the
// Umbrel's real addresses (e.g. a new Tailscale or DHCP address), so they aren't matched.
func evaluateServerTrust(_ trust: SecTrust, anchor: SecCertificate) -> Bool {
	let policy = SecPolicyCreateSSL(true, nil)
	guard SecTrustSetPolicies(trust, policy) == errSecSuccess,
		SecTrustSetAnchorCertificates(trust, [anchor] as CFArray) == errSecSuccess,
		SecTrustSetAnchorCertificatesOnly(trust, true) == errSecSuccess
	else { return false }
	var error: CFError?
	return SecTrustEvaluateWithError(trust, &error)
}
