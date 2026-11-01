package com.umbrel.kit

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.URI

// The Swift kit picks a scheme per host through nativeScheme(for:). Every native request
// URL here is built by Umbreld.httpsUrl, so these tests check the scheme of that URL.
class NativeTransportTest {
	private fun nativeScheme(host: String): String = URI(Umbreld.httpsUrl(host, "/trpc/system.discoveryInfo")).scheme

	@Test
	fun localEndpointsUsePinnedHttps() {
		assertEquals("https", nativeScheme("umbrel.local"))
		assertEquals("https", nativeScheme("192.168.1.20"))
	}

	@Test
	fun tailscaleEndpointsUsePinnedHttps() {
		assertEquals("https", nativeScheme("100.64.0.1"))
		assertEquals("https", nativeScheme("100.127.255.254"))
	}

	@Test
	fun publicAddressesAreNeverClassifiedAsTailscale() {
		assertEquals("https", nativeScheme("100.63.255.255"))
		assertEquals("https", nativeScheme("100.128.0.1"))
		assertFalse(SavedDevice.isTailscaleAddress("100.63.255.255"))
		assertFalse(SavedDevice.isTailscaleAddress("100.128.0.1"))
	}

	@Test
	fun literalIpv4DetectionIsStrict() {
		assertTrue(SavedDevice.isIPv4Address("192.168.1.20"))
		assertTrue(SavedDevice.isIPv4Address("100.90.0.1"))
		assertFalse(SavedDevice.isIPv4Address("umbrel.local"))
		assertFalse(SavedDevice.isIPv4Address("192.168.1"))
		assertFalse(SavedDevice.isIPv4Address("192.168.1.999"))
		assertFalse(SavedDevice.isIPv4Address("192.168.01.20"))
		assertFalse(SavedDevice.isIPv4Address("192.168.01.20.invalid"))
	}

	@Test
	fun localEndpointHostsRejectUrlSyntaxAndPublicNames() {
		assertTrue(SavedDevice.isValidLocalEndpointHost("umbrel.local"))
		assertTrue(SavedDevice.isValidLocalEndpointHost("Umbrel-Pro.local"))
		assertTrue(SavedDevice.isValidLocalEndpointHost("192.168.1.20"))

		assertFalse(SavedDevice.isValidLocalEndpointHost("example.com"))
		assertFalse(SavedDevice.isValidLocalEndpointHost("umbrel.local/path"))
		assertFalse(SavedDevice.isValidLocalEndpointHost("user@umbrel.local"))
		assertFalse(SavedDevice.isValidLocalEndpointHost("umbrel.local:443"))
		assertFalse(SavedDevice.isValidLocalEndpointHost("-umbrel.local"))
		assertFalse(SavedDevice.isValidLocalEndpointHost("umbrel..local"))
	}

	@Test
	fun accountAvatarPathAcceptsOnlyUmbreldContentAddressedRoute() {
		val hash = "a".repeat(64)
		assertTrue(Umbreld.isValidAccountAvatarPath("/api/accounts/alice-2/avatar/$hash.webp"))

		assertFalse(Umbreld.isValidAccountAvatarPath("https://example.com/avatar.webp"))
		assertFalse(Umbreld.isValidAccountAvatarPath("//example.com/avatar.webp"))
		assertFalse(Umbreld.isValidAccountAvatarPath("/api/accounts/../avatar/$hash.webp"))
		assertFalse(Umbreld.isValidAccountAvatarPath("/api/accounts/alice/avatar/$hash.webp?other=1"))
		assertFalse(Umbreld.isValidAccountAvatarPath("/api/accounts/alice/avatar/${hash.uppercase()}.webp"))
		// Not in the Swift suite: hyphens may only separate alphanumeric runs.
		assertFalse(Umbreld.isValidAccountAvatarPath("/api/accounts/--/avatar/$hash.webp"))
		assertFalse(Umbreld.isValidAccountAvatarPath("/api/accounts/alice--2/avatar/$hash.webp"))
	}
}
