package com.umbrel.android

import com.umbrel.kit.Candidate
import com.umbrel.kit.IdentifiedDevice
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SavedDeviceDiscoveryTest {
	private fun candidate(host: String, id: String?, addresses: List<String> = emptyList()) =
		Candidate(host = host, addresses = addresses, name = "umbrel", id = id, model = "Umbrel Home")

	private fun identified(host: String, id: String) =
		IdentifiedDevice(host, host, emptyList(), "umbrel", id, "Umbrel Home", onboarded = true)

	@Test
	fun onlyCandidatesNamingASavedDeviceAreProbed() {
		val saved = candidate("umbrel.local", "saved", listOf("192.168.1.20"))
		val matches = savedDeviceCandidates(
			listOf(saved, candidate("other.local", "unsaved"), candidate("192.168.1.30", null)),
			savedIds = setOf("saved"),
		)
		assertEquals(listOf(saved to "saved"), matches)
	}

	@Test
	fun eachMatchIsVerifiedAgainstTheDeviceItClaims() = runTest {
		val probed = mutableListOf<Pair<String, String>>()
		val routes = verifiedSavedRoutes(
			listOf(candidate("a.local", "a") to "a", candidate("b.local", "b") to "b"),
		) { candidate, deviceId ->
			probed += candidate.host to deviceId
			identified(candidate.host, deviceId)
		}
		assertEquals(setOf("a.local" to "a", "b.local" to "b"), probed.toSet())
		assertEquals(setOf("a", "b"), routes.map { it.id }.toSet())
	}

	@Test
	fun aCandidateThatFailsVerificationChangesNothing() = runTest {
		val routes = verifiedSavedRoutes(listOf(candidate("umbrel.local", "saved") to "saved")) { _, _ -> null }
		assertTrue(routes.isEmpty())
	}

	@Test
	fun anMdnsHostnameIsPreferredOverAnAddressThenTheLowestHost() = runTest {
		val matches = listOf(
			candidate("192.168.1.20", "saved") to "saved",
			candidate("Umbrel-2.local", "saved") to "saved",
			candidate("umbrel.local", "saved") to "saved",
		)
		val routes = verifiedSavedRoutes(matches) { candidate, deviceId -> identified(candidate.host, deviceId) }
		assertEquals(listOf("umbrel-2.local"), routes.map { it.host.lowercase() })
	}

	@Test
	fun theChosenRouteDoesNotDependOnWhichProbeFinishesFirst() = runTest {
		// The address answers first; the hostname still wins.
		val addressAnswered = CompletableDeferred<Unit>()
		val matches = listOf(candidate("umbrel.local", "saved") to "saved", candidate("192.168.1.20", "saved") to "saved")
		val routes = verifiedSavedRoutes(matches) { candidate, deviceId ->
			if (candidate.host == "umbrel.local") addressAnswered.await() else addressAnswered.complete(Unit)
			identified(candidate.host, deviceId)
		}
		assertEquals(listOf("umbrel.local"), routes.map { it.host })
	}
}
