import Foundation
import OSLog
import dnssd

private let discoveryLogger = Logger(
	subsystem: Bundle.main.bundleIdentifier ?? "com.umbrel.app",
	category: "Discovery"
)

// A host that might be an Umbrel, found via the _umbrel._tcp mDNS advertisement.
// TXT records carry identity hints (id/model/onboarded); system.discoveryInfo
// remains the authority for verified identity.
public struct Candidate: Equatable, Sendable {
	public var host: String // resolved hostname, e.g. "umbrel.local"
	public var addresses: [String] = [] // IPv4 addresses
	public var name: String // mDNS service name
	// TXT hints
	public var id: String?
	public var model: String?
	public var onboarded: Bool?

	public init(
		host: String,
		addresses: [String] = [],
		name: String,
		id: String? = nil,
		model: String? = nil,
		onboarded: Bool? = nil
	) {
		self.host = host
		self.addresses = addresses
		self.name = name
		self.id = id
		self.model = model
		self.onboarded = onboarded
	}
}

// A discovery candidate whose local CA validated an HTTPS system.discoveryInfo
// response with the same id. mDNS contributes only connection locations and a
// cosmetic service name; it is never an identity authority.
public struct IdentifiedDevice: Equatable, Sendable {
	public let host: String // the exact hostname or IP that answered the identity probe
	public let discoveryHost: String // the original Bonjour hostname for this verified candidate
	public let addresses: [String]
	public let name: String // untrusted mDNS service name, used only as a display fallback
	public let id: String
	public let model: String
	public let onboarded: Bool
	// Kept inside UmbrelKit so passive scans can hand the exact verified candidate
	// anchor to an explicit claim without exposing trust material to app UI code.
	let candidateCACertificate: Data?

	// Reuse the already verified identity when a client hands this result to its
	// normal reachability lifecycle.
	public var discoveryInfo: Umbreld.DiscoveryInfo {
		Umbreld.DiscoveryInfo(id: id, device: model, onboarded: onboarded)
	}

	init(
		host: String,
		discoveryHost: String,
		addresses: [String],
		name: String,
		id: String,
		model: String,
		onboarded: Bool,
		candidateCACertificate: Data? = nil
	) {
		self.host = host
		self.discoveryHost = discoveryHost
		self.addresses = addresses
		self.name = name
		self.id = id
		self.model = model
		self.onboarded = onboarded
		self.candidateCACertificate = candidateCACertificate
	}
}

// Browses for _umbrel._tcp through the system mDNSResponder daemon (dnssd C API).
// Only devices advertising this service are discoverable. Results remain unverified
// candidates until system.discoveryInfo establishes their identity.
//
// dnssd rather than NWBrowser because we talk to devices over plain http URLs, so we
// need the hostname and IPv4 strings; NWBrowser's endpoints are opaque and only yield
// those through a throwaway NWConnection, which ends up more complex than this.
//
// Each browse result goes through resolve (hostname, TXT) and then an IPv4
// address query. Threading: all state lives on `queue`; DNSServiceSetDispatchQueue
// delivers every callback there and start/stop hop onto it, so no locking is needed.
// Candidate snapshots are published via `onUpdate` on the main actor.
//
// SAFETY: DispatchQueue is the synchronization primitive for every mutable DNS field,
// and callback storage is main-actor isolated. The only state accessed from deinit is
// synchronized onto that same queue, so sharing the object itself cannot race.
public final class Discovery: @unchecked Sendable {
	@MainActor public var onUpdate: (@MainActor @Sendable ([Candidate]) -> Void)?

	// Fired on the main queue when iOS reports the Local Network permission is denied.
	// Denial-as-browse-error is the only permission signal the API exposes: there is
	// no way to query or request this permission directly.
	@MainActor public var onPermissionDenied: (@MainActor @Sendable () -> Void)?

	private static let queueIdentityKey = DispatchSpecificKey<UUID>()
	fileprivate let queue = DispatchQueue(label: "com.umbrel.app.discovery")
	private let queueIdentity = UUID()
	private var browseRef: DNSServiceRef?
	fileprivate var resolvers: [String: ServiceResolver] = [:]

	public init() {
		queue.setSpecific(key: Self.queueIdentityKey, value: queueIdentity)
	}

