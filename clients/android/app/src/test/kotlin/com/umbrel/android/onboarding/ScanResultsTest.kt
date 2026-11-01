package com.umbrel.android.onboarding

import com.umbrel.kit.Candidate
import com.umbrel.kit.IdentifiedDevice
import com.umbrel.kit.Umbreld
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ScanResultsTest {
	private val slow = Umbreld.UnverifiedDevice("umbrel.local", reason = Umbreld.UnverifiedDevice.Reason.SLOW)

	// Scan results seeded on the results step, without discovery
	private fun results(unverified: List<Umbreld.UnverifiedDevice> = listOf(slow)) = ScanResults(savedIds = emptySet()) { true }.apply {
		fallbackStarted()
		fallbackFinished(Umbreld.FallbackDiscoveryResult(unverified = unverified))
	}

	private fun identified(host: String, id: String = "home", addresses: List<String> = emptyList()) =
		IdentifiedDevice(host, host, addresses, "umbrel", id, "Umbrel Home", onboarded = true)

	@Test
	fun manualAddressReturnTracksDiscoveryChanges() {
		assertEquals(OnboardingStep.DEVICE_FOUND, resultsDestination(OnboardingStep.NO_DEVICE, hasResults = true))
		assertEquals(OnboardingStep.NO_DEVICE, resultsDestination(OnboardingStep.DEVICE_FOUND, hasResults = false))
	}

	@Test
	fun manualAddressReturnPreservesValidOrigin() {
		assertEquals(OnboardingStep.NO_DEVICE, resultsDestination(OnboardingStep.NO_DEVICE, hasResults = false))
		assertEquals(OnboardingStep.DEVICE_FOUND, resultsDestination(OnboardingStep.DEVICE_FOUND, hasResults = true))
		assertEquals(OnboardingStep.FINDING, resultsDestination(OnboardingStep.FINDING, hasResults = false))
	}

	@Test
	fun tryAgainShowsTheLatestReason() = runTest {
		val results = results()

		results.retry(results.unverified[0]) { device, _ ->
			Umbreld.HostIdentification.Unverified(Umbreld.UnverifiedDevice(device.host, reason = Umbreld.UnverifiedDevice.Reason.UNEXPECTED))
		}

		assertEquals(listOf(Umbreld.UnverifiedDevice("umbrel.local", reason = Umbreld.UnverifiedDevice.Reason.UNEXPECTED)), results.unverified)
		assertTrue(results.retryingHosts.isEmpty())
	}

	@Test
	fun tryAgainFromBeforeARescanIsDropped() = runTest {
		val results = results()
		val gate = CompletableDeferred<Unit>()
		val retry = launch {
			results.retry(results.unverified[0]) { device, _ ->
				gate.await()
				Umbreld.HostIdentification.Unverified(Umbreld.UnverifiedDevice(device.host, reason = Umbreld.UnverifiedDevice.Reason.UNEXPECTED))
			}
		}
		runCurrent()
		assertEquals(setOf("umbrel.local"), results.retryingHosts)

		results.clear()
		gate.complete(Unit)
		retry.join()

		assertTrue(results.unverified.isEmpty())
		assertTrue(results.retryingHosts.isEmpty())
	}

	@Test
	fun aSavedUmbrelWithAChangedCertificateLeavesTheResults() = runTest {
		val results = results()

		results.retry(results.unverified[0]) { _, _ -> Umbreld.HostIdentification.SavedIdentityChanged }

		assertTrue(results.isEmpty)
		assertEquals(OnboardingStep.NO_DEVICE, resultsDestination(OnboardingStep.DEVICE_FOUND, hasResults = !results.isEmpty))
	}

	// Not in the Swift suite: how the scan's sources combine.

	@Test
	fun anUmbrelThatNowProvesItselfReplacesItsCard() = runTest {
		val results = results()

		results.retry(results.unverified[0]) { device, _ -> Umbreld.HostIdentification.Device(identified(device.host)) }

		assertEquals(listOf("umbrel.local"), results.devices.map { it.host })
		assertTrue(results.unverified.isEmpty())
	}

	@Test
	fun aCardForAnAddressOfAVerifiedUmbrelIsNotShown() {
		val results = results(listOf(Umbreld.UnverifiedDevice("umbrel-2.local", listOf("192.168.1.10"), Umbreld.UnverifiedDevice.Reason.SLOW)))

		results.identifying(listOf(Candidate("umbrel.local", listOf("192.168.1.10"), "umbrel")))
		results.identified(listOf(identified("umbrel.local", addresses = listOf("192.168.1.10"))))

		assertEquals(listOf("umbrel.local"), results.devices.map { it.host })
		assertTrue(results.unverified.isEmpty())
	}

	@Test
	fun anUmbrelBothSourcesFoundShowsOnceWithItsMdnsRecord() {
		val results = ScanResults(savedIds = emptySet())
		val mdns = identified("umbrel.local", addresses = listOf("192.168.1.10"))

		results.identified(listOf(mdns))
		results.fallbackStarted()
		results.fallbackFinished(Umbreld.FallbackDiscoveryResult(devices = listOf(identified("umbrel.local"))))

		assertEquals(listOf(mdns), results.devices)
	}

	@Test
	fun theScanIsVerifyingWhileCandidatesOrTheFallbackScanArePending() {
		val results = ScanResults(savedIds = emptySet())
		assertFalse(results.isVerifyingCandidates)

		results.identifying(listOf(Candidate("umbrel.local", name = "umbrel")))
		assertTrue(results.isVerifyingCandidates)
		results.identified(emptyList())
		assertFalse(results.isVerifyingCandidates)

		results.fallbackStarted()
		assertTrue(results.isVerifyingCandidates)
		// Older Umbrels show as soon as their version answers, while the scan goes on
		results.fallbackUpdateHints(listOf(Umbreld.UpdateRequiredDevice("umbrel-2.local")))
		assertEquals(listOf(Umbreld.UpdateRequiredDevice("umbrel-2.local")), results.updateRequired)
		assertTrue(results.isVerifyingCandidates)
		results.fallbackFinished(Umbreld.FallbackDiscoveryResult())
		assertFalse(results.isVerifyingCandidates)
	}

	@Test
	fun aCardWaitsWhileItsMdnsCandidateIsBeingVerified() {
		val results = ScanResults(savedIds = emptySet())

		results.identifying(listOf(Candidate("umbrel.local", name = "umbrel")))
		results.fallbackStarted()
		results.fallbackFinished(Umbreld.FallbackDiscoveryResult(unverified = listOf(slow)))
		assertTrue(results.unverified.isEmpty())

		results.identified(emptyList())
		assertEquals(listOf(slow), results.unverified)
	}

	// Below Android 16 an mDNS candidate's host is usually its IP address, which a fallback
	// card for the same Umbrel knows from resolving its name.
	@Test
	fun aCardWaitsWhileACandidateAtItsAddressIsBeingVerified() {
		val results = ScanResults(savedIds = emptySet())
		val slowAtAddress = slow.copy(addresses = listOf("192.168.1.20"))

		results.identifying(listOf(Candidate("192.168.1.20", addresses = listOf("192.168.1.20"), name = "umbrel")))
		results.fallbackStarted()
		results.fallbackFinished(Umbreld.FallbackDiscoveryResult(unverified = listOf(slowAtAddress)))
		assertTrue(results.unverified.isEmpty())

		results.identified(emptyList())
		assertEquals(listOf(slowAtAddress), results.unverified)
	}

	@Test
	fun anUpdateCardWaitsWhileACandidateAtItsAddressIsBeingVerified() {
		val results = ScanResults(savedIds = emptySet())
		val update = Umbreld.UpdateRequiredDevice("umbrel.local", listOf("192.168.1.20"))

		results.identifying(listOf(Candidate("192.168.1.20", addresses = listOf("192.168.1.20"), name = "umbrel")))
		results.fallbackStarted()
		results.fallbackUpdateHints(listOf(update))
		assertTrue(results.updateRequired.isEmpty())

		results.identified(emptyList())
		assertEquals(listOf(update), results.updateRequired)
	}

	// Once updated, the same Umbrel advertises itself, and mDNS finds it by its address
	@Test
	fun anUpdateCardGoesOnceItsUmbrelProvesItselfAtItsAddress() {
		val results = ScanResults(savedIds = emptySet()) { true }
		results.fallbackStarted()
		results.fallbackFinished(
			Umbreld.FallbackDiscoveryResult(updateRequired = listOf(Umbreld.UpdateRequiredDevice("umbrel.local", listOf("192.168.1.10")))),
		)
		assertEquals(listOf("umbrel.local"), results.updateRequired.map { it.host })

		results.identifying(listOf(Candidate("192.168.1.10", addresses = listOf("192.168.1.10"), name = "umbrel")))
		results.identified(listOf(identified("192.168.1.10", addresses = listOf("192.168.1.10"))))
		assertEquals(listOf("192.168.1.10"), results.devices.map { it.host })
		assertTrue(results.updateRequired.isEmpty())

		// Gone for good: losing the Umbrel from mDNS doesn't bring the card back
		results.identifying(emptyList())
		assertTrue(results.updateRequired.isEmpty())
	}
}
