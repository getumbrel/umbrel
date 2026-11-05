package com.umbrel.kit

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.net.InetAddress
import java.util.Collections

class FallbackDiscoveryTest {
	@Test
	fun fallbackHostsStaySmallAndPredictable() {
		assertEquals(
			listOf(
				"umbrel.local",
				"umbrel-2.local",
				"umbrel-3.local",
				"umbrel-4.local",
				"umbrel-5.local",
				"umbrel-home.local",
				"umbrel-pro.local",
			),
			Umbreld.fallbackDiscoveryHosts,
		)
	}

	@Test
	fun fallbackResponseRequiresTheUmbrelOsVersionContract() {
		Umbreld.validateFallbackSystemVersion(result("""{"result":{"data":{"version":"1.7.4","name":"umbrelOS 1.7.4"}}}"""))

		assertThrows(Umbreld.Error::class.java) {
			Umbreld.validateFallbackSystemVersion(result("""{"result":{"data":{"version":"1.7.4","name":"Another service"}}}"""))
		}
		assertThrows(Umbreld.Error::class.java) {
			Umbreld.validateFallbackSystemVersion(result("""{"result":{"data":{"version":"1.7.4"}}}"""))
		}
	}

	@Test
	fun fallbackResponseReportsItsVersion() {
		val current = result("""{"result":{"data":{"version":"2.0.0","name":"umbrelOS 2.0"}}}""")
		assertEquals("2.0.0", Umbreld.validateFallbackSystemVersion(current))
	}

	@Test
	fun onlyReleasesBeforeUmbrelOs2RequireAnUpdate() {
		for (version in listOf("0.5.4", "1.0.0", "1.4.2", "1.7.4")) {
			assertTrue(version, Umbreld.requiresUpdate(version))
		}
		for (version in listOf("2.0.0", "2.0.0-beta.1", "2.0.1", "2.1.0", "10.0.0")) {
			assertFalse(version, Umbreld.requiresUpdate(version))
		}
		// Never tell someone to update on a version that can't be read
		for (version in listOf("", "beta", "v1.7.4")) {
			assertFalse(version, Umbreld.requiresUpdate(version))
		}
	}

	@Test
	fun currentFallbackHostsAreIdentifiedAndOnlyOlderOnesNeedAnUpdate() = runBlocking {
		val versions = mapOf(
			"umbrel.local" to "2.0.0",
			"umbrel-2.local" to "1.7.4",
			"umbrel-3.local" to "2.0.0-beta.2",
			"umbrel-pro.local" to "2.1.0",
		)
		val attempts = IdentificationAttempts()
		val result = discover(versions, knownDeviceIds = setOf("saved")) { candidate, knownDeviceIds ->
			attempts.record(candidate.host, knownDeviceIds)
			// umbrel-pro.local answers its version but never proves its identity
			if (candidate.host == "umbrel-pro.local") unverified(candidate.host, Umbreld.UnverifiedDevice.Reason.SLOW)
			else Umbreld.HostIdentification.Device(device(candidate.host, id = "id-${candidate.host}"))
		}

		assertEquals(listOf("umbrel-3.local", "umbrel.local"), result.devices.map { it.host })
		assertEquals(listOf(Umbreld.UnverifiedDevice("umbrel-pro.local", reason = Umbreld.UnverifiedDevice.Reason.SLOW)), result.unverified)
		assertEquals(listOf(Umbreld.UpdateRequiredDevice("umbrel-2.local")), result.updateRequired)
		// A slow Umbrel isn't asked twice, and older Umbrels are never asked
		assertEquals(listOf("umbrel-3.local", "umbrel-pro.local", "umbrel.local"), attempts.all.map { it.host }.sorted())
		assertTrue(attempts.all.all { it.knownDeviceIds == setOf("saved") })
	}

	@Test
	fun unexpectedFailureIsAskedOnceMore() = runBlocking {
		val attempts = IdentificationAttempts()
		val result = discover(mapOf("umbrel.local" to "2.0.0")) { candidate, knownDeviceIds ->
			attempts.record(candidate.host, knownDeviceIds)
			// Still starting the first time, ready the second
			if (attempts.all.size == 1) unverified(candidate.host, Umbreld.UnverifiedDevice.Reason.UNEXPECTED)
			else Umbreld.HostIdentification.Device(device(candidate.host, id = "home"))
		}

		assertEquals(Umbreld.FallbackDiscoveryResult(devices = listOf(device("umbrel.local", id = "home"))), result)
	}