	public func start() {
		queue.async { [weak self] in
			guard let self, browseRef == nil else { return }
			let context = Unmanaged.passUnretained(self).toOpaque()
			var ref: DNSServiceRef?
			let error = DNSServiceBrowse(&ref, 0, 0, "_umbrel._tcp", nil, browseReply, context)
			guard error == DNSServiceErrorType(kDNSServiceErr_NoError), let ref else {
				if error == DNSServiceErrorType(kDNSServiceErr_PolicyDenied) {
					permissionDenied()
				}
				discoveryLogger.error("DNSServiceBrowse failed: code=\(error, privacy: .public)")
				return
			}
			DNSServiceSetDispatchQueue(ref, queue)
			browseRef = ref
		}
	}

	public func stop() {
		queue.async { [weak self] in
			guard let self else { return } // already torn down by deinit
			for resolver in resolvers.values {
				resolver.cancel()
			}
			resolvers.removeAll()
			if let browseRef {
				DNSServiceRefDeallocate(browseRef)
			}
			browseRef = nil
			// Publish the cleared snapshot before a restarted browse can deliver new
			// results. Both dispatches originate on this serial queue, so a snapshot
			// queued before stop cannot become the final state after a rescan.
			publish()
		}
	}

	// The dnssd callbacks hold an unretained pointer to self, so every service ref must
	// be deallocated before this object is; a callback firing afterwards would use a
	// stale pointer. Final release can happen either outside `queue` or from a callback
	// or queued block that temporarily kept self alive. Synchronize with an in-flight
	// callback only when outside the queue; synchronously dispatching to the serial queue
	// from itself would deadlock.
	deinit {
		if DispatchQueue.getSpecific(key: Self.queueIdentityKey) == queueIdentity {
			tearDownOnQueue()
		} else {
			queue.sync { tearDownOnQueue() }
		}
	}

	private func tearDownOnQueue() {
		for resolver in resolvers.values {
			resolver.cancel()
		}
		resolvers.removeAll()
		if let browseRef {
			DNSServiceRefDeallocate(browseRef)
		}
		browseRef = nil
	}

	// ── Browse events (on queue) ──

	fileprivate func permissionDenied() {
		DispatchQueue.main.async { [weak self] in
			self?.onPermissionDenied?()
		}
	}

	fileprivate func serviceFound(name: String, regtype: String, domain: String, interfaceIndex: UInt32) {
		let key = "\(name)|\(interfaceIndex)"
		guard resolvers[key] == nil else { return }
		let resolver = ServiceResolver(owner: self, key: key, name: name, interfaceIndex: interfaceIndex)
		resolvers[key] = resolver
		resolver.startResolve(regtype: regtype, domain: domain)
	}

	fileprivate func serviceLost(name: String, interfaceIndex: UInt32) {
		let key = "\(name)|\(interfaceIndex)"
		guard let resolver = resolvers.removeValue(forKey: key) else { return }
		resolver.cancel()
		publish()
	}

	// Builds the candidate list from resolved services. The same device can appear
	// once per network interface (e.g. Wi-Fi + Ethernet), so entries are merged by host.
	fileprivate func publish() {
		var byHost: [String: Candidate] = [:]
		for resolver in resolvers.values {
			guard let host = resolver.host else { continue } // not resolved yet
			var candidate = Candidate(
				host: host,
				addresses: resolver.addresses,
				name: resolver.name,
				id: resolver.txtId,
				model: resolver.txtModel,
				onboarded: resolver.txtOnboarded
			)
			if let existing = byHost[host] {
				candidate.addresses = Array(Set(existing.addresses + candidate.addresses)).sorted()
			}
			byHost[host] = candidate
		}
		let candidates = byHost.values.sorted { $0.host < $1.host }
		DispatchQueue.main.async { [weak self] in
			self?.onUpdate?(candidates)
		}
	}

	// Deallocating a DNSServiceRef from inside its own callback is dicey, so refs are
	// handed here and released on the next queue tick.
	fileprivate func deallocateLater(_ ref: DNSServiceRef) {
		// DNSServiceRef is an opaque C handle with no Swift Sendable annotation. Ownership
		// is transferred here on `queue`, and the originating property is cleared before
		// this queued block can execute, so this wrapper has exclusive use of the handle.
		let transferred = TransferredDNSServiceRef(value: ref)
		queue.async {
			DNSServiceRefDeallocate(transferred.value)
		}
	}
}

