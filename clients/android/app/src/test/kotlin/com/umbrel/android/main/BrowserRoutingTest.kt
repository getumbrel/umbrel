package com.umbrel.android.main

import com.umbrel.kit.SavedDevice
import com.umbrel.kit.Umbreld
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BrowserRoutingTest {
	private val device = SavedDevice(
		id = "device",
		name = "Umbrel",
		host = "umbrel.local",
		addresses = listOf("192.168.1.5", "100.64.0.7", "umbrel.local", "", "10.0.0.2"),
	)
	private val options = BrowserRouting.addressOptions(device)

	private fun hosts(endpoints: List<BrowserEndpoint>) = endpoints.map { it.host }

	@Test
	fun addressOptionsKeepSavedHostFirstWithoutDuplicates() {
		assertEquals(listOf("umbrel.local", "192.168.1.5", "100.64.0.7", "10.0.0.2"), options)
		assertTrue(BrowserRouting.hasTailscaleAddress(device))
		assertFalse(BrowserRouting.hasTailscaleAddress(device.copy(addresses = listOf("192.168.1.5"))))
	}

	@Test
	fun candidatesPreferStableNamesThenTailscaleThenLocalAddresses() {
		val candidates = BrowserRouting.candidates("umbrel", options)
		assertEquals(listOf("umbrel", "umbrel.local", "100.64.0.7", "192.168.1.5", "10.0.0.2"), hosts(candidates))
		assertEquals(
			listOf(BrowserEndpoint.Kind.TAILSCALE_DNS, BrowserEndpoint.Kind.LOCAL_DNS, BrowserEndpoint.Kind.TAILSCALE_IP, BrowserEndpoint.Kind.LOCAL_IP, BrowserEndpoint.Kind.LOCAL_IP),
			candidates.map { it.kind },
		)
		assertEquals(listOf("umbrel.local", "100.64.0.7", "192.168.1.5", "10.0.0.2"), hosts(BrowserRouting.candidates(null, options)))
	}

	@Test
	fun firstReachableReusesRecentEvidenceExceptForTheTailscaleName() = runTest {
		val candidates = BrowserRouting.candidates("umbrel", options)
		val probed = mutableListOf<Pair<String, Long>>()
		val remembered = mutableListOf<String>()
		val endpoint = BrowserRouting.firstReachable(
			candidates,
			recentlyReached = { it == "umbrel" || it == "100.64.0.7" },
			probe = { host, timeout ->
				probed += host to timeout
				false
			},
			remember = { remembered += it },
		)
		// The MagicDNS name is probed even with recent evidence, then the local name, and the
		// recently reached Tailscale address wins without a probe.
		assertEquals(listOf("umbrel" to 1_000L, "umbrel.local" to 1_000L), probed)
		assertEquals("100.64.0.7", endpoint?.host)
		assertTrue(remembered.isEmpty())
	}

	@Test
	fun firstReachableProbesLiteralAddressesLongerAndRemembersTheWinner() = runTest {
		val candidates = BrowserRouting.candidates(null, listOf("UMBREL.local", "umbrel.local", "192.168.1.5"))
		val probed = mutableListOf<Pair<String, Long>>()
		val remembered = mutableListOf<String>()
		val endpoint = BrowserRouting.firstReachable(
			candidates,
			recentlyReached = { false },
			probe = { host, timeout ->
				probed += host to timeout
				host == "192.168.1.5"
			},
			remember = { remembered += it },
		)
		// Names that differ only in case are tried once.
		assertEquals(listOf("UMBREL.local" to 1_000L, "192.168.1.5" to 3_000L), probed)
		assertEquals(BrowserEndpoint("192.168.1.5", BrowserEndpoint.Kind.LOCAL_IP), endpoint)
		assertEquals(listOf("192.168.1.5"), remembered)
	}

	@Test
	fun firstReachableReturnsNullWhenNothingAnswers() = runTest {
		val candidates = BrowserRouting.candidates(null, options)
		assertNull(BrowserRouting.firstReachable(candidates, { false }, { _, _ -> false }, {}))
	}

	@Test
	fun schemeFollowsTheRouteAndWhatTheBrowserTrusts() = runTest {
		val asked = mutableListOf<String>()
		suspend fun usesHttps(endpoint: BrowserEndpoint, trusted: Boolean) = BrowserRouting.usesHttps(endpoint) {
			asked += it
			trusted
		}

		// A local name uses HTTPS only once the browser trusts the Umbrel's certificate.
		assertTrue(usesHttps(BrowserEndpoint("umbrel.local", BrowserEndpoint.Kind.LOCAL_DNS), trusted = true))
		assertFalse(usesHttps(BrowserEndpoint("umbrel.local", BrowserEndpoint.Kind.LOCAL_DNS), trusted = false))
		// Tailscale already encrypts the transport, and the certificate doesn't cover its name.
		assertFalse(usesHttps(BrowserEndpoint("umbrel", BrowserEndpoint.Kind.TAILSCALE_DNS), trusted = true))
		// Literal addresses always use Umbrel's IP-valid certificate.
		assertTrue(usesHttps(BrowserEndpoint("192.168.1.5", BrowserEndpoint.Kind.LOCAL_IP), trusted = false))
		assertTrue(usesHttps(BrowserEndpoint("100.64.0.7", BrowserEndpoint.Kind.TAILSCALE_IP), trusted = false))
		assertEquals(listOf("umbrel.local", "umbrel.local"), asked)
	}

	@Test
	fun dashboardPathsAndQueriesArePercentEncoded() {
		assertEquals(
			"http://umbrel.local/files/Home/My%20Photos",
			BrowserRouting.dashboardUrl("umbrel.local", false, "/files/Home/My Photos"),
		)
		assertEquals(
			"http://umbrel.local/files/Home/100%25%20%23done%3F",
			BrowserRouting.dashboardUrl("umbrel.local", false, "/files/Home/100% #done?"),
		)
		assertEquals(
			"http://umbrel.local/files/Home/Caf%C3%A9",
			BrowserRouting.dashboardUrl("umbrel.local", false, "/files/Home/Café"),
		)
		assertEquals(
			"http://umbrel.local?dialog=live-usage&live-usage-tab=storage",
			BrowserRouting.dashboardUrl("umbrel.local", false, query = listOf("dialog" to "live-usage", "live-usage-tab" to "storage")),
		)
		assertEquals(
			"http://umbrel.local/app-store?dialog=updates",
			BrowserRouting.dashboardUrl("umbrel.local", false, "/app-store", listOf("dialog" to "updates")),
		)
	}

	@Test
	fun appUrlsUseThePortAndNormalizedPath() {
		val app = Umbreld.AppSummary(id = "immich", name = "Immich", port = 2283, path = "web")
		assertEquals("https://umbrel.local:2283/web", BrowserRouting.appUrl(app, "umbrel.local", "https"))
		assertEquals("http://192.168.1.5:2283", BrowserRouting.appUrl(app.copy(path = ""), "192.168.1.5", "http"))
		assertNull(BrowserRouting.appUrl(app.copy(port = null), "umbrel.local", "http"))
		assertNull(BrowserRouting.appUrl(app.copy(torOnly = true), "umbrel.local", "http"))
	}
}
