import Foundation
import os
import Security

// Native device grants, one Keychain item per Umbrel id. The stable device
// credential never lives in config files or migrates to another Apple device.
public enum Keychain {
	private static let service = "com.umbrel.app"
	private static let localHTTPSCAService = "com.umbrel.app.local-https-ca"
	private static let browserSessionService = "com.umbrel.app.browser-session"
	private static let photoBackupGrantService = "com.umbrel.app.photo-background-upload"
	private static let photoBackupSourceService = "com.umbrel.app.photo-backup-source"
	private static let photoBackupAccessGroupInfoKey = "UmbrelPhotoBackupKeychainAccessGroup"
	private static let sessionMutationLock = NSLock()
	private static let localHTTPSCAMutationLock = NSLock()

	public enum SessionReadResult {
		case found(Umbreld.Session)
		case missing
		case invalid
		case unavailable(status: Int32, cachedSession: Umbreld.Session?)

		public var session: Umbreld.Session? {
			switch self {
			case .found(let session):
				return session
			case .unavailable(_, let cachedSession):
				return cachedSession
			case .missing, .invalid:
				return nil
			}
		}
	}

	private static let sessionCache = OSAllocatedUnfairLock(initialState: [String: Umbreld.Session]())

	// Apple recommends selecting the Data Protection Keychain on every SecItem call.
	// It is already the only Keychain on iOS; on macOS this opts out of the legacy
	// file-based store and makes our accessibility policy effective.
	private static func genericPasswordQuery(service: String, account: String) -> [String: Any] {
		[
			kSecClass as String: kSecClassGenericPassword,
			kSecAttrService as String: service,
			kSecAttrAccount as String: account,
			kSecUseDataProtectionKeychain as String: true,
		]
	}

	private static func baseQuery(deviceId: String) -> [String: Any] {
		genericPasswordQuery(service: service, account: deviceId)
	}

	private static func localHTTPSCAQuery(deviceId: String) -> [String: Any] {
		genericPasswordQuery(service: localHTTPSCAService, account: deviceId)
	}

	enum LocalHTTPSCAReadResult: Equatable {
		case found(Data)
		case missing
		case unavailable(status: Int32)
	}

	enum LocalHTTPSCAStoreResult: Equatable {
		case stored
		case alreadyMatches
		case conflicts
		case unavailable(status: Int32)
	}

	// The enrolled CA is public, but its integrity is security-sensitive. Keep it in
	// the device-local Keychain beside the native grant rather than in editable config.
	// Enrollment is write-once: replacing a CA requires explicitly forgetting the
	// Umbrel, so concurrent discovery can never silently change an existing pin.
	static func storeLocalHTTPSCAIfAbsent(_ certificate: Data, deviceId: String) -> LocalHTTPSCAStoreResult {
		localHTTPSCAMutationLock.lock()
		defer { localHTTPSCAMutationLock.unlock() }

		switch readLocalHTTPSCAUnlocked(deviceId: deviceId) {
		case .found(let existing):
			return existing == certificate ? .alreadyMatches : .conflicts
		case .unavailable(let status):
			return .unavailable(status: status)
		case .missing:
			var add = localHTTPSCAQuery(deviceId: deviceId)
			add[kSecValueData as String] = certificate
			add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
			let status = SecItemAdd(add as CFDictionary, nil)
			if status == errSecSuccess { return .stored }
			// A second process may have enrolled the same Umbrel between our read and
			// add. Re-read the winner and preserve the same write-once semantics.
			if status == errSecDuplicateItem {
				switch readLocalHTTPSCAUnlocked(deviceId: deviceId) {
				case .found(let existing):
					return existing == certificate ? .alreadyMatches : .conflicts
				case .missing:
					return .unavailable(status: Int32(status))
				case .unavailable(let readStatus):
					return .unavailable(status: readStatus)
				}
			}
			return .unavailable(status: Int32(status))
		}
	}

