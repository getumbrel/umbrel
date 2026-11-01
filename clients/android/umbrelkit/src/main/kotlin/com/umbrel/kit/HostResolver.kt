package com.umbrel.kit

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.withTimeoutOrNull
import java.net.Inet4Address
import java.net.InetAddress
import java.net.UnknownHostException

/**
 * Uses the system resolver so Tailscale's split DNS and MagicDNS search suffix are honored.
 * The caller still decides which resolved address ranges are valid manual endpoints.
 */
internal object IPv4HostResolver {
	// The lookup blocks and can't be interrupted, so it runs detached and the caller stops
	// waiting at the timeout.
	private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

	suspend fun resolve(
		host: String,
		timeoutMillis: Long = 3_000,
		lookup: (String) -> Array<InetAddress> = InetAddress::getAllByName,
	): List<String> {
		val addresses = scope.async {
			try {
				lookup(host)
					.filterIsInstance<Inet4Address>()
					.mapNotNull { it.hostAddress }
					.distinct()
			} catch (error: UnknownHostException) {
				emptyList()
			} catch (error: SecurityException) {
				emptyList()
			}
		}
		return withTimeoutOrNull(timeoutMillis) { addresses.await() } ?: emptyList()
	}
}
