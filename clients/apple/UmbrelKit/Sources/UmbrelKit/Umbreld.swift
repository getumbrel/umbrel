import Foundation

// Minimal hand-written client for the umbreld tRPC endpoints the apps use. Wire shapes
// are declared as plain Codable structs rather than generated from the router. Calls are
// stateless statics taking (host, session) because the apps talk to several devices at once.
//
// umbreld runs tRPC without a transformer, so envelopes are plain JSON:
//   success: {"result": {"data": <value>}}
//   error:   {"error": {"message": "..."}}

public enum Umbreld {
	public struct Error: Swift.Error, LocalizedError {
		public enum Kind: Sendable {
			case server
			case connectivity
			case trust
			case storage
			case protocolFailure
		}

		public let status: Int
		public let message: String
		public let kind: Kind

		init(status: Int, message: String, kind: Kind = .server) {
			self.status = status
			self.message = message
			self.kind = kind
		}

		public var errorDescription: String? { message }
		public var isAuthError: Bool { status == 401 }
		public var isConnectivityFailure: Bool { kind == .connectivity }
		public var requiresTwoFactorAuthentication: Bool { message == "Missing 2FA code" }
	}

	// The stable device credential is stored in the Keychain and sent only to the
	// access exchange. Normal API calls carry the short-lived access credential.
	public struct Session: Codable, Sendable, Equatable {
		public let deviceId: String
		public let accountId: String
		public let accessToken: String
		public let accessExpiresAt: Int64
		public let deviceToken: String

		public init(
			deviceId: String,
			accountId: String,
			accessToken: String,
			accessExpiresAt: Int64,
			deviceToken: String
		) {
			self.deviceId = deviceId
			self.accountId = accountId
			self.accessToken = accessToken
			self.accessExpiresAt = accessExpiresAt
			self.deviceToken = deviceToken
		}

		// Access tokens rotate, but these fields identify one server-issued login.
		// They must all match before an async refresh may replace stored credentials.
		public func belongsToSameLogin(as other: Session) -> Bool {
			deviceId == other.deviceId
				&& accountId == other.accountId
				&& deviceToken == other.deviceToken
		}
	}

	public struct PhotoBackupGrant: Decodable, Sendable, Equatable {
		public let token: String
		public let source: PhotoBackupSource
	}

	public struct PhotoBackupResourceQuery: Encodable, Sendable, Equatable {
		public let resourceKey: String
		public let fileExtension: String

		public init(resourceKey: String, fileExtension: String) {
			self.resourceKey = resourceKey
			self.fileExtension = fileExtension
		}
	}

	public struct PhotoBackupResourceReceipt: Decodable, Sendable, Equatable {
		public let resourceKey: String
		public let bytes: Int64
	}

	public struct Wallpaper: Decodable, Sendable, Equatable {
		public let id: String
		public let brandColorHsl: String
	}

	public enum WallpaperImageRendition: Sendable {
		case large
		case medium
		case jpegFallback

		fileprivate func path(id: String) -> String {
			switch self {
			case .large:
				"/assets/wallpapers/generated-avif/large/\(id).avif"
			case .medium:
				"/assets/wallpapers/generated-avif/medium/\(id).avif"
			case .jpegFallback:
				"/assets/wallpapers/\(id).jpg"
			}
		}
	}

	public struct Account: Decodable, Identifiable, Sendable, Equatable {
		public let userId: String
		public let name: String
		public let wallpaper: Wallpaper
		// umbreld returns a same-origin, content-addressed path rather than a
		// standalone URL. Keeping that distinction prevents presentation data from
		// choosing a different network origin.
		public let avatarUrl: String?

		public var id: String { userId }
	}

	// Browser probes carry no credentials and never follow redirects. A candidate must
	// answer as the saved Umbrel itself before Safari is allowed to open it.
	private static let browserProbeSession: URLSession = {
		let config = URLSessionConfiguration.ephemeral
		config.timeoutIntervalForRequest = 10
		config.requestCachePolicy = .reloadIgnoringLocalCacheData
		config.urlCache = nil
		config.httpShouldSetCookies = false
		config.httpCookieStorage = nil
		config.urlCredentialStorage = nil
		return URLSession(
			configuration: config,
			delegate: UmbreldNoRedirectDelegate(),
			delegateQueue: nil)
	}()

	// Avatar paths include their content hash, so entries never need invalidation.
	// Keep only a small, evictable memory cache; account pickers do not need avatars
	// persisted independently from the Umbrel that serves them.
	private static let accountAvatarCache: NSCache<NSString, NSData> = {
		let cache = NSCache<NSString, NSData>()
		cache.countLimit = 64
		cache.totalCostLimit = 16 * 1_024 * 1_024
		return cache
	}()

	// ── Identity (the discovery oracle) ──
	// system.discoveryInfo is the authority for a device's id, model, and onboarding
	// state. mDNS only supplies candidate locations and display hints. The HTTP
	// bootstrap below carries no credentials and is accepted only after the advertised
	// CA proves the same identity over HTTPS.

	public struct DiscoveryInfo: Decodable, Sendable {
		public let id: String
		public let device: String
		public let onboarded: Bool
	}

	// A likely older device found through Umbrel's long-standing public version
	// endpoint. This is only an update hint: it is never trusted as an identity or
	// admitted to sign-in.
	public struct UpdateRequiredDevice: Equatable, Sendable {
		public let host: String
	}

	public enum ManualDiscoveryResult: Equatable, Sendable {
		case device(IdentifiedDevice)
		case updateRequired(UpdateRequiredDevice)
	}

	public enum ManualDiscoveryError: Swift.Error, LocalizedError, Equatable, Sendable {
		case invalidAddress
		case noDeviceFound

		public var errorDescription: String? {
			switch self {
			case .invalidAddress:
				"Enter a local or Tailscale IP address, .local hostname, or Tailscale MagicDNS name."
			case .noDeviceFound:
				"Couldn\u{2019}t find an Umbrel at this address. Make sure it\u{2019}s online and reachable."
			}
		}
	}

	enum ManualDiscoveryHost: Equatable, Sendable {
		case direct(String)
		case unqualifiedHostname(String)
		case tailscaleDNS(String)

		var value: String {
			switch self {
			case .direct(let host), .unqualifiedHostname(let host), .tailscaleDNS(let host): host
			}
		}
	}

	struct LocalHTTPSIdentity: Decodable {
		let id: String
		let caCertificate: String
	}

	private struct VerifiedLocalHTTPSCandidate {
		let discoveryInfo: DiscoveryInfo
		let certificate: Data
	}

	enum SavedIdentityRecoveryDecision: Equatable {
		case alreadyEnrolled
		case claim(host: String)
	}

	struct IdentityProbeResult: Sendable {
		let discoveryInfo: DiscoveryInfo
		// Present only for first-use verification. Saved-device probes validate with
		// the existing Keychain pin and therefore have no candidate anchor to claim.
		let candidateCertificate: Data?
	}

	// Passive discovery is deliberately read-only. HTTP carries only a candidate
	// public CA and discovery id; the candidate stays in memory long enough to prove
	// the same id over HTTPS, but opening the app never persists it to the Keychain.
	public static func identify(host: String, expectedDeviceId: String? = nil) async -> DiscoveryInfo? {
		try? await verifiedLocalHTTPSIdentity(
			host: host,
			expectedDeviceId: expectedDeviceId
		).discoveryInfo
	}

	private static func verifiedLocalHTTPSIdentity(
		host: String,
		expectedDeviceId: String?
	) async throws -> IdentityProbeResult {
		// A saved Umbrel must validate directly against its existing pin. With no
		// expected saved id, deliberately ignore any stale passive pin left by an older
		// development build so the real device can still appear and be claimed again.
		if let expectedDeviceId {
			switch Keychain.readLocalHTTPSCA(deviceId: expectedDeviceId) {
			case .found:
				let identity = try await discoveryInfoOverHTTPS(host: host, deviceId: expectedDeviceId)
				guard identity.id == expectedDeviceId else {
					throw LocalHTTPSTransportError.identityChanged
				}
				return IdentityProbeResult(
					discoveryInfo: identity,
					candidateCertificate: nil
				)
			case .missing:
				throw LocalHTTPSTransportError.notEnrolled
			case .unavailable:
				throw LocalHTTPSTransportError.storageUnavailable
			}
		}

		let candidate = try await verifiedFirstUseCandidate(
			host: host,
			expectedDeviceId: expectedDeviceId
		)
		return IdentityProbeResult(
			discoveryInfo: candidate.discoveryInfo,
			candidateCertificate: candidate.certificate
		)
	}