	// Claiming an unsaved discovery result is an explicit first-use trust action. It
	// may replace a stale CA left by an older build's passive discovery, but callers
	// must never use this for a device that is already saved. The mutation remains
	// atomic with ordinary write-once enrollment inside this process.
	static func replaceLocalHTTPSCA(_ certificate: Data, deviceId: String) -> LocalHTTPSCAStoreResult {
		localHTTPSCAMutationLock.lock()
		defer { localHTTPSCAMutationLock.unlock() }

		switch readLocalHTTPSCAUnlocked(deviceId: deviceId) {
		case .found(let existing):
			guard existing != certificate else { return .alreadyMatches }
			let update: [String: Any] = [
				kSecValueData as String: certificate,
				kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
			]
			let status = SecItemUpdate(
				localHTTPSCAQuery(deviceId: deviceId) as CFDictionary,
				update as CFDictionary
			)
			return status == errSecSuccess ? .stored : .unavailable(status: Int32(status))
		case .missing:
			var add = localHTTPSCAQuery(deviceId: deviceId)
			add[kSecValueData as String] = certificate
			add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
			let status = SecItemAdd(add as CFDictionary, nil)
			return status == errSecSuccess ? .stored : .unavailable(status: Int32(status))
		case .unavailable(let status):
			return .unavailable(status: status)
		}
	}

	static func readLocalHTTPSCA(deviceId: String) -> LocalHTTPSCAReadResult {
		localHTTPSCAMutationLock.lock()
		defer { localHTTPSCAMutationLock.unlock() }
		return readLocalHTTPSCAUnlocked(deviceId: deviceId)
	}

	private static func readLocalHTTPSCAUnlocked(deviceId: String) -> LocalHTTPSCAReadResult {
		var query = localHTTPSCAQuery(deviceId: deviceId)
		query[kSecReturnData as String] = true
		query[kSecMatchLimit as String] = kSecMatchLimitOne
		var result: CFTypeRef?
		let status = SecItemCopyMatching(query as CFDictionary, &result)
		switch status {
		case errSecSuccess:
			guard let certificate = result as? Data else {
				return .unavailable(status: Int32(errSecDecode))
			}
			return .found(certificate)
		case errSecItemNotFound:
			return .missing
		default:
			return .unavailable(status: Int32(status))
		}
	}

	static func deleteLocalHTTPSCA(deviceId: String) {
		localHTTPSCAMutationLock.lock()
		defer { localHTTPSCAMutationLock.unlock() }
		SecItemDelete(localHTTPSCAQuery(deviceId: deviceId) as CFDictionary)
	}

	private static func photoBackupGrantQuery(deviceId: String, accountId: String) -> [String: Any]? {
		guard
			let accessGroup = Bundle.main.object(
				forInfoDictionaryKey: photoBackupAccessGroupInfoKey
			) as? String,
			!accessGroup.isEmpty
		else { return nil }
		var query = genericPasswordQuery(
			service: photoBackupGrantService,
			account: "\(deviceId):\(accountId)"
		)
		// The upload extension receives only this source-scoped bearer grant. Sessions,
		// certificate pins, and the reusable source id remain in the app's private group.
		query[kSecAttrAccessGroup as String] = accessGroup
		return query
	}

	private static func photoBackupSourceQuery(deviceId: String, accountId: String) -> [String: Any] {
		// A single Umbrel can host several accounts. The opaque source id is
		// reusable only by the same authenticated account on that Umbrel.
		genericPasswordQuery(service: photoBackupSourceService, account: "\(deviceId):\(accountId)")
	}

	// Returns false when the session could not be stored; callers must not continue
	// with credentials that won't survive a relaunch.
	@discardableResult
	public static func setSession(_ session: Umbreld.Session, deviceId: String) -> Bool {
		sessionMutationLock.lock()
		defer { sessionMutationLock.unlock() }
		return setSessionUnlocked(session, deviceId: deviceId)
	}

	private static func setSessionUnlocked(_ session: Umbreld.Session, deviceId: String) -> Bool {
		guard let data = try? JSONEncoder().encode(session) else { return false }
		let update = [kSecValueData as String: data]
		let status = SecItemUpdate(baseQuery(deviceId: deviceId) as CFDictionary, update as CFDictionary)
		let stored: Bool
		if status == errSecItemNotFound {
			var add = baseQuery(deviceId: deviceId)
			add[kSecValueData as String] = data
			// Readable after the first unlock following boot (background tasks run with
			// the device locked), and never migrated to other devices via backups.
			add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
			stored = SecItemAdd(add as CFDictionary, nil) == errSecSuccess
		} else {
			stored = status == errSecSuccess
		}
		if stored { sessionCache.withLock { $0[deviceId] = session } }
		return stored
	}

