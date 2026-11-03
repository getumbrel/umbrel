package com.umbrel.kit

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.util.Collections

class EndpointResolverTest {
	@Test
	fun connectionHostsIncludeCanonicalHostAndDeduplicateAddresses() {
		val device = SavedDevice(id = "device", name = "Umbrel", host = "umbrel.local", addresses = listOf("192.168.1.2", "UMBREL.LOCAL", "100.64.0.1"))

		assertEquals(listOf("umbrel.local", "192.168.1.2", "100.64.0.1"), device.connectionHosts)
	}

	@Test
	fun returnsTheFirstVerifiedHost() = runBlocking {
		val verifier = EndpointVerifier(mapOf("umbrel.local" to (false to 30L), "100.64.0.1" to (true to 1L)))
		val resolver = NativeEndpointResolver()
		val host = resolver.resolve(Umbreld.Target("expected-device", listOf("umbrel.local", "100.64.0.1")), verifier::verify)
		assertEquals("100.64.0.1", host)
		assertEquals(setOf("expected-device"), verifier.attempts.map { it.second }.toSet())
	}

	@Test
	fun prefersPromptTailscaleOverAFasterLocalRoute() = runBlocking {
		val verifier = EndpointVerifier(mapOf("umbrel.local" to (true to 1L), "100.64.0.1" to (true to 10L)))
		val resolver = NativeEndpointResolver(10_000)
		val host = resolver.resolve(Umbreld.Target("device", listOf("umbrel.local", "100.64.0.1")), verifier::verify)
		assertEquals("100.64.0.1", host)
		assertEquals(listOf("100.64.0.1"), verifier.attempts.map { it.first })
	}

	@Test
	fun fallsBackLocallyWhenTailscaleIsUnavailable() = runBlocking {
		val verifier = EndpointVerifier(mapOf("umbrel.local" to (true to 1L), "100.64.0.1" to (false to 1L)))
		val resolver = NativeEndpointResolver(10_000)
		val host = resolver.resolve(Umbreld.Target("device", listOf("umbrel.local", "100.64.0.1")), verifier::verify)
		assertEquals("umbrel.local", host)
		assertEquals(setOf("umbrel.local", "100.64.0.1"), verifier.attempts.map { it.first }.toSet())
	}

	@Test
	fun opensTheRaceAfterTheTailscalePreferenceWindow() = runBlocking {
		val verifier = EndpointVerifier(mapOf("umbrel.local" to (true to 1L), "100.64.0.1" to (true to 100L)))
		val resolver = NativeEndpointResolver(5)
		val host = resolver.resolve(Umbreld.Target("device", listOf("umbrel.local", "100.64.0.1")), verifier::verify)
		assertEquals("umbrel.local", host)
	}

	@Test
	fun aLosingProbeThatFinishesAfterCancellationDoesNotFailTheRace() = runBlocking {
		// The losing probe swallows its cancellation and reports a result only after the
		// race has been won and closed.
		val resolver = NativeEndpointResolver()
		val host = resolver.resolve(Umbreld.Target("device", listOf("a.local", "b.local")), { host, _ ->
			if (host == "a.local") return@resolve EndpointVerification.Verified
			try {
				delay(10_000)
			} catch (_: CancellationException) {
				Thread.sleep(50)
			}
			EndpointVerification.Unavailable
		})
		assertEquals("a.local", host)
	}

	@Test
	fun stillRequiresTailscaleToProveTheSavedIdentity() = runBlocking {
		val resolver = NativeEndpointResolver(1_000)
		val host = resolver.resolve(Umbreld.Target("device", listOf("umbrel.local", "100.64.0.1")), { host, _ ->
			if (host == "100.64.0.1") EndpointVerification.Rejected(EndpointRejectionKind.TRUST, "wrong device")
			else EndpointVerification.Verified
		})
		assertEquals("umbrel.local", host)
	}