	@Test
	fun aHungIdentificationEndsAtTheDeadlineAsSlow() = runBlocking {
		val attempts = IdentificationAttempts()
		val started = System.nanoTime()
		val result = discover(
			mapOf("umbrel.local" to "2.0.0"),
			addresses = mapOf("umbrel.local" to listOf("192.168.1.10")),
			attemptDeadlineMillis = 200,
		) { candidate, knownDeviceIds ->
			attempts.record(candidate.host, knownDeviceIds)
			delay(30_000)
			Umbreld.HostIdentification.Device(device(candidate.host, id = "home"))
		}

		assertTrue((System.nanoTime() - started) / 1_000_000 < 2_000)
		assertEquals(
			listOf(Umbreld.UnverifiedDevice("umbrel.local", listOf("192.168.1.10"), Umbreld.UnverifiedDevice.Reason.SLOW)),
			result.unverified,
		)
		assertEquals(1, attempts.all.size)
	}

	@Test
	fun twoNamesForTheSameUmbrelShowOnce() = runBlocking {
		val result = discover(mapOf("umbrel.local" to "2.0.0", "umbrel-home.local" to "2.0.0")) { candidate, _ ->
			Umbreld.HostIdentification.Device(device(candidate.host, id = "home", certificate = "home-ca".toByteArray()))
		}

		assertEquals(listOf("umbrel-home.local"), result.devices.map { it.host })
	}

	@Test
	fun aClaimedIdUnderAnotherCaDoesNotHideTheRealUmbrel() = runBlocking {
		val result = discover(mapOf("umbrel.local" to "2.0.0", "umbrel-2.local" to "2.0.0")) { candidate, _ ->
			val certificate = if (candidate.host == "umbrel.local") "home-ca" else "impostor-ca"
			Umbreld.HostIdentification.Device(device(candidate.host, id = "home", certificate = certificate.toByteArray()))
		}

		assertEquals(listOf("umbrel-2.local", "umbrel.local"), result.devices.map { it.host })
	}

	@Test
	fun anotherNameForAVerifiedUmbrelIsNotAFailure() = runBlocking {
		val result = discover(
			mapOf("umbrel.local" to "2.0.0", "umbrel-2.local" to "2.0.0"),
			addresses = mapOf("umbrel.local" to listOf("192.168.1.10"), "umbrel-2.local" to listOf("192.168.1.10")),
		) { candidate, _ ->
			if (candidate.host == "umbrel.local") {
				Umbreld.HostIdentification.Device(device(candidate.host, candidate.addresses, id = "home"))
			} else {
				Umbreld.HostIdentification.Unverified(
					Umbreld.UnverifiedDevice(candidate.host, candidate.addresses, Umbreld.UnverifiedDevice.Reason.SLOW),
				)
			}
		}

		assertEquals(listOf("umbrel.local"), result.devices.map { it.host })
		assertEquals(emptyList<Umbreld.UnverifiedDevice>(), result.unverified)
	}

	@Test
	fun aSavedUmbrelWithAChangedCertificateIsLeftToItsOwnHandling() = runBlocking {
		val result = discover(mapOf("umbrel.local" to "2.0.0")) { _, _ -> Umbreld.HostIdentification.SavedIdentityChanged }

		assertEquals(Umbreld.FallbackDiscoveryResult(), result)
	}

	@Test
	fun updateHintsArriveBeforeIdentificationFinishes() = runBlocking {
		val events = Collections.synchronizedList(mutableListOf<String>())
		val result = discover(
			mapOf("umbrel.local" to "2.0.0", "umbrel-2.local" to "1.7.4"),
			onUpdateRequired = { devices -> events += "update hints: ${devices.map { it.host }}" },
		) { candidate, _ ->
			delay(100)
			events += "identified ${candidate.host}"
			Umbreld.HostIdentification.Device(device(candidate.host, id = "home"))
		}

		assertEquals(listOf("update hints: [umbrel-2.local]", "identified umbrel.local"), events.toList())
		assertEquals(listOf(Umbreld.UpdateRequiredDevice("umbrel-2.local")), result.updateRequired)
	}