	// Item absence and malformed stored credentials are definitive. Other
	// Keychain statuses are transient storage failures, not proof of logout.
	public static func readSession(deviceId: String) -> SessionReadResult {
		sessionMutationLock.lock()
		defer { sessionMutationLock.unlock() }
		return readSessionUnlocked(deviceId: deviceId)
	}

	private static func readSessionUnlocked(deviceId: String) -> SessionReadResult {
		var query = baseQuery(deviceId: deviceId)
		query[kSecReturnData as String] = true
		query[kSecMatchLimit as String] = kSecMatchLimitOne
		var result: CFTypeRef?
		let status = SecItemCopyMatching(query as CFDictionary, &result)
		let read = classifySessionRead(status: status, data: result as? Data)
		switch read {
		case .found(let session):
			sessionCache.withLock { $0[deviceId] = session }
			return read
		case .missing, .invalid:
			sessionCache.withLock { $0[deviceId] = nil }
			return read
		case .unavailable(let status, _):
			let cached = sessionCache.withLock { $0[deviceId] }
			return .unavailable(status: status, cachedSession: cached)
		}
	}

	static func classifySessionRead(status: OSStatus, data: Data?) -> SessionReadResult {
		switch status {
		case errSecItemNotFound:
			return .missing
		case errSecSuccess:
			guard let data, let session = try? JSONDecoder().decode(Umbreld.Session.self, from: data) else {
				return .invalid
			}
			return .found(session)
		default:
			return .unavailable(status: status, cachedSession: nil)
		}
	}

	public static func deleteSession(deviceId: String) {
		sessionMutationLock.lock()
		defer { sessionMutationLock.unlock() }
		deleteSessionUnlocked(deviceId: deviceId)
	}

	private static func deleteSessionUnlocked(deviceId: String) {
		sessionCache.withLock { $0[deviceId] = nil }
		SecItemDelete(baseQuery(deviceId: deviceId) as CFDictionary)
	}

	// Refresh runs concurrently with UI-driven sign-in and sign-out. Only the same
	// server-issued login may be replaced; a stale task must never overwrite the next
	// account's session merely because both belong to the same physical Umbrel.
	@discardableResult
	static func replaceSession(_ session: Umbreld.Session, matching expected: Umbreld.Session) -> Bool {
		sessionMutationLock.lock()
		defer { sessionMutationLock.unlock() }
		guard let stored = readSessionUnlocked(deviceId: expected.deviceId).session,
			stored.belongsToSameLogin(as: expected)
		else { return false }
		return setSessionUnlocked(session, deviceId: expected.deviceId)
	}

	static func deleteSession(matching expected: Umbreld.Session) {
		sessionMutationLock.lock()
		defer { sessionMutationLock.unlock() }
		guard let stored = readSessionUnlocked(deviceId: expected.deviceId).session,
			stored.belongsToSameLogin(as: expected)
		else { return }
		deleteSessionUnlocked(deviceId: expected.deviceId)
	}

	// The in-app browser's umbrelOS session, kept beside the native session so any
	// of the Umbrel's addresses can be opened without signing in again.
	@discardableResult
	public static func setBrowserSession(_ session: Umbreld.BrowserSession) -> Bool {
		guard let data = try? JSONEncoder().encode(session) else { return false }
		let query = genericPasswordQuery(service: browserSessionService, account: session.deviceId)
		let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
		guard status == errSecItemNotFound else { return status == errSecSuccess }
		var add = query
		add[kSecValueData as String] = data
		add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
		return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
	}

	public static func readBrowserSession(deviceId: String) -> Umbreld.BrowserSession? {
		var query = genericPasswordQuery(service: browserSessionService, account: deviceId)
		query[kSecReturnData as String] = true
		query[kSecMatchLimit as String] = kSecMatchLimitOne
		var result: CFTypeRef?
		guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
			let data = result as? Data
		else { return nil }
		return try? JSONDecoder().decode(Umbreld.BrowserSession.self, from: data)
	}

