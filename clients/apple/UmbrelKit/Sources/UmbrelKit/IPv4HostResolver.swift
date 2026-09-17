import Foundation

// Uses the system hostname resolver so Tailscale's split-DNS configuration and
// MagicDNS search suffix are honored on both iOS and macOS. The caller still
// decides which resolved address ranges are valid manual endpoints.
enum IPv4HostResolver {
	static func resolve(_ host: String, timeout: TimeInterval = 3) async throws -> [String] {
		let lookup = IPv4HostLookup(host: host, timeout: timeout)
		return try await lookup.value()
	}
}

private final class IPv4HostLookup: @unchecked Sendable {
	private let host: String
	private let timeout: TimeInterval
	private let stateQueue = DispatchQueue(label: "com.umbrel.app.manual-address-resolution")
	private var continuation: CheckedContinuation<[String], Swift.Error>?
	private var cancelled = false
	private var finished = false

	init(host: String, timeout: TimeInterval) {
		self.host = host
		self.timeout = timeout
	}

	func value() async throws -> [String] {
		try Task.checkCancellation()
		return try await withTaskCancellationHandler {
			try await withCheckedThrowingContinuation { continuation in
				stateQueue.async { self.start(continuation) }
			}
		} onCancel: {
			stateQueue.async {
				self.cancelled = true
				self.finish(throwing: CancellationError())
			}
		}
	}

	private func start(_ continuation: CheckedContinuation<[String], Swift.Error>) {
		guard !finished else {
			continuation.resume(throwing: CancellationError())
			return
		}
		self.continuation = continuation
		guard !cancelled else {
			finish(throwing: CancellationError())
			return
		}

		DispatchQueue.global(qos: .userInitiated).async {
			let addresses = Self.resolveSynchronously(self.host)
			self.stateQueue.async { self.finish(returning: addresses) }
		}
		stateQueue.asyncAfter(deadline: .now() + timeout) {
			self.finish(returning: [])
		}
	}

	private static func resolveSynchronously(_ host: String) -> [String] {
		var firstResult: UnsafeMutablePointer<addrinfo>?
		guard getaddrinfo(host, nil, nil, &firstResult) == 0, let firstResult else { return [] }
		defer { freeaddrinfo(firstResult) }

		var addresses: [String] = []
		var result: UnsafeMutablePointer<addrinfo>? = firstResult
		while let current = result {
			defer { result = current.pointee.ai_next }
			guard current.pointee.ai_family == AF_INET, let address = current.pointee.ai_addr else {
				continue
			}
			var ipv4 = UnsafeRawPointer(address).assumingMemoryBound(to: sockaddr_in.self).pointee
			var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
			guard inet_ntop(AF_INET, &ipv4.sin_addr, &buffer, socklen_t(INET_ADDRSTRLEN)) != nil else {
				continue
			}
			let resolved = String(cString: buffer)
			if !addresses.contains(resolved) { addresses.append(resolved) }
		}
		return addresses
	}

	private func finish(returning addresses: [String]) {
		finish(.success(addresses))
	}

	private func finish(throwing error: Swift.Error) {
		finish(.failure(error))
	}

	private func finish(_ result: Result<[String], Swift.Error>) {
		guard !finished else { return }
		finished = true
		let continuation = self.continuation
		self.continuation = nil
		continuation?.resume(with: result)
	}
}