	// Below Android 16 mDNS finds an Umbrel by its address, which is how its update hint is
	// matched to it once it's updated
	@Test
	fun updateHintsCarryTheAddressesWhereTheOlderVersionAnswers() = runBlocking {
		val hints = Collections.synchronizedList(mutableListOf<List<Umbreld.UpdateRequiredDevice>>())
		val result = discover(
			mapOf("umbrel.local" to "1.7.4", "192.168.1.10" to "1.7.4"),
			addresses = mapOf("umbrel.local" to listOf("192.168.1.10")),
			onUpdateRequired = { hints += it },
		) { candidate, _ -> unverified(candidate.host, Umbreld.UnverifiedDevice.Reason.UNEXPECTED) }

		// The hint shows as soon as the version answers, before its addresses are checked
		assertEquals(listOf(listOf(Umbreld.UpdateRequiredDevice("umbrel.local"))), hints.toList())
		assertEquals(listOf(Umbreld.UpdateRequiredDevice("umbrel.local", listOf("192.168.1.10"))), result.updateRequired)
	}

	// A current Umbrel often answers to umbrel.local too. Once it proves itself at its own
	// address, that mustn't take away the older Umbrel's hint.
	@Test
	fun aCurrentUmbrelAtTheSameNameDoesNotLendTheHintItsAddress() = runBlocking {
		val result = discover(
			mapOf("umbrel.local" to "1.7.4", "192.168.1.10" to "2.0.0", "192.168.1.20" to "1.7.4"),
			// 192.168.1.30 doesn't answer at all
			addresses = mapOf("umbrel.local" to listOf("192.168.1.10", "192.168.1.20", "192.168.1.30")),
		) { candidate, _ -> unverified(candidate.host, Umbreld.UnverifiedDevice.Reason.UNEXPECTED) }

		assertEquals(listOf(Umbreld.UpdateRequiredDevice("umbrel.local", listOf("192.168.1.20"))), result.updateRequired)
	}

	@Test
	fun resolvingAnOlderUmbrelDoesNotHoldUpIdentification() = runBlocking {
		val identified = CompletableDeferred<Unit>()
		val result = withTimeout(5_000) {
			discover(
				mapOf("umbrel.local" to "2.0.0", "umbrel-2.local" to "1.7.4"),
				// The older Umbrel's name resolves only once the current one is identified
				resolve = { host ->
					if (host == "umbrel-2.local") identified.await()
					emptyList()
				},
			) { candidate, _ ->
				identified.complete(Unit)
				Umbreld.HostIdentification.Device(device(candidate.host, id = "home"))
			}
		}

		assertEquals(listOf("umbrel.local"), result.devices.map { it.host })
		assertEquals(listOf(Umbreld.UpdateRequiredDevice("umbrel-2.local")), result.updateRequired)
	}

	@Test
	fun theFallbackTimeLimitFitsTheFindingScreen() {
		// Onboarding keeps searching at most this long while verification runs
		assertTrue(Umbreld.FALLBACK_DISCOVERY_TIME_LIMIT_MS <= 30_000)
	}

	@Test
	fun fallbackDevicesAreNamedLikeMdnsNamesThem() {
		assertEquals("umbrel", Umbreld.fallbackDeviceName("umbrel.local"))
		assertEquals("umbrel-home", Umbreld.fallbackDeviceName("umbrel-home.local"))
	}

	@Test
	fun fallbackWithOnlyOlderUmbrelsSkipsIdentification() = runBlocking {
		val attempts = IdentificationAttempts()
		val result = discover(mapOf("umbrel.local" to "1.7.4")) { candidate, knownDeviceIds ->
			attempts.record(candidate.host, knownDeviceIds)
			unverified(candidate.host, Umbreld.UnverifiedDevice.Reason.UNEXPECTED)
		}

		assertEquals(Umbreld.FallbackDiscoveryResult(updateRequired = listOf(Umbreld.UpdateRequiredDevice("umbrel.local"))), result)
		assertTrue(attempts.all.isEmpty())
	}

	@Test
	fun liveFallbackDiscovery() = runBlocking {
		assumeTrue(
			"Set UMBRELKIT_FALLBACK_DISCOVERY_TEST=1 on a network with legacy and current Umbrels",
			System.getenv("UMBRELKIT_FALLBACK_DISCOVERY_TEST") == "1",
		)

		val result = Umbreld.discoverFallbackHosts()
		assertFalse(
			"Expected at least one common Umbrel hostname to answer",
			result.devices.isEmpty() && result.updateRequired.isEmpty(),
		)
	}

