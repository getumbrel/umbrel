package com.umbrel.android.main

import org.junit.Assert.assertEquals
import org.junit.Test

class ProfilePresentationTest {
	@Test
	fun grantedAccessWinsOverRequestHistory() {
		assertEquals(PhotoAccess.FULL, PhotoAccess.of(full = true, partial = false, showsRationale = true, requested = true))
		assertEquals(PhotoAccess.LIMITED, PhotoAccess.of(full = false, partial = true, showsRationale = true, requested = true))
		assertEquals(PhotoAccess.LIMITED, PhotoAccess.of(full = false, partial = true, showsRationale = false, requested = false))
	}

	@Test
	fun deniedAccessDistinguishesAskingAgainFromSettings() {
		// Before any request the system prompt is the way in.
		assertEquals(PhotoAccess.NOT_DETERMINED, PhotoAccess.of(full = false, partial = false, showsRationale = false, requested = false))
		// After one denial the system still asks.
		assertEquals(PhotoAccess.DENIED, PhotoAccess.of(full = false, partial = false, showsRationale = true, requested = false))
		assertEquals(PhotoAccess.DENIED, PhotoAccess.of(full = false, partial = false, showsRationale = true, requested = true))
		// A request answered without a rationale afterwards was a permanent denial.
		assertEquals(PhotoAccess.BLOCKED, PhotoAccess.of(full = false, partial = false, showsRationale = false, requested = true))
	}

	@Test
	fun photoAccessLabelsMatchIOS() {
		assertEquals(
			listOf("Full Access", "Limited", "Set Up", "Off", "Off"),
			listOf(PhotoAccess.FULL, PhotoAccess.LIMITED, PhotoAccess.NOT_DETERMINED, PhotoAccess.DENIED, PhotoAccess.BLOCKED).map { it.label },
		)
	}

	@Test
	fun currentConnectionNamesTheRouteOnlyOnceKnown() {
		assertEquals("Checking…", currentConnectionLabel(ConnectionState.UNVERIFIED, null))
		assertEquals("Local", currentConnectionLabel(ConnectionState.CONNECTED, ConnectionRoute.LOCAL))
		assertEquals("Tailscale", currentConnectionLabel(ConnectionState.CONNECTED, ConnectionRoute.TAILSCALE))
		assertEquals("Connected", currentConnectionLabel(ConnectionState.CONNECTED, null))
		assertEquals("Offline", currentConnectionLabel(ConnectionState.UNAVAILABLE, null))
	}

	@Test
	fun connectionPageExplainsEachState() {
		assertEquals("Connected locally", connectionTitle(ConnectionState.CONNECTED, ConnectionRoute.LOCAL))
		assertEquals("Connected through Tailscale", connectionTitle(ConnectionState.CONNECTED, ConnectionRoute.TAILSCALE))
		assertEquals("Connected", connectionTitle(ConnectionState.CONNECTED, null))
		assertEquals("Not connected", connectionTitle(ConnectionState.UNAVAILABLE, null))
		assertEquals("Checking connection", connectionTitle(ConnectionState.UNVERIFIED, null))
		assertEquals(
			"This phone is connected through your private Tailscale network.",
			connectionMessage(ConnectionState.CONNECTED, ConnectionRoute.TAILSCALE, hasKnownTailscaleAddress = true),
		)
	}

	@Test
	fun offlineAdviceMentionsTailscaleOnlyWhenAnAddressIsKnown() {
		assertEquals(
			"Make sure your Umbrel is turned on. Connect this phone to the same local network, or turn on Tailscale.",
			connectionMessage(ConnectionState.UNAVAILABLE, null, hasKnownTailscaleAddress = true),
		)
		assertEquals(
			"Make sure your Umbrel is turned on and this phone is connected to the same network.",
			connectionMessage(ConnectionState.UNAVAILABLE, null, hasKnownTailscaleAddress = false),
		)
	}
}
