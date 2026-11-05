package com.umbrel.kit

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Test

class SavedDeviceDiscoveryTest {
	@Test
	fun bonjourCandidateCannotIntroduceTailscaleAddress() {
		val candidate = Candidate(host = "umbrel.local", addresses = listOf("192.168.1.20", "100.90.0.1"), name = "Umbrel")

		val filtered = Umbreld.localDiscoveryCandidate(candidate)

		assertNotNull(filtered)
		assertEquals("umbrel.local", filtered!!.host)
		assertEquals(listOf("192.168.1.20"), filtered.addresses)
	}

	@Test
	fun bonjourCandidateRejectsLiteralTailscaleHost() {
		assertNull(Umbreld.localDiscoveryCandidate(Candidate(host = "100.90.0.1", name = "Umbrel")))
	}

	@Test
	fun manualDiscoveryAddressAcceptsDirectIpsAndLocalHostnames() {
		assertEquals("10.0.0.1", Umbreld.manualDiscoveryHostValue("10.0.0.1"))
		assertEquals("172.16.0.1", Umbreld.manualDiscoveryHostValue("172.16.0.1"))
		assertEquals("192.168.1.20", Umbreld.manualDiscoveryHostValue(" 192.168.1.20\n"))
		assertEquals("169.254.1.1", Umbreld.manualDiscoveryHostValue("169.254.1.1"))
		assertEquals("100.90.0.1", Umbreld.manualDiscoveryHostValue("100.90.0.1"))
		assertEquals("umbrel-4.local", Umbreld.manualDiscoveryHostValue(" Umbrel-4.LOCAL. "))
	}

	@Test
	fun manualDiscoveryUsesAddressAsSavedNameFallback() {
		assertEquals("100.90.0.1", Umbreld.manualDiscoveryCandidate("100.90.0.1")?.name)
	}

	@Test
	fun manualDiscoveryUsesLocalHostnameDirectly() {
		val candidate = Umbreld.manualDiscoveryCandidate("umbrel.local")

		assertNotNull(candidate)
		assertEquals("umbrel.local", candidate!!.host)
		assertEquals("umbrel.local", candidate.name)
		assertTrue(candidate.addresses.isEmpty())
	}

	@Test
	fun manualDiscoveryAcceptsMagicDnsNamesForResolution() {
		assertEquals("umbrel", Umbreld.manualDiscoveryHostValue("umbrel"))
		assertEquals("umbrel.my-tailnet.ts.net", Umbreld.manualDiscoveryHostValue(" Umbrel.My-Tailnet.ts.net. "))
	}

	@Test
	fun manualDiscoveryAcceptsPlainHttpAndHttpsUrls() {
		assertEquals("umbrel.local", Umbreld.manualDiscoveryHostValue("http://umbrel.local/"))
		assertEquals("umbrel", Umbreld.manualDiscoveryHostValue("HTTPS://Umbrel/"))
		assertEquals("192.168.1.20", Umbreld.manualDiscoveryHostValue("http://192.168.1.20/"))
		assertEquals("100.90.0.1", Umbreld.manualDiscoveryHostValue("https://100.90.0.1"))
		assertEquals("umbrel.my-tailnet.ts.net", Umbreld.manualDiscoveryHostValue("https://umbrel.my-tailnet.ts.net/"))
	}

	@Test
	fun manualDiscoveryUsesOnlyResolvedTailscaleAddressesForMagicDns() {
		val candidate = Umbreld.manualDiscoveryCandidate(
			"umbrel.my-tailnet.ts.net",
			listOf("192.168.1.20", "100.90.0.1", "203.0.113.2", "100.90.0.2", "100.90.0.1"),
		)

		assertNotNull(candidate)
		assertEquals("100.90.0.1", candidate!!.host)
		assertEquals(listOf("100.90.0.2"), candidate.addresses)
		assertEquals("umbrel.my-tailnet.ts.net", candidate.name)
	}

	@Test
	fun manualDiscoveryAllowsSafeLocalAndTailscaleResultsForShortHostnames() {
		val candidate = Umbreld.manualDiscoveryCandidate("umbrel", listOf("203.0.113.2", "192.168.1.20", "100.90.0.1", "192.168.1.20"))

		assertNotNull(candidate)
		assertEquals("192.168.1.20", candidate!!.host)
		assertEquals(listOf("100.90.0.1"), candidate.addresses)
		assertEquals("umbrel", candidate.name)
	}

	@Test
	fun manualDiscoveryRejectsNonTailscaleDnsResults() {
		assertNull(Umbreld.manualDiscoveryCandidate("umbrel.my-tailnet.ts.net", listOf("192.168.1.20", "203.0.113.2")))
	}

	@Test
	fun manualDiscoveryAddressRejectsPublicHostnamesAndUrlSyntax() {
		val rejected = listOf(
			"example.com",
			"https://example.com",
			"ftp://umbrel.local",
			"https://user@umbrel.local",
			"https://umbrel.local:443",
			"https://umbrel.local/settings",
			"https://umbrel.local?tab=apps",
			"https://umbrel.local#apps",
			"192.168.1.20:443",
			"192.168.1.999",
			"bad_name.ts.net",
			"0.0.0.0",
			"127.0.0.1",
			"172.15.255.255",
			"172.32.0.0",
			"203.0.113.2",
			"224.0.0.1",
			// Not in the Swift suite: blank input has no host at all.
			"",
			"   ",
		)
		for (input in rejected) {
			assertNull(input, Umbreld.manualDiscoveryHostValue(input))
		}
	}