	@Test
	fun aCurrentVersionIsNeverReportedForAnUpdate() = runBlocking {
		val result = discover(mapOf("umbrel.local" to "2.0.0")) { candidate, _ ->
			unverified(candidate.host, Umbreld.UnverifiedDevice.Reason.SLOW)
		}

		assertEquals(emptyList<Umbreld.UpdateRequiredDevice>(), result.updateRequired)
		assertEquals(listOf("umbrel.local"), result.unverified.map { it.host })
	}

	// Not in the Swift suite: the version rule against a real HTTP answer. The hint follows the
	// version alone, whatever the host's identity endpoint answers.

	@Test
	fun anOlderVersionGetsTheHintWhateverItsIdentityEndpointAnswers() = runBlocking {
		for (identityStatus in listOf(404, 200, 503)) {
			serve(version = umbrelOs1, identityStatus = identityStatus) { host ->
				assertEquals("1.4.0", Umbreld.fallbackVersion(host))
				assertEquals(
					"identity endpoint $identityStatus",
					Umbreld.ManualDiscoveryResult.UpdateRequired(Umbreld.UpdateRequiredDevice(host)),
					manualOverHttp(host),
				)
			}
		}
	}

	@Test
	fun aCurrentVersionNeverGetsTheHintWhateverItsIdentityEndpointAnswers() = runBlocking {
		for (identityStatus in listOf(404, 200, 503)) {
			serve(version = umbrelOs2, identityStatus = identityStatus) { host ->
				assertEquals(
					"identity endpoint $identityStatus",
					Umbreld.ManualDiscoveryResult.Unverified(Umbreld.UnverifiedDevice(host, reason = Umbreld.UnverifiedDevice.Reason.SLOW)),
					manualOverHttp(host),
				)
			}
		}
	}

	@Test
	fun anUnrelatedServiceHasNoVersion() = runBlocking {
		serve(version = """{"result":{"data":{"version":"1.7.4","name":"Another service"}}}""", identityStatus = 404) { host ->
			assertNull(Umbreld.fallbackVersion(host))
		}
	}

	// ── Connect by address ──

	@Test
	fun manualDiscoveryReportsAnUpdateOnlyForAnOlderVersion() = runBlocking {
		val candidate = Candidate("192.168.1.20", name = "192.168.1.20")
		val failed: suspend (Candidate) -> Umbreld.HostIdentification = { unverified(it.host, Umbreld.UnverifiedDevice.Reason.UNEXPECTED) }

		assertEquals(
			Umbreld.ManualDiscoveryResult.UpdateRequired(Umbreld.UpdateRequiredDevice("192.168.1.20")),
			manual(candidate, failed, version = "1.7.4"),
		)
		assertEquals(
			Umbreld.ManualDiscoveryResult.Unverified(Umbreld.UnverifiedDevice("192.168.1.20", reason = Umbreld.UnverifiedDevice.Reason.UNEXPECTED)),
			manual(candidate, failed, version = "2.0.0"),
		)
		val error = assertThrows(Umbreld.ManualDiscoveryException::class.java) {
			runBlocking { manual(candidate, failed, version = null) }
		}
		assertEquals(Umbreld.ManualDiscoveryException.Kind.NO_DEVICE_FOUND, error.kind)
	}

	@Test
	fun manualDiscoveryAsksACurrentUmbrelOnceMoreAfterAnUnexpectedFailure() = runBlocking {
		val candidate = Candidate("192.168.1.20", name = "192.168.1.20")
		val attempts = IdentificationAttempts()

		val result = manual(candidate, identify = {
			attempts.record(it.host, emptySet())
			if (attempts.all.size == 1) unverified(it.host, Umbreld.UnverifiedDevice.Reason.UNEXPECTED)
			else Umbreld.HostIdentification.Device(device(it.host, id = "home"))
		})

		assertEquals(Umbreld.ManualDiscoveryResult.Device(device("192.168.1.20", id = "home")), result)
	}

	@Test
	fun manualDiscoveryReportsASlowUmbrelWithoutAskingAgain() = runBlocking {
		val candidate = Candidate("192.168.1.20", name = "192.168.1.20")
		val attempts = IdentificationAttempts()

		val result = manual(candidate, identify = {
			attempts.record(it.host, emptySet())
			unverified(it.host, Umbreld.UnverifiedDevice.Reason.SLOW)
		})

		assertEquals(
			Umbreld.ManualDiscoveryResult.Unverified(Umbreld.UnverifiedDevice("192.168.1.20", reason = Umbreld.UnverifiedDevice.Reason.SLOW)),
			result,
		)
		assertEquals(1, attempts.all.size)
	}