	@Test
	fun preferencePreservesTheStrongestRejectionAcrossRoutes() {
		val resolver = NativeEndpointResolver(1_000)
		val error = assertThrows(EndpointRejectionException::class.java) {
			runBlocking {
				resolver.resolve(Umbreld.Target("device", listOf("umbrel.local", "100.64.0.1")), { host, _ ->
					if (host == "100.64.0.1") EndpointVerification.Rejected(EndpointRejectionKind.TRUST, "wrong device")
					else EndpointVerification.Rejected(EndpointRejectionKind.STORAGE, "storage unavailable")
				})
			}
		}
		assertEquals(EndpointRejectionKind.STORAGE, error.kind)
	}

	@Test
	fun reportsTheStrongestRejection() {
		val resolver = NativeEndpointResolver()
		val error = assertThrows(EndpointRejectionException::class.java) {
			runBlocking {
				resolver.resolve(Umbreld.Target("dev", listOf("a.local", "b.local")), { host, _ ->
					if (host == "a.local") EndpointVerification.Rejected(EndpointRejectionKind.PROTOCOL_FAILURE, "p")
					else EndpointVerification.Rejected(EndpointRejectionKind.TRUST, "t")
				})
			}
		}
		assertEquals(EndpointRejectionKind.TRUST, error.kind)
	}

	@Test
	fun surfacesASecurityRejectionWhenNoEndpointVerifies() {
		val resolver = NativeEndpointResolver()
		val error = assertThrows(EndpointRejectionException::class.java) {
			runBlocking {
				resolver.resolve(Umbreld.Target("device", listOf("offline.local", "changed.local")), { host, _ ->
					if (host == "changed.local") EndpointVerification.Rejected(EndpointRejectionKind.TRUST, "identity changed")
					else EndpointVerification.Unavailable
				})
			}
		}
		assertEquals(EndpointRejectionKind.TRUST, error.kind)
	}

	@Test
	fun failsWhenNoEndpointProvesIdentity() {
		val resolver = NativeEndpointResolver()
		assertThrows(EndpointResolutionException::class.java) {
			runBlocking {
				resolver.resolve(Umbreld.Target("device", listOf("umbrel.local", "100.64.0.1")), { _, _ -> EndpointVerification.Unavailable })
			}
		}
	}

	@Test
	fun reusesTheWinnerUntilItIsInvalidated() = runBlocking {
		val resolver = NativeEndpointResolver()
		val verifier = EndpointVerifier(mapOf("umbrel.local" to (false to 20L), "100.64.0.1" to (true to 1L)))
		val target = Umbreld.Target("device", listOf("umbrel.local", "100.64.0.1"))

		val first = resolver.resolve(target, verifier::verify)
		val attempts = verifier.attempts.size
		val second = resolver.resolve(target, { _, _ -> fail("A cached winner must not be probed again"); EndpointVerification.Unavailable })
		assertEquals("100.64.0.1", first)
		assertEquals(first, second)
		assertEquals(attempts, verifier.attempts.size)

		resolver.invalidate("device", first)
		val fallback = resolver.resolve(target, { host, _ ->
			if (host == "umbrel.local") EndpointVerification.Verified else EndpointVerification.Unavailable
		})
		assertEquals("umbrel.local", fallback)
	}

	@Test
	fun keepsWinnersSeparateByDevice() = runBlocking {
		val resolver = NativeEndpointResolver()
		val hosts = listOf("umbrel.local", "100.64.0.1")
		val first = resolver.resolve(Umbreld.Target("one", hosts), { host, id ->
			if (id == "one" && host == "umbrel.local") EndpointVerification.Verified else EndpointVerification.Unavailable
		})
		val second = resolver.resolve(Umbreld.Target("two", hosts), { host, id ->
			if (id == "two" && host == "100.64.0.1") EndpointVerification.Verified else EndpointVerification.Unavailable
		})
		assertEquals("umbrel.local", first)
		assertEquals("100.64.0.1", second)
	}

	@Test
	fun networkPathInvalidationReevaluatesTheDeviceWinner() = runBlocking {
		val resolver = NativeEndpointResolver()
		val target = Umbreld.Target("device", listOf("umbrel.local", "100.64.0.1"))
		val first = resolver.resolve(target, { host, _ ->
			if (host == "umbrel.local") EndpointVerification.Verified else EndpointVerification.Unavailable
		})
		resolver.invalidate("device")
		val second = resolver.resolve(target, { host, _ ->
			if (host == "100.64.0.1") EndpointVerification.Verified else EndpointVerification.Unavailable
		})
		assertEquals("umbrel.local", first)
		assertEquals("100.64.0.1", second)
	}