	@Test
	fun manualDiscoveryReportsUnsupportedLiteralAsInvalid() = runBlocking {
		try {
			Umbreld.discoverManually("127.0.0.1")
			fail("Expected an invalid-address error")
		} catch (error: Umbreld.ManualDiscoveryException) {
			assertEquals(Umbreld.ManualDiscoveryException.Kind.INVALID_ADDRESS, error.kind)
		}
	}

	@Test
	fun manualDiscoveryReportsUnsupportedResolvedAddressAsNotFound() = runBlocking {
		try {
			Umbreld.discoverManually("localhost")
			fail("Expected a no-device-found error")
		} catch (error: Umbreld.ManualDiscoveryException) {
			assertEquals(Umbreld.ManualDiscoveryException.Kind.NO_DEVICE_FOUND, error.kind)
		}
	}

	@Test
	fun systemIpv4ResolverUsesLocalDnsConfiguration() = runBlocking {
		assertTrue(IPv4HostResolver.resolve("localhost").contains("127.0.0.1"))
	}

	@Test
	fun liveManualAddressDiscovery() = runBlocking {
		val host = System.getenv("UMBRELKIT_MANUAL_DISCOVERY_TEST_HOST")
		assumeTrue("Set UMBRELKIT_MANUAL_DISCOVERY_TEST_HOST to an Umbrel IP or hostname", host != null)

		val result = Umbreld.discoverManually(host!!)

		assertTrue("Expected a current Umbrel at $host, got $result", result is Umbreld.ManualDiscoveryResult.Device)
	}

	@Test
	fun verifiedBonjourRenameReplacesStaleHostname() {
		val saved = SavedDevice(id = "device", name = "Umbrel", host = "umbrel.local", addresses = listOf("umbrel.local", "192.168.1.10", "100.90.0.1"))
		val discovered = IdentifiedDevice(
			host = "umbrel-2.local",
			discoveryHost = "umbrel-2.local",
			addresses = listOf("192.168.1.20"),
			name = "Umbrel 2",
			id = "device",
			model = "Umbrel Home",
			onboarded = true,
		)

		val merged = saved.mergeVerifiedDiscovery(discovered)

		assertEquals("umbrel-2.local", merged.host)
		assertFalse(merged.addresses.contains("umbrel.local"))
		assertTrue(merged.addresses.contains("192.168.1.10"))
		assertTrue(merged.addresses.contains("192.168.1.20"))
		assertTrue(merged.addresses.contains("100.90.0.1"))
		assertEquals("100.90.0.1", merged.tailscaleAddress)
	}

	@Test
	fun discoveryForAnotherDeviceCannotChangeSavedDevice() {
		val saved = SavedDevice(id = "device", name = "Umbrel", host = "umbrel.local", addresses = emptyList())
		val discovered = IdentifiedDevice(
			host = "umbrel-2.local",
			discoveryHost = "umbrel-2.local",
			addresses = listOf("192.168.1.20"),
			name = "Other Umbrel",
			id = "other",
			model = "Umbrel Home",
			onboarded = true,
		)

		assertSame(saved, saved.mergeVerifiedDiscovery(discovered))
	}

	@Test
	fun tailscaleAddressComesFromTheCgnatRange() {
		val saved = SavedDevice(id = "device", name = "Umbrel", host = "100.90.0.1", addresses = listOf("192.168.1.20"))

		assertEquals("100.90.0.1", saved.tailscaleAddress)
	}

	@Test
	fun tailscaleAddressIsFoundAmongCandidates() {
		val saved = SavedDevice(id = "device", name = "Umbrel", host = "umbrel.local", addresses = listOf("192.168.1.20", "100.90.0.1"))

		assertEquals("100.90.0.1", saved.tailscaleAddress)
	}

	@Test
	fun reportedTailscaleAddressReplacesCanonicalPairingAddress() {
		val saved = SavedDevice(id = "device", name = "Umbrel", host = "100.90.0.1", addresses = listOf("192.168.1.20", "100.90.0.2"))

		assertEquals("100.90.0.2", saved.tailscaleAddress)
	}

	@Test
	fun verifiedIpAddressReplacesAnUnreachableBonjourHostname() {
		val saved = SavedDevice(id = "device", name = "Umbrel", host = "umbrel.local", addresses = listOf("umbrel.local", "192.168.1.10"))
		val discovered = IdentifiedDevice(
			host = "192.168.1.20",
			discoveryHost = "umbrel-2.local",
			addresses = listOf("192.168.1.20"),
			name = "Umbrel",
			id = "device",
			model = "Umbrel Home",
			onboarded = true,
		)

		val merged = saved.mergeVerifiedDiscovery(discovered)

		assertEquals("192.168.1.20", merged.host)
		assertFalse(merged.addresses.contains("umbrel.local"))
		assertNull(merged.tailscaleAddress)
	}
}