	@Test
	fun manualDiscoveryOfASavedUmbrelWithAChangedCertificateSaysSo() {
		val candidate = Candidate("192.168.1.20", name = "192.168.1.20")

		val error = assertThrows(LocalHttpsTransportException::class.java) {
			runBlocking { manual(candidate, identify = { Umbreld.HostIdentification.SavedIdentityChanged }) }
		}

		assertTrue(Umbreld.isIdentityChange(error))
	}

	private suspend fun manual(
		candidate: Candidate,
		identify: suspend (Candidate) -> Umbreld.HostIdentification,
		version: String? = "2.0.0",
	): Umbreld.ManualDiscoveryResult = Umbreld.discoverManually(
		candidate,
		knownDeviceIds = emptySet(),
		identify = identify,
		version = { version },
		retryDelayMillis = 0,
		attemptDeadlineMillis = 5_000,
	)

	// Connect by address with the real version probe; the identity check is stubbed as slow
	private suspend fun manualOverHttp(host: String): Umbreld.ManualDiscoveryResult = Umbreld.discoverManually(
		Candidate(host, name = host),
		knownDeviceIds = emptySet(),
		identify = { unverified(it.host, Umbreld.UnverifiedDevice.Reason.SLOW) },
		retryDelayMillis = 0,
		attemptDeadlineMillis = 5_000,
	)

	private suspend fun discover(
		versions: Map<String, String>,
		addresses: Map<String, List<String>> = emptyMap(),
		resolve: suspend (String) -> List<String> = { addresses[it] ?: emptyList() },
		knownDeviceIds: Set<String> = emptySet(),
		attemptDeadlineMillis: Long = 5_000,
		onUpdateRequired: suspend (List<Umbreld.UpdateRequiredDevice>) -> Unit = {},
		identify: suspend (Candidate, Set<String>) -> Umbreld.HostIdentification,
	): Umbreld.FallbackDiscoveryResult = Umbreld.discoverFallbackHosts(
		knownDeviceIds,
		version = { versions[it] },
		candidate = { host -> Candidate(host, resolve(host), Umbreld.fallbackDeviceName(host)) },
		identify = identify,
		retryDelayMillis = 0,
		attemptDeadlineMillis = attemptDeadlineMillis,
		onUpdateRequired = onUpdateRequired,
	)

	private val umbrelOs1 = """{"result":{"data":{"version":"1.4.0","name":"umbrelOS 1.4.0"}}}"""
	private val umbrelOs2 = """{"result":{"data":{"version":"2.0.0","name":"umbrelOS 2.0"}}}"""

	private suspend fun serve(version: String, identityStatus: Int, block: suspend (String) -> Unit) {
		MockWebServer().use { server ->
			server.dispatcher = object : Dispatcher() {
				override fun dispatch(request: RecordedRequest): MockResponse = when (request.url.encodedPath) {
					"/trpc/system.version" -> MockResponse.Builder().body(version).build()
					"/trpc/system.localHttpsIdentity" -> MockResponse.Builder().code(identityStatus).body("{}").build()
					else -> MockResponse.Builder().code(404).build()
				}
			}
			server.start(InetAddress.getLoopbackAddress(), 0)
			block("127.0.0.1:${server.port}")
		}
	}

	private fun result(json: String) = HttpResult(200, json.toByteArray(), "application/json")
}

private fun unverified(host: String, reason: Umbreld.UnverifiedDevice.Reason) =
	Umbreld.HostIdentification.Unverified(Umbreld.UnverifiedDevice(host, reason = reason))

private fun device(host: String, addresses: List<String> = emptyList(), id: String, certificate: ByteArray? = null) =
	IdentifiedDevice(host, host, addresses, Umbreld.fallbackDeviceName(host), id, "Umbrel Home", onboarded = true, certificate)

private class IdentificationAttempts {
	data class Attempt(val host: String, val knownDeviceIds: Set<String>)

	private val attempts = Collections.synchronizedList(mutableListOf<Attempt>())
	val all: List<Attempt> get() = synchronized(attempts) { attempts.toList() }

	fun record(host: String, knownDeviceIds: Set<String>) {
		attempts += Attempt(host, knownDeviceIds)
	}
}