	@Test
	fun minimalSavedDeviceStillDecodes() {
		val device = Config.json.decodeFromString(SavedDevice.serializer(), """{"id":"device","name":"Umbrel","host":"umbrel.local","addresses":[]}""")

		assertEquals(listOf("umbrel.local"), device.connectionHosts)
	}

	@Test
	fun authoritativeAddressRefreshReplacesStaleAddresses() {
		val device = SavedDevice(id = "device", name = "Umbrel", host = "umbrel.local", addresses = listOf("192.168.1.20", "100.64.0.1"))

		assertEquals(listOf("192.168.1.21"), device.replaceAvailableAddresses(listOf("192.168.1.21")).addresses)
	}

	@Test
	fun rememberingConnectionCandidatesDoesNotEraseKnownRoutes() {
		val device = SavedDevice(id = "device", name = "Kitchen Umbrel", host = "umbrel.local", addresses = listOf("192.168.1.20"))
			.rememberConnectionCandidates(listOf("100.64.0.1", "192.168.1.20"))

		assertEquals(listOf("192.168.1.20", "100.64.0.1"), device.addresses)
		assertEquals("Kitchen Umbrel", device.name)
		assertEquals("umbrel.local", device.host)
	}

	@Test
	fun preservesCancellation() = runBlocking {
		assertResolutionCancels(NativeEndpointResolver(), listOf("umbrel.local"))
	}

	@Test
	fun preservesCancellationDuringTheTailscalePreference() = runBlocking {
		assertResolutionCancels(NativeEndpointResolver(5_000), listOf("umbrel.local", "100.64.0.1"))
	}

	@Test
	fun concurrentTargetsNeverBorrowAnEndpointOutsideTheirCandidateSet() = runBlocking {
		val resolver = NativeEndpointResolver()
		val results = listOf(
			async {
				resolver.resolve(Umbreld.Target("device", listOf("lan.local")), { host, _ ->
					delay(20)
					if (host == "lan.local") EndpointVerification.Verified else EndpointVerification.Unavailable
				})
			},
			async {
				resolver.resolve(Umbreld.Target("device", listOf("100.64.0.1")), { host, _ ->
					if (host == "100.64.0.1") EndpointVerification.Verified else EndpointVerification.Unavailable
				})
			},
		).awaitAll()
		assertEquals(listOf("lan.local", "100.64.0.1"), results)
	}

	@Test
	fun targetsDeduplicateHosts() {
		assertEquals(listOf("A.local", "b.local"), Umbreld.Target("dev", listOf("A.local", "a.local", "", "b.local")).hosts)
	}

	private suspend fun kotlinx.coroutines.CoroutineScope.assertResolutionCancels(resolver: NativeEndpointResolver, hosts: List<String>) {
		var outcome: Throwable? = null
		val job = launch {
			try {
				resolver.resolve(Umbreld.Target("device", hosts), { _, _ ->
					try { delay(10_000) } catch (_: CancellationException) {}
					EndpointVerification.Unavailable
				})
			} catch (error: Throwable) {
				outcome = error
				throw error
			}
		}
		yield()
		job.cancel()
		job.join()
		assertTrue("Expected a cancellation, got $outcome", outcome is CancellationException)
	}
}

/**
 * Mirrors the Swift tests' verifier: a cancelled wait still returns a result, so the
 * resolver must cope with probes that finish after it has moved on.
 */
private class EndpointVerifier(private val results: Map<String, Pair<Boolean, Long>>) {
	val attempts: MutableList<Pair<String, String>> = Collections.synchronizedList(mutableListOf())

	suspend fun verify(host: String, deviceId: String): EndpointVerification {
		attempts += host to deviceId
		val (success, delayMillis) = results[host] ?: return EndpointVerification.Unavailable
		try {
			delay(delayMillis)
		} catch (_: CancellationException) {
		}
		return if (success) EndpointVerification.Verified else EndpointVerification.Unavailable
	}
}