private struct TransferredDNSServiceRef: @unchecked Sendable {
	let value: DNSServiceRef
}

// One per browse result: resolves the service, then queries IPv4 addresses.
private final class ServiceResolver {
	unowned let owner: Discovery
	let key: String
	let name: String
	let interfaceIndex: UInt32

	private var resolveRef: DNSServiceRef?
	private var addrRef: DNSServiceRef?

	var host: String? // display form, no trailing dot
	private var hostTarget: String? // raw form for the address query
	var txtId: String?
	var txtModel: String?
	var txtOnboarded: Bool?
	var addresses: [String] = []

	init(owner: Discovery, key: String, name: String, interfaceIndex: UInt32) {
		self.owner = owner
		self.key = key
		self.name = name
		self.interfaceIndex = interfaceIndex
	}

	func startResolve(regtype: String, domain: String) {
		var ref: DNSServiceRef?
		let context = Unmanaged.passUnretained(self).toOpaque()
		let error = DNSServiceResolve(&ref, 0, interfaceIndex, name, regtype, domain, resolveReply, context)
		guard error == DNSServiceErrorType(kDNSServiceErr_NoError), let ref else {
			discoveryLogger.error(
				"DNSServiceResolve failed: name=\(self.name, privacy: .private(mask: .hash)) code=\(error, privacy: .public)"
			)
			return
		}
		DNSServiceSetDispatchQueue(ref, owner.queue)
		resolveRef = ref
	}

	// Called on the owner's queue from the resolve callback
	func resolved(hostTarget: String, txtLen: UInt16, txtRecord: UnsafeRawPointer?) {
		self.hostTarget = hostTarget
		self.host = hostTarget.hasSuffix(".") ? String(hostTarget.dropLast()) : hostTarget
		self.txtId = txtValue(key: "id", txtLen: txtLen, txtRecord: txtRecord)
		self.txtModel = txtValue(key: "device", txtLen: txtLen, txtRecord: txtRecord)
		self.txtOnboarded = txtValue(key: "onboarded", txtLen: txtLen, txtRecord: txtRecord).map { $0 == "1" }

		// One resolve is enough; release the ref and move on to addresses
		if let resolveRef {
			owner.deallocateLater(resolveRef)
			self.resolveRef = nil
		}
		startAddressQuery()

		// Publish now so the candidate appears immediately; addresses follow
		owner.publish()
	}

	private func txtValue(key: String, txtLen: UInt16, txtRecord: UnsafeRawPointer?) -> String? {
		guard let txtRecord else { return nil }
		var valueLen: UInt8 = 0
		guard let ptr = TXTRecordGetValuePtr(txtLen, txtRecord, key, &valueLen), valueLen > 0 else { return nil }
		let data = Data(bytes: ptr, count: Int(valueLen))
		return String(decoding: data, as: UTF8.self)
	}

	private func startAddressQuery() {
		guard addrRef == nil, let hostTarget else { return }
		var ref: DNSServiceRef?
		let context = Unmanaged.passUnretained(self).toOpaque()
		let error = DNSServiceGetAddrInfo(
			&ref,
			0,
			interfaceIndex,
			DNSServiceProtocol(kDNSServiceProtocol_IPv4),
			hostTarget,
			addressReply,
			context
		)
		guard error == DNSServiceErrorType(kDNSServiceErr_NoError), let ref else {
			discoveryLogger.error(
				"DNSServiceGetAddrInfo failed: host=\(hostTarget, privacy: .private(mask: .hash)) code=\(error, privacy: .public)"
			)
			return
		}
		DNSServiceSetDispatchQueue(ref, owner.queue)
		addrRef = ref
	}

	// Called on the owner's queue from the address callback. An empty address
	// finalizes the batch without adding anything (error/finalize-only replies).
	func addressFound(_ address: String, moreComing: Bool) {
		if !address.isEmpty, !addresses.contains(address) {
			addresses.append(address)
			addresses.sort()
		}
		if !moreComing {
			// Take the current batch as final; the browse add/remove cycle handles changes
			if let addrRef {
				owner.deallocateLater(addrRef)
				self.addrRef = nil
			}
			owner.publish()
		}
	}