	public static func deleteBrowserSession(deviceId: String) {
		SecItemDelete(genericPasswordQuery(service: browserSessionService, account: deviceId) as CFDictionary)
	}

	public enum PhotoBackupGrantReadResult {
		case found(String)
		case missing
		case unavailable(status: Int32)
	}

	@discardableResult
	public static func setPhotoBackupGrant(_ token: String, deviceId: String, accountId: String) -> Bool {
		guard
			let data = token.data(using: .utf8),
			let query = photoBackupGrantQuery(deviceId: deviceId, accountId: accountId)
		else { return false }
		let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
		if status == errSecItemNotFound {
			var add = query
			add[kSecValueData as String] = data
			add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
			return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
		}
		return status == errSecSuccess
	}

	public static func readPhotoBackupGrant(deviceId: String, accountId: String) -> PhotoBackupGrantReadResult {
		guard let query = photoBackupGrantQuery(deviceId: deviceId, accountId: accountId) else {
			return .unavailable(status: Int32(errSecMissingEntitlement))
		}
		return readPhotoBackupGrant(query: query)
	}

	private static func readPhotoBackupGrant(query sourceQuery: [String: Any]) -> PhotoBackupGrantReadResult {
		var query = sourceQuery
		query[kSecReturnData as String] = true
		query[kSecMatchLimit as String] = kSecMatchLimitOne
		var result: CFTypeRef?
		let status = SecItemCopyMatching(query as CFDictionary, &result)
		switch status {
		case errSecSuccess:
			guard
				let data = result as? Data,
				let token = String(data: data, encoding: .utf8),
				!token.isEmpty
			else { return .unavailable(status: Int32(errSecDecode)) }
			return .found(token)
		case errSecItemNotFound:
			return .missing
		default:
			return .unavailable(status: Int32(status))
		}
	}

	public static func deletePhotoBackupGrant(deviceId: String, accountId: String) {
		guard let query = photoBackupGrantQuery(deviceId: deviceId, accountId: accountId) else { return }
		SecItemDelete(query as CFDictionary)
	}

	public enum PhotoBackupSourceIdReadResult {
		case found(String)
		case missing
		case unavailable(status: Int32)

		public var id: String? {
			guard case .found(let id) = self else { return nil }
			return id
		}
	}

	// This non-secret id survives disabling backup, signing out, and removing a saved
	// connection. After an authenticated re-add, it lets umbreld return the same
	// account-owned folder and lets the local PhotoKit ledger resume without duplicates.
	@discardableResult
	public static func setPhotoBackupSourceId(_ sourceId: String, deviceId: String, accountId: String) -> Bool {
		guard let data = sourceId.data(using: .utf8) else { return false }
		let query = photoBackupSourceQuery(deviceId: deviceId, accountId: accountId)
		let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
		if status == errSecItemNotFound {
			var add = query
			add[kSecValueData as String] = data
			add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
			return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
		}
		return status == errSecSuccess
	}

	public static func readPhotoBackupSourceId(deviceId: String, accountId: String) -> PhotoBackupSourceIdReadResult {
		readPhotoBackupSourceId(query: photoBackupSourceQuery(deviceId: deviceId, accountId: accountId))
	}

	private static func readPhotoBackupSourceId(query sourceQuery: [String: Any]) -> PhotoBackupSourceIdReadResult {
		var query = sourceQuery
		query[kSecReturnData as String] = true
		query[kSecMatchLimit as String] = kSecMatchLimitOne
		var result: CFTypeRef?
		let status = SecItemCopyMatching(query as CFDictionary, &result)
		switch status {
		case errSecSuccess:
			guard
				let data = result as? Data,
				let sourceId = String(data: data, encoding: .utf8),
				UUID(uuidString: sourceId) != nil
			else { return .unavailable(status: Int32(errSecDecode)) }
			return .found(sourceId)
		case errSecItemNotFound:
			return .missing
		default:
			return .unavailable(status: Int32(status))
		}
	}
}
