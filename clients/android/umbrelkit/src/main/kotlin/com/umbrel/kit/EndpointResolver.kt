package com.umbrel.kit

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.coroutineContext

internal class EndpointResolutionException : Exception("Couldn’t reach this Umbrel")

internal enum class EndpointRejectionKind(val priority: Int) {
	PROTOCOL_FAILURE(1),
	TRUST(2),
	STORAGE(3),
}

internal class EndpointRejectionException(val kind: EndpointRejectionKind, message: String) : Exception(message)

internal sealed class EndpointVerification {
	data object Verified : EndpointVerification()
	data object Unavailable : EndpointVerification()
	data class Rejected(val kind: EndpointRejectionKind, val message: String) : EndpointVerification()
}

/**
 * Picks the first candidate host that proves the saved Umbrel's pinned identity.
 * Tailscale gives native traffic one stable endpoint as the client moves between physical
 * networks, so it gets a short head start; a disconnected tunnel adds at most that delay
 * before a verified local route takes over.
 */
internal class NativeEndpointResolver(private val tailscalePreferenceWindowMillis: Long = 1_000) {
	fun interface Verify {
		suspend fun verify(host: String, deviceId: String): EndpointVerification
	}

	private data class ResolutionKey(val deviceId: String, val hosts: String)

	private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
	private val lock = Any()
	private val winners = HashMap<String, String>()
	private val resolutionTasks = HashMap<ResolutionKey, Deferred<String>>()

	suspend fun resolve(target: Umbreld.Target, verify: Verify, excludedHost: String? = null): String {
		coroutineContext.ensureActive()
		val candidates = target.hosts.filter { !it.equals(excludedHost ?: "", ignoreCase = true) }
		if (candidates.isEmpty()) throw EndpointResolutionException()
		val key = ResolutionKey(target.deviceId, candidates.map { it.lowercase() }.sorted().joinToString("\n"))

		val task: Deferred<String> = synchronized(lock) {
			winners[target.deviceId]?.let { winner ->
				if (candidates.any { it.equals(winner, ignoreCase = true) }) return winner
			}
			if (excludedHost == null) resolutionTasks[key]?.let { return@synchronized it }
			val started = scope.async {
				firstPreferredVerified(target.deviceId, candidates, tailscalePreferenceWindowMillis, verify)
			}
			if (excludedHost == null) {
				resolutionTasks[key] = started
				started.invokeOnCompletion {
					synchronized(lock) { if (resolutionTasks[key] === started) resolutionTasks.remove(key) }
				}
			}
			started
		}
		val winner = task.await()
		coroutineContext.ensureActive()
		synchronized(lock) { winners[target.deviceId] = winner }
		return winner
	}

	fun invalidate(deviceId: String, host: String) {
		synchronized(lock) {
			if (winners[deviceId]?.equals(host, ignoreCase = true) == true) winners.remove(deviceId)
		}
	}

	/** A network change can make the cached route obsolete without a request failing first. */
	fun invalidate(deviceId: String) {
		synchronized(lock) { winners.remove(deviceId) }
	}

	private suspend fun firstPreferredVerified(
		deviceId: String,
		hosts: List<String>,
		windowMillis: Long,
		verify: Verify,
	): String {
		val tailscaleHosts = hosts.filter(SavedDevice::isTailscaleAddress)
		val localHosts = hosts.filterNot(SavedDevice::isTailscaleAddress)
		if (tailscaleHosts.isEmpty() || localHosts.isEmpty()) return firstVerified(deviceId, hosts, verify)

		val preferred = try {
			withTimeoutOrNull(windowMillis) { firstVerified(deviceId, tailscaleHosts, verify) }
		} catch (rejection: EndpointRejectionException) {
			return try {
				firstVerified(deviceId, localHosts, verify)
			} catch (localRejection: EndpointRejectionException) {
				throw if (localRejection.kind.priority > rejection.kind.priority) localRejection else rejection
			} catch (unavailable: EndpointResolutionException) {
				throw rejection
			}
		} catch (unavailable: EndpointResolutionException) {
			return firstVerified(deviceId, localHosts, verify)
		}
		// The tunnel has not failed; it simply did not answer within its preference window.
		// Race it again with local routes so the first verified path wins.
		return preferred ?: firstVerified(deviceId, hosts, verify)
	}

	private suspend fun firstVerified(deviceId: String, hosts: List<String>, verify: Verify): String = coroutineScope {
		val results = Channel<Pair<String, EndpointVerification>>(hosts.size)
		val jobs = hosts.map { host ->
			launch {
				val verification = try {
					verify.verify(host, deviceId)
				} catch (cancelled: CancellationException) {
					throw cancelled
				} catch (error: Exception) {
					EndpointVerification.Rejected(EndpointRejectionKind.PROTOCOL_FAILURE, error.message ?: "verification failed")
				}
				results.send(host to verification)
			}
		}
		var strongest: EndpointVerification.Rejected? = null
		try {
			repeat(hosts.size) {
				val (host, verification) = results.receive()
				when (verification) {
					is EndpointVerification.Verified -> {
						jobs.forEach { it.cancel() }
						return@coroutineScope host
					}
					is EndpointVerification.Rejected ->
						if (strongest == null || verification.kind.priority > strongest!!.kind.priority) strongest = verification
					is EndpointVerification.Unavailable -> Unit
				}
			}
		} finally {
			results.close()
		}
		strongest?.let { throw EndpointRejectionException(it.kind, it.message) }
		throw EndpointResolutionException()
	}
}