	private static func verifiedFirstUseCandidate(
		host: String,
		expectedDeviceId: String?
	) async throws -> VerifiedLocalHTTPSCandidate {
		let bootstrap = try await localHTTPSIdentity(host: host)
		if let expectedDeviceId, bootstrap.id != expectedDeviceId {
			throw LocalHTTPSTransportError.identityChanged
		}
		let candidate = try LocalHTTPSTransport.certificateData(fromPEM: bootstrap.caCertificate)
		let identity = try await discoveryInfoOverHTTPS(host: host, candidateCertificate: candidate)
		guard identity.id == bootstrap.id else { throw LocalHTTPSTransportError.identityChanged }
		return VerifiedLocalHTTPSCandidate(discoveryInfo: identity, certificate: candidate)
	}

	// Explicitly selecting an unsaved card establishes first-use trust. Re-verify the
	// exact endpoint with the candidate anchor held from that scan, then replace a stale
	// unsaved pin left by older passive-discovery builds. Saved devices never call this
	// API and retain write-once identity semantics.
	@discardableResult
	public static func claimLocalHTTPSIdentity(_ device: IdentifiedDevice) async throws -> DiscoveryInfo {
		guard let certificate = device.candidateCACertificate else {
			throw LocalHTTPSTransportError.identityChanged
		}
		let identity = try await discoveryInfoOverHTTPS(
			host: device.host,
			candidateCertificate: certificate
		)
		guard identity.id == device.id else { throw LocalHTTPSTransportError.identityChanged }
		switch await LocalHTTPSTransport.enroll(
			certificate: certificate,
			deviceId: device.id,
			replacingExisting: true
		) {
		case .stored, .alreadyMatches:
			return identity
		case .conflicts:
			// Replacement enrollment cannot conflict; preserve fail-closed behavior if
			// the storage implementation ever gains another outcome.
			throw LocalHTTPSTransportError.identityChanged
		case .unavailable:
			throw LocalHTTPSTransportError.storageUnavailable
		}
	}

	// A restored config can outlive both device-local Keychain items. Recover only
	// from an explicit sign-in, only when neither a pin nor a session exists, and only
	// through the saved primary LAN endpoint. The expected device id is proved before
	// the candidate CA is enrolled with the normal write-once path.
	@discardableResult
	public static func prepareSavedDeviceForSignIn(_ target: Target) async throws -> Bool {
		switch try savedIdentityRecoveryDecision(
			for: target,
			caRead: Keychain.readLocalHTTPSCA(deviceId: target.deviceId),
			sessionRead: Keychain.readSession(deviceId: target.deviceId)
		) {
		case .alreadyEnrolled:
			return false
		case .claim(let host):
			let candidate = try await verifiedFirstUseCandidate(
				host: host,
				expectedDeviceId: target.deviceId
			)

			// Re-check after the network operation. If another explicit flow installed a
			// pin, validate with that pin; never replace it from this recovery path.
			switch try savedIdentityRecoveryDecision(
				for: target,
				caRead: Keychain.readLocalHTTPSCA(deviceId: target.deviceId),
				sessionRead: Keychain.readSession(deviceId: target.deviceId)
			) {
			case .alreadyEnrolled:
				let identity = try await discoveryInfoOverHTTPS(
					host: host,
					deviceId: target.deviceId
				)
				guard identity.id == target.deviceId else {
					throw LocalHTTPSTransportError.identityChanged
				}
				return true
			case .claim:
				break
			}

			switch await LocalHTTPSTransport.enroll(
				certificate: candidate.certificate,
				deviceId: target.deviceId
			) {
			case .stored, .alreadyMatches:
				return true
			case .conflicts:
				throw LocalHTTPSTransportError.identityChanged
			case .unavailable:
				throw LocalHTTPSTransportError.storageUnavailable
			}
		}
	}

	static func savedIdentityRecoveryDecision(
		for target: Target,
		caRead: Keychain.LocalHTTPSCAReadResult,
		sessionRead: Keychain.SessionReadResult
	) throws -> SavedIdentityRecoveryDecision {
		switch caRead {
		case .found:
			return .alreadyEnrolled
		case .unavailable:
			throw LocalHTTPSTransportError.storageUnavailable
		case .missing:
			break
		}

		switch sessionRead {
		case .missing:
			break
		case .unavailable:
			throw LocalHTTPSTransportError.storageUnavailable
		case .found, .invalid:
			throw LocalHTTPSTransportError.notEnrolled
		}

		guard let host = target.hosts.first,
			SavedDevice.isValidLocalEndpointHost(host),
			!SavedDevice.isTailscaleAddress(host)
		else { throw LocalHTTPSTransportError.trustFailed }
		return .claim(host: host)
	}