	func cancel() {
		if let resolveRef {
			DNSServiceRefDeallocate(resolveRef)
			self.resolveRef = nil
		}
		if let addrRef {
			DNSServiceRefDeallocate(addrRef)
			self.addrRef = nil
		}
	}
}

// ── C callbacks ──
// Plain functions (no captures) so they convert to C function pointers. The context
// pointer carries the Discovery/ServiceResolver instance, which is kept alive by the
// owner's `resolvers` map. C strings are copied immediately; they're only valid for
// the duration of the callback.

private func browseReply(
	_ sdRef: DNSServiceRef?,
	_ flags: DNSServiceFlags,
	_ interfaceIndex: UInt32,
	_ errorCode: DNSServiceErrorType,
	_ serviceName: UnsafePointer<CChar>?,
	_ regtype: UnsafePointer<CChar>?,
	_ replyDomain: UnsafePointer<CChar>?,
	_ context: UnsafeMutableRawPointer?
) {
	guard let context else { return }
	let discovery = Unmanaged<Discovery>.fromOpaque(context).takeUnretainedValue()
	guard errorCode == DNSServiceErrorType(kDNSServiceErr_NoError) else {
		if errorCode == DNSServiceErrorType(kDNSServiceErr_PolicyDenied) {
			discovery.permissionDenied()
		}
		return
	}
	guard let serviceName, let regtype, let replyDomain else { return }
	let name = String(cString: serviceName)
	let type = String(cString: regtype)
	if flags & DNSServiceFlags(kDNSServiceFlagsAdd) != 0 {
		discovery.serviceFound(
			name: name,
			regtype: type,
			domain: String(cString: replyDomain),
			interfaceIndex: interfaceIndex
		)
	} else {
		discovery.serviceLost(name: name, interfaceIndex: interfaceIndex)
	}
}

private func resolveReply(
	_ sdRef: DNSServiceRef?,
	_ flags: DNSServiceFlags,
	_ interfaceIndex: UInt32,
	_ errorCode: DNSServiceErrorType,
	_ fullname: UnsafePointer<CChar>?,
	_ hosttarget: UnsafePointer<CChar>?,
	_ port: UInt16, // network byte order; unused, the API is always on the http port
	_ txtLen: UInt16,
	_ txtRecord: UnsafePointer<UInt8>?,
	_ context: UnsafeMutableRawPointer?
) {
	guard errorCode == DNSServiceErrorType(kDNSServiceErr_NoError), let context, let hosttarget else { return }
	let resolver = Unmanaged<ServiceResolver>.fromOpaque(context).takeUnretainedValue()
	resolver.resolved(
		hostTarget: String(cString: hosttarget),
		txtLen: txtLen,
		txtRecord: txtRecord.map { UnsafeRawPointer($0) }
	)
}

private func addressReply(
	_ sdRef: DNSServiceRef?,
	_ flags: DNSServiceFlags,
	_ interfaceIndex: UInt32,
	_ errorCode: DNSServiceErrorType,
	_ hostname: UnsafePointer<CChar>?,
	_ address: UnsafePointer<sockaddr>?,
	_ ttl: UInt32,
	_ context: UnsafeMutableRawPointer?
) {
	guard let context else { return }
	let resolver = Unmanaged<ServiceResolver>.fromOpaque(context).takeUnretainedValue()
	let moreComing = flags & DNSServiceFlags(kDNSServiceFlagsMoreComing) != 0

	guard errorCode == DNSServiceErrorType(kDNSServiceErr_NoError),
		flags & DNSServiceFlags(kDNSServiceFlagsAdd) != 0,
		let address, address.pointee.sa_family == sa_family_t(AF_INET)
	else {
		if !moreComing {
			resolver.addressFound("", moreComing: false)
		}
		return
	}

	var sin = UnsafeRawPointer(address).assumingMemoryBound(to: sockaddr_in.self).pointee
	var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
	guard inet_ntop(AF_INET, &sin.sin_addr, &buffer, socklen_t(INET_ADDRSTRLEN)) != nil else { return }
	resolver.addressFound(String(cString: buffer), moreComing: moreComing)
}