	private static func localHTTPSIdentity(host: String) async throws -> LocalHTTPSIdentity {
		guard let url = URL(string: "http://\(host)/trpc/system.localHttpsIdentity") else {
			throw Umbreld.Error(status: 0, message: "Invalid host: \(host)")
		}
		var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: probeTimeout)
		request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
		let (data, response) = try await LocalHTTPSTransport.bootstrapData(for: request)
		guard let response = response as? HTTPURLResponse else {
			throw Umbreld.Error(status: 0, message: "system.localHttpsIdentity: unexpected response")
		}
		return try decodeEnvelope(
			data: data,
			status: response.statusCode,
			path: "system.localHttpsIdentity")
	}

	private static func discoveryInfoOverHTTPS(host: String, deviceId: String) async throws -> DiscoveryInfo {
		let request = try httpsRequest(host: host, path: "system.discoveryInfo", timeout: probeTimeout)
		let (data, response) = try await LocalHTTPSTransport.data(for: request, deviceId: deviceId)
		return try decodeDiscoveryInfo(data: data, response: response)
	}

	private static func discoveryInfoOverHTTPS(host: String, candidateCertificate: Data) async throws -> DiscoveryInfo {
		let request = try httpsRequest(host: host, path: "system.discoveryInfo", timeout: probeTimeout)
		let (data, response) = try await LocalHTTPSTransport.data(
			for: request,
			candidateCertificate: candidateCertificate)
		return try decodeDiscoveryInfo(data: data, response: response)
	}

	// A read-only availability check for addresses already learned from a saved Umbrel.
	// Every route, including a 100.64/10 address, must validate against the existing CA
	// pin. An address class alone does not prove that packets traversed Tailscale.
	public static func isKnownEndpointAvailable(host: String, deviceId: String) async -> Bool {
		do {
			guard case .found = Keychain.readLocalHTTPSCA(deviceId: deviceId) else { return false }
			let identity = try await discoveryInfoOverHTTPS(host: host, deviceId: deviceId)
			return identity.id == deviceId
		} catch {
			return false
		}
	}

	private static func decodeDiscoveryInfo(data: Data, response: URLResponse) throws -> DiscoveryInfo {
		guard let response = response as? HTTPURLResponse else {
			throw Umbreld.Error(status: 0, message: "system.discoveryInfo: unexpected response")
		}
		return try decodeEnvelope(data: data, status: response.statusCode, path: "system.discoveryInfo")
	}

	// Resolve a candidate through its hostname first, then its advertised IPv4
	// addresses. Retaining the exact endpoint that answered ensures login happens
	// against the same host whose authoritative identity the app displayed.
	public static func identify(candidate: Candidate) async -> IdentifiedDevice? {
		await identifyCandidate(candidate, knownDeviceIds: [])
	}

	// Refresh a saved device through a newly advertised Bonjour route. Unlike first-time
	// pairing, this requires the existing CA pin before trying alternate locations; a
	// LAN peer can't claim a known discovery id and move the app's trust anchor.
	public static func identify(
		candidate: Candidate,
		expectedDeviceId: String
	) async -> IdentifiedDevice? {
		guard case .found = Keychain.readLocalHTTPSCA(deviceId: expectedDeviceId) else { return nil }
		return await identifyCandidate(
			candidate,
			knownDeviceIds: [expectedDeviceId],
			requiredDeviceId: expectedDeviceId
		)
	}

	typealias IdentityProbe = @Sendable (String, String?) async -> IdentityProbeResult?

	// The TXT id is only an optimization. A candidate claiming a saved id is probed
	// with that pin immediately; if an unhinted candidate later returns a saved id,
	// repeat the probe with the saved pin before admitting it. Unsaved ids deliberately
	// use first-use verification even if an obsolete passive pin exists in Keychain.
	static func identifyCandidate(
		_ candidate: Candidate,
		knownDeviceIds: Set<String>,
		requiredDeviceId: String? = nil,
		allowsTailscaleHost: Bool = false,
		probe: IdentityProbe? = nil
	) async -> IdentifiedDevice? {
		let acceptedCandidate: Candidate
		if allowsTailscaleHost {
			acceptedCandidate = candidate
		} else {
			guard let localCandidate = localDiscoveryCandidate(candidate) else { return nil }
			acceptedCandidate = localCandidate
		}
		let probe = probe ?? { host, expectedDeviceId in
			try? await verifiedLocalHTTPSIdentity(host: host, expectedDeviceId: expectedDeviceId)
		}
		let hintedDeviceId = requiredDeviceId
			?? acceptedCandidate.id.flatMap { knownDeviceIds.contains($0) ? $0 : nil }
		var attemptedHosts = Set<String>()
		for host in [acceptedCandidate.host] + acceptedCandidate.addresses where attemptedHosts.insert(host).inserted {
			guard !Task.isCancelled else { return nil }
			guard var verified = await probe(host, hintedDeviceId) else { continue }
			var identity = verified.discoveryInfo
			if let hintedDeviceId {
				guard identity.id == hintedDeviceId else { continue }
			} else if knownDeviceIds.contains(identity.id) {
				// The authoritative response identified a saved device whose TXT hint did
				// not. Discard the first-use result unless its stored pin also validates.
				guard let pinned = await probe(host, identity.id),
					pinned.discoveryInfo.id == identity.id
				else { continue }
				verified = pinned
				identity = pinned.discoveryInfo
			}
			return IdentifiedDevice(
				host: host,
				discoveryHost: acceptedCandidate.host,
				addresses: acceptedCandidate.addresses,
				name: acceptedCandidate.name,
				id: identity.id,
				model: identity.device,
				onboarded: identity.onboarded,
				candidateCACertificate: verified.candidateCertificate
			)
		}
		return nil
	}

	// Bonjour is an unauthenticated source of local connection candidates. Never let
	// it introduce a Tailscale-range endpoint; those come only from the authenticated
	// system.getIpAddresses response after sign-in.
	static func localDiscoveryCandidate(_ candidate: Candidate) -> Candidate? {
		guard !SavedDevice.isTailscaleAddress(candidate.host) else { return nil }
		var candidate = candidate
		candidate.addresses.removeAll(where: SavedDevice.isTailscaleAddress)
		return candidate
	}

	// Probe a discovery snapshot concurrently and collapse duplicate advertisements
	// by the authoritative id returned from each device. Sorting before deduplication
	// makes the selected endpoint stable even when task completion order differs.
	public static func identify(
		candidates: [Candidate],
		knownDeviceIds: Set<String> = []
	) async -> [IdentifiedDevice] {
		let identified = await withTaskGroup(of: IdentifiedDevice?.self) { group in
			for candidate in candidates {
				group.addTask {
					await identifyCandidate(candidate, knownDeviceIds: knownDeviceIds)
				}
			}

			var results: [IdentifiedDevice] = []
			for await result in group {
				if let result { results.append(result) }
			}
			return results
		}

		guard !Task.isCancelled else { return [] }
		var byId: [String: IdentifiedDevice] = [:]
		for device in identified.sorted(by: { $0.host < $1.host }) where byId[device.id] == nil {
			byId[device.id] = device
		}
		return byId.values.sorted { $0.host < $1.host }
	}

	// Manual discovery is an explicit user action, so unlike passive Bonjour it may
	// probe a Tailscale endpoint. A plain HTTP(S) root URL is normalized to its host.
	// Short hostnames may resolve to a safe LAN or Tailscale address, while full MagicDNS
	// names resolve only to a literal Tailscale address because Umbrel's pinned certificate
	// covers its interface IP, not a user-controlled tailnet name. The address still supplies
	// no identity authority: the bootstrap CA must prove the same discovery id over HTTPS,
	// and a saved device is revalidated against its existing pin before it is returned.
	public static func discoverManually(
		at input: String,
		knownDeviceIds: Set<String> = []
	) async throws -> ManualDiscoveryResult {
		guard let parsedHost = manualDiscoveryHostKind(from: input) else {
			throw ManualDiscoveryError.invalidAddress
		}
		let candidate: Candidate
		switch parsedHost {
		case .direct:
			guard let direct = manualDiscoveryCandidate(from: input) else {
				throw ManualDiscoveryError.invalidAddress
			}
			candidate = direct
		case .unqualifiedHostname(let hostname), .tailscaleDNS(let hostname):
			let addresses = try await IPv4HostResolver.resolve(hostname)
			try Task.checkCancellation()
			guard !addresses.isEmpty else {
				throw ManualDiscoveryError.noDeviceFound
			}
			guard let resolved = manualDiscoveryCandidate(
				from: input,
				resolvedIPv4Addresses: addresses
			) else {
				throw ManualDiscoveryError.noDeviceFound
			}
			candidate = resolved
		}
		if let device = await identifyCandidate(
			candidate,
			knownDeviceIds: knownDeviceIds,
			allowsTailscaleHost: true
		) {
			return .device(device)
		}
		try Task.checkCancellation()
		if let updateRequired = await probeFallbackHost(candidate.host) {
			return .updateRequired(updateRequired)
		}
		try Task.checkCancellation()
		throw ManualDiscoveryError.noDeviceFound
	}

	static func manualDiscoveryCandidate(
		from input: String,
		resolvedIPv4Addresses: [String] = []
	) -> Candidate? {
		guard let parsedHost = manualDiscoveryHostKind(from: input) else { return nil }
		switch parsedHost {
		case .direct(let host):
			return Candidate(host: host, name: host)
		case .unqualifiedHostname(let hostname):
			return resolvedManualDiscoveryCandidate(
				hostname: hostname,
				addresses: resolvedIPv4Addresses,
				accepts: SavedDevice.isSupportedManualIPv4Address
			)
		case .tailscaleDNS(let hostname):
			return resolvedManualDiscoveryCandidate(
				hostname: hostname,
				addresses: resolvedIPv4Addresses,
				accepts: SavedDevice.isTailscaleAddress
			)
		}
	}

	private static func resolvedManualDiscoveryCandidate(
		hostname: String,
		addresses: [String],
		accepts: (String) -> Bool
	) -> Candidate? {
		var seen = Set<String>()
		let accepted = addresses.filter { accepts($0) && seen.insert($0).inserted }
		guard let host = accepted.first else { return nil }
		return Candidate(host: host, addresses: Array(accepted.dropFirst()), name: hostname)
	}

	static func manualDiscoveryHost(from input: String) -> String? {
		manualDiscoveryHostKind(from: input)?.value
	}

	static func manualDiscoveryHostKind(from input: String) -> ManualDiscoveryHost? {
		guard var host = normalizedManualDiscoveryHost(from: input) else { return nil }
		if host.hasSuffix(".") { host.removeLast() }
		guard !host.isEmpty else { return nil }
		if SavedDevice.isIPv4Address(host) {
			guard SavedDevice.isSupportedManualIPv4Address(host) else { return nil }
			return .direct(host)
		}
		if SavedDevice.isBonjourHostname(host) { return .direct(host) }
		guard SavedDevice.isDNSHostname(host) else { return nil }
		let labels = host.split(separator: ".", omittingEmptySubsequences: false)
		if labels.count == 1 { return .unqualifiedHostname(host) }
		return host.hasSuffix(".ts.net") ? .tailscaleDNS(host) : nil
	}

	private static func normalizedManualDiscoveryHost(from input: String) -> String? {
		let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
		let lowercased = value.lowercased()
		guard lowercased.hasPrefix("http://") || lowercased.hasPrefix("https://") else {
			return lowercased
		}
		guard let components = URLComponents(string: value),
			components.scheme?.lowercased() == "http" || components.scheme?.lowercased() == "https",
			let host = components.host,
			components.user == nil,
			components.password == nil,
			components.port == nil,
			components.path.isEmpty || components.path == "/",
			components.query == nil,
			components.fragment == nil
		else { return nil }
		return host.lowercased()
	}

	// Older umbrelOS releases predate the _umbrel._tcp advertisement, so Bonjour has
	// nothing to enumerate. Probe only the small set of default and common hostnames in
	// parallel; the slowest missing name therefore costs one short timeout, not seven.
	// A custom hostname outside this list remains intentionally undiscoverable rather
	// than turning onboarding into a noisy subnet scanner.
	static let fallbackDiscoveryHosts = [
		"umbrel.local",
		"umbrel-2.local",
		"umbrel-3.local",
		"umbrel-4.local",
		"umbrel-5.local",
		"umbrel-home.local",
		"umbrel-pro.local",
	]

	// Runs beside normal Bonjour discovery and reports only hosts answering the public
	// version endpoint. The app removes anything that subsequently proves a current
	// native identity; what remains is shown as an update hint. These plaintext responses
	// never create trust, store state, or enable authentication.
	public static func discoverFallbackHosts() async -> [UpdateRequiredDevice] {
		let probes = await withTaskGroup(of: UpdateRequiredDevice?.self) { group in
			for host in fallbackDiscoveryHosts {
				group.addTask { await probeFallbackHost(host) }
			}

			var results: [UpdateRequiredDevice] = []
			for await result in group {
				if let result { results.append(result) }
			}
			return results
		}

		guard !Task.isCancelled else { return [] }
		return probes.sorted { $0.host < $1.host }
	}

	private struct SystemVersion: Decodable {
		let version: String
		let name: String
	}

	private static func probeFallbackHost(_ host: String) async -> UpdateRequiredDevice? {
		guard !Task.isCancelled else { return nil }
		do {
			try await systemVersion(host: host)
		} catch {
			return nil
		}
		guard !Task.isCancelled else { return nil }
		return UpdateRequiredDevice(host: host)
	}

	private static func systemVersion(host: String) async throws {
		guard let url = URL(string: "http://\(host)/trpc/system.version") else {
			throw Error(status: 0, message: "Invalid host: \(host)")
		}
		var request = URLRequest(
			url: url,
			cachePolicy: .reloadIgnoringLocalCacheData,
			timeoutInterval: fallbackProbeTimeout
		)
		request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
		let (data, response) = try await LocalHTTPSTransport.fallbackDiscoveryData(
			for: request,
			maximumBytes: fallbackResponseMaximumBytes
		)
		guard let response = response as? HTTPURLResponse else {
			throw Error(status: 0, message: "system.version: unexpected response")
		}
		try validateFallbackSystemVersion(data: data, status: response.statusCode)
	}

	// system.version has returned both fields since umbrelOS 1.0. Requiring its stable
	// product name avoids mistaking an unrelated service for an old Umbrel. This is
	// still only an untrusted HTTP update hint; native identity is established elsewhere.
	static func validateFallbackSystemVersion(data: Data, status: Int) throws {
		let response: SystemVersion = try decodeEnvelope(data: data, status: status, path: "system.version")
		guard response.name.hasPrefix("umbrelOS "),
			!response.version.isEmpty,
			response.version.utf8.count <= 64
		else {
			throw Error(status: status, message: "system.version: not an umbrelOS response")
		}
	}

	// ── Wallpaper ──
	// The app mirrors the user's chosen umbrelOS wallpaper (id comes from user.get). The
	// web UI provides bounded AVIF renditions plus the original JPEG fallback.

	public static func wallpaperData(
		host: String,
		deviceId: String,
		id: String,
		rendition: WallpaperImageRendition
	) async throws -> Data {
		guard !id.isEmpty, id.allSatisfy(\.isNumber),
			let url = URL(string: "\(nativeScheme(for: host))://\(host)\(rendition.path(id: id))")
		else {
			throw Umbreld.Error(status: 0, message: "Invalid host: \(host)")
		}
		let request = URLRequest(url: url, timeoutInterval: 10)
		do {
			let (data, response) = try await nativeData(for: request, deviceId: deviceId, host: host)
			guard let response = response as? HTTPURLResponse,
				(200..<300).contains(response.statusCode)
			else { throw Umbreld.Error(status: 0, message: "Couldn’t load the wallpaper") }
			return data
		} catch let error as Umbreld.Error {
			throw error
		} catch is CancellationError {
			throw CancellationError()
		} catch let error as URLError where error.code == .cancelled {
			throw CancellationError()
		} catch let error as URLError where isConnectivityError(error) {
			throw Umbreld.Error(status: 0, message: "Could not reach \(host)", kind: .connectivity)
		} catch {
			throw Umbreld.Error(status: 0, message: "Couldn’t load the wallpaper", kind: .protocolFailure)
		}
	}

	public static func wallpaperData(
		target: Target,
		id: String,
		rendition: WallpaperImageRendition
	) async throws -> Data {
		try await withResolvedHost(for: target, replay: .safe) { host in
			try await wallpaperData(
				host: host,
				deviceId: target.deviceId,
				id: id,
				rendition: rendition
			)
		}
	}

	// ── Account avatars ──

	public static func accountAvatarData(target: Target, path: String) async throws -> Data {
		guard isValidAccountAvatarPath(path) else {
			throw Umbreld.Error(
				status: 0,
				message: "Invalid account avatar path",
				kind: .protocolFailure)
		}

		let cacheKey = "\(target.deviceId)\u{0}\(path)" as NSString
		if let cached = accountAvatarCache.object(forKey: cacheKey) {
			return cached as Data
		}

		let data = try await withResolvedHost(for: target, replay: .safe) { host in
			try await accountAvatarData(host: host, deviceId: target.deviceId, path: path)
		}
		try Task.checkCancellation()
		accountAvatarCache.setObject(data as NSData, forKey: cacheKey, cost: data.count)
		return data
	}

	// Only accept the exact same-origin route emitted by umbreld. In particular,
	// reject absolute/scheme-relative URLs, queries, fragments, and path traversal
	// before combining server-provided presentation data with a verified Umbrel host.
	static func isValidAccountAvatarPath(_ path: String) -> Bool {
		let segments = path.split(separator: "/", omittingEmptySubsequences: false)
		guard segments.count == 6,
			segments[0].isEmpty,
			segments[1] == "api",
			segments[2] == "accounts",
			isValidAccountIdSegment(segments[3]),
			segments[4] == "avatar"
		else { return false }

		let filename = segments[5]
		guard filename.count == 69, filename.hasSuffix(".webp") else { return false }
		return filename.dropLast(5).utf8.allSatisfy {
			($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102)
		}
	}

	private static func isValidAccountIdSegment(_ segment: Substring) -> Bool {
		guard let first = segment.utf8.first,
			let last = segment.utf8.last,
			isASCIIAlphanumeric(first),
			isASCIIAlphanumeric(last)
		else { return false }

		var previousWasHyphen = false
		for byte in segment.utf8 {
			if byte == 45 {
				guard !previousWasHyphen else { return false }
				previousWasHyphen = true
			} else {
				guard isASCIIAlphanumeric(byte) else { return false }
				previousWasHyphen = false
			}
		}
		return true
	}

	private static func isASCIIAlphanumeric(_ byte: UInt8) -> Bool {
		(byte >= 48 && byte <= 57)
			|| (byte >= 65 && byte <= 90)
			|| (byte >= 97 && byte <= 122)
	}

	private static func accountAvatarData(host: String, deviceId: String, path: String) async throws -> Data {
		guard let url = URL(string: "\(nativeScheme(for: host))://\(host)\(path)") else {
			throw Umbreld.Error(status: 0, message: "Invalid host: \(host)")
		}
		var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
		request.setValue("image/webp", forHTTPHeaderField: "Accept")

		do {
			let (data, response) = try await nativeData(for: request, deviceId: deviceId, host: host)
			guard let response = response as? HTTPURLResponse,
				(200..<300).contains(response.statusCode),
				response.mimeType?.lowercased() == "image/webp",
				data.count <= 4 * 1_024 * 1_024
			else {
				throw Umbreld.Error(
					status: 0,
					message: "Couldn’t load the account avatar",
					kind: .protocolFailure)
			}
			return data
		} catch let error as Umbreld.Error {
			throw error
		} catch is CancellationError {
			throw CancellationError()
		} catch let error as URLError where error.code == .cancelled {
			throw CancellationError()
		} catch let error as URLError where isConnectivityError(error) {
			throw Umbreld.Error(status: 0, message: "Could not reach \(host)", kind: .connectivity)
		} catch {
			throw Umbreld.Error(
				status: 0,
				message: "Couldn’t load the account avatar",
				kind: .protocolFailure)
		}
	}

	// ── Endpoints ──

	public static func is2faEnabled(host: String, deviceId: String) async throws -> Bool {
		try await query(host: host, path: "user.is2faEnabled", deviceId: deviceId)
	}

	public static func is2faEnabled(target: Target) async throws -> Bool {
		try await withResolvedHost(for: target, replay: .safe) { host in
			try await is2faEnabled(host: host, deviceId: target.deviceId)
		}
	}

	// Public by design: the same account list drives umbrelOS's pre-authentication
	// picker. It contains presentation metadata only, never account credentials.
	public static func listAccounts(host: String, deviceId: String) async throws -> [Account] {
		try await query(host: host, path: "user.listAccounts", deviceId: deviceId)
	}

	public static func listAccounts(target: Target) async throws -> [Account] {
		try await withResolvedHost(for: target, replay: .safe) { host in
			try await listAccounts(host: host, deviceId: target.deviceId)
		}
	}

	// Native apps are public clients: they receive a revocable device grant instead
	// of impersonating a browser session or embedding an app-wide client secret.
	public static func login(
		host: String,
		deviceId: String,
		userId: String = "0",
		password: String,
		totpToken: String?
	) async throws -> Session {
		let body = try JSONEncoder().encode(
			NativeLoginInput(userId: userId, password: password, totpToken: totpToken))
		let (data, response) = try await requestRaw(
			host: host,
			path: "user.loginNative",
			method: "POST",
			deviceId: deviceId,
			session: nil,
			body: body,
			timeout: 10)
		let native: NativeSessionResponse = try decodeEnvelope(
			data: data, status: response.statusCode, path: "user.loginNative")
		return native.session(deviceId: deviceId)
	}

	public static func login(
		target: Target,
		userId: String = "0",
		password: String,
		totpToken: String?
	) async throws -> Session {
		try await withResolvedHost(for: target, replay: .never) { host in
			try await login(
				host: host,
				deviceId: target.deviceId,
				userId: userId,
				password: password,
				totpToken: totpToken)
		}
	}

	// Ensure a usable access credential on app activation. Ordinary calls do the same
	// and retry once after a 401 through the per-device refresh coordinator.
	public static func renewSession(host: String, session: Session) async throws -> Session {
		try await sessionCoordinator.session(host: host, supplied: session)
	}

	public static func renewSession(target: Target, session: Session) async throws -> Session {
		// The server never rotates the device credential during this exchange, so a
		// lost response can safely be retried through another verified route.
		try await withResolvedHost(for: target, replay: .safe) { host in
			try await renewSession(host: host, session: session)
		}
	}

	public static func logout(host: String, session: Session) async throws {
		let body = try JSONEncoder().encode(EmptyInput())
		var activeSession = session
		var response = try await performRequestRaw(
			host: host,
			path: "user.logout",
			method: "POST",
			deviceId: activeSession.deviceId,
			accessToken: activeSession.accessToken,
			body: body,
			timeout: 10)
		if response.1.statusCode == 401 {
			// A caller may remove the local Keychain item before this best-effort request.
			// Refresh from the captured device credential without storing anything, so
			// delayed cleanup can never overwrite a subsequent sign-in.
			activeSession = try await refreshSessionDirect(host: host, session: activeSession)
			response = try await performRequestRaw(
				host: host,
				path: "user.logout",
				method: "POST",
				deviceId: activeSession.deviceId,
				accessToken: activeSession.accessToken,
				body: body,
				timeout: 10)
		}
		let _: Bool = try decodeEnvelope(
			data: response.0,
			status: response.1.statusCode,
			path: "user.logout")
	}

	public static func logout(target: Target, session: Session) async throws {
		try await withResolvedHost(for: target, replay: .never) { host in
			try await logout(host: host, session: session)
		}
	}

	// Signing out keeps the enrolled CA so reconnecting stays secure and seamless.
	// Removing the Umbrel is the explicit operation that discards first-use trust.
	public static func forgetLocalHTTPSIdentity(deviceId: String) async {
		await LocalHTTPSTransport.forget(deviceId: deviceId)
	}

	public static func createPhotoBackupGrant(
		host: String,
		session: Session,
		sourceId: String,
		suggestedName: String
	) async throws -> PhotoBackupGrant {
		return try await mutate(
			host: host,
			path: "photos.createBackupGrant",
			input: PhotoBackupGrantInput(sourceId: sourceId, suggestedName: suggestedName),
			session: session)
	}

	public static func createPhotoBackupGrant(
		target: Target,
		session: Session,
		sourceId: String,
		suggestedName: String
	) async throws -> PhotoBackupGrant {
		try await withResolvedHost(for: target, replay: .never) { host in
			try await createPhotoBackupGrant(
				host: host,
				session: session,
				sourceId: sourceId,
				suggestedName: suggestedName)
		}
	}

	public static func revokePhotoBackupGrant(host: String, session: Session) async throws {
		let _: Bool = try await mutate(
			host: host,
			path: "photos.revokeBackupGrant",
			input: EmptyInput(),
			session: session)
	}

	public static func revokePhotoBackupGrant(target: Target, session: Session) async throws {
		// Revocation is idempotent. If the selected route dies before its response
		// arrives, retrying through one other verified route cannot recreate a grant.
		try await withResolvedHost(for: target, replay: .safe) { host in
			try await revokePhotoBackupGrant(host: host, session: session)
		}
	}

	public static func confirmedPhotoBackupResources(
		host: String,
		session: Session,
		sourceId: String,
		resources: [PhotoBackupResourceQuery]
	) async throws -> [PhotoBackupResourceReceipt] {
		try await mutate(
			host: host,
			path: "photos.confirmedBackupResources",
			input: PhotoBackupResourceReceiptInput(sourceId: sourceId, resources: resources),
			session: session
		)
	}

	public static func confirmedPhotoBackupResources(
		target: Target,
		session: Session,
		sourceId: String,
		resources: [PhotoBackupResourceQuery]
	) async throws -> [PhotoBackupResourceReceipt] {
		guard !resources.isEmpty else { return [] }
		// The server procedure is a read-only POST solely to keep the bounded key batch
		// out of the URL, so replaying once through another verified route is safe.
		return try await withResolvedHost(for: target, replay: .safe) { host in
			try await confirmedPhotoBackupResources(
				host: host,
				session: session,
				sourceId: sourceId,
				resources: resources
			)
		}
	}

	// ── Main app data ──

	public struct UserInfo: Decodable, Sendable {
		public let userId: String
		public let name: String
		public let role: String
		public let homePath: String
		public let sambaEnabled: Bool
		public let sambaUsername: String
		public let wallpaper: Wallpaper
	}

	public static func user(host: String, session: Session) async throws -> UserInfo {
		try await query(host: host, path: "user.get", session: session)
	}

	public static func user(target: Target, session: Session) async throws -> UserInfo {
		try await withResolvedHost(for: target, replay: .safe) { host in
			try await user(host: host, session: session)
		}
	}

	// Includes LAN and tunnel addresses that umbreld considers reachable, while
	// filtering loopback, link-local, and container interfaces server-side.
	public static func ipAddresses(host: String, session: Session) async throws -> [String] {
		try await query(host: host, path: "system.getIpAddresses", session: session)
	}

	public static func ipAddresses(target: Target, session: Session) async throws -> [String] {
		try await withResolvedHost(for: target, replay: .safe) { host in
			try await ipAddresses(host: host, session: session)
		}
	}

	// Tailscale supplies this browser-only name. Native API and PhotoKit traffic keep
	// using literal endpoints so their existing route and transport checks stay exact.
	public static func tailscaleBrowserHostname(host: String, session: Session) async throws -> String? {
		try await query(host: host, path: "system.getTailscaleBrowserHostname", session: session)
	}

	public static func tailscaleBrowserHostname(target: Target, session: Session) async throws -> String? {
		try await withResolvedHost(for: target, replay: .safe) { host in
			try await tailscaleBrowserHostname(host: host, session: session)
		}
	}

	// One installed app. umbreld returns a per-app error object instead when a
	// manifest fails to read, so every display field is optional and callers filter.
	public struct AppSummary: Codable, Identifiable, Equatable {
		public let id: String
		public let name: String?
		public let version: String?
		public let icon: String? // fully-qualified URL (manifest icon or gallery SVG)
		public let state: String? // e.g. "ready", "updating"; drives progress overlays
		public let progress: Double? // 0...100 while installing or updating
		public let port: Int?
		public let path: String? // optional URL path the app serves under, e.g. "/web"

		// Tor-only apps have no reachable local port
		public let torOnly: Bool?
		// Some browser apps require a secure context to function. Clients still warn
		// before opening the Umbrel's locally issued HTTPS certificate.
		public let requiresHttps: Bool?

		// Default sign-in credentials some apps ship with. When showBeforeOpen is true,
		// clients present them before the first open (umbrelOS web parity).
		public struct Credentials: Codable, Equatable {
			public let defaultUsername: String?
			public let defaultPassword: String?
			public let showBeforeOpen: Bool?
		}

		public let credentials: Credentials?

		public var iconURL: URL? { icon.flatMap(URL.init(string:)) }

		// Disk snapshots only need enough data to paint and route an app tile. Default
		// app passwords remain authoritative on Umbrel and are fetched again before a
		// native client launches an app from cached data.
		public var withoutCredentials: Self {
			Self(
				id: id,
				name: name,
				version: version,
				icon: icon,
				state: state,
				progress: progress,
				port: port,
				path: path,
				torOnly: torOnly,
				requiresHttps: requiresHttps,
				credentials: nil
			)
		}

		// The app's web UI on the local network; nil for error stubs and Tor-only apps
		public func webURL(host: String, scheme: String = "http") -> URL? {
			guard let port, torOnly != true else { return nil }
			var components = URLComponents()
			components.scheme = scheme
			components.host = host
			components.port = port
			if let path, !path.isEmpty {
				components.path = path.hasPrefix("/") ? path : "/\(path)"
			}
			return components.url
		}
	}

	public static func apps(host: String, session: Session) async throws -> [AppSummary] {
		try await query(host: host, path: "apps.list", session: session)
	}

	public static func apps(target: Target, session: Session) async throws -> [AppSummary] {
		try await withResolvedHost(for: target, replay: .safe) { host in
			try await apps(host: host, session: session)
		}
	}

	// Persist "don't show credentials again" for an app.
	public static func hideCredentialsBeforeOpen(host: String, session: Session, appId: String) async throws {
		let _: IgnoredResult = try await mutate(
			host: host,
			path: "apps.hideCredentialsBeforeOpen",
			input: HideCredentialsInput(appId: appId, value: true),
			session: session)
	}

	public static func hideCredentialsBeforeOpen(target: Target, session: Session, appId: String) async throws {
		try await withResolvedHost(for: target, replay: .never) { host in
			try await hideCredentialsBeforeOpen(host: host, session: session, appId: appId)
		}
	}

	// Installed apps with an update available in the app store.
	public struct AppUpdate: Codable, Identifiable {
		public let id: String
		public let version: String
	}

	public static func appUpdates(host: String, session: Session) async throws -> [AppUpdate] {
		try await query(host: host, path: "apps.updates", session: session)
	}

	public static func appUpdates(target: Target, session: Session) async throws -> [AppUpdate] {
		try await withResolvedHost(for: target, replay: .safe) { host in
			try await appUpdates(host: host, session: session)
		}
	}

	// Storage usage values are byte counts. Umbreld already computes each category
	// without overlap, so native clients can present the returned breakdown directly.
	// Photo usage can become its own category when umbreld exposes it separately.
	public struct DiskUsage: Codable, Equatable {
		public struct AppUsage: Codable, Identifiable, Equatable {
			public let id: String
			public let used: Double
		}
		public struct MachineUsage: Codable, Identifiable, Equatable {
			public let id: String
			public let name: String
			public let osId: String
			public let used: Double
		}
		public let size: Double
		public let totalUsed: Double
		public let system: Double
		public let files: Double
		public let apps: [AppUsage]
		// Optional keeps the app compatible with umbrelOS versions from before the
		// Machines category was added to system.diskUsage.
		public let machines: [MachineUsage]?

		public var appsUsed: Double { apps.reduce(0) { $0 + $1.used } }
		public var machinesUsed: Double { machines?.reduce(0) { $0 + $1.used } ?? 0 }
	}

	public static func diskUsage(host: String, session: Session) async throws -> DiskUsage {
		try await query(host: host, path: "system.diskUsage", session: session)
	}

	public static func diskUsage(target: Target, session: Session) async throws -> DiskUsage {
		try await withResolvedHost(for: target, replay: .safe) { host in
			try await diskUsage(host: host, session: session)
		}
	}

	// Favorite folders as virtual paths (e.g. "/Home/Downloads").
	public static func favorites(host: String, session: Session) async throws -> [String] {
		try await query(host: host, path: "files.favorites", session: session)
	}

	public static func favorites(target: Target, session: Session) async throws -> [String] {
		try await withResolvedHost(for: target, replay: .safe) { host in
			try await favorites(host: host, session: session)
		}
	}

	public struct Share: Decodable {
		public let name: String
		public let path: String
		public let sharename: String
	}

	public static func shares(host: String, session: Session) async throws -> [Share] {
		try await query(host: host, path: "files.shares", session: session)
	}

	public static func shares(target: Target, session: Session) async throws -> [Share] {
		try await withResolvedHost(for: target, replay: .safe) { host in
			try await shares(host: host, session: session)
		}
	}

	public static func sharePassword(host: String, session: Session) async throws -> String {
		try await query(host: host, path: "files.sharePassword", session: session)
	}

	public static func sharePassword(target: Target, session: Session) async throws -> String {
		try await withResolvedHost(for: target, replay: .safe) { host in
			try await sharePassword(host: host, session: session)
		}
	}

	public static func addShare(host: String, session: Session, path: String) async throws {
		let _: IgnoredResult = try await mutate(
			host: host,
			path: "files.addShare",
			input: AddShareInput(path: path),
			session: session)
	}

	public static func addShare(target: Target, session: Session, path: String) async throws {
		try await withResolvedHost(for: target, replay: .never) { host in
			try await addShare(host: host, session: session, path: path)
		}
	}

	// Browser routing has more hostname choices than native transport, but it keeps the
	// same identity rule: a name or address is usable only when the public discovery
	// endpoint reports the saved device id. No session or other secret is sent here.
	public static func isBrowserEndpoint(
		host: String,
		expectedDeviceId: String,
		timeout: TimeInterval = 3
	) async -> Bool {
		guard let url = URL(string: "http://\(host)/trpc/system.discoveryInfo") else {
			return false
		}
		var request = URLRequest(
			url: url,
			cachePolicy: .reloadIgnoringLocalCacheData,
			timeoutInterval: timeout)
		request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
		do {
			let (data, response) = try await browserProbeSession.data(for: request)
			return try decodeDiscoveryInfo(data: data, response: response).id == expectedDeviceId
		} catch {
			return false
		}
	}

	// ── Plumbing ──

	struct EmptyInput: Encodable {}

	struct NativeClient: Encodable, Sendable, Equatable {
		let id: String
		let platform: String
		let deviceClass: String
		let appVersion: String
		let appBuild: String
		let osVersion: String

		// Recomputed for login and access refresh so app and OS updates do not
		// leave stale details on the server's long-lived native session.
		static var current: NativeClient {
			#if os(iOS)
			let platform = "ios"
			let deviceClass = "phone"
			#elseif os(macOS)
			let platform = "macos"
			let deviceClass = "desktop"
			#endif
			let version = ProcessInfo.processInfo.operatingSystemVersion
			let osVersion = version.patchVersion == 0
				? "\(version.majorVersion).\(version.minorVersion)"
				: "\(version.majorVersion).\(version.minorVersion).\(version.patchVersion)"
			return NativeClient(
				id: "umbrel",
				platform: platform,
				deviceClass: deviceClass,
				appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown",
				appBuild: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown",
				osVersion: osVersion)
		}
	}

	struct NativeLoginInput: Encodable {
		let userId: String
		let password: String
		let totpToken: String?
		let client: NativeClient

		init(
			userId: String,
			password: String,
			totpToken: String?,
			client: NativeClient = .current
		) {
			self.userId = userId
			self.password = password
			self.totpToken = totpToken
			self.client = client
		}
	}

	struct NativeRefreshInput: Encodable {
		let deviceToken: String
		let client: NativeClient

		init(deviceToken: String, client: NativeClient = .current) {
			self.deviceToken = deviceToken
			self.client = client
		}
	}

	struct PhotoBackupGrantInput: Encodable {
		let sourceId: String
		let suggestedName: String
	}

	struct PhotoBackupResourceReceiptInput: Encodable {
		let sourceId: String
		let resources: [PhotoBackupResourceQuery]
	}

	struct HideCredentialsInput: Encodable {
		let appId: String
		let value: Bool
	}

	struct AddShareInput: Encodable {
		let path: String
	}

	struct NativeSessionResponse: Decodable {
		let accountId: String
		let accessToken: String
		let accessExpiresAt: Int64
		let deviceToken: String

		func session(deviceId: String) -> Session {
			Session(
				deviceId: deviceId,
				accountId: accountId,
				accessToken: accessToken,
				accessExpiresAt: accessExpiresAt,
				deviceToken: deviceToken)
		}
	}

	struct NativeAccessResponse: Decodable {
		let accessToken: String
		let accessExpiresAt: Int64
	}

	private struct IgnoredResult: Decodable {
		init(from decoder: Decoder) throws {}
	}

	private struct Envelope<T: Decodable>: Decodable {
		struct Result: Decodable {
			let data: T
		}
		struct ErrorBody: Decodable {
			let message: String?
		}
		let result: Result?
		let error: ErrorBody?
	}

	// Short timeout for identity probes: sweeps hit several hosts in parallel and
	// nonexistent .local hostnames should fail fast
	private static let probeTimeout: TimeInterval = 3
	private static let fallbackProbeTimeout: TimeInterval = 2
	private static let fallbackResponseMaximumBytes = 16 * 1024
	private static let sessionCoordinator = SessionCoordinator()
	private static let endpointResolver = NativeEndpointResolver()

	// Returns an origin only after that host proves the saved Umbrel's pinned HTTPS
	// identity. No password, session token, or other credential is sent by this step.
	public static func resolvedHost(for target: Target) async throws -> String {
		switch Keychain.readLocalHTTPSCA(deviceId: target.deviceId) {
		case .found:
			return try await resolvePinnedHost(for: target)
		case .missing:
			throw transportError(.notEnrolled)
		case .unavailable:
			throw Error(
				status: 0,
				message: LocalHTTPSTransportError.storageUnavailable.localizedDescription,
				kind: .storage)
		}
	}

	// NWPathMonitor reports that iOS's available route changed; it does not establish
	// whether an Umbrel is reachable. Forget the cached winner so the next authenticated
	// request re-verifies the target's known LAN and Tailscale endpoints.
	public static func invalidateResolvedHost(for target: Target) async {
		await endpointResolver.invalidate(deviceId: target.deviceId)
	}

	private static func resolvePinnedHost(
		for target: Target,
		excluding excludedHost: String? = nil
	) async throws -> String {
		do {
			return try await endpointResolver.resolve(target, excluding: excludedHost) { host, deviceId in
				await verifyEndpoint(host: host, expectedDeviceId: deviceId)
			}
		} catch is CancellationError {
			throw CancellationError()
		} catch let rejection as EndpointRejection {
			throw endpointError(for: rejection)
		} catch {
			throw Error(status: 0, message: "Could not reach this Umbrel", kind: .connectivity)
		}
	}

	private static func verifyEndpoint(host: String, expectedDeviceId: String) async -> EndpointVerification {
		do {
			// Treat every endpoint as an untrusted route. The device's pinned CA, not
			// the shape of its address, proves where native credentials may be sent.
			let identity = try await verifiedLocalHTTPSIdentity(
				host: host,
				expectedDeviceId: expectedDeviceId
			).discoveryInfo
			return identity.id == expectedDeviceId ? .verified : .rejected(.trust(
				LocalHTTPSTransportError.identityChanged.localizedDescription))
		} catch is CancellationError {
			return .unavailable
		} catch let error as LocalHTTPSTransportError {
			if error == .storageUnavailable {
				return .rejected(.storage(error.localizedDescription))
			}
			return .rejected(.trust(error.localizedDescription))
		} catch let error as URLError where error.code == .cancelled {
			return .unavailable
		} catch let error as URLError where isConnectivityError(error) {
			return .unavailable
		} catch let error as URLError where isServerTrustError(error) {
			return .rejected(.trust(LocalHTTPSTransportError.trustFailed.localizedDescription))
		} catch {
			return .rejected(.protocolFailure(error.localizedDescription))
		}
	}

	private static func requireVerifiedEndpoint(
		_ verification: EndpointVerification,
		host: String
	) async throws -> String {
		try Task.checkCancellation()
		switch verification {
		case .verified:
			return host
		case .unavailable:
			throw Error(status: 0, message: "Could not reach this Umbrel", kind: .connectivity)
		case .rejected(let rejection):
			throw endpointError(for: rejection)
		}
	}

	private static func endpointError(for rejection: EndpointRejection) -> Error {
		switch rejection {
		case .trust(let message):
			return Error(status: 0, message: message, kind: .trust)
		case .storage(let message):
			return Error(status: 0, message: message, kind: .storage)
		case .protocolFailure(let message):
			return Error(status: 0, message: message, kind: .protocolFailure)
		}
	}

	private enum ReplayPolicy {
		case safe
		case never
	}

	private static func withResolvedHost<T>(
		for target: Target,
		replay: ReplayPolicy,
		operation: @escaping (String) async throws -> T
	) async throws -> T {
		let host = try await resolvedHost(for: target)
		do {
			return try await operation(host)
		} catch is CancellationError {
			throw CancellationError()
		} catch let error as Error where error.isConnectivityFailure {
			await endpointResolver.invalidate(deviceId: target.deviceId, host: host)
			guard replay == .safe else { throw error }
			let alternate: String
			do {
				alternate = try await resolvePinnedHost(for: target, excluding: host)
			} catch is CancellationError {
				throw CancellationError()
			} catch let resolutionError as Error where !resolutionError.isConnectivityFailure {
				throw resolutionError
			} catch {
				throw error
			}
			do {
				return try await operation(alternate)
			} catch let alternateError as Error where alternateError.isConnectivityFailure {
				await endpointResolver.invalidate(deviceId: target.deviceId, host: alternate)
				throw alternateError
			}
		}
	}

	private actor SessionCoordinator {
		private let refreshLeeway: Int64 = 60_000

		private struct LoginIdentity: Hashable {
			let deviceId: String
			let accountId: String
			let deviceToken: String

			init(_ session: Session) {
				deviceId = session.deviceId
				accountId = session.accountId
				deviceToken = session.deviceToken
			}
		}

		private var refreshTasks: [LoginIdentity: Task<Session, Swift.Error>] = [:]

		func session(
			host: String,
			supplied: Session,
			forceRefresh: Bool = false,
			rejectedAccessToken: String? = nil
		) async throws -> Session {
			let stored = Keychain.readSession(deviceId: supplied.deviceId)
			guard let current = stored.session, current.belongsToSameLogin(as: supplied) else {
				throw Umbreld.Error(status: 401, message: "This account is no longer signed in")
			}
			// Another request may already have replaced the rejected credential while
			// this one waited for the actor; reuse that result instead of refreshing twice.
			if let rejectedAccessToken, current.accessToken != rejectedAccessToken { return current }
			let now = Int64(Date().timeIntervalSince1970 * 1_000)
			if !forceRefresh, current.accessExpiresAt > now + refreshLeeway {
				return current
			}
			// Refreshing replaces the active access credential, so do not do it while
			// the result cannot be stored durably. The stable device credential remains
			// retryable once the Keychain recovers.
			if case .unavailable = stored {
				throw Umbreld.Error(status: 0, message: "Session storage is temporarily unavailable")
			}

			let identity = LoginIdentity(current)
			if let refreshTask = refreshTasks[identity] {
				return try await refreshTask.value
			}

			// Actor methods are reentrant across await. Publish one task before doing
			// network I/O so concurrent API calls share the same refresh.
			let refreshTask = Task<Session, Swift.Error> {
				do {
					let refreshed = try await Umbreld.refreshSessionDirect(host: host, session: current)
					guard Keychain.replaceSession(refreshed, matching: current) else {
						throw Umbreld.Error(status: 0, message: "Couldn\u{2019}t save the renewed session")
					}
					return refreshed
				} catch let error as Umbreld.Error {
					if error.isAuthError { Keychain.deleteSession(matching: current) }
					throw error
				}
			}
			refreshTasks[identity] = refreshTask
			defer { refreshTasks[identity] = nil }
			return try await refreshTask.value
		}
	}

	private static func query<T: Decodable>(
		host: String,
		path: String,
		deviceId: String? = nil,
		session: Session? = nil,
		timeout: TimeInterval = 10
	) async throws -> T {
		try await request(
			host: host,
			path: path,
			method: "GET",
			deviceId: deviceId,
			session: session,
			body: nil,
			timeout: timeout)
	}

	// tRPC queries carry their input as a JSON string in the `input` query parameter
	private static func query<T: Decodable>(
		host: String,
		path: String,
		input: some Encodable,
		deviceId: String? = nil,
		session: Session? = nil,
		timeout: TimeInterval = 10
	) async throws -> T {
		let json = String(decoding: try JSONEncoder().encode(input), as: UTF8.self)
		let encoded = json.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
		return try await request(
			host: host,
			path: "\(path)?input=\(encoded)",
			method: "GET",
			deviceId: deviceId,
			session: session,
			body: nil,
			timeout: timeout)
	}

	private static func mutate<T: Decodable>(
		host: String,
		path: String,
		input: some Encodable,
		session: Session? = nil
	) async throws -> T {
		try await request(
			host: host,
			path: path,
			method: "POST",
			deviceId: nil,
			session: session,
			body: try JSONEncoder().encode(input),
			timeout: 10)
	}

	private static func request<T: Decodable>(
		host: String,
		path: String,
		method: String,
		deviceId: String?,
		session: Session?,
		body: Data?,
		timeout: TimeInterval
	) async throws -> T {
		let (data, response) = try await requestRaw(
			host: host,
			path: path,
			method: method,
			deviceId: deviceId,
			session: session,
			body: body,
			timeout: timeout)
		return try decodeEnvelope(data: data, status: response.statusCode, path: path)
	}

	private static func refreshSessionDirect(host: String, session: Session) async throws -> Session {
		let body = try JSONEncoder().encode(NativeRefreshInput(deviceToken: session.deviceToken))
		let (data, response) = try await performRequestRaw(
			host: host,
			path: "user.refreshNativeAccess",
			method: "POST",
			deviceId: session.deviceId,
			accessToken: nil,
			body: body,
			timeout: 10)
		let access: NativeAccessResponse = try decodeEnvelope(
			data: data, status: response.statusCode, path: "user.refreshNativeAccess")
		return Session(
			deviceId: session.deviceId,
			accountId: session.accountId,
			accessToken: access.accessToken,
			accessExpiresAt: access.accessExpiresAt,
			deviceToken: session.deviceToken)
	}

	private static func requestRaw(
		host: String,
		path: String,
		method: String,
		deviceId: String? = nil,
		session: Session?,
		body: Data?,
		timeout: TimeInterval
	) async throws -> (Data, HTTPURLResponse) {
		guard let supplied = session else {
			guard let deviceId else {
				throw Umbreld.Error(status: 0, message: "Missing Umbrel identity for secure request")
			}
			return try await performRequestRaw(
				host: host,
				path: path,
				method: method,
				deviceId: deviceId,
				accessToken: nil,
				body: body,
				timeout: timeout)
		}
		if let deviceId, deviceId != supplied.deviceId {
			throw Umbreld.Error(status: 0, message: "Umbrel identity does not match this session")
		}

		let current = try await sessionCoordinator.session(host: host, supplied: supplied)
		let first = try await performRequestRaw(
			host: host,
			path: path,
			method: method,
			deviceId: current.deviceId,
			accessToken: current.accessToken,
			body: body,
			timeout: timeout)
		guard first.1.statusCode == 401 else { return first }

		let refreshed = try await sessionCoordinator.session(
			host: host,
			supplied: current,
			forceRefresh: true,
			rejectedAccessToken: current.accessToken)
		return try await performRequestRaw(
			host: host,
			path: path,
			method: method,
			deviceId: refreshed.deviceId,
			accessToken: refreshed.accessToken,
			body: body,
			timeout: timeout)
	}

	private static func performRequestRaw(
		host: String,
		path: String,
		method: String,
		deviceId: String,
		accessToken: String?,
		body: Data?,
		timeout: TimeInterval
	) async throws -> (Data, HTTPURLResponse) {
		var request = try nativeRequest(host: host, path: path, timeout: timeout)
		request.httpMethod = method
		if let accessToken {
			request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
		}
		if let body {
			request.setValue("application/json", forHTTPHeaderField: "Content-Type")
			request.httpBody = body
		}

		do {
			let (data, response) = try await nativeData(for: request, deviceId: deviceId, host: host)
			guard let httpResponse = response as? HTTPURLResponse else {
				throw Umbreld.Error(status: 0, message: "\(path): unexpected response")
			}
			return (data, httpResponse)
		} catch let error as Umbreld.Error {
			throw error
		} catch is CancellationError {
			throw CancellationError()
		} catch let error as URLError where error.code == .cancelled {
			throw CancellationError()
		} catch let error as URLError where isConnectivityError(error) {
			throw Umbreld.Error(status: 0, message: "Could not reach \(host)", kind: .connectivity)
		} catch {
			throw Umbreld.Error(status: 0, message: "Could not reach \(host)", kind: .protocolFailure)
		}
	}

	static func nativeScheme(for _: String) -> String {
		"https"
	}

	private static func nativeRequest(host: String, path: String, timeout: TimeInterval) throws -> URLRequest {
		guard let url = URL(string: "\(nativeScheme(for: host))://\(host)/trpc/\(path)") else {
			throw Umbreld.Error(status: 0, message: "Invalid host: \(host)")
		}
		return URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
	}

	private static func httpsRequest(host: String, path: String, timeout: TimeInterval) throws -> URLRequest {
		guard let url = URL(string: "https://\(host)/trpc/\(path)") else {
			throw Umbreld.Error(status: 0, message: "Invalid host: \(host)")
		}
		return URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
	}

	private static func nativeData(
		for request: URLRequest,
		deviceId: String,
		host _: String
	) async throws -> (Data, URLResponse) {
		return try await secureData(for: request, deviceId: deviceId)
	}

	private static func secureData(
		for request: URLRequest,
		deviceId: String
	) async throws -> (Data, URLResponse) {
		do {
			return try await LocalHTTPSTransport.data(for: request, deviceId: deviceId)
		} catch let error as LocalHTTPSTransportError {
			throw transportError(error)
		} catch let error as URLError where isServerTrustError(error) {
			throw Umbreld.Error(
				status: 0,
				message: LocalHTTPSTransportError.trustFailed.localizedDescription,
				kind: .trust)
		}
	}

	private static func transportError(_ error: LocalHTTPSTransportError) -> Umbreld.Error {
		let kind: Umbreld.Error.Kind = error == .storageUnavailable ? .storage : .trust
		return Umbreld.Error(status: 0, message: error.localizedDescription, kind: kind)
	}

	private static func isConnectivityError(_ error: URLError) -> Bool {
		switch error.code {
		case .timedOut,
			.cannotFindHost,
			.cannotConnectToHost,
			.networkConnectionLost,
			.dnsLookupFailed,
			.notConnectedToInternet,
			.internationalRoamingOff,
			.callIsActive,
			.dataNotAllowed:
			return true
		default:
			return false
		}
	}

	private static func isServerTrustError(_ error: URLError) -> Bool {
		switch error.code {
		case .serverCertificateHasBadDate,
			.serverCertificateUntrusted,
			.serverCertificateHasUnknownRoot,
			.serverCertificateNotYetValid,
			.clientCertificateRejected,
			.clientCertificateRequired:
			return true
		default:
			return false
		}
	}

	private static func isTailscaleHost(_ host: String) -> Bool {
		SavedDevice.isTailscaleAddress(host)
	}

	static func decodeEnvelope<T: Decodable>(data: Data, status: Int, path: String) throws -> T {
		let envelope = try? JSONDecoder().decode(Envelope<T>.self, from: data)

		guard status >= 200, status < 300 else {
			// Surface the tRPC error message (e.g. "Invalid password") when present
			let message = envelope?.error?.message ?? "\(path) failed (\(status))"
			throw Umbreld.Error(status: status, message: message)
		}
		guard let result = envelope?.result?.data else {
			throw Umbreld.Error(status: status, message: "\(path): unexpected response")
		}
		return result
	}
}

private final class UmbreldNoRedirectDelegate: NSObject, URLSessionTaskDelegate {
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
